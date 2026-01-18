import type { Role, UserProfile } from '@callisto/domain';
import { zValidator } from '@hono/zod-validator';
import type { Context } from 'hono';
import type { LambdaContext, LambdaEvent } from 'hono/aws-lambda';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';

export interface CurrentUser {
  profile: UserProfile;
  role: Role;
}

export type AppEnv = {
  Bindings: { event: LambdaEvent; lambdaContext: LambdaContext };
  Variables: { user: CurrentUser };
};

/** Error body of every non-2xx response, following RFC 9457 (problem details). */
export interface Problem {
  title: string;
  status: number;
  /** Stable, machine-readable reason. */
  code: string;
  issues?: Array<{ path: string; message: string }>;
}

/** An error that is meant for the caller; everything else becomes a generic 500. */
export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;

  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const notFound = (what: string) =>
  new ApiError(404, 'not_found', `${what} wurde nicht gefunden`);
export const conflict = (message: string) => new ApiError(409, 'conflict', message);
export const unprocessable = (message: string) => new ApiError(422, 'unprocessable', message);

export function problemResponse(c: Context, problem: Problem) {
  return c.json(problem, problem.status as ContentfulStatusCode, {
    'Content-Type': 'application/problem+json',
  });
}

function validationProblem(c: Context, error: z.core.$ZodError) {
  const problem: Problem = {
    title: 'Die Eingabe ist ungültig',
    status: 400,
    code: 'validation_failed',
    issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  };
  // The status is spelled out because this response becomes part of the route's type: the typed
  // client can only tell it apart from the success response by its literal status.
  return c.json(problem, 400, { 'Content-Type': 'application/problem+json' });
}

export const validateJson = <Schema extends z.ZodType>(schema: Schema) =>
  zValidator('json', schema, (result, c) => {
    if (!result.success) {
      return validationProblem(c, result.error);
    }
  });

export const validateQuery = <Schema extends z.ZodType>(schema: Schema) =>
  zValidator('query', schema, (result, c) => {
    if (!result.success) {
      return validationProblem(c, result.error);
    }
  });
