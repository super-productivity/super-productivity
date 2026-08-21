import { BaseIssueProviderCfg } from '../../issue.model';
import { SyncDirection } from '../../two-way-sync/issue-sync.model';

export interface OutlookTasksTwoWaySyncCfg {
  isDone?: SyncDirection;
  title?: SyncDirection;
  notes?: SyncDirection;
}

export interface OutlookTasksCfg extends BaseIssueProviderCfg {
  /** The issue provider entity ID — injected by _getCfgOnce$ for token persistence. */
  issueProviderId?: string;
  clientId: string | null;
  /** Azure AD tenant ID — 'common' for multi-tenant, or a specific tenant GUID. */
  tenantId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: number | null;
  /** ID of the task list to sync. Null = default task list. */
  taskListId: string | null;
  pollIntervalMinutes?: number;
  twoWaySync?: OutlookTasksTwoWaySyncCfg;
}
