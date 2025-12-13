import { describe, expect, it } from 'vitest';
import { bookedSlotsInClosedTimes, type Closure, planSlotChanges, type Slot } from '../src';

function slot(startTime: string, overrides: Partial<Slot> = {}): Slot {
  const compact = startTime.replace(':', '');
  return {
    id: `2026-11-16T${compact}_tpl1_0`,
    categoryId: 'checkup',
    date: '2026-11-16',
    startTime,
    endTime: `${startTime.slice(0, 2)}:30`,
    startsAt: `2026-11-16T${startTime}:00.000Z`,
    status: 'free',
    templateId: 'tpl1',
    ...overrides,
  };
}

describe('planSlotChanges', () => {
  it('creates what is missing and leaves matching slots alone', () => {
    const plan = planSlotChanges([slot('08:00')], [slot('08:00'), slot('09:00')]);
    expect(plan.create.map((s) => s.startTime)).toEqual(['09:00']);
    expect(plan.replace).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it('removes free and blocked slots the templates no longer call for', () => {
    const plan = planSlotChanges([slot('08:00'), slot('09:00', { status: 'blocked' })], []);
    expect(plan.remove.map((s) => s.startTime)).toEqual(['08:00', '09:00']);
  });

  it('never removes or replaces a booked slot', () => {
    const booked = slot('08:00', { status: 'booked', inquiryId: 'inq1' });
    expect(planSlotChanges([booked], [])).toEqual({ create: [], replace: [], remove: [] });

    const longer = slot('08:00', { endTime: '08:45' });
    expect(planSlotChanges([booked], [longer]).replace).toEqual([]);
  });

  it('replaces a free slot whose duration or category changed', () => {
    const longer = slot('08:00', { endTime: '08:45' });
    expect(planSlotChanges([slot('08:00')], [longer]).replace).toEqual([longer]);

    const moved = slot('08:00', { categoryId: 'vaccination' });
    expect(planSlotChanges([slot('08:00')], [moved]).replace).toEqual([moved]);
  });

  it('leaves manually created slots alone', () => {
    const manual = slot('10:00', { id: '2026-11-16T1000_manual-abc_0', templateId: undefined });
    expect(planSlotChanges([manual], []).remove).toEqual([]);
  });
});

describe('bookedSlotsInClosedTimes', () => {
  const settings = { federalState: 'NW' } as const;
  const booked = (startTime: string, overrides: Partial<Slot> = {}) =>
    slot(startTime, { status: 'booked', inquiryId: 'inq1', ...overrides });

  const morningOff: Closure = {
    id: 'c1',
    title: 'Fortbildung',
    from: '2026-11-16',
    to: '2026-11-16',
    allDay: false,
    fromTime: '08:15',
    toTime: '09:00',
  };

  it('finds bookings that overlap a closure', () => {
    const slots = [booked('08:00'), booked('09:00'), slot('08:00', { id: 'free' })];
    const conflicts = bookedSlotsInClosedTimes(slots, [morningOff], settings);
    expect(conflicts.map((s) => s.startTime)).toEqual(['08:00']);
  });

  it('finds bookings on a public holiday', () => {
    const christmas = booked('08:00', { date: '2026-12-25' });
    expect(bookedSlotsInClosedTimes([christmas], [], settings)).toEqual([christmas]);
  });

  it('reports nothing when all bookings are in open times', () => {
    expect(bookedSlotsInClosedTimes([booked('09:00')], [morningOff], settings)).toEqual([]);
  });
});
