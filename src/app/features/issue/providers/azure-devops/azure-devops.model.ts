import { BaseIssueProviderCfg } from '../../issue.model';

export interface AzureDevOpsCfg extends BaseIssueProviderCfg {
  host: string | null;
  token: string | null;
  organization: string | null;
  project: string | null;
  scope: 'all' | 'created-by-me' | 'assigned-to-me';
}
