import type { AdminApp, CallsApp, Problem, UsersApp } from '@callisto/api';
import { hc } from 'hono/client';
import { createContext, useContext } from 'react';
import { localized } from '../lib/i18n';
import type { Session } from './session';

const t = localized({
  de: {
    expired: 'Die Anmeldung ist abgelaufen. Bitte melden Sie sich erneut an.',
    failed: (status: number) => `Die Anfrage ist fehlgeschlagen (${status})`,
    unexpected: 'Es ist ein unerwarteter Fehler aufgetreten.',
    unreachable: 'Der Server ist nicht erreichbar.',
  },
  en: {
    expired: 'Your session has expired. Please sign in again.',
    failed: (status: number) => `The request failed (${status})`,
    unexpected: 'An unexpected error occurred.',
    unreachable: 'The server cannot be reached.',
  },
});

/** A request the API rejected, with the German message the server sent for the user. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: NonNullable<Problem['issues']>;

  constructor(status: number, code: string, message: string, issues: Problem['issues'] = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const problem: Problem = await response.json();
    return new ApiError(response.status, problem.code, problem.title, problem.issues);
  } catch {
    // Errors raised by API Gateway itself do not follow our problem format.
    const message = response.status === 401 ? t.expired : t.failed(response.status);
    return new ApiError(response.status, 'gateway_error', message);
  }
}

interface JsonResponse {
  ok: boolean;
  json(): Promise<unknown>;
}

/**
 * The body type of a typed response without its error variants. Those are the ones whose `ok` is
 * known to be `false`; a route that does not state its status has `ok: boolean` and is kept.
 */
type SuccessBody<R extends JsonResponse> = Awaited<ReturnType<Exclude<R, { ok: false }>['json']>>;

/**
 * The parsed body of a response. The client's types also describe the error bodies a route can
 * answer with, but those never arrive here because the client throws for them (see below); this
 * narrows the type to what is actually left.
 */
export async function data<R extends JsonResponse>(response: Promise<R>): Promise<SuccessBody<R>> {
  return (await response).json() as Promise<SuccessBody<R>>;
}

/** A message for the user for anything a request can throw. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const details = error.issues.map((issue) => issue.message).join(' ');
    return details ? `${error.message}: ${details}` : error.message;
  }
  return t.unexpected;
}

/**
 * The typed API client. Its shape is derived from the route definitions of the API itself, so
 * a renamed route or changed payload shows up here as a type error.
 */
export function createApiClient(baseUrl: string, session: Session) {
  const authorizedFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    for (const [name, value] of Object.entries(await session.authHeaders())) {
      headers.set(name, value);
    }
    let response: Response;
    try {
      response = await fetch(input, { ...init, headers });
    } catch {
      throw new ApiError(0, 'network', t.unreachable);
    }
    if (!response.ok) {
      throw await toApiError(response);
    }
    return response;
  };
  return {
    admin: hc<AdminApp>(baseUrl, { fetch: authorizedFetch }).v1,
    calls: hc<CallsApp>(baseUrl, { fetch: authorizedFetch }).v1,
    users: hc<UsersApp>(baseUrl, { fetch: authorizedFetch }).v1,
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

export const ApiContext = createContext<ApiClient | null>(null);

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (!api) {
    throw new Error('useApi must be used below the API provider');
  }
  return api;
}
