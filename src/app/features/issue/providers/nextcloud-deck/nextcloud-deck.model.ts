import { BaseIssueProviderCfg } from '../../issue.model';

export interface NextcloudDeckCfg extends BaseIssueProviderCfg {
  nextcloudBaseUrl: string | null;
  username: string | null;
  password: string | null;
  selectedBoardId: number | null;
  selectedBoardTitle: string | null;
  importStackIds: number[] | null;
  doneStackId: number | null;
  isTransitionIssuesEnabled: boolean;
  filterByAssignee: boolean;
  titleTemplate: string | null;
  pollIntervalMinutes: number;
}
