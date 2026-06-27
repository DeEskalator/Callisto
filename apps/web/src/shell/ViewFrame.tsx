import { createContext, type ReactNode, useContext, useEffect } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { localized } from '../lib/i18n';
import { shortcutLabel } from '../lib/platform';
import { type Command, viewStore } from './commands';

const t = localized({
  de: { actions: (view: string) => `Aktionen: ${view}` },
  en: { actions: (view: string) => `Actions: ${view}` },
});

/**
 * Where a view is shown. While the settings sheet is open, the daily view stays visible behind
 * it but is not the active view: it must not offer its commands to the window.
 */
export const ViewScope = createContext<{ name: 'main' | 'sheet'; active: boolean }>({
  name: 'main',
  active: true,
});

/**
 * The frame every view is rendered in: a toolbar with the view's title and commands, the content
 * and, if the view has one, a detail pane on the right. It also tells the window about the view,
 * so that the menu bar, the keyboard shortcuts and the status bar act on it.
 */
export function ViewFrame(props: {
  title: string;
  commands?: Command[];
  /** Text for the status bar, e.g. "12 entries". */
  status?: string | undefined;
  /** Controls at the right end of the toolbar, e.g. a period switcher. */
  toolbarEnd?: ReactNode;
  /** Detail pane for the selected item. */
  inspector?: { title: string; content: ReactNode };
  /** Adds the usual padding for views that are a page rather than a table. */
  padded?: boolean;
  children: ReactNode;
}) {
  const { title, commands = [], status } = props;
  const scope = useContext(ViewScope);

  // Published on every render so that the commands the window holds are never stale.
  useEffect(() => {
    if (scope.active) {
      viewStore.publish({ title, commands, status });
    }
  });
  useEffect(() => {
    if (scope.active) {
      return () => viewStore.publish(undefined);
    }
  }, [scope.active]);

  const content = (
    <div className={props.padded ? 'view__content view__content--padded' : 'view__content'}>
      {props.children}
    </div>
  );

  return (
    <section className="view" aria-label={title}>
      <div className="toolbar" role="toolbar" aria-label={t.actions(title)}>
        <h1 className="toolbar__title">{title}</h1>
        {commands
          .filter((command) => command.toolbar !== false)
          .map((command) => (
            <button
              key={command.id}
              type="button"
              className="btn btn--ghost"
              disabled={command.disabled}
              title={command.shortcut ? shortcutLabel(command.shortcut) : undefined}
              onClick={command.run}
            >
              {command.icon && <command.icon />}
              {command.label.replace(' …', '')}
            </button>
          ))}
        <div className="toolbar__spacer" />
        {props.toolbarEnd}
      </div>
      {props.inspector ? (
        <WithInspector inspector={props.inspector}>{content}</WithInspector>
      ) : (
        content
      )}
    </section>
  );
}

function WithInspector(props: {
  inspector: { title: string; content: ReactNode };
  children: ReactNode;
}) {
  // The daily view and the sheet can be on screen together; each remembers its own split.
  const id = `callisto.view.${useContext(ViewScope).name}`;
  const layout = useDefaultLayout({ id });
  return (
    <Group id={id} orientation="horizontal" className="view__split" {...layout}>
      <Panel id="content" minSize="35%">
        {props.children}
      </Panel>
      <Separator className="pane-separator" />
      <Panel
        id="inspector"
        defaultSize="320px"
        minSize="240px"
        maxSize="50%"
        groupResizeBehavior="preserve-pixel-size"
      >
        <aside className="inspector" aria-label={props.inspector.title}>
          <div className="inspector__header">{props.inspector.title}</div>
          <div className="inspector__body">{props.inspector.content}</div>
        </aside>
      </Panel>
    </Group>
  );
}
