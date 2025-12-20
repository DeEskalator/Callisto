import type { PracticeConfig, SlotStore } from '@callisto/data';
import { addDays, generateSlots, planSlotChanges, toZoned } from '@callisto/domain';

export interface SlotChanges {
  created: number;
  updated: number;
  removed: number;
}

/**
 * Brings the slots of the booking horizon in line with the practice's templates, categories and
 * closures. Runs every night to extend the horizon by a day, and after every change to anything
 * the slots are derived from. Bookings are never touched (see `planSlotChanges`).
 */
export async function reconcileSlots(
  practice: PracticeConfig,
  slots: SlotStore,
  now: Date = new Date(),
): Promise<SlotChanges> {
  const { practiceId, settings } = practice;
  const from = toZoned(now, settings.timeZone).date;
  const to = addDays(from, settings.bookingHorizonDays);

  const desired = generateSlots({ ...practice, from, to });
  const existing = await slots.listRange(practiceId, from, to);
  const plan = planSlotChanges(existing, desired);

  const [created, updated, removed] = await Promise.all([
    slots.create(practiceId, plan.create),
    slots.replaceFree(practiceId, plan.replace),
    slots.deleteUnbooked(practiceId, plan.remove),
  ]);
  return { created, updated, removed };
}
