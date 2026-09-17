import { BaseIssueProviderCfg } from '../../issue.model';
import { JiraWorklogExportDefaultTime } from '../jira/jira.model';

export interface RedmineCfg extends BaseIssueProviderCfg {
  projectId: string | null;
  host: string | null;
  api_key: string | null;
  scope: string | null;
  isAutoPoll?: boolean;
  isSearchIssuesFromRedmine?: boolean;
  isAutoCreateTasks?: boolean;
  isAddToBacklogIfEnabled?: boolean;
  isShowTimeTrackingDialog?: boolean;
  isShowTimeTrackingDialogForEachSubTask?: boolean;
  timeTrackingDialogDefaultTime?: JiraWorklogExportDefaultTime;
}
