import { BaseIssueProviderCfg } from '../../issue.model';
import { SyncDirection } from '../../two-way-sync/issue-sync.model';

export interface CaldavTwoWaySyncCfg {
  isDone?: SyncDirection;
  title?: SyncDirection;
  notes?: SyncDirection;
}

export interface CaldavCfg extends BaseIssueProviderCfg {
  caldavUrl: string | null;
  resourceName: string | null;
  username: string | null;
  password: string | null;
  categoryFilter: string | null;
  twoWaySync?: CaldavTwoWaySyncCfg;
}
