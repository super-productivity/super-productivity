import { Injectable, inject } from '@angular/core';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { PluginHttpService } from '../../../plugins/issue-provider/plugin-http.service';
import { TagService } from '../../tag/tag.service';
import { createPluginSyncAdapter } from '../../../plugins/issue-provider/plugin-sync-adapter.service';
import { IssueSyncAdapter } from './issue-sync-adapter.interface';
import { IssueSyncAdapterRegistryService } from './issue-sync-adapter-registry.service';

@Injectable({
  providedIn: 'root',
})
export class IssueSyncAdapterResolverService {
  private readonly _adapterRegistry = inject(IssueSyncAdapterRegistryService);
  private readonly _pluginRegistry = inject(PluginIssueProviderRegistryService);
  private readonly _pluginHttp = inject(PluginHttpService);
  private readonly _tagService = inject(TagService);

  getAdapter(issueType: string): IssueSyncAdapter<unknown> | undefined {
    const existing = this._adapterRegistry.get(issueType);
    if (existing) {
      return existing;
    }

    const provider = this._pluginRegistry.getProvider(issueType);
    const definition = provider?.definition;
    if (
      !provider ||
      !definition ||
      // `updateIssue` alone is intentional: calendar moves can push direct
      // event changes even when a provider has no task field mappings.
      (!definition.createIssue && !definition.deleteIssue && !definition.updateIssue)
    ) {
      return undefined;
    }

    const adapter = createPluginSyncAdapter(
      definition,
      (getHeadersFn) =>
        this._pluginHttp.createHttpHelper(getHeadersFn, {
          allowPrivateNetwork: provider.allowPrivateNetwork,
        }),
      this._tagService,
    );

    this._adapterRegistry.register(issueType, adapter);
    return adapter;
  }
}
