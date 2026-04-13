import { T } from '../../../../t.const';
import {
  ConfigFormSection,
  LimitedFormlyFieldConfig,
} from '../../../config/global-config.model';
import { IssueProviderCaldav } from '../../issue.model';
import { ISSUE_PROVIDER_COMMON_FORM_FIELDS } from '../../common-issue-form-stuff.const';

const SYNC_DIRECTION_OPTIONS = [
  { value: 'off', label: T.F.CALDAV.FORM.TWO_WAY_SYNC_OFF },
  { value: 'pullOnly', label: T.F.CALDAV.FORM.TWO_WAY_SYNC_PULL_ONLY },
  { value: 'pushOnly', label: T.F.CALDAV.FORM.TWO_WAY_SYNC_PUSH_ONLY },
  { value: 'both', label: T.F.CALDAV.FORM.TWO_WAY_SYNC_BOTH },
];

const TWO_WAY_SYNC_FORM_FIELDS: LimitedFormlyFieldConfig<IssueProviderCaldav>[] = [
  {
    type: 'collapsible',
    props: { label: T.F.CALDAV.FORM.TWO_WAY_SYNC_SECTION },
    fieldGroup: [
      {
        key: 'twoWaySync.isDone',
        type: 'select',
        props: {
          label: T.F.CALDAV.FORM.TWO_WAY_SYNC_STATUS,
          options: SYNC_DIRECTION_OPTIONS,
        },
      },
      {
        key: 'twoWaySync.title',
        type: 'select',
        props: {
          label: T.F.CALDAV.FORM.TWO_WAY_SYNC_TITLE,
          options: SYNC_DIRECTION_OPTIONS,
        },
      },
      {
        key: 'twoWaySync.notes',
        type: 'select',
        props: {
          label: T.F.CALDAV.FORM.TWO_WAY_SYNC_NOTES,
          options: SYNC_DIRECTION_OPTIONS,
        },
      },
    ],
  },
];

export const CALDAV_CONFIG_FORM: LimitedFormlyFieldConfig<IssueProviderCaldav>[] = [
  {
    key: 'caldavUrl',
    type: 'input',
    templateOptions: {
      required: true,
      label: T.F.CALDAV.FORM.CALDAV_URL,
      type: 'url',
      pattern: /^(http(s)?:\/\/)?([\w\-]+(?:\.[\w\-]+)*)(:\d+)?(\/\S*)?$/i,
    },
  },
  {
    key: 'resourceName',
    type: 'input',
    templateOptions: {
      required: true,
      label: T.F.CALDAV.FORM.CALDAV_RESOURCE,
      type: 'text',
    },
  },
  {
    key: 'username',
    type: 'input',
    templateOptions: {
      required: true,
      label: T.F.CALDAV.FORM.CALDAV_USER,
      type: 'text',
    },
  },
  {
    key: 'password',
    type: 'input',
    templateOptions: {
      required: true,
      type: 'password',
      label: T.F.CALDAV.FORM.CALDAV_PASSWORD,
    },
  },

  {
    type: 'collapsible',
    // todo translate
    props: { label: 'Advanced Config' },
    fieldGroup: [
      ...ISSUE_PROVIDER_COMMON_FORM_FIELDS,
      {
        key: 'categoryFilter',
        type: 'input',
        templateOptions: {
          label: T.F.CALDAV.FORM.CALDAV_CATEGORY_FILTER,
          type: 'text',
        },
      },
    ],
  },
  ...TWO_WAY_SYNC_FORM_FIELDS,
];

export const CALDAV_CONFIG_FORM_SECTION: ConfigFormSection<IssueProviderCaldav> = {
  title: 'CalDav',
  key: 'CALDAV',
  items: CALDAV_CONFIG_FORM,
  help: T.F.CALDAV.FORM_SECTION.HELP,
};
