/**
 * Key schema of the planning table (configuration, users, slots, audit log).
 *
 * | Item              | PK                              | SK                  | GSI1PK / GSI1SK                              |
 * | ----------------- | ------------------------------- | ------------------- | -------------------------------------------- |
 * | Settings          | PRACTICE#<p>                    | SETTINGS            |                                              |
 * | Opening hours     | PRACTICE#<p>                    | HOURS               |                                              |
 * | Closure           | PRACTICE#<p>                    | CLOSURE#<id>        |                                              |
 * | Preset            | PRACTICE#<p>                    | PRESET#<id>         |                                              |
 * | Category          | PRACTICE#<p>                    | CATEGORY#<id>       |                                              |
 * | Slot template     | PRACTICE#<p>                    | TEMPLATE#<id>       |                                              |
 * | Role              | PRACTICE#<p>                    | ROLE#<id>           |                                              |
 * | User profile      | USER#<sub>                      | PROFILE             | PRACTICE#<p>#USERS / <email>                 |
 * | Slot              | PRACTICE#<p>#SLOTS#<date>       | <HH:mm>#<slotId>    | PRACTICE#<p>#FREE#<category> / <date>T<HH:mm>#<slotId> (only while free) |
 * | Audit entry       | PRACTICE#<p>#AUDIT#<yyyy-mm>    | <timestamp>#<id>    |                                              |
 *
 * The whole configuration of a practice lives in one partition, so one query loads everything
 * the assistant needs at the start of a call. A user profile is keyed by the Cognito `sub`
 * because that is all an incoming request carries.
 */

export const GSI1 = 'GSI1';

export const practicePk = (practiceId: string) => `PRACTICE#${practiceId}`;

/** Sort key prefixes of the collections in a practice's configuration partition. */
export const COLLECTION_PREFIX = {
  closures: 'CLOSURE#',
  presets: 'PRESET#',
  categories: 'CATEGORY#',
  templates: 'TEMPLATE#',
  roles: 'ROLE#',
} as const;
export type ConfigCollection = keyof typeof COLLECTION_PREFIX;

export const SETTINGS_SK = 'SETTINGS';
export const HOURS_SK = 'HOURS';

export const userKey = (userId: string) => ({ PK: `USER#${userId}`, SK: 'PROFILE' });
export const practiceUsersPk = (practiceId: string) => `PRACTICE#${practiceId}#USERS`;

export const auditPk = (practiceId: string, month: string) =>
  `PRACTICE#${practiceId}#AUDIT#${month}`;

/** One partition per day keeps a day's calendar in a single query. */
export const slotKey = (
  practiceId: string,
  slot: { id: string; date: string; startTime: string },
) => ({
  PK: `PRACTICE#${practiceId}#SLOTS#${slot.date}`,
  SK: `${slot.startTime}#${slot.id}`,
});
export const slotDayPk = (practiceId: string, date: string) =>
  `PRACTICE#${practiceId}#SLOTS#${date}`;

/**
 * Index entry that only free slots carry. Booking a slot removes it, so "the next free slots of a
 * category" is one index query that never has to skip over booked ones.
 */
export const freeSlotIndexKey = (
  practiceId: string,
  slot: { id: string; categoryId: string; date: string; startTime: string },
) => ({
  GSI1PK: freeSlotsPk(practiceId, slot.categoryId),
  GSI1SK: `${slot.date}T${slot.startTime}#${slot.id}`,
});
export const freeSlotsPk = (practiceId: string, categoryId: string) =>
  `PRACTICE#${practiceId}#FREE#${categoryId}`;
