import { Logger } from '@aws-lambda-powertools/logger';
import type {
  AuditStore,
  CollectionItem,
  ConfigCollection,
  ConfigStore,
  PracticeConfig,
  UserStore,
} from '@callisto/data';
import {
  type AnnouncementPreset,
  type AuditEntry,
  BUILTIN_ROLES,
  DEFAULT_OPENING_HOURS,
  DEFAULT_PRESETS,
  defaultPracticeSettings,
  type OpeningHours,
  type PracticeSettings,
  type UserProfile,
} from '@callisto/domain';
import type { UserDirectory } from '../src/users/directory';
import { UserExistsError } from '../src/users/directory';

export const PRACTICE_ID = 'main';

export class FakeConfigStore implements ConfigStore {
  readonly practices = new Map<string, PracticeConfig>();

  constructor() {
    this.practices.set(PRACTICE_ID, {
      practiceId: PRACTICE_ID,
      settings: defaultPracticeSettings('Praxis Test', 'NW'),
      hours: structuredClone(DEFAULT_OPENING_HOURS),
      closures: [],
      presets: structuredClone(DEFAULT_PRESETS),
      categories: [],
      templates: [],
      roles: structuredClone(BUILTIN_ROLES),
    });
  }

  private practice(practiceId: string): PracticeConfig {
    const practice = this.practices.get(practiceId);
    if (!practice) {
      throw new Error(`Unknown practice ${practiceId}`);
    }
    return practice;
  }

  async load(practiceId: string) {
    const practice = this.practices.get(practiceId);
    return practice ? structuredClone(practice) : undefined;
  }

  async putSettings(practiceId: string, settings: PracticeSettings) {
    this.practice(practiceId).settings = settings;
  }

  async putHours(practiceId: string, hours: OpeningHours) {
    this.practice(practiceId).hours = hours;
  }

  async getItem<C extends ConfigCollection>(practiceId: string, collection: C, id: string) {
    const items = this.practices.get(practiceId)?.[collection] as
      | Array<CollectionItem<C>>
      | undefined;
    return items?.find((item) => item.id === id);
  }

  async putItem<C extends ConfigCollection>(
    practiceId: string,
    collection: C,
    item: CollectionItem<C>,
  ) {
    const items = this.practice(practiceId)[collection] as Array<CollectionItem<C>>;
    const index = items.findIndex((existing) => existing.id === item.id);
    if (index >= 0) {
      items[index] = item;
    } else {
      items.push(item);
    }
  }

  async deleteItem(practiceId: string, collection: ConfigCollection, id: string) {
    const items = this.practice(practiceId)[collection] as Array<{ id: string }>;
    const index = items.findIndex((existing) => existing.id === id);
    if (index >= 0) {
      items.splice(index, 1);
    }
  }

  async createPractice(
    practiceId: string,
    initial: { settings: PracticeSettings; hours: OpeningHours; presets: AnnouncementPreset[] },
  ) {
    if (this.practices.has(practiceId)) {
      return false;
    }
    this.practices.set(practiceId, {
      practiceId,
      ...initial,
      closures: [],
      categories: [],
      templates: [],
      roles: [],
    });
    return true;
  }
}

export class FakeUserStore implements UserStore {
  readonly profiles = new Map<string, UserProfile>();

  async get(userId: string) {
    return this.profiles.get(userId);
  }

  async put(profile: UserProfile) {
    this.profiles.set(profile.id, profile);
  }

  async delete(userId: string) {
    this.profiles.delete(userId);
  }

  async listByPractice(practiceId: string) {
    return [...this.profiles.values()]
      .filter((profile) => profile.practiceId === practiceId)
      .sort((left, right) => left.email.localeCompare(right.email));
  }

  /** Adds a user with one of the built-in roles and returns their id. */
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

export class FakeAuditStore implements AuditStore {
  readonly entries: AuditEntry[] = [];

  async append(entry: AuditEntry) {
    this.entries.push(entry);
  }

  async listMonth(practiceId: string, month: string) {
    return this.entries
      .filter((entry) => entry.practiceId === practiceId && entry.at.startsWith(month))
      .reverse();
  }
}

export class FakeUserDirectory implements UserDirectory {
  readonly accounts = new Map<string, { id: string; enabled: boolean }>();
  readonly invitations: string[] = [];
  private nextId = 1;

  async createUser(email: string) {
    if (this.accounts.has(email)) {
      throw new UserExistsError(email);
    }
    const id = `account-${this.nextId++}`;
    this.accounts.set(email, { id, enabled: true });
    this.invitations.push(email);
    return id;
  }

  async findUserId(email: string) {
    return this.accounts.get(email)?.id;
  }

  async resendInvitation(email: string) {
    this.invitations.push(email);
  }

  async setEnabled(userId: string, enabled: boolean) {
    for (const account of this.accounts.values()) {
      if (account.id === userId) {
        account.enabled = enabled;
      }
    }
  }

  async deleteUser(userId: string) {
    for (const [email, account] of this.accounts) {
      if (account.id === userId) {
        this.accounts.delete(email);
      }
    }
  }
}

export const silentLogger = new Logger({ logLevel: 'SILENT' });

/** The bindings the Lambda adapter passes to the app, as API Gateway's authorizer would fill them. */
export function signedInAs(userId: string | undefined) {
  return {
    event: { requestContext: { authorizer: userId ? { claims: { sub: userId } } : undefined } },
    lambdaContext: {},
  };
}

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
