import { describe, expect, it } from 'vitest';
import { addDays, eachDate, fromZoned, minutesOf, timeOf, toZoned, weekdayOf } from '../src';

const BERLIN = 'Europe/Berlin';

describe('local dates and times', () => {
  it('converts between HH:mm and minutes of the day', () => {
    expect(minutesOf('08:30')).toBe(510);
    expect(timeOf(510)).toBe('08:30');
    expect(timeOf(0)).toBe('00:00');
    expect(timeOf(23 * 60 + 59)).toBe('23:59');
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('knows the weekday of a date', () => {
    expect(weekdayOf('2026-11-14')).toBe('sat');
    expect(weekdayOf('2026-11-16')).toBe('mon');
    expect(weekdayOf('2026-12-25')).toBe('fri');
  });

  it('lists every date of a range including both ends', () => {
    expect(eachDate('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
    expect(eachDate('2026-12-30', '2026-12-29')).toEqual([]);
  });
});

describe('time zone conversion', () => {
  it('shows an instant on the Berlin wall clock in winter and summer', () => {
    expect(toZoned(new Date('2026-01-15T07:30:00Z'), BERLIN)).toEqual({
      date: '2026-01-15',
      time: '08:30',
      weekday: 'thu',
    });
    expect(toZoned(new Date('2026-07-01T06:30:00Z'), BERLIN)).toEqual({
      date: '2026-07-01',
      time: '08:30',
      weekday: 'wed',
    });
  });

  it('rolls over to the next day after local midnight', () => {
    expect(toZoned(new Date('2026-01-15T23:30:00Z'), BERLIN)).toMatchObject({
      date: '2026-01-16',
      time: '00:30',
    });
  });

  it('finds the instant of a wall-clock time in winter and summer', () => {
    expect(fromZoned('2026-01-15', '08:30', BERLIN).toISOString()).toBe('2026-01-15T07:30:00.000Z');
    expect(fromZoned('2026-07-01', '08:30', BERLIN).toISOString()).toBe('2026-07-01T06:30:00.000Z');
  });

  it('uses the right offset on both sides of the switch to summer time', () => {
    // On 29 March 2026 the clock jumps from 02:00 to 03:00.
    expect(fromZoned('2026-03-29', '01:30', BERLIN).toISOString()).toBe('2026-03-29T00:30:00.000Z');
    expect(fromZoned('2026-03-29', '03:30', BERLIN).toISOString()).toBe('2026-03-29T01:30:00.000Z');
  });

  it('uses winter time again after the switch back', () => {
    expect(fromZoned('2026-10-25', '08:00', BERLIN).toISOString()).toBe('2026-10-25T07:00:00.000Z');
  });

  it('round-trips through both conversions', () => {
    const instant = fromZoned('2026-11-16', '15:45', BERLIN);
    expect(toZoned(instant, BERLIN)).toMatchObject({ date: '2026-11-16', time: '15:45' });
  });
});
