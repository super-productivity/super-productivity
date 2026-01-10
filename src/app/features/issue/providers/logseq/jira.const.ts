import { JiraCfg, JiraWorklogExportDefaultTime } from './jira.model';
import { GITHUB_INITIAL_POLL_DELAY } from '../github/github.const';
import { JIRA_ISSUE_CONTENT_CONFIG } from './jira-issue-content.const';
import {
  JIRA_CONFIG_FORM_SECTION,
  JIRA_WORK_LOG_EXPORT_CHECKBOXES,
  JIRA_WORK_LOG_EXPORT_FORM_OPTIONS,
} from './jira-cfg-form.const';

export const JIRA_DATETIME_FORMAT = 'YYYY-MM-DDTHH:mm:ss.SSZZ';

export const DEFAULT_JIRA_CFG: JiraCfg = {
  isEnabled: false,
  _isBlockAccess: false,
  host: null,
  userName: null,
  password: null,
  usePAT: false,

  searchJqlQuery: '',

  autoAddBacklogJqlQuery:
    'assignee = currentUser() AND sprint in openSprints() AND resolution = Unresolved',

  isWorklogEnabled: true,
  isAddWorklogOnSubTaskDone: true,
  worklogDialogDefaultTime: JiraWorklogExportDefaultTime.AllTime,
  isAllowSelfSignedCertificate: false,
  isUpdateIssueFromLocal: false,

  isShowComponents: true,

  isCheckToReAssignTicketOnTaskStart: false,

  storyPointFieldId: null,

  isTransitionIssuesEnabled: true,

  availableTransitions: [],
  transitionConfig: {
    // OPEN: 'DO_NOT',
    IN_PROGRESS: 'ALWAYS_ASK',
    DONE: 'ALWAYS_ASK',
  },
  userToAssignOnDone: null,
};

// export const JIRA_POLL_INTERVAL = 10 * 1000;
// export const JIRA_INITIAL_POLL_DELAY = 5000;

export const JIRA_POLL_INTERVAL = 5 * 60 * 1000;
export const JIRA_INITIAL_POLL_DELAY = GITHUB_INITIAL_POLL_DELAY + 4000;
export const JIRA_INITIAL_POLL_BACKLOG_DELAY = JIRA_INITIAL_POLL_DELAY + 10000;

// it's weird!!
export const JIRA_DATE_FORMAT = 'YYYY-MM-DDTHH:mm:ss.SSZZ';
export const JIRA_ISSUE_TYPE = 'JIRA';
export const JIRA_REQUEST_TIMEOUT_DURATION = 20000;
export const JIRA_MAX_RESULTS = 100;
export const JIRA_ADDITIONAL_ISSUE_FIELDS = [
  'assignee',
  'summary',
  'description',
  'timeestimate',
  'timespent',
  'status',
  'attachment',
  'comment',
  'updated',
  'components',
  'subtasks',
  'linkedIssues',
];

// there has to be one field otherwise we get all...
export const JIRA_REDUCED_ISSUE_FIELDS = [
  'summary',
  'updated',
  'timeestimate',
  'timespent',
];

// Re-export for backwards compatibility
export {
  JIRA_ISSUE_CONTENT_CONFIG,
  JIRA_CONFIG_FORM_SECTION,
  JIRA_WORK_LOG_EXPORT_FORM_OPTIONS,
  JIRA_WORK_LOG_EXPORT_CHECKBOXES,
};
