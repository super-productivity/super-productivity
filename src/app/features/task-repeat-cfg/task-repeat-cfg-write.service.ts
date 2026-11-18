import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import typia, { IValidation } from 'typia';
import { DateService } from '../../core/date/date.service';
import { clockStringFromDate } from '../../ui/duration/clock-string-from-date';
import { dateStrToUtcDate } from '../../util/date-str-to-utc-date';
import { getDbDateStr, isValidDBDateStr } from '../../util/get-db-date-str';
import { unique } from '../../util/unique';
import { DEFAULT_GLOBAL_CONFIG } from '../config/default-global-config.const';
import { GlobalConfigService } from '../config/global-config.service';
import { Task } from '../tasks/task.model';
import { TaskService } from '../tasks/task.service';
import { getTaskPriority } from '../tasks/task-priority.const';
import { getDefaultSkipOverdue } from './dialog-edit-task-repeat-cfg/get-default-skip-overdue';
import { getQuickSettingUpdates } from './dialog-edit-task-repeat-cfg/get-quick-setting-updates';
import { getResumeCursorChanges } from './dialog-edit-task-repeat-cfg/get-resume-cursor-changes';
import { getTaskRepeatCfgChanges } from './dialog-edit-task-repeat-cfg/get-task-repeat-cfg-changes';
import { TaskRepeatCfgService } from './task-repeat-cfg.service';
import {
  DEFAULT_TASK_REPEAT_CFG,
  RepeatCycleOption,
  RepeatQuickSetting,
  TaskRepeatCfg,
  TaskRepeatCfgCopy,
} from './task-repeat-cfg.model';

/**
 * The schedule, as the essential part of the repeat dialog sets it. With a
 * preset `quickSetting`, the cycle and weekdays follow from the preset (and
 * `startDate`); only `CUSTOM` takes them from the request.
 */
interface ScheduleFields {
  quickSetting?: RepeatQuickSetting;
  startDate?: string;
  repeatCycle?: RepeatCycleOption;
  repeatEvery?: number;
  monday?: boolean;
  tuesday?: boolean;
  wednesday?: boolean;
  thursday?: boolean;
  friday?: boolean;
  saturday?: boolean;
  sunday?: boolean;
}

interface CfgFlagFields {
  isPaused?: boolean;
  skipOverdue?: boolean;
}

type UpdateRepeatCfgFields = ScheduleFields & CfgFlagFields;

interface CreateRepeatCfgFields extends UpdateRepeatCfgFields {
  taskId: string;
}

export type TaskRepeatCfgWriteErrorCode =
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_FIELD'
  | 'TASK_NOT_FOUND'
  | 'REPEAT_CFG_NOT_FOUND';

export interface TaskRepeatCfgWriteError {
  code: TaskRepeatCfgWriteErrorCode;
  message: string;
  details?: unknown;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: TaskRepeatCfgWriteError };

/** The written config (as now in the store), or why nothing was written. */
export type TaskRepeatCfgWriteResult = Result<TaskRepeatCfg | undefined>;

const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;
const EMPTY_WEEKDAYS = {
  monday: false,
  tuesday: false,
  wednesday: false,
  thursday: false,
  friday: false,
  saturday: false,
  sunday: false,
} as const;
const UPDATE_KEYS: ReadonlySet<string> = new Set([
  'quickSetting',
  'startDate',
  'repeatCycle',
  'repeatEvery',
  ...WEEKDAYS,
  'isPaused',
  'skipOverdue',
]);
const CREATE_KEYS: ReadonlySet<string> = new Set([...UPDATE_KEYS, 'taskId']);

/** The repeat dialog's limits for "repeat every". */
const MAX_REPEAT_EVERY = 1000;

/**
 * `Date` reads the years 0 to 99 as 1900 to 1999, and `getDbDateStr` writes
 * years before 1000 without padding, so a preset can only expand a start date
 * with a four-digit year.
 */
const MIN_START_DATE = '1000-01-01';

const invalid = <T>(message: string, details?: unknown): Result<T> => ({
  ok: false,
  error: { code: 'INVALID_INPUT', message, details },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Accepts an object holding only `allowedKeys` whose fields pass `validate`
 * (a `typia.validate<T>` call, which must stay at the call site).
 */
const parseFields = <T>(
  fields: unknown,
  allowedKeys: ReadonlySet<string>,
  validate: (fields: Record<string, unknown>) => IValidation<T>,
): Result<T> => {
  if (!isRecord(fields)) {
    return invalid('Repeat config fields must be an object');
  }
  const unsupported = Object.keys(fields).filter((key) => !allowedKeys.has(key));
  if (unsupported.length > 0) {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_FIELD',
        message: `Field(s) cannot be set: ${unsupported.join(', ')}`,
        details: { fields: unsupported },
      },
    };
  }
  const validation = validate(fields);
  if (!validation.success) {
    return invalid(
      'One or more repeat config fields have an invalid type',
      validation.errors.map(({ path, expected }) => ({ path, expected })),
    );
  }
  return { ok: true, value: validation.data };
};

