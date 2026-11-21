import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { EMPTY, firstValueFrom, of } from 'rxjs';
import {
  catchError,
  concatMap,
  distinctUntilChanged,
  filter,
  map,
  pairwise,
  startWith,
  switchMap,
  take,
} from 'rxjs/operators';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { PluginLog } from '../../core/log';
import { HydrationStateService } from '../../op-log/apply/hydration-state.service';
import { selectAll } from '../../features/issue/store/issue-provider.selectors';
import { waitForSyncWindow } from '../../util/wait-for-sync-window.operator';
import {
  GOOGLE_CALENDAR_PLUGIN_ID,
  shouldScopePluginOAuth,
} from './plugin-oauth-token-key.util';
import { PluginOAuthBridgeService } from './plugin-oauth-bridge.service';

const sameIds = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

@Injectable()
export class PluginOAuthLifecycleEffects {
  private readonly _store = inject(Store);
  private readonly _dataInit = inject(DataInitStateService);
  private readonly _hydrationState = inject(HydrationStateService);
  private readonly _pluginOAuthBridge = inject(PluginOAuthBridgeService);

  private readonly _scopedProviderEntries$ = this._store.select(selectAll).pipe(
    map((providers) =>
      providers
        .filter(
          (provider): provider is typeof provider & { pluginId: string } =>
            'pluginId' in provider &&
            typeof provider.pluginId === 'string' &&
            shouldScopePluginOAuth(provider.pluginId),
        )
        .map((provider) => `${provider.pluginId}::${provider.id}`)
        .sort(),
    ),
    distinctUntilChanged(sameIds),
  );

  // Observe committed provider state, not ALL_ACTIONS: this also covers remote
  // deletes and full-state imports without dispatching another synced operation.
  // Capture the local boot identity BEFORE waiting for sync. Waiting alone would
  // still bind A's legacy token to B if the first sync replaces A with B.
  manageGoogleProviderTokens$ = createEffect(
    () =>
      this._dataInit.isAllDataLoadedInitially$.pipe(
        filter(Boolean),
        take(1),
        switchMap(() =>
          this._scopedProviderEntries$.pipe(
            startWith(null),
            pairwise(),
            // Serialize moves and deletes, preserving every removed id even if
            // several provider changes arrive while an IndexedDB write is pending.
            concatMap(([previousEntries, entries]) =>
              of(entries!).pipe(
                waitForSyncWindow(this._hydrationState, 'pluginOAuthLifecycle'),
                concatMap(async (bootEntries) => {
                  const currentEntries = await firstValueFrom(
                    this._scopedProviderEntries$,
                  );
                  const currentSet = new Set(currentEntries);
                  if (previousEntries === null) {
                    const bootCalendarIds = bootEntries
                      .filter((e) => e.startsWith(`${GOOGLE_CALENDAR_PLUGIN_ID}::`))
                      .map((e) => e.slice(GOOGLE_CALENDAR_PLUGIN_ID.length + 2));
                    if (
                      !this._hydrationState.isHydrationFallbackActive() &&
                      bootCalendarIds.length === 1 &&
                      currentSet.has(
                        `${GOOGLE_CALENDAR_PLUGIN_ID}::${bootCalendarIds[0]}`,
                      )
                    ) {
                      await this._pluginOAuthBridge.migrateLegacyOAuthTokenToScopedKey(
                        GOOGLE_CALENDAR_PLUGIN_ID,
                        bootCalendarIds[0],
                      );
                    } else {
                      // No unambiguous local owner: require reconnection rather
                      // than leave a credential for a future provider to inherit.
                      await this._pluginOAuthBridge.clearOAuthToken(
                        GOOGLE_CALENDAR_PLUGIN_ID,
                      );
                    }
                  }
                  for (const entry of previousEntries ?? bootEntries) {
                    if (!currentSet.has(entry)) {
                      const sepIdx = entry.indexOf('::');
                      const pluginId = entry.slice(0, sepIdx);
                      const id = entry.slice(sepIdx + 2);
                      await this._pluginOAuthBridge.clearOAuthToken(pluginId, id);
                    }
                  }
                }),
                catchError((error: unknown) => {
                  PluginLog.err('PluginOAuthLifecycle: Credential cleanup failed', error);
                  return EMPTY;
                }),
              ),
            ),
          ),
        ),
      ),
    { dispatch: false },
  );
}
