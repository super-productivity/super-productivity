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
  CaptureDeadline,
  CaptureDue,
  parseDueDay,
  parseDueTime,
  parseEstimateMinutes,
  toDeadline,
  toSchedule,
  toStartTime,
} from '../agent-capture/capture-schedule';
import { getDeadlineAutoPlanFields } from '../util/get-deadline-auto-plan-fields';
import {
  CaptureRepeat,
  parseCaptureRepeat,
  toCaptureRepeatCfg,
} from '../agent-capture/capture-repeat-cfg';
import { nanoid } from 'nanoid';
import { selectAllTagIds } from '../../tag/store/tag.reducer';
import { TODAY_TAG } from '../../tag/tag.const';

export const MAX_CAPTURE_TITLE_LENGTH = 500;
export const MAX_CAPTURE_NOTES_LENGTH = 8 * 1024;

export interface AssistantCaptureInput extends CaptureDue, CaptureDeadline {
  title: string;
  notes?: string;
  tagIds?: string[];
  repeat?: CaptureRepeat;
  /** Whole minutes; replaces the default estimate. */
  estimateMinutes?: number;
}

const INPUT_KEYS = [
  'title',
  'notes',
  'tagIds',
  'dueDate',
  'dueTime',
  'repeat',
  'deadlineDate',
  'deadlineTime',
  'estimateMinutes',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Distinct, non-empty ids; whether the tags exist is checked at capture time. */
const parseTagIds = (value: unknown): string[] | undefined =>
  Array.isArray(value) &&
  value.every((id) => typeof id === 'string' && id.length > 0) &&
  new Set(value).size === value.length
    ? value
    : undefined;

/**
 * Accepts exactly `{title, notes?, tagIds?, dueDate?, dueTime?, repeat?, deadlineDate?,
 * deadlineTime?, estimateMinutes?}` within the limits the main process enforces. Unlike the hosted import, an invalid
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
  const tagIds = parseTagIds(body.tagIds);
  const dueDay = parseDueDay(dueDate);
  const time = parseDueTime(dueTime);
  const repeat = parseCaptureRepeat(body.repeat);
  const { deadlineDate, deadlineTime, estimateMinutes } = body;
  const deadlineDay = parseDueDay(deadlineDate);
  const deadlineClock = parseDueTime(deadlineTime);
  const estimate = parseEstimateMinutes(estimateMinutes);
  if (
    (body.tagIds !== undefined && !tagIds) ||
    (dueDate !== undefined && !dueDay) ||
    (dueTime !== undefined && (!dueDay || !time)) ||
    (body.repeat !== undefined && !repeat) ||
    (deadlineDate !== undefined && !deadlineDay) ||
    (deadlineTime !== undefined && (!deadlineDay || !deadlineClock)) ||
    // A repeat config has no deadline, so later occurrences could not keep it.
    (deadlineDay && repeat) ||
    (estimateMinutes !== undefined && !estimate)
  ) {
    return undefined;
  }
  return {
    title: title.trim(),
    ...(notes ? { notes } : {}),
    ...(tagIds?.length ? { tagIds } : {}),
    ...(dueDay ? { dueDay } : {}),
    ...(time ? { dueTime: time } : {}),
    ...(repeat ? { repeat } : {}),
    ...(deadlineDay ? { deadlineDay } : {}),
    ...(deadlineClock ? { deadlineTime: deadlineClock } : {}),
    ...(estimate ? { estimateMinutes: estimate } : {}),
  };
};

/**
 * Adds an assistant-captured task to the Inbox and reports whether it reached
 * the local op log.
 *
 * The capture is pinned: it always lands in the Inbox, whatever view is open —
 * no tag from a tag view, no Today date, no default project; only the tags the
 * caller names — and its title is
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
  private readonly _tagIds = this._store.selectSignal(selectAllTagIds);

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

    const knownTagIds: readonly (string | number)[] = this._tagIds();
    if (
      input.tagIds &&
      !input.tagIds.every((id) => id !== TODAY_TAG.id && knownTagIds.includes(id))
    ) {
      return { status: 'TAG_NOT_FOUND' };
    }

    // TaskInternalEffects otherwise dispatches a second persistent updateTask
    // for this default. Include it in the creation op so capture stays one op.
    const estimate = input.estimateMinutes
      ? input.estimateMinutes * 60000
      : this._globalConfig.cfg()?.timeTracking.defaultEstimate || 0;
    const remindOption =
      this._globalConfig.cfg()?.reminder.defaultTaskRemindOption ??
      DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption!;
    // A timed capture is scheduled in the addTask itself, without
    // scheduleTaskWithTime, like a timed hosted capture (one op).
    const task = this._taskService.createNewTaskWithDefaults({
      title: input.title,
      additional: {
        ...(input.tagIds ? { tagIds: input.tagIds } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
        ...(estimate > 0 ? { timeEstimate: estimate } : {}),
        ...toSchedule(input, remindOption),
        // In the addTask as in the add-task bar, so the deadline adds no op.
        ...toDeadline(input),
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
          tagIds: input.tagIds,
          startDay: input.dueDay ?? this._dateService.todayStr(),
          startTime: toStartTime(input.dueTime),
          defaultEstimate: estimate,
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
        // A deadline today plans the task for today, as when added by hand.
        // Only with a deadline, so other captures dispatch the same action as before.
        ...(input.deadlineDay
          ? getDeadlineAutoPlanFields(
              this._dateService,
              task.deadlineDay,
              task.deadlineWithTime,
            )
          : {}),
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
