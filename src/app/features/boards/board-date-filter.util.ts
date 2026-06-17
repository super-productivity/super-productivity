import { BoardDateTimeframeCfg, BoardDateTimeframeType } from './boards.model';
import { getDbDateStr, isDBDateStr } from '../../util/get-db-date-str';
import { dateStrToUtcDate } from '../../util/date-str-to-utc-date';

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

const isValidPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

const getNextIsoWeekRange = (todayStr: string): BoardDateTimeframeRange => {
  const today = dateStrToUtcDate(todayStr);
  const daysSinceMonday = (today.getDay() + 6) % 7;
  const start = new Date(today);
  start.setDate(today.getDate() - daysSinceMonday + 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  return {
    start: getDbDateStr(start),
    end: getDbDateStr(end),
  };
};

const getNextMonthRange = (todayStr: string): BoardDateTimeframeRange => {
  const today = dateStrToUtcDate(todayStr);
  const start = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 2, 0);

  return {
    start: getDbDateStr(start),
    end: getDbDateStr(end),
  };
};

export const resolveBoardDateTimeframeRange = ({
  timeframe,
  todayStr,
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
      return isValidPositiveInteger(timeframe.days)
        ? { start: todayStr, end: addDays(todayStr, timeframe.days - 1) }
        : null;
    case 'atLeastNDaysFuture':
      return isValidPositiveInteger(timeframe.days)
        ? { start: addDays(todayStr, timeframe.days) }
        : null;
    case 'nextWeek':
      return getNextIsoWeekRange(todayStr);
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

export const matchesBoardDateTimeframe = ({
  timeframe,
  dateOnly,
  timestamp,
  todayStr,
  startOfNextDayDiffMs,
}: BoardDateTimeframeMatchInput): boolean => {
  const range = resolveBoardDateTimeframeRange({ timeframe, todayStr });
  if (!range) {
    return false;
  }

  const taskDate =
    typeof timestamp === 'number' && Number.isFinite(timestamp)
      ? getDbDateStr(new Date(timestamp - startOfNextDayDiffMs))
      : dateOnly;

  return (
    isValidDbDateStr(taskDate) &&
    (!range.start || taskDate >= range.start) &&
    (!range.end || taskDate <= range.end)
  );
};

export const adjustDateToBoardTimeframe = ({
  timeframe,
  currentDate,
  todayStr,
}: BoardDateTimeframeAdjustInput): string | null => {
  const range = resolveBoardDateTimeframeRange({ timeframe, todayStr });
  if (!range) {
    return null;
  }

  const sourceDate = isValidDbDateStr(currentDate) ? currentDate : todayStr;
  if (!isValidDbDateStr(sourceDate)) {
    return null;
  }

  if (range.start && sourceDate < range.start) {
    return range.start;
  }
  if (range.end && sourceDate > range.end) {
    return range.end;
  }
  return sourceDate;
};

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
      return isValidPositiveInteger(cfg.days) ? { type, days: cfg.days } : undefined;
    case 'customDate':
      return isValidDbDateStr(cfg.customDate)
        ? { type, customDate: cfg.customDate }
        : undefined;
    case 'customRange':
      if (cfg.customStart !== undefined && !isValidDbDateStr(cfg.customStart)) {
        return undefined;
      }
      if (cfg.customEnd !== undefined && !isValidDbDateStr(cfg.customEnd)) {
        return undefined;
      }
      if (!cfg.customStart && !cfg.customEnd) {
        return undefined;
      }
      if (cfg.customStart && cfg.customEnd && cfg.customStart > cfg.customEnd) {
        return undefined;
      }
      return {
        type,
        ...(cfg.customStart ? { customStart: cfg.customStart } : {}),
        ...(cfg.customEnd ? { customEnd: cfg.customEnd } : {}),
      };
    default:
      return { type };
  }
};
