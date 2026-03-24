import { randomUUID } from 'node:crypto';
import {
  BedrockRuntimeClient,
  InvokeModelWithBidirectionalStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { NodeHttp2Handler } from '@smithy/node-http-handler';
import type { ConversationModel, ModelConfig, ModelEvents, ModelSession } from './model';

export interface NovaSonicOptions {
  /** Region in which the model is called; in Europe Nova Sonic is offered in Stockholm only. */
  region: string;
  modelId: string;
  /** One of the model's German voices. */
  voiceId: string;
}

export const NOVA_SONIC_DEFAULTS: NovaSonicOptions = {
  region: 'eu-north-1',
  modelId: 'amazon.nova-2-sonic-v1:0',
  voiceId: 'tina',
};

const audioFormat = (sampleRate: number) => ({
  mediaType: 'audio/lpcm',
  sampleRateHertz: sampleRate,
  sampleSizeBits: 16,
  channelCount: 1,
  audioType: 'SPEECH',
  encoding: 'base64',
});

/** An async queue: the request body of the bidirectional stream is fed from it. */
class EventQueue {
  private readonly pending: Array<Record<string, unknown>> = [];
  private wake: (() => void) | undefined;
  private closed = false;

  push(event: Record<string, unknown>): void {
    if (!this.closed) {
      this.pending.push(event);
      this.wake?.();
    }
  }

  close(): void {
    this.closed = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      const event = this.pending.shift();
      if (event) {
        yield { chunk: { bytes: new TextEncoder().encode(JSON.stringify({ event })) } };
      } else if (this.closed) {
        return;
      } else {
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
      }
    }
  }
}

interface OutputContent {
  type: 'TEXT' | 'AUDIO' | 'TOOL';
  role: string;
  /** For text: whether it is the model's plan (SPECULATIVE) or what was actually said (FINAL). */
  stage?: string;
}

/**
 * Amazon Nova Sonic over Bedrock's bidirectional streaming API: one HTTP/2 stream per
 * conversation, audio and events in both directions. The event protocol is documented in the
 * Nova user guide ("Handling input/output events with the bidirectional API").
 */
export class NovaSonicModel implements ConversationModel {
  private readonly client: BedrockRuntimeClient;

  constructor(private readonly options: NovaSonicOptions = NOVA_SONIC_DEFAULTS) {
    this.client = new BedrockRuntimeClient({
      region: options.region,
      requestHandler: new NodeHttp2Handler({
        requestTimeout: 600_000,
        sessionTimeout: 600_000,
        disableConcurrentStreams: false,
        maxConcurrentStreams: 20,
      }),
    });
  }

