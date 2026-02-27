/**
 * Configuration model for the Trello integration.
 */

import { BaseIssueProviderCfg } from '../../issue.model';
export interface TrelloCfg extends BaseIssueProviderCfg {
  isEnabled: boolean;
  apiKey: string | null;
  token: string | null;
  boardId: string | null;
  filterUsername: string | null;

  // experimental: board - add board name
  boardName?: string | null;
}
