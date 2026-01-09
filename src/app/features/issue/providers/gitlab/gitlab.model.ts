import { BaseIssueProviderCfg } from '../../issue.model';

export interface GitlabCfg extends BaseIssueProviderCfg {
  project: string;
  filterUsername: string | null;
  gitlabBaseUrl: string | null | undefined;
  token: string | null;
  scope: string | null;
  filter: string | null;
  isEnableTimeTracking: boolean;
  isImportGitLabLabels: boolean;
  isForceUpdate: boolean;
}