  async start(config: ModelConfig, events: ModelEvents): Promise<ModelSession> {
    const queue = new EventQueue();
    const promptName = randomUUID();
    const audioName = randomUUID();
    let closed = false;

    const sendText = (
      role: 'SYSTEM' | 'ASSISTANT' | 'USER',
      content: string,
      interactive: boolean,
    ) => {
      const contentName = randomUUID();
      queue.push({
        contentStart: {
          promptName,
          contentName,
          type: 'TEXT',
          interactive,
          role,
          textInputConfiguration: { mediaType: 'text/plain' },
        },
      });
      queue.push({ textInput: { promptName, contentName, content } });
      queue.push({ contentEnd: { promptName, contentName } });
    };

    queue.push({
      sessionStart: {
        inferenceConfiguration: { maxTokens: 1024, topP: 0.9, temperature: 0.4 },
        turnDetectionConfiguration: { endpointingSensitivity: 'MEDIUM' },
      },
    });
    queue.push({
      promptStart: {
        promptName,
        textOutputConfiguration: { mediaType: 'text/plain' },
        audioOutputConfiguration: {
          ...audioFormat(config.sampleRate),
          voiceId: this.options.voiceId,
        },
        toolUseOutputConfiguration: { mediaType: 'application/json' },
        toolConfiguration: {
          tools: config.tools.map((tool) => ({
            toolSpec: {
              name: tool.name,
              description: tool.description,
              inputSchema: { json: JSON.stringify(tool.inputSchema) },
            },
          })),
        },
      },
    });
    // The greeting the caller has already heard is part of the system prompt, not of the chat
    // history: Nova Sonic rejects a history that starts with the assistant.
    sendText('SYSTEM', config.systemPrompt, false);
    // The audio content stays open for the whole conversation, also when the caller types:
    // typed text is "cross-modal input" into a voice session.
    queue.push({
      contentStart: {
        promptName,
        contentName: audioName,
        type: 'AUDIO',
        interactive: true,
        role: 'USER',
        audioInputConfiguration: audioFormat(config.sampleRate),
      },
    });
    const sendAudio = (pcm: Buffer) =>
      queue.push({
        audioInput: { promptName, contentName: audioName, content: pcm.toString('base64') },
      });
    // A caller who types sends no audio; silence keeps the stream alive at the usual cadence:
    // 32 ms frames, the size the model expects audio to arrive in.
    const SILENCE = Buffer.alloc((config.sampleRate * 2 * 32) / 1000);
    const silence = config.audio ? undefined : setInterval(() => sendAudio(SILENCE), 32);

    const response = await this.client.send(
      new InvokeModelWithBidirectionalStreamCommand({ modelId: this.options.modelId, body: queue }),
    );

    void (async () => {
      const contents = new Map<string, OutputContent>();
      const toolUses = new Map<string, { id: string; name: string; input: string }>();
      try {
        for await (const part of response.body ?? []) {
          const bytes = part.chunk?.bytes;
          if (!bytes) {
            continue;
          }
          const event = JSON.parse(new TextDecoder().decode(bytes)).event ?? {};
          if (event.contentStart) {
            const start = event.contentStart;
            const fields = start.additionalModelFields
              ? JSON.parse(start.additionalModelFields)
              : {};
            contents.set(start.contentId, {
              type: start.type,
              role: start.role,
              stage: fields.generationStage,
            });
          } else if (event.textOutput) {
            const content = contents.get(event.textOutput.contentId);
            const text: string = event.textOutput.content ?? '';
            if (text.includes('"interrupted"')) {
              events.onInterrupted();
            } else if (content?.role === 'USER') {
              events.onCallerText(text);
            } else if (content?.role === 'ASSISTANT' && content.stage === 'FINAL') {
              events.onAssistantText(text);
            }
          } else if (event.audioOutput) {
            events.onAudio(Buffer.from(event.audioOutput.content, 'base64'));
          } else if (event.toolUse) {
            const use = event.toolUse;
            toolUses.set(use.contentId, {
              id: use.toolUseId,
              name: use.toolName,
              input: use.content,
            });
          } else if (event.contentEnd) {
            const end = event.contentEnd;
            if (end.stopReason === 'INTERRUPTED') {
              events.onInterrupted();
            }
            const use = toolUses.get(end.contentId);
            if (end.type === 'TOOL' && use) {
              toolUses.delete(end.contentId);
              events.onToolUse({
                id: use.id,
                name: use.name,
                input: use.input ? JSON.parse(use.input) : {},
              });
            }
            contents.delete(end.contentId);
          }
        }
        if (!closed) {
          events.onClosed();
        }
      } catch (error) {
        if (!closed) {
          events.onClosed(error instanceof Error ? error : new Error(String(error)));
        }
      } finally {
        clearInterval(silence);
      }
    })();

    return {
      sendAudio,
      sendText: (text) => sendText('USER', text, true),
      sendToolResult: (toolUseId, result) => {
        const contentName = randomUUID();
        queue.push({
          contentStart: {
            promptName,
            contentName,
            interactive: false,
            type: 'TOOL',
            role: 'TOOL',
            toolResultInputConfiguration: {
              toolUseId,
              type: 'TEXT',
              textInputConfiguration: { mediaType: 'text/plain' },
            },
          },
        });
        queue.push({ toolResult: { promptName, contentName, content: JSON.stringify(result) } });
        queue.push({ contentEnd: { promptName, contentName } });
      },
      close: async () => {
        if (closed) {
          return;
        }
        closed = true;
        clearInterval(silence);
        queue.push({ contentEnd: { promptName, contentName: audioName } });
        queue.push({ promptEnd: { promptName } });
        queue.push({ sessionEnd: {} });
        queue.close();
      },
    };
  }
}
