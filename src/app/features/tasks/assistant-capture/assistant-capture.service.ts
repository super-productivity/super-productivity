import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { TaskService } from '../task.service';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { WorkContextType } from '../../work-context/work-context.model';
import { INBOX_PROJECT } from '../../project/project.const';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { OperationCaptureService } from '../../../op-log/capture/operation-capture.service';
import { OperationWriteFlushService } from '../../../op-log/sync/operation-write-flush.service';
import { TaskLog } from '../../../core/log';
import { AssistantCaptureResult } from '../../../../../electron/shared-with-frontend/assistant-access.model';
import { GlobalConfigService } from '../../config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';
import { DateService } from '../../../core/date/date.service';
import { addTaskRepeatCfgToTask } from '../../task-repeat-cfg/store/task-repeat-cfg.actions';
import {
  CaptureDue,
  parseDueDay,
  parseDueTime,
  toSchedule,
  toStartTime,
} from '../agent-capture/capture-schedule';
import {
  CaptureRepeat,
  parseCaptureRepeat,
  toCaptureRepeatCfg,
} from '../agent-capture/capture-repeat-cfg';
import { nanoid } from 'nanoid';

export const MAX_CAPTURE_TITLE_LENGTH = 500;
export const MAX_CAPTURE_NOTES_LENGTH = 8 * 1024;

export interface AssistantCaptureInput extends CaptureDue {
  title: string;
  notes?: string;
  repeat?: CaptureRepeat;
}

const INPUT_KEYS = ['title', 'notes', 'dueDate', 'dueTime', 'repeat'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Accepts exactly `{title, notes?, dueDate?, dueTime?, repeat?}` within the
 * limits the main process enforces. Unlike the hosted import, an invalid
 * scheduling field rejects the whole request: the caller is still there to
 * fix it. The main process is the strict gate; `parseCaptureRepeat` here still
 * drops duplicate weekdays and unknown repeat keys.
 */
export const parseAssistantCaptureInput = (
  body: unknown,
): AssistantCaptureInput | undefined => {
  if (!isRecord(body) || Object.keys(body).some((k) => !INPUT_KEYS.includes(k))) {
    return undefined;
  }
  const { title, notes, dueDate, dueTime } = body;
  if (
    typeof title !== 'string' ||
    !title.trim() ||
    title.length > MAX_CAPTURE_TITLE_LENGTH
  ) {
    return undefined;
  }
  if (
    notes !== undefined &&
    (typeof notes !== 'string' || notes.length > MAX_CAPTURE_NOTES_LENGTH)
  ) {
    return undefined;
  }
  const dueDay = parseDueDay(dueDate);
  const time = parseDueTime(dueTime);
  const repeat = parseCaptureRepeat(body.repeat);
  if (
    (dueDate !== undefined && !dueDay) ||
    (dueTime !== undefined && (!dueDay || !time)) ||
    (body.repeat !== undefined && !repeat)
  ) {
    return undefined;
  }
  return {
    title: title.trim(),
    ...(notes ? { notes } : {}),
    ...(dueDay ? { dueDay } : {}),
    ...(time ? { dueTime: time } : {}),
    ...(repeat ? { repeat } : {}),
  };
};

/**
 * Adds an assistant-captured task to the Inbox and reports whether it reached
 * the local op log.
 *
 * The capture is pinned: it always lands in the Inbox, whatever view is open —
 * no tag from a tag view, no Today date, no default project — and its title is
 * never parsed for short syntax, because it is untrusted input. One user intent
 * is one `addTask` op; a recurring capture adds the add-task bar's
 * `addTaskRepeatCfgToTask`, as the hosted capture import does.
 *
 * "created" is only claimed after the write was flushed and no persist failure
 * appeared meanwhile. The persist-failure flag is global and sticky, so a
 * failure of a concurrent op also yields OUTCOME_UNKNOWN (a false negative the
 * assistant is told to check), never a false "created".
 */
@Injectable({ providedIn: 'root' })
export class AssistantCaptureService {
  private readonly _taskService = inject(TaskService);
  private readonly _store = inject(Store);
  private readonly _hydrationState = inject(HydrationStateService);
  private readonly _operationCapture = inject(OperationCaptureService);
  private readonly _writeFlush = inject(OperationWriteFlushService);
  private readonly _globalConfig = inject(GlobalConfigService);
  private readonly _dateService = inject(DateService);

  async capture(input: AssistantCaptureInput): Promise<AssistantCaptureResult> {
    // Actions dispatched while remote ops are applied are deferred and not
    // counted as pending writes, so the flush below would not wait for them.
    if (this._hydrationState.isApplyingRemoteOps()) {
      return { status: 'APP_BUSY' };
    }
    // Already unable to persist: adding would only put more unsaved state on top.
    if (this._operationCapture.hasUnrecoveredPersistFailure()) {
      return { status: 'PERSIST_DEGRADED' };
    }

    // TaskInternalEffects otherwise dispatches a second persistent updateTask
    // for this default. Include it in the creation op so capture stays one op.
    const defaultEstimate = this._globalConfig.cfg()?.timeTracking.defaultEstimate || 0;
    const remindOption =
      this._globalConfig.cfg()?.reminder.defaultTaskRemindOption ??
      DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption!;
    // A timed capture is scheduled in the addTask itself, without
    // scheduleTaskWithTime, like a timed hosted capture (one op).
    const task = this._taskService.createNewTaskWithDefaults({
      title: input.title,
      additional: {
        ...(input.notes ? { notes: input.notes } : {}),
        ...(defaultEstimate > 0 ? { timeEstimate: defaultEstimate } : {}),
        ...toSchedule(input, remindOption),
      },
      workContextType: WorkContextType.PROJECT,
      workContextId: INBOX_PROJECT.id,
    });
    // Built before anything is dispatched, so a throw here cannot leave a
    // one-off task behind a definite-failure reply.
    const repeatCfg = input.repeat
      ? toCaptureRepeatCfg(input.repeat, {
          title: input.title,
          notes: input.notes,
          projectId: INBOX_PROJECT.id,
          startDay: input.dueDay ?? this._dateService.todayStr(),
          startTime: toStartTime(input.dueTime),
          defaultEstimate,
          remindOption,
        })
      : undefined;

    TaskLog.log('assistantCapture', { taskId: task.id });

    this._store.dispatch(
      TaskSharedActions.addTask({
        task,
        workContextId: INBOX_PROJECT.id,
        workContextType: WorkContextType.PROJECT,
        isAddToBacklog: false,
        isAddToBottom: false,
        isIgnoreShortSyntax: true,
      }),
    );
    if (repeatCfg) {
      this._store.dispatch(
        addTaskRepeatCfgToTask({
          taskId: task.id,
          taskRepeatCfg: { ...repeatCfg, id: nanoid() },
          startTime: repeatCfg.startTime,
          remindAt: repeatCfg.remindAt,
        }),
      );
    }

    try {
      await this._writeFlush.flushPendingWrites();
    } catch {
      return { status: 'OUTCOME_UNKNOWN', id: task.id };
    }
    if (this._operationCapture.hasUnrecoveredPersistFailure()) {
      return { status: 'OUTCOME_UNKNOWN', id: task.id };
    }
    return { status: 'created', id: task.id };
  }
}
