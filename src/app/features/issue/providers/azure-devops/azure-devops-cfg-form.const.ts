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
        label: T.F.AZURE_DEVOPS.FORM.HOST,
        placeholder: 'https://dev.azure.com/your-org',
        description: T.F.AZURE_DEVOPS.FORM.HOST_DESCRIPTION,
        required: true,
        type: 'url',
      },
    },
    {
      key: 'project',
      type: 'input',
      templateOptions: {
        label: T.F.AZURE_DEVOPS.FORM.PROJECT,
        required: true,
      },
    },
    {
      key: 'token',
      type: 'input',
      templateOptions: {
        label: T.F.AZURE_DEVOPS.FORM.TOKEN,
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
            label: T.F.AZURE_DEVOPS.FORM.SCOPE,
            options: [
              { value: 'all', label: T.F.AZURE_DEVOPS.FORM.SCOPE_ALL },
              { value: 'created-by-me', label: T.F.AZURE_DEVOPS.FORM.SCOPE_CREATED },
              {
                value: 'assigned-to-me',
                label: T.F.AZURE_DEVOPS.FORM.SCOPE_ASSIGNED,
              },
            ],
          },
        },
      ],
    },
  ],
};
