import { BaseIssueProviderCfg } from '../../issue.model';
import { SyncDirection } from '../../two-way-sync/issue-sync.model';

export interface CaldavTwoWaySyncCfg {
  isDone?: SyncDirection;
  title?: SyncDirection;
  notes?: SyncDirection;
  /**
   * Delete the VTODO on the server when its linked task is deleted in SP (after
   * the undo window). Default off: writing deletions to someone's real calendar
   * must not switch on by upgrading (#10096).
   */
  deleteOnServer?: boolean;
  /**
   * Upload a new top-level task added in the provider's default project as a
   * VTODO (#10098). Default off, for the same reason as `deleteOnServer`.
   */
  createOnServer?: boolean;
}

export interface CaldavCfg extends BaseIssueProviderCfg {
  caldavUrl: string | null;
  resourceName: string | null;
  username: string | null;
  password: string | null;
  categoryFilter: string | null;
  isAddSubTasks?: boolean;
  pollIntervalMinutes?: number;
  twoWaySync?: CaldavTwoWaySyncCfg;
}
