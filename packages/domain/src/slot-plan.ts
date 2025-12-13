import { germanHolidayOn } from './holidays';
import { closedMinutes } from './opening-state';
import type { Closure, PracticeSettings } from './practice';
import type { Slot } from './scheduling';
import { minutesOf } from './time';

export interface SlotPlan {
  /** Slots the templates call for that do not exist yet. */
  create: Slot[];
  /** Free slots whose category or times no longer match their template. */
  replace: Slot[];
  /** Generated slots the templates no longer call for. Booked slots are never removed. */
  remove: Slot[];
}

/**
 * Compares the slots that exist with the slots the templates currently call for.
 *
 * Applying the plan is safe to repeat and never touches a booking: an appointment a patient has
 * been given stays, even if its template is changed or deleted afterwards. Manually created slots
 * are left alone as well, because no template speaks for them.
 */
export function planSlotChanges(existing: Slot[], desired: Slot[]): SlotPlan {
  const existingById = new Map(existing.map((slot) => [slot.id, slot]));
  const desiredIds = new Set(desired.map((slot) => slot.id));
  const plan: SlotPlan = { create: [], replace: [], remove: [] };

  for (const slot of desired) {
    const current = existingById.get(slot.id);
    if (!current) {
      plan.create.push(slot);
    } else if (
      current.status === 'free' &&
      (current.endTime !== slot.endTime ||
        current.categoryId !== slot.categoryId ||
        current.startsAt !== slot.startsAt)
    ) {
      plan.replace.push(slot);
    }
  }
  for (const slot of existing) {
    if (slot.templateId && slot.status !== 'booked' && !desiredIds.has(slot.id)) {
      plan.remove.push(slot);
    }
  }
  return plan;
}

/**
 * Booked slots that lie in a closure or on a public holiday. They come about when a closure is
 * entered after appointments were given out; the practice has to contact these patients.
 */
export function bookedSlotsInClosedTimes(
  slots: Slot[],
  closures: Closure[],
  settings: Pick<PracticeSettings, 'federalState'>,
): Slot[] {
  return slots.filter((slot) => {
    if (slot.status !== 'booked') {
      return false;
    }
    if (germanHolidayOn(slot.date, settings.federalState)) {
      return true;
    }
    const start = minutesOf(slot.startTime);
    const end = minutesOf(slot.endTime);
    return closures.some((closure) => {
      const blocked = closedMinutes(closure, slot.date);
      return blocked !== undefined && start < blocked[1] && end > blocked[0];
    });
  });
}
