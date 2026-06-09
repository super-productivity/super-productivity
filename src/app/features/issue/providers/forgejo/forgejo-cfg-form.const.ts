import { T } from '../../../../t.const';
import {
  ConfigFormSection,
  LimitedFormlyFieldConfig,
} from '../../../config/global-config.model';
import { IssueProviderForgejo } from '../../issue.model';
import { ISSUE_PROVIDER_COMMON_FORM_FIELDS } from '../../common-issue-form-stuff.const';
import { ForgejoCfg } from './forgejo.model';

export enum ScopeOptions {
  all = 'all',
  createdByMe = 'created-by-me',
  assignedToMe = 'assigned-to-me',
}

export const DEFAULT_FORGEJO_CFG: ForgejoCfg = {
  isEnabled: false,
  host: null,
  repoFullname: null,
  token: null,
  scope: 'created-by-me',
  filterLabels: null,
  excludeLabels: null,
};

export const FORGEJO_CONFIG_FORM: LimitedFormlyFieldConfig<IssueProviderForgejo>[] = [
  {
    key: 'host',
    type: 'input',
    templateOptions: {
      label: T.F.FORGEJO.FORM.HOST,
      type: 'url',
      pattern: /^.+\/.+?$/i,
      required: true,
    },
  },
  {
    key: 'token',
    type: 'input',
    templateOptions: {
      label: T.F.FORGEJO.FORM.TOKEN,
      required: true,
      type: 'password',
    },
  },
  {
    type: 'link',
    templateOptions: {
      url: 'https://forgejo.org/docs/latest/user/api-usage/',
      txt: T.F.ISSUE.HOW_TO_GET_A_TOKEN,
    },
  },
  {
    key: 'repoFullname',
    type: 'input',
    templateOptions: {
      label: T.F.FORGEJO.FORM.REPO_FULL_NAME,
      type: 'text',
      required: true,
      description: T.F.FORGEJO.FORM.REPO_FULL_NAME_DESCRIPTION,
    },
  },
  {
    key: 'scope',
    type: 'select',
    defaultValue: 'created-by-me',
    templateOptions: {
      required: true,
      label: T.F.FORGEJO.FORM.SCOPE,
      options: [
        { value: ScopeOptions.all, label: T.F.FORGEJO.FORM.SCOPE_ALL },
        { value: ScopeOptions.createdByMe, label: T.F.FORGEJO.FORM.SCOPE_CREATED },
        { value: ScopeOptions.assignedToMe, label: T.F.FORGEJO.FORM.SCOPE_ASSIGNED },
      ],
    },
  },
  {
    key: 'filterLabels',
    type: 'input',
    templateOptions: {
      label: T.F.FORGEJO.FORM.FILTER_LABELS,
      type: 'text',
      description: T.F.FORGEJO.FORM.FILTER_LABELS_DESCRIPTION,
    },
  },
  {
    key: 'excludeLabels',
    type: 'input',
    templateOptions: {
      label: T.F.FORGEJO.FORM.EXCLUDE_LABELS,
      type: 'text',
      description: T.F.FORGEJO.FORM.EXCLUDE_LABELS_DESCRIPTION,
    },
  },
  {
    type: 'collapsible',
    // todo translate
    props: { label: 'Advanced Config' },
    fieldGroup: [...ISSUE_PROVIDER_COMMON_FORM_FIELDS],
  },
];

export const FORGEJO_CONFIG_FORM_SECTION: ConfigFormSection<IssueProviderForgejo> = {
  title: 'Forgejo',
  key: 'FORGEJO',
  items: FORGEJO_CONFIG_FORM,
  help: T.F.FORGEJO.FORM_SECTION.HELP,
};
