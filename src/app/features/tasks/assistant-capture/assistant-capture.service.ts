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
import { AssistantCaptureInput } from '../../../core/electron/assistant-capture-input';

/**
 * Adds an assistant-captured task to the Inbox and reports whether it reached
 * the local op log.
 *
 * The capture is pinned: it always lands in the Inbox, whatever view is open —
 * no tag from a tag view, no Today date, no default project — and its title is
 * never parsed for short syntax, because it is untrusted input. One user intent
 * is one `addTask` op.
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

    const task = this._taskService.createNewTaskWithDefaults({
      title: input.title,
      additional: input.notes ? { notes: input.notes } : {},
      workContextType: WorkContextType.PROJECT,
      workContextId: INBOX_PROJECT.id,
    });

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
