import { inject, Injectable, Injector, untracked } from '@angular/core';
import { Action, ScannedActionsSubject, Store } from '@ngrx/store';
import { filter, map, pairwise, tap } from 'rxjs/operators';
import { defer } from 'rxjs';
import { bulkApplyOperations } from '../../op-log/apply/bulk-hydration.action';
import { extractActionPayload } from '../../op-log/core/operation.types';
import { addSubTask, moveSubTask } from './store/task.actions';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import {
  BatchedTimeSyncAccumulator,
  BatchedTimeSyncEntry,
} from '../../core/util/batched-time-sync-accumulator';
import { AppStateSnapshot } from '../../op-log/core/types/backup.types';
import { RootState } from '../../root-store/root-state';
import { syncTimeSpent } from '../time-tracking/store/time-tracking.actions';
import { TaskState } from './task.model';
import { selectCurrentTask, selectTaskEntities } from './store/task.selectors';
import { projectPendingTimeFromTaskState } from './util/project-pending-time-from-task-state';

/**
 * Owns the task-time batching state shared by live tracking and replay-safe snapshots.
 */
@Injectable({ providedIn: 'root' })
export class TaskTimeSyncService {
  private static readonly SYNC_INTERVAL_MS = 5 * 60 * 1000;
  private readonly _injector = inject(Injector);
  private readonly _store = inject<Store<RootState>>(Store);
  private readonly _currentTask = this._store.selectSignal(selectCurrentTask);
  private readonly _taskEntities = this._store.selectSignal(selectTaskEntities);
  private readonly _accumulator = new BatchedTimeSyncAccumulator(
    TaskTimeSyncService.SYNC_INTERVAL_MS,
    (taskId, date, duration) => {
      this._store.dispatch(syncTimeSpent({ taskId, date, duration }));
    },
  );

  // TaskService subscribes once for its lifetime. Scanned actions pair the
  // committed state with its cause, including a whole remote bulk.
  // A store selector alone loses the creation payload and intermediate maps.
  // The reads are untracked: an action dispatched inside an effect() would
  // otherwise make that effect rerun on every task change.
  readonly taskChange$ = defer(() => this._injector.get(ScannedActionsSubject)).pipe(
    map((action) => ({
      action,
      task: untracked(this._currentTask),
      entities: untracked(this._taskEntities),
    })),
    pairwise(),
    tap(([previous, current]) => {
      for (const { id, date, duration } of this._accumulator.getPendingEntries()) {
        const before = previous.entities[id];
        const after = current.entities[id];
        if (before?.subTaskIds.length !== 0 || !after?.subTaskIds.length) {
          continue;
        }
        // The task got its first subtask. addSubTask, moveSubTask and
        // convertToSubTask replace its time with the subtask sum, so its pending
        // batch either moved into an inheriting subtask (send it for that one)
        // or is gone here (drop it, so other devices don't add it back). Other
        // paths (undoing a delete, a plugin batch, an LWW parentId) keep the
        // parent's time, and with it the batch.
        const outcome = this._getFirstSubTaskOutcome(
          current.action,
          id,
          after.subTaskIds,
        );
        if (outcome === 'kept') {
          continue;
        }
        this._accumulator.clearOne(id);
        if (outcome !== 'dropped' && current.entities[outcome.heirId]) {
          this._accumulator.accumulate(outcome.heirId, duration, date);
        }
      }
    }),
    filter(([previous, current]) => previous.task?.id !== current.task?.id),
  );

  /**
   * What happened to a parent's time when this action gave it its first
   * subtasks. The subtask inherited it only when the first op that attached a
   * child, at its position in a remote bulk, created it without time of its
   * own, like `addSubTask`'s reducer decides. The creation payload counts,
   * because later remote additive deltas replace the inherited map, and
   * explicit pasted time must never receive the parent's pending batch. A child
   * attached by an op not checked here may have come first, so then nothing
   * inherits.
   */
  private _getFirstSubTaskOutcome(
    action: Action,
    parentId: string,
    childIds: string[],
  ): { heirId: string } | 'dropped' | 'kept' {
    const actions =
      action.type === bulkApplyOperations.type
        ? (action as ReturnType<typeof bulkApplyOperations>).operations.map((op) => ({
            type: op.actionType as string,
            ...(extractActionPayload(op.payload) as object),
          }))
        : [action];
    const attached: { childId: string; inherits: boolean }[] = [];
    for (const candidate of actions) {
      if (candidate.type === addSubTask.type) {
        const { task, parentId: target } = candidate as ReturnType<typeof addSubTask>;
        if (target === parentId) {
          attached.push({
            childId: task.id,
            inherits:
              attached.length === 0 &&
              Object.keys(task.timeSpentOnDay || {}).length === 0,
          });
        }
      } else if (candidate.type === TaskSharedActions.convertToSubTask.type) {
        const { taskId, targetParentId } = candidate as ReturnType<
          typeof TaskSharedActions.convertToSubTask
        >;
        if (targetParentId === parentId) {
          attached.push({ childId: taskId, inherits: false });
        }
      } else if (candidate.type === moveSubTask.type) {
        const { taskId, targetTaskId } = candidate as ReturnType<typeof moveSubTask>;
        if (targetTaskId === parentId) {
          attached.push({ childId: taskId, inherits: false });
        }
      }
    }
    if (attached.length === 0) {
      return 'kept';
    }
    const isEveryChildChecked = childIds.every((childId) =>
      attached.some((entry) => entry.childId === childId),
    );
    return attached[0].inherits && isEveryChildChecked
      ? { heirId: attached[0].childId }
      : 'dropped';
  }

  accumulate(taskId: string, duration: number, date: string): void {
    this._accumulator.accumulate(taskId, duration, date);
  }

  shouldFlush(): boolean {
    return this._accumulator.shouldFlush();
  }

  flush(): void {
    this._accumulator.flush();
  }

  flushOne(taskId: string): void {
    this._accumulator.flushOne(taskId);
  }

  clearOne(taskId: string): void {
    this._accumulator.clearOne(taskId);
  }

  clear(): void {
    this._accumulator.clear();
  }

  projectSnapshot(
    snapshot: AppStateSnapshot,
    additionalPendingEntries: BatchedTimeSyncEntry[] = [],
  ): AppStateSnapshot {
    const pendingEntries = [
      ...this._accumulator.getPendingEntries(),
      ...additionalPendingEntries,
    ];
    if (pendingEntries.length === 0) {
      return snapshot;
    }

    const taskState = snapshot.task as TaskState;
    const projectedTaskState = projectPendingTimeFromTaskState(taskState, pendingEntries);
    return projectedTaskState === taskState
      ? snapshot
      : { ...snapshot, task: projectedTaskState };
  }
}
