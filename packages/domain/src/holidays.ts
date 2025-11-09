import { addDays, type LocalDate, weekdayOf } from './time';

export const FEDERAL_STATES = [
  'BW',
  'BY',
  'BE',
  'BB',
  'HB',
  'HH',
  'HE',
  'MV',
  'NI',
  'NW',
  'RP',
  'SL',
  'SN',
  'ST',
  'SH',
  'TH',
] as const;
export type FederalState = (typeof FEDERAL_STATES)[number];

export interface Holiday {
  date: LocalDate;
  name: string;
}

/** Easter Sunday in the Gregorian calendar (anonymous Gregorian algorithm). */
export function easterSunday(year: number): LocalDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Buß- und Bettag: the Wednesday before 23 November. */
function repentanceDay(year: number): LocalDate {
  let date = `${year}-11-22`;
  while (weekdayOf(date) !== 'wed') {
    date = addDays(date, -1);
  }
  return date;
}

/**
 * Statutory public holidays of a federal state.
 *
 * Holidays that only apply in parts of a state (Mariä Himmelfahrt in Bavarian municipalities,
 * Fronleichnam in parts of Saxony and Thuringia, the Augsburg peace festival) are not included;
 * a practice affected by one enters it as a closure.
 */
export function germanHolidays(year: number, state: FederalState): Holiday[] {
  const easter = easterSunday(year);
  const fixed = (monthDay: string) => `${year}-${monthDay}`;
  const inStates = (...states: FederalState[]) => states.includes(state);

  const holidays: Holiday[] = [
    { date: fixed('01-01'), name: 'Neujahr' },
    { date: addDays(easter, -2), name: 'Karfreitag' },
    { date: addDays(easter, 1), name: 'Ostermontag' },
    { date: fixed('05-01'), name: 'Tag der Arbeit' },
    { date: addDays(easter, 39), name: 'Christi Himmelfahrt' },
    { date: addDays(easter, 50), name: 'Pfingstmontag' },
    { date: fixed('10-03'), name: 'Tag der Deutschen Einheit' },
    { date: fixed('12-25'), name: '1. Weihnachtstag' },
    { date: fixed('12-26'), name: '2. Weihnachtstag' },
  ];

  if (inStates('BW', 'BY', 'ST')) {
    holidays.push({ date: fixed('01-06'), name: 'Heilige Drei Könige' });
  }
  if (inStates('BE') || (state === 'MV' && year >= 2023)) {
    holidays.push({ date: fixed('03-08'), name: 'Internationaler Frauentag' });
  }
  if (inStates('BW', 'BY', 'HE', 'NW', 'RP', 'SL')) {
    holidays.push({ date: addDays(easter, 60), name: 'Fronleichnam' });
  }
  if (inStates('SL')) {
    holidays.push({ date: fixed('08-15'), name: 'Mariä Himmelfahrt' });
  }
  if (inStates('TH')) {
    holidays.push({ date: fixed('09-20'), name: 'Weltkindertag' });
  }
  if (inStates('BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH')) {
    holidays.push({ date: fixed('10-31'), name: 'Reformationstag' });
  }
  if (inStates('BW', 'BY', 'NW', 'RP', 'SL')) {
    holidays.push({ date: fixed('11-01'), name: 'Allerheiligen' });
  }
  if (inStates('SN')) {
    holidays.push({ date: repentanceDay(year), name: 'Buß- und Bettag' });
  }

  return holidays.sort((left, right) => left.date.localeCompare(right.date));
}

const holidaysByYear = new Map<string, Map<LocalDate, Holiday>>();

/** The public holiday on `date` in `state`, if there is one. */
export function germanHolidayOn(date: LocalDate, state: FederalState): Holiday | undefined {
  const year = date.slice(0, 4);
  const cacheKey = `${state}-${year}`;
  let holidays = holidaysByYear.get(cacheKey);
  if (!holidays) {
    holidays = new Map(
      germanHolidays(Number(year), state).map((holiday) => [holiday.date, holiday]),
    );
    holidaysByYear.set(cacheKey, holidays);
  }
  return holidays.get(date);
}
