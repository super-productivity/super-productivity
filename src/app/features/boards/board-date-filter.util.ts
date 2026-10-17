import { BoardDateTimeframeCfg, BoardDateTimeframeType } from './boards.model';
import { getDbDateStr, isDBDateStr } from '../../util/get-db-date-str';
import { dateStrToUtcDate } from '../../util/date-str-to-utc-date';
import { getDateRangeForMonth } from '../../util/get-date-range-for-month';

// Caps `days` so `addDays` stays far inside the valid Date range. Without it an
// extreme value yields an Invalid Date that `getDbDateStr` turns into the
// literal "NaN-NaN-NaN", which a drop would then write into the planner.
export const BOARD_TIMEFRAME_MAX_DAYS = 3650;

const VALID_TIMEFRAME_TYPES: ReadonlySet<BoardDateTimeframeType> = new Set([
  'all',
  'today',
  'tomorrow',
  'next7Days',
  'nextNDays',
  'atLeastNDaysFuture',
  'nextWeek',
  'nextMonth',
  'customDate',
  'customRange',
]);

const isBoardDateTimeframeType = (value: unknown): value is BoardDateTimeframeType =>
  typeof value === 'string' && VALID_TIMEFRAME_TYPES.has(value as BoardDateTimeframeType);

export interface BoardDateTimeframeRange {
  start?: string;
  end?: string;
}

export interface BoardDateTimeframeRangeInput {
  timeframe: BoardDateTimeframeCfg;
  todayStr: string;
  /** 0 = Sunday, 1 = Monday, … — the user's `localization.firstDayOfWeek`. */
  firstDayOfWeek: number;
}

export interface BoardDateTimeframeMatchInput extends BoardDateTimeframeRangeInput {
  dateOnly?: string | null;
  timestamp?: number | null;
  startOfNextDayDiffMs: number;
}

export interface BoardDateTimeframeAdjustInput extends BoardDateTimeframeRangeInput {
  currentDate?: string | null;
}

const isValidDbDateStr = (value: unknown): value is string => {
  if (typeof value !== 'string' || !isDBDateStr(value)) {
    return false;
  }
  try {
    const parsed = dateStrToUtcDate(value);
    return !Number.isNaN(parsed.getTime()) && getDbDateStr(parsed) === value;
  } catch {
    return false;
  }
};

const addDays = (dateStr: string, days: number): string => {
  const date = dateStrToUtcDate(dateStr);
  date.setDate(date.getDate() + days);
  return getDbDateStr(date);
};

const isValidDays = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value > 0 &&
  value <= BOARD_TIMEFRAME_MAX_DAYS;

// Not `getWeekRange()`: it shifts its input by the timezone offset, so for a
// local-midnight date east of UTC it returns the previous week on the first
// day of the week.
const getNextWeekRange = (
  todayStr: string,
  firstDayOfWeek: number,
): BoardDateTimeframeRange => {
  const today = dateStrToUtcDate(todayStr);
  const daysSinceWeekStart = (today.getDay() - firstDayOfWeek + 7) % 7;
  const start = addDays(todayStr, 7 - daysSinceWeekStart);
  return { start, end: addDays(start, 6) };
};

const getNextMonthRange = (todayStr: string): BoardDateTimeframeRange => {
  const today = dateStrToUtcDate(todayStr);
  // getDateRangeForMonth takes a 1-based month and rolls 13 over to January.
  const { rangeStart, rangeEnd } = getDateRangeForMonth(
    today.getFullYear(),
    today.getMonth() + 2,
  );
  return { start: getDbDateStr(rangeStart), end: getDbDateStr(rangeEnd) };
};

export const resolveBoardDateTimeframeRange = ({
  timeframe,
  todayStr,
  firstDayOfWeek,
}: BoardDateTimeframeRangeInput): BoardDateTimeframeRange | null => {
  if (!isValidDbDateStr(todayStr)) {
    return null;
  }

  switch (timeframe.type) {
    case 'all':
      return {};
    case 'today':
      return { start: todayStr, end: todayStr };
    case 'tomorrow': {
      const tomorrow = addDays(todayStr, 1);
      return { start: tomorrow, end: tomorrow };
    }
    case 'next7Days':
      return { start: todayStr, end: addDays(todayStr, 6) };
    case 'nextNDays':
      return isValidDays(timeframe.days)
        ? { start: todayStr, end: addDays(todayStr, timeframe.days - 1) }
        : null;
    case 'atLeastNDaysFuture':
      return isValidDays(timeframe.days)
        ? { start: addDays(todayStr, timeframe.days) }
        : null;
    case 'nextWeek':
      return getNextWeekRange(todayStr, firstDayOfWeek);
    case 'nextMonth':
      return getNextMonthRange(todayStr);
    case 'customDate':
      return isValidDbDateStr(timeframe.customDate)
        ? { start: timeframe.customDate, end: timeframe.customDate }
        : null;
    case 'customRange':
      if (
        timeframe.customStart !== undefined &&
        !isValidDbDateStr(timeframe.customStart)
      ) {
        return null;
      }
      if (timeframe.customEnd !== undefined && !isValidDbDateStr(timeframe.customEnd)) {
        return null;
      }
      if (!timeframe.customStart && !timeframe.customEnd) {
        return null;
      }
      if (
        timeframe.customStart &&
        timeframe.customEnd &&
        timeframe.customStart > timeframe.customEnd
      ) {
        return null;
      }
      return { start: timeframe.customStart, end: timeframe.customEnd };
  }
};

