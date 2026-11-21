import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import {
  AssistantEditRejection,
  AssistantEditResult,
} from '../../../../../electron/shared-with-frontend/assistant-access.model';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { OperationCaptureService } from '../../../op-log/capture/operation-capture.service';
import { OperationWriteFlushService } from '../../../op-log/sync/operation-write-flush.service';
import { DateService } from '../../../core/date/date.service';
import { TaskLog } from '../../../core/log';
import { GlobalConfigService } from '../../config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';
import { selectEnabledIssueProviders } from '../../issue/store/issue-provider.selectors';
import { selectTagFeatureState } from '../../tag/store/tag.reducer';
import { selectCurrentTaskId, selectTaskEntities } from '../store/task.selectors';
import { Task, TaskCopy } from '../task.model';
import { TaskService } from '../task.service';
import { TaskScheduleService } from '../task-schedule.service';
import { getDeadlineAutoPlanFields } from '../util/get-deadline-auto-plan-fields';
import { MAX_TIME_SPENT_PER_DAY_MS } from '../local-rest-api-task-time';
import {
  AssistantDayTime,
  AssistantLogTime,
  AssistantTaskUpdate,
} from './assistant-edit-input';
import {
  getStartRejection,
  getUpdateRejection,
  isAutoTimeBlockOn,
  isWorkSessionLogOn,
} from './assistant-edit-guards';

export type AssistantEditOutcome =
  | { result: AssistantEditResult }
  | { rejection: AssistantEditRejection | 'TASK_NOT_FOUND' | 'INVALID_INPUT' };

/** A day and time in this device's time zone, resolved before the op. */
const toTimestamp = ({ day, time }: AssistantDayTime): number => {
  const [year, month, date] = day.split('-').map(Number);
  const [hours, minutes] = time ?? [0, 0];
  return new Date(year, month - 1, date, hours, minutes).getTime();
};

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Task edits for assistant access (MCP). Each dispatches what the app's own
 * controls do for the same change — the task menu's day planning, the
 * schedule and deadline dialogs, the play button and the time dialog — so an
 * edit produces the same ops as the UI path, effects included. It is not one
 * op per call: an update that changes the day and the title is two, as it is
 * by hand.
 *
 * Everything is loaded and checked before the first dispatch; remote ops are
 * checked for again right before it, with no await in between. "applied" is
 * only claimed after the writes were flushed with no persist failure, as for
 * capture; otherwise the outcome is unknown, never a failure.
 */
@Injectable({ providedIn: 'root' })
export class AssistantEditService {
  private readonly _store = inject(Store);
  private readonly _taskService = inject(TaskService);
  private readonly _taskScheduleService = inject(TaskScheduleService);
  private readonly _hydrationState = inject(HydrationStateService);
  private readonly _operationCapture = inject(OperationCaptureService);
  private readonly _writeFlush = inject(OperationWriteFlushService);
  private readonly _globalConfig = inject(GlobalConfigService);
  private readonly _dateService = inject(DateService);

  async updateTask(update: AssistantTaskUpdate): Promise<AssistantEditOutcome> {
    const [entities, providers, tagState] = await Promise.all([
      firstValueFrom(this._store.select(selectTaskEntities)),
      firstValueFrom(this._store.select(selectEnabledIssueProviders)),
      firstValueFrom(this._store.select(selectTagFeatureState)),
    ]);
    const task = entities[update.id];
    if (!task) {
      return { rejection: 'TASK_NOT_FOUND' };
    }
    const rejection =
      this._getAppRejection() ??
      getUpdateRejection(update, {
        task,
        parent: task.parentId ? entities[task.parentId] : undefined,
        knownTagIds: new Set(tagState.ids as string[]),
        isAutoTimeBlockOn: isAutoTimeBlockOn(providers),
      });
    if (rejection) {
      return { rejection };
    }

    TaskLog.log('assistantEdit', { taskId: task.id });
    if (update.due !== undefined) {
      this._applyDue(task, update.due);
    }
    if (update.deadline !== undefined) {
      this._applyDeadline(task, update.deadline);
    }
    const changes = this._getFieldChanges(task, update);
    if (Object.keys(changes).length) {
      // Literal like a capture: an assistant's title is never parsed for short syntax.
      this._taskService.update(task.id, changes, true);
    }
    return this._confirm(task.id);
  }

