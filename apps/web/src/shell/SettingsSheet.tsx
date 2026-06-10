import { type ReactNode, useEffect, useRef } from 'react';
import { NavTree } from './NavTree';
import type { NavGroup } from './navigation';

/**
 * The settings, shown as a sheet that comes down over the daily view. The daily view stays
 * visible behind it, dimmed and out of reach, and is back the moment the sheet is closed. The
 * menu bar above stays usable and acts on whatever the sheet shows.
 */
export function SettingsSheet(props: {
  navigation: NavGroup[];
  onClose: () => void;
  children: ReactNode;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  // Keyboard users land in the sheet, not in the view behind it.
  useEffect(() => sheet.current?.focus(), []);

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: clicking beside a sheet dismisses it; Escape and the button do the same */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: see above */}
      <div className="sheet-backdrop" onClick={props.onClose} />
      <div
        className="sheet"
        role="dialog"
        aria-label="Einstellungen"
        data-sheet
        tabIndex={-1}
        ref={sheet}
      >
        <header className="sheet__header">
          <span className="sheet__title">Einstellungen</span>
          <button type="button" className="btn" onClick={props.onClose}>
            Fertig
          </button>
        </header>
        <div className="sheet__body">
          <div className="sheet__nav">
            <NavTree label="Einstellungen" navigation={props.navigation} />
          </div>
          <div className="sheet__view">{props.children}</div>
        </div>
      </div>
    </>
  );
}
