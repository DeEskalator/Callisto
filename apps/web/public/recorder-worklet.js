// Runs on the audio thread: collects the microphone signal into chunks of about 32 ms and
// hands them to the page as 16 bit samples.
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
