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
import { GOOGLE_CALENDAR_PLUGIN_ID } from './plugin-oauth-token-key.util';
import { PluginOAuthBridgeService } from './plugin-oauth-bridge.service';

const sameIds = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

@Injectable()
export class PluginOAuthLifecycleEffects {
  private readonly _store = inject(Store);
  private readonly _dataInit = inject(DataInitStateService);
  private readonly _hydrationState = inject(HydrationStateService);
  private readonly _pluginOAuthBridge = inject(PluginOAuthBridgeService);

  private readonly _googleProviderIds$ = this._store.select(selectAll).pipe(
    map((providers) =>
      providers
        .filter(
          (provider) =>
            'pluginId' in provider && provider.pluginId === GOOGLE_CALENDAR_PLUGIN_ID,
        )
        .map((provider) => provider.id)
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
          this._googleProviderIds$.pipe(
            startWith(null),
            pairwise(),
            // Serialize moves and deletes, preserving every removed id even if
            // several provider changes arrive while an IndexedDB write is pending.
            concatMap(([previousIds, ids]) =>
              of(ids!).pipe(
                waitForSyncWindow(this._hydrationState, 'pluginOAuthLifecycle'),
                concatMap(async (bootIds) => {
                  const currentIds = await firstValueFrom(this._googleProviderIds$);
                  if (previousIds === null) {
                    if (
                      !this._hydrationState.isHydrationFallbackActive() &&
                      bootIds.length === 1 &&
                      sameIds(bootIds, currentIds)
                    ) {
                      await this._pluginOAuthBridge.migrateLegacyOAuthTokenToScopedKey(
                        GOOGLE_CALENDAR_PLUGIN_ID,
                        bootIds[0],
                      );
                    } else {
                      // No unambiguous local owner: require reconnection rather
                      // than leave a credential for a future provider to inherit.
                      await this._pluginOAuthBridge.clearOAuthToken(
                        GOOGLE_CALENDAR_PLUGIN_ID,
                      );
                    }
                  }
                  for (const id of previousIds ?? bootIds) {
                    if (!currentIds.includes(id)) {
                      await this._pluginOAuthBridge.clearOAuthToken(
                        GOOGLE_CALENDAR_PLUGIN_ID,
                        id,
                      );
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
