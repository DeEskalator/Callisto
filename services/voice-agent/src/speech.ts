import { PollyClient, SynthesizeSpeechCommand, type VoiceId } from '@aws-sdk/client-polly';
import type { SampleRate } from './model';

/** Turns a fixed text into speech: 16 bit mono PCM at the given sample rate. */
export interface SpeechSynthesizer {
  synthesize(text: string, sampleRate: SampleRate): Promise<Buffer>;
}

/**
 * Speaks the announcements that must be worded exactly (greeting with the AI notice, the
 * out-of-hours text, the emergency sentence). The free dialogue comes from the model; these
 * sentences do not, so their wording never depends on it.
 */
export class PollySpeechSynthesizer implements SpeechSynthesizer {
  private readonly cache = new Map<string, Buffer>();

  constructor(
    private readonly client: PollyClient = new PollyClient({}),
    private readonly voiceId: VoiceId = 'Vicki',
  ) {}

  async synthesize(text: string, sampleRate: SampleRate): Promise<Buffer> {
    const key = `${sampleRate}:${text}`;
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }
    const response = await this.client.send(
      new SynthesizeSpeechCommand({
        Text: text,
        VoiceId: this.voiceId,
        LanguageCode: 'de-DE',
        Engine: 'neural',
        OutputFormat: 'pcm',
        SampleRate: String(sampleRate),
      }),
    );
    const audio = Buffer.from((await response.AudioStream?.transformToByteArray()) ?? []);
    // The same few announcements are spoken on every call.
    this.cache.set(key, audio);
    return audio;
  }
}
