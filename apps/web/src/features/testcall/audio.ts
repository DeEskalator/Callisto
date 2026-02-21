/** Audio format of a test conversation, both ways: 16 kHz, 16 bit, mono PCM. */
const SAMPLE_RATE = 16_000;

// Runs on the audio thread: collects the microphone signal into chunks of about 32 ms and
// hands them to the page as 16 bit samples.
const RECORDER_WORKLET = `
class Recorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(512);
    this.filled = 0;
  }
  process(inputs) {
    const channel = inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        const sample = Math.max(-1, Math.min(1, channel[i]));
        this.buffer[this.filled++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        if (this.filled === this.buffer.length) {
          this.port.postMessage(this.buffer.slice().buffer);
          this.filled = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('recorder', Recorder);
`;

/**
 * Captures the microphone and delivers it in the format the assistant expects.
 * @returns a function that stops the capture and releases the microphone
 */
export async function startMicrophone(onChunk: (pcm: ArrayBuffer) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  // Asking for 16 kHz makes the browser resample the microphone for us.
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  const module = URL.createObjectURL(new Blob([RECORDER_WORKLET], { type: 'text/javascript' }));
  await context.audioWorklet.addModule(module);
  URL.revokeObjectURL(module);

  const source = context.createMediaStreamSource(stream);
  const recorder = new AudioWorkletNode(context, 'recorder');
  recorder.port.onmessage = (event) => onChunk(event.data);
  source.connect(recorder);

  return () => {
    source.disconnect();
    for (const track of stream.getTracks()) {
      track.stop();
    }
    void context.close();
  };
}

/** Plays the assistant's speech as it arrives, chunk after chunk without gaps. */
export class Speaker {
  private readonly context = new AudioContext({ sampleRate: SAMPLE_RATE });
  private readonly playing = new Set<AudioBufferSourceNode>();
  private nextStart = 0;

  play(pcm: ArrayBuffer): void {
    const samples = new Int16Array(pcm);
    if (samples.length === 0) {
      return;
    }
    const buffer = this.context.createBuffer(1, samples.length, SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      channel[i] = (samples[i] ?? 0) / 0x8000;
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    // Each chunk starts where the previous one ends.
    this.nextStart = Math.max(this.nextStart, this.context.currentTime + 0.02);
    source.start(this.nextStart);
    this.nextStart += buffer.duration;
    this.playing.add(source);
    source.onended = () => this.playing.delete(source);
  }

  /** Drops everything that has not been played yet: the caller interrupted the assistant. */
  clear(): void {
    for (const source of this.playing) {
      source.stop();
    }
    this.playing.clear();
    this.nextStart = 0;
  }

  close(): void {
    this.clear();
    void this.context.close();
  }
}
