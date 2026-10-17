import { BaseIssueProviderCfg } from '../../issue.model';
import { SyncDirection } from '../../two-way-sync/issue-sync.model';

export interface CaldavTwoWaySyncCfg {
  isDone?: SyncDirection;
  title?: SyncDirection;
  notes?: SyncDirection;
  /** Planned date <-> VTODO DTSTART. Optional: older saved configs lack it. */
  plannedDate?: SyncDirection;
  /** Deadline <-> VTODO DUE. Optional: older saved configs lack it. */
  deadline?: SyncDirection;
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
