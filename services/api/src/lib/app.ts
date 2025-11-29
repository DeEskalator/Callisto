import type { Logger } from '@aws-lambda-powertools/logger';
import type { AuditStore } from '@callisto/data';
import { newId } from '@callisto/domain';
import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { cors } from 'hono/cors';
import { ApiError, type AppEnv, problemResponse } from './http';

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

/** CORS for the actual requests; the preflight is answered by API Gateway without a Lambda call. */
export function corsFor(allowedOrigins: string[]) {
  return cors({
    origin: allowedOrigins,
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    maxAge: 600,
  });
}

export function errorHandler(logger: Logger): ErrorHandler<AppEnv> {
  return (error, c) => {
    if (error instanceof ApiError) {
      return problemResponse(c, { title: error.message, status: error.status, code: error.code });
    }
    // Request bodies are never logged: they can contain patient data.
    logger.error('Unhandled error', { error, path: c.req.path, method: c.req.method });
    return problemResponse(c, {
      title: 'Es ist ein interner Fehler aufgetreten',
      status: 500,
      code: 'internal_error',
    });
  };
}

export const notFoundHandler: NotFoundHandler<AppEnv> = (c) =>
  problemResponse(c, { title: 'Diese Adresse gibt es nicht', status: 404, code: 'not_found' });

/** Returns a function that writes an audit entry on behalf of the current user. */
export function auditor(audit: AuditStore) {
  return async (c: Context<AppEnv>, action: string, summary: string, targetId?: string) => {
    const { profile } = c.get('user');
    await audit.append({
      id: newId(),
      practiceId: profile.practiceId,
      at: new Date().toISOString(),
      actorId: profile.id,
      actorName: profile.name,
      action,
      targetId,
      summary,
    });
  };
}
