import type { AuditRepository } from './audit-repository';
import type { CallRepository } from './call-repository';
import type { ConfigRepository } from './config-repository';
import type { SlotRepository } from './slot-repository';
import type { UserRepository } from './user-repository';

export * from './audit-repository';
export * from './call-repository';
export * from './client';
export * from './config-repository';
export * from './keys';
export * from './slot-repository';
export * from './ticket';
export * from './user-repository';

// The public surface of each repository. Code that only needs to read and write depends on these,
// so it can be handed an in-memory implementation in tests.
export type ConfigStore = Pick<ConfigRepository, keyof ConfigRepository>;
export type UserStore = Pick<UserRepository, keyof UserRepository>;
export type AuditStore = Pick<AuditRepository, keyof AuditRepository>;
export type SlotStore = Pick<SlotRepository, keyof SlotRepository>;
export type CallStore = Pick<CallRepository, keyof CallRepository>;
