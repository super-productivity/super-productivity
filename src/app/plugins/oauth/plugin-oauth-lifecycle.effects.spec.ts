import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Action, provideStore, Store } from '@ngrx/store';
import { firstValueFrom, Subject, Subscription } from 'rxjs';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { ISSUE_PROVIDER_DEFAULT_COMMON_CFG } from '../../features/issue/issue.const';
import { IssueProviderPluginType } from '../../features/issue/issue.model';
import { IssueProviderActions } from '../../features/issue/store/issue-provider.actions';
import { issueProviderReducer } from '../../features/issue/store/issue-provider.reducer';
import { bulkApplyOperations } from '../../op-log/apply/bulk-hydration.action';
import { bulkOperationsMetaReducer } from '../../op-log/apply/bulk-hydration.meta-reducer';
import { HydrationStateService } from '../../op-log/apply/hydration-state.service';
import { ActionType, Operation, OpType } from '../../op-log/core/operation.types';
import { AppDataComplete } from '../../op-log/model/model-config';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { PluginOAuthBridgeService } from './plugin-oauth-bridge.service';
import { PluginOAuthLifecycleEffects } from './plugin-oauth-lifecycle.effects';
import { GOOGLE_CALENDAR_PLUGIN_ID } from './plugin-oauth-token-key.util';
import {
  deleteOAuthTokensByPrefix,
  loadOAuthTokens,
  saveOAuthTokens,
} from './plugin-oauth-token-store';
import { PluginOAuthService } from './plugin-oauth.service';

