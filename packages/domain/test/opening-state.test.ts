import { describe, expect, it } from 'vitest';
import {
  type Closure,
  DEFAULT_OPENING_HOURS,
  defaultPracticeSettings,
  effectiveRanges,
  fromZoned,
  type OpeningContext,
  openingStateAt,
} from '../src';

// Default hours: Mon, Tue, Thu 08-12 and 15-18, Wed and Fri 08-12, weekend closed.
function contextWith(closures: Closure[] = []): OpeningContext {
  return {
    settings: defaultPracticeSettings('Praxis Test', 'NW'),
    hours: DEFAULT_OPENING_HOURS,
    closures,
  };
}

const at = (date: string, time: string) => fromZoned(date, time, 'Europe/Berlin');

const christmasBreak: Closure = {
  id: 'xmas',
  title: 'Weihnachtsurlaub',
  from: '2026-12-21',
  to: '2027-01-02',
  allDay: true,
  presetId: 'vacation-with-substitute',
};

describe('openingStateAt', () => {
  it('is open during opening hours and knows when it opens next', () => {
    const state = openingStateAt(at('2026-11-16', '09:00'), contextWith());
    expect(state).toMatchObject({
      mode: 'open',
      localDate: '2026-11-16',
      localTime: '09:00',
      currentPeriod: { date: '2026-11-16', from: '08:00', to: '12:00' },
      nextOpening: { date: '2026-11-16', from: '15:00', to: '18:00' },
      presetId: 'open',
    });
  });

  it('treats the end of a period as closed', () => {
    expect(openingStateAt(at('2026-11-16', '11:59'), contextWith()).mode).toBe('open');
    expect(openingStateAt(at('2026-11-16', '12:00'), contextWith()).mode).toBe('closed');
  });

  it('is closed over lunch and points to the afternoon', () => {
    const state = openingStateAt(at('2026-11-16', '13:00'), contextWith());
    expect(state.mode).toBe('closed');
    expect(state.currentPeriod).toBeUndefined();
    expect(state.nextOpening).toEqual({ date: '2026-11-16', from: '15:00', to: '18:00' });
    expect(state.presetId).toBe('closed');
  });

  it('skips the weekend when looking for the next opening', () => {
    const state = openingStateAt(at('2026-11-14', '10:00'), contextWith());
    expect(state.mode).toBe('closed');
    expect(state.todayRanges).toEqual([]);
    expect(state.nextOpening).toEqual({ date: '2026-11-16', from: '08:00', to: '12:00' });
  });

  it('reports a public holiday and skips it for the next opening', () => {
    // 25 December 2026 is a Friday, the 26th a holiday too, then the weekend.
    const state = openingStateAt(at('2026-12-25', '09:00'), contextWith());
    expect(state.mode).toBe('holiday');
    expect(state.holiday?.name).toBe('1. Weihnachtstag');
    expect(state.presetId).toBe('holiday');
    expect(state.nextOpening).toEqual({ date: '2026-12-28', from: '08:00', to: '12:00' });
  });

  it('reports a vacation with its own preset and the first day back', () => {
    const state = openingStateAt(at('2026-12-22', '10:00'), contextWith([christmasBreak]));
    expect(state.mode).toBe('vacation');
    expect(state.closure?.id).toBe('xmas');
    expect(state.presetId).toBe('vacation-with-substitute');
    // 2 January is the last day off, the 3rd a Sunday.
    expect(state.nextOpening).toEqual({ date: '2027-01-04', from: '08:00', to: '12:00' });
  });

  it('lets a vacation win over a public holiday', () => {
    const state = openingStateAt(at('2026-12-25', '09:00'), contextWith([christmasBreak]));
    expect(state.mode).toBe('vacation');
    expect(state.holiday?.name).toBe('1. Weihnachtstag');
  });

  it('falls back to the default vacation preset when the closure names none', () => {
    const closure: Closure = { ...christmasBreak, presetId: undefined };
    const state = openingStateAt(at('2026-12-22', '10:00'), contextWith([closure]));
    expect(state.presetId).toBe('vacation');
  });

  it('sees the vacation coming on the evening before', () => {
    const state = openingStateAt(at('2026-12-18', '20:00'), contextWith([christmasBreak]));
    expect(state.mode).toBe('closed');
    expect(state.nextOpening).toEqual({ date: '2027-01-04', from: '08:00', to: '12:00' });
  });

  describe('with a closure for part of a day', () => {
    const training: Closure = {
      id: 'training',
      title: 'Fortbildung',
      from: '2026-11-18',
      to: '2026-11-18',
      allDay: false,
      fromTime: '10:00',
      toTime: '12:00',
    };

    it('stays open until the closure starts', () => {
      const state = openingStateAt(at('2026-11-18', '09:00'), contextWith([training]));
      expect(state.mode).toBe('open');
      expect(state.currentPeriod).toEqual({ date: '2026-11-18', from: '08:00', to: '10:00' });
      expect(state.nextOpening).toEqual({ date: '2026-11-19', from: '08:00', to: '12:00' });
    });

    it('is in vacation mode while the closure lasts', () => {
      const state = openingStateAt(at('2026-11-18', '10:30'), contextWith([training]));
      expect(state.mode).toBe('vacation');
      expect(state.closure?.id).toBe('training');
    });

    it('is plainly closed once the closure is over', () => {
      const state = openingStateAt(at('2026-11-18', '14:00'), contextWith([training]));
      expect(state.mode).toBe('closed');
      expect(state.closure).toBeUndefined();
    });
  });
});

describe('effectiveRanges', () => {
  it('splits a period around a closure in its middle', () => {
    const meeting: Closure = {
      id: 'meeting',
      title: 'Teambesprechung',
      from: '2026-11-16',
      to: '2026-11-16',
      allDay: false,
      fromTime: '09:00',
      toTime: '10:00',
    };
    expect(effectiveRanges('2026-11-16', contextWith([meeting]))).toEqual([
      { from: '08:00', to: '09:00' },
      { from: '10:00', to: '12:00' },
      { from: '15:00', to: '18:00' },
    ]);
  });
});
