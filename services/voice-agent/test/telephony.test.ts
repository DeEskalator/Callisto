import { createSocket, type Socket } from 'node:dgram';
import { MemoryCallStore, MemoryConfigStore, MemorySlotStore } from '@callisto/data/memory';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KeywordEmergencyMonitor } from '../src/emergency';
import type { ConversationModel, ModelConfig, ModelEvents } from '../src/model';
import type { SpeechSynthesizer } from '../src/speech';
import { decodeG711, encodeG711 } from '../src/telephony/g711';
import { buildAnswer, parseOffer } from '../src/telephony/sdp';
import { header, parseSipMessage, type SipMessage } from '../src/telephony/sip-message';
import { SipServer } from '../src/telephony/sip-server';

const PRACTICE = 'main';
const SIP_PORT = 35_062;
const RTP_PORTS = { min: 36_000, max: 36_010 };

describe('G.711', () => {
  it('encodes silence to the well-known byte of each variant', () => {
    expect(encodeG711(Buffer.alloc(2), 'PCMU')[0]).toBe(0xff);
    expect(encodeG711(Buffer.alloc(2), 'PCMA')[0]).toBe(0xd5);
  });

  it('round-trips speech with the precision of the codec', () => {
    const samples = [0, 100, -100, 1000, -1000, 8000, -8000, 30000, -30000];
    const pcm = Buffer.alloc(samples.length * 2);
    for (const [index, sample] of samples.entries()) {
      pcm.writeInt16LE(sample, index * 2);
    }
    for (const codec of ['PCMU', 'PCMA'] as const) {
      const decoded = decodeG711(encodeG711(pcm, codec), codec);
      samples.forEach((sample, index) => {
        const error = Math.abs(decoded.readInt16LE(index * 2) - sample);
        // Logarithmic quantisation: the error grows with the amplitude, about 3 % at most.
        expect(error).toBeLessThanOrEqual(Math.max(16, Math.abs(sample) * 0.035));
      });
    }
  });
});

describe('SDP', () => {
  const offer = [
    'v=0',
    'o=- 1 1 IN IP4 10.0.0.1',
    's=-',
    'c=IN IP4 203.0.113.5',
    't=0 0',
    'm=audio 40000 RTP/AVP 9 8 0 101',
    'a=rtpmap:9 G722/8000',
    'a=rtpmap:8 PCMA/8000',
    'a=rtpmap:101 telephone-event/8000',
    '',
  ].join('\r\n');

  it('takes the first G.711 variant of the offer and its address', () => {
    expect(parseOffer(offer)).toEqual({
      address: '203.0.113.5',
      port: 40000,
      codec: 'PCMA',
      payloadType: 8,
    });
  });

  it('rejects offers without G.711', () => {
    expect(parseOffer(offer.replace('9 8 0 101', '18'))).toBeUndefined();
  });

  it('answers with exactly the chosen codec', () => {
    const answer = buildAnswer({
      address: '198.51.100.7',
      port: 20000,
      codec: 'PCMA',
      sessionId: '1',
    });
    expect(answer).toContain('c=IN IP4 198.51.100.7');
    expect(answer).toContain('m=audio 20000 RTP/AVP 8\r\n');
    expect(answer).toContain('a=rtpmap:8 PCMA/8000');
  });
});

describe('SIP messages', () => {
  it('reads compact header names, several Via values and the body', () => {
    const message = parseSipMessage(
      [
        'INVITE sip:callisto@198.51.100.7 SIP/2.0',
        'v: SIP/2.0/UDP 99.77.247.10:5060;branch=z9hG4bKa, SIP/2.0/UDP 99.77.247.11;branch=z9hG4bKb',
        'f: <sip:+4917612345678@99.77.247.10>;tag=abc',
        'i: call-1',
        'l: 4',
        '',
        'body',
      ].join('\r\n'),
    );
    expect(message?.method).toBe('INVITE');
    expect(message?.headers.get('via')).toHaveLength(2);
    expect(header(message as SipMessage, 'call-id')).toBe('call-1');
    expect(message?.body).toBe('body');
  });
});

// ── A phone call end to end, with a softphone stand-in on the other side ────────

/** A model that does what the test tells it to and records the audio it hears. */
class ControlledModel implements ConversationModel {
  events: ModelEvents | undefined;
  config: ModelConfig | undefined;
  heardBytes = 0;

  async start(config: ModelConfig, events: ModelEvents) {
    this.config = config;
    this.events = events;
    return {
      sendAudio: (pcm: Buffer) => {
        this.heardBytes += pcm.length;
      },
      sendText: () => {},
      sendToolResult: () => {},
      close: async () => {},
    };
  }
}

