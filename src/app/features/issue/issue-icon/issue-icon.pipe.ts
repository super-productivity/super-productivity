import { inject, Pipe, PipeTransform } from '@angular/core';
import { IssueProviderKey } from '../issue.model';
import { ISSUE_PROVIDER_ICON_MAP } from '../issue.const';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { BuiltInIssueProviderKey } from '../issue.model';

@Pipe({ standalone: true, name: 'issueIcon' })
export class IssueIconPipe implements PipeTransform {
  private _pluginRegistry = inject(PluginIssueProviderRegistryService);

  // NOTE: null is only accepted to make view more performant
  transform(value?: IssueProviderKey, args?: any): any {
    if (!value) {
      return undefined;
    }
    if (this._pluginRegistry.hasProvider(value)) {
      const icon = this._pluginRegistry.getIcon(value);
      // 'extension' fallback means provider is not registered (e.g. plugin disabled)
      // Return undefined since 'extension' is not a registered SVG icon
      return icon === 'extension' ? undefined : icon;
    }
    return ISSUE_PROVIDER_ICON_MAP[value as BuiltInIssueProviderKey];
  }
}
