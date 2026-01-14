const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

/** A keyboard shortcut. `alt` is used instead of Ctrl/Cmd, which browsers reserve for themselves. */
export interface Shortcut {
  key: string;
  alt?: boolean;
  shift?: boolean;
}

const KEY_LABELS: Record<string, string> = {
  Delete: isMac ? '⌫' : 'Entf',
  Enter: isMac ? '↩' : 'Enter',
  Escape: 'Esc',
};

/** How a shortcut is written on this platform, e.g. `⌥N` on a Mac and `Alt+N` elsewhere. */
export function shortcutLabel(shortcut: Shortcut): string {
  const key = KEY_LABELS[shortcut.key] ?? shortcut.key.toUpperCase();
  if (isMac) {
    return `${shortcut.alt ? '⌥' : ''}${shortcut.shift ? '⇧' : ''}${key}`;
  }
  return [shortcut.alt ? 'Alt' : '', shortcut.shift ? 'Umschalt' : '', key]
    .filter(Boolean)
    .join('+');
}

export function matchesShortcut(event: KeyboardEvent, shortcut: Shortcut): boolean {
  if (event.ctrlKey || event.metaKey) {
    return false;
  }
  if (event.altKey !== Boolean(shortcut.alt) || event.shiftKey !== Boolean(shortcut.shift)) {
    return false;
  }
  // With Alt held, macOS reports the composed character in `key`; `code` names the physical key.
  if (shortcut.key.length === 1) {
    const code = /\d/.test(shortcut.key)
      ? `Digit${shortcut.key}`
      : `Key${shortcut.key.toUpperCase()}`;
    return event.code === code;
  }
  return event.key === shortcut.key || (shortcut.key === 'Delete' && event.key === 'Backspace');
}

/** Whether a keystroke is meant for a text field and must not trigger a command. */
export function isTyping(event: KeyboardEvent): boolean {
  const target = event.target;
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}
