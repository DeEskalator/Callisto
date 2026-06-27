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
import { localized } from '../lib/i18n';

const t = localized({
  de: {
    today: 'Tagesgeschehen',
    inquiries: 'Anliegen',
    calls: 'Anrufe',
    assistant: 'Assistent',
    status: 'Status',
    hours: 'Sprechzeiten',
    closures: 'Urlaub & Schließzeiten',
    presets: 'Ansagen',
    scheduling: 'Terminplanung',
    calendar: 'Kalender',
    templates: 'Slot-Vorlagen',
    categories: 'Kategorien',
    administration: 'Verwaltung',
    practice: 'Praxis',
    users: 'Benutzer',
    roles: 'Rollen',
    audit: 'Protokoll',
  },
  en: {
    today: 'Today',
    inquiries: 'Inquiries',
    calls: 'Calls',
    assistant: 'Assistant',
    status: 'Status',
    hours: 'Opening hours',
    closures: 'Vacation & closures',
    presets: 'Announcements',
    scheduling: 'Scheduling',
    calendar: 'Calendar',
    templates: 'Slot templates',
    categories: 'Categories',
    administration: 'Administration',
    practice: 'Practice',
    users: 'Users',
    roles: 'Roles',
    audit: 'Audit log',
  },
});

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
    title: t.today,
    items: [
      { to: '/', label: t.inquiries, icon: Inbox, permission: 'dashboard.view' },
      { to: '/anrufe', label: t.calls, icon: PhoneIncoming, permission: 'calls.view' },
    ],
  },
];

/** The settings sheet: everything that is configured once and changed rarely. */
export const SETTINGS_NAVIGATION: NavGroup[] = [
  {
    title: t.assistant,
    items: [
      { to: '/einstellungen', label: t.status, icon: Gauge },
      { to: '/einstellungen/sprechzeiten', label: t.hours, icon: Clock },
      { to: '/einstellungen/schliesszeiten', label: t.closures, icon: CalendarOff },
      { to: '/einstellungen/ansagen', label: t.presets, icon: Megaphone },
    ],
  },
  {
    title: t.scheduling,
    items: [
      { to: '/einstellungen/kalender', label: t.calendar, icon: CalendarDays },
      { to: '/einstellungen/vorlagen', label: t.templates, icon: CalendarRange },
      { to: '/einstellungen/kategorien', label: t.categories, icon: Tags },
    ],
  },
  {
    title: t.administration,
    items: [
      { to: '/einstellungen/praxis', label: t.practice, icon: Building2 },
      {
        to: '/einstellungen/benutzer',
        label: t.users,
        icon: Users,
        permission: 'users.manage',
      },
      {
        to: '/einstellungen/rollen',
        label: t.roles,
        icon: ShieldCheck,
        permission: 'users.manage',
      },
      {
        to: '/einstellungen/protokoll',
        label: t.audit,
        icon: ScrollText,
        permission: 'audit.view',
      },
    ],
  },
];
