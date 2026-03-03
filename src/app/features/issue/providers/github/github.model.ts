import { BaseIssueProviderCfg } from '../../issue.model';
import { SyncDirection } from '../../two-way-sync/issue-sync.model';

export interface GithubTwoWaySyncCfg {
  isDone?: SyncDirection;
  title?: SyncDirection;
  notes?: SyncDirection;
}

export interface GithubCfg extends BaseIssueProviderCfg {
  repo: string | null;
  token: string | null;
  filterUsernameForIssueUpdates?: string | null;
  backlogQuery?: string;
  twoWaySync?: GithubTwoWaySyncCfg;
  isAutoCreateIssues?: boolean;
}
