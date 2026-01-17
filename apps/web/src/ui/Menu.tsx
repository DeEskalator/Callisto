import { Check, type LucideIcon } from 'lucide-react';
import { ContextMenu, DropdownMenu, Menubar } from 'radix-ui';
import type { ComponentType, ReactNode } from 'react';

/**
 * One line of a menu, described as data. The same description is rendered in the menu bar, in
 * context menus and in dropdowns, which keeps the three in step with each other.
 */
export type MenuEntry =
  | {
      type?: 'item';
      label: string;
      icon?: LucideIcon;
      /** Display text of the keyboard shortcut; the key handling itself lives elsewhere. */
      shortcut?: string;
      disabled?: boolean;
      danger?: boolean;
      /** Shows a check mark, for options that are switched on. */
      checked?: boolean;
      onSelect: () => void;
    }
  | { type: 'separator' }
  | { type: 'label'; label: string };

interface MenuParts {
  Item: ComponentType<{
    className?: string;
    disabled?: boolean;
    onSelect?: () => void;
    children?: ReactNode;
  }>;
  Separator: ComponentType<{ className?: string }>;
  Label: ComponentType<{ className?: string; children?: ReactNode }>;
}

function renderEntries(parts: MenuParts, entries: MenuEntry[]): ReactNode {
  return entries.map((entry, index) => {
    if (entry.type === 'separator') {
      // biome-ignore lint/suspicious/noArrayIndexKey: menu entries have no identity besides their position
      return <parts.Separator key={index} className="menu__separator" />;
    }
    if (entry.type === 'label') {
      return (
        <parts.Label key={entry.label} className="menu__label">
          {entry.label}
        </parts.Label>
      );
    }
    const Icon = entry.checked ? Check : entry.icon;
    return (
      <parts.Item
        key={entry.label}
        className={entry.danger ? 'menu__item menu__item--danger' : 'menu__item'}
        disabled={entry.disabled}
        onSelect={entry.onSelect}
      >
        {Icon && (
          <span className="menu__icon">
            <Icon />
          </span>
        )}
        {entry.label}
        {entry.shortcut && <span className="menu__shortcut">{entry.shortcut}</span>}
      </parts.Item>
    );
  });
}

export const menubarEntries = (entries: MenuEntry[]) => renderEntries(Menubar, entries);
export const contextMenuEntries = (entries: MenuEntry[]) => renderEntries(ContextMenu, entries);
export const dropdownEntries = (entries: MenuEntry[]) => renderEntries(DropdownMenu, entries);
