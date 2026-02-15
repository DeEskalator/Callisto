import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ChevronDown, LogOut, PhoneCall, Settings } from 'lucide-react';
import { DropdownMenu, Menubar } from 'radix-ui';
import { useMe, useStatus } from '../app/queries';
import { useSession } from '../app/session';
import { initialsOf } from '../lib/format';
import { shortcutLabel } from '../lib/platform';
import { setThemePreference, useThemePreference } from '../lib/theme';
import { dropdownEntries, type MenuEntry, menubarEntries } from '../ui/Menu';
import { type Command, useActiveView } from './commands';
import type { NavGroup } from './navigation';

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
 * The menu bar. "Datei" and "Bearbeiten" show the commands of the active view, so every action
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

  // By convention creating and saving live in "Datei", everything else in "Bearbeiten".
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
          label: 'Aktualisieren',
          shortcut: shortcutLabel({ key: 'r', alt: true }),
          onSelect: () => void queryClient.invalidateQueries(),
        },
    { type: 'separator' },
    { label: 'Abmelden', icon: LogOut, onSelect: session.signOut },
  ];

  const editMenu: MenuEntry[] =
    editCommands.length > 0
      ? editCommands.map(commandEntry)
      : [{ label: 'Keine Aktionen in dieser Ansicht', disabled: true, onSelect: () => {} }];

  const viewMenu: MenuEntry[] = [
    { label: 'Navigation anzeigen', checked: props.navVisible, onSelect: props.onToggleNav },
    { type: 'separator' },
    { type: 'label', label: 'Darstellung' },
    {
      label: 'Wie das System',
      checked: theme === 'system',
      onSelect: () => setThemePreference('system'),
    },
    { label: 'Hell', checked: theme === 'light', onSelect: () => setThemePreference('light') },
    { label: 'Dunkel', checked: theme === 'dark', onSelect: () => setThemePreference('dark') },
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
      label: 'Testanruf …',
      icon: PhoneCall,
      disabled: !props.mayTest,
      onSelect: () => props.onShowDialog('testcall'),
    },
    { type: 'separator' },
    {
      label: 'Einstellungen',
      icon: Settings,
      checked: props.settingsOpen,
      shortcut: shortcutLabel({ key: ',', alt: true }),
      onSelect: props.onToggleSettings,
    },
  ];

  const helpMenu: MenuEntry[] = [
    { label: 'Tastenkürzel …', onSelect: () => props.onShowDialog('shortcuts') },
    { type: 'separator' },
    { label: 'Über Callisto …', onSelect: () => props.onShowDialog('about') },
  ];

  const userMenu: MenuEntry[] = [
    ...(session.devUsers
      ? [
          { type: 'label', label: 'Demo-Benutzer wechseln' } as const,
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
    { label: 'Abmelden', icon: LogOut, onSelect: session.signOut },
  ];

  const menus: Array<[string, MenuEntry[]]> = [
    ['Datei', fileMenu],
    ['Bearbeiten', editMenu],
    ['Ansicht', viewMenu],
    ['Gehe zu', goMenu],
    ['Extras', toolsMenu],
    ['Hilfe', helpMenu],
  ];

  return (
    <header className="menubar">
      <span className="menubar__brand">
        <img src="/favicon.svg" alt="" />
        Callisto
      </span>
      <Menubar.Root className="menubar__menus" aria-label="Hauptmenü">
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
          Testanruf
        </button>
      )}
      <button
        type="button"
        className="menubar__action"
        aria-pressed={props.settingsOpen}
        onClick={props.onToggleSettings}
      >
        <Settings />
        Einstellungen
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
