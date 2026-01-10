import { T } from '../../../../t.const';
import { ConfigFormSection } from '../../../config/global-config.model';
import { IssueProviderJira } from '../../issue.model';
import { ISSUE_PROVIDER_COMMON_FORM_FIELDS } from '../../common-issue-form-stuff.const';
import { JiraWorklogExportDefaultTime } from './jira.model';

export const JIRA_WORK_LOG_EXPORT_FORM_OPTIONS: {
  label: string;
  value: JiraWorklogExportDefaultTime;
}[] = [
  {
    label: T.F.JIRA.FORM_ADV.WORKLOG_DEFAULT_ALL_TIME,
    value: JiraWorklogExportDefaultTime.AllTime,
  },
  {
    label: T.F.JIRA.FORM_ADV.WORKLOG_DEFAULT_ALL_TIME_MINUS_LOGGED,
    value: JiraWorklogExportDefaultTime.AllTimeMinusLogged,
  },
  {
    label: T.F.JIRA.FORM_ADV.WORKLOG_DEFAULT_TODAY,
    value: JiraWorklogExportDefaultTime.TimeToday,
  },
  {
    label: T.F.JIRA.FORM_ADV.WORKLOG_DEFAULT_YESTERDAY,
    value: JiraWorklogExportDefaultTime.TimeYesterday,
  },
];

export const JIRA_WORK_LOG_EXPORT_CHECKBOXES: {
  label: string;
  value: JiraWorklogExportDefaultTime;
}[] = [
  {
    label: T.F.JIRA.DIALOG_WORKLOG.CHECKBOXES.ALL_TIME,
    value: JiraWorklogExportDefaultTime.AllTime,
  },
  {
    label: T.F.JIRA.DIALOG_WORKLOG.CHECKBOXES.ALL_TIME_MINUS_LOGGED,
    value: JiraWorklogExportDefaultTime.AllTimeMinusLogged,
  },
  {
    label: T.F.JIRA.DIALOG_WORKLOG.CHECKBOXES.TIME_SPENT_TODAY,
    value: JiraWorklogExportDefaultTime.TimeToday,
  },
  {
    label: T.F.JIRA.DIALOG_WORKLOG.CHECKBOXES.TIME_SPENT_YESTERDAY,
    value: JiraWorklogExportDefaultTime.TimeYesterday,
  },
];

export const JIRA_CONFIG_FORM_SECTION: ConfigFormSection<IssueProviderJira> = {
  title: 'Jira',
  key: 'JIRA',
  customSection: 'JIRA_CFG',
  helpArr: [
    {
      h: T.F.JIRA.FORM_SECTION.HELP_ARR.H1,
      p: T.F.JIRA.FORM_SECTION.HELP_ARR.P1_1,
      p2: T.F.JIRA.FORM_SECTION.HELP_ARR.P1_2,
      p3: T.F.JIRA.FORM_SECTION.HELP_ARR.P1_3,
      p4: T.F.JIRA.FORM_SECTION.HELP_ARR.P1_4,
    },
    {
      h: T.F.JIRA.FORM_SECTION.HELP_ARR.H2,
      p: T.F.JIRA.FORM_SECTION.HELP_ARR.P2_1,
      p2: T.F.JIRA.FORM_SECTION.HELP_ARR.P2_2,
      p3: T.F.JIRA.FORM_SECTION.HELP_ARR.P2_3,
    },
    {
      h: T.F.JIRA.FORM_SECTION.HELP_ARR.H3,
      p: T.F.JIRA.FORM_SECTION.HELP_ARR.P3_1,
    },
  ],
  items: [
    {
      key: 'host',
      type: 'input',
      templateOptions: {
        type: 'url',
        /* eslint-disable-next-line */
        pattern:
          /^(http(s)?:\/\/)?(localhost|[\w.\-]+(?:\.[\w\.\-]+)+)(:\d+)?(\/[^\s]*)?$/i,
        required: true,
        label: T.F.JIRA.FORM_CRED.HOST,
      },
    },
    {
      key: 'userName',
      type: 'input',
      templateOptions: {
        required: true,
        label: T.F.JIRA.FORM_CRED.USER_NAME,
      },
    },
    {
      key: 'password',
      type: 'input',
      templateOptions: {
        required: true,
        label: T.F.JIRA.FORM_CRED.PASSWORD,
        type: 'password',
      },
    },
    {
      type: 'link',
      templateOptions: {
        url: 'https://confluence.atlassian.com/cloud/api-tokens-938839638.html',
        txt: T.F.ISSUE.HOW_TO_GET_A_TOKEN,
        type: 'url',
      },
    },

    {
      type: 'collapsible',
      props: { label: T.G.ADVANCED_CFG },
      fieldGroup: [
        {
          key: 'isAllowSelfSignedCertificate',
          type: 'checkbox',
          templateOptions: {
            label: T.F.JIRA.FORM_CRED.ALLOW_SELF_SIGNED,
          },
        },
        {
          key: 'usePAT',
          type: 'checkbox',
          templateOptions: {
            required: false,
            label: T.F.JIRA.FORM_CRED.USE_PAT,
          },
        },

        ...ISSUE_PROVIDER_COMMON_FORM_FIELDS,

        {
          key: 'autoAddBacklogJqlQuery',
          type: 'input',
          templateOptions: {
            label: T.F.JIRA.FORM_ADV.AUTO_ADD_BACKLOG_JQL_QUERY,
          },
        },
        {
          key: 'searchJqlQuery',
          type: 'input',
          templateOptions: {
            label: T.F.JIRA.FORM_ADV.SEARCH_JQL_QUERY,
          },
        },
        {
          key: 'isCheckToReAssignTicketOnTaskStart',
          type: 'checkbox',
          templateOptions: {
            label: T.F.JIRA.FORM_ADV.IS_CHECK_TO_RE_ASSIGN_TICKET_ON_TASK_START,
          },
        },
        {
          key: 'isWorklogEnabled',
          type: 'checkbox',
          templateOptions: {
            label: T.F.JIRA.FORM_ADV.IS_WORKLOG_ENABLED,
          },
        },
        {
          key: 'isAddWorklogOnSubTaskDone',
          type: 'checkbox',
          templateOptions: {
            label: T.F.JIRA.FORM_ADV.IS_ADD_WORKLOG_ON_SUB_TASK_DONE,
          },
        },
        {
          hideExpression: (model: any) => {
            return !model.isWorklogEnabled;
          },
          key: 'worklogDialogDefaultTime',
          type: 'select',
          templateOptions: {
            label: T.F.JIRA.FORM_ADV.WORKLOG_DEFAULT_TIME_MODE,
            options: JIRA_WORK_LOG_EXPORT_FORM_OPTIONS,
          },
        },
      ],
    },
  ],
};
