import { randomBytes } from 'node:crypto';
import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import { type CallerLink, ConversationSession, type SessionDeps } from '../session';
import { PortPool, RtpStream } from './rtp';
import { buildAnswer, parseOffer } from './sdp';
import {
  buildResponse,
  header,
  headerParameter,
  parseSipMessage,
  type SipMessage,
  serializeSipMessage,
  uriOf,
  userOf,
} from './sip-message';

export interface TelephonyOptions {
  /** UDP port for SIP signalling, usually 5060. */
  sipPort: number;
  /** Range of UDP ports for the audio of running calls. */
  rtpPorts: { min: number; max: number };
  /** The address the other side reaches this server at; goes into SDP and Contact. */
  publicAddress: string;
  /** The practice whose phone line this is. */
  practiceId: string;
  session: SessionDeps;
  /**
   * Called before hanging up when the assistant puts a caller through to the practice. The SIP
   * media application connects the caller once this side has hung up.
   */
  onTransfer: (transactionId: string) => Promise<void>;
  log: (message: string, details?: Record<string, unknown>) => void;
}

/** SIP header the SIP media application uses to name its transaction (see the SMA handler). */
export const TRANSACTION_HEADER = 'x-callisto-transaction';

/** How long the caller still hears the assistant's last sentence before the line is closed. */
const FINAL_SPEECH_TIMEOUT_MS = 30_000;
const OK_RETRANSMIT_MS = 500;
const OK_GIVE_UP_MS = 8_000;

interface Dialog {
  callId: string;
  invite: SipMessage;
  inviteBranch: string | undefined;
  /** Where signalling for this call comes from and goes to. */
  peer: RemoteInfo;
  localTag: string;
  rtp: RtpStream;
  okResponse: string;
  okTimer?: NodeJS.Timeout | undefined;
  okGiveUp?: NodeJS.Timeout | undefined;
  session?: ConversationSession | undefined;
  confirmed: boolean;
  ended: boolean;
}

const newTag = () => randomBytes(6).toString('hex');
const newBranch = () => `z9hG4bK${randomBytes(8).toString('hex')}`;

/**
 * The phone line of the assistant: a SIP user agent (RFC 3261) over UDP that answers every call
 * the Voice Connector sends and hands it to a conversation session, with G.711 audio over RTP.
 *
 * It implements what a single trusted peer needs and nothing more: answer, hang up, be hung up
 * on, cancel, keep-alive. Re-INVITEs (e.g. hold) are confirmed without changing the media.
 */
export class SipServer {
  private readonly socket: Socket;
  private readonly ports: PortPool;
  private readonly dialogs = new Map<string, Dialog>();

  constructor(private readonly options: TelephonyOptions) {
    this.socket = createSocket('udp4');
    this.ports = new PortPool(options.rtpPorts.min, options.rtpPorts.max);
  }

  start(): Promise<void> {
    this.socket.on('message', (packet, peer) => {
      const message = parseSipMessage(packet.toString());
      if (message) {
        void this.handle(message, peer).catch((error) =>
          this.options.log('A SIP message could not be handled', { error: String(error) }),
        );
      }
    });
    return new Promise((resolve, reject) => {
      this.socket.once('error', reject);
      this.socket.bind(this.options.sipPort, () => {
        this.socket.off('error', reject);
        resolve();
      });
    });
  }

  /** Number of calls currently running. */
  get activeCalls(): number {
    return [...this.dialogs.values()].filter((dialog) => !dialog.ended).length;
  }

  async close(): Promise<void> {
    for (const dialog of this.dialogs.values()) {
      if (!dialog.ended) {
        await this.hangUp(dialog);
      }
    }
    this.socket.close();
  }

  private send(text: string, peer: { address: string; port: number }): void {
    this.socket.send(text, peer.port, peer.address);
  }

