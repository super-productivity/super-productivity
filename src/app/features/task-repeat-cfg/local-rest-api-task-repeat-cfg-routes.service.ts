import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import typia, { IValidation } from 'typia';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../electron/shared-with-frontend/local-rest-api.model';
import { LocalRestApiFeatureRoutes } from '../../core/electron/local-rest-api-feature-routes';
import {
  createErrorResponse,
  createSuccessResponse,
} from '../../core/electron/local-rest-api-response';
import { DateService } from '../../core/date/date.service';
import { clockStringFromDate } from '../../ui/duration/clock-string-from-date';
import { dateStrToUtcDate } from '../../util/date-str-to-utc-date';
import { getDbDateStr, isValidDBDateStr } from '../../util/get-db-date-str';
import { unique } from '../../util/unique';
import { DEFAULT_GLOBAL_CONFIG } from '../config/default-global-config.const';
import { GlobalConfigService } from '../config/global-config.service';
import { Task } from '../tasks/task.model';
import { TaskService } from '../tasks/task.service';
import { getDefaultSkipOverdue } from './dialog-edit-task-repeat-cfg/get-default-skip-overdue';
import { getQuickSettingUpdates } from './dialog-edit-task-repeat-cfg/get-quick-setting-updates';
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

const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;
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

type Result<T> =
  | { ok: true; value: T }
  | { ok: false; response: LocalRestApiResponsePayload };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getQueryParam = (
  query: Record<string, string | string[]>,
  key: string,
): string | undefined => {
  const value = query[key];
  return Array.isArray(value) ? value[0] : value;
};

/** Local REST API routes under `/task-repeat-cfgs`. */
@Injectable()
export class LocalRestApiTaskRepeatCfgRoutesService implements LocalRestApiFeatureRoutes {
  private readonly _taskRepeatCfgService = inject(TaskRepeatCfgService);
  private readonly _taskService = inject(TaskService);
  private readonly _dateService = inject(DateService);
  private readonly _globalConfigService = inject(GlobalConfigService);

  async handle(
    request: LocalRestApiRequestPayload,
  ): Promise<LocalRestApiResponsePayload | undefined> {
    const { method, requestId, query, body } = request;
    const segments = request.path.split('/').filter(Boolean);
    if (segments[0] !== 'task-repeat-cfgs') {
      return undefined;
    }

    if (segments.length === 1) {
      if (method === 'GET') {
        return this._handleList(requestId, query);
      }
      if (method === 'POST') {
        return this._handleCreate(requestId, body);
      }
      return undefined;
    }

    if (segments.length === 2) {
      const cfgId = segments[1];
      if (method === 'GET') {
        return this._handleGet(requestId, cfgId);
      }
      if (method === 'PATCH') {
        return this._handleUpdate(requestId, cfgId, body);
      }
      if (method === 'DELETE') {
        return this._handleDelete(requestId, cfgId);
      }
    }

    return undefined;
  }

  private async _handleList(
    requestId: string,
    query: Record<string, string | string[]>,
  ): Promise<LocalRestApiResponsePayload> {
    const projectId = getQueryParam(query, 'projectId');

    let cfgs = await firstValueFrom(this._taskRepeatCfgService.taskRepeatCfgs$);

    if (projectId) {
      cfgs = cfgs.filter((cfg) => cfg.projectId === projectId);
    }

    return createSuccessResponse(requestId, 200, cfgs);
  }

  private async _handleGet(
    requestId: string,
    cfgId: string,
  ): Promise<LocalRestApiResponsePayload> {
    const cfg = await this._getCfg(cfgId);
    if (!cfg) {
      return this._cfgNotFound(requestId);
    }
    return createSuccessResponse(requestId, 200, cfg);
  }

