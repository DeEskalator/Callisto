import { germanHolidayOn } from './holidays';
import { closedMinutes } from './opening-state';
import type { Closure, PracticeSettings } from './practice';
import type { AppointmentCategory, Slot, SlotTemplate } from './scheduling';
import {
  eachDate,
  fromZoned,
  type LocalDate,
  type LocalTime,
  minutesOf,
  timeOf,
  weekdayOf,
} from './time';

/**
 * Builds a slot id that starts with date and time, e.g. `2026-11-16T0830_<origin>_0`.
 *
 * `origin` is the template id for generated slots, so generating the same day twice yields the
 * same ids and existing slots (and their bookings) are never duplicated.
 */
export function slotId(date: LocalDate, startTime: LocalTime, origin: string, index: number) {
  return `${date}T${startTime.replace(':', '')}_${origin}_${index}`;
}

/** Reads date and start time back out of an id built by `slotId`. */
export function parseSlotId(id: string): { date: LocalDate; startTime: LocalTime } | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})_/.exec(id);
  if (!match) {
    return undefined;
  }
  return { date: match[1] as string, startTime: `${match[2]}:${match[3]}` };
}

export interface SlotGenerationInput {
  templates: SlotTemplate[];
  categories: AppointmentCategory[];
  closures: Closure[];
  settings: Pick<PracticeSettings, 'timeZone' | 'federalState'>;
  /** First and last day to generate, both inclusive. */
  from: LocalDate;
  to: LocalDate;
}

/**
 * Expands the slot templates into concrete free slots for a range of days.
 *
 * Public holidays and closures produce no slots. Opening hours are deliberately not consulted:
 * a template is the practice's explicit statement of when a category can be booked.
 */
export function generateSlots(input: SlotGenerationInput): Slot[] {
  const { settings, closures } = input;
  const categories = new Map(
    input.categories
      .filter((category) => category.active)
      .map((category) => [category.id, category]),
  );
  const slots: Slot[] = [];

  for (const date of eachDate(input.from, input.to)) {
    if (germanHolidayOn(date, settings.federalState)) {
      continue;
    }
    const weekday = weekdayOf(date);
    const blocked = closures
      .map((closure) => closedMinutes(closure, date))
      .filter((range) => range !== undefined);

    for (const template of input.templates) {
      const category = categories.get(template.categoryId);
      if (!category || !template.active || !template.weekdays.includes(weekday)) {
        continue;
      }
      if (date < template.validFrom || (template.validUntil && date > template.validUntil)) {
        continue;
      }

      const duration = category.durationMinutes;
      const step = template.intervalMinutes ?? duration;
      const lastEnd = minutesOf(template.to);
      for (let start = minutesOf(template.from); start + duration <= lastEnd; start += step) {
        const end = start + duration;
        if (blocked.some(([blockedFrom, blockedTo]) => start < blockedTo && end > blockedFrom)) {
          continue;
        }
        const startTime = timeOf(start);
        for (let index = 0; index < template.capacity; index++) {
          slots.push({
            id: slotId(date, startTime, template.id, index),
            categoryId: category.id,
            date,
            startTime,
            endTime: timeOf(end),
            startsAt: fromZoned(date, startTime, settings.timeZone).toISOString(),
            status: 'free',
            templateId: template.id,
          });
        }
      }
    }
  }
  return slots;
}