  private async handle(message: SipMessage, peer: RemoteInfo): Promise<void> {
    if (message.status !== undefined) {
      // Responses to this side's BYE need no handling beyond stopping its retransmission,
      // which is bounded anyway.
      return;
    }
    const callId = header(message, 'call-id') ?? '';
    const dialog = this.dialogs.get(callId);
    switch (message.method) {
      case 'INVITE':
        return dialog ? this.reinvite(dialog, message, peer) : this.invite(message, peer);
      case 'ACK':
        if (dialog) {
          this.confirm(dialog);
        }
        return;
      case 'BYE':
        this.send(buildResponse(message, dialog ? 200 : 481), peer);
        if (dialog) {
          await this.end(dialog);
        }
        return;
      case 'CANCEL':
        this.send(buildResponse(message, dialog ? 200 : 481), peer);
        if (dialog && !dialog.confirmed) {
          this.send(buildResponse(dialog.invite, 487, { toTag: dialog.localTag }), dialog.peer);
          await this.end(dialog);
        }
        return;
      case 'OPTIONS':
        // Keep-alive of the Voice Connector.
        this.send(
          buildResponse(message, 200, {
            extraHeaders: [['Allow', 'INVITE, ACK, BYE, CANCEL, OPTIONS']],
          }),
          peer,
        );
        return;
      default:
        this.send(buildResponse(message, 501), peer);
    }
  }

  private async invite(message: SipMessage, peer: RemoteInfo): Promise<void> {
    const callId = header(message, 'call-id') ?? '';
    this.send(buildResponse(message, 100), peer);

    const offer = parseOffer(message.body);
    if (!offer) {
      this.send(buildResponse(message, 488, { toTag: newTag() }), peer);
      return;
    }
    const port = this.ports.take();
    if (port === undefined) {
      this.options.log('No audio port free; the call is rejected as busy');
      this.send(buildResponse(message, 486, { toTag: newTag() }), peer);
      return;
    }

    let dialog: Dialog | undefined;
    const rtp = await RtpStream.open({
      port,
      remote: { address: offer.address, port: offer.port },
      codec: offer.codec,
      payloadType: offer.payloadType,
      onAudio: (pcm) => dialog?.session?.receiveAudio(pcm),
    });
    const localTag = newTag();
    const answer = buildAnswer({
      address: this.options.publicAddress,
      port,
      codec: offer.codec,
      sessionId: String(Date.now()),
    });
    const okResponse = buildResponse(message, 200, {
      toTag: localTag,
      extraHeaders: [
        ['Contact', `<sip:callisto@${this.options.publicAddress}:${this.options.sipPort}>`],
        ['Allow', 'INVITE, ACK, BYE, CANCEL, OPTIONS'],
        ['Content-Type', 'application/sdp'],
      ],
      body: answer,
    });
    dialog = {
      callId,
      invite: message,
      inviteBranch: headerParameter(header(message, 'via'), 'branch'),
      peer,
      localTag,
      rtp,
      okResponse,
      confirmed: false,
      ended: false,
    };
    this.dialogs.set(callId, dialog);

    // The call is answered right away; UDP may lose the 200, so it is repeated until the ACK.
    this.send(okResponse, peer);
    const current = dialog;
    current.okTimer = setInterval(
      () => this.send(current.okResponse, current.peer),
      OK_RETRANSMIT_MS,
    );
    current.okGiveUp = setTimeout(() => {
      if (!current.confirmed) {
        this.options.log('The call was never confirmed; it is ended');
        void this.hangUp(current);
      }
    }, OK_GIVE_UP_MS);
  }

  private reinvite(dialog: Dialog, message: SipMessage, peer: RemoteInfo): void {
    const branch = headerParameter(header(message, 'via'), 'branch');
    if (branch === dialog.inviteBranch) {
      // A retransmission of the INVITE that opened the call.
      this.send(dialog.okResponse, peer);
      return;
    }
    // A re-INVITE: confirmed with the media as it is.
    const sdp = dialog.okResponse.slice(dialog.okResponse.indexOf('\r\n\r\n') + 4);
    this.send(
      buildResponse(message, 200, {
        toTag: dialog.localTag,
        extraHeaders: [
          ['Contact', `<sip:callisto@${this.options.publicAddress}:${this.options.sipPort}>`],
          ['Content-Type', 'application/sdp'],
        ],
        body: sdp,
      }),
      peer,
    );
  }

