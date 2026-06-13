import { type OpeningHours, type TimeRange, WEEKDAYS, type Weekday } from '@callisto/domain';
import { Fragment, type PointerEvent, useEffect, useState } from 'react';
import { WEEKDAY_NAMES } from '../../lib/format';

/** Half hours per day; opening hours never use anything finer (see the domain schema). */
const SLOTS = 48;
const DEFAULT_FROM = 6 * 2;
const DEFAULT_TO = 21 * 2;
const SHORT_NAMES = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

type Week = boolean[][];
type Cell = { day: number; col: number };
/** How many half hours one cell of the grid stands for. */
export type Resolution = 1 | 2;

const slotOf = (time: string) => {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 2 + Math.floor(minutes / 30);
};
const timeOf = (slot: number) =>
  `${String(Math.floor(slot / 2)).padStart(2, '0')}:${slot % 2 ? '30' : '00'}`;

function toWeek(hours: OpeningHours): Week {
  return WEEKDAYS.map((weekday) => {
    const day = Array<boolean>(SLOTS).fill(false);
    for (const range of hours[weekday]) {
      for (let slot = slotOf(range.from); slot < slotOf(range.to); slot++) {
        day[slot] = true;
      }
    }
    return day;
  });
}

function toHours(week: Week): OpeningHours {
  const entries = WEEKDAYS.map((weekday, index): [Weekday, TimeRange[]] => {
    const day = week[index] ?? [];
    const ranges: TimeRange[] = [];
    let start: number | undefined;
    for (let slot = 0; slot <= SLOTS; slot++) {
      const open = slot < SLOTS && day[slot] === true;
      if (open && start === undefined) {
        start = slot;
      } else if (!open && start !== undefined) {
        ranges.push({ from: timeOf(start), to: timeOf(slot) });
        start = undefined;
      }
    }
    return [weekday, ranges];
  });
  return Object.fromEntries(entries) as OpeningHours;
}

/** The visible hours: 6 to 21 o'clock, widened to whole hours if the practice opens earlier or later. */
function visibleSlots(week: Week): [number, number] {
  let from = DEFAULT_FROM;
  let to = DEFAULT_TO;
  for (const day of week) {
    const first = day.indexOf(true);
    if (first >= 0) {
      from = Math.min(from, first - (first % 2));
      const end = day.lastIndexOf(true) + 1;
      to = Math.max(to, end + (end % 2));
    }
  }
  return [from, to];
}

/**
 * Opening hours as a week grid, like the logon hours in Windows: drag across days and times to
 * open or close them. A drag that starts on a closed cell opens, one that starts on an open cell
 * closes.
 */
