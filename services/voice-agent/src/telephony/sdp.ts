import type { G711Codec } from './g711';

/** RTP payload type numbers of G.711 (RFC 3551). */
const PAYLOAD_TYPES: Record<G711Codec, number> = { PCMU: 0, PCMA: 8 };

export interface MediaOffer {
  /** Where the other side wants to receive audio. */
  address: string;
  port: number;
  /** The first G.711 variant the offer lists, i.e. the one it prefers. */
  codec: G711Codec;
  payloadType: number;
}

/**
 * Reads the audio part of an SDP offer (RFC 4566). Only G.711 is accepted: it is what the
 * telephone network carries anyway, and the assistant works at 8 kHz on the phone.
 * @returns undefined if the offer has no audio this side can take
 */
export function parseOffer(sdp: string): MediaOffer | undefined {
  let address: string | undefined;
  let mediaAddress: string | undefined;
  let port: number | undefined;
  let payloadTypes: number[] = [];
  let inAudio = false;

  for (const line of sdp.split(/\r?\n/)) {
    if (line.startsWith('m=')) {
      const [media, mediaPort, , ...formats] = line.slice(2).trim().split(/\s+/);
      inAudio = media === 'audio' && port === undefined;
      if (inAudio) {
        port = Number(mediaPort);
        payloadTypes = formats.map(Number);
      }
    } else if (line.startsWith('c=')) {
      const connection = line.slice(2).trim().split(/\s+/)[2];
      if (inAudio) {
        mediaAddress = connection;
      } else if (port === undefined) {
        address = connection;
      }
    }
  }

  const payloadType = payloadTypes.find((type) => type === 0 || type === 8);
  const remoteAddress = mediaAddress ?? address;
  if (payloadType === undefined || !port || !remoteAddress) {
    return undefined;
  }
  return {
    address: remoteAddress,
    port,
    codec: payloadType === 0 ? 'PCMU' : 'PCMA',
    payloadType,
  };
}

/** The SDP answer: one audio stream with the codec chosen from the offer. */
export function buildAnswer(options: {
  address: string;
  port: number;
  codec: G711Codec;
  sessionId: string;
}): string {
  const payloadType = PAYLOAD_TYPES[options.codec];
  return [
    'v=0',
    `o=callisto ${options.sessionId} ${options.sessionId} IN IP4 ${options.address}`,
    's=Callisto',
    `c=IN IP4 ${options.address}`,
    't=0 0',
    `m=audio ${options.port} RTP/AVP ${payloadType}`,
    `a=rtpmap:${payloadType} ${options.codec}/8000`,
    'a=ptime:20',
    'a=sendrecv',
    '',
  ].join('\r\n');
}
