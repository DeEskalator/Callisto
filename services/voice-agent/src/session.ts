import {
  type CallStore,
  type ConfigStore,
  expiryAfterDays,
  type PracticeConfig,
  type SlotStore,
} from '@callisto/data';
import {
  type AnnouncementPreset,
  type Call,
  type CallChannel,
  type CallStatus,
  type Inquiry,
  newId,
  openingStateAt,
  toZoned,
} from '@callisto/domain';
import type { EmergencyMonitor } from './emergency';
import type { ConversationModel, ModelSession, SampleRate, ToolUse } from './model';
import {
  buildSystemPrompt,
  EMERGENCY_ANNOUNCEMENT,
  openingAnnouncement,
  TRANSFER_ANNOUNCEMENT,
} from './prompt';
import type { SpeechSynthesizer } from './speech';
import { executeTool, type ToolContext, toolSpecs } from './tools';

/** How a conversation ended, from the caller's point of view. */
export type EndReason = 'completed' | 'transferred' | 'emergency' | 'failed';

/** The caller's side of a conversation: a phone line, or the test panel in the web app. */
export interface CallerLink {
  /** A line of the conversation as text, for display. */
  transcript(role: 'caller' | 'assistant', text: string): void;
  /** Speech for the caller: 16 bit mono PCM at the session's sample rate. */
  audio(pcm: Buffer): void;
  /** The caller interrupted; speech that has not been played yet is to be dropped. */
  clearAudio(): void;
  /** The conversation is over. For `transferred` the line is handed to the practice. */
  ended(reason: EndReason): void;
}

export interface SessionDeps {
  config: ConfigStore;
  calls: CallStore;
  slots: SlotStore;
  model: ConversationModel;
  emergency: EmergencyMonitor;
  /** Speaks the fixed announcements in voice conversations; without it they are text only. */
  speech?: SpeechSynthesizer;
  now?: () => Date;
  onError?: (message: string, error: unknown) => void;
}

export interface SessionParams {
  practiceId: string;
  channel: CallChannel;
  callerNumber?: string | undefined;
  /** 8 kHz on the phone, 16 kHz in the browser (the default). */
  sampleRate?: SampleRate;
}

/** Used when the configuration points at a preset that no longer exists: say nothing, allow nothing. */
const NO_PRESET: AnnouncementPreset = {
  id: 'none',
  name: 'Ohne Ansage',
  announcement: '',
  capabilities: { appointments: false, prescriptions: false, callbacks: false, transfer: false },
};

function summarize(inquiries: Inquiry[], status: CallStatus): string {
  if (status === 'emergency') {
    return 'Notfall erkannt, auf den Notruf 112 verwiesen.';
  }
  const parts = inquiries.map((inquiry) => {
    const { details } = inquiry;
    switch (details.type) {
      case 'appointment':
        return `Termin gebucht: ${details.categoryName} am ${details.date} um ${details.startTime} Uhr`;
      case 'prescription':
        return `Rezeptwunsch: ${details.medications.map((medication) => medication.name).join(', ')}`;
      case 'callback':
        return `Rückrufbitte: ${details.topic}`;
      default:
        return `${details.transferred ? 'Verbunden' : 'Anliegen'}: ${details.summary}`;
    }
  });
  return parts.length > 0 ? `${parts.join('. ')}.` : 'Kein Anliegen aufgenommen.';
}

/**
 * One conversation between a caller and the assistant, independent of how the caller is
 * connected. It decides what applies right now (opening state, preset), speaks the fixed
 * announcements, lets the model lead the dialogue, runs the tools the model asks for, and keeps
 * the record the practice sees: the call, its transcript and the inquiries.
 */
export class ConversationSession {
  private model: ModelSession | undefined;
  private finished = false;
  private nextSeq = 1;
  private callerSpoke = false;
  private readonly inquiryIds: string[] = [];
  private readonly now: () => Date;

  private constructor(
    private readonly deps: SessionDeps,
    private readonly link: CallerLink,
    private readonly practice: PracticeConfig,
    private call: Call,
    private readonly audio: boolean,
    private readonly sampleRate: SampleRate,
  ) {
    this.now = deps.now ?? (() => new Date());
  }

  get callId(): string {
    return this.call.id;
  }

