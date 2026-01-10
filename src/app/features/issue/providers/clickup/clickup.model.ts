import { BaseIssueProviderCfg } from '../../issue.model';

export interface ClickUpCfg extends BaseIssueProviderCfg {
  apiKey: string | null;
  teamIds?: string[];
  userId?: number | null;
}

export interface ClickUpTeam {
  id: string;
  name: string;
}
