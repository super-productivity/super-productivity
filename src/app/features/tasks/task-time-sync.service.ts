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
        // The task got its first subtask. The reducer replaced its time with the
        // subtask sum, so its pending batch either moved into an inheriting
        // subtask (send it for that one) or is gone here (drop it everywhere).
        const heirId = this._getInheritingSubTaskId(current.action, id);
        this._accumulator.clearOne(id);
        if (heirId && current.entities[heirId]) {
          this._accumulator.accumulate(heirId, duration, date);
        }
      }
    }),
    filter(([previous, current]) => previous.task?.id !== current.task?.id),
  );

  /**
   * Returns the subtask that inherited the parent's time in this action, judged
   * like `addSubTask`'s reducer at the op's position: the first op that gives
   * the parent a child must create it, without time of its own. Reads the
   * creation payload, because later remote additive deltas replace that map.
   * Explicit pasted time must never receive the parent's pending batch.
   */
  private _getInheritingSubTaskId(action: Action, parentId: string): string | null {
    const actions =
      action.type === bulkApplyOperations.type
        ? (action as ReturnType<typeof bulkApplyOperations>).operations.map((op) => ({
            type: op.actionType as string,
            ...(extractActionPayload(op.payload) as object),
          }))
        : [action];
    for (const candidate of actions) {
      if (candidate.type === addSubTask.type) {
        const { task, parentId: target } = candidate as ReturnType<typeof addSubTask>;
        if (target === parentId) {
          return Object.keys(task.timeSpentOnDay || {}).length === 0 ? task.id : null;
        }
      } else if (
        (candidate.type === TaskSharedActions.convertToSubTask.type &&
          (candidate as ReturnType<typeof TaskSharedActions.convertToSubTask>)
            .targetParentId === parentId) ||
        (candidate.type === moveSubTask.type &&
          (candidate as ReturnType<typeof moveSubTask>).targetTaskId === parentId)
      ) {
        return null;
      }
    }
    return null;
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
