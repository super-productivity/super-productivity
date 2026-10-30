import { FieldMapping, FieldSyncConfig } from './issue-sync.model';

export interface IssueSyncAdapter<TCfg> {
  getFieldMappings(): FieldMapping[];
  /**
   * Per-field directions. With the issue as fetched, a provider can narrow
   * them for that item (e.g. a repeating item's time is pull only).
   */
  getSyncConfig(cfg: TCfg, issue?: Record<string, unknown>): FieldSyncConfig;
  fetchIssue(issueId: string, cfg: TCfg): Promise<Record<string, unknown>>;
  /**
   * May resolve to the item as the write left it (the write's own answer).
   * The engine then reads the new marker from it instead of fetching the item
   * again: a re-fetch could already include someone else's later change and
   * mark it as seen without pulling it.
   */
  pushChanges(
    issueId: string,
    changes: Record<string, unknown>,
    cfg: TCfg,
  ): Promise<void | Record<string, unknown>>;
  extractSyncValues(issue: Record<string, unknown>): Record<string, unknown>;
  /** Extract the provider-specific last-updated marker (e.g. timestamp or etag hash) */
  getIssueLastUpdated?(issue: Record<string, unknown>): number;
  /**
   * `ctx.taskId` is the SP task the issue is created for; a provider can derive
   * a deterministic remote id from it so a repeated create can't duplicate.
   */
  createIssue?(
    title: string,
    cfg: TCfg,
    ctx?: { taskId: string },
  ): Promise<{
    issueId: string;
    issueNumber?: number;
    issueData: Record<string, unknown>;
  }>;
  deleteIssue?(issueId: string, cfg: TCfg): Promise<void>;
}
