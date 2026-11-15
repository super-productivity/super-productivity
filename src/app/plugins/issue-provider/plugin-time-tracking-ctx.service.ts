import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { first, map } from 'rxjs/operators';
import type {
  IssueProviderPluginDefinition,
  PluginHttp,
  PluginTimeTracking,
} from '@super-productivity/plugin-api';
import { IssueProviderPluginType } from '../../features/issue/issue.model';
import { selectIssueProviderState } from '../../features/issue/store/issue-provider.selectors';
import { SnackService } from '../../core/snack/snack.service';
import { getErrorTxt } from '../../util/get-error-text';
import { T } from '../../t.const';
import {
  PluginIssueProviderRegistryService,
  toPluginSvgIcon,
} from './plugin-issue-provider-registry.service';
import { PluginHttpService } from './plugin-http.service';
import { withPluginOAuthTokenKey } from '../oauth/plugin-oauth-token-key.util';

/** Everything needed to call a plugin provider's `timeTracking` for one issue provider. */
export interface PluginTimeTrackingCtx {
  cfg: IssueProviderPluginType;
  definition: IssueProviderPluginDefinition;
  timeTracking: PluginTimeTracking;
  pluginConfig: Record<string, unknown>;
  http: PluginHttp;
  providerName: string;
  icon: string | undefined;
}

/**
 * Resolves the time-tracking context of a plugin issue provider; shared by the
 * track-time-on-done and the submit-on-finish-day flows.
 */
@Injectable({ providedIn: 'root' })
export class PluginTimeTrackingCtxService {
  private readonly _store = inject(Store);
  private readonly _registry = inject(PluginIssueProviderRegistryService);
  private readonly _pluginHttp = inject(PluginHttpService);
  private readonly _snackService = inject(SnackService);

  /** Config of a plugin issue provider, or undefined for built-in/unconfigured ones. */
  getCfgOnce$(issueProviderId: string): Observable<IssueProviderPluginType | undefined> {
    return this._store.select(selectIssueProviderState).pipe(
      first(),
      map(({ entities }) => {
        const cfg = entities[issueProviderId] as IssueProviderPluginType | undefined;
        return cfg?.pluginId && cfg.pluginConfig ? cfg : undefined;
      }),
    );
  }

  /** Undefined when the plugin is not loaded or implements no `timeTracking`. */
  buildCtx(cfg: IssueProviderPluginType): PluginTimeTrackingCtx | undefined {
    const provider = this._registry.getProvider(cfg.issueProviderKey);
    const timeTracking = provider?.definition.timeTracking;
    if (!provider || !timeTracking) {
      return undefined;
    }
    const pluginConfig = withPluginOAuthTokenKey(
      provider.pluginId,
      cfg.pluginConfig,
      cfg.id,
    );
    const http = this._pluginHttp.createHttpHelper(
      () => provider.definition.getHeaders(pluginConfig),
      { allowPrivateNetwork: provider.allowPrivateNetwork },
    );
    return {
      cfg,
      definition: provider.definition,
      timeTracking,
      pluginConfig,
      http,
      providerName: this._registry.getHumanReadableName(cfg.issueProviderKey),
      icon: toPluginSvgIcon(provider.icon, provider.pluginId),
    };
  }

  showError(ctx: PluginTimeTrackingCtx, e: unknown): void {
    this._snackService.open({
      type: 'ERROR',
      msg: T.F.ISSUE.S.ERR_GENERIC,
      translateParams: { issueProviderName: ctx.providerName, errTxt: getErrorTxt(e) },
    });
  }
}
