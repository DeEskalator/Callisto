import type { LocalDate, Weekday } from '@callisto/domain';

export const WEEKDAY_NAMES: Record<Weekday, string> = {
  mon: 'Montag',
  tue: 'Dienstag',
  wed: 'Mittwoch',
  thu: 'Donnerstag',
  fri: 'Freitag',
  sat: 'Samstag',
  sun: 'Sonntag',
};

export const WEEKDAY_SHORT: Record<Weekday, string> = {
  mon: 'Mo',
  tue: 'Di',
  wed: 'Mi',
  thu: 'Do',
  fri: 'Fr',
  sat: 'Sa',
  sun: 'So',
};

// Local dates carry no time zone; formatting them as UTC keeps the day from shifting.
const dateFormat = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const longDateFormat = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const shortDayFormat = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'UTC',
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
});
const timestampFormat = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const asUtc = (date: LocalDate) => new Date(`${date}T00:00:00Z`);

/** `14.11.2026` */
export const formatDate = (date: LocalDate) => dateFormat.format(asUtc(date));
/** `Samstag, 14. November 2026` */
export const formatLongDate = (date: LocalDate) => longDateFormat.format(asUtc(date));
/** `Sa., 14.11.` */
export const formatShortDay = (date: LocalDate) => shortDayFormat.format(asUtc(date));
/** An instant on the practice's wall clock: `14.11.2026, 22:44` */
export const formatTimestamp = (iso: string) => timestampFormat.format(new Date(iso));

export function formatDateRange(from: LocalDate, to: LocalDate): string {
  return from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
}

export function initialsOf(name: string): string {
  const parts = name
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}
