import { BaseIssueProviderCfg } from '../../issue.model';

export interface LinearCfg extends BaseIssueProviderCfg {
  apiKey: string | null;
  teamId?: string | null;
  projectId?: string | null;
}
