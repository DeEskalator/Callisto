import { z } from 'zod';
import {
  IdSchema,
  LocalDateSchema,
  LocalTimeSchema,
  PhoneNumberSchema,
  TimeRangeSchema,
  WeekdaySchema,
} from './common';
import { FEDERAL_STATES } from './holidays';
import { isValidTimeZone } from './time';

// ── Sprechzeiten ─────────────────────────────────────────────────────────────

// The editor works in half hours, and so do practices; a finer value could not be shown there.
const isHalfHour = (time: string) => time.endsWith(':00') || time.endsWith(':30');

const DayRangesSchema = z
  .array(TimeRangeSchema)
  .max(6, 'Höchstens sechs Zeiträume pro Tag')
  .superRefine((ranges, ctx) => {
    if (ranges.some((range) => !isHalfHour(range.from) || !isHalfHour(range.to))) {
      ctx.addIssue({
        code: 'custom',
        message: 'Sprechzeiten beginnen und enden zur vollen oder halben Stunde',
        input: ranges,
      });
    }
    const sorted = [...ranges].sort((left, right) => left.from.localeCompare(right.from));
    for (let index = 1; index < sorted.length; index++) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      if (previous && current && current.from < previous.to) {
        ctx.addIssue({
          code: 'custom',
          message: 'Zeiträume dürfen sich nicht überschneiden',
          input: ranges,
        });
      }
    }
  });

/** Weekly opening hours; every weekday is present, closed days have an empty list. */
export const OpeningHoursSchema = z.record(WeekdaySchema, DayRangesSchema);
export type OpeningHours = z.infer<typeof OpeningHoursSchema>;

// ── Urlaub und Schließzeiten ─────────────────────────────────────────────────

const closureShape = {
  title: z.string().trim().min(1).max(120),
  /** First and last day of the closure, both inclusive. */
  from: LocalDateSchema,
  to: LocalDateSchema,
  /** `false` closes only between `fromTime` and `toTime` on each day of the range. */
  allDay: z.boolean(),
  fromTime: LocalTimeSchema.optional(),
  toTime: LocalTimeSchema.optional(),
  /** Announcement to use instead of the practice's default vacation preset. */
  presetId: IdSchema.optional(),
  note: z.string().trim().max(500).optional(),
};

interface ClosurePeriod {
  from: string;
  to: string;
  allDay: boolean;
  fromTime?: string | undefined;
  toTime?: string | undefined;
}

// Rules that span several fields. They are applied to both schemas below because Zod does not
// allow extending an object schema once it carries refinements.
function closureIssues(closure: ClosurePeriod): Array<{ message: string; path: string[] }> {
  const issues: Array<{ message: string; path: string[] }> = [];
  if (closure.to < closure.from) {
    issues.push({ message: 'Das Ende darf nicht vor dem Beginn liegen', path: ['to'] });
  }
  if (!closure.allDay) {
    if (!closure.fromTime || !closure.toTime) {
      issues.push({
        message: 'Für eine stundenweise Schließung werden Beginn und Ende benötigt',
        path: ['fromTime'],
      });
    } else if (closure.fromTime >= closure.toTime) {
      issues.push({ message: 'Beginn muss vor dem Ende liegen', path: ['toTime'] });
    }
  }
  return issues;
}

export const ClosureInputSchema = z.object(closureShape).superRefine((closure, ctx) => {
  for (const issue of closureIssues(closure)) {
    ctx.addIssue({ code: 'custom', input: closure, ...issue });
  }
});
export const ClosureSchema = z
  .object({ id: IdSchema, ...closureShape })
  .superRefine((closure, ctx) => {
    for (const issue of closureIssues(closure)) {
      ctx.addIssue({ code: 'custom', input: closure, ...issue });
    }
  });
export type ClosureInput = z.infer<typeof ClosureInputSchema>;
export type Closure = z.infer<typeof ClosureSchema>;

// ── Ansage-Presets ───────────────────────────────────────────────────────────

/** What the assistant may do for a caller while a preset is active. */
export const PresetCapabilitiesSchema = z.object({
  appointments: z.boolean(),
  prescriptions: z.boolean(),
  callbacks: z.boolean(),
  transfer: z.boolean(),
});
export type PresetCapabilities = z.infer<typeof PresetCapabilitiesSchema>;

export const AnnouncementPresetInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** Spoken verbatim after the greeting; empty means no extra announcement. */
  announcement: z.string().trim().max(1200),
  capabilities: PresetCapabilitiesSchema,
});
export const AnnouncementPresetSchema = AnnouncementPresetInputSchema.extend({ id: IdSchema });
export type AnnouncementPresetInput = z.infer<typeof AnnouncementPresetInputSchema>;
export type AnnouncementPreset = z.infer<typeof AnnouncementPresetSchema>;

// ── Praxiseinstellungen ──────────────────────────────────────────────────────

export const OPENING_MODES = ['open', 'closed', 'holiday', 'vacation'] as const;
export const OpeningModeSchema = z.enum(OPENING_MODES);
export type OpeningMode = z.infer<typeof OpeningModeSchema>;

export const PracticeSettingsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  timeZone: z.string().refine(isValidTimeZone, { error: 'Unbekannte Zeitzone' }),
  federalState: z.enum(FEDERAL_STATES),
  /** Line the assistant transfers callers to. Must not be the number that is forwarded to it. */
  transferNumber: PhoneNumberSchema.optional(),
  /** First sentence of every call; has to tell the caller that an AI assistant is speaking. */
  greeting: z.string().trim().min(1).max(600),
  /** Which preset applies in which opening mode; a closure can override the vacation preset. */
  presetAssignments: z.record(OpeningModeSchema, IdSchema),
  /** How many days ahead appointments can be booked. */
  bookingHorizonDays: z.number().int().min(1).max(365),
  /** Slots starting sooner than this many minutes from now are not offered. */
  bookingLeadMinutes: z
    .number()
    .int()
    .min(0)
    .max(14 * 24 * 60),
  retention: z.object({
    transcriptDays: z.number().int().min(1).max(3650),
    inquiryDays: z.number().int().min(1).max(3650),
  }),
});
export type PracticeSettings = z.infer<typeof PracticeSettingsSchema>;
