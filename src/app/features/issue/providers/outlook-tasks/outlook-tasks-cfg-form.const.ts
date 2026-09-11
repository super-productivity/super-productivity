import { T } from '../../../../t.const';
import {
  ConfigFormSection,
  LimitedFormlyFieldConfig,
} from '../../../config/global-config.model';
import { IssueProviderOutlookTasks } from '../../issue.model';
import { ISSUE_PROVIDER_COMMON_FORM_FIELDS } from '../../common-issue-form-stuff.const';

const SYNC_DIRECTION_OPTIONS = [
  { value: 'off', label: T.F.OUTLOOK_TASKS.FORM.TWO_WAY_SYNC_OFF },
  { value: 'pullOnly', label: T.F.OUTLOOK_TASKS.FORM.TWO_WAY_SYNC_PULL_ONLY },
  { value: 'pushOnly', label: T.F.OUTLOOK_TASKS.FORM.TWO_WAY_SYNC_PUSH_ONLY },
  { value: 'both', label: T.F.OUTLOOK_TASKS.FORM.TWO_WAY_SYNC_BOTH },
];

const TWO_WAY_SYNC_FORM_FIELDS: LimitedFormlyFieldConfig<IssueProviderOutlookTasks>[] = [
  {
    type: 'collapsible',
    props: { label: T.F.OUTLOOK_TASKS.FORM.TWO_WAY_SYNC_SECTION },
    fieldGroup: [
      {
        key: 'twoWaySync.isDone',
        type: 'select',
        props: {
          label: T.F.OUTLOOK_TASKS.FORM.TWO_WAY_SYNC_STATUS,
          options: SYNC_DIRECTION_OPTIONS,
        },
      },
      {
        key: 'twoWaySync.title',
        type: 'select',
        props: {
          label: T.F.OUTLOOK_TASKS.FORM.TWO_WAY_SYNC_TITLE,
          options: SYNC_DIRECTION_OPTIONS,
        },
      },
      {
        key: 'twoWaySync.notes',
        type: 'select',
        props: {
          label: T.F.OUTLOOK_TASKS.FORM.TWO_WAY_SYNC_NOTES,
          options: SYNC_DIRECTION_OPTIONS,
        },
      },
    ],
  },
];

export const OUTLOOK_TASKS_CONFIG_FORM: LimitedFormlyFieldConfig<IssueProviderOutlookTasks>[] =
  [
    {
      key: 'clientId',
      type: 'input',
      templateOptions: {
        required: true,
        label: T.F.OUTLOOK_TASKS.FORM.CLIENT_ID,
        type: 'text',
        description: T.F.OUTLOOK_TASKS.FORM.CLIENT_ID_DESCRIPTION,
      },
    },
    {
      key: 'tenantId',
      type: 'input',
      templateOptions: {
        required: true,
        label: T.F.OUTLOOK_TASKS.FORM.TENANT_ID,
        type: 'text',
        description: T.F.OUTLOOK_TASKS.FORM.TENANT_ID_DESCRIPTION,
      },
    },
    {
      type: 'collapsible',
      props: { label: T.F.OUTLOOK_TASKS.FORM.ADVANCED_CONFIG },
      fieldGroup: [
        ...ISSUE_PROVIDER_COMMON_FORM_FIELDS,
        {
          key: 'taskListId',
          type: 'input',
          templateOptions: {
            label: T.F.OUTLOOK_TASKS.FORM.TASK_LIST_ID,
            type: 'text',
            description: T.F.OUTLOOK_TASKS.FORM.TASK_LIST_ID_DESCRIPTION,
          },
        },
        {
          key: 'pollIntervalMinutes',
          type: 'input',
          templateOptions: {
            label: T.F.OUTLOOK_TASKS.FORM.POLL_INTERVAL_MINUTES,
            type: 'number',
            min: 1,
          },
        },
      ],
    },
    ...TWO_WAY_SYNC_FORM_FIELDS,
  ];

export const OUTLOOK_TASKS_CONFIG_FORM_SECTION: ConfigFormSection<IssueProviderOutlookTasks> =
  {
    title: 'Outlook Tasks',
    key: 'OUTLOOK_TASKS',
    items: OUTLOOK_TASKS_CONFIG_FORM,
    help: T.F.OUTLOOK_TASKS.FORM_SECTION.HELP,
  };
