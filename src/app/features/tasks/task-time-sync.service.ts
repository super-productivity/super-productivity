import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { pairwise } from 'rxjs/operators';
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
  private readonly _store = inject<Store<RootState>>(Store);
  // Subscribe before TaskService's currentTaskId listener flushes the batch, so
  // the callback sees both sides of the local or bulk-replayed pointer change.
  private readonly _currentTaskChange = toSignal(
    this._store.select(selectCurrentTask).pipe(pairwise()),
  );
  private readonly _accumulator = new BatchedTimeSyncAccumulator(
    TaskTimeSyncService.SYNC_INTERVAL_MS,
    (taskId, date, duration) => {
      const [previousTask, currentTask] = this._currentTaskChange() ?? [];
      // addSubTask reuses the parent's per-day map only when time is inherited.
      // Explicit pasted time also moves the pointer and recalculates the parent,
      // so neither the pointer nor equal post-reducer totals prove inheritance.
      const inheritedPendingTime =
        previousTask?.id === taskId &&
        previousTask.subTaskIds.length === 0 &&
        currentTask?.parentId === taskId &&
        currentTask.timeSpentOnDay === previousTask.timeSpentOnDay;
      const targetId = inheritedPendingTime ? currentTask.id : taskId;
      this._store.dispatch(syncTimeSpent({ taskId: targetId, date, duration }));
    },
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
