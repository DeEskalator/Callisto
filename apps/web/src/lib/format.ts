import type { LocalDate, Weekday } from '@callisto/domain';
import { intlLocale, localized } from './i18n';

export const WEEKDAY_NAMES: Record<Weekday, string> = localized({
  de: {
    mon: 'Montag',
    tue: 'Dienstag',
    wed: 'Mittwoch',
    thu: 'Donnerstag',
    fri: 'Freitag',
    sat: 'Samstag',
    sun: 'Sonntag',
  },
  en: {
    mon: 'Monday',
    tue: 'Tuesday',
    wed: 'Wednesday',
    thu: 'Thursday',
    fri: 'Friday',
    sat: 'Saturday',
    sun: 'Sunday',
  },
});

export const WEEKDAY_SHORT: Record<Weekday, string> = localized({
  de: { mon: 'Mo', tue: 'Di', wed: 'Mi', thu: 'Do', fri: 'Fr', sat: 'Sa', sun: 'So' },
  en: { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' },
});

// Local dates carry no time zone; formatting them as UTC keeps the day from shifting.
const dateFormat = new Intl.DateTimeFormat(intlLocale, {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const longDateFormat = new Intl.DateTimeFormat(intlLocale, {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const shortDayFormat = new Intl.DateTimeFormat(intlLocale, {
  timeZone: 'UTC',
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
});
const timestampFormat = new Intl.DateTimeFormat(intlLocale, {
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

const timeFormat = new Intl.DateTimeFormat(intlLocale, {
  timeZone: 'Europe/Berlin',
  hour: '2-digit',
  minute: '2-digit',
});

/** The time of an instant on the practice's wall clock: `08:12` */
export const formatTime = (iso: string) => timeFormat.format(new Date(iso));

/** A duration in the way phone logs show it: `2:05 min` */
export function formatDuration(fromIso: string, toIso: string | undefined): string {
  if (!toIso) {
    return '–';
  }
  const seconds = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} min`;
}

/** German phone numbers in national notation with a gap after the prefix; others unchanged. */
export function formatPhone(number: string | undefined): string {
  if (!number) {
    return localized({ de: 'Unterdrückt', en: 'Withheld' });
  }
  const national = number.startsWith('+49') ? `0${number.slice(3)}` : number;
  return /^01\d/.test(national) ? `${national.slice(0, 4)} ${national.slice(4)}` : national;
}
