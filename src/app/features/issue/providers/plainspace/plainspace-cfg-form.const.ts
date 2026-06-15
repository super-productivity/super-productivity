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
  isAutoPoll: true,
  isAutoAddToBacklog: false,
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
      type: 'collapsible',
      // todo translate
      props: { label: 'Advanced Config' },
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
