import { z } from 'zod';
import { WEEKDAYS } from './time';

export const LocalDateSchema = z.iso.date();
export const LocalTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Uhrzeit im Format HH:mm erwartet');
export const WeekdaySchema = z.enum(WEEKDAYS);
export const TimestampSchema = z.iso.datetime();

/** Identifier that is safe in URLs and DynamoDB keys. */
export const IdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/);

export const PhoneNumberSchema = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, 'Rufnummer im Format +4930123456 erwartet');

export const TimeRangeSchema = z
  .object({ from: LocalTimeSchema, to: LocalTimeSchema })
  .refine((range) => range.from < range.to, { error: 'Beginn muss vor dem Ende liegen' });
export type TimeRange = z.infer<typeof TimeRangeSchema>;

export function newId(): string {
  return crypto.randomUUID();
}
