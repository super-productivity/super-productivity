import { T } from '../../../../t.const';
import {
  ConfigFormSection,
  LimitedFormlyFieldConfig,
} from '../../../config/global-config.model';
import { IssueProviderNextcloudDeck } from '../../issue.model';
import { ISSUE_PROVIDER_COMMON_FORM_FIELDS } from '../../common-issue-form-stuff.const';

export const NEXTCLOUD_DECK_CONFIG_FORM: LimitedFormlyFieldConfig<IssueProviderNextcloudDeck>[] =
  [
    {
      key: 'nextcloudBaseUrl',
      type: 'input',
      templateOptions: {
        required: true,
        label: T.F.NEXTCLOUD_DECK.FORM.BASE_URL,
        type: 'url',
        pattern: /^(http(s)?:\/\/)?([\w\-]+(?:\.[\w\-]+)*)(:\d+)?(\/\S*)?$/i,
      },
    },
    {
      key: 'username',
      type: 'input',
      templateOptions: {
        required: true,
        label: T.F.NEXTCLOUD_DECK.FORM.USERNAME,
        type: 'text',
      },
    },
    {
      key: 'password',
      type: 'input',
      templateOptions: {
        required: true,
        type: 'password',
        label: T.F.NEXTCLOUD_DECK.FORM.PASSWORD,
      },
    },
    {
      type: 'collapsible',
      props: { label: 'Advanced Config' },
      fieldGroup: [
        ...ISSUE_PROVIDER_COMMON_FORM_FIELDS,
        {
          key: 'filterByAssignee',
          type: 'checkbox',
          templateOptions: {
            label: T.F.NEXTCLOUD_DECK.FORM.FILTER_BY_ASSIGNEE,
          },
        },
        {
          key: 'isTransitionIssuesEnabled',
          type: 'checkbox',
          templateOptions: {
            label: T.F.NEXTCLOUD_DECK.FORM.IS_TRANSITION_ISSUES_ENABLED,
          },
        },
        {
          key: 'pollIntervalMinutes',
          type: 'input',
          templateOptions: {
            required: true,
            label: T.F.NEXTCLOUD_DECK.FORM.POLL_INTERVAL_MINUTES,
            type: 'number',
            min: 1,
          },
        },
        {
          key: 'titleTemplate',
          type: 'input',
          templateOptions: {
            label: T.F.NEXTCLOUD_DECK.FORM.TITLE_TEMPLATE,
            description: T.F.NEXTCLOUD_DECK.FORM.TITLE_TEMPLATE_DESCRIPTION,
          },
        },
      ],
    },
  ];

export const NEXTCLOUD_DECK_CONFIG_FORM_SECTION: ConfigFormSection<IssueProviderNextcloudDeck> =
  {
    title: 'Nextcloud Deck',
    key: 'NEXTCLOUD_DECK',
    items: NEXTCLOUD_DECK_CONFIG_FORM,
    help: T.F.NEXTCLOUD_DECK.FORM_SECTION.HELP,
  };
