import { createHmac, timingSafeEqual } from 'node:crypto';

/** Who may open a test conversation with the assistant, and until when. */
export interface TestTicket {
  practiceId: string;
  userId: string;
  /** Expiry as epoch milliseconds. */
  expiresAt: number;
}

const sign = (payload: string, secret: string) =>
  createHmac('sha256', secret).update(payload).digest('base64url');

/**
 * Issues a short-lived ticket for the voice agent's WebSocket. A browser cannot send an
 * Authorization header when it opens a WebSocket, so the API (which has verified the user)
 * hands out a signed ticket that the voice agent can check on its own.
 */
export function issueTestTicket(ticket: TestTicket, secret: string): string {
  const payload = Buffer.from(JSON.stringify(ticket)).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

/** The ticket's content if its signature is valid and it has not expired. */
export function verifyTestTicket(
  token: string,
  secret: string,
  now: number = Date.now(),
): TestTicket | undefined {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) {
    return undefined;
  }
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return undefined;
  }
  try {
    const ticket: TestTicket = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return ticket.expiresAt > now ? ticket : undefined;
  } catch {
    return undefined;
  }
}