export function HoursGrid(props: {
  value: OpeningHours;
  onChange: (hours: OpeningHours) => void;
  resolution: Resolution;
  disabled?: boolean;
}) {
  const { resolution, disabled = false } = props;
  const week = toWeek(props.value);
  const [viewFrom, viewTo] = visibleSlots(week);
  const columns = (viewTo - viewFrom) / resolution;

  const [drag, setDrag] = useState<{ anchor: Cell; current: Cell; open: boolean }>();
  const [hovered, setHovered] = useState<Cell>();

  const slotsOfColumn = (col: number) => {
    const first = viewFrom + col * resolution;
    return [first, first + resolution] as const;
  };
  const stateOf = (day: number, col: number) => {
    const [from, to] = slotsOfColumn(col);
    const open = (week[day] ?? []).slice(from, to).filter(Boolean).length;
    return open === 0 ? 'closed' : open === to - from ? 'open' : 'partial';
  };

  const set = (days: number[], from: number, to: number, open: boolean) => {
    const next = week.map((day, index) =>
      days.includes(index) ? day.map((slot, at) => (at >= from && at < to ? open : slot)) : day,
    );
    props.onChange(toHours(next));
  };
  const allDays = WEEKDAYS.map((_, index) => index);

  const area = drag && {
    day0: Math.min(drag.anchor.day, drag.current.day),
    day1: Math.max(drag.anchor.day, drag.current.day),
    col0: Math.min(drag.anchor.col, drag.current.col),
    col1: Math.max(drag.anchor.col, drag.current.col),
  };
  const inArea = (day: number, col: number) =>
    area !== undefined &&
    day >= area.day0 &&
    day <= area.day1 &&
    col >= area.col0 &&
    col <= area.col1;

  const cellFrom = (event: PointerEvent): Cell | undefined => {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    if (!(element instanceof HTMLElement) || element.dataset.day === undefined) {
      return undefined;
    }
    return { day: Number(element.dataset.day), col: Number(element.dataset.col) };
  };
  // Escape cancels a drag; the grid itself does not have the focus while dragging.
  useEffect(() => {
    if (!drag) {
      return;
    }
    const cancel = (event: KeyboardEvent) => event.key === 'Escape' && setDrag(undefined);
    document.addEventListener('keydown', cancel);
    return () => document.removeEventListener('keydown', cancel);
  }, [drag]);

  const finish = (apply: boolean) => {
    if (drag && area && apply) {
      const days = allDays.filter((day) => day >= area.day0 && day <= area.day1);
      set(days, slotsOfColumn(area.col0)[0], slotsOfColumn(area.col1)[1], drag.open);
    }
    setDrag(undefined);
  };

  let status = 'Ziehen Sie über das Raster, um Zeiten zu öffnen oder zu schließen.';
  if (area && drag) {
    const days =
      area.day0 === area.day1
        ? WEEKDAY_NAMES[WEEKDAYS[area.day0] as Weekday]
        : `${SHORT_NAMES[area.day0]}–${SHORT_NAMES[area.day1]}`;
    status = `${days}, ${timeOf(slotsOfColumn(area.col0)[0])}–${timeOf(
      slotsOfColumn(area.col1)[1],
    )} Uhr wird ${drag.open ? 'geöffnet' : 'geschlossen'}`;
  } else if (hovered) {
    const [from, to] = slotsOfColumn(hovered.col);
    const state = stateOf(hovered.day, hovered.col);
    status = `${WEEKDAY_NAMES[WEEKDAYS[hovered.day] as Weekday]}, ${timeOf(from)}–${timeOf(to)} Uhr: ${
      state === 'open' ? 'geöffnet' : state === 'closed' ? 'geschlossen' : 'teilweise geöffnet'
    }`;
  }

  const hours: number[] = [];
  for (let hour = viewFrom / 2; hour < viewTo / 2; hour++) {
    hours.push(hour);
  }

  return (
    <div className="hours-grid">
      <div className="hours-grid__scroller">
        <div
          className="hours-grid__table"
          aria-disabled={disabled}
          style={{
            gridTemplateColumns: `max-content repeat(${columns}, ${resolution === 1 ? 24 : 40}px)`,
          }}
          onPointerDown={(event) => {
            const cell = cellFrom(event);
            if (disabled || !cell || event.button !== 0) {
              return;
            }
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            setDrag({ anchor: cell, current: cell, open: stateOf(cell.day, cell.col) !== 'open' });
          }}
          onPointerMove={(event) => {
            const cell = cellFrom(event);
            setHovered(cell);
            if (drag && cell && (cell.day !== drag.current.day || cell.col !== drag.current.col)) {
              setDrag({ ...drag, current: cell });
            }
          }}
          onPointerLeave={() => setHovered(undefined)}
          onPointerUp={() => finish(true)}
          onPointerCancel={() => finish(false)}
        >
          <div />
          {hours.map((hour) => (
            <div
              key={hour}
              className="hours-grid__hour"
              style={{ gridColumn: `span ${2 / resolution}` }}
            >
              <span>{hour}</span>
            </div>
          ))}
          {WEEKDAYS.map((weekday, day) => (
            <Fragment key={weekday}>
              <div className="hours-grid__day">{WEEKDAY_NAMES[weekday]}</div>
              {Array.from({ length: columns }, (_, col) => {
                const state = stateOf(day, col);
                const preview = inArea(day, col) ? (drag?.open ? 'open' : 'closed') : undefined;
                const isHovered = hovered?.day === day && hovered.col === col;
                return (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: columns are positions in time
                    key={col}
                    data-day={day}
                    data-col={col}
                    data-state={state}
                    data-preview={preview}
                    data-hovered={isHovered || undefined}
                    data-row-end={col === columns - 1 || undefined}
                    data-hour-start={(viewFrom + col * resolution) % 2 === 0 || undefined}
                    className="hours-grid__cell"
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
      <div className="hours-grid__status" aria-live="polite">
        {status}
      </div>
    </div>
  );
}