  /** The ACK arrived: media flows both ways, the assistant can start talking. */
  private confirm(dialog: Dialog): void {
    if (dialog.confirmed || dialog.ended) {
      return;
    }
    dialog.confirmed = true;
    clearInterval(dialog.okTimer);
    clearTimeout(dialog.okGiveUp);
    dialog.rtp.start();
    void this.startSession(dialog);
  }

  private async startSession(dialog: Dialog): Promise<void> {
    const callerUri = uriOf(header(dialog.invite, 'from'));
    const caller = userOf(callerUri);
    const transactionId = header(dialog.invite, TRANSACTION_HEADER);
    const link: CallerLink = {
      // The transcript is stored by the session; nothing of what is said goes into the log.
      transcript: () => {},
      audio: (pcm) => dialog.rtp.play(pcm),
      clearAudio: () => dialog.rtp.clear(),
      ended: (reason) => {
        void (async () => {
          // The caller hears the last sentence (e.g. the emergency number) before the line closes.
          await dialog.rtp.drained(FINAL_SPEECH_TIMEOUT_MS);
          if (reason === 'transferred' && transactionId) {
            try {
              await this.options.onTransfer(transactionId);
            } catch (error) {
              this.options.log('The transfer could not be recorded', { error: String(error) });
            }
          }
          await this.hangUp(dialog);
        })();
      },
    };
    try {
      dialog.session = await ConversationSession.start(
        {
          practiceId: this.options.practiceId,
          channel: 'phone',
          // Only real numbers; "anonymous" and internal names are not stored.
          callerNumber: caller && /^\+?\d{4,15}$/.test(caller) ? caller : undefined,
          sampleRate: 8000,
        },
        this.options.session,
        link,
      );
      if (dialog.ended) {
        // The caller hung up while the session was being set up.
        await dialog.session.hangUp();
      }
    } catch (error) {
      this.options.log('A phone conversation could not be started', { error: String(error) });
      await this.hangUp(dialog);
    }
  }

  /** This side ends the call: BYE to the caller. */
  private async hangUp(dialog: Dialog): Promise<void> {
    if (dialog.ended) {
      return;
    }
    if (dialog.confirmed) {
      const invite = dialog.invite;
      const remoteTarget = uriOf(header(invite, 'contact')) ?? uriOf(header(invite, 'from')) ?? '';
      const routes = invite.headers.get('record-route') ?? [];
      const bye = serializeSipMessage(`BYE ${remoteTarget} SIP/2.0`, [
        [
          'Via',
          `SIP/2.0/UDP ${this.options.publicAddress}:${this.options.sipPort};branch=${newBranch()};rport`,
        ],
        ['Max-Forwards', '70'],
        ...routes.map((route): [string, string] => ['Route', route]),
        ['From', `${header(invite, 'to') ?? ''};tag=${dialog.localTag}`],
        ['To', header(invite, 'from') ?? ''],
        ['Call-ID', dialog.callId],
        // This side has sent no request in the dialog yet, so its sequence starts here.
        ['CSeq', '1 BYE'],
        ['User-Agent', 'Callisto'],
      ]);
      // Sent twice: a lost BYE would leave the line open and billed.
      this.send(bye, dialog.peer);
      setTimeout(() => this.send(bye, dialog.peer), 500);
    }
    await this.end(dialog);
  }

  /** Releases everything the call held. */
  private async end(dialog: Dialog): Promise<void> {
    if (dialog.ended) {
      return;
    }
    dialog.ended = true;
    clearInterval(dialog.okTimer);
    clearTimeout(dialog.okGiveUp);
    dialog.rtp.close();
    this.ports.give(dialog.rtp.port);
    await dialog.session?.hangUp();
    // Kept a little longer so that retransmitted requests of this call are still recognised.
    setTimeout(() => this.dialogs.delete(dialog.callId), 32_000).unref();
  }
}