  async startTracking(id: string): Promise<AssistantEditOutcome> {
    const [entities, providers, currentTaskId] = await Promise.all([
      firstValueFrom(this._store.select(selectTaskEntities)),
      firstValueFrom(this._store.select(selectEnabledIssueProviders)),
      firstValueFrom(this._store.select(selectCurrentTaskId)),
    ]);
    const task = entities[id];
    if (!task) {
      return { rejection: 'TASK_NOT_FOUND' };
    }
    const rejection =
      this._getAppRejection() ??
      getStartRejection({
        task,
        parent: task.parentId ? entities[task.parentId] : undefined,
        isTimeTrackingEnabled: this._globalConfig.appFeatures().isTimeTrackingEnabled,
        isWorkSessionLogOn: isWorkSessionLogOn(providers),
      });
    if (rejection) {
      return { rejection };
    }
    if (currentTaskId !== id) {
      TaskLog.log('assistantStartTracking', { taskId: id });
      this._taskService.setCurrentId(id);
    }
    // Starting can plan the task for today (planStartedTaskForToday$).
    return this._confirm(undefined, id);
  }

  async stopTracking(): Promise<AssistantEditOutcome> {
    const currentTaskId = await firstValueFrom(this._store.select(selectCurrentTaskId));
    const rejection = this._getAppRejection();
    if (rejection) {
      return { rejection };
    }
    if (currentTaskId) {
      this._taskService.setCurrentId(null);
    }
    return this._confirm(undefined, null);
  }

  async logTime(input: AssistantLogTime): Promise<AssistantEditOutcome> {
    const entities = await firstValueFrom(this._store.select(selectTaskEntities));
    const task = entities[input.id];
    if (!task) {
      return { rejection: 'TASK_NOT_FOUND' };
    }
    const duration = input.minutes * 60000;
    const previous = task.timeSpentOnDay?.[input.date];
    // YYYY-MM-DD strings compare in calendar order.
    if (
      input.date > this._dateService.todayStr() ||
      (input.mode === 'add' && (previous ?? 0) + duration > MAX_TIME_SPENT_PER_DAY_MS)
    ) {
      return { rejection: 'INVALID_INPUT' };
    }
    const rejection =
      this._getAppRejection() ??
      // A parent's time is the sum of its subtasks', so time logged on it is lost.
      (task.subTaskIds.length ? 'PARENT_TASK_TIME' : undefined);
    if (rejection) {
      return { rejection };
    }

    TaskLog.log('assistantLogTime', { taskId: task.id });
    if (input.mode === 'add') {
      this._taskService.addTimeSpentAndSync(task, duration, input.date);
    } else if (
      duration !== (previous ?? 0) ||
      (duration === 0 && previous !== undefined)
    ) {
      // As the time dialog: the day's total replaced, an emptied day removed.
      const timeSpentOnDay = { ...task.timeSpentOnDay };
      if (duration === 0) {
        delete timeSpentOnDay[input.date];
      } else {
        timeSpentOnDay[input.date] = duration;
      }
      this._taskService.update(task.id, { timeSpentOnDay });
    }
    return this._confirm(task.id);
  }

  /**
   * Remote ops being applied defer local dispatches past the flush below, and
   * after a persist failure more changes would only pile up unsaved.
   */
  private _getAppRejection(): AssistantEditRejection | undefined {
    if (this._hydrationState.isApplyingRemoteOps()) {
      return 'APP_BUSY';
    }
    if (this._operationCapture.hasUnrecoveredPersistFailure()) {
      return 'PERSIST_DEGRADED';
    }
    return undefined;
  }

