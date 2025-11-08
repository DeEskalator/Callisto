/**
 * Calendar and wall-clock helpers for the practice's time zone.
 *
 * Opening hours, closures and slots are defined in local time ("Monday 08:00"), calls happen at
 * instants. Everything that crosses that boundary goes through `toZoned` / `fromZoned`, so daylight
 * saving time is handled in exactly one place. Intl is used instead of Temporal because the Lambda
 * runtime does not ship Temporal yet.
 */

/** Calendar date in the practice's time zone, `YYYY-MM-DD`. */
export type LocalDate = string;
/** Wall-clock time in the practice's time zone, `HH:mm` in 24h notation. */
export type LocalTime = string;

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const MINUTES_PER_DAY = 24 * 60;

export function minutesOf(time: LocalTime): number {
  const [hours, minutes] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

export function timeOf(minutes: number): LocalTime {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function dateParts(date: LocalDate): [year: number, month: number, day: number] {
  const [year, month, day] = date.split('-');
  return [Number(year), Number(month), Number(day)];
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const [year, month, day] = dateParts(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function weekdayOf(date: LocalDate): Weekday {
  const [year, month, day] = dateParts(date);
  // getUTCDay() counts from Sunday, WEEKDAYS from Monday.
  const index = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  return WEEKDAYS[index] as Weekday;
}

/** All dates from `from` to `to`, both inclusive. */
export function eachDate(from: LocalDate, to: LocalDate): LocalDate[] {
  const dates: LocalDate[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

export interface ZonedDateTime {
  date: LocalDate;
  time: LocalTime;
  weekday: Weekday;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function wallClockParts(instant: Date, timeZone: string): Record<string, string> {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) {
    parts[part.type] = part.value;
  }
  return parts;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock date and time an instant has in `timeZone`. */
export function toZoned(instant: Date, timeZone: string): ZonedDateTime {
  const parts = wallClockParts(instant, timeZone);
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, time: `${parts.hour}:${parts.minute}`, weekday: weekdayOf(date) };
}

function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = wallClockParts(instant, timeZone);
  const wallClockAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((wallClockAsUtc - instant.getTime()) / 60_000);
}

/** The instant at which the wall clock in `timeZone` shows `date` and `time`. */
export function fromZoned(date: LocalDate, time: LocalTime, timeZone: string): Date {
  const [year, month, day] = dateParts(date);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, 0, minutesOf(time));
  const guess = wallClockAsUtc - offsetMinutes(new Date(wallClockAsUtc), timeZone) * 60_000;
  // Around a DST change the offset at the guess differs from the one used to compute it; the
  // second pass settles on the right one.
  return new Date(wallClockAsUtc - offsetMinutes(new Date(guess), timeZone) * 60_000);
}
