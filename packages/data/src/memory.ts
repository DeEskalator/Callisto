import {
  type AnnouncementPreset,
  type AuditEntry,
  BUILTIN_ROLES,
  type Call,
  DEFAULT_OPENING_HOURS,
  DEFAULT_PRESETS,
  defaultPracticeSettings,
  type FederalState,
  type Inquiry,
  type OpeningHours,
  type PracticeSettings,
  type Slot,
  type SlotStatus,
  type TranscriptTurn,
  type UserProfile,
} from '@callisto/domain';
import type { CollectionItem, PracticeConfig } from './config-repository';
import type { AuditStore, CallStore, ConfigStore, SlotStore, UserStore } from './index';
import type { ConfigCollection } from './keys';

/**
 * In-memory implementations of the stores. They back the tests and the local development
 * server, so the API and the voice agent can run without any AWS resource.
 */

export class MemoryConfigStore implements ConfigStore {
  readonly practices = new Map<string, PracticeConfig>();

  /** A store that already holds one practice with default settings and the built-in roles. */
  static withPractice(practiceId: string, name: string, federalState: FederalState) {
    const store = new MemoryConfigStore();
    store.practices.set(practiceId, {
      practiceId,
      settings: defaultPracticeSettings(name, federalState),
      hours: structuredClone(DEFAULT_OPENING_HOURS),
      closures: [],
      presets: structuredClone(DEFAULT_PRESETS),
      categories: [],
      templates: [],
      roles: structuredClone(BUILTIN_ROLES),
    });
    return store;
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

export class MemoryUserStore implements UserStore {
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
}

export class MemorySlotStore implements SlotStore {
  /** Slots by practice and slot id. */
  readonly slots = new Map<string, Slot>();

  private key(practiceId: string, slotId: string) {
    return `${practiceId}/${slotId}`;
  }

  private ofPractice(practiceId: string): Slot[] {
    return [...this.slots.entries()]
      .filter(([key]) => key.startsWith(`${practiceId}/`))
      .map(([, slot]) => slot)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async listDay(practiceId: string, date: string) {
    return this.ofPractice(practiceId).filter((slot) => slot.date === date);
  }

  async listRange(practiceId: string, from: string, to: string) {
    return this.ofPractice(practiceId).filter((slot) => slot.date >= from && slot.date <= to);
  }

  async get(practiceId: string, slotId: string) {
    return this.slots.get(this.key(practiceId, slotId));
  }

  async findFree(
    practiceId: string,
    categoryId: string,
    from: { date: string; time: string },
    limit: number,
  ) {
    return this.ofPractice(practiceId)
      .filter(
        (slot) =>
          slot.status === 'free' &&
          slot.categoryId === categoryId &&
          `${slot.date}T${slot.startTime}` >= `${from.date}T${from.time}`,
      )
      .slice(0, limit);
  }

  async create(practiceId: string, slots: Slot[]) {
    const missing = slots.filter((slot) => !this.slots.has(this.key(practiceId, slot.id)));
    for (const slot of missing) {
      this.slots.set(this.key(practiceId, slot.id), slot);
    }
    return missing.length;
  }

  async replaceFree(practiceId: string, slots: Slot[]) {
    const replaceable = slots.filter((slot) => {
      const current = this.slots.get(this.key(practiceId, slot.id));
      return !current || current.status === 'free';
    });
    for (const slot of replaceable) {
      this.slots.set(this.key(practiceId, slot.id), slot);
    }
    return replaceable.length;
  }

  async deleteUnbooked(practiceId: string, slots: Array<Pick<Slot, 'id' | 'date' | 'startTime'>>) {
    const unbooked = slots.filter(
      (slot) => this.slots.get(this.key(practiceId, slot.id))?.status !== 'booked',
    );
    for (const slot of unbooked) {
      this.slots.delete(this.key(practiceId, slot.id));
    }
    return unbooked.length;
  }

  async changeStatus(practiceId: string, slot: Slot, to: SlotStatus, inquiryId?: string) {
    const current = this.slots.get(this.key(practiceId, slot.id));
    if (!current || current.status !== slot.status) {
      return false;
    }
    const { inquiryId: _previous, ...rest } = current;
    this.slots.set(this.key(practiceId, slot.id), {
      ...rest,
      status: to,
      ...(to === 'booked' && inquiryId ? { inquiryId } : {}),
    });
    return true;
  }
}

export class MemoryAuditStore implements AuditStore {
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

export class MemoryCallStore implements CallStore {
  readonly calls = new Map<string, Call>();
  readonly turns = new Map<string, TranscriptTurn[]>();
  readonly inquiries = new Map<string, Inquiry>();

  async putCall(call: Call) {
    this.calls.set(call.id, call);
  }

  async getCall(callId: string) {
    return this.calls.get(callId);
  }

  async listCallsByDate(practiceId: string, date: string) {
    return [...this.calls.values()]
      .filter((call) => call.practiceId === practiceId && call.date === date)
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  }

  async appendTurn(callId: string, turn: TranscriptTurn) {
    const turns = this.turns.get(callId) ?? [];
    this.turns.set(callId, [...turns.filter((each) => each.seq !== turn.seq), turn]);
  }

  async listTurns(callId: string) {
    return [...(this.turns.get(callId) ?? [])].sort((left, right) => left.seq - right.seq);
  }

  async putInquiry(inquiry: Inquiry) {
    this.inquiries.set(inquiry.id, inquiry);
  }

  async getInquiry(inquiryId: string) {
    return this.inquiries.get(inquiryId);
  }

  async listInquiriesByDate(practiceId: string, date: string) {
    return this.ofPractice(practiceId).filter((inquiry) => inquiry.date === date);
  }

  async listOpenInquiries(practiceId: string) {
    return this.ofPractice(practiceId).filter(
      (inquiry) => inquiry.status === 'new' || inquiry.status === 'in_progress',
    );
  }

  private ofPractice(practiceId: string): Inquiry[] {
    return [...this.inquiries.values()]
      .filter((inquiry) => inquiry.practiceId === practiceId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }
}
