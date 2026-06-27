import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ChevronDown, LogOut, PhoneCall, Settings } from 'lucide-react';
import { DropdownMenu, Menubar } from 'radix-ui';
import { useMe, useStatus } from '../app/queries';
import { useSession } from '../app/session';
import { initialsOf } from '../lib/format';
import { locale, localized, setLocale } from '../lib/i18n';
import { shortcutLabel } from '../lib/platform';
import { setThemePreference, useThemePreference } from '../lib/theme';
import { dropdownEntries, type MenuEntry, menubarEntries } from '../ui/Menu';
import { type Command, useActiveView } from './commands';
import type { NavGroup } from './navigation';

const t = localized({
  de: {
    refresh: 'Aktualisieren',
    signOut: 'Abmelden',
    noActions: 'Keine Aktionen in dieser Ansicht',
    showNavigation: 'Navigation anzeigen',
    appearance: 'Darstellung',
    system: 'Wie das System',
    light: 'Hell',
    dark: 'Dunkel',
    language: 'Sprache',
    testCall: 'Testanruf',
    settings: 'Einstellungen',
    shortcuts: 'Tastenkürzel …',
    about: 'Über Callisto …',
    switchDemoUser: 'Demo-Benutzer wechseln',
    file: 'Datei',
    edit: 'Bearbeiten',
    view: 'Ansicht',
    go: 'Gehe zu',
    tools: 'Extras',
    help: 'Hilfe',
    mainMenu: 'Hauptmenü',
  },
  en: {
    refresh: 'Refresh',
    signOut: 'Sign out',
    noActions: 'No actions in this view',
    showNavigation: 'Show navigation',
    appearance: 'Appearance',
    system: 'Match system',
    light: 'Light',
    dark: 'Dark',
    language: 'Language',
    testCall: 'Test call',
    settings: 'Settings',
    shortcuts: 'Keyboard shortcuts …',
    about: 'About Callisto …',
    switchDemoUser: 'Switch demo user',
    file: 'File',
    edit: 'Edit',
    view: 'View',
    go: 'Go',
    tools: 'Tools',
    help: 'Help',
    mainMenu: 'Main menu',
  },
});

function commandEntry(command: Command): MenuEntry {
  const entry: MenuEntry = {
    label: command.label,
    onSelect: command.run,
  };
  if (command.icon) {
    entry.icon = command.icon;
  }
  if (command.shortcut) {
    entry.shortcut = shortcutLabel(command.shortcut);
  }
  if (command.disabled) {
    entry.disabled = true;
  }
  if (command.danger) {
    entry.danger = true;
  }
  return entry;
}

/**
 * The menu bar. "File" and "Edit" show the commands of the active view, so every action
 * of a toolbar or context menu can also be found here, together with its shortcut.
 */
