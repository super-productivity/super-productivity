import { BaseIssueProviderCfg } from '../../issue.model';

export interface NextcloudDeckCfg extends BaseIssueProviderCfg {
  nextcloudBaseUrl: string | null;
  username: string | null;
  password: string | null;
  selectedBoardId: number | null;
  importStackIds: number[] | null;
  doneStackId: number | null;
  isTransitionIssuesEnabled: boolean;
  filterByAssignee: boolean;
}
