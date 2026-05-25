import { JiraOriginalTransition } from './jira-api-responses';
import { BaseIssueProviderCfg } from '../../issue.model';

// TODO this needs to be addressed to be either string or JiraOriginalTransition, but not both
export type JiraTransitionOption =
  | 'ALWAYS_ASK'
  | 'DO_NOT'
  | JiraOriginalTransition
  | string;

export enum JiraWorklogExportDefaultTime {
  AllTime = 'AllTime',
  TimeToday = 'TimeToday',
  TimeYesterday = 'TimeYesterday',
  AllTimeMinusLogged = 'AllTimeMinusLogged',
}

export interface JiraTransitionConfig {
  // NOTE: keys mirror IssueLocalState type
  // todo remove this with a proper migration since currently not used
  OPEN?: JiraTransitionOption;
  IN_PROGRESS: JiraTransitionOption;
  DONE: JiraTransitionOption;
}

export interface JiraCfg extends BaseIssueProviderCfg {
  _isBlockAccess: boolean;
  host: string | null;
  userName: string | null;
  password?: string | null;
  usePAT: boolean;

  isAllowSelfSignedCertificate: boolean;
  searchJqlQuery: string;

  autoAddBacklogJqlQuery: string;

  isWorklogEnabled: boolean;
  isAddWorklogOnSubTaskDone: boolean;
  worklogDialogDefaultTime: JiraWorklogExportDefaultTime;

  isUpdateIssueFromLocal: boolean;

  isShowComponents: boolean;

  isCheckToReAssignTicketOnTaskStart: boolean;

  storyPointFieldId: string | null;

  isTransitionIssuesEnabled: boolean;
  transitionConfig: JiraTransitionConfig;
  availableTransitions: JiraOriginalTransition[];
  userToAssignOnDone: string | null;
}

/*
Outline:

Issue Saving:
-------------
* Save all issues once they are linked to a task (and delete them when the task is deleted)
* Update an issue via polling (combine polling interval with todays tasks issues)
tasksToPoll$ = store.select("Issues that belong to todays tasks v") or do this via an effect

Use state for communication and hooks
-------------------------------------
searching ==> "search_start" and "search_success" action handled by an observable
of the searching component which merges the different available streams into one

isAutoPoll ==> own state
?polling ==> handle in own state

worklog ==> on task done
updateTicket ==> on task update
isShowComponents ==> via generic task tags
isCheckToReAssignTicket ==> via change current task
transitioning ==> via time tracking state

 */
