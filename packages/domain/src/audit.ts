import { z } from 'zod';
import { IdSchema, TimestampSchema } from './common';

/** One line of the audit log: who changed or looked at what, and when. */
export const AuditEntrySchema = z.object({
  id: IdSchema,
  practiceId: IdSchema,
  at: TimestampSchema,
  actorId: IdSchema,
  actorName: z.string(),
  /** Machine-readable, `<entity>.<verb>`, e.g. `closure.created`. */
  action: z.string(),
  /** Id of the affected entity, if the action has one. */
  targetId: z.string().optional(),
  /** Human-readable description in German, shown in the audit view. */
  summary: z.string(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;
