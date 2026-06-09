import { T } from '../../../../t.const';
import {
  ConfigFormSection,
  LimitedFormlyFieldConfig,
} from '../../../config/global-config.model';
import { IssueProviderCodeberg } from '../../issue.model';
import { ISSUE_PROVIDER_COMMON_FORM_FIELDS } from '../../common-issue-form-stuff.const';
import { CodebergCfg } from './codeberg.model';

export enum ScopeOptions {
  all = 'all',
  createdByMe = 'created-by-me',
  assignedToMe = 'assigned-to-me',
}

export const DEFAULT_CODEBERG_CFG: CodebergCfg = {
  isEnabled: false,
  host: 'https://codeberg.org',
  repoFullname: null,
  token: null,
  scope: 'created-by-me',
  filterLabels: null,
  excludeLabels: null,
};

export const CODEBERG_CONFIG_FORM: LimitedFormlyFieldConfig<IssueProviderCodeberg>[] = [
  {
    key: 'host',
    type: 'input',
    templateOptions: {
      label: T.F.CODEBERG.FORM.HOST,
      type: 'url',
      pattern: /^.+\/.+?$/i,
      required: true,
    },
  },
  {
    key: 'token',
    type: 'input',
    templateOptions: {
      label: T.F.CODEBERG.FORM.TOKEN,
      required: true,
      type: 'password',
    },
  },
  {
    type: 'link',
    templateOptions: {
      url: 'https://docs.codeberg.org/advanced/access-token/',
      txt: T.F.ISSUE.HOW_TO_GET_A_TOKEN,
    },
  },
  {
    key: 'repoFullname',
    type: 'input',
    templateOptions: {
      label: T.F.CODEBERG.FORM.REPO_FULL_NAME,
      type: 'text',
      required: true,
      description: T.F.CODEBERG.FORM.REPO_FULL_NAME_DESCRIPTION,
    },
  },
  {
    key: 'scope',
    type: 'select',
    defaultValue: 'created-by-me',
    templateOptions: {
      required: true,
      label: T.F.CODEBERG.FORM.SCOPE,
      options: [
        { value: ScopeOptions.all, label: T.F.CODEBERG.FORM.SCOPE_ALL },
        { value: ScopeOptions.createdByMe, label: T.F.CODEBERG.FORM.SCOPE_CREATED },
        { value: ScopeOptions.assignedToMe, label: T.F.CODEBERG.FORM.SCOPE_ASSIGNED },
      ],
    },
  },
  {
    key: 'filterLabels',
    type: 'input',
    templateOptions: {
      label: T.F.CODEBERG.FORM.FILTER_LABELS,
      type: 'text',
      description: T.F.CODEBERG.FORM.FILTER_LABELS_DESCRIPTION,
    },
  },
  {
    key: 'excludeLabels',
    type: 'input',
    templateOptions: {
      label: T.F.CODEBERG.FORM.EXCLUDE_LABELS,
      type: 'text',
      description: T.F.CODEBERG.FORM.EXCLUDE_LABELS_DESCRIPTION,
    },
  },
  {
    type: 'collapsible',
    // todo translate
    props: { label: 'Advanced Config' },
    fieldGroup: [...ISSUE_PROVIDER_COMMON_FORM_FIELDS],
  },
];

export const CODEBERG_CONFIG_FORM_SECTION: ConfigFormSection<IssueProviderCodeberg> = {
  title: 'Codeberg',
  key: 'CODEBERG',
  items: CODEBERG_CONFIG_FORM,
  help: T.F.CODEBERG.FORM_SECTION.HELP,
};
