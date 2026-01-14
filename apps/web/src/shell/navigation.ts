import type { Permission } from '@callisto/domain';
import {
  Building2,
  CalendarDays,
  CalendarOff,
  CalendarRange,
  Clock,
  LayoutDashboard,
  type LucideIcon,
  Megaphone,
  ScrollText,
  ShieldCheck,
  Tags,
  Users,
} from 'lucide-react';

/** Every address of the application. The router defines exactly these routes. */
export type AppPath =
  | '/'
  | '/kalender'
  | '/vorlagen'
  | '/kategorien'
  | '/sprechzeiten'
  | '/schliesszeiten'
  | '/ansagen'
  | '/praxis'
  | '/benutzer'
  | '/rollen'
  | '/protokoll';

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

/** The destinations of the application; feeds the navigation pane and the "Gehe zu" menu. */
export const NAVIGATION: NavGroup[] = [
  {
    title: 'Tagesgeschehen',
    items: [{ to: '/', label: 'Übersicht', icon: LayoutDashboard }],
  },
  {
    title: 'Terminplanung',
    items: [
      { to: '/kalender', label: 'Kalender', icon: CalendarDays },
      { to: '/vorlagen', label: 'Slot-Vorlagen', icon: CalendarRange },
      { to: '/kategorien', label: 'Kategorien', icon: Tags },
    ],
  },
  {
    title: 'Assistent',
    items: [
      { to: '/sprechzeiten', label: 'Sprechzeiten', icon: Clock },
      { to: '/schliesszeiten', label: 'Urlaub & Schließzeiten', icon: CalendarOff },
      { to: '/ansagen', label: 'Ansagen', icon: Megaphone },
    ],
  },
  {
    title: 'Verwaltung',
    items: [
      { to: '/praxis', label: 'Praxis', icon: Building2 },
      { to: '/benutzer', label: 'Benutzer', icon: Users, permission: 'users.manage' },
      { to: '/rollen', label: 'Rollen', icon: ShieldCheck, permission: 'users.manage' },
      { to: '/protokoll', label: 'Protokoll', icon: ScrollText, permission: 'audit.view' },
    ],
  },
];
