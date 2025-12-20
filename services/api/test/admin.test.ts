import { DEFAULT_OPENING_HOURS } from '@callisto/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { setupAdminApp } from './admin-setup';
import { bodyOf, jsonRequest, PRACTICE_ID } from './fakes';

describe('admin API', () => {
  let ctx: ReturnType<typeof setupAdminApp>;
  beforeEach(() => {
    ctx = setupAdminApp();
  });

  describe('access', () => {
    it('rejects requests without an identity', async () => {
      const response = await ctx.call(undefined, '/config');
      expect(response.status).toBe(401);
      expect(response.headers.get('content-type')).toContain('application/problem+json');
    });

    it('rejects accounts that have no profile or are disabled', async () => {
      expect((await ctx.call('stranger', '/config')).status).toBe(403);

      const disabled = ctx.users.add(`disabled-${ctx.run}`, 'admin', { status: 'disabled' });
      expect((await ctx.call(disabled, '/config')).status).toBe(403);
    });

    it('lets every signed-in user read the configuration', async () => {
      const response = await ctx.call(ctx.staff, '/config');
      expect(response.status).toBe(200);
      const body = await bodyOf(response);
      expect(body.settings.name).toBe('Praxis Test');
      expect(body.hours).toEqual(DEFAULT_OPENING_HOURS);
      expect(body.roles).toBeUndefined();
    });

    it('requires a permission for changes', async () => {
      const response = await ctx.call(
        ctx.staff,
        '/opening-hours',
        jsonRequest('PUT', DEFAULT_OPENING_HOURS),
      );
      expect(response.status).toBe(403);
      expect((await bodyOf(response)).code).toBe('forbidden');
    });

    it('answers unknown paths with a problem document', async () => {
      const response = await ctx.call(ctx.admin, '/does-not-exist');
      expect(response.status).toBe(404);
      expect((await bodyOf(response)).code).toBe('not_found');
    });
  });

  describe('opening hours', () => {
    it('stores valid hours and records the change', async () => {
      const hours = { ...DEFAULT_OPENING_HOURS, sat: [{ from: '09:00', to: '11:00' }] };
      const response = await ctx.call(ctx.admin, '/opening-hours', jsonRequest('PUT', hours));

      expect(response.status).toBe(200);
      expect(ctx.config.practices.get(PRACTICE_ID)?.hours.sat).toEqual([
        { from: '09:00', to: '11:00' },
      ]);
      expect(ctx.audit.entries.map((entry) => entry.action)).toEqual(['hours.updated']);
    });

    it('explains what is wrong with invalid hours', async () => {
      const hours = { ...DEFAULT_OPENING_HOURS, mon: [{ from: '12:00', to: '08:00' }] };
      const response = await ctx.call(ctx.admin, '/opening-hours', jsonRequest('PUT', hours));

      expect(response.status).toBe(400);
      const problem = await bodyOf(response);
      expect(problem.code).toBe('validation_failed');
      expect(problem.issues[0].path).toContain('mon');
    });
  });

  describe('closures', () => {
    const vacation = { title: 'Sommerurlaub', from: '2027-07-12', to: '2027-07-30', allDay: true };

    it('creates, updates and deletes a closure', async () => {
      const created = await ctx.call(ctx.admin, '/closures', jsonRequest('POST', vacation));
      expect(created.status).toBe(201);
      const { id } = await bodyOf(created);

      const updated = await ctx.call(
        ctx.admin,
        `/closures/${id}`,
        jsonRequest('PUT', { ...vacation, to: '2027-08-06' }),
      );
      expect(updated.status).toBe(200);
      expect(ctx.config.practices.get(PRACTICE_ID)?.closures).toEqual([
        { id, ...vacation, to: '2027-08-06' },
      ]);

      const deleted = await ctx.call(ctx.admin, `/closures/${id}`, { method: 'DELETE' });
      expect(deleted.status).toBe(204);
      expect(ctx.config.practices.get(PRACTICE_ID)?.closures).toEqual([]);
    });

    it('refuses a closure that points to a missing preset', async () => {
      const response = await ctx.call(
        ctx.admin,
        '/closures',
        jsonRequest('POST', { ...vacation, presetId: 'missing' }),
      );
      expect(response.status).toBe(422);
    });

    it('answers 404 for a closure that does not exist', async () => {
      const response = await ctx.call(ctx.admin, '/closures/nope', jsonRequest('PUT', vacation));
      expect(response.status).toBe(404);
    });
  });

  describe('presets', () => {
    it('keeps presets that are still in use', async () => {
      const response = await ctx.call(ctx.admin, '/presets/closed', { method: 'DELETE' });
      expect(response.status).toBe(409);
      expect(ctx.config.practices.get(PRACTICE_ID)?.presets.map((preset) => preset.id)).toContain(
        'closed',
      );
    });

    it('deletes a preset nothing refers to', async () => {
      const created = await ctx.call(
        ctx.admin,
        '/presets',
        jsonRequest('POST', {
          name: 'Praxisumzug',
          announcement: 'Wir ziehen um und sind ab Montag wieder für Sie da.',
          capabilities: {
            appointments: true,
            prescriptions: false,
            callbacks: true,
            transfer: false,
          },
        }),
      );
      const { id } = await bodyOf(created);
      const deleted = await ctx.call(ctx.admin, `/presets/${id}`, { method: 'DELETE' });
      expect(deleted.status).toBe(204);
    });
  });

  describe('status', () => {
    it('reports the opening state of the practice', async () => {
      const response = await ctx.call(ctx.staff, '/status');
      expect(response.status).toBe(200);
      const status = await bodyOf(response);
      expect(status.practiceName).toBe('Praxis Test');
      expect(['open', 'closed', 'holiday', 'vacation']).toContain(status.mode);
    });
  });
});
