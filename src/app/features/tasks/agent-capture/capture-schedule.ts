import { Task, TaskReminderOptionId } from '../task.model';
import { remindOptionToMilliseconds } from '../util/remind-option-to-milliseconds';
import { isValidDBDateStr } from '../../../util/get-db-date-str';

/**
 * Scheduling shared by both assistant capture paths: the hosted SuperSync
 * capture import and the local assistant access `create_task`.
 */

const DUE_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface CaptureDue {
  /** `YYYY-MM-DD`; a calendar day. */
  dueDay?: string;
  /** `[hours, minutes]` on `dueDay`, in this device's time zone. */
  dueTime?: [number, number];
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

const pad2 = (n: number): string => String(n).padStart(2, '0');

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
  const [year, month, day] = due.dueDay.split('-').map(Number);
  const dueWithTime = new Date(
    year,
    month - 1,
    day,
    due.dueTime[0],
    due.dueTime[1],
  ).getTime();
  const remindAt = remindOptionToMilliseconds(dueWithTime, defaultRemindOption);
  return {
    dueDay: undefined,
    dueWithTime,
    hasPlannedTime: true,
    ...(remindAt === undefined ? {} : { remindAt }),
  };
};