export function AppMenubar(props: {
  navigation: NavGroup[];
  navVisible: boolean;
  settingsOpen: boolean;
  /** Whether the user may hold test calls with the assistant. */
  mayTest: boolean;
  onToggleNav: () => void;
  onToggleSettings: () => void;
  onShowDialog: (dialog: 'shortcuts' | 'about' | 'testcall') => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSession();
  const view = useActiveView();
  const theme = useThemePreference();
  const me = useMe().data;
  const practiceName = useStatus().data?.practiceName;

  // By convention creating and saving live in "File", everything else in "Edit".
  const commands = view?.commands ?? [];
  const inFileMenu = (command: Command) => ['new', 'save', 'discard'].includes(command.id);
  const fileCommands = commands.filter(inFileMenu);
  const editCommands = commands.filter(
    (command) => !inFileMenu(command) && command.id !== 'refresh',
  );
  const refresh = commands.find((command) => command.id === 'refresh');

  const fileMenu: MenuEntry[] = [
    ...fileCommands.map(commandEntry),
    ...(fileCommands.length > 0 ? [{ type: 'separator' } as const] : []),
    refresh
      ? commandEntry(refresh)
      : {
          label: t.refresh,
          shortcut: shortcutLabel({ key: 'r', alt: true }),
          onSelect: () => void queryClient.invalidateQueries(),
        },
    { type: 'separator' },
    { label: t.signOut, icon: LogOut, onSelect: session.signOut },
  ];

  const editMenu: MenuEntry[] =
    editCommands.length > 0
      ? editCommands.map(commandEntry)
      : [{ label: t.noActions, disabled: true, onSelect: () => {} }];

  const viewMenu: MenuEntry[] = [
    { label: t.showNavigation, checked: props.navVisible, onSelect: props.onToggleNav },
    { type: 'separator' },
    { type: 'label', label: t.appearance },
    {
      label: t.system,
      checked: theme === 'system',
      onSelect: () => setThemePreference('system'),
    },
    { label: t.light, checked: theme === 'light', onSelect: () => setThemePreference('light') },
    { label: t.dark, checked: theme === 'dark', onSelect: () => setThemePreference('dark') },
    { type: 'separator' },
    { type: 'label', label: t.language },
    // Each language is named in itself, so that it can be found without understanding the other.
    { label: 'Deutsch', checked: locale === 'de', onSelect: () => setLocale('de') },
    { label: 'English', checked: locale === 'en', onSelect: () => setLocale('en') },
  ];

  let position = 0;
  const goMenu: MenuEntry[] = props.navigation.flatMap((group, index) => [
    ...(index > 0 ? [{ type: 'separator' } as const] : []),
    ...group.items.map((item): MenuEntry => {
      position += 1;
      const entry: MenuEntry = {
        label: item.label,
        icon: item.icon,
        onSelect: () => void navigate({ to: item.to }),
      };
      if (position <= 9) {
        entry.shortcut = shortcutLabel({ key: String(position), alt: true });
      }
      return entry;
    }),
  ]);

  const toolsMenu: MenuEntry[] = [
    {
      label: `${t.testCall} …`,
      icon: PhoneCall,
      disabled: !props.mayTest,
      onSelect: () => props.onShowDialog('testcall'),
    },
    { type: 'separator' },
    {
      label: t.settings,
      icon: Settings,
      checked: props.settingsOpen,
      shortcut: shortcutLabel({ key: ',', alt: true }),
      onSelect: props.onToggleSettings,
    },
  ];

  const helpMenu: MenuEntry[] = [
    { label: t.shortcuts, onSelect: () => props.onShowDialog('shortcuts') },
    { type: 'separator' },
    { label: t.about, onSelect: () => props.onShowDialog('about') },
  ];

  const userMenu: MenuEntry[] = [
    ...(session.devUsers
      ? [
          { type: 'label', label: t.switchDemoUser } as const,
          ...session.devUsers.map(
            (user): MenuEntry => ({
              label: user.label,
              checked: user.id === session.devUserId,
              onSelect: () => {
                session.switchDevUser?.(user.id);
                // Everything on screen was loaded for the previous user.
                void queryClient.resetQueries();
              },
            }),
          ),
          { type: 'separator' } as const,
        ]
      : []),
    { label: t.signOut, icon: LogOut, onSelect: session.signOut },
  ];

  const menus: Array<[string, MenuEntry[]]> = [
    [t.file, fileMenu],
    [t.edit, editMenu],
    [t.view, viewMenu],
    [t.go, goMenu],
    [t.tools, toolsMenu],
    [t.help, helpMenu],
  ];

  return (
    <header className="menubar">
      <span className="menubar__brand">
        <img src="/favicon.svg" alt="" />
        Callisto
      </span>
      <Menubar.Root className="menubar__menus" aria-label={t.mainMenu}>
        {menus.map(([label, entries]) => (
          <Menubar.Menu key={label}>
            <Menubar.Trigger className="menubar__trigger">{label}</Menubar.Trigger>
            <Menubar.Portal>
              <Menubar.Content className="menu" align="start" sideOffset={4}>
                {menubarEntries(entries)}
              </Menubar.Content>
            </Menubar.Portal>
          </Menubar.Menu>
        ))}
      </Menubar.Root>
      <span className="menubar__spacer" />
      {practiceName && <span className="menubar__practice">{practiceName}</span>}
      {props.mayTest && (
        <button
          type="button"
          className="menubar__action"
          onClick={() => props.onShowDialog('testcall')}
        >
          <PhoneCall />
          {t.testCall}
        </button>
      )}
      <button
        type="button"
        className="menubar__action"
        aria-pressed={props.settingsOpen}
        onClick={props.onToggleSettings}
      >
        <Settings />
        {t.settings}
      </button>
      {me && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className="menubar__user">
            <span className="avatar" aria-hidden="true">
              {initialsOf(me.profile.name)}
            </span>
            {me.profile.name}
            <ChevronDown size={13} />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu" align="end" sideOffset={4}>
              {dropdownEntries(userMenu)}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </header>
  );
}
