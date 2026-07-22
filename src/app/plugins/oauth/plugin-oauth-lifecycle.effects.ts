import { inject, Injectable } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { from, merge } from 'rxjs';
import { distinctUntilChanged, filter, map, mergeMap, switchMap } from 'rxjs/operators';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { ALL_ACTIONS, LOCAL_ACTIONS } from '../../util/local-actions.token';
import { bulkApplyOperations } from '../../op-log/apply/bulk-hydration.action';
import { ActionType, extractActionPayload } from '../../op-log/core/operation.types';
import type { Operation } from '../../op-log/core/operation.types';
import { selectAll } from '../../features/issue/store/issue-provider.selectors';
import { GOOGLE_CALENDAR_PLUGIN_ID } from './plugin-oauth-token-key.util';
import { PluginOAuthBridgeService } from './plugin-oauth-bridge.service';

const sameIds = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

const deletedIssueProviderIdsFromOperation = (op: Operation): string[] => {
  if (op.actionType === ActionType.TASK_SHARED_DELETE_ISSUE_PROVIDER) {
    const payload = extractActionPayload(op.payload) as { issueProviderId?: unknown };
    return typeof payload.issueProviderId === 'string' ? [payload.issueProviderId] : [];
  }
  if (op.actionType === ActionType.TASK_SHARED_DELETE_ISSUE_PROVIDERS) {
    const payload = extractActionPayload(op.payload) as { ids?: unknown };
    return Array.isArray(payload.ids)
      ? payload.ids.filter((id): id is string => typeof id === 'string')
      : [];
  }
  return [];
};

@Injectable()
export class PluginOAuthLifecycleEffects {
  private readonly _localActions$ = inject(LOCAL_ACTIONS);
  private readonly _allActions$ = inject(ALL_ACTIONS);
  private readonly _store = inject(Store);
  private readonly _pluginOAuthBridge = inject(PluginOAuthBridgeService);

  migrateSingleLegacyGoogleProvider$ = createEffect(
    () =>
      this._store.select(selectAll).pipe(
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
        filter((ids) => ids.length === 1),
        switchMap((ids) =>
          from(
            this._pluginOAuthBridge.migrateLegacyOAuthTokenToScopedKey(
              GOOGLE_CALENDAR_PLUGIN_ID,
              ids[0],
            ),
          ),
        ),
      ),
    { dispatch: false },
  );

  cleanupDeletedGoogleProviderTokens$ = createEffect(
    () =>
      merge(
        this._localActions$.pipe(
          ofType(TaskSharedActions.deleteIssueProvider),
          map(({ issueProviderId }) => [issueProviderId]),
        ),
        this._localActions$.pipe(
          ofType(TaskSharedActions.deleteIssueProviders),
          map(({ ids }) => ids),
        ),
        this._allActions$.pipe(
          ofType(bulkApplyOperations),
          map(({ operations }) =>
            operations.flatMap(deletedIssueProviderIdsFromOperation),
          ),
        ),
      ).pipe(
        mergeMap((ids) => from(ids)),
        mergeMap((issueProviderId) =>
          from(
            this._pluginOAuthBridge.clearOAuthToken(
              GOOGLE_CALENDAR_PLUGIN_ID,
              issueProviderId,
            ),
          ),
        ),
      ),
    { dispatch: false },
  );
}
