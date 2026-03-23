import { Injectable } from '@angular/core';

/**
 * Minimal issue metadata needed to delete remote issues when tasks are bulk-deleted.
 * Kept separate from the NgRx action payload so that full Task objects are never
 * serialized into the operation log.
 */
export interface DeletedTaskIssueInfo {
  issueId: string;
  issueType: string;
  issueProviderId: string;
}

/**
 * Transient, in-memory sidecar that holds issue metadata for tasks being
 * bulk-deleted. The dispatching code (TaskService, effects) writes here
 * *before* dispatching `deleteTasks`, and `deleteIssueOnBulkTaskDelete$`
 * reads + clears here *after* the action arrives.
 *
 * This data is intentionally NOT persisted or synced. Remote clients never
 * need it because effects use LOCAL_ACTIONS and only fire on the originating
 * client.
 */
@Injectable({ providedIn: 'root' })
export class DeletedTaskIssueSidecarService {
  private _pending: DeletedTaskIssueInfo[] = [];

  /**
   * Store issue metadata for an upcoming `deleteTasks` dispatch.
   * Call this *before* dispatching the action.
   */
  set(items: DeletedTaskIssueInfo[]): void {
    this._pending = items;
  }

  /**
   * Consume (read + clear) the stored issue metadata.
   * Returns an empty array if nothing was stored.
   */
  consume(): DeletedTaskIssueInfo[] {
    const items = this._pending;
    this._pending = [];
    return items;
  }
}
