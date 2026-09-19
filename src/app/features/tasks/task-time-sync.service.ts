import { nanoid } from 'nanoid';
import { TimeSession } from '../time-session/time-session.model';
import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import {
  BatchedTimeSyncAccumulator,
  BatchedTimeSyncEntry,
} from '../../core/util/batched-time-sync-accumulator';
import { AppStateSnapshot } from '../../op-log/core/types/backup.types';
import { RootState } from '../../root-store/root-state';
import { syncTimeSpent } from '../time-tracking/store/time-tracking.actions';
import { Task, TaskState, TaskWithSubTasks } from './task.model';
import { selectTaskEntities } from './store/task.selectors';
import { projectPendingTimeFromTaskState } from './util/project-pending-time-from-task-state';

/**
 * Owns the task-time batching state shared by live tracking and replay-safe snapshots.
 */
@Injectable({ providedIn: 'root' })
export class TaskTimeSyncService {
  private static readonly SYNC_INTERVAL_MS = 5 * 60 * 1000;
  private readonly _store = inject<Store<RootState>>(Store);
  private readonly _taskEntities = this._store.selectSignal(selectTaskEntities);
  private readonly _recordings = new Map<string, TimeSession>();
  private readonly _accumulator = new BatchedTimeSyncAccumulator(
    TaskTimeSyncService.SYNC_INTERVAL_MS,
    (taskId, date, duration) => {
      const recording = this._recordings.get(taskId);
      const session =
        recording?.d === date ? { ...recording, t: recording.t + duration } : undefined;
      this._store.dispatch(
        syncTimeSpent({ taskId, date, duration, ...(session && { session }) }),
      );
      if (session) this._recordings.set(taskId, session);
    },
  );

  accumulate(taskId: string, duration: number, date: string, timestamp?: number): void {
    // Flush yesterday before replacing its recording descriptor.
    const previous = this._recordings.get(taskId);
    if (previous && previous.d !== date) {
      this._accumulator.flushOne(taskId);
      this._recordings.delete(taskId);
    }
    if (
      timestamp !== undefined &&
      Number.isFinite(timestamp) &&
      duration > 0 &&
      !this._recordings.has(taskId)
    ) {
      const start = timestamp - duration;
      this._recordings.set(taskId, {
        id: nanoid(),
        d: date,
        s: start,
        t: 0,
        o: new Date(start).getTimezoneOffset(),
      });
    }
    this._accumulator.accumulate(taskId, duration, date);
  }

  endSession(): void {
    this.flush();
    const pending = new Set(this._accumulator.getPendingEntries().map((e) => e.id));
    for (const id of this._recordings.keys()) {
      if (!pending.has(id)) this._recordings.delete(id);
    }
  }

  shouldFlush(): boolean {
    return this._accumulator.shouldFlush();
  }

  flush(): void {
    this._accumulator.flush();
  }

  flushOne(taskId: string): void {
    this._accumulator.flushOne(taskId);
    if (!this._accumulator.getPendingEntries().some((e) => e.id === taskId))
      this._recordings.delete(taskId);
  }

  /** Archive snapshots must include the final recording, not the pre-flush task copy. */
  flushTasks(tasks: TaskWithSubTasks[]): TaskWithSubTasks[] {
    for (const task of tasks) {
      this.flushOne(task.id);
      task.subTaskIds?.forEach((id) => this.flushOne(id));
    }
    const entities = this._taskEntities();
    const refresh = <T extends Task>(task: T): T => {
      const sessions = entities[task.id]?.timeSessions;
      return sessions ? { ...task, timeSessions: sessions } : task;
    };
    return tasks.map((task) =>
      task.subTasks
        ? { ...refresh(task), subTasks: task.subTasks.map(refresh) }
        : refresh(task),
    );
  }

  clearOne(taskId: string): void {
    this._accumulator.clearOne(taskId);
    this._recordings.delete(taskId);
  }

  clear(): void {
    this._accumulator.clear();
    this._recordings.clear();
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
