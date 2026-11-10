import { getDefaultSkipOverdue } from '../../task-repeat-cfg/dialog-edit-task-repeat-cfg/get-default-skip-overdue';
import { getIntervalRepeatUpdates } from '../../task-repeat-cfg/dialog-edit-task-repeat-cfg/get-interval-repeat-updates';
import {
  DEFAULT_TASK_REPEAT_CFG,
  RepeatCycleOption,
  TASK_REPEAT_WEEKDAY_MAP,
  TaskRepeatCfgCopy,
} from '../../task-repeat-cfg/task-repeat-cfg.model';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { TaskReminderOptionId } from '../task.model';

// Server limits (capture.const.ts, create-task.tool.ts), re-checked here.
const REPEAT_EVERY_MAX = 99;
const CYCLES: Record<string, RepeatCycleOption> = {
  daily: 'DAILY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
  yearly: 'YEARLY',
};
/** Capture weekday names, in `Date.getDay()` order like TASK_REPEAT_WEEKDAY_MAP. */
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export interface CaptureRepeat {
  cycle: RepeatCycleOption;
  every: number;
  /** `Date.getDay()` numbers; weekly only. Absent: the start day's weekday. */
  weekdays?: number[];
}

/**
 * The optional v1 `repeat` field. Anything invalid yields undefined, so the
 * capture still becomes a one-off task, as on apps before the field existed.
 */
export const parseCaptureRepeat = (value: unknown): CaptureRepeat | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const r = value as Record<string, unknown>;
  const cycle =
    typeof r.cycle === 'string' && Object.prototype.hasOwnProperty.call(CYCLES, r.cycle)
      ? CYCLES[r.cycle]
      : undefined;
  if (!cycle) return undefined;
  const every = r.every === undefined ? 1 : r.every;
  if (
    typeof every !== 'number' ||
    !Number.isInteger(every) ||
    every < 1 ||
    every > REPEAT_EVERY_MAX
  ) {
    return undefined;
  }
  if (r.weekdays === undefined) return { cycle, every };
  if (cycle !== 'WEEKLY' || !Array.isArray(r.weekdays)) return undefined;
  const weekdays = r.weekdays.map((day) =>
    typeof day === 'string' ? WEEKDAYS.indexOf(day) : -1,
  );
  if (weekdays.length === 0 || weekdays.includes(-1)) return undefined;
  return { cycle, every, weekdays: [...new Set(weekdays)].sort((a, b) => a - b) };
};

/**
 * The repeat config for a recurring capture, built like the add-task bar's:
 * the interval anchored on the start day, then the add-time skipOverdue
 * default. The addTaskRepeatCfgToTask effects move the task to the first
 * occurrence and give a timed series its time and reminder.
 */
export const toCaptureRepeatCfg = (
  repeat: CaptureRepeat,
  opts: {
    title: string;
    notes?: string;
    projectId: string;
    /** `YYYY-MM-DD`: the capture's due day, else this device's today. */
    startDay: string;
    /** `HH:MM`, for a timed series. */
    startTime?: string;
    defaultEstimate: number;
    remindOption: TaskReminderOptionId;
  },
): Omit<TaskRepeatCfgCopy, 'id'> => {
  const updates = getIntervalRepeatUpdates(
    repeat.cycle,
    repeat.every,
    dateStrToUtcDate(opts.startDay),
  );
  const weekdayFlags = repeat.weekdays
    ? Object.fromEntries(
        TASK_REPEAT_WEEKDAY_MAP.map((key, day) => [
          key,
          (repeat.weekdays as number[]).includes(day),
        ]),
      )
    : {};
  const cfg: Omit<TaskRepeatCfgCopy, 'id'> = {
    ...DEFAULT_TASK_REPEAT_CFG,
    ...updates,
    ...weekdayFlags,
    projectId: opts.projectId,
    title: opts.title,
    notes: opts.notes,
    tagIds: [],
    defaultEstimate: opts.defaultEstimate,
    startTime: opts.startTime,
    remindAt: opts.startTime ? opts.remindOption : undefined,
  };
  return { ...cfg, skipOverdue: getDefaultSkipOverdue(cfg) };
};
