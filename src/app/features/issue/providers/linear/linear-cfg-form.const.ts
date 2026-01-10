import {
  ConfigFormSection,
  LimitedFormlyFieldConfig,
} from '../../../config/global-config.model';
import { IssueProviderLinear } from '../../issue.model';
import { ISSUE_PROVIDER_COMMON_FORM_FIELDS } from '../../common-issue-form-stuff.const';
import { LinearCfg } from './linear.model';

export const DEFAULT_LINEAR_CFG: LinearCfg = {
  isEnabled: false,
  apiKey: null,
  teamId: undefined,
  projectId: undefined,
};

export const LINEAR_CONFIG_FORM: LimitedFormlyFieldConfig<IssueProviderLinear>[] = [
  {
    key: 'apiKey',
    type: 'input',
    props: {
      label: 'API Key',
      required: true,
      type: 'password',
      placeholder: 'Your Linear personal API key',
    },
  },
  {
    key: 'teamId',
    type: 'input',
    props: {
      label: 'Team ID (optional)',
      placeholder: 'Filter to specific team',
      type: 'text',
    },
  },
  {
    key: 'projectId',
    type: 'input',
    props: {
      label: 'Project ID (optional)',
      placeholder: 'Your Linear project ID',
      type: 'text',
    },
  },
  {
    type: 'link',
    props: {
      url: 'https://linear.app/settings/account/security',
      txt: 'Get your API key',
    },
  },
  {
    type: 'collapsible',
    props: { label: 'Advanced Config' },
    fieldGroup: [...ISSUE_PROVIDER_COMMON_FORM_FIELDS],
  },
];

export const LINEAR_CONFIG_FORM_SECTION: ConfigFormSection<IssueProviderLinear> = {
  title: 'Linear',
  key: 'LINEAR',
  items: LINEAR_CONFIG_FORM,
  help: 'Configure Linear integration to sync issues and tasks.',
};
