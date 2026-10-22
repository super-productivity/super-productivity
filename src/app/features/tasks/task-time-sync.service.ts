import { inject, Injectable, Injector } from '@angular/core';
import { ScannedActionsSubject, Store } from '@ngrx/store';
import { filter, map, pairwise, tap } from 'rxjs/operators';
import { defer } from 'rxjs';
import { bulkApplyOperations } from '../../op-log/apply/bulk-hydration.action';
import { extractActionPayload } from '../../op-log/core/operation.types';
import { addSubTask } from './store/task.actions';
import {
  BatchedTimeSyncAccumulator,
  BatchedTimeSyncEntry,
} from '../../core/util/batched-time-sync-accumulator';
import { AppStateSnapshot } from '../../op-log/core/types/backup.types';
import { RootState } from '../../root-store/root-state';
import { syncTimeSpent } from '../time-tracking/store/time-tracking.actions';
import { TaskState } from './task.model';
import { selectCurrentTask } from './store/task.selectors';
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
  private readonly _accumulator = new BatchedTimeSyncAccumulator(
    TaskTimeSyncService.SYNC_INTERVAL_MS,
    (taskId, date, duration) => {
      this._store.dispatch(syncTimeSpent({ taskId, date, duration }));
    },
  );

  // TaskService subscribes once for its lifetime. Scanned actions pair the
  // committed pointer change with its cause, including a whole remote bulk.
  // A store selector alone loses the creation payload and intermediate maps.
  readonly taskChange$ = defer(() => this._injector.get(ScannedActionsSubject)).pipe(
    map((action) => ({ action, task: this._currentTask() })),
    pairwise(),
    filter(([previous, current]) => previous.task?.id !== current.task?.id),
    tap(([previous, current]) => {
      if (
        previous.task &&
        previous.task.subTaskIds.length === 0 &&
        current.task?.parentId === previous.task.id
      ) {
        const action = current.action;
        const creations =
          action.type === bulkApplyOperations.type
            ? (action as ReturnType<typeof bulkApplyOperations>).operations
                .filter((op) => op.actionType === addSubTask.type)
                .map((op) => extractActionPayload(op.payload))
            : action.type === addSubTask.type
              ? [action]
              : [];
        // Match addSubTask's inheritance condition on the INPUT, before remote
        // additive deltas replace the inherited map. Explicit pasted time must
        // never receive the parent's pending batch, even if totals happen to match.
        const inherited = creations.some((creation) => {
          const { task, parentId } = creation as ReturnType<typeof addSubTask>;
          return (
            parentId === previous.task!.id &&
            task.id === current.task!.id &&
            Object.keys(task.timeSpentOnDay || {}).length === 0
          );
        });
        if (inherited) {
          const pending = this._accumulator
            .getPendingEntries()
            .find((entry) => entry.id === previous.task!.id);
          if (pending) {
            this._accumulator.clearOne(pending.id);
            this._accumulator.accumulate(current.task.id, pending.duration, pending.date);
          }
        }
      }
    }),
  );

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