/**
 * Creates and updates repeat configs from external input (Local REST API,
 * Plugin API) the way the repeat dialog does, so every entry point validates
 * and derives the same config.
 */
@Injectable({ providedIn: 'root' })
export class TaskRepeatCfgWriteService {
  private readonly _taskRepeatCfgService = inject(TaskRepeatCfgService);
  private readonly _taskService = inject(TaskService);
  private readonly _dateService = inject(DateService);
  private readonly _globalConfigService = inject(GlobalConfigService);

  /** Makes the task `fields.taskId` repeat; the other fields set the schedule. */
  async create(fields: unknown): Promise<TaskRepeatCfgWriteResult> {
    const parsed = parseFields(fields, CREATE_KEYS, (f) =>
      typia.validate<CreateRepeatCfgFields>(f),
    );
    if (!parsed.ok) {
      return parsed;
    }
    const { taskId, isPaused, skipOverdue, ...schedule } = parsed.value;

    const task = await this._getTask(taskId);
    if (!task) {
      return { ok: false, error: { code: 'TASK_NOT_FOUND', message: 'Task not found' } };
    }
    // The schedule dialog only offers "Repeat" for top-level tasks that are
    // not linked to an issue, and edits the existing config of a task that
    // already repeats.
    if (task.parentId) {
      return invalid('Subtasks cannot repeat');
    }
    if (task.issueId) {
      return invalid('Tasks linked to an issue cannot repeat');
    }
    if (task.repeatCfgId) {
      // the id in the message too: plugins only see the message
      return invalid(
        `Task already repeats; update its repeat config ${task.repeatCfgId} instead`,
        { repeatCfgId: task.repeatCfgId },
      );
    }

    // The start date the repeat dialog proposes, and the earliest its date
    // picker allows for a new config.
    const minStartDate = task.dueDay ?? this._dateService.todayStr();
    if (schedule.startDate !== undefined && !isValidDBDateStr(schedule.startDate)) {
      return invalid('startDate must be a valid YYYY-MM-DD date');
    }
    if (schedule.startDate !== undefined && schedule.startDate < minStartDate) {
      return invalid(
        `startDate must not be before ${minStartDate} (the task's day or today)`,
      );
    }

    const built = this._applySchedule(this._initialCfgForTask(task), {
      quickSetting: 'DAILY',
      ...schedule,
    });
    if (!built.ok) {
      return built;
    }
    const cfg: Omit<TaskRepeatCfgCopy, 'id'> = {
      ...built.value,
      ...(isPaused !== undefined ? { isPaused } : {}),
      // Seeded from the final schedule, as the dialog does unless the
      // checkbox was set explicitly.
      skipOverdue: skipOverdue ?? getDefaultSkipOverdue(built.value),
    };

    const cfgId = this._taskRepeatCfgService.addTaskRepeatCfgToTask(
      task.id,
      task.projectId || null,
      cfg,
    );
    return { ok: true, value: await this.getCfg(cfgId) };
  }

  async update(cfgId: string, fields: unknown): Promise<TaskRepeatCfgWriteResult> {
    const parsed = parseFields(fields, UPDATE_KEYS, (f) =>
      typia.validate<UpdateRepeatCfgFields>(f),
    );
    if (!parsed.ok) {
      return parsed;
    }
    const { isPaused, skipOverdue, ...schedule } = parsed.value;

    const cfg = await this.getCfg(cfgId);
    if (!cfg) {
      return {
        ok: false,
        error: { code: 'REPEAT_CFG_NOT_FOUND', message: 'Repeat config not found' },
      };
    }

    let final: Omit<TaskRepeatCfgCopy, 'id'> = cfg;
    if (Object.keys(schedule).length > 0) {
      // The schedule changes as a whole, as in the dialog: a preset has to be
      // re-applied to a new start date, so the preset is always named.
      const { quickSetting } = schedule;
      if (quickSetting === undefined) {
        return invalid('quickSetting is required when changing the schedule');
      }
      const built = this._applySchedule(cfg, { ...schedule, quickSetting });
      if (!built.ok) {
        return built;
      }
      final = built.value;
    }
    final = {
      ...final,
      ...(isPaused !== undefined ? { isPaused } : {}),
      ...(skipOverdue !== undefined ? { skipOverdue } : {}),
    };

    // Only the fields that really change: the reschedule effect reacts to
    // every schedule key present in the update (#7373).
    const logicalYesterday = new Date(this._dateService.getLogicalTodayDate());
    logicalYesterday.setDate(logicalYesterday.getDate() - 1);
    const changes = {
      ...getTaskRepeatCfgChanges(cfg, final),
      // Resuming must not add the dates missed while paused (same op), as in
      // the dialog
      ...getResumeCursorChanges(cfg, final, getDbDateStr(logicalYesterday)),
    };
    if (Object.keys(changes).length > 0) {
      // `false`, as the dialog passes for these fields: it only asks to
      // update all instances (in a confirmation dialog) when title, notes,
      // tags, priority, estimate, time or reminder change, which are not
      // accepted here.
      this._taskRepeatCfgService.updateTaskRepeatCfg(cfgId, changes, false);
    }
    return { ok: true, value: await this.getCfg(cfgId) };
  }

