import { type LucideIcon, Pencil, Plus, RefreshCw, Save, Trash2, Undo2 } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { localized } from '../lib/i18n';
import type { Shortcut } from '../lib/platform';

const t = localized({
  de: {
    edit: 'Bearbeiten …',
    delete: 'Löschen …',
    refresh: 'Aktualisieren',
    save: 'Speichern',
    discard: 'Änderungen verwerfen',
  },
  en: {
    edit: 'Edit …',
    delete: 'Delete …',
    refresh: 'Refresh',
    save: 'Save',
    discard: 'Discard changes',
  },
});

/**
 * Something the user can do in the current view. A view declares its commands once; the toolbar,
 * the menu bar, the context menu and the keyboard shortcuts are all generated from them.
 */
export interface Command {
  id: string;
  label: string;
  icon?: LucideIcon;
  shortcut?: Shortcut;
  disabled?: boolean;
  danger?: boolean;
  /** Commands appear in the toolbar unless this is `false`. */
  toolbar?: boolean;
  run: () => void;
}

// The commands every list view has, with their conventional icons and shortcuts.

export const newCommand = (label: string, run: () => void, disabled = false): Command => ({
  id: 'new',
  label,
  icon: Plus,
  shortcut: { key: 'n', alt: true },
  disabled,
  run,
});

export const editCommand = (run: () => void, disabled: boolean): Command => ({
  id: 'edit',
  label: t.edit,
  icon: Pencil,
  shortcut: { key: 'Enter' },
  disabled,
  run,
});

export const deleteCommand = (run: () => void, disabled: boolean): Command => ({
  id: 'delete',
  label: t.delete,
  icon: Trash2,
  shortcut: { key: 'Delete' },
  disabled,
  danger: true,
  run,
});

export const refreshCommand = (run: () => void): Command => ({
  id: 'refresh',
  label: t.refresh,
  icon: RefreshCw,
  shortcut: { key: 'r', alt: true },
  run,
});

// The two commands of views that are edited as a whole and then saved.

export const saveCommand = (run: () => void, disabled: boolean): Command => ({
  id: 'save',
  label: t.save,
  icon: Save,
  shortcut: { key: 's', alt: true },
  disabled,
  run,
});

export const discardCommand = (run: () => void, disabled: boolean): Command => ({
  id: 'discard',
  label: t.discard,
  icon: Undo2,
  disabled,
  run,
});

/** What the active view tells the surrounding window about itself. */
export interface ViewInfo {
  title: string;
  commands: Command[];
  /** Text for the status bar, e.g. "12 entries". */
  status?: string | undefined;
}

// The active view lives outside React state: it is published on every render of the view, but
// the window only needs to re-render when something visible about it changes.
let activeView: ViewInfo | undefined;
let version = 0;
const listeners = new Set<() => void>();

const visibleStateOf = (view: ViewInfo | undefined) =>
  JSON.stringify([
    view?.title,
    view?.status,
    view?.commands.map((command) => [command.id, command.label, command.disabled]),
  ]);

export const viewStore = {
  publish(view: ViewInfo | undefined): void {
    const changed = visibleStateOf(activeView) !== visibleStateOf(view);
    activeView = view;
    if (changed) {
      version += 1;
      for (const listener of listeners) {
        listener();
      }
    }
  },
  /** The view as of its latest render, so that `run` always sees current state. */
  get: () => activeView,
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useActiveView(): ViewInfo | undefined {
  useSyncExternalStore(subscribe, () => version);
  return activeView;
}
