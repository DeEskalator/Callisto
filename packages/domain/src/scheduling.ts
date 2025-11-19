import { z } from 'zod';
import {
  IdSchema,
  LocalDateSchema,
  LocalTimeSchema,
  TimestampSchema,
  WeekdaySchema,
} from './common';

// ── Terminkategorien ─────────────────────────────────────────────────────────

export const AppointmentCategoryInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** Tells the assistant which concerns belong into this category. */
  description: z.string().trim().max(600),
  durationMinutes: z.number().int().min(5).max(240),
  /** Read to the patient after booking, e.g. "Bitte kommen Sie nüchtern." */
  patientHint: z.string().trim().max(400).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  /** Inactive categories keep their history but are neither offered nor generated. */
  active: z.boolean(),
});
export const AppointmentCategorySchema = AppointmentCategoryInputSchema.extend({ id: IdSchema });
export type AppointmentCategoryInput = z.infer<typeof AppointmentCategoryInputSchema>;
export type AppointmentCategory = z.infer<typeof AppointmentCategorySchema>;

// ── Slot-Vorlagen ────────────────────────────────────────────────────────────

const slotTemplateShape = {
  name: z.string().trim().min(1).max(80),
  categoryId: IdSchema,
  weekdays: z.array(WeekdaySchema).min(1).max(7),
  from: LocalTimeSchema,
  to: LocalTimeSchema,
  /** Distance between slot starts; defaults to the category's duration. */
  intervalMinutes: z.number().int().min(5).max(240).optional(),
  /** Number of patients that can be booked at the same time. */
  capacity: z.number().int().min(1).max(10),
  validFrom: LocalDateSchema,
  validUntil: LocalDateSchema.optional(),
  active: z.boolean(),
};

interface TemplatePeriod {
  from: string;
  to: string;
  validFrom: string;
  validUntil?: string | undefined;
}

function templateIssues(template: TemplatePeriod): Array<{ message: string; path: string[] }> {
  const issues: Array<{ message: string; path: string[] }> = [];
  if (template.from >= template.to) {
    issues.push({ message: 'Beginn muss vor dem Ende liegen', path: ['to'] });
  }
  if (template.validUntil && template.validUntil < template.validFrom) {
    issues.push({ message: 'Das Ende darf nicht vor dem Beginn liegen', path: ['validUntil'] });
  }
  return issues;
}

export const SlotTemplateInputSchema = z.object(slotTemplateShape).superRefine((template, ctx) => {
  for (const issue of templateIssues(template)) {
    ctx.addIssue({ code: 'custom', input: template, ...issue });
  }
});
export const SlotTemplateSchema = z
  .object({ id: IdSchema, ...slotTemplateShape })
  .superRefine((template, ctx) => {
    for (const issue of templateIssues(template)) {
      ctx.addIssue({ code: 'custom', input: template, ...issue });
    }
  });
export type SlotTemplateInput = z.infer<typeof SlotTemplateInputSchema>;
export type SlotTemplate = z.infer<typeof SlotTemplateSchema>;

// ── Terminslots ──────────────────────────────────────────────────────────────

export const SlotStatusSchema = z.enum(['free', 'booked', 'blocked']);
export type SlotStatus = z.infer<typeof SlotStatusSchema>;

export const SlotSchema = z.object({
  /** Starts with date and time (see `slotId`), so a slot can be located from its id alone. */
  id: IdSchema,
  categoryId: IdSchema,
  date: LocalDateSchema,
  startTime: LocalTimeSchema,
  endTime: LocalTimeSchema,
  /** Start as an instant, for comparisons with "now" that are independent of the time zone. */
  startsAt: TimestampSchema,
  status: SlotStatusSchema,
  /** The inquiry that holds the booking; only set while `status` is `booked`. */
  inquiryId: IdSchema.optional(),
  /** The template the slot was generated from; manually created slots have none. */
  templateId: IdSchema.optional(),
});
export type Slot = z.infer<typeof SlotSchema>;

export const ManualSlotInputSchema = z.object({
  categoryId: IdSchema,
  date: LocalDateSchema,
  startTime: LocalTimeSchema,
});
export type ManualSlotInput = z.infer<typeof ManualSlotInputSchema>;
