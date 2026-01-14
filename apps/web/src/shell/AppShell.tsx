import { Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { useMe } from '../app/queries';
import { isTyping, matchesShortcut } from '../lib/platform';
import { AboutDialog, ShortcutsDialog } from './AboutDialogs';
import { AppMenubar } from './AppMenubar';
import { viewStore } from './commands';
import { NavTree } from './NavTree';
import { NAVIGATION, type NavItem } from './navigation';
import { StatusBar } from './StatusBar';

const NAV_VISIBLE_KEY = 'callisto.nav-visible';

/** The destinations the signed-in user may see, in menu order. */
export function useVisibleNavigation() {
  const permissions = useMe().data?.role.permissions;
  return useMemo(
    () =>
      NAVIGATION.map((group) => ({
        ...group,
        items: group.items.filter(
          (item) => !item.permission || permissions?.includes(item.permission),
        ),
      })).filter((group) => group.items.length > 0),
    [permissions],
  );
}

/** The application window: menu bar on top, navigation and view in the middle, status bar below. */
export function AppShell() {
  const navigate = useNavigate();
  const navigation = useVisibleNavigation();
  const [navVisible, setNavVisible] = useState(
    () => localStorage.getItem(NAV_VISIBLE_KEY) !== 'false',
  );
  const [dialog, setDialog] = useState<'shortcuts' | 'about'>();
  const layout = useDefaultLayout({
    id: 'callisto.workspace',
    panelIds: navVisible ? ['nav', 'main'] : ['main'],
  });

  const toggleNav = () => {
    setNavVisible((visible) => {
      localStorage.setItem(NAV_VISIBLE_KEY, String(!visible));
      return !visible;
    });
  };

  // Keyboard shortcuts of the window: Alt+1…9 for the destinations, plus those of the commands
  // the active view declares. Keys typed into a field or a dialog are left alone.
  useEffect(() => {
    const destinations: NavItem[] = navigation.flatMap((group) => group.items);
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) {
        return;
      }
      if (event.altKey && /^Digit[1-9]$/.test(event.code)) {
        const destination = destinations[Number(event.code.slice(5)) - 1];
        if (destination) {
          event.preventDefault();
          void navigate({ to: destination.to });
        }
        return;
      }
      for (const command of viewStore.get()?.commands ?? []) {
        // Enter and Delete belong to the focused list, which handles them itself.
        if (!command.shortcut?.alt || command.disabled) {
          continue;
        }
        if (matchesShortcut(event, command.shortcut) && !isTyping(event)) {
          event.preventDefault();
          command.run();
          return;
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigation, navigate]);

  return (
    <div className="app">
      <AppMenubar
        navigation={navigation}
        navVisible={navVisible}
        onToggleNav={toggleNav}
        onShowDialog={setDialog}
      />
      <Group id="callisto.workspace" orientation="horizontal" className="workspace" {...layout}>
        {navVisible && (
          <>
            <Panel
              id="nav"
              defaultSize="216px"
              minSize="160px"
              maxSize="340px"
              groupResizeBehavior="preserve-pixel-size"
            >
              <NavTree navigation={navigation} />
            </Panel>
            <Separator className="pane-separator" />
          </>
        )}
        <Panel id="main" minSize="40%">
          <Outlet />
        </Panel>
      </Group>
      <StatusBar />
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(undefined)} />}
      {dialog === 'about' && <AboutDialog onClose={() => setDialog(undefined)} />}
    </div>
  );
}