/** 100 ms of a tone, so that the announcements produce real packets. */
const tone: SpeechSynthesizer = {
  synthesize: async (_text, sampleRate) => {
    const pcm = Buffer.alloc((sampleRate / 10) * 2);
    for (let index = 0; index < pcm.length / 2; index++) {
      pcm.writeInt16LE(Math.round(Math.sin(index / 4) * 8000), index * 2);
    }
    return pcm;
  },
};

/** The calling side: sends SIP requests and RTP, collects what comes back. */
class Softphone {
  readonly sip: Socket = createSocket('udp4');
  readonly rtp: Socket = createSocket('udp4');
  readonly messages: SipMessage[] = [];
  rtpPackets: Buffer[] = [];

  async open(): Promise<void> {
    this.sip.on('message', (data) => {
      const message = parseSipMessage(data.toString());
      if (message) {
        this.messages.push(message);
      }
    });
    this.rtp.on('message', (data) => this.rtpPackets.push(data));
    await new Promise<void>((resolve) => this.sip.bind(0, '127.0.0.1', resolve));
    await new Promise<void>((resolve) => this.rtp.bind(0, '127.0.0.1', resolve));
  }

  get sipPort() {
    return this.sip.address().port;
  }

  get rtpPort() {
    return this.rtp.address().port;
  }

  send(lines: string[], body = ''): void {
    const text = `${[...lines, `Content-Length: ${Buffer.byteLength(body)}`].join('\r\n')}\r\n\r\n${body}`;
    this.sip.send(text, SIP_PORT, '127.0.0.1');
  }

  invite(callId: string, payloadTypes = '8 0 101'): void {
    const sdp = [
      'v=0',
      'o=- 1 1 IN IP4 127.0.0.1',
      's=-',
      'c=IN IP4 127.0.0.1',
      't=0 0',
      `m=audio ${this.rtpPort} RTP/AVP ${payloadTypes}`,
      '',
    ].join('\r\n');
    this.send(
      [
        'INVITE sip:callisto@127.0.0.1 SIP/2.0',
        `Via: SIP/2.0/UDP 127.0.0.1:${this.sipPort};branch=z9hG4bK-${callId}`,
        'From: <sip:+4917612345678@127.0.0.1>;tag=caller',
        'To: <sip:callisto@127.0.0.1>',
        `Call-ID: ${callId}`,
        'CSeq: 1 INVITE',
        `Contact: <sip:caller@127.0.0.1:${this.sipPort}>`,
        'x-callisto-transaction: tx-1',
        'Content-Type: application/sdp',
      ],
      sdp,
    );
  }

  inDialog(method: string, callId: string, cseq: number): void {
    const ok = this.messages.find(
      (message) => message.status === 200 && header(message, 'call-id') === callId,
    );
    this.send([
      `${method} sip:callisto@127.0.0.1:${SIP_PORT} SIP/2.0`,
      `Via: SIP/2.0/UDP 127.0.0.1:${this.sipPort};branch=z9hG4bK-${method}-${cseq}`,
      'From: <sip:+4917612345678@127.0.0.1>;tag=caller',
      `To: ${ok ? header(ok, 'to') : '<sip:callisto@127.0.0.1>'}`,
      `Call-ID: ${callId}`,
      `CSeq: ${cseq} ${method}`,
    ]);
  }

  sendAudio(port: number, frames: number): void {
    for (let index = 0; index < frames; index++) {
      const packet = Buffer.alloc(12 + 160, 0xd5);
      packet[0] = 0x80;
      packet[1] = 8;
      packet.writeUInt16BE(index, 2);
      packet.writeUInt32BE(index * 160, 4);
      packet.writeUInt32BE(1234, 8);
      this.rtp.send(packet, port, '127.0.0.1');
    }
  }

