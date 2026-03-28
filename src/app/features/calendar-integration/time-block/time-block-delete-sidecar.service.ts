import { Injectable } from '@angular/core';

/**
 * Transient sidecar that holds task IDs with dueWithTime for tasks about
 * to be bulk-deleted. Written by TaskService before dispatching deleteTasks,
 * consumed by TimeBlockSyncEffects after.
 */
@Injectable({ providedIn: 'root' })
export class TimeBlockDeleteSidecarService {
  private _pendingTaskIds: string[] = [];

  set(taskIds: string[]): void {
    this._pendingTaskIds.push(...taskIds);
  }

  consume(): string[] {
    const ids = this._pendingTaskIds;
    this._pendingTaskIds = [];
    return ids;
  }
}
