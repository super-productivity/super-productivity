import { Injectable } from '@angular/core';
import { Task } from '../../tasks/task.model';

/**
 * Transient sidecar that holds task IDs with dueWithTime (and, separately, with
 * only a dueDay) for tasks about to be bulk-deleted. Written by TaskService
 * before dispatching deleteTasks, consumed by TimeBlockSyncEffects after.
 */
@Injectable({ providedIn: 'root' })
export class TimeBlockDeleteSidecarService {
  private _pendingTaskIds: string[] = [];
  private _pendingDayOnlyTaskIds: string[] = [];

  set(tasks: readonly Pick<Task, 'id' | 'dueWithTime' | 'dueDay'>[]): void {
    for (const t of tasks) {
      if (t.dueWithTime) {
        this._pendingTaskIds.push(t.id);
      } else if (t.dueDay) {
        this._pendingDayOnlyTaskIds.push(t.id);
      }
    }
  }

  consume(): string[] {
    const ids = this._pendingTaskIds;
    this._pendingTaskIds = [];
    return ids;
  }

  /** Tasks with a day but no time; they only have a block while all-day blocks are on. */
  consumeDayOnly(): string[] {
    const ids = this._pendingDayOnlyTaskIds;
    this._pendingDayOnlyTaskIds = [];
    return ids;
  }
}
