import { createAdminApp } from '../src/admin/app';
import {
  MemoryAuditStore,
  MemorySlotStore,
  signedInAs,
  silentLogger,
  TestUserStore,
  testConfigStore,
} from './fakes';

// Resolved users are cached per Lambda instance, i.e. across tests. Giving every test its own
// user ids keeps one test's roles from leaking into the next.
let run = 0;

/** A fresh admin app on in-memory stores, with one administrator and one staff member. */
export function setupAdminApp() {
  run += 1;
  const config = testConfigStore();
  const users = new TestUserStore();
  const slots = new MemorySlotStore();
  const audit = new MemoryAuditStore();
  const app = createAdminApp({
    config,
    users,
    slots,
    audit,
    allowedOrigins: ['https://app.praxis.test'],
    logger: silentLogger,
  });
  const admin = users.add(`admin-${run}`, 'admin');
  const staff = users.add(`staff-${run}`, 'staff');
  const call = (userId: string | undefined, path: string, init?: RequestInit) =>
    app.request(`/v1${path}`, init, signedInAs(userId));
  return { config, users, slots, audit, admin, staff, call, run };
}