// Real provider reducer, remote-op conversion, OAuth service and IndexedDB: a
// changed provider identity must never authenticate with the old account.
describe('PluginOAuthLifecycleEffects', () => {
  const legacyKey = `${GOOGLE_CALENDAR_PLUGIN_ID}__oauth`;
  const scopedKey = (id: string): string => `${legacyKey}__${id}`;
  const serialized = JSON.stringify({
    accessToken: 'account-a-access',
    refreshToken: 'account-a-refresh',
    expiresAt: 4102444800000,
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: 'test-client',
  });
  const provider = (id: string): IssueProviderPluginType => ({
    ...ISSUE_PROVIDER_DEFAULT_COMMON_CFG,
    id,
    issueProviderKey: 'plugin:google-calendar-provider',
    pluginId: GOOGLE_CALENDAR_PLUGIN_ID,
    pluginConfig: { readCalendarIds: ['primary'], isAutoTimeBlock: true },
    isEnabled: true,
  });
  const operation = (action: Action, opType: OpType, id: string): Operation => ({
    id: `remote-${id}-${opType}`,
    actionType: action.type as ActionType,
    opType,
    entityType: 'ISSUE_PROVIDER',
    entityId: id,
    payload: action,
    clientId: 'remote-client',
    vectorClock: { ['remote-client']: 1 },
    timestamp: 1000,
    schemaVersion: 1,
  });
  let store: Store;
  let hydration: HydrationStateService;
  let bridge: PluginOAuthBridgeService;
  let ready$: Subject<boolean>;
  let completed$: Subject<void>;
  let subscription: Subscription;

  beforeEach(async () => {
    await deleteOAuthTokensByPrefix(legacyKey);
    await saveOAuthTokens(legacyKey, serialized);
    ready$ = new Subject<boolean>();
    completed$ = new Subject<void>();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideStore(
          { issueProvider: issueProviderReducer },
          {
            metaReducers: [bulkOperationsMetaReducer],
          },
        ),
        PluginOAuthLifecycleEffects,
        {
          provide: DataInitStateService,
          useValue: { isAllDataLoadedInitially$: ready$ },
        },
      ],
    });
    store = TestBed.inject(Store);
    hydration = TestBed.inject(HydrationStateService);
    bridge = TestBed.inject(PluginOAuthBridgeService);
    subscription = TestBed.inject(
      PluginOAuthLifecycleEffects,
    ).manageGoogleProviderTokens$.subscribe({
      next: () => completed$.next(),
      error: (error: unknown) => completed$.error(error),
    });
  });

  afterEach(async () => {
    subscription.unsubscribe();
    hydration.endApplyingRemoteOps();
    hydration.closeSyncWindow();
    await deleteOAuthTokensByPrefix(legacyKey);
  });

  const run = async (action: () => void): Promise<void> => {
    const completed = firstValueFrom(completed$);
    action();
    await completed;
  };
  const boot = async (ids: string[]): Promise<void> => {
    store.dispatch(
      IssueProviderActions.addIssueProviders({ issueProviders: ids.map(provider) }),
    );
    await run(() => ready$.next(true));
  };

  it('moves the sole local provider credential only after hydration completes', async () => {
    store.dispatch(
      IssueProviderActions.addIssueProvider({ issueProvider: provider('a') }),
    );
    expect(await loadOAuthTokens(scopedKey('a'))).toBeNull();
    expect(await loadOAuthTokens(legacyKey)).toBe(serialized);
    await run(() => ready$.next(true));
    expect(await bridge.getOAuthToken(GOOGLE_CALENDAR_PLUGIN_ID, undefined, 'a')).toBe(
      'account-a-access',
    );
    expect(await loadOAuthTokens(legacyKey)).toBeNull();
    await bridge.clearOAuthToken(GOOGLE_CALENDAR_PLUGIN_ID, 'a');
    expect(
      await bridge.getOAuthToken(GOOGLE_CALENDAR_PLUGIN_ID, undefined, 'a'),
    ).toBeNull();
  });

  it('does not give a new provider credentials when boot had no Google provider', async () => {
    await boot([]);
    await run(() =>
      store.dispatch(
        IssueProviderActions.addIssueProvider({ issueProvider: provider('b') }),
      ),
    );
    expect(
      await bridge.getOAuthToken(GOOGLE_CALENDAR_PLUGIN_ID, undefined, 'b'),
    ).toBeNull();
    expect(await loadOAuthTokens(legacyKey)).toBeNull();
  });

  it('does not leave an unowned legacy credential after fallback hydration', async () => {
    hydration.setHydrationFallbackActive(true);
    await boot(['a']);
    expect(await loadOAuthTokens(legacyKey)).toBeNull();
    expect(await loadOAuthTokens(scopedKey('a'))).toBeNull();
    await run(() =>
      store.dispatch(
        IssueProviderActions.loadIssueProviders({
          issueProviders: [provider('b')],
        }),
      ),
    );
    hydration.setHydrationFallbackActive(false);
    // A later clean startup must not be able to bind A's old credential to B.
    expect(
      await bridge.migrateLegacyOAuthTokenToScopedKey(GOOGLE_CALENDAR_PLUGIN_ID, 'b'),
    ).toBeFalse();
    expect(
      await bridge.getOAuthToken(GOOGLE_CALENDAR_PLUGIN_ID, undefined, 'b'),
    ).toBeNull();
  });

  it('does not choose an account when multiple providers existed at boot', async () => {
    await boot(['a', 'b']);
    await run(() =>
      store.dispatch(
        TaskSharedActions.deleteIssueProvider({
          issueProviderId: 'a',
          taskIdsToUnlink: [],
        }),
      ),
    );
    expect(
      await bridge.getOAuthToken(GOOGLE_CALENDAR_PLUGIN_ID, undefined, 'b'),
    ).toBeNull();
    expect(await loadOAuthTokens(legacyKey)).toBeNull();
  });

  it('waits for sync but never rebinds a replaced boot provider to another account', async () => {
    store.dispatch(
      IssueProviderActions.addIssueProvider({ issueProvider: provider('a') }),
    );
    hydration.startApplyingRemoteOps();
    TestBed.tick();
    ready$.next(true);
    expect(await loadOAuthTokens(scopedKey('a'))).toBeNull();
    store.dispatch(
      bulkApplyOperations({
        operations: [
          operation(
            TaskSharedActions.deleteIssueProvider({
              issueProviderId: 'a',
              taskIdsToUnlink: [],
            }),
            OpType.Delete,
            'a',
          ),
          operation(
            IssueProviderActions.addIssueProvider({ issueProvider: provider('b') }),
            OpType.Create,
            'b',
          ),
        ],
      }),
    );
    await run(() => {
      hydration.endApplyingRemoteOps();
      TestBed.tick();
    });
    expect(
      await bridge.getOAuthToken(GOOGLE_CALENDAR_PLUGIN_ID, undefined, 'b'),
    ).toBeNull();
    expect(await loadOAuthTokens(scopedKey('a'))).toBeNull();
    expect(await loadOAuthTokens(legacyKey)).toBeNull();
  });

  it('retains the pending startup migration when sync leaves the provider unchanged', async () => {
    store.dispatch(
      IssueProviderActions.addIssueProvider({ issueProvider: provider('a') }),
    );
    hydration.startApplyingRemoteOps();
    TestBed.tick();
    ready$.next(true);
    expect(await loadOAuthTokens(scopedKey('a'))).toBeNull();
    await run(() => {
      hydration.endApplyingRemoteOps();
      TestBed.tick();
    });
    expect(await bridge.getOAuthToken(GOOGLE_CALENDAR_PLUGIN_ID, undefined, 'a')).toBe(
      'account-a-access',
    );
  });

  it('preserves the boot account when first sync adds a different Google provider', async () => {
    store.dispatch(
      IssueProviderActions.addIssueProvider({ issueProvider: provider('a') }),
    );
    hydration.startApplyingRemoteOps();
    TestBed.tick();
    ready$.next(true);
    store.dispatch(
      bulkApplyOperations({
        operations: [
          operation(
            IssueProviderActions.addIssueProvider({ issueProvider: provider('b') }),
            OpType.Create,
            'b',
          ),
        ],
      }),
    );
    await run(() => {
      hydration.endApplyingRemoteOps();
      TestBed.tick();
    });
    expect(await bridge.getOAuthToken(GOOGLE_CALENDAR_PLUGIN_ID, undefined, 'a')).toBe(
      'account-a-access',
    );
    expect(
      await bridge.getOAuthToken(GOOGLE_CALENDAR_PLUGIN_ID, undefined, 'b'),
    ).toBeNull();
    expect(await loadOAuthTokens(legacyKey)).toBeNull();
  });

  it('cleans locally deleted credentials without clearing surviving accounts', async () => {
    await boot(['a']);
    await saveOAuthTokens(
      scopedKey('b'),
      serialized.replaceAll('account-a', 'account-b'),
    );
    await run(() =>
      store.dispatch(
        IssueProviderActions.addIssueProvider({ issueProvider: provider('b') }),
      ),
    );
    await run(() =>
      store.dispatch(
        TaskSharedActions.deleteIssueProvider({
          issueProviderId: 'a',
          taskIdsToUnlink: [],
        }),
      ),
    );
    expect(
      await bridge.getOAuthToken(GOOGLE_CALENDAR_PLUGIN_ID, undefined, 'a'),
    ).toBeNull();
    expect(await bridge.getOAuthToken(GOOGLE_CALENDAR_PLUGIN_ID, undefined, 'b')).toBe(
      'account-b-access',
    );
  });

  it('cleans remote deletions after replay without migrating the replacement provider', async () => {
    await boot(['a']);
    hydration.startApplyingRemoteOps();
    TestBed.tick();
    store.dispatch(
      bulkApplyOperations({
        operations: [
          operation(
            TaskSharedActions.deleteIssueProviders({ ids: ['a'], taskIdsToUnlink: [] }),
            OpType.Delete,
            'a',
          ),
          operation(
            IssueProviderActions.addIssueProvider({ issueProvider: provider('b') }),
            OpType.Create,
            'b',
          ),
        ],
      }),
    );
    await run(() => {
      hydration.endApplyingRemoteOps();
      TestBed.tick();
    });
    expect(await loadOAuthTokens(scopedKey('a'))).toBeNull();
    expect(TestBed.inject(PluginOAuthService).hasTokens(scopedKey('a'))).toBeFalse();
    expect(
      await bridge.getOAuthToken(GOOGLE_CALENDAR_PLUGIN_ID, undefined, 'b'),
    ).toBeNull();
  });

  it('cleans credentials removed by a full-state import', async () => {
    await boot(['a']);
    hydration.startApplyingRemoteOps();
    TestBed.tick();
    store.dispatch(
      loadAllData({
        appDataComplete: {
          issueProvider: { ids: ['b'], entities: { b: provider('b') } },
        } as unknown as AppDataComplete,
      }),
    );
    await run(() => {
      hydration.endApplyingRemoteOps();
      TestBed.tick();
    });
    expect(
      await bridge.getOAuthToken(GOOGLE_CALENDAR_PLUGIN_ID, undefined, 'a'),
    ).toBeNull();
    expect(
      await bridge.getOAuthToken(GOOGLE_CALENDAR_PLUGIN_ID, undefined, 'b'),
    ).toBeNull();
  });
});
