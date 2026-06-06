import { describe, expect, it } from 'vitest';
import {
  AnnouncementPresetSchema,
  BUILTIN_ROLES,
  ClosureInputSchema,
  DEFAULT_OPENING_HOURS,
  DEFAULT_PRESETS,
  defaultPracticeSettings,
  OpeningHoursSchema,
  PracticeSettingsSchema,
  RoleSchema,
  SlotTemplateInputSchema,
} from '../src';

describe('defaults', () => {
  it('are valid according to their own schemas', () => {
    expect(OpeningHoursSchema.safeParse(DEFAULT_OPENING_HOURS).success).toBe(true);
    expect(PracticeSettingsSchema.safeParse(defaultPracticeSettings('Praxis', 'BY')).success).toBe(
      true,
    );
    for (const preset of DEFAULT_PRESETS) {
      expect(AnnouncementPresetSchema.safeParse(preset).success).toBe(true);
    }
    for (const role of BUILTIN_ROLES) {
      expect(RoleSchema.safeParse(role).success).toBe(true);
    }
  });

  it('assign a default preset to every opening mode', () => {
    const { presetAssignments } = defaultPracticeSettings('Praxis', 'BY');
    const presetIds = DEFAULT_PRESETS.map((preset) => preset.id);
    for (const presetId of Object.values(presetAssignments)) {
      expect(presetIds).toContain(presetId);
    }
  });
});

describe('OpeningHoursSchema', () => {
  it('rejects overlapping periods on one day', () => {
    const hours = {
      ...DEFAULT_OPENING_HOURS,
      mon: [
        { from: '08:00', to: '12:00' },
        { from: '11:00', to: '13:00' },
      ],
    };
    expect(OpeningHoursSchema.safeParse(hours).success).toBe(false);
  });

  it('rejects a period that ends before it starts', () => {
    const hours = { ...DEFAULT_OPENING_HOURS, mon: [{ from: '12:00', to: '08:00' }] };
    expect(OpeningHoursSchema.safeParse(hours).success).toBe(false);
  });

  it('accepts only full and half hours', () => {
    const at = (from: string, to: string) => ({ ...DEFAULT_OPENING_HOURS, mon: [{ from, to }] });
    expect(OpeningHoursSchema.safeParse(at('07:30', '12:00')).success).toBe(true);
    expect(OpeningHoursSchema.safeParse(at('07:45', '12:00')).success).toBe(false);
    expect(OpeningHoursSchema.safeParse(at('08:00', '12:15')).success).toBe(false);
  });

  it('requires every weekday', () => {
    const { sun: _sun, ...withoutSunday } = DEFAULT_OPENING_HOURS;
    expect(OpeningHoursSchema.safeParse(withoutSunday).success).toBe(false);
  });

  it('rejects times that are not HH:mm', () => {
    const hours = { ...DEFAULT_OPENING_HOURS, mon: [{ from: '8:00', to: '24:00' }] };
    expect(OpeningHoursSchema.safeParse(hours).success).toBe(false);
  });
});

describe('ClosureInputSchema', () => {
  const closure = { title: 'Urlaub', from: '2026-12-21', to: '2027-01-02', allDay: true };

  it('accepts an all-day closure', () => {
    expect(ClosureInputSchema.safeParse(closure).success).toBe(true);
  });

  it('rejects an end before the start', () => {
    expect(ClosureInputSchema.safeParse({ ...closure, to: '2026-12-01' }).success).toBe(false);
  });

  it('requires times for a closure that is not all day', () => {
    expect(ClosureInputSchema.safeParse({ ...closure, allDay: false }).success).toBe(false);
    expect(
      ClosureInputSchema.safeParse({
        ...closure,
        allDay: false,
        fromTime: '10:00',
        toTime: '12:00',
      }).success,
    ).toBe(true);
    expect(
      ClosureInputSchema.safeParse({
        ...closure,
        allDay: false,
        fromTime: '12:00',
        toTime: '10:00',
      }).success,
    ).toBe(false);
  });
});

describe('SlotTemplateInputSchema', () => {
  const template = {
    name: 'Vorsorge',
    categoryId: 'checkup',
    weekdays: ['mon'],
    from: '08:00',
    to: '10:00',
    capacity: 1,
    validFrom: '2026-11-01',
    active: true,
  };

  it('accepts a valid template', () => {
    expect(SlotTemplateInputSchema.safeParse(template).success).toBe(true);
  });

  it('rejects an empty window and an inverted validity period', () => {
    expect(SlotTemplateInputSchema.safeParse({ ...template, to: '08:00' }).success).toBe(false);
    expect(
      SlotTemplateInputSchema.safeParse({ ...template, validUntil: '2026-10-01' }).success,
    ).toBe(false);
  });

  it('needs at least one weekday', () => {
    expect(SlotTemplateInputSchema.safeParse({ ...template, weekdays: [] }).success).toBe(false);
  });
});
