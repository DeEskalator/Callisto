import type { ConfigStore, UserStore } from '@callisto/data';
import type { Permission } from '@callisto/domain';
import { createMiddleware } from 'hono/factory';
import { ApiError, type AppEnv, type CurrentUser } from './http';

export interface AuthDeps {
  users: UserStore;
  config: ConfigStore;
}

/**
 * How long a resolved user is reused within one Lambda instance. Role changes and deactivations
 * take effect after at most this long, independent of the lifetime of the user's token.
 */
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { user: CurrentUser; expiresAt: number }>();

/** The Cognito `sub` that API Gateway's authorizer verified for this request. */
function subjectOf(event: unknown): string | undefined {
  const claims = (
    event as { requestContext?: { authorizer?: { claims?: Record<string, unknown> } } }
  )?.requestContext?.authorizer?.claims;
  return typeof claims?.sub === 'string' ? claims.sub : undefined;
}

async function resolveUser(userId: string, deps: AuthDeps): Promise<CurrentUser> {
  const cached = cache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }
  const profile = await deps.users.get(userId);
  const role =
    profile?.status === 'active'
      ? await deps.config.getItem(profile.practiceId, 'roles', profile.roleId)
      : undefined;
  if (!profile || !role) {
    throw new ApiError(403, 'no_access', 'Für dieses Konto ist kein Zugriff eingerichtet');
  }
  const user = { profile, role };
  cache.set(userId, { user, expiresAt: Date.now() + CACHE_TTL_MS });
  return user;
}

/** Drops a cached user, e.g. right after their role or status was changed. */
export function forgetUser(userId: string): void {
  cache.delete(userId);
}

/**
 * Identifies the caller. The token itself is verified by API Gateway; this loads the profile and
 * role from the table, which is the single source of truth for what a user may do.
 */
export function authenticate(deps: AuthDeps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const userId = subjectOf(c.env.event);
    if (!userId) {
      throw new ApiError(401, 'unauthenticated', 'Nicht angemeldet');
    }
    c.set('user', await resolveUser(userId, deps));
    await next();
  });
}

export function requirePermission(permission: Permission) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!c.get('user').role.permissions.includes(permission)) {
      throw new ApiError(403, 'forbidden', 'Dafür fehlt die Berechtigung');
    }
    await next();
  });
}
