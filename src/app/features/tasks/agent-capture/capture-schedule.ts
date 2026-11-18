import { Task, TaskReminderOptionId } from '../task.model';
import { remindOptionToMilliseconds } from '../util/remind-option-to-milliseconds';
import { isValidDBDateStr } from '../../../util/get-db-date-str';

/**
 * Scheduling shared by both assistant capture paths: the hosted SuperSync
 * capture import and the local assistant access `create_task`.
 */

const DUE_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A week: far above any single task, well below a typo like 100000. */
export const CAPTURE_ESTIMATE_MINUTES_MAX = 10080;

export interface CaptureDue {
  /** `YYYY-MM-DD`; a calendar day. */
  dueDay?: string;
  /** `[hours, minutes]` on `dueDay`, in this device's time zone. */
  dueTime?: [number, number];
}

export interface CaptureDeadline {
  /** `YYYY-MM-DD`; a calendar day. */
  deadlineDay?: string;
  /** `[hours, minutes]` on `deadlineDay`, in this device's time zone. */
  deadlineTime?: [number, number];
}

// Years before 1000 pass the shape check but break downstream: `new Date(y, …)`
// maps 0000-0099 to 19xx, and getDbDateStr writes 0100-0999 unpadded
// (`500-06-15`), which a repeat config turns into NaN dates. The server never
// seals them, so drop them like any other bad day.
export const parseDueDay = (value: unknown): string | undefined =>
  typeof value === 'string' && isValidDBDateStr(value) && !value.startsWith('0')
    ? value
    : undefined;

export const parseDueTime = (value: unknown): [number, number] | undefined => {
  if (typeof value !== 'string') return undefined;
  const m = DUE_TIME_RE.exec(value);
  return m ? [Number(m[1]), Number(m[2])] : undefined;
};

/** Whole minutes, 1 to `CAPTURE_ESTIMATE_MINUTES_MAX`. */
export const parseEstimateMinutes = (value: unknown): number | undefined =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= CAPTURE_ESTIMATE_MINUTES_MAX
    ? value
    : undefined;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `day` at `time` in this device's time zone, as a timestamp. */
const toLocalTimestamp = (day: string, time: [number, number]): number => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date, time[0], time[1]).getTime();
};

/** `HH:MM`, the repeat config's `startTime`. */
export const toStartTime = (dueTime: [number, number] | undefined): string | undefined =>
  dueTime ? `${pad2(dueTime[0])}:${pad2(dueTime[1])}` : undefined;

/**
 * A day alone becomes `dueDay`; with a time, `dueWithTime` in this device's
 * time zone (dueDay cleared, ARCHITECTURE-DECISIONS.md Decision #1). Resolved
 * here, before the op, so replay never depends on the replaying device.
 */
export const toSchedule = (
  due: CaptureDue,
  defaultRemindOption: TaskReminderOptionId,
): Pick<Task, 'dueDay' | 'dueWithTime' | 'hasPlannedTime' | 'remindAt'> => {
  if (!due.dueDay) return {};
  if (!due.dueTime) return { dueDay: due.dueDay };
  const dueWithTime = toLocalTimestamp(due.dueDay, due.dueTime);
  const remindAt = remindOptionToMilliseconds(dueWithTime, defaultRemindOption);
  return {
    dueDay: undefined,
    dueWithTime,
    hasPlannedTime: true,
    ...(remindAt === undefined ? {} : { remindAt }),
  };
};

/**
 * A day alone becomes `deadlineDay`; with a time, `deadlineWithTime` in this
 * device's time zone (the two are mutually exclusive, task.model.ts). No
 * deadline reminder, as in the add-task bar by default. Resolved before the op,
 * like `toSchedule`.
 */
export const toDeadline = (
  deadline: CaptureDeadline,
): Pick<Task, 'deadlineDay' | 'deadlineWithTime'> => {
  if (!deadline.deadlineDay) return {};
  if (!deadline.deadlineTime) return { deadlineDay: deadline.deadlineDay };
  return {
    deadlineWithTime: toLocalTimestamp(deadline.deadlineDay, deadline.deadlineTime),
  };
};
