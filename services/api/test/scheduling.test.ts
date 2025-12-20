import {
  addDays,
  germanHolidayOn,
  type Slot,
  toZoned,
  type Weekday,
  weekdayOf,
} from '@callisto/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { setupAdminApp } from './admin-setup';
import { bodyOf, jsonRequest, PRACTICE_ID } from './fakes';

// The API derives slots for "today plus the booking horizon", so the tests work relative to today.
const today = toZoned(new Date(), 'Europe/Berlin').date;

/** The first date after today that falls on `weekday` and is not a public holiday (NW). */
function next(weekday: Weekday): string {
  for (let offset = 1; offset < 50; offset++) {
    const date = addDays(today, offset);
    if (weekdayOf(date) === weekday && !germanHolidayOn(date, 'NW')) {
      return date;
    }
  }
  throw new Error(`No ${weekday} found`);
}

const checkup = {
  name: 'Vorsorge',
  description: 'Vorsorgeuntersuchungen',
  durationMinutes: 30,
  color: '#2f6fed',
  active: true,
};

describe('scheduling', () => {
  let ctx: ReturnType<typeof setupAdminApp>;
  let categoryId: string;

  const allSlots = () => [...ctx.slots.slots.values()];
  const slotsOn = (date: string) => allSlots().filter((slot) => slot.date === date);

  const createTemplate = async (overrides: Record<string, unknown> = {}) => {
    const response = await ctx.call(
      ctx.admin,
      '/slot-templates',
      jsonRequest('POST', {
        name: 'Vorsorge vormittags',
        categoryId,
        weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
        from: '08:00',
        to: '10:00',
        capacity: 1,
        validFrom: today,
        active: true,
        ...overrides,
      }),
    );
    expect(response.status).toBe(201);
    return bodyOf(response);
  };

  beforeEach(async () => {
    ctx = setupAdminApp();
    const created = await ctx.call(ctx.admin, '/categories', jsonRequest('POST', checkup));
    categoryId = (await bodyOf(created)).id;
  });

  describe('slot templates', () => {
    it('generates the slots of the booking horizon when a template is created', async () => {
      await createTemplate();
      const monday = next('mon');
      expect(slotsOn(monday).map((slot) => slot.startTime)).toEqual([
        '08:00',
        '08:30',
        '09:00',
        '09:30',
      ]);
      expect(slotsOn(next('sat'))).toEqual([]);
      const horizonEnd = addDays(today, 56);
      expect(allSlots().every((slot) => slot.date >= today && slot.date <= horizonEnd)).toBe(true);
    });

    it('refuses a template for a category that does not exist', async () => {
      const response = await ctx.call(
        ctx.admin,
        '/slot-templates',
        jsonRequest('POST', {
          name: 'X',
          categoryId: 'missing',
          weekdays: ['mon'],
          from: '08:00',
          to: '10:00',
          capacity: 1,
          validFrom: today,
          active: true,
        }),
      );
      expect(response.status).toBe(422);
    });

    it('removes free slots when the template is deleted but keeps bookings', async () => {
      const template = await createTemplate();
      const monday = next('mon');
      const booked = slotsOn(monday)[0] as Slot;
      await ctx.slots.changeStatus(PRACTICE_ID, booked, 'booked', 'inq1');

      const response = await ctx.call(ctx.admin, `/slot-templates/${template.id}`, {
        method: 'DELETE',
      });
      expect(response.status).toBe(204);
      expect(allSlots().map((slot) => slot.id)).toEqual([booked.id]);
      expect(allSlots()[0]?.status).toBe('booked');
    });

    it('re-derives the slots when the duration of the category changes', async () => {
      await createTemplate();
      const response = await ctx.call(
        ctx.admin,
        `/categories/${categoryId}`,
        jsonRequest('PUT', { ...checkup, durationMinutes: 60 }),
      );
      expect(response.status).toBe(200);
      expect(slotsOn(next('mon')).map((slot) => [slot.startTime, slot.endTime])).toEqual([
        ['08:00', '09:00'],
        ['09:00', '10:00'],
      ]);
    });
  });

  describe('closures', () => {
    it('take the free slots of their days away and report bookings they collide with', async () => {
      await createTemplate();
      const monday = next('mon');
      const booked = slotsOn(monday)[0] as Slot;
      await ctx.slots.changeStatus(PRACTICE_ID, booked, 'booked', 'inq1');

      const closure = { title: 'Brückentag', from: monday, to: monday, allDay: true };
      const created = await ctx.call(ctx.admin, '/closures', jsonRequest('POST', closure));
      expect(created.status).toBe(201);
      expect(slotsOn(monday).map((slot) => slot.status)).toEqual(['booked']);

      const conflicts = await bodyOf(await ctx.call(ctx.staff, '/slots/conflicts'));
      expect(conflicts.map((slot: Slot) => slot.id)).toEqual([booked.id]);

      // Deleting the closure brings the free slots back.
      const { id } = await bodyOf(created);
      await ctx.call(ctx.admin, `/closures/${id}`, { method: 'DELETE' });
      expect(slotsOn(monday)).toHaveLength(4);
      expect(await bodyOf(await ctx.call(ctx.staff, '/slots/conflicts'))).toEqual([]);
    });
  });

  describe('slots', () => {
    it('lists the slots of a period', async () => {
      await createTemplate();
      const monday = next('mon');
      const response = await ctx.call(ctx.staff, `/slots?from=${monday}&to=${monday}`);
      expect(response.status).toBe(200);
      expect(await bodyOf(response)).toHaveLength(4);
    });

    it('rejects periods that are inverted or too long', async () => {
      const inverted = await ctx.call(ctx.staff, `/slots?from=${addDays(today, 1)}&to=${today}`);
      expect(inverted.status).toBe(400);
      const tooLong = await ctx.call(ctx.staff, `/slots?from=${today}&to=${addDays(today, 90)}`);
      expect(tooLong.status).toBe(400);
    });

    it('blocks and releases a slot', async () => {
      await createTemplate();
      const slot = slotsOn(next('mon'))[0] as Slot;

      const blocked = await ctx.call(
        ctx.admin,
        `/slots/${slot.id}`,
        jsonRequest('PATCH', { status: 'blocked' }),
      );
      expect(blocked.status).toBe(200);
      expect(ctx.slots.slots.get(`${PRACTICE_ID}/${slot.id}`)?.status).toBe('blocked');

      // A blocked slot survives the nightly run instead of being generated as free again.
      await ctx.call(ctx.admin, '/slots/reconcile', { method: 'POST' });
      expect(ctx.slots.slots.get(`${PRACTICE_ID}/${slot.id}`)?.status).toBe('blocked');

      const released = await ctx.call(
        ctx.admin,
        `/slots/${slot.id}`,
        jsonRequest('PATCH', { status: 'free' }),
      );
      expect(released.status).toBe(200);
      expect(ctx.slots.slots.get(`${PRACTICE_ID}/${slot.id}`)?.status).toBe('free');
    });

    it('does not let a booked slot be blocked', async () => {
      await createTemplate();
      const slot = slotsOn(next('mon'))[0] as Slot;
      await ctx.slots.changeStatus(PRACTICE_ID, slot, 'booked', 'inq1');
      const response = await ctx.call(
        ctx.admin,
        `/slots/${slot.id}`,
        jsonRequest('PATCH', { status: 'blocked' }),
      );
      expect(response.status).toBe(409);
    });

    it('creates and deletes a single slot outside of any template', async () => {
      const saturday = next('sat');
      const created = await ctx.call(
        ctx.admin,
        '/slots',
        jsonRequest('POST', { categoryId, date: saturday, startTime: '10:00' }),
      );
      expect(created.status).toBe(201);
      const slot = await bodyOf(created);
      expect(slot).toMatchObject({ date: saturday, startTime: '10:00', endTime: '10:30' });

      // It is not part of any template, so reconciling leaves it alone.
      await ctx.call(ctx.admin, '/slots/reconcile', { method: 'POST' });
      expect(slotsOn(saturday)).toHaveLength(1);

      const deleted = await ctx.call(ctx.admin, `/slots/${slot.id}`, { method: 'DELETE' });
      expect(deleted.status).toBe(204);
      expect(slotsOn(saturday)).toEqual([]);
    });

    it('refuses to delete a slot that comes from a template', async () => {
      await createTemplate();
      const slot = slotsOn(next('mon'))[0] as Slot;
      const response = await ctx.call(ctx.admin, `/slots/${slot.id}`, { method: 'DELETE' });
      expect(response.status).toBe(409);
    });

    it('requires the scheduling permission for changes', async () => {
      const readonly = ctx.users.add(`readonly-${ctx.run}`, 'readonly');
      const response = await ctx.call(
        readonly,
        '/slots',
        jsonRequest('POST', { categoryId, date: next('sat'), startTime: '10:00' }),
      );
      expect(response.status).toBe(403);
    });
  });
});
