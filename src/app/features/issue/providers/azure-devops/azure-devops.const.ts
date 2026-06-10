import { AzureDevOpsCfg } from './azure-devops.model';

export const AZURE_DEVOPS_DEFAULT_WORK_ITEM_LIMIT = 50;
export const AZURE_DEVOPS_MAX_WORK_ITEM_LIMIT = 200;

export const AZURE_DEVOPS_INITIAL_CFG: AzureDevOpsCfg = {
  isEnabled: false,
  host: null,
  token: null,
  organization: null,
  project: null,
  scope: 'assigned-to-me',
  autoImportLimit: AZURE_DEVOPS_DEFAULT_WORK_ITEM_LIMIT,
};
