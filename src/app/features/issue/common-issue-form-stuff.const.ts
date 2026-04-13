import { T } from '../../t.const';
import { LimitedFormlyFieldConfig } from '../config/global-config.model';
import { IssueProvider } from './issue.model';
import { IS_ELECTRON } from '../../app.constants';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';

// NOTE: FILE IS REQUIRED TO AVOID CIRCULAR DEPENDENCY ISSUES

// const ISSUE_PROVIDER_FF_LINE: LimitedFormlyFieldConfig<IssueProvider> = {
//   type: 'tpl',
//   className: `tpl line`,
//   props: {
//     tag: 'hr',
//   },
// };

// export const ISSUE_PROVIDER_FF_CREDENTIALS: LimitedFormlyFieldConfig<IssueProvider> = {
//   type: 'tpl',
//   className: 'tpl',
//   props: {
//     tag: 'h3',
//     class: 'sub-section-heading-first',
//     // text: T.F.JIRA.FORM_SECTION.CREDENTIALS,
//     text: 'Credentials',
//   },
// };

// const ISSUE_PROVIDER_FF_ADVANCED_SETTINGS_HEADER: LimitedFormlyFieldConfig<IssueProvider> =
//   {
//     type: 'tpl',
//     className: 'tpl',
//     props: {
//       tag: 'h3',
//       class: 'sub-section-heading',
//       text: T.F.JIRA.FORM_SECTION.ADV_CFG,
//     },
//   };

export const ISSUE_PROVIDER_FF_DEFAULT_PROJECT: LimitedFormlyFieldConfig<IssueProvider> =
  {
    key: 'defaultProjectId',
    type: 'project-select',
    defaultValue: false,
    props: {
      label: T.F.ISSUE.DEFAULT_PROJECT_LABEL,
      description: T.F.ISSUE.DEFAULT_PROJECT_DESCRIPTION,
    },
  } as const;

export const CROSS_ORIGIN_WARNING: LimitedFormlyFieldConfig<IssueProvider>[] =
  !IS_ELECTRON && !IS_ANDROID_WEB_VIEW
    ? [
        {
          type: 'tpl',
          className: 'tpl',
          props: {
            tag: 'div',
            class: 'warning-box',
            text: T.F.ISSUE.CROSS_ORIGIN_BROWSER_WARNING,
          },
        },
      ]
    : [];

export const ISSUE_PROVIDER_COMMON_FORM_FIELDS: LimitedFormlyFieldConfig<IssueProvider>[] =
  [
    // ISSUE_PROVIDER_FF_ADVANCED_SETTINGS_HEADER,
    ISSUE_PROVIDER_FF_DEFAULT_PROJECT,
    // {
    //   key: 'isIntegratedAddTaskBar',
    //   type: 'checkbox',
    //   props: {
    //     label: T.F.CALDAV.FORM.IS_SEARCH_ISSUES_FROM_CALDAV,
    //   },
    // },
    {
      key: 'isAutoAddToBacklog',
      type: 'checkbox',
      expressions: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'props.disabled': '!model.defaultProjectId',
      },
      props: {
        label: T.F.ISSUE.FORM.AUTO_ADD_TO_BACKLOG,
      },
    },
    {
      key: 'isAutoPoll',
      type: 'checkbox',
      props: {
        label: T.F.ISSUE.FORM.AUTO_POLL,
      },
    },
    {
      key: 'pollingMode',
      type: 'select',
      defaultValue: 'whenProjectOpen',
      expressions: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'props.disabled': '!model.isAutoPoll && !model.isAutoAddToBacklog',
        // ICAL already polls globally via selectAllCalendarIssueTasks, so pollingMode has no effect
        hide: 'model.issueProviderKey === "ICAL"',
      },
      props: {
        label: T.F.ISSUE.FORM.POLLING_MODE,
        description: T.F.ISSUE.FORM.POLLING_MODE_DESCRIPTION,
        options: [
          {
            value: 'whenProjectOpen',
            label: T.F.ISSUE.FORM.POLLING_MODE_WHEN_PROJECT_OPEN,
          },
          { value: 'always', label: T.F.ISSUE.FORM.POLLING_MODE_ALWAYS },
        ],
      },
    },
    {
      key: 'defaultNote',
      type: 'textarea',
      props: {
        label: T.F.ISSUE.DEFAULT_NOTE_LABEL,
        rows: 3,
      },
    },
    // ISSUE_PROVIDER_FF_LINE,
  ] as const;
