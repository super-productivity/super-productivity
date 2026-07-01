import { T } from '../../../../t.const';
import {
  ConfigFormSection,
  LimitedFormlyFieldConfig,
} from '../../../config/global-config.model';
import { IssueProviderPlainspace } from '../../issue.model';
import { ISSUE_PROVIDER_COMMON_FORM_FIELDS } from '../../common-issue-form-stuff.const';
import { PlainspaceCfg } from './plainspace.model';

export const DEFAULT_PLAINSPACE_CFG: PlainspaceCfg = {
  isEnabled: false,
  host: 'https://plainspace.org',
  spaceId: null,
  token: null,
  isAutoPoll: true,
  // Tasks assigned to me auto-import into the bound project's backlog, and the
  // poll keeps them in sync — Plainspace is meant to feel automatic.
  isAutoAddToBacklog: true,
  // Poll in the background regardless of which project is open, so assigned
  // tasks appear without navigating to the bound project. The backlog-poll
  // spinner is suppressed for these background polls (see
  // checkAndImportNewIssuesToBacklogForProject).
  pollingMode: 'always',
};

export const PLAINSPACE_CONFIG_FORM: LimitedFormlyFieldConfig<IssueProviderPlainspace>[] =
  [
    {
      key: 'host',
      type: 'input',
      templateOptions: {
        label: T.PLAINSPACE.FORM.HOST,
        type: 'url',
        required: true,
      },
    },
    {
      key: 'spaceId',
      type: 'input',
      templateOptions: {
        label: T.PLAINSPACE.FORM.SPACE_ID,
        required: false,
        description: T.PLAINSPACE.FORM.SPACE_ID_DESCRIPTION,
      },
    },
    {
      key: 'token',
      type: 'input',
      templateOptions: {
        label: T.PLAINSPACE.FORM.TOKEN,
        type: 'password',
        required: true,
        description: T.PLAINSPACE.FORM.TOKEN_DESCRIPTION,
      },
    },
    {
      type: 'collapsible',
      props: { label: T.G.ADVANCED_CFG },
      fieldGroup: [...ISSUE_PROVIDER_COMMON_FORM_FIELDS],
    },
  ];

export const PLAINSPACE_CONFIG_FORM_SECTION: ConfigFormSection<IssueProviderPlainspace> =
  {
    title: T.PLAINSPACE.FORM_SECTION.TITLE,
    key: 'PLAINSPACE',
    items: PLAINSPACE_CONFIG_FORM,
    help: T.PLAINSPACE.FORM_SECTION.HELP,
  };