  /**
   * By id equality over the list: the entity map lookups would resolve ids
   * like `__proto__` to prototype members.
   */
  async getCfg(cfgId: string): Promise<TaskRepeatCfg | undefined> {
    const cfgs = await firstValueFrom(this._taskRepeatCfgService.taskRepeatCfgs$);
    return cfgs.find((cfg) => cfg.id === cfgId);
  }

  /**
   * Like the repeat dialog for a task: defaults, the task's day and time,
   * and title, notes, tags, estimate and priority copied from the task.
   */
  private _initialCfgForTask(task: Task): Omit<TaskRepeatCfgCopy, 'id'> {
    const startTime = task.dueWithTime
      ? clockStringFromDate(task.dueWithTime)
      : undefined;
    return {
      ...DEFAULT_TASK_REPEAT_CFG,
      startDate:
        task.dueDay ??
        (task.dueWithTime
          ? // the logical day, so a late-night time keeps its night (#3378)
            getDbDateStr(task.dueWithTime - this._dateService.getStartOfNextDayDiffMs())
          : this._dateService.todayStr()),
      startTime,
      remindAt: startTime
        ? (this._globalConfigService.cfg()?.reminder.defaultTaskRemindOption ??
          DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption)
        : undefined,
      shouldInheritSubtasks: task.subTaskIds.length > 0,
      title: task.title,
      notes: task.notes || undefined,
      tagIds: unique(task.tagIds),
      defaultEstimate: task.timeEstimate,
      priority: getTaskPriority(task.priority),
    };
  }

  /**
   * Applies a schedule the way the repeat dialog's save does: a preset is
   * expanded with `getQuickSettingUpdates` for the start date, `CUSTOM`
   * takes cycle, interval and weekdays as given, and a stale
   * `monthlyLastDay` is dropped for anything but its own preset.
   */
  private _applySchedule(
    base: Omit<TaskRepeatCfgCopy, 'id'>,
    schedule: ScheduleFields & { quickSetting: RepeatQuickSetting },
  ): Result<Omit<TaskRepeatCfgCopy, 'id'>> {
    const { quickSetting, startDate, ...custom } = schedule;
    const customKeys = Object.keys(custom);
    if (quickSetting !== 'CUSTOM' && customKeys.length > 0) {
      return invalid(
        `${customKeys.join(', ')} can only be set with quickSetting "CUSTOM"`,
      );
    }
    if (startDate !== undefined && !isValidDBDateStr(startDate)) {
      return invalid('startDate must be a valid YYYY-MM-DD date');
    }
    if (startDate !== undefined && startDate < MIN_START_DATE) {
      return invalid(`startDate must not be before ${MIN_START_DATE}`);
    }
    if (
      custom.repeatEvery !== undefined &&
      (!Number.isInteger(custom.repeatEvery) ||
        custom.repeatEvery < 1 ||
        custom.repeatEvery > MAX_REPEAT_EVERY)
    ) {
      return invalid(`repeatEvery must be an integer from 1 to ${MAX_REPEAT_EVERY}`);
    }

    // Supplied custom weekdays replace the selection; omitting all weekday
    // fields preserves the existing selection or the defaults on creation.
    const replaceWeekdays =
      quickSetting === 'CUSTOM' && WEEKDAYS.some((day) => custom[day] !== undefined);
    let result: Omit<TaskRepeatCfgCopy, 'id'> = {
      ...base,
      ...(replaceWeekdays ? EMPTY_WEEKDAYS : {}),
      ...custom,
      quickSetting,
      ...(startDate !== undefined ? { startDate } : {}),
    };
    if (quickSetting !== 'CUSTOM') {
      const presetUpdates = getQuickSettingUpdates(
        quickSetting,
        result.startDate ? dateStrToUtcDate(result.startDate) : undefined,
      );
      result = { ...result, ...presetUpdates };
    }
    // A preset can move the start date out of range: the next 1st after
    // December 9999 is in the year 10000.
    if (result.startDate !== undefined && !isValidDBDateStr(result.startDate)) {
      return invalid(
        `quickSetting "${quickSetting}" gives the invalid startDate ${result.startDate}`,
      );
    }
    if (result.monthlyLastDay && quickSetting !== 'MONTHLY_LAST_DAY') {
      result = { ...result, monthlyLastDay: undefined };
    }

    // A weekly custom schedule without a weekday never repeats (#8025).
    if (
      result.quickSetting === 'CUSTOM' &&
      result.repeatCycle === 'WEEKLY' &&
      !WEEKDAYS.some((day) => result[day])
    ) {
      return invalid('A weekly custom schedule needs at least one weekday');
    }
    return { ok: true, value: result };
  }

  /** Active tasks only; the id check keeps `__proto__` and friends out. */
  private async _getTask(taskId: string): Promise<Task | undefined> {
    const task = await firstValueFrom(this._taskService.getByIdOnce$(taskId));
    return task?.id === taskId ? task : undefined;
  }
}
