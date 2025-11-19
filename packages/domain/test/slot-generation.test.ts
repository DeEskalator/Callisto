import { describe, expect, it } from 'vitest';
import {
  type AppointmentCategory,
  type Closure,
  generateSlots,
  parseSlotId,
  type SlotGenerationInput,
  type SlotTemplate,
  slotId,
} from '../src';

const checkup: AppointmentCategory = {
  id: 'checkup',
  name: 'Vorsorge',
  description: 'Vorsorgeuntersuchungen',
  durationMinutes: 30,
  color: '#2f6fed',
  active: true,
};

// Mondays and Wednesdays 08:00-10:00.
const template: SlotTemplate = {
  id: 'tpl1',
  name: 'Vorsorge vormittags',
  categoryId: 'checkup',
  weekdays: ['mon', 'wed'],
  from: '08:00',
  to: '10:00',
  capacity: 1,
  validFrom: '2026-11-01',
  active: true,
};

// The week of Monday 16 to Sunday 22 November 2026.
function input(overrides: Partial<SlotGenerationInput> = {}): SlotGenerationInput {
  return {
    templates: [template],
    categories: [checkup],
    closures: [],
    settings: { timeZone: 'Europe/Berlin', federalState: 'NW' },
    from: '2026-11-16',
    to: '2026-11-22',
    ...overrides,
  };
}

const startsOn = (slots: ReturnType<typeof generateSlots>, date: string) =>
  slots.filter((slot) => slot.date === date).map((slot) => slot.startTime);

describe('generateSlots', () => {
  it('fills the template window with back-to-back slots on its weekdays', () => {
    const slots = generateSlots(input());
    expect(startsOn(slots, '2026-11-16')).toEqual(['08:00', '08:30', '09:00', '09:30']);
    expect(startsOn(slots, '2026-11-18')).toEqual(['08:00', '08:30', '09:00', '09:30']);
    expect(slots).toHaveLength(8);
  });

  it('creates free slots with the instant of their start', () => {
    const [first] = generateSlots(input());
    expect(first).toEqual({
      id: '2026-11-16T0800_tpl1_0',
      categoryId: 'checkup',
      date: '2026-11-16',
      startTime: '08:00',
      endTime: '08:30',
      startsAt: '2026-11-16T07:00:00.000Z',
      status: 'free',
      templateId: 'tpl1',
    });
  });

  it('uses the interval for overlapping starts but never runs past the window', () => {
    const slots = generateSlots(input({ templates: [{ ...template, intervalMinutes: 15 }] }));
    expect(startsOn(slots, '2026-11-16')).toEqual([
      '08:00',
      '08:15',
      '08:30',
      '08:45',
      '09:00',
      '09:15',
      '09:30',
    ]);
  });

  it('creates one slot per unit of capacity, each with its own id', () => {
    const slots = generateSlots(input({ templates: [{ ...template, capacity: 2 }] }));
    expect(slots).toHaveLength(16);
    expect(new Set(slots.map((slot) => slot.id)).size).toBe(16);
  });

  it('is deterministic, so regenerating a day yields the same ids', () => {
    const ids = (slots: ReturnType<typeof generateSlots>) => slots.map((slot) => slot.id);
    expect(ids(generateSlots(input()))).toEqual(ids(generateSlots(input())));
  });

  it('leaves out days of an all-day closure', () => {
    const closure: Closure = {
      id: 'c1',
      title: 'Brückentag',
      from: '2026-11-18',
      to: '2026-11-18',
      allDay: true,
    };
    const slots = generateSlots(input({ closures: [closure] }));
    expect(startsOn(slots, '2026-11-18')).toEqual([]);
    expect(slots).toHaveLength(4);
  });

  it('leaves out slots that overlap a closure for part of the day', () => {
    const closure: Closure = {
      id: 'c2',
      title: 'Fortbildung',
      from: '2026-11-16',
      to: '2026-11-16',
      allDay: false,
      fromTime: '09:00',
      toTime: '10:00',
    };
    const slots = generateSlots(input({ closures: [closure] }));
    expect(startsOn(slots, '2026-11-16')).toEqual(['08:00', '08:30']);
  });

  it('leaves out public holidays', () => {
    const friday: SlotTemplate = { ...template, weekdays: ['fri'] };
    const slots = generateSlots(
      input({ templates: [friday], from: '2026-12-21', to: '2026-12-27' }),
    );
    expect(slots).toEqual([]);
  });

  it('respects the validity period of a template', () => {
    const limited: SlotTemplate = {
      ...template,
      validFrom: '2026-11-17',
      validUntil: '2026-11-17',
    };
    expect(generateSlots(input({ templates: [limited] }))).toEqual([]);
  });

  it('ignores inactive templates and categories', () => {
    expect(generateSlots(input({ templates: [{ ...template, active: false }] }))).toEqual([]);
    expect(generateSlots(input({ categories: [{ ...checkup, active: false }] }))).toEqual([]);
  });
});

describe('slot ids', () => {
  it('carry date and start time', () => {
    const id = slotId('2026-11-16', '08:30', 'tpl1', 0);
    expect(id).toBe('2026-11-16T0830_tpl1_0');
    expect(parseSlotId(id)).toEqual({ date: '2026-11-16', startTime: '08:30' });
  });

  it('are rejected when they do not follow the format', () => {
    expect(parseSlotId('not-a-slot')).toBeUndefined();
  });
});