/** The task's calendar day, honouring the user's start-of-next-day offset. */
export const getBoardTaskDateStr = (
  dateOnly: string | null | undefined,
  timestamp: number | null | undefined,
  startOfNextDayDiffMs: number,
): string | null => {
  if (typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp) {
    return getDbDateStr(new Date(timestamp - startOfNextDayDiffMs));
  }
  return dateOnly || null;
};

/**
 * Cheap per-task check against a range resolved once per filter pass.
 * A `null` range (invalid config) matches nothing.
 */
export const isDateInBoardRange = (
  dateStr: string | null,
  range: BoardDateTimeframeRange | null,
): boolean =>
  !!range &&
  isValidDbDateStr(dateStr) &&
  (!range.start || dateStr >= range.start) &&
  (!range.end || dateStr <= range.end);

export const matchesBoardDateTimeframe = ({
  dateOnly,
  timestamp,
  startOfNextDayDiffMs,
  ...rangeInput
}: BoardDateTimeframeMatchInput): boolean =>
  isDateInBoardRange(
    getBoardTaskDateStr(dateOnly, timestamp, startOfNextDayDiffMs),
    resolveBoardDateTimeframeRange(rangeInput),
  );

/**
 * Nearest day inside `range` for a task currently on `currentDate`
 * (today when it has none). Returns null when no valid day can be derived.
 */
export const adjustDateToBoardRange = (
  range: BoardDateTimeframeRange | null,
  currentDate: string | null | undefined,
  todayStr: string,
): string | null => {
  if (!range) {
    return null;
  }

  const sourceDate = isValidDbDateStr(currentDate) ? currentDate : todayStr;
  if (!isValidDbDateStr(sourceDate)) {
    return null;
  }

  let adjusted = sourceDate;
  if (range.start && sourceDate < range.start) {
    adjusted = range.start;
  } else if (range.end && sourceDate > range.end) {
    adjusted = range.end;
  }
  return isValidDbDateStr(adjusted) ? adjusted : null;
};

export const adjustDateToBoardTimeframe = ({
  currentDate,
  ...rangeInput
}: BoardDateTimeframeAdjustInput): string | null =>
  adjustDateToBoardRange(
    resolveBoardDateTimeframeRange(rangeInput),
    currentDate,
    rangeInput.todayStr,
  );

export const sanitizeBoardDateTimeframeCfg = (
  value: unknown,
): BoardDateTimeframeCfg | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const cfg = value as Partial<Record<keyof BoardDateTimeframeCfg, unknown>>;
  const type = cfg.type;
  if (!isBoardDateTimeframeType(type)) {
    return undefined;
  }

  switch (type) {
    case 'nextNDays':
    case 'atLeastNDaysFuture':
      return isValidDays(cfg.days) ? { type, days: cfg.days } : undefined;
    case 'customDate':
      return isValidDbDateStr(cfg.customDate)
        ? { type, customDate: cfg.customDate }
        : undefined;
    case 'customRange': {
      const customStart = cfg.customStart;
      const customEnd = cfg.customEnd;

      const out: BoardDateTimeframeCfg = { type };
      if (customStart !== undefined) {
        if (!isValidDbDateStr(customStart)) {
          return undefined;
        }
        out.customStart = customStart;
      }
      if (customEnd !== undefined) {
        if (!isValidDbDateStr(customEnd)) {
          return undefined;
        }
        out.customEnd = customEnd;
      }
      if (!out.customStart && !out.customEnd) {
        return undefined;
      }
      if (out.customStart && out.customEnd && out.customStart > out.customEnd) {
        return undefined;
      }
      return out;
    }
    default:
      return { type };
  }
};
