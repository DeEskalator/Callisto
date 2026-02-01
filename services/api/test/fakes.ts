import { Logger } from '@aws-lambda-powertools/logger';
import { MemoryConfigStore, MemoryUserStore } from '@callisto/data/memory';
import type { UserProfile } from '@callisto/domain';

export { MemoryAuditStore, MemoryCallStore, MemorySlotStore } from '@callisto/data/memory';
export { MemoryUserDirectory, signedInAs } from '../src/dev/memory-directory';

export const PRACTICE_ID = 'main';

/** A config store that holds the test practice with default settings. */
export function testConfigStore(): MemoryConfigStore {
  return MemoryConfigStore.withPractice(PRACTICE_ID, 'Praxis Test', 'NW');
}

export class TestUserStore extends MemoryUserStore {
  /** Adds a user of the test practice with the given role and returns their id. */
  add(id: string, roleId: string, overrides: Partial<UserProfile> = {}): string {
    this.profiles.set(id, {
      id,
      practiceId: PRACTICE_ID,
      email: `${id}@praxis.test`,
      name: `User ${id}`,
      roleId,
      status: 'active',
      createdAt: '2026-11-14T08:00:00.000Z',
      ...overrides,
    });
    return id;
  }
}

export const silentLogger = new Logger({ logLevel: 'SILENT' });

/** The parsed JSON body of a response; untyped, because tests assert on its shape themselves. */
// biome-ignore lint/suspicious/noExplicitAny: see above
export async function bodyOf(response: Response): Promise<any> {
  return response.json();
}

export function jsonRequest(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}
