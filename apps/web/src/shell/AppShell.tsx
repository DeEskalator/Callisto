import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { useHasPermission, useMe, useOpenInquiries } from '../app/queries';
import { CallsView } from '../features/dashboard/CallsView';
import { InquiriesView } from '../features/dashboard/InquiriesView';
import { TestCallDialog } from '../features/testcall/TestCallDialog';
import { isTyping, matchesShortcut } from '../lib/platform';
import { AboutDialog, ShortcutsDialog } from './AboutDialogs';
import { AppMenubar } from './AppMenubar';
import { viewStore } from './commands';
import { NavTree } from './NavTree';
import {
  type AppPath,
  isSettingsPath,
  MAIN_NAVIGATION,
  type NavGroup,
  SETTINGS_NAVIGATION,
  SETTINGS_ROOT,
} from './navigation';
import { SettingsSheet } from './SettingsSheet';
import { StatusBar } from './StatusBar';
import { ViewScope } from './ViewFrame';

const NAV_VISIBLE_KEY = 'callisto.nav-visible';

/** The destinations of a navigation the signed-in user may see. */
function useVisible(navigation: NavGroup[]): NavGroup[] {
  const permissions = useMe().data?.role.permissions;
  return useMemo(
    () =>
      navigation
        .map((group) => ({
          ...group,
          items: group.items.filter(
            (item) => !item.permission || permissions?.includes(item.permission),
          ),
        }))
        .filter((group) => group.items.length > 0),
    [navigation, permissions],
  );
}

/** A dialog or menu is open that the keyboard belongs to. The settings sheet does not count. */
const somethingModalIsOpen = () =>
  document.querySelector(
    '[role="dialog"]:not([data-sheet]), [role="alertdialog"], [role="menu"]',
  ) !== null;

/**
 * The application window. The daily view (inquiries, calls) is the window's content; the
 * settings are a sheet over it; the menu bar and the status bar frame both.
 */
export function AppShell() {
  const navigate = useNavigate();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const settingsOpen = isSettingsPath(path);
  const mainNavigation = useVisible(MAIN_NAVIGATION);
  const settingsNavigation = useVisible(SETTINGS_NAVIGATION);
  const mayTest = useHasPermission('testmode.use');
  const openInquiries = useOpenInquiries().data?.filter((inquiry) => !inquiry.test).length ?? 0;

  const [navVisible, setNavVisible] = useState(
    () => localStorage.getItem(NAV_VISIBLE_KEY) !== 'false',
  );
  const [dialog, setDialog] = useState<'shortcuts' | 'about' | 'testcall'>();
  const layout = useDefaultLayout({
    id: 'callisto.workspace',
    panelIds: navVisible ? ['nav', 'main'] : ['main'],
  });

  // Where the sheet returns to when it is closed, and what is shown behind it meanwhile.
  const lastMainPath = useRef<AppPath>('/');
  if (!settingsOpen) {
    lastMainPath.current = path === '/anrufe' ? '/anrufe' : '/';
  }
  const closeSettings = () => void navigate({ to: lastMainPath.current });
  const openSettings = () => void navigate({ to: SETTINGS_ROOT });

  const toggleNav = () => {
    setNavVisible((visible) => {
      localStorage.setItem(NAV_VISIBLE_KEY, String(!visible));
      return !visible;
    });
  };

  // Keyboard shortcuts of the window: Alt+1…9 for the destinations of the foremost navigation,
  // Escape to close the sheet, plus the shortcuts of the commands the active view declares.
  useEffect(() => {
    const destinations = (settingsOpen ? settingsNavigation : mainNavigation).flatMap(
      (group) => group.items,
    );
    const onKeyDown = (event: KeyboardEvent) => {
      if (somethingModalIsOpen()) {
        return;
      }
      if (event.key === 'Escape' && settingsOpen) {
        event.preventDefault();
        void navigate({ to: lastMainPath.current });
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
      if (event.altKey && event.code === 'Comma') {
        event.preventDefault();
        void navigate({ to: settingsOpen ? lastMainPath.current : SETTINGS_ROOT });
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
  }, [mainNavigation, settingsNavigation, settingsOpen, navigate]);

  const Background = lastMainPath.current === '/anrufe' ? CallsView : InquiriesView;

  return (
    <div className="app">
      <AppMenubar
        navigation={settingsOpen ? settingsNavigation : mainNavigation}
        navVisible={navVisible}
        settingsOpen={settingsOpen}
        mayTest={mayTest}
        onToggleNav={toggleNav}
        onToggleSettings={settingsOpen ? closeSettings : openSettings}
        onShowDialog={setDialog}
      />
      <div className="workspace-area">
        <ViewScope value={{ name: 'main', active: !settingsOpen }}>
          <div className="workspace-area__main" inert={settingsOpen}>
            <Group
              id="callisto.workspace"
              orientation="horizontal"
              className="workspace"
              {...layout}
            >
              {navVisible && (
                <>
                  <Panel
                    id="nav"
                    defaultSize="200px"
                    minSize="150px"
                    maxSize="340px"
                    groupResizeBehavior="preserve-pixel-size"
                  >
                    <NavTree
                      label="Tagesgeschehen"
                      navigation={mainNavigation}
                      badges={{ '/': { count: openInquiries, title: 'Offene Anliegen' } }}
                    />
                  </Panel>
                  <Separator className="pane-separator" />
                </>
              )}
              <Panel id="main" minSize="40%">
                {settingsOpen ? <Background /> : <Outlet />}
              </Panel>
            </Group>
          </div>
        </ViewScope>
        {settingsOpen && (
          <SettingsSheet navigation={settingsNavigation} onClose={closeSettings}>
            <ViewScope value={{ name: 'sheet', active: true }}>
              <Outlet />
            </ViewScope>
          </SettingsSheet>
        )}
      </div>
      <StatusBar />
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(undefined)} />}
      {dialog === 'about' && <AboutDialog onClose={() => setDialog(undefined)} />}
      {dialog === 'testcall' && <TestCallDialog onClose={() => setDialog(undefined)} />}
    </div>
  );
}