  /** As the schedule dialog's remove, the task menu's day buttons and the dialog's time. */
  private _applyDue(task: Task, due: AssistantDayTime | null): void {
    if (due === null) {
      if (task.dueDay || task.dueWithTime) {
        this._store.dispatch(
          TaskSharedActions.unscheduleTask({ id: task.id, isSkipToast: true }),
        );
      }
      return;
    }
    if (!due.time) {
      this._taskScheduleService.planForDay(task, due.day, false);
      return;
    }
    const dueWithTime = toTimestamp(due);
    if (dueWithTime !== task.dueWithTime) {
      this._taskService.scheduleTask(
        task,
        dueWithTime,
        this._globalConfig.cfg()?.reminder.defaultTaskRemindOption ??
          DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption!,
        false,
      );
    }
  }

  /**
   * As the deadline dialog. A timed deadline keeps its reminder's lead time;
   * a deadline that had none gets none, as a captured one.
   */
  private _applyDeadline(task: Task, deadline: AssistantDayTime | null): void {
    if (deadline === null) {
      if (task.deadlineDay || task.deadlineWithTime) {
        this._store.dispatch(
          TaskSharedActions.removeDeadline({ taskId: task.id, isSkipSnack: true }),
        );
      }
      return;
    }
    if (!deadline.time) {
      if (task.deadlineDay !== deadline.day || task.deadlineWithTime) {
        this._store.dispatch(
          TaskSharedActions.setDeadline({
            taskId: task.id,
            deadlineDay: deadline.day,
            ...getDeadlineAutoPlanFields(this._dateService, deadline.day),
            isSkipSnack: true,
          }),
        );
      }
      return;
    }
    const deadlineWithTime = toTimestamp(deadline);
    if (deadlineWithTime === task.deadlineWithTime) {
      return;
    }
    const leadTime =
      task.deadlineWithTime && task.deadlineRemindAt
        ? task.deadlineWithTime - task.deadlineRemindAt
        : undefined;
    this._store.dispatch(
      TaskSharedActions.setDeadline({
        taskId: task.id,
        deadlineWithTime,
        ...(leadTime !== undefined
          ? { deadlineRemindAt: deadlineWithTime - leadTime }
          : {}),
        ...getDeadlineAutoPlanFields(this._dateService, undefined, deadlineWithTime),
        isSkipSnack: true,
      }),
    );
  }

  /** Only what differs: an echoed `isDone: true` would move the completion date. */
  private _getFieldChanges(task: Task, update: AssistantTaskUpdate): Partial<TaskCopy> {
    const changes: Partial<TaskCopy> = {};
    if (update.title !== undefined && update.title !== task.title) {
      changes.title = update.title;
    }
    if (update.isDone !== undefined && update.isDone !== task.isDone) {
      changes.isDone = update.isDone;
    }
    if (update.estimateMinutes !== undefined) {
      const timeEstimate = update.estimateMinutes * 60000;
      if (timeEstimate !== task.timeEstimate) {
        changes.timeEstimate = timeEstimate;
      }
    }
    if (update.tagIds !== undefined && !sameList(update.tagIds, task.tagIds)) {
      changes.tagIds = update.tagIds;
    }
    return changes;
  }

  private async _confirm(
    taskId: string | undefined,
    currentTaskId?: string | null,
  ): Promise<AssistantEditOutcome> {
    try {
      await this._writeFlush.flushPendingWrites();
    } catch {
      return { result: { status: 'OUTCOME_UNKNOWN' } };
    }
    if (this._operationCapture.hasUnrecoveredPersistFailure()) {
      return { result: { status: 'OUTCOME_UNKNOWN' } };
    }
    if (taskId === undefined) {
      return { result: { status: 'applied', currentTaskId } };
    }
    const entities = await firstValueFrom(this._store.select(selectTaskEntities));
    const task = entities[taskId];
    return {
      result: {
        status: 'applied',
        ...(task ? { task: task as unknown as Record<string, unknown> } : {}),
      },
    };
  }
}
