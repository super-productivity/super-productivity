import { ConfigFormSection } from '../../../config/global-config.model';
import { ISSUE_PROVIDER_COMMON_FORM_FIELDS } from '../../common-issue-form-stuff.const';
import { AzureDevOpsCfg } from './azure-devops.model';
import { T } from '../../../../t.const';

export const AZURE_DEVOPS_CONFIG_FORM_SECTION: ConfigFormSection<AzureDevOpsCfg> = {
  title: 'Azure DevOps',
  key: 'AZURE_DEVOPS',
  items: [
    {
      key: 'host',
      type: 'input',
      templateOptions: {
        label: 'Host (Organization URL)',
        placeholder: 'https://dev.azure.com/your-org',
        required: true,
        type: 'url',
      },
    },
    {
      key: 'organization',
      type: 'input',
      templateOptions: {
        label: 'Organization',
        required: true,
      },
    },
    {
      key: 'project',
      type: 'input',
      templateOptions: {
        label: 'Project',
        required: true,
      },
    },
    {
      key: 'token',
      type: 'input',
      templateOptions: {
        label: 'Personal Access Token',
        required: true,
        type: 'password',
      },
    },
    {
      type: 'collapsible',
      props: { label: T.G.ADVANCED_CFG },
      fieldGroup: [
        ...ISSUE_PROVIDER_COMMON_FORM_FIELDS,
        {
          key: 'scope',
          type: 'select',
          defaultValue: 'assigned-to-me',
          templateOptions: {
            required: true,
            label: 'Scope (Auto Import only)',
            options: [
              { value: 'all', label: 'All' },
              { value: 'created-by-me', label: 'Created by me' },
              { value: 'assigned-to-me', label: 'Assigned to me' },
            ],
          },
        },
      ],
    },
  ],
};
