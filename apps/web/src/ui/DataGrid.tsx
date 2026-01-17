import { ArrowDown, ArrowUp } from 'lucide-react';
import { ContextMenu } from 'radix-ui';
import {
  type KeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { contextMenuEntries, type MenuEntry } from './Menu';

export interface GridColumn<Row> {
  id: string;
  header: string;
  /** Initial width in pixels; the user can drag the column edge to change it. */
  width: number;
  render: (row: Row) => ReactNode;
  /** What the column sorts by. Columns without it cannot be sorted. */
  sortValue?: (row: Row) => string | number | boolean | undefined;
  align?: 'right';
  muted?: boolean;
}

interface Sort {
  columnId: string;
  descending: boolean;
}

interface DataGridProps<Row> {
  /** Accessible name, e.g. "Schließzeiten". */
  label: string;
  columns: GridColumn<Row>[];
  rows: Row[];
  rowId: (row: Row) => string;
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
  /** Double click or Enter on a row. */
  onOpen?: (row: Row) => void;
  /** Delete or Backspace on the selected row. */
  onDelete?: (row: Row) => void;
  /** Entries of the context menu; `row` is undefined for a click on empty space. */
  contextMenu?: (row: Row | undefined) => MenuEntry[];
  initialSort?: Sort;
  empty: { title: string; hint?: string };
}

const MIN_COLUMN_WIDTH = 48;
const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

function compareValues(left: unknown, right: unknown): number {
  if (left === undefined || right === undefined) {
    // Rows without a value go last.
    return left === right ? 0 : left === undefined ? 1 : -1;
  }
  if (typeof left === 'string' && typeof right === 'string') {
    return collator.compare(left, right);
  }
  return Number(left) - Number(right);
}

/**
 * A table that behaves like the list views of desktop applications: click a header to sort, drag
 * a column edge to resize, move the selection with the arrow keys, open with Enter or a double
 * click, delete with the Delete key, right-click for the context menu.
 */
export function DataGrid<Row>(props: DataGridProps<Row>) {
  const { columns, rows, rowId, selectedId, onSelect } = props;
  const [sort, setSort] = useState<Sort | undefined>(props.initialSort);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [menuRowId, setMenuRowId] = useState<string>();
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  const sortedRows = useMemo(() => {
    const column = columns.find((candidate) => candidate.id === sort?.columnId);
    const sortValue = column?.sortValue;
    if (!sort || !sortValue) {
      return rows;
    }
    const direction = sort.descending ? -1 : 1;
    return [...rows].sort(
      (left, right) => direction * compareValues(sortValue(left), sortValue(right)),
    );
  }, [rows, columns, sort]);

  // Keep the selected row in view when the selection moves by keyboard.
  useEffect(() => {
    if (selectedId) {
      bodyRef.current
        ?.querySelector(`[data-row-id="${CSS.escape(selectedId)}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedId]);

  const rowById = (id: string | undefined) => sortedRows.find((row) => rowId(row) === id);

  const toggleSort = (column: GridColumn<Row>) => {
    if (!column.sortValue) {
      return;
    }
    setSort((current) => ({
      columnId: column.id,
      descending: current?.columnId === column.id ? !current.descending : false,
    }));
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>, column: GridColumn<Row>) => {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = widths[column.id] ?? column.width;
    handle.setPointerCapture(event.pointerId);
    handle.dataset.resizing = 'true';

    const move = (moveEvent: PointerEvent) => {
      const width = Math.max(MIN_COLUMN_WIDTH, startWidth + moveEvent.clientX - startX);
      setWidths((current) => ({ ...current, [column.id]: width }));
    };
    const stop = () => {
      handle.dataset.resizing = 'false';
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || sortedRows.length === 0) {
      return;
    }
    const index = sortedRows.findIndex((row) => rowId(row) === selectedId);
    const selected = sortedRows[index];
    const moveTo = (target: number) => {
      const row = sortedRows[Math.max(0, Math.min(sortedRows.length - 1, target))];
      if (row) {
        onSelect(rowId(row));
      }
      event.preventDefault();
    };
    switch (event.key) {
      case 'ArrowDown':
        return moveTo(index + 1);
      case 'ArrowUp':
        return moveTo(index < 0 ? 0 : index - 1);
      case 'Home':
        return moveTo(0);
      case 'End':
        return moveTo(sortedRows.length - 1);
      case 'Enter':
        if (selected && props.onOpen) {
          props.onOpen(selected);
          event.preventDefault();
        }
        return;
      case 'Delete':
      case 'Backspace':
        if (selected && props.onDelete) {
          props.onDelete(selected);
          event.preventDefault();
        }
        return;
    }
  };

  const rowIdAt = (target: EventTarget) =>
    target instanceof Element
      ? target.closest<HTMLElement>('[data-row-id]')?.dataset.rowId
      : undefined;

  const menuEntries = props.contextMenu?.(rowById(menuRowId)) ?? [];

  const table = (
    <div className="grid__scroll">
      <table className="grid__table" aria-label={props.label}>
        <colgroup>
          {columns.map((column) => (
            <col key={column.id} style={{ width: widths[column.id] ?? column.width }} />
          ))}
          {/* Takes up what is left, so the columns keep their widths in a wide window. */}
          <col />
        </colgroup>
        <thead className="grid__head">
          <tr>
            {columns.map((column) => {
              const sorted = sort?.columnId === column.id;
              return (
                <th
                  key={column.id}
                  scope="col"
                  data-sortable={Boolean(column.sortValue)}
                  aria-sort={sorted ? (sort.descending ? 'descending' : 'ascending') : undefined}
                  onClick={() => toggleSort(column)}
                >
                  <span className="grid__head-content">
                    {column.header}
                    {sorted &&
                      (sort.descending ? (
                        <ArrowDown className="grid__sort" />
                      ) : (
                        <ArrowUp className="grid__sort" />
                      ))}
                  </span>
                  <div
                    className="grid__resizer"
                    onPointerDown={(event) => startResize(event, column)}
                    onClick={(event) => event.stopPropagation()}
                    aria-hidden="true"
                  />
                </th>
              );
            })}
            <th />
          </tr>
        </thead>
        <tbody ref={bodyRef}>
          {sortedRows.map((row) => {
            const id = rowId(row);
            return (
              <tr key={id} className="grid__row" data-row-id={id} aria-selected={id === selectedId}>
                {columns.map((column) => (
                  <td
                    key={column.id}
                    className={[
                      column.align === 'right' ? 'grid__cell--numeric' : '',
                      column.muted ? 'grid__cell--muted' : '',
                    ].join(' ')}
                  >
                    {column.render(row)}
                  </td>
                ))}
                <td />
              </tr>
            );
          })}
        </tbody>
      </table>
      {sortedRows.length === 0 && (
        <div className="grid__empty">
          <strong>{props.empty.title}</strong>
          {props.empty.hint && <span>{props.empty.hint}</span>}
        </div>
      )}
    </div>
  );

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: the grid is one focus stop; rows are reached with the arrow keys */}
        <div
          className="grid"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: see above
          tabIndex={0}
          onKeyDown={onKeyDown}
          onClick={(event) => {
            // Sorting or resizing a column leaves the selection alone.
            if (!(event.target instanceof Element && event.target.closest('thead'))) {
              onSelect(rowIdAt(event.target));
            }
          }}
          onDoubleClick={(event) => {
            const row = rowById(rowIdAt(event.target));
            if (row) {
              props.onOpen?.(row);
            }
          }}
          onContextMenu={(event) => {
            const id = rowIdAt(event.target);
            setMenuRowId(id);
            if (id) {
              onSelect(id);
            }
            // Without entries there is nothing to show, not even the browser's own menu.
            if ((props.contextMenu?.(rowById(id)) ?? []).length === 0) {
              event.preventDefault();
            }
          }}
        >
          {table}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="menu">
          {contextMenuEntries(menuEntries)}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
