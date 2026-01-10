import {
  ConfigFormSection,
  LimitedFormlyFieldConfig,
} from '../../../config/global-config.model';
import { IssueProviderClickUp } from '../../issue.model';
import { ISSUE_PROVIDER_COMMON_FORM_FIELDS } from '../../common-issue-form-stuff.const';
import { ClickUpCfg } from './clickup.model';

export const DEFAULT_CLICKUP_CFG: ClickUpCfg = {
  isEnabled: false,
  apiKey: null,
  teamIds: [],
  userId: null,
};

export const CLICKUP_CONFIG_FORM: LimitedFormlyFieldConfig<IssueProviderClickUp>[] = [
  {
    key: 'apiKey',
    type: 'input',
    props: {
      label: 'API Key',
      required: true,
      type: 'password',
      placeholder: 'pk_...',
    },
  },
  {
    type: 'link',
    props: {
      url: 'https://app.clickup.com/settings/apps',
      txt: 'Get your Personal API key',
    },
  },
  {
    type: 'collapsible',
    props: { label: 'Advanced Config' },
    fieldGroup: [...ISSUE_PROVIDER_COMMON_FORM_FIELDS],
  },
];

export const CLICKUP_CONFIG_FORM_SECTION: ConfigFormSection<IssueProviderClickUp> = {
  title: 'ClickUp',
  key: 'CLICKUP',
  items: CLICKUP_CONFIG_FORM,
  help: 'Configure ClickUp integration to sync tasks.',
  customSection: 'CLICKUP_CFG',
};

export const CLICKUP_HEADER_RATE_LIMIT_RESET = 'X-RateLimit-Reset';
