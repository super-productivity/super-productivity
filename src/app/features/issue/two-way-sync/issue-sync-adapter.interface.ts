import { FieldMapping, FieldSyncConfig } from './issue-sync.model';

export interface IssueSyncAdapter<TCfg> {
  getFieldMappings(): FieldMapping[];
  getSyncConfig(cfg: TCfg): FieldSyncConfig;
  fetchIssue(issueId: string, cfg: TCfg): Promise<Record<string, unknown>>;
  pushChanges(
    issueId: string,
    changes: Record<string, unknown>,
    cfg: TCfg,
  ): Promise<void>;
  extractSyncValues(issue: Record<string, unknown>): Record<string, unknown>;
  /** Extract the provider-specific last-updated marker (e.g. timestamp or etag hash) */
  getIssueLastUpdated?(issue: Record<string, unknown>): number;
  createIssue?(
    title: string,
    cfg: TCfg,
  ): Promise<{
    issueId: string;
    issueNumber: number;
    issueData: Record<string, unknown>;
  }>;
}