  private async _handleCreate(
    requestId: string,
    body: unknown,
  ): Promise<LocalRestApiResponsePayload> {
    const parsed = this._parseBody(requestId, body, CREATE_KEYS, (b) =>
      typia.validate<CreateRepeatCfgFields>(b),
    );
    if (!parsed.ok) {
      return parsed.response;
    }
    const { taskId, isPaused, skipOverdue, ...schedule } = parsed.value;

    const task = await this._getTask(taskId);
    if (!task) {
      return createErrorResponse(requestId, 404, 'TASK_NOT_FOUND', 'Task not found');
    }
    // The schedule dialog only offers "Repeat" for top-level tasks that are
    // not linked to an issue, and edits the existing config of a task that
    // already repeats.
    if (task.parentId) {
      return this._invalid(requestId, 'Subtasks cannot repeat');
    }
    if (task.issueId) {
      return this._invalid(requestId, 'Tasks linked to an issue cannot repeat');
    }
    if (task.repeatCfgId) {
      return this._invalid(
        requestId,
        'Task already repeats; change its repeat config with PATCH /task-repeat-cfgs/:id',
        { repeatCfgId: task.repeatCfgId },
      );
    }

    // The start date the repeat dialog proposes, and the earliest its date
    // picker allows for a new config.
    const minStartDate = task.dueDay ?? this._dateService.todayStr();
    if (schedule.startDate !== undefined && !isValidDBDateStr(schedule.startDate)) {
      return this._invalid(requestId, 'startDate must be a valid YYYY-MM-DD date');
    }
    if (schedule.startDate !== undefined && schedule.startDate < minStartDate) {
      return this._invalid(
        requestId,
        `startDate must not be before ${minStartDate} (the task's day or today)`,
      );
    }

    // Like the repeat dialog for a task: defaults, the task's day and time,
    // and title, notes, tags and estimate copied from the task.
    const startTime = task.dueWithTime
      ? clockStringFromDate(task.dueWithTime)
      : undefined;
    const initial: Omit<TaskRepeatCfgCopy, 'id'> = {
      ...DEFAULT_TASK_REPEAT_CFG,
      startDate:
        task.dueDay ??
        (task.dueWithTime
          ? getDbDateStr(task.dueWithTime)
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
    };

    const built = this._applySchedule(requestId, initial, {
      quickSetting: 'DAILY',
      ...schedule,
    });
    if (!built.ok) {
      return built.response;
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

    return createSuccessResponse(requestId, 201, await this._getCfg(cfgId));
  }

  private async _handleUpdate(
    requestId: string,
    cfgId: string,
    body: unknown,
  ): Promise<LocalRestApiResponsePayload> {
    const parsed = this._parseBody(requestId, body, UPDATE_KEYS, (b) =>
      typia.validate<UpdateRepeatCfgFields>(b),
    );
    if (!parsed.ok) {
      return parsed.response;
    }
    const { isPaused, skipOverdue, ...schedule } = parsed.value;

    const cfg = await this._getCfg(cfgId);
    if (!cfg) {
      return this._cfgNotFound(requestId);
    }

    let final: Omit<TaskRepeatCfgCopy, 'id'> = cfg;
    if (Object.keys(schedule).length > 0) {
      // The schedule changes as a whole, as in the dialog: a preset has to be
      // re-applied to a new start date, so the preset is always named.
      const { quickSetting } = schedule;
      if (quickSetting === undefined) {
        return this._invalid(
          requestId,
          'quickSetting is required when changing the schedule',
        );
      }
      const built = this._applySchedule(requestId, cfg, { ...schedule, quickSetting });
      if (!built.ok) {
        return built.response;
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
    const changes = getTaskRepeatCfgChanges(cfg, final);
    if (Object.keys(changes).length > 0) {
      // `false`, as the dialog passes for these fields: it only asks to
      // update all instances (in a confirmation dialog) when title, notes,
      // tags, estimate, time or reminder change, which this route does not
      // accept.
      this._taskRepeatCfgService.updateTaskRepeatCfg(cfgId, changes, false);
    }

    return createSuccessResponse(requestId, 200, await this._getCfg(cfgId));
  }

  private async _handleDelete(
    requestId: string,
    cfgId: string,
  ): Promise<LocalRestApiResponsePayload> {
    const cfg = await this._getCfg(cfgId);
    if (!cfg) {
      return this._cfgNotFound(requestId);
    }

    // Also unlinks the config from its tasks, active and archived.
    this._taskRepeatCfgService.deleteTaskRepeatCfg(cfgId);

    return createSuccessResponse(requestId, 200, { deleted: true, id: cfgId });
  }

  /**
   * Applies a schedule the way the repeat dialog's save does: a preset is
   * expanded with `getQuickSettingUpdates` for the start date, `CUSTOM`
   * takes cycle, interval and weekdays as given, and a stale
   * `monthlyLastDay` is dropped for anything but its own preset.
   */
  private _applySchedule(
    requestId: string,
    base: Omit<TaskRepeatCfgCopy, 'id'>,
    schedule: ScheduleFields & { quickSetting: RepeatQuickSetting },
  ): Result<Omit<TaskRepeatCfgCopy, 'id'>> {
    const { quickSetting, startDate, ...custom } = schedule;
    const customKeys = Object.keys(custom);
    if (quickSetting !== 'CUSTOM' && customKeys.length > 0) {
      return {
        ok: false,
        response: this._invalid(
          requestId,
          `${customKeys.join(', ')} can only be set with quickSetting "CUSTOM"`,
        ),
      };
    }
    if (startDate !== undefined && !isValidDBDateStr(startDate)) {
      return {
        ok: false,
        response: this._invalid(requestId, 'startDate must be a valid YYYY-MM-DD date'),
      };
    }
    if (startDate !== undefined && startDate < MIN_START_DATE) {
      return {
        ok: false,
        response: this._invalid(
          requestId,
          `startDate must not be before ${MIN_START_DATE}`,
        ),
      };
    }
    if (
      custom.repeatEvery !== undefined &&
      (!Number.isInteger(custom.repeatEvery) ||
        custom.repeatEvery < 1 ||
        custom.repeatEvery > MAX_REPEAT_EVERY)
    ) {
      return {
        ok: false,
        response: this._invalid(
          requestId,
          `repeatEvery must be an integer from 1 to ${MAX_REPEAT_EVERY}`,
        ),
      };
    }

    let result: Omit<TaskRepeatCfgCopy, 'id'> = {
      ...base,
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
      return {
        ok: false,
        response: this._invalid(
          requestId,
          `quickSetting "${quickSetting}" gives the invalid startDate ${result.startDate}`,
        ),
      };
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
      return {
        ok: false,
        response: this._invalid(
          requestId,
          'A weekly custom schedule needs at least one weekday',
        ),
      };
    }
    return { ok: true, value: result };
  }

  private _parseBody<T>(
    requestId: string,
    body: unknown,
    allowedKeys: ReadonlySet<string>,
    validate: (body: Record<string, unknown>) => IValidation<T>,
  ): Result<T> {
    if (!isRecord(body)) {
      return {
        ok: false,
        response: this._invalid(requestId, 'Request body must be a JSON object'),
      };
    }

    const unsupported = Object.keys(body).filter((key) => !allowedKeys.has(key));
    if (unsupported.length > 0) {
      return {
        ok: false,
        response: createErrorResponse(
          requestId,
          400,
          'UNSUPPORTED_FIELD',
          `Field(s) cannot be set through this endpoint: ${unsupported.join(', ')}`,
          { fields: unsupported },
        ),
      };
    }

    const validation = validate(body);
    if (!validation.success) {
      return {
        ok: false,
        response: this._invalid(
          requestId,
          'One or more repeat config fields have an invalid type',
          validation.errors.map(({ path, expected }) => ({ path, expected })),
        ),
      };
    }
    return { ok: true, value: validation.data };
  }

  /**
   * By id equality over the list: the entity map lookups would resolve ids
   * like `__proto__` to prototype members.
   */
  private async _getCfg(cfgId: string): Promise<TaskRepeatCfg | undefined> {
    const cfgs = await firstValueFrom(this._taskRepeatCfgService.taskRepeatCfgs$);
    return cfgs.find((cfg) => cfg.id === cfgId);
  }

  /** Active tasks only; the id check keeps `__proto__` and friends out. */
  private async _getTask(taskId: string): Promise<Task | undefined> {
    const task = await firstValueFrom(this._taskService.getByIdOnce$(taskId));
    return task?.id === taskId ? task : undefined;
  }

  private _cfgNotFound(requestId: string): LocalRestApiResponsePayload {
    return createErrorResponse(
      requestId,
      404,
      'REPEAT_CFG_NOT_FOUND',
      'Repeat config not found',
    );
  }

  private _invalid(
    requestId: string,
    message: string,
    details?: unknown,
  ): LocalRestApiResponsePayload {
    return createErrorResponse(requestId, 400, 'INVALID_INPUT', message, details);
  }
}
