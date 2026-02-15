import type { Permission } from '@callisto/domain';
import {
  Building2,
  CalendarDays,
  CalendarOff,
  CalendarRange,
  Clock,
  Gauge,
  Inbox,
  type LucideIcon,
  Megaphone,
  PhoneIncoming,
  ScrollText,
  ShieldCheck,
  Tags,
  Users,
} from 'lucide-react';

/** Every address of the application. The router defines exactly these routes. */
export type AppPath =
  | '/'
  | '/anrufe'
  | '/einstellungen'
  | '/einstellungen/kalender'
  | '/einstellungen/vorlagen'
  | '/einstellungen/kategorien'
  | '/einstellungen/sprechzeiten'
  | '/einstellungen/schliesszeiten'
  | '/einstellungen/ansagen'
  | '/einstellungen/praxis'
  | '/einstellungen/benutzer'
  | '/einstellungen/rollen'
  | '/einstellungen/protokoll';

export interface NavItem {
  to: AppPath;
  label: string;
  icon: LucideIcon;
  /** Hidden from users who lack this permission. */
  permission?: Permission;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/** Addresses below this one are shown in the settings sheet, on top of the daily view. */
export const SETTINGS_ROOT = '/einstellungen';
export const isSettingsPath = (path: string) => path.startsWith(SETTINGS_ROOT);

/** The main window: what happened today and what the practice has to do. */
export const MAIN_NAVIGATION: NavGroup[] = [
  {
    title: 'Tagesgeschehen',
    items: [
      { to: '/', label: 'Anliegen', icon: Inbox, permission: 'dashboard.view' },
      { to: '/anrufe', label: 'Anrufe', icon: PhoneIncoming, permission: 'calls.view' },
    ],
  },
];

/** The settings sheet: everything that is configured once and changed rarely. */
export const SETTINGS_NAVIGATION: NavGroup[] = [
  {
    title: 'Assistent',
    items: [
      { to: '/einstellungen', label: 'Status', icon: Gauge },
      { to: '/einstellungen/sprechzeiten', label: 'Sprechzeiten', icon: Clock },
      { to: '/einstellungen/schliesszeiten', label: 'Urlaub & Schließzeiten', icon: CalendarOff },
      { to: '/einstellungen/ansagen', label: 'Ansagen', icon: Megaphone },
    ],
  },
  {
    title: 'Terminplanung',
    items: [
      { to: '/einstellungen/kalender', label: 'Kalender', icon: CalendarDays },
      { to: '/einstellungen/vorlagen', label: 'Slot-Vorlagen', icon: CalendarRange },
      { to: '/einstellungen/kategorien', label: 'Kategorien', icon: Tags },
    ],
  },
  {
    title: 'Verwaltung',
    items: [
      { to: '/einstellungen/praxis', label: 'Praxis', icon: Building2 },
      {
        to: '/einstellungen/benutzer',
        label: 'Benutzer',
        icon: Users,
        permission: 'users.manage',
      },
      {
        to: '/einstellungen/rollen',
        label: 'Rollen',
        icon: ShieldCheck,
        permission: 'users.manage',
      },
      {
        to: '/einstellungen/protokoll',
        label: 'Protokoll',
        icon: ScrollText,
        permission: 'audit.view',
      },
    ],
  },
];
