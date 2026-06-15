import { BoardDateTimeframeCfg, BoardDateTimeframeType } from './boards.model';
import { getDbDateStr, isDBDateStr } from '../../util/get-db-date-str';
import { dateStrToUtcDate } from '../../util/date-str-to-utc-date';

const VALID_TIMEFRAME_TYPES: ReadonlySet<BoardDateTimeframeType> = new Set([
  'today',
  'tomorrow',
  'next7Days',
  'nextWeek',
  'nextMonth',
  'customDate',
  'customRange',
]);

const isBoardDateTimeframeType = (value: unknown): value is BoardDateTimeframeType =>
  typeof value === 'string' && VALID_TIMEFRAME_TYPES.has(value as BoardDateTimeframeType);

export interface BoardDateTimeframeRange {
  start: string;
  end: string;
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
    case 'today':
      return { start: todayStr, end: todayStr };
    case 'tomorrow': {
      const tomorrow = addDays(todayStr, 1);
      return { start: tomorrow, end: tomorrow };
    }
    case 'next7Days':
      return { start: todayStr, end: addDays(todayStr, 6) };
    case 'nextWeek':
      return getNextIsoWeekRange(todayStr);
    case 'nextMonth':
      return getNextMonthRange(todayStr);
    case 'customDate':
      return isValidDbDateStr(timeframe.customDate)
        ? { start: timeframe.customDate, end: timeframe.customDate }
        : null;
    case 'customRange':
      return isValidDbDateStr(timeframe.customStart) &&
        isValidDbDateStr(timeframe.customEnd) &&
        timeframe.customStart <= timeframe.customEnd
        ? { start: timeframe.customStart, end: timeframe.customEnd }
        : null;
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

  return isValidDbDateStr(taskDate) && taskDate >= range.start && taskDate <= range.end;
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
    case 'customDate':
      return isValidDbDateStr(cfg.customDate)
        ? { type, customDate: cfg.customDate }
        : undefined;
    case 'customRange':
      return isValidDbDateStr(cfg.customStart) &&
        isValidDbDateStr(cfg.customEnd) &&
        cfg.customStart <= cfg.customEnd
        ? {
            type,
            customStart: cfg.customStart,
            customEnd: cfg.customEnd,
          }
        : undefined;
    default:
      return { type };
  }
};
