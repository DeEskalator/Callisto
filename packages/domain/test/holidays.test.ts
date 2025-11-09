import { describe, expect, it } from 'vitest';
import { easterSunday, germanHolidayOn, germanHolidays } from '../src';

describe('easterSunday', () => {
  it('matches known Easter dates', () => {
    expect(easterSunday(2024)).toBe('2024-03-31');
    expect(easterSunday(2025)).toBe('2025-04-20');
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
  });
});

describe('germanHolidays', () => {
  const namesOn = (year: number, state: Parameters<typeof germanHolidays>[1]) =>
    Object.fromEntries(germanHolidays(year, state).map((holiday) => [holiday.name, holiday.date]));

  it('derives the movable holidays from Easter', () => {
    expect(namesOn(2026, 'BY')).toMatchObject({
      Karfreitag: '2026-04-03',
      Ostermontag: '2026-04-06',
      'Christi Himmelfahrt': '2026-05-14',
      Pfingstmontag: '2026-05-25',
      Fronleichnam: '2026-06-04',
    });
  });

  it('includes only the holidays of the given federal state', () => {
    const berlin = namesOn(2026, 'BE');
    expect(berlin['Internationaler Frauentag']).toBe('2026-03-08');
    expect(berlin.Fronleichnam).toBeUndefined();
    expect(berlin.Allerheiligen).toBeUndefined();

    expect(namesOn(2026, 'NW').Allerheiligen).toBe('2026-11-01');
    expect(namesOn(2026, 'HH').Reformationstag).toBe('2026-10-31');
  });

  it('puts Buß- und Bettag on the Wednesday before 23 November', () => {
    expect(namesOn(2025, 'SN')['Buß- und Bettag']).toBe('2025-11-19');
    expect(namesOn(2026, 'SN')['Buß- und Bettag']).toBe('2026-11-18');
  });

  it('returns the holidays in chronological order', () => {
    const dates = germanHolidays(2026, 'BW').map((holiday) => holiday.date);
    expect(dates).toEqual([...dates].sort());
  });
});

describe('germanHolidayOn', () => {
  it('finds a holiday by date and state', () => {
    expect(germanHolidayOn('2026-12-25', 'HH')?.name).toBe('1. Weihnachtstag');
    expect(germanHolidayOn('2026-11-01', 'NW')?.name).toBe('Allerheiligen');
    expect(germanHolidayOn('2026-11-01', 'HH')).toBeUndefined();
    expect(germanHolidayOn('2026-11-16', 'NW')).toBeUndefined();
  });
});
