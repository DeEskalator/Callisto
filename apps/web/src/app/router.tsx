import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { AuditView } from '../features/audit/AuditView';
import { CalendarView } from '../features/calendar/CalendarView';
import { CategoriesView } from '../features/categories/CategoriesView';
import { ClosuresView } from '../features/closures/ClosuresView';
import { OpeningHoursView } from '../features/hours/OpeningHoursView';
import { OverviewView } from '../features/overview/OverviewView';
import { PresetsView } from '../features/presets/PresetsView';
import { PracticeSettingsView } from '../features/settings/PracticeSettingsView';
import { TemplatesView } from '../features/templates/TemplatesView';
import { RolesView } from '../features/users/RolesView';
import { UsersView } from '../features/users/UsersView';
import { AppShell } from '../shell/AppShell';
import type { AppPath } from '../shell/navigation';
import { ViewFrame } from '../shell/ViewFrame';

const rootRoute = createRootRoute({
  component: AppShell,
  notFoundComponent: () => (
    <ViewFrame title="Nicht gefunden" padded>
      <p className="view__intro">Diese Adresse gibt es nicht.</p>
    </ViewFrame>
  ),
});

/** Shown in place of a view that failed to render, so the rest of the window stays usable. */
function ViewError(props: { error: unknown; reset: () => void }) {
  return (
    <ViewFrame title="Fehler" padded>
      <div className="notice notice--danger" role="alert">
        <div>
          <strong>Diese Ansicht konnte nicht angezeigt werden.</strong>{' '}
          {props.error instanceof Error ? props.error.message : ''}
        </div>
      </div>
      <p className="view__intro" style={{ marginTop: 12 }}>
        <button type="button" className="btn" onClick={props.reset}>
          Erneut versuchen
        </button>
      </p>
    </ViewFrame>
  );
}

// One entry per address; `AppPath` makes sure none is missing or misspelled.
const VIEWS: Record<AppPath, () => ReactNode> = {
  '/': OverviewView,
  '/kalender': CalendarView,
  '/vorlagen': TemplatesView,
  '/kategorien': CategoriesView,
  '/sprechzeiten': OpeningHoursView,
  '/schliesszeiten': ClosuresView,
  '/ansagen': PresetsView,
  '/praxis': PracticeSettingsView,
  '/benutzer': UsersView,
  '/rollen': RolesView,
  '/protokoll': AuditView,
};

const route = <Path extends AppPath>(path: Path) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path,
    component: VIEWS[path],
    errorComponent: ViewError,
  });

const routeTree = rootRoute.addChildren([
  route('/'),
  route('/kalender'),
  route('/vorlagen'),
  route('/kategorien'),
  route('/sprechzeiten'),
  route('/schliesszeiten'),
  route('/ansagen'),
  route('/praxis'),
  route('/benutzer'),
  route('/rollen'),
  route('/protokoll'),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
