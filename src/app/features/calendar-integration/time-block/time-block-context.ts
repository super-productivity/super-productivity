import {
  IssueProvider,
  IssueProviderPluginType,
  isPluginIssueProvider,
} from '../../issue/issue.model';
import { PluginHttpService } from '../../../plugins/issue-provider/plugin-http.service';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import {
  IssueProviderPluginDefinition,
  PluginHttp,
} from '../../../plugins/issue-provider/plugin-issue-provider.model';
import { withPluginOAuthTokenKey } from '../../../plugins/oauth/plugin-oauth-token-key.util';

export interface TimeBlockContext {
  providerId: string;
  issueProvider: IssueProviderPluginType;
  pluginId: string;
  definition: IssueProviderPluginDefinition;
  config: Record<string, unknown>;
  http: PluginHttp;
}

/**
 * Find the first enabled plugin provider whose config has `configKey` switched on
 * and whose plugin implements `timeBlock`, and build an authenticated HTTP helper
 * for it. Returns null when there is none.
 */
export const createTimeBlockContext = (opts: {
  providers: IssueProvider[];
  configKey: string;
  registry: PluginIssueProviderRegistryService;
  httpService: PluginHttpService;
  filterProviderId?: string;
}): TimeBlockContext | null => {
  const provider = opts.providers.find(
    (p): p is IssueProviderPluginType =>
      (!opts.filterProviderId || p.id === opts.filterProviderId) &&
      isPluginIssueProvider(p.issueProviderKey) &&
      !!(p as IssueProviderPluginType).pluginConfig?.[opts.configKey],
  );
  if (!provider) return null;

  const registered = opts.registry.getProvider(provider.issueProviderKey);
  if (!registered?.definition.timeBlock) return null;

  const pluginConfig = withPluginOAuthTokenKey(
    registered.pluginId,
    provider.pluginConfig,
    provider.id,
  );
  const http = opts.httpService.createHttpHelper(
    () => registered.definition.getHeaders(pluginConfig),
    { allowPrivateNetwork: registered.allowPrivateNetwork },
  );
  return {
    providerId: provider.id,
    issueProvider: provider,
    pluginId: registered.pluginId,
    definition: registered.definition,
    config: pluginConfig,
    http,
  };
};