  async waitFor(predicate: (message: SipMessage) => boolean, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = this.messages.find(predicate);
      if (found) {
        return found;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('The expected SIP message did not arrive');
  }

  close(): void {
    this.sip.close();
    this.rtp.close();
  }
}

const until = async (condition: () => boolean, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(condition()).toBe(true);
};

describe('a phone call', () => {
  let server: SipServer;
  let phone: Softphone;
  let model: ControlledModel;
  let calls: MemoryCallStore;
  let transfers: string[];

  beforeEach(async () => {
    const config = MemoryConfigStore.withPractice(PRACTICE, 'Praxis Test', 'NW');
    const practice = await config.load(PRACTICE);
    if (practice) {
      await config.putSettings(PRACTICE, { ...practice.settings, transferNumber: '+4930123456' });
    }
    calls = new MemoryCallStore();
    model = new ControlledModel();
    transfers = [];
    server = new SipServer({
      sipPort: SIP_PORT,
      rtpPorts: RTP_PORTS,
      publicAddress: '127.0.0.1',
      practiceId: PRACTICE,
      session: {
        config,
        calls,
        slots: new MemorySlotStore(),
        model,
        emergency: new KeywordEmergencyMonitor(),
        speech: tone,
        // Monday 09:00 in Berlin: open, so the assistant may put callers through.
        now: () => new Date('2026-11-16T08:00:00Z'),
      },
      onTransfer: async (transactionId) => {
        transfers.push(transactionId);
      },
      log: () => {},
    });
    await server.start();
    phone = new Softphone();
    await phone.open();
  });

  afterEach(async () => {
    await server.close();
    phone.close();
  });

  it('answers keep-alives', async () => {
    phone.send([
      'OPTIONS sip:callisto@127.0.0.1 SIP/2.0',
      `Via: SIP/2.0/UDP 127.0.0.1:${phone.sipPort};branch=z9hG4bK-options`,
      'From: <sip:ping@127.0.0.1>;tag=1',
      'To: <sip:callisto@127.0.0.1>',
      'Call-ID: options-1',
      'CSeq: 1 OPTIONS',
    ]);
    const response = await phone.waitFor((message) => header(message, 'call-id') === 'options-1');
    expect(response.status).toBe(200);
  });

  it('rejects calls without a codec it can speak', async () => {
    phone.invite('g729-call', '18');
    const response = await phone.waitFor(
      (message) => header(message, 'call-id') === 'g729-call' && (message.status ?? 0) >= 400,
    );
    expect(response.status).toBe(488);
  });

  it('answers, talks at 8 kHz in both directions and records the call', async () => {
    phone.invite('call-1');
    const ok = await phone.waitFor((message) => message.status === 200);
    const answer = parseOffer(ok.body);
    expect(answer?.codec).toBe('PCMA');
    phone.inDialog('ACK', 'call-1', 1);

    // The greeting is spoken: RTP arrives at the softphone.
    await until(() => phone.rtpPackets.length > 5);
    expect((phone.rtpPackets[0]?.[1] ?? 0) & 0x7f).toBe(8);
    expect(model.config?.sampleRate).toBe(8000);

    // What the caller says reaches the model, decoded: 20 ms are 320 bytes of PCM.
    phone.sendAudio(answer?.port ?? 0, 5);
    await until(() => model.heardBytes === 5 * 320);

    const [call] = [...calls.calls.values()];
    expect(call).toMatchObject({
      channel: 'phone',
      status: 'in_progress',
      callerNumber: '+4917612345678',
    });

    // The caller hangs up.
    phone.inDialog('BYE', 'call-1', 2);
    await phone.waitFor((message) => message.status === 200 && header(message, 'cseq') === '2 BYE');
    await until(() => calls.calls.get(call?.id ?? '')?.status !== 'in_progress');
    expect(server.activeCalls).toBe(0);
  });

  it('puts the caller through: records the transfer, then hangs up', async () => {
    phone.invite('call-2');
    await phone.waitFor((message) => message.status === 200);
    phone.inDialog('ACK', 'call-2', 1);
    await until(() => model.events !== undefined);

    model.events?.onToolUse({
      id: 'tool-1',
      name: 'mit_praxis_verbinden',
      input: { summary: 'Frage zur Überweisung', lastName: 'Yilmaz' },
    });

    const bye = await phone.waitFor((message) => message.method === 'BYE', 5000);
    expect(header(bye, 'call-id')).toBe('call-2');
    expect(transfers).toEqual(['tx-1']);
    const [call] = [...calls.calls.values()];
    await until(() => calls.calls.get(call?.id ?? '')?.status === 'transferred');
  });

  it('names 112 on an emergency and ends the call', async () => {
    phone.invite('call-3');
    await phone.waitFor((message) => message.status === 200);
    phone.inDialog('ACK', 'call-3', 1);
    await until(() => model.events !== undefined);

    model.events?.onCallerText('Ich bekomme keine Luft mehr');

    await phone.waitFor((message) => message.method === 'BYE', 5000);
    expect(transfers).toEqual([]);
    const turns = await calls.listTurns([...calls.calls.keys()][0] ?? '');
    expect(turns.at(-1)?.text).toContain('112');
  });
});
