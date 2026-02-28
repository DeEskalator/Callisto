/** Audio format of a test conversation, both ways: 16 kHz, 16 bit, mono PCM. */
const SAMPLE_RATE = 16_000;

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
  // The recorder runs on the audio thread and is therefore a file of its own (public/).
  await context.audioWorklet.addModule('/recorder-worklet.js');

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
