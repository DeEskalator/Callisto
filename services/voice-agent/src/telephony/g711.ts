/**
 * G.711, the codec of the telephone network: 8 kHz, one byte per sample, μ-law (PCMU) or A-law
 * (PCMA). Europe uses A-law, but Voice Connectors offer both. Follows the reference
 * implementation (g711.c by Sun Microsystems), which every phone system agrees with.
 */

export type G711Codec = 'PCMU' | 'PCMA';

const SIGN_BIT = 0x80;
const QUANT_MASK = 0x0f;
const SEG_SHIFT = 4;
const SEG_MASK = 0x70;
const BIAS = 0x84;
const CLIP = 8159;
const SEG_A_END = [0x1f, 0x3f, 0x7f, 0xff, 0x1ff, 0x3ff, 0x7ff, 0xfff];
const SEG_U_END = [0x3f, 0x7f, 0xff, 0x1ff, 0x3ff, 0x7ff, 0xfff, 0x1fff];

function segment(value: number, table: number[]): number {
  for (let index = 0; index < table.length; index++) {
    if (value <= (table[index] as number)) {
      return index;
    }
  }
  return table.length;
}

function linearToUlaw(sample: number): number {
  let value = sample >> 2;
  let mask = 0xff;
  if (value < 0) {
    value = -value;
    mask = 0x7f;
  }
  value = Math.min(value, CLIP) + (BIAS >> 2);
  const seg = segment(value, SEG_U_END);
  if (seg >= 8) {
    return 0x7f ^ mask;
  }
  return ((seg << 4) | ((value >> (seg + 1)) & QUANT_MASK)) ^ mask;
}

function ulawToLinear(byte: number): number {
  const value = ~byte & 0xff;
  let t = ((value & QUANT_MASK) << 3) + BIAS;
  t <<= (value & SEG_MASK) >> SEG_SHIFT;
  return value & SIGN_BIT ? BIAS - t : t - BIAS;
}

function linearToAlaw(sample: number): number {
  let value = sample >> 3;
  let mask = 0xd5;
  if (value < 0) {
    mask = 0x55;
    value = -value - 1;
  }
  const seg = segment(value, SEG_A_END);
  if (seg >= 8) {
    return 0x7f ^ mask;
  }
  let encoded = seg << SEG_SHIFT;
  encoded |= seg < 2 ? (value >> 1) & QUANT_MASK : (value >> seg) & QUANT_MASK;
  return encoded ^ mask;
}

function alawToLinear(byte: number): number {
  const value = byte ^ 0x55;
  let t = (value & QUANT_MASK) << 4;
  const seg = (value & SEG_MASK) >> SEG_SHIFT;
  if (seg === 0) {
    t += 8;
  } else if (seg === 1) {
    t += 0x108;
  } else {
    t = (t + 0x108) << (seg - 1);
  }
  return value & SIGN_BIT ? t : -t;
}

// Decoding is a table lookup; there are only 256 possible bytes.
const DECODE: Record<G711Codec, Int16Array> = {
  PCMU: Int16Array.from({ length: 256 }, (_, byte) => ulawToLinear(byte)),
  PCMA: Int16Array.from({ length: 256 }, (_, byte) => alawToLinear(byte)),
};

/** G.711 bytes to 16 bit little-endian PCM. */
export function decodeG711(payload: Buffer, codec: G711Codec): Buffer {
  const table = DECODE[codec];
  const pcm = Buffer.alloc(payload.length * 2);
  for (let index = 0; index < payload.length; index++) {
    pcm.writeInt16LE(table[payload[index] as number] as number, index * 2);
  }
  return pcm;
}

/** 16 bit little-endian PCM to G.711 bytes. */
export function encodeG711(pcm: Buffer, codec: G711Codec): Buffer {
  const encode = codec === 'PCMU' ? linearToUlaw : linearToAlaw;
  const payload = Buffer.alloc(pcm.length >> 1);
  for (let index = 0; index < payload.length; index++) {
    payload[index] = encode(pcm.readInt16LE(index * 2));
  }
  return payload;
}
