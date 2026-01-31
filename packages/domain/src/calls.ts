import { z } from 'zod';
import { IdSchema, LocalDateSchema, LocalTimeSchema, TimestampSchema } from './common';
import { OpeningModeSchema } from './practice';

// ── Anrufe ───────────────────────────────────────────────────────────────────

/** How the conversation reached the assistant; the two test channels come from the web app. */
export const CallChannelSchema = z.enum(['phone', 'test_voice', 'test_text']);
export type CallChannel = z.infer<typeof CallChannelSchema>;

export const CallStatusSchema = z.enum([
  'in_progress',
  'completed',
  'transferred',
  'emergency',
  'abandoned',
  'failed',
]);
export type CallStatus = z.infer<typeof CallStatusSchema>;

export const CallSchema = z.object({
  id: IdSchema,
  practiceId: IdSchema,
  channel: CallChannelSchema,
  status: CallStatusSchema,
  /** Calendar day of the start in the practice's time zone; calls are listed by it. */
  date: LocalDateSchema,
  startedAt: TimestampSchema,
  endedAt: TimestampSchema.optional(),
  /** Caller id as delivered by the phone network; missing if suppressed. */
  callerNumber: z.string().max(32).optional(),
  /** Opening mode and preset that applied when the call started. */
  openingMode: OpeningModeSchema,
  presetId: IdSchema,
  /** Short summary written after the call. */
  summary: z.string().max(2000).optional(),
  inquiryIds: z.array(IdSchema),
});
export type Call = z.infer<typeof CallSchema>;

export const TranscriptTurnSchema = z.object({
  /** Position within the call, starting at 1. */
  seq: z.number().int().min(1),
  role: z.enum(['caller', 'assistant']),
  text: z.string(),
  at: TimestampSchema,
});
export type TranscriptTurn = z.infer<typeof TranscriptTurnSchema>;

// ── Anliegen ─────────────────────────────────────────────────────────────────

/**
 * Patient data as the caller stated it on the phone. It is unverified; the practice matches it
 * against its own records.
 */
export const PatientSchema = z.object({
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  dateOfBirth: LocalDateSchema.optional(),
  phone: z.string().trim().max(32).optional(),
});
export type Patient = z.infer<typeof PatientSchema>;

export const InquiryStatusSchema = z.enum(['new', 'in_progress', 'done', 'cancelled']);
export type InquiryStatus = z.infer<typeof InquiryStatusSchema>;

export const AppointmentDetailsSchema = z.object({
  type: z.literal('appointment'),
  slotId: IdSchema,
  categoryId: IdSchema,
  categoryName: z.string(),
  date: LocalDateSchema,
  startTime: LocalTimeSchema,
  endTime: LocalTimeSchema,
  reason: z.string().trim().max(500).optional(),
});

export const PrescriptionDetailsSchema = z.object({
  type: z.literal('prescription'),
  medications: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(160),
        strength: z.string().trim().max(80).optional(),
        packageSize: z.string().trim().max(80).optional(),
      }),
    )
    .min(1)
    .max(10),
  note: z.string().trim().max(500).optional(),
});

export const CallbackDetailsSchema = z.object({
  type: z.literal('callback'),
  topic: z.string().trim().min(1).max(1000),
  preferredTime: z.string().trim().max(200).optional(),
});

export const OtherDetailsSchema = z.object({
  type: z.literal('other'),
  summary: z.string().trim().min(1).max(1000),
  /** Whether the caller was put through to the practice after stating the concern. */
  transferred: z.boolean(),
});

export const InquiryDetailsSchema = z.discriminatedUnion('type', [
  AppointmentDetailsSchema,
  PrescriptionDetailsSchema,
  CallbackDetailsSchema,
  OtherDetailsSchema,
]);
export type InquiryDetails = z.infer<typeof InquiryDetailsSchema>;
export type InquiryType = InquiryDetails['type'];

/** A concern a caller left with the assistant ("Anliegen") that the practice has to act on. */
export const InquirySchema = z.object({
  id: IdSchema,
  practiceId: IdSchema,
  status: InquiryStatusSchema,
  /** Calendar day of creation in the practice's time zone. */
  date: LocalDateSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  /** The call the inquiry came from; inquiries entered by staff have none. */
  callId: IdSchema.optional(),
  patient: PatientSchema,
  details: InquiryDetailsSchema,
  /** Internal remark of the practice team. */
  note: z.string().trim().max(2000).optional(),
  /** Created in test mode; kept out of the daily overview. */
  test: z.boolean(),
});
export type Inquiry = z.infer<typeof InquirySchema>;
