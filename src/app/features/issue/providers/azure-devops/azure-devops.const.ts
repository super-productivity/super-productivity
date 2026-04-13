import { AzureDevOpsCfg } from './azure-devops.model';

export const AZURE_DEVOPS_INITIAL_CFG: AzureDevOpsCfg = {
  isEnabled: false,
  host: null,
  token: null,
  organization: null,
  project: null,
  scope: 'assigned-to-me',
};
