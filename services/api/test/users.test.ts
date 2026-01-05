import { beforeEach, describe, expect, it } from 'vitest';
import { createUsersApp } from '../src/users/app';
import {
  bodyOf,
  jsonRequest,
  MemoryAuditStore,
  MemoryUserDirectory,
  signedInAs,
  silentLogger,
  TestUserStore,
  testConfigStore,
} from './fakes';

// Every test uses its own user ids because resolved users are cached per Lambda instance.
let run = 0;

function setup() {
  run += 1;
  const config = testConfigStore();
  const users = new TestUserStore();
  const directory = new MemoryUserDirectory();
  const app = createUsersApp({
    config,
    users,
    audit: new MemoryAuditStore(),
    directory,
    allowedOrigins: ['https://app.praxis.test'],
    logger: silentLogger,
  });
  const admin = users.add(`admin-${run}`, 'admin');
  const staff = users.add(`staff-${run}`, 'staff');
  const call = (userId: string, path: string, init?: RequestInit) =>
    app.request(`/v1${path}`, init, signedInAs(userId));
  return { config, users, directory, admin, staff, call };
}

describe('users API', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('returns the own profile with role and permissions', async () => {
    const response = await ctx.call(ctx.staff, '/me');
    expect(response.status).toBe(200);
    const me = await bodyOf(response);
    expect(me.profile.id).toBe(ctx.staff);
    expect(me.role.permissions).toContain('inquiries.manage');
  });

  it('keeps user management to those with the permission', async () => {
    expect((await ctx.call(ctx.staff, '/users')).status).toBe(403);
    expect((await ctx.call(ctx.admin, '/users')).status).toBe(200);
  });

  describe('creating a user', () => {
    const newUser = { email: 'Anna.Schmidt@Praxis.test', name: 'Anna Schmidt', roleId: 'staff' };

    it('creates the account, sends an invitation and stores the profile', async () => {
      const response = await ctx.call(ctx.admin, '/users', jsonRequest('POST', newUser));
      expect(response.status).toBe(201);

      const profile = await bodyOf(response);
      expect(profile).toMatchObject({
        email: 'anna.schmidt@praxis.test',
        name: 'Anna Schmidt',
        roleId: 'staff',
        status: 'active',
      });
      expect(ctx.directory.invitations).toEqual(['anna.schmidt@praxis.test']);
      expect(ctx.users.profiles.get(profile.id)).toBeDefined();
    });

    it('refuses a second account for the same address', async () => {
      await ctx.call(ctx.admin, '/users', jsonRequest('POST', newUser));
      const response = await ctx.call(ctx.admin, '/users', jsonRequest('POST', newUser));
      expect(response.status).toBe(409);
    });

    it('refuses a role that does not exist', async () => {
      const response = await ctx.call(
        ctx.admin,
        '/users',
        jsonRequest('POST', { ...newUser, roleId: 'missing' }),
      );
      expect(response.status).toBe(422);
      expect(ctx.directory.invitations).toEqual([]);
    });
  });

  describe('changing a user', () => {
    it('disables the account in the directory as well', async () => {
      const created = await ctx.call(
        ctx.admin,
        '/users',
        jsonRequest('POST', { email: 'ben@praxis.test', name: 'Ben', roleId: 'staff' }),
      );
      const { id } = await bodyOf(created);

      const response = await ctx.call(
        ctx.admin,
        `/users/${id}`,
        jsonRequest('PATCH', { status: 'disabled' }),
      );
      expect(response.status).toBe(200);
      expect(ctx.directory.accounts.get('ben@praxis.test')?.enabled).toBe(false);
      expect(ctx.users.profiles.get(id)?.status).toBe('disabled');
    });

    it('does not let users change their own role or status', async () => {
      const response = await ctx.call(
        ctx.admin,
        `/users/${ctx.admin}`,
        jsonRequest('PATCH', { roleId: 'readonly' }),
      );
      expect(response.status).toBe(409);
    });

    it('keeps the last active administrator', async () => {
      const second = ctx.users.add(`second-admin-${run}`, 'admin');

      // With two administrators one of them can be demoted ...
      const demoted = await ctx.call(
        second,
        `/users/${ctx.admin}`,
        jsonRequest('PATCH', { roleId: 'staff' }),
      );
      expect(demoted.status).toBe(200);

      // ... but the remaining one can neither be disabled nor deleted, by anyone.
      const role = await ctx.call(
        second,
        '/roles',
        jsonRequest('POST', { name: 'Benutzerverwaltung', permissions: ['users.manage'] }),
      );
      const manager = ctx.users.add(`manager-${run}`, (await bodyOf(role)).id);

      const disabled = await ctx.call(
        manager,
        `/users/${second}`,
        jsonRequest('PATCH', { status: 'disabled' }),
      );
      expect(disabled.status).toBe(409);
      const deleted = await ctx.call(manager, `/users/${second}`, { method: 'DELETE' });
      expect(deleted.status).toBe(409);
    });

    it('answers 404 for users of another practice', async () => {
      const foreign = ctx.users.add(`foreign-${run}`, 'staff', { practiceId: 'other' });
      const response = await ctx.call(
        ctx.admin,
        `/users/${foreign}`,
        jsonRequest('PATCH', { name: 'X' }),
      );
      expect(response.status).toBe(404);
    });
  });

  describe('roles', () => {
    it('protects the built-in roles', async () => {
      const update = await ctx.call(
        ctx.admin,
        '/roles/admin',
        jsonRequest('PUT', { name: 'Admin', permissions: [] }),
      );
      expect(update.status).toBe(409);
      expect((await ctx.call(ctx.admin, '/roles/admin', { method: 'DELETE' })).status).toBe(409);
    });

    it('creates a custom role and refuses to delete it while it is assigned', async () => {
      const created = await ctx.call(
        ctx.admin,
        '/roles',
        jsonRequest('POST', { name: 'Empfang', permissions: ['dashboard.view', 'calls.view'] }),
      );
      expect(created.status).toBe(201);
      const role = await bodyOf(created);
      expect(role.builtin).toBe(false);

      ctx.users.add(`reception-${run}`, role.id);
      expect((await ctx.call(ctx.admin, `/roles/${role.id}`, { method: 'DELETE' })).status).toBe(
        409,
      );
    });

    it('rejects unknown permissions', async () => {
      const response = await ctx.call(
        ctx.admin,
        '/roles',
        jsonRequest('POST', { name: 'Kaputt', permissions: ['everything'] }),
      );
      expect(response.status).toBe(400);
    });
  });
});
