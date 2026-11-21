import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import {
  ASSISTANT_UPDATE_PATH,
  isAssistantTaskUpdate,
} from '../../../../../electron/shared-with-frontend/assistant-access.model';
import {
  AssistantTaskStatus,
  getTaskPriority,
  getTaskStatus,
} from '../../../../../electron/shared-with-frontend/task-status-and-priority';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../../electron/shared-with-frontend/local-rest-api.model';
import { LocalRestApiFeatureRoutes } from '../../../core/electron/local-rest-api-feature-routes';
import {
  createErrorResponse,
  createSuccessResponse,
} from '../../../core/electron/local-rest-api-response';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { OperationCaptureService } from '../../../op-log/capture/operation-capture.service';
import { OperationWriteFlushService } from '../../../op-log/sync/operation-write-flush.service';
import { selectTaskEntitiesInActiveProjects } from '../store/task.selectors';
import { Task } from '../task.model';
import { TaskService } from '../task.service';
import { getWontDoChanges } from '../util/is-wont-do-task';

const statusChanges = (task: Task, status?: AssistantTaskStatus): Partial<Task> => {
  if (!status || status === getTaskStatus(task)) return {};
  if (status === 'open') return { isDone: false };
  const now = Date.now();
  if (status === 'wont-do') return getWontDoChanges(now);
  // A rapid change from won't-do must still have a distinct completion stamp.
  return { isDone: true, doneOn: now === task.wontDoOn ? now + 1 : now };
};

@Injectable({ providedIn: 'root' })
export class LocalRestApiAssistantUpdateRoutesService implements LocalRestApiFeatureRoutes {
  private readonly _tasks = inject(Store).selectSignal(
    selectTaskEntitiesInActiveProjects,
  );
  private readonly _taskService = inject(TaskService);
  private readonly _hydration = inject(HydrationStateService);
  private readonly _capture = inject(OperationCaptureService);
  private readonly _flush = inject(OperationWriteFlushService);

  async handle(
    request: LocalRestApiRequestPayload,
  ): Promise<LocalRestApiResponsePayload | undefined> {
    if (
      request.source !== 'mcp' ||
      request.path !== ASSISTANT_UPDATE_PATH ||
      request.method !== 'POST'
    )
      return undefined;
    const input = request.body;
    if (!isAssistantTaskUpdate(input))
      return createErrorResponse(
        request.requestId,
        400,
        'INVALID_INPUT',
        'Invalid task update',
      );
    const reply = (status: string): LocalRestApiResponsePayload =>
      createSuccessResponse(request.requestId, 200, { status });
    if (this._hydration.isApplyingRemoteOps()) return reply('APP_BUSY');
    if (this._capture.hasUnrecoveredPersistFailure()) return reply('PERSIST_DEGRADED');
    const task = this._tasks()[input.id];
    if (task?.id !== input.id)
      return createErrorResponse(
        request.requestId,
        404,
        'TASK_NOT_FOUND',
        'No active task has this id',
      );
    const changes: Partial<Task> = {
      ...(input.priority !== undefined &&
      input.priority !== getTaskPriority(task.priority)
        ? { priority: input.priority }
        : {}),
      ...statusChanges(task, input.status),
    };
    try {
      if (Object.keys(changes).length) this._taskService.update(input.id, changes, true);
      // A no-op retry may be observing an earlier call that is still being saved.
      await this._flush.flushPendingWrites();
    } catch {
      return reply('OUTCOME_UNKNOWN');
    }
    const saved = this._tasks()[input.id];
    if (saved?.id !== input.id || this._capture.hasUnrecoveredPersistFailure())
      return reply('OUTCOME_UNKNOWN');
    return createSuccessResponse(request.requestId, 200, {
      status: 'verified',
      task: {
        id: saved.id,
        priority: getTaskPriority(saved.priority),
        status: getTaskStatus(saved),
      },
    });
  }
}