  static async start(
    params: SessionParams,
    deps: SessionDeps,
    link: CallerLink,
  ): Promise<ConversationSession> {
    const now = (deps.now ?? (() => new Date()))();
    const practice = await deps.config.load(params.practiceId);
    if (!practice) {
      throw new Error(`Practice ${params.practiceId} is not set up`);
    }
    const state = openingStateAt(now, practice);
    const preset =
      practice.presets.find((candidate) => candidate.id === state.presetId) ?? NO_PRESET;

    const call: Call = {
      id: newId(),
      practiceId: practice.practiceId,
      channel: params.channel,
      status: 'in_progress',
      date: toZoned(now, practice.settings.timeZone).date,
      startedAt: now.toISOString(),
      openingMode: state.mode,
      presetId: preset.id,
      inquiryIds: [],
      ...(params.callerNumber ? { callerNumber: params.callerNumber } : {}),
    };
    const session = new ConversationSession(
      deps,
      link,
      practice,
      call,
      params.channel !== 'test_text',
      params.sampleRate ?? 16_000,
    );
    await session.saveCall();

    // The greeting (with the notice that an AI is speaking) and the announcement of the active
    // preset are fixed texts. They are said word for word before the model gets to speak.
    const announcement = openingAnnouncement(practice, preset);
    await session.say(announcement);

    // Putting a caller through needs a number to put them through to.
    const capabilities = {
      ...preset.capabilities,
      transfer: preset.capabilities.transfer && Boolean(practice.settings.transferNumber),
    };

    const tools: ToolContext = {
      practice,
      capabilities,
      call: { id: call.id, callerNumber: call.callerNumber, test: params.channel !== 'phone' },
      calls: deps.calls,
      slots: deps.slots,
      now: session.now,
      onInquiry: (inquiryId) => {
        session.inquiryIds.push(inquiryId);
        // Saved right away, so the dashboard shows the inquiry while the call is still running.
        void session.saveCall();
      },
    };
    try {
      session.model = await deps.model.start(
        {
          systemPrompt: buildSystemPrompt(practice, state, { ...preset, capabilities }),
          tools: toolSpecs(capabilities),
          spokenSoFar: announcement,
          audio: session.audio,
          sampleRate: session.sampleRate,
        },
        {
          onCallerText: (text) => session.callerSaid(text),
          onAssistantText: (text) => session.record('assistant', text),
          onAudio: (pcm) => link.audio(pcm),
          onInterrupted: () => link.clearAudio(),
          onToolUse: (use) => void session.runTool(use, tools),
          onClosed: (error) => {
            if (error) {
              session.report('The model ended the conversation with an error', error);
            }
            void session.finish(error ? 'failed' : 'completed');
          },
        },
      );
    } catch (error) {
      // The call is already on record and the caller has heard the greeting: close both.
      await session.finish('failed');
      throw error;
    }
    return session;
  }

  /** Speech of the caller: 16 bit mono PCM at the session's sample rate. */
  receiveAudio(pcm: Buffer): void {
    if (!this.finished) {
      this.model?.sendAudio(pcm);
    }
  }

  /** Something the caller typed. */
  receiveText(text: string): void {
    if (this.finished || !text.trim()) {
      return;
    }
    this.callerSaid(text.trim());
    this.model?.sendText(text.trim());
  }

  /** The caller hung up. */
  async hangUp(): Promise<void> {
    await this.finish('completed');
  }

  private callerSaid(text: string): void {
    this.callerSpoke = true;
    this.record('caller', text);
    void this.deps.emergency
      .isEmergency(text)
      .then((emergency) => {
        if (emergency) {
          return this.declareEmergency();
        }
      })
      .catch((error) => this.report('The emergency check failed', error));
  }

  private async runTool(use: ToolUse, context: ToolContext): Promise<void> {
    if (this.finished) {
      return;
    }
    try {
      const outcome = await executeTool(use.name, use.input, context);
      switch (outcome.effect) {
        case 'emergency':
          return await this.declareEmergency();
        case 'transfer':
          await this.say(TRANSFER_ANNOUNCEMENT);
          return await this.finish('transferred');
        case 'hangup':
          return await this.finish('completed');
        default:
          this.model?.sendToolResult(use.id, outcome.result);
      }
    } catch (error) {
      this.report(`Tool ${use.name} failed`, error);
      this.model?.sendToolResult(use.id, {
        ok: false,
        message:
          'Das hat technisch nicht geklappt. Biete an, mit der Praxis zu verbinden oder einen Rückruf zu notieren.',
      });
    }
  }

  /** Both the model's emergency tool and the independent monitor end up here. */
  private async declareEmergency(): Promise<void> {
    if (this.finished) {
      return;
    }
    this.link.clearAudio();
    await this.say(EMERGENCY_ANNOUNCEMENT);
    await this.finish('emergency');
  }

  /** Says a fixed text word for word. */
  private async say(text: string): Promise<void> {
    if (!text) {
      return;
    }
    this.record('assistant', text);
    if (this.audio && this.deps.speech) {
      try {
        this.link.audio(await this.deps.speech.synthesize(text, this.sampleRate));
      } catch (error) {
        this.report('Speech synthesis failed', error);
      }
    }
  }

  private record(role: 'caller' | 'assistant', text: string): void {
    if (!text.trim()) {
      return;
    }
    this.link.transcript(role, text);
    const at = this.now();
    const turn = { seq: this.nextSeq++, role, text, at: at.toISOString() };
    const keepDays = this.practice.settings.retention.transcriptDays;
    this.deps.calls
      .appendTurn(this.call.id, turn, expiryAfterDays(keepDays, at))
      .catch((error) => this.report('A transcript line could not be stored', error));
  }

  private async finish(reason: EndReason): Promise<void> {
    if (this.finished) {
      return;
    }
    this.finished = true;
    const status: CallStatus =
      reason === 'completed' && !this.callerSpoke && this.inquiryIds.length === 0
        ? 'abandoned'
        : reason;
    try {
      await this.model?.close();
    } catch (error) {
      this.report('The model session did not close cleanly', error);
    }
    const inquiries = (
      await Promise.all(this.inquiryIds.map((id) => this.deps.calls.getInquiry(id)))
    ).filter((inquiry) => inquiry !== undefined);
    this.call = {
      ...this.call,
      status,
      endedAt: this.now().toISOString(),
      summary: summarize(inquiries, status),
    };
    await this.saveCall();
    this.link.ended(reason);
  }

  private async saveCall(): Promise<void> {
    const keepDays = this.practice.settings.retention.transcriptDays;
    try {
      await this.deps.calls.putCall(
        { ...this.call, inquiryIds: [...this.inquiryIds] },
        expiryAfterDays(keepDays, this.now()),
      );
    } catch (error) {
      this.report('The call could not be stored', error);
    }
  }

  private report(message: string, error: unknown): void {
    this.deps.onError?.(message, error);
  }
}
