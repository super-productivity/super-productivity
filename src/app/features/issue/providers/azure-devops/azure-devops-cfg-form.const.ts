import { ConfigFormSection } from '../../../config/global-config.model';
import { ISSUE_PROVIDER_COMMON_FORM_FIELDS } from '../../common-issue-form-stuff.const';
import { AzureDevOpsCfg } from './azure-devops.model';
import { T } from '../../../../t.const';
import {
  AZURE_DEVOPS_DEFAULT_WORK_ITEM_LIMIT,
  AZURE_DEVOPS_MAX_WORK_ITEM_LIMIT,
} from './azure-devops.const';

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
        {
          key: 'autoImportLimit',
          type: 'input',
          defaultValue: AZURE_DEVOPS_DEFAULT_WORK_ITEM_LIMIT,
          templateOptions: {
            required: true,
            label: T.F.AZURE_DEVOPS.FORM.AUTO_IMPORT_LIMIT,
            description: T.F.AZURE_DEVOPS.FORM.AUTO_IMPORT_LIMIT_DESCRIPTION,
            descriptionTranslateParams: {
              max: AZURE_DEVOPS_MAX_WORK_ITEM_LIMIT,
            },
            type: 'number',
            min: 1,
            max: AZURE_DEVOPS_MAX_WORK_ITEM_LIMIT,
          },
        },
      ],
    },
  ],
};
