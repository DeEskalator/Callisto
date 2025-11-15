import type { TimeRange } from './common';
import { germanHolidayOn, type Holiday } from './holidays';
import type { Closure, OpeningHours, OpeningMode, PracticeSettings } from './practice';
import {
  addDays,
  type LocalDate,
  type LocalTime,
  MINUTES_PER_DAY,
  minutesOf,
  timeOf,
  toZoned,
  weekdayOf,
} from './time';

export interface OpeningPeriod {
  date: LocalDate;
  from: LocalTime;
  to: LocalTime;
}

export interface OpeningState {
  mode: OpeningMode;
  localDate: LocalDate;
  localTime: LocalTime;
  /** Today's opening periods after holidays and closures are taken out. */
  todayRanges: TimeRange[];
  /** The period the practice is in right now; only set while open. */
  currentPeriod?: OpeningPeriod;
  /** The next time the practice opens; missing if nothing opens within the search horizon. */
  nextOpening?: OpeningPeriod;
  /** The closure that applies right now; only set in `vacation` mode. */
  closure?: Closure;
  /** Today's public holiday, regardless of the mode. */
  holiday?: Holiday;
  /** The announcement preset that applies right now. */
  presetId: string;
}

export interface OpeningContext {
  settings: Pick<PracticeSettings, 'timeZone' | 'federalState' | 'presetAssignments'>;
  hours: OpeningHours;
  closures: Closure[];
}

/** How far ahead the next opening is searched; longer than any realistic closure. */
const SEARCH_HORIZON_DAYS = 120;

type MinuteRange = [from: number, to: number];

/** The part of `date` a closure blocks, in minutes of the day. */
export function closedMinutes(closure: Closure, date: LocalDate): MinuteRange | undefined {
  if (date < closure.from || date > closure.to) {
    return undefined;
  }
  if (closure.allDay || !closure.fromTime || !closure.toTime) {
    return [0, MINUTES_PER_DAY];
  }
  return [minutesOf(closure.fromTime), minutesOf(closure.toTime)];
}

function subtract(ranges: MinuteRange[], [blockedFrom, blockedTo]: MinuteRange): MinuteRange[] {
  const remaining: MinuteRange[] = [];
  for (const [from, to] of ranges) {
    if (blockedTo <= from || blockedFrom >= to) {
      remaining.push([from, to]);
      continue;
    }
    if (from < blockedFrom) {
      remaining.push([from, blockedFrom]);
    }
    if (blockedTo < to) {
      remaining.push([blockedTo, to]);
    }
  }
  return remaining;
}

/** Opening periods of `date` after holidays and closures are taken out, in chronological order. */
export function effectiveRanges(date: LocalDate, context: OpeningContext): TimeRange[] {
  if (germanHolidayOn(date, context.settings.federalState)) {
    return [];
  }
  let ranges = context.hours[weekdayOf(date)].map(
    (range): MinuteRange => [minutesOf(range.from), minutesOf(range.to)],
  );
  for (const closure of context.closures) {
    const blocked = closedMinutes(closure, date);
    if (blocked) {
      ranges = subtract(ranges, blocked);
    }
  }
  return ranges
    .sort((left, right) => left[0] - right[0])
    .map(([from, to]) => ({ from: timeOf(from), to: timeOf(to) }));
}

function findNextOpening(
  today: LocalDate,
  nowMinutes: number,
  context: OpeningContext,
): OpeningPeriod | undefined {
  for (let offset = 0; offset <= SEARCH_HORIZON_DAYS; offset++) {
    const date = addDays(today, offset);
    for (const range of effectiveRanges(date, context)) {
      if (offset > 0 || minutesOf(range.from) > nowMinutes) {
        return { date, ...range };
      }
    }
  }
  return undefined;
}

/**
 * Whether the practice is open at `instant`, and if not, why.
 *
 * A closure wins over a public holiday, which wins over the weekly hours. This is decided here in
 * code and handed to the assistant as a fact, so the language model never has to work out by
 * itself whether the practice is open.
 */
export function openingStateAt(instant: Date, context: OpeningContext): OpeningState {
  const { settings, closures } = context;
  const now = toZoned(instant, settings.timeZone);
  const nowMinutes = minutesOf(now.time);

  const todayRanges = effectiveRanges(now.date, context);
  const currentRange = todayRanges.find(
    (range) => minutesOf(range.from) <= nowMinutes && nowMinutes < minutesOf(range.to),
  );
  const closure = closures.find((candidate) => {
    const blocked = closedMinutes(candidate, now.date);
    return blocked !== undefined && blocked[0] <= nowMinutes && nowMinutes < blocked[1];
  });
  const holiday = germanHolidayOn(now.date, settings.federalState);

  let mode: OpeningMode = 'closed';
  if (currentRange) {
    mode = 'open';
  } else if (closure) {
    mode = 'vacation';
  } else if (holiday) {
    mode = 'holiday';
  }

  const state: OpeningState = {
    mode,
    localDate: now.date,
    localTime: now.time,
    todayRanges,
    presetId:
      (mode === 'vacation' ? closure?.presetId : undefined) ?? settings.presetAssignments[mode],
  };
  if (currentRange) {
    state.currentPeriod = { date: now.date, ...currentRange };
  }
  const nextOpening = findNextOpening(now.date, nowMinutes, context);
  if (nextOpening) {
    state.nextOpening = nextOpening;
  }
  if (mode === 'vacation' && closure) {
    state.closure = closure;
  }
  if (holiday) {
    state.holiday = holiday;
  }
  return state;
}
