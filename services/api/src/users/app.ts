import type { Logger } from '@aws-lambda-powertools/logger';
import type { AuditStore, ConfigStore, UserStore } from '@callisto/data';
import {
  ADMIN_ROLE_ID,
  newId,
  type Role,
  RoleInputSchema,
  UserCreateSchema,
  type UserProfile,
  UserUpdateSchema,
} from '@callisto/domain';
import { type Context, Hono } from 'hono';
import { auditor, corsFor, errorHandler, notFoundHandler } from '../lib/app';
import { authenticate, forgetUser, requirePermission } from '../lib/auth';
import { type AppEnv, conflict, notFound, unprocessable, validateJson } from '../lib/http';
import { type UserDirectory, UserExistsError } from './directory';

export interface UsersDeps {
  config: ConfigStore;
  users: UserStore;
  audit: AuditStore;
  directory: UserDirectory;
  allowedOrigins: string[];
  logger: Logger;
}

/** The signed-in user's own profile, plus user and role management for administrators. */
export function createUsersApp(deps: UsersDeps) {
  const { config, users, directory } = deps;
  const record = auditor(deps.audit);

  const practiceIdOf = (c: Context<AppEnv>) => c.get('user').profile.practiceId;

  /** The user addressed by the route, provided they belong to the caller's practice. */
  const loadTarget = async (c: Context<AppEnv>, userId: string): Promise<UserProfile> => {
    const target = await users.get(userId);
    if (!target || target.practiceId !== practiceIdOf(c)) {
      throw notFound('Das Benutzerkonto');
    }
    return target;
  };

  const loadRole = async (c: Context<AppEnv>, roleId: string): Promise<Role> => {
    const role = await config.getItem(practiceIdOf(c), 'roles', roleId);
    if (!role) {
      throw notFound('Die Rolle');
    }
    return role;
  };

  /** A practice must always keep one active administrator, otherwise nobody can manage users. */
  const assertAnotherAdminRemains = async (c: Context<AppEnv>, leaving: UserProfile) => {
    if (leaving.roleId !== ADMIN_ROLE_ID || leaving.status !== 'active') {
      return;
    }
    const others = (await users.listByPractice(practiceIdOf(c))).filter(
      (user) => user.id !== leaving.id && user.roleId === ADMIN_ROLE_ID && user.status === 'active',
    );
    if (others.length === 0) {
      throw conflict('Es muss mindestens ein aktives Administrationskonto geben');
    }
  };

  const app = new Hono<AppEnv>()
    .basePath('/v1')
    .use(corsFor(deps.allowedOrigins))
    .use(authenticate(deps))

    .get('/me', (c) => c.json(c.get('user')))

    // ── Benutzer ─────────────────────────────────────────────────────────────

    .get('/users', requirePermission('users.manage'), async (c) =>
      c.json(await users.listByPractice(practiceIdOf(c))),
    )

    .post(
      '/users',
      requirePermission('users.manage'),
      validateJson(UserCreateSchema),
      async (c) => {
        const input = c.req.valid('json');
        if (!(await config.getItem(practiceIdOf(c), 'roles', input.roleId))) {
          throw unprocessable('Die ausgewählte Rolle existiert nicht');
        }
        let userId: string;
        try {
          userId = await directory.createUser(input.email, input.name);
        } catch (error) {
          if (error instanceof UserExistsError) {
            throw conflict('Für diese E-Mail-Adresse gibt es bereits ein Benutzerkonto');
          }
          throw error;
        }
        const profile: UserProfile = {
          id: userId,
          practiceId: practiceIdOf(c),
          email: input.email,
          name: input.name,
          roleId: input.roleId,
          status: 'active',
          createdAt: new Date().toISOString(),
        };
        await users.put(profile);
        await record(c, 'user.created', `Benutzerkonto für ${profile.name} angelegt`, profile.id);
        return c.json(profile, 201);
      },
    )

    .patch(
      '/users/:id',
      requirePermission('users.manage'),
      validateJson(UserUpdateSchema),
      async (c) => {
        const changes = c.req.valid('json');
        const target = await loadTarget(c, c.req.param('id'));
        const updated: UserProfile = {
          ...target,
          name: changes.name ?? target.name,
          roleId: changes.roleId ?? target.roleId,
          status: changes.status ?? target.status,
        };
        const roleChanges = updated.roleId !== target.roleId;
        const accessChanges = roleChanges || updated.status !== target.status;

        if (accessChanges && target.id === c.get('user').profile.id) {
          throw conflict('Die eigene Rolle und der eigene Status können nicht geändert werden');
        }
        if (roleChanges && !(await config.getItem(target.practiceId, 'roles', updated.roleId))) {
          throw unprocessable('Die ausgewählte Rolle existiert nicht');
        }
        if (accessChanges) {
          await assertAnotherAdminRemains(c, target);
        }
        if (updated.status !== target.status) {
          await directory.setEnabled(target.id, updated.status === 'active');
        }
        await users.put(updated);
        forgetUser(target.id);
        await record(c, 'user.updated', `Benutzerkonto von ${updated.name} geändert`, target.id);
        return c.json(updated);
      },
    )

    .delete('/users/:id', requirePermission('users.manage'), async (c) => {
      const target = await loadTarget(c, c.req.param('id'));
      if (target.id === c.get('user').profile.id) {
        throw conflict('Das eigene Benutzerkonto kann nicht gelöscht werden');
      }
      await assertAnotherAdminRemains(c, target);
      await directory.deleteUser(target.id);
      await users.delete(target.id);
      forgetUser(target.id);
      await record(c, 'user.deleted', `Benutzerkonto von ${target.name} gelöscht`, target.id);
      return c.body(null, 204);
    })

    .post('/users/:id/invitation', requirePermission('users.manage'), async (c) => {
      const target = await loadTarget(c, c.req.param('id'));
      await directory.resendInvitation(target.email);
      await record(c, 'user.invited', `Einladung erneut an ${target.name} gesendet`, target.id);
      return c.body(null, 204);
    })

    // ── Rollen ───────────────────────────────────────────────────────────────

    .get('/roles', requirePermission('users.manage'), async (c) => {
      const practice = await config.load(practiceIdOf(c));
      return c.json(practice?.roles ?? []);
    })

    .post('/roles', requirePermission('users.manage'), validateJson(RoleInputSchema), async (c) => {
      const role: Role = { id: newId(), builtin: false, ...c.req.valid('json') };
      await config.putItem(practiceIdOf(c), 'roles', role);
      await record(c, 'role.created', `Rolle „${role.name}“ angelegt`, role.id);
      return c.json(role, 201);
    })

    .put(
      '/roles/:id',
      requirePermission('users.manage'),
      validateJson(RoleInputSchema),
      async (c) => {
        const existing = await loadRole(c, c.req.param('id'));
        if (existing.builtin) {
          throw conflict('Vorgegebene Rollen können nicht geändert werden');
        }
        const role: Role = { id: existing.id, builtin: false, ...c.req.valid('json') };
        await config.putItem(practiceIdOf(c), 'roles', role);
        await record(c, 'role.updated', `Rolle „${role.name}“ geändert`, role.id);
        return c.json(role);
      },
    )

    .delete('/roles/:id', requirePermission('users.manage'), async (c) => {
      const role = await loadRole(c, c.req.param('id'));
      if (role.builtin) {
        throw conflict('Vorgegebene Rollen können nicht gelöscht werden');
      }
      const members = (await users.listByPractice(practiceIdOf(c))).filter(
        (user) => user.roleId === role.id,
      );
      if (members.length > 0) {
        throw conflict('Die Rolle ist noch Benutzerkonten zugewiesen');
      }
      await config.deleteItem(practiceIdOf(c), 'roles', role.id);
      await record(c, 'role.deleted', `Rolle „${role.name}“ gelöscht`, role.id);
      return c.body(null, 204);
    });

  app.onError(errorHandler(deps.logger));
  app.notFound(notFoundHandler);
  return app;
}

export type UsersApp = ReturnType<typeof createUsersApp>;
