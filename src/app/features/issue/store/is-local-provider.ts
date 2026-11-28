import { isConfigLocalNetworkOnly } from '../../../util/is-local-network-host';
import { IssueProvider } from '../issue.model';

/** Local-network providers (e.g. self-hosted GitLab at 192.168.x.x) work offline. */
export const isLocalProvider = (provider: IssueProvider): boolean =>
  isConfigLocalNetworkOnly('pluginConfig' in provider ? provider.pluginConfig : provider);
