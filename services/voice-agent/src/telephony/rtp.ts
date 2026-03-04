import { randomInt } from 'node:crypto';
import { createSocket, type Socket } from 'node:dgram';
import { decodeG711, encodeG711, type G711Codec } from './g711';

/** 20 ms of audio at 8 kHz: the usual packet size on the phone network. */
const FRAME_SAMPLES = 160;
const FRAME_BYTES = FRAME_SAMPLES * 2;
const FRAME_MS = 20;
const HEADER_BYTES = 12;

/** The ports a media stream can use; each running call holds one. */
export class PortPool {
  private readonly free: number[] = [];

  constructor(min: number, max: number) {
    // Even ports only: RTP convention, the odd neighbour is RTCP's.
    for (let port = min + (min % 2); port <= max; port += 2) {
      this.free.push(port);
    }
  }

  take(): number | undefined {
    return this.free.shift();
  }

  give(port: number): void {
    this.free.push(port);
  }
}

/**
 * One RTP stream (RFC 3550) with G.711: receives the caller's audio and plays the assistant's
 * speech in real time, 20 ms per packet. While nothing is to be said it sends silence, so the
 * line stays open and the other side does not consider the media dead.
 */
export class RtpStream {
  private readonly socket: Socket;
  private readonly ssrc = randomInt(0x7fffffff);
  private sequence = randomInt(0xffff);
  private timestamp = randomInt(0x7fffffff);
  private pending = Buffer.alloc(0);
  private timer: NodeJS.Timeout | undefined;
  private startedAt = 0;
  private framesSent = 0;
  private drainWaiters: Array<() => void> = [];
  private closed = false;

  private constructor(
    readonly port: number,
    private remote: { address: string; port: number },
    private readonly codec: G711Codec,
    private readonly payloadType: number,
    private readonly onAudio: (pcm: Buffer) => void,
  ) {
    this.socket = createSocket('udp4');
  }

  static async open(options: {
    port: number;
    remote: { address: string; port: number };
    codec: G711Codec;
    payloadType: number;
    onAudio: (pcm: Buffer) => void;
  }): Promise<RtpStream> {
    const stream = new RtpStream(
      options.port,
      options.remote,
      options.codec,
      options.payloadType,
      options.onAudio,
    );
    await stream.bind();
    return stream;
  }

  private bind(): Promise<void> {
    this.socket.on('message', (packet, from) => this.receive(packet, from));
    return new Promise((resolve, reject) => {
      this.socket.once('error', reject);
      this.socket.bind(this.port, () => {
        this.socket.off('error', reject);
        resolve();
      });
    });
  }

  /** Starts sending; until then received audio is passed on, but nothing is played. */
  start(): void {
    if (this.timer) {
      return;
    }
    this.startedAt = Date.now();
    // Timers in Node are not exact; every tick sends as many frames as are due by the clock.
    this.timer = setInterval(() => this.sendDueFrames(), FRAME_MS / 2);
  }

  /** Queues speech for the caller: 16 bit mono PCM at 8 kHz. */
  play(pcm: Buffer): void {
    this.pending = Buffer.concat([this.pending, pcm]);
  }

  /** Drops speech that has not been sent yet (the caller interrupted). */
  clear(): void {
    this.pending = Buffer.alloc(0);
    this.notifyDrained();
  }

  /** Resolves once everything queued has been sent, at the latest after `timeoutMs`. */
  drained(timeoutMs: number): Promise<void> {
    if (this.pending.length === 0 || this.closed) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timeout = setTimeout(resolve, timeoutMs);
      this.drainWaiters.push(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    clearInterval(this.timer);
    this.timer = undefined;
    this.notifyDrained();
    this.socket.close();
  }

  private receive(packet: Buffer, from: { address: string; port: number }): void {
    if (packet.length <= HEADER_BYTES || packet[0] === undefined || packet[0] >> 6 !== 2) {
      return;
    }
    const csrcCount = packet[0] & 0x0f;
    const hasExtension = (packet[0] & 0x10) !== 0;
    const payloadType = (packet[1] ?? 0) & 0x7f;
    let offset = HEADER_BYTES + csrcCount * 4;
    if (hasExtension && packet.length >= offset + 4) {
      offset += 4 + packet.readUInt16BE(offset + 2) * 4;
    }
    // Other payload types (e.g. DTMF as telephone-event) are not needed.
    if (payloadType !== this.payloadType || offset >= packet.length) {
      return;
    }
    // Symmetric RTP: answer where the audio actually comes from, which differs from the SDP
    // address when the other side is behind NAT.
    this.remote = { address: from.address, port: from.port };
    this.onAudio(decodeG711(packet.subarray(offset), this.codec));
  }

  private sendDueFrames(): void {
    const due = Math.floor((Date.now() - this.startedAt) / FRAME_MS);
    // After a long stall (e.g. the process was paused) do not burst; just catch up the clock.
    if (due - this.framesSent > 10) {
      this.framesSent = due - 1;
    }
    while (this.framesSent < due) {
      this.sendFrame();
      this.framesSent++;
    }
  }

  private sendFrame(): void {
    let frame: Buffer;
    if (this.pending.length >= FRAME_BYTES) {
      frame = this.pending.subarray(0, FRAME_BYTES);
      this.pending = this.pending.subarray(FRAME_BYTES);
    } else {
      // The tail of the speech, padded with silence; or silence alone.
      frame = Buffer.alloc(FRAME_BYTES);
      this.pending.copy(frame);
      this.pending = Buffer.alloc(0);
    }
    if (this.pending.length === 0) {
      this.notifyDrained();
    }

    const header = Buffer.alloc(HEADER_BYTES);
    header[0] = 0x80;
    header[1] = this.payloadType;
    header.writeUInt16BE(this.sequence, 2);
    header.writeUInt32BE(this.timestamp >>> 0, 4);
    header.writeUInt32BE(this.ssrc, 8);
    this.sequence = (this.sequence + 1) & 0xffff;
    this.timestamp = (this.timestamp + FRAME_SAMPLES) % 0x100000000;

    const packet = Buffer.concat([header, encodeG711(frame, this.codec)]);
    this.socket.send(packet, this.remote.port, this.remote.address);
  }

  private notifyDrained(): void {
    const waiters = this.drainWaiters;
    this.drainWaiters = [];
    for (const waiter of waiters) {
      waiter();
    }
  }
}
