import { BaseIssueProviderCfg } from '../../issue.model';

export type GitlabIssueSource = 'project' | 'group' | 'all';

export interface GitlabCfg extends BaseIssueProviderCfg {
  project: string | null;
  /**
   * Where issues come from. Missing means 'project' (persisted data created before
   * this field existed lacks it). Deliberately not named `source`: a 2021–2024
   * setting under that key may still sit in old data and must stay inert.
   */
  issueSource?: GitlabIssueSource;
  /** Group path or ID, used when `issueSource` is 'group'. */
  group?: string | null;
  filterUsername: string | null;
  /** @deprecated backwards compatibility: optional for persisted data created before this field existed */
  gitlabBaseUrl?: string | null;
  token: string | null;
  /** @deprecated backwards compatibility: optional for persisted data created before this field existed */
  scope?: string | null;
  /** @deprecated backwards compatibility: optional for persisted data created before this field existed */
  filter?: string | null;
  /** @deprecated backwards compatibility: optional for persisted data created before this field existed */
  isEnableTimeTracking?: boolean;
}
