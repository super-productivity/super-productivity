/**
 * The optional scheduling, deadline and estimate fields of `create_task`,
 * validated with the same
 * rules and messages as the hosted capture tool
 * (packages/super-sync-server/src/capture/create-task.tool.ts), which the main
 * process cannot import.
 */

export const DUE_DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';
export const DUE_TIME_PATTERN = '^([01]\\d|2[0-3]):[0-5]\\d$';
export const REPEAT_CYCLES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export const REPEAT_WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const REPEAT_EVERY_MAX = 99;
/** A week; matches CAPTURE_ESTIMATE_MINUTES_MAX in the renderer and server. */
export const ESTIMATE_MINUTES_MAX = 10080;

interface CaptureRepeatArg {
  cycle: (typeof REPEAT_CYCLES)[number];
  /** 2 to 99; absent means every cycle. */
  every?: number;
  /** Weekly only; in Monday-first order, no duplicates. */
  weekdays?: (typeof REPEAT_WEEKDAYS)[number][];
}

interface CaptureScheduleArgs {
  dueDate?: string;
  dueTime?: string;
  repeat?: CaptureRepeatArg;
  deadlineDate?: string;
  deadlineTime?: string;
  estimateMinutes?: number;
}

const DUE_DATE_RE = new RegExp(DUE_DATE_PATTERN);
const DUE_TIME_RE = new RegExp(DUE_TIME_PATTERN);
const REPEAT_KEYS = ['cycle', 'every', 'weekdays'];

/** Rejects 2026-02-30 and years before 1000, which the app writes unpadded. */
export const isCalendarDay = (day: string): boolean => {
  const [year, month, date] = day.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, date));
  return (
    year >= 1000 &&
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === date
  );
};

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value);

const validateRepeat = (value: unknown): CaptureRepeatArg | undefined | string => {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'repeat must be an object';
  }
  const r = value as Record<string, unknown>;
  const unknownKey = Object.keys(r).find((key) => !REPEAT_KEYS.includes(key));
  if (unknownKey !== undefined) return `Unknown argument: repeat.${unknownKey}`;
  if (!isOneOf(REPEAT_CYCLES, r.cycle)) {
    return `repeat.cycle must be one of ${REPEAT_CYCLES.join(', ')}`;
  }
  const repeat: CaptureRepeatArg = { cycle: r.cycle };
  if (r.every !== undefined) {
    if (
      typeof r.every !== 'number' ||
      !Number.isInteger(r.every) ||
      r.every < 1 ||
      r.every > REPEAT_EVERY_MAX
    ) {
      return `repeat.every must be a whole number from 1 to ${REPEAT_EVERY_MAX}`;
    }
    if (r.every > 1) repeat.every = r.every;
  }
  if (r.weekdays !== undefined) {
    if (r.cycle !== 'weekly') return 'repeat.weekdays needs cycle weekly';
    const days = r.weekdays;
    if (
      !Array.isArray(days) ||
      days.length === 0 ||
      !days.every((day) => isOneOf(REPEAT_WEEKDAYS, day)) ||
      new Set(days).size !== days.length
    ) {
      return `repeat.weekdays must be distinct days out of ${REPEAT_WEEKDAYS.join(', ')}`;
    }
    repeat.weekdays = REPEAT_WEEKDAYS.filter((day) => days.includes(day));
  }
  return repeat;
};

/** `deadlineDate` and `deadlineTime` follow the same rules as `dueDate` and `dueTime`. */
const validateDeadline = (
  args: Record<string, unknown>,
): Pick<CaptureScheduleArgs, 'deadlineDate' | 'deadlineTime'> | string => {
  const { deadlineDate, deadlineTime } = args;
  if (deadlineDate === undefined) {
    return deadlineTime === undefined ? {} : 'deadlineTime requires deadlineDate';
  }
  if (
    typeof deadlineDate !== 'string' ||
    !DUE_DATE_RE.test(deadlineDate) ||
    !isCalendarDay(deadlineDate)
  ) {
    return 'deadlineDate must be a calendar day as YYYY-MM-DD';
  }
  if (deadlineTime === undefined) return { deadlineDate };
  if (typeof deadlineTime !== 'string' || !DUE_TIME_RE.test(deadlineTime)) {
    return 'deadlineTime must be a 24-hour time as HH:MM';
  }
  return { deadlineDate, deadlineTime };
};

const validateEstimate = (value: unknown): number | undefined | string => {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > ESTIMATE_MINUTES_MAX
  ) {
    return `estimateMinutes must be a whole number from 1 to ${ESTIMATE_MINUTES_MAX}`;
  }
  return value;
};

/** Returns the validated fields, or the message to send back as a tool error. */
export const validateCaptureSchedule = (
  args: Record<string, unknown>,
): CaptureScheduleArgs | string => {
  const { dueDate, dueTime } = args;
  let due: CaptureScheduleArgs = {};
  if (dueDate === undefined) {
    if (dueTime !== undefined) return 'dueTime requires dueDate';
  } else if (
    typeof dueDate !== 'string' ||
    !DUE_DATE_RE.test(dueDate) ||
    !isCalendarDay(dueDate)
  ) {
    return 'dueDate must be a calendar day as YYYY-MM-DD';
  } else if (dueTime === undefined) {
    due = { dueDate };
  } else if (typeof dueTime !== 'string' || !DUE_TIME_RE.test(dueTime)) {
    return 'dueTime must be a 24-hour time as HH:MM';
  } else {
    due = { dueDate, dueTime };
  }
  const repeat = validateRepeat(args.repeat);
  if (typeof repeat === 'string') return repeat;
  const deadline = validateDeadline(args);
  if (typeof deadline === 'string') return deadline;
  // A repeat config has no deadline, so later occurrences could not keep it.
  if (repeat && deadline.deadlineDate)
    return 'deadlineDate cannot be combined with repeat';
  const estimateMinutes = validateEstimate(args.estimateMinutes);
  if (typeof estimateMinutes === 'string') return estimateMinutes;
  return {
    ...due,
    ...(repeat ? { repeat } : {}),
    ...deadline,
    ...(estimateMinutes === undefined ? {} : { estimateMinutes }),
  };
};
