import { T } from '../../../../t.const';
import {
  ConfigFormSection,
  LimitedFormlyFieldConfig,
} from '../../../config/global-config.model';
import { IssueProviderRedmine } from '../../issue.model';
import { ISSUE_PROVIDER_COMMON_FORM_FIELDS } from '../../common-issue-form-stuff.const';
import { RedmineCfg } from './redmine.model';
import { JIRA_WORK_LOG_EXPORT_FORM_OPTIONS } from '../jira/jira.const';

export enum ScopeOptions {
  all = 'all',
  createdByMe = 'created-by-me',
  assignedToMe = 'assigned-to-me',
}

export const DEFAULT_REDMINE_CFG: RedmineCfg = {
  isEnabled: false,
  projectId: null,
  host: null,
  api_key: null,
  scope: 'assigned-to-me',
  isAutoPoll: false,
  isSearchIssuesFromRedmine: false,
  isAutoAddToBacklog: false,
  isShowTimeTrackingDialog: false,
  isShowTimeTrackingDialogForEachSubTask: false,
};

export const REDMINE_CONFIG_FORM: LimitedFormlyFieldConfig<IssueProviderRedmine>[] = [
  {
    key: 'host',
    type: 'input',

    templateOptions: {
      label: T.F.REDMINE.FORM.HOST,
      type: 'url',
      pattern: /^.+\/.+?$/i,
      required: true,
    },
  },
  {
    key: 'api_key',
    type: 'input',

    templateOptions: {
      label: T.F.REDMINE.FORM.API_KEY,
      required: true,
      type: 'password',
    },
  },
  {
    key: 'projectId',
    type: 'input',

    templateOptions: {
      label: T.F.REDMINE.FORM.PROJECT_ID,
      type: 'text',
      required: true,
      description: T.F.REDMINE.FORM.PROJECT_ID_DESCRIPTION,
    },
  },
  {
    key: 'scope',
    type: 'select',
    defaultValue: 'assigned-to-me',

    templateOptions: {
      required: true,
      label: T.F.REDMINE.FORM.SCOPE,
      options: [
        { value: ScopeOptions.all, label: T.F.REDMINE.FORM.SCOPE_ALL },
        { value: ScopeOptions.createdByMe, label: T.F.REDMINE.FORM.SCOPE_CREATED },
        { value: ScopeOptions.assignedToMe, label: T.F.REDMINE.FORM.SCOPE_ASSIGNED },
      ],
    },
  },
  {
    type: 'collapsible',
    // todo translate
    props: { label: 'Advanced Config' },
    fieldGroup: [
      ...ISSUE_PROVIDER_COMMON_FORM_FIELDS,
      {
        key: 'isShowTimeTrackingDialog',
        type: 'checkbox',

        templateOptions: {
          label: T.F.REDMINE.FORM.IS_SHOW_TIME_TRACKING_DIALOG,
          description: T.F.REDMINE.FORM.IS_SHOW_TIME_TRACKING_DIALOG_DESCRIPTION,
        },
      },
      {
        key: 'isShowTimeTrackingDialogForEachSubTask',
        type: 'checkbox',
        hideExpression: (model: any) =>
          !model.isShowTimeTrackingDialog || !model.isEnabled,
        templateOptions: {
          label: T.F.REDMINE.FORM.IS_SHOW_TIME_TRACKING_DIALOG_FOR_EACH_SUB_TASK,
        },
      },
      {
        key: 'timeTrackingDialogDefaultTime',
        type: 'select',
        hideExpression: (model: any) =>
          !model.isShowTimeTrackingDialog || !model.isEnabled,
        templateOptions: {
          label: T.F.JIRA.FORM_ADV.WORKLOG_DEFAULT_TIME_MODE,
          options: JIRA_WORK_LOG_EXPORT_FORM_OPTIONS,
        },
      },
    ],
  },
];

export const REDMINE_CONFIG_FORM_SECTION: ConfigFormSection<IssueProviderRedmine> = {
  title: T.F.REDMINE.FORM_SECTION.TITLE,
  key: 'REDMINE',
  items: REDMINE_CONFIG_FORM,
  help: T.F.REDMINE.FORM_SECTION.HELP,
};
