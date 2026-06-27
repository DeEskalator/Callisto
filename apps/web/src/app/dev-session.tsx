import { type ReactNode, useMemo, useState } from 'react';
import { localized } from '../lib/i18n';
import { type Session, SessionContext } from './session';

// The demo users seeded by the local API server (services/api/src/dev/server.ts).
const DEV_USERS = [
  {
    id: 'dev-admin',
    label: localized({ de: 'Praxisleitung (Administration)', en: 'Practice manager (admin)' }),
  },
  { id: 'dev-staff', label: localized({ de: 'Empfang (Praxisteam)', en: 'Reception (staff)' }) },
];
const STORAGE_KEY = 'callisto.dev-user';

const storedUserId = () => localStorage.getItem(STORAGE_KEY) ?? DEV_USERS[0]?.id ?? '';

/**
 * Stand-in for the sign-in while developing against the local API server: there is no login,
 * the chosen demo user is sent in a header. Only loaded by the Vite dev server.
 */
export function DevSessionProvider(props: { children: ReactNode }) {
  const [userId, setUserId] = useState(storedUserId);

  const session = useMemo<Session>(
    () => ({
      // Read at call time, so a request issued right after switching already uses the new user.
      authHeaders: async () => ({ 'X-Dev-User': storedUserId() }),
      signOut: () => window.location.reload(),
      devUsers: DEV_USERS,
      devUserId: userId,
      switchDevUser: (next) => {
        localStorage.setItem(STORAGE_KEY, next);
        setUserId(next);
      },
    }),
    [userId],
  );

  return <SessionContext value={session}>{props.children}</SessionContext>;
}
