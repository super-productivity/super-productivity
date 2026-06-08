import { BaseIssueProviderCfg } from '../../issue.model';

export interface ForgejoCfg extends BaseIssueProviderCfg {
  repoFullname: string | null;
  host: string | null;
  token: string | null;
  scope: string | null;
  filterLabels: string | null;
  excludeLabels: string | null;
}
