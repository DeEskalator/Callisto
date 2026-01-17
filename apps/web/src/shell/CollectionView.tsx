import { useMutation } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { errorMessage } from '../app/api';
import { DataGrid, type GridColumn } from '../ui/DataGrid';
import type { MenuEntry } from '../ui/Menu';
import { ConfirmDialog } from '../ui/Modal';
import { useNotify } from '../ui/Toast';
import { type Command, deleteCommand, editCommand, newCommand, refreshCommand } from './commands';
import { ViewFrame } from './ViewFrame';

interface CollectionViewProps<Item> {
  title: string;
  /** Singular and plural of what the list holds, for the status bar ("3 Kategorien"). */
  noun: [singular: string, plural: string];
  items: Item[];
  itemId: (item: Item) => string;
  itemName: (item: Item) => string;
  columns: GridColumn<Item>[];
  initialSort?: { columnId: string; descending: boolean };
  /** Whether the user may create, change and delete; without it the list is read-only. */
  canManage: boolean;
  newLabel: string;
  empty: { title: string; hint?: string };
  onRefresh: () => void;
  /** Content of the detail pane for the selected item. */
  details: (item: Item) => ReactNode;
  /** The dialog to create (`item` undefined) or edit an item. Call `saved` with the stored item. */
  dialog: (props: {
    item: Item | undefined;
    close: () => void;
    saved: (item: Item) => void;
  }) => ReactNode;
  /** Whether an item can be changed or deleted at all; e.g. built-in roles cannot. */
  canEdit?: (item: Item) => boolean;
  canDelete?: (item: Item) => boolean;
  /** What the confirmation asks before deleting. */
  deleteText: (item: Item) => ReactNode;
  /** Deletes the item on the server and refreshes whatever depends on it. */
  onDelete: (item: Item) => Promise<unknown>;
  /** Commands beyond new, edit and delete, for the selected item. */
  extraCommands?: (selected: Item | undefined) => Command[];
  /** Shown above the list, e.g. a hint. */
  header?: ReactNode;
}

/**
 * The standard view for a list of things that can be created, edited and deleted: a sortable
 * table, a detail pane and a dialog. Toolbar, menu bar, context menu and keyboard all offer the
 * same commands, as one expects from a desktop application.
 */
export function CollectionView<Item>(props: CollectionViewProps<Item>) {
  const { items, itemId, itemName, canManage } = props;
  const notify = useNotify();
  const [selectedId, setSelectedId] = useState<string>();
  const [editing, setEditing] = useState<Item | 'new'>();
  const [deleting, setDeleting] = useState<Item>();

  const selected = items.find((item) => itemId(item) === selectedId);
  const editable = (item: Item | undefined): item is Item =>
    item !== undefined && canManage && (props.canEdit?.(item) ?? true);
  const deletable = (item: Item | undefined): item is Item =>
    item !== undefined && canManage && (props.canDelete?.(item) ?? true);

  const remove = useMutation({
    mutationFn: props.onDelete,
    onSuccess: (_result, item) => {
      setDeleting(undefined);
      notify({ kind: 'success', title: `„${itemName(item)}“ wurde gelöscht` });
    },
  });

  const extra = props.extraCommands?.(selected) ?? [];
  const commands: Command[] = [
    newCommand(props.newLabel, () => setEditing('new'), !canManage),
    editCommand(() => selected && setEditing(selected), !editable(selected)),
    ...extra,
    deleteCommand(() => selected && setDeleting(selected), !deletable(selected)),
    refreshCommand(props.onRefresh),
  ];

  const contextMenu = (item: Item | undefined): MenuEntry[] => {
    if (!item) {
      return [
        {
          label: props.newLabel,
          icon: Plus,
          disabled: !canManage,
          onSelect: () => setEditing('new'),
        },
      ];
    }
    return [
      {
        label: 'Bearbeiten …',
        icon: Pencil,
        disabled: !editable(item),
        onSelect: () => setEditing(item),
      },
      // The extra commands act on the selection, which a right-click has just moved to `item`.
      ...(props.extraCommands?.(item) ?? []).map(
        (command): MenuEntry => ({
          label: command.label,
          disabled: command.disabled ?? false,
          onSelect: command.run,
          ...(command.icon ? { icon: command.icon } : {}),
        }),
      ),
      { type: 'separator' },
      {
        label: 'Löschen …',
        icon: Trash2,
        danger: true,
        disabled: !deletable(item),
        onSelect: () => setDeleting(item),
      },
    ];
  };

  const count = items.length;
  return (
    <ViewFrame
      title={props.title}
      commands={commands}
      status={`${count} ${count === 1 ? props.noun[0] : props.noun[1]}`}
      inspector={{
        title: 'Details',
        content: selected ? (
          props.details(selected)
        ) : (
          <div className="inspector__empty">Kein Eintrag ausgewählt</div>
        ),
      }}
    >
      <div className="collection">
        {props.header}
        <DataGrid
          label={props.title}
          columns={props.columns}
          rows={items}
          rowId={itemId}
          selectedId={selectedId}
          onSelect={setSelectedId}
          contextMenu={contextMenu}
          empty={props.empty}
          {...(props.initialSort ? { initialSort: props.initialSort } : {})}
          {...(canManage
            ? {
                onOpen: (item: Item) => editable(item) && setEditing(item),
                onDelete: (item: Item) => deletable(item) && setDeleting(item),
              }
            : {})}
        />
      </div>

      {editing &&
        props.dialog({
          item: editing === 'new' ? undefined : editing,
          close: () => setEditing(undefined),
          saved: (item) => {
            setSelectedId(itemId(item));
            setEditing(undefined);
            notify({ kind: 'success', title: `„${itemName(item)}“ wurde gespeichert` });
          },
        })}
      {deleting && (
        <ConfirmDialog
          title={`${props.noun[0]} löschen`}
          text={props.deleteText(deleting)}
          confirmLabel="Löschen"
          danger
          busy={remove.isPending}
          error={remove.isError ? errorMessage(remove.error) : undefined}
          onConfirm={() => remove.mutate(deleting)}
          onCancel={() => {
            remove.reset();
            setDeleting(undefined);
          }}
        />
      )}
    </ViewFrame>
  );
}
