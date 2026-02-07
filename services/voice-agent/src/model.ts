/** A function the model can call, described the way Bedrock expects it. */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema of the arguments. */
  inputSchema: Record<string, unknown>;
}

export interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ModelConfig {
  systemPrompt: string;
  tools: ToolSpec[];
  /** What the assistant has already said before the model takes over (the greeting). */
  spokenSoFar: string;
  /** Whether the caller speaks (audio in and out) or types (text only). */
  audio: boolean;
}

/** What a model reports while a conversation runs. */
export interface ModelEvents {
  /** What the caller said, as the model understood it. */
  onCallerText(text: string): void;
  /** What the assistant said. */
  onAssistantText(text: string): void;
  /** Speech of the assistant: 16 kHz, 16 bit, mono PCM. */
  onAudio(pcm: Buffer): void;
  /** The caller started talking over the assistant; audio not yet played is to be dropped. */
  onInterrupted(): void;
  onToolUse(use: ToolUse): void;
  /** The model's side of the conversation ended, expectedly or not. */
  onClosed(error?: Error): void;
}

/** One running conversation with a model. */
export interface ModelSession {
  /** Speech of the caller: 16 kHz, 16 bit, mono PCM. */
  sendAudio(pcm: Buffer): void;
  /** Something the caller typed instead of saying it. */
  sendText(text: string): void;
  sendToolResult(toolUseId: string, result: unknown): void;
  close(): Promise<void>;
}

/**
 * The language model behind a conversation. The session logic only knows this interface, so the
 * same code runs against Nova Sonic on Bedrock and against the scripted stand-in used for local
 * development and tests.
 */
export interface ConversationModel {
  start(config: ModelConfig, events: ModelEvents): Promise<ModelSession>;
}
