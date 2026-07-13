import { TestBed } from '@angular/core/testing';
import { ActionReducer, Store } from '@ngrx/store';
import { of } from 'rxjs';
import { BannerService } from '../../core/banner/banner.service';
import { SnackService } from '../../core/snack/snack.service';
import { TIME_TRACKING_FEATURE_KEY } from '../../features/time-tracking/store/time-tracking.reducer';
import { lwwUpdateMetaReducer } from '../../root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer';
import { bulkApplyOperations } from '../apply/bulk-hydration.action';
import { bulkOperationsMetaReducer } from '../apply/bulk-hydration.meta-reducer';
import { OperationApplierService } from '../apply/operation-applier.service';
import { OperationLogEffects } from '../capture/operation-log.effects';
import { buildEntityRegistry, ENTITY_REGISTRY } from '../core/entity-registry';
import { EntityConflict, Operation, OpType } from '../core/operation.types';
import { toLwwUpdateActionType } from '../core/lww-update-action-types';
import { OpLogDbAdapter } from '../persistence/op-log-db-adapter';
import { STORE_NAMES } from '../persistence/db-keys.const';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';
import { VectorClockService } from './vector-clock.service';
import { CLIENT_ID_PROVIDER, ClientIdProvider } from '../util/client-id.provider';
import { ValidateStateService } from '../validation/validate-state.service';
import { ConflictJournalService } from './conflict-journal.service';
import { ConflictResolutionService } from './conflict-resolution.service';
import { SyncConflictBannerService } from './sync-conflict-banner.service';
import { SyncSessionValidationService } from './sync-session-validation.service';

describe('ConflictResolutionService persistence (integration, real store)', () => {
  const LOCAL_CLIENT_ID = 'local-client';
  const REMOTE_CLIENT_ID = 'remote-client';
  const ENTITY_ID = '*';
  const initialState = {
    [TIME_TRACKING_FEATURE_KEY]: { marker: 'initial' },
  };
  const localEntityState = { marker: 'local-winner' };

  let service: ConflictResolutionService;
  let opLogStore: OperationLogStoreService;
  let operationApplier: jasmine.SpyObj<OperationApplierService>;
  let liveResolutionOps: Operation[];

  const clientIdProvider: ClientIdProvider = {
    loadClientId: () => Promise.resolve(LOCAL_CLIENT_ID),
    getOrGenerateClientId: () => Promise.resolve(LOCAL_CLIENT_ID),
    clearCache: () => {},
  };

  const createLwwOp = (
    id: string,
    clientId: string,
    timestamp: number,
    marker: string,
    vectorClock: Record<string, number>,
  ): Operation => ({
    id,
    actionType: toLwwUpdateActionType('TIME_TRACKING'),
    opType: OpType.Update,
    entityType: 'TIME_TRACKING',
    entityId: ENTITY_ID,
    payload: {
      actionPayload: { marker },
      entityChanges: [],
      lwwUpdateMode: 'replace',
    },
    clientId,
    vectorClock,
    timestamp,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  });

  const createConflicts = (): {
    localOp: Operation;
    remoteLoser: Operation;
    remoteWinner: Operation;
    conflicts: EntityConflict[];
  } => {
    const localOp = createLwwOp('local-op', LOCAL_CLIENT_ID, 2_000, 'local-winner', {
      [LOCAL_CLIENT_ID]: 1,
    });
    const remoteLoser = createLwwOp(
      'remote-loser',
      REMOTE_CLIENT_ID,
      1_000,
      'remote-loser',
      { [REMOTE_CLIENT_ID]: 1 },
    );
    const remoteWinner = createLwwOp(
      'remote-winner',
      REMOTE_CLIENT_ID,
      3_000,
      'remote-winner',
      { [REMOTE_CLIENT_ID]: 2 },
    );
    return {
      localOp,
      remoteLoser,
      remoteWinner,
      conflicts: [
        {
          entityType: 'TIME_TRACKING',
          entityId: ENTITY_ID,
          localOps: [localOp],
          remoteOps: [remoteLoser],
          suggestedResolution: 'manual',
        },
        {
          entityType: 'TIME_TRACKING',
          entityId: ENTITY_ID,
          localOps: [localOp],
          remoteOps: [remoteWinner],
          suggestedResolution: 'manual',
        },
      ],
    };
  };

  const baseReducer: ActionReducer<typeof initialState> = (state = initialState) => state;
  const reducer = bulkOperationsMetaReducer(
    lwwUpdateMetaReducer(baseReducer) as ActionReducer<typeof initialState>,
  );
  const applyOperations = (
    state: typeof initialState,
    operations: Operation[],
  ): typeof initialState =>
    reducer(state, bulkApplyOperations({ operations, localClientId: LOCAL_CLIENT_ID }));

  beforeEach(async () => {
    const store = jasmine.createSpyObj<Store>('Store', ['select']);
    store.select.and.returnValue(of(localEntityState));
    operationApplier = jasmine.createSpyObj<OperationApplierService>(
      'OperationApplierService',
      ['applyOperations'],
    );
    operationApplier.applyOperations.and.callFake(async (operations, options) => {
      liveResolutionOps = operations;
      await options?.onReducersCommitted?.(operations);
      return { appliedOps: operations };
    });

    const snackService = jasmine.createSpyObj<SnackService>('SnackService', [
      'open',
      'hasPendingPersistentAction',
    ]);
    snackService.hasPendingPersistentAction.and.returnValue(false);
    const validateStateService = jasmine.createSpyObj<ValidateStateService>(
      'ValidateStateService',
      ['validateAndRepairCurrentState'],
    );
    validateStateService.validateAndRepairCurrentState.and.resolveTo(true);
    const operationLogEffects = jasmine.createSpyObj<OperationLogEffects>(
      'OperationLogEffects',
      ['processDeferredActions'],
    );
    operationLogEffects.processDeferredActions.and.resolveTo();
    const conflictJournal = jasmine.createSpyObj<ConflictJournalService>(
      'ConflictJournalService',
      ['record'],
    );
    conflictJournal.record.and.resolveTo();
    const syncConflictBanner = jasmine.createSpyObj<SyncConflictBannerService>(
      'SyncConflictBannerService',
      ['maybeShowSummaryBanner', 'navigateToReview'],
    );
    syncConflictBanner.maybeShowSummaryBanner.and.resolveTo();

    TestBed.configureTestingModule({
      providers: [
        ConflictResolutionService,
        OperationLogStoreService,
        VectorClockService,
        { provide: Store, useValue: store },
        { provide: OperationApplierService, useValue: operationApplier },
        { provide: SnackService, useValue: snackService },
        {
          provide: BannerService,
          useValue: jasmine.createSpyObj('BannerService', ['open']),
        },
        { provide: ValidateStateService, useValue: validateStateService },
        {
          provide: SyncSessionValidationService,
          useValue: jasmine.createSpyObj('SyncSessionValidationService', ['setFailed']),
        },
        { provide: OperationLogEffects, useValue: operationLogEffects },
        { provide: ConflictJournalService, useValue: conflictJournal },
        { provide: SyncConflictBannerService, useValue: syncConflictBanner },
        { provide: CLIENT_ID_PROVIDER, useValue: clientIdProvider },
        { provide: ENTITY_REGISTRY, useValue: buildEntityRegistry() },
      ],
    });

    service = TestBed.inject(ConflictResolutionService);
    opLogStore = TestBed.inject(OperationLogStoreService);
    await opLogStore.init();
    await opLogStore._clearAllDataForTesting();
    liveResolutionOps = [];
  });

  it('hydrates to the same winner that was applied live', async () => {
    const { localOp, conflicts } = createConflicts();
    await opLogStore.append(localOp, 'local');

    await service.autoResolveConflictsLWW(conflicts);

    const storedEntries = await opLogStore.getOpsAfterSeq(0);
    expect(storedEntries.length).toBe(4);
    expect(storedEntries[0].op.id).toBe('local-op');
    expect(storedEntries[1].op.id).toBe('remote-loser');
    expect(storedEntries[2].op.clientId).toBe(LOCAL_CLIENT_ID);
    expect(storedEntries[2].op.actionType).toBe(toLwwUpdateActionType('TIME_TRACKING'));
    expect(storedEntries[3].op.id).toBe('remote-winner');

    const stateBeforeResolution = applyOperations(initialState, [localOp]);
    const liveState = applyOperations(stateBeforeResolution, liveResolutionOps);
    const hydratedState = applyOperations(
      initialState,
      storedEntries.map(({ op }) => op),
    );

    expect(hydratedState).toEqual(liveState);
    expect(hydratedState[TIME_TRACKING_FEATURE_KEY]).toEqual({
      marker: 'remote-winner',
    });
  });

  it('rolls back loser and compensation when inserting the final winner fails', async () => {
    const { localOp, conflicts } = createConflicts();
    await opLogStore.setVectorClock({ [LOCAL_CLIENT_ID]: 1 });
    await opLogStore.append(localOp, 'local');

    const adapter = (
      opLogStore as unknown as {
        _adapter: OpLogDbAdapter;
      }
    )._adapter;
    const originalTransaction = adapter.transaction.bind(adapter);
    spyOn(adapter, 'transaction').and.callFake(async (stores, mode, callback) =>
      originalTransaction(stores, mode, async (tx) => {
        const failingTx = new Proxy(tx, {
          get: (target, property): unknown => {
            if (property === 'add') {
              return async (storeName: string, value: unknown) => {
                const operationId = (
                  value as { op?: { id?: unknown } } | null | undefined
                )?.op?.id;
                if (storeName === STORE_NAMES.OPS && operationId === 'remote-winner') {
                  throw new Error('injected final-winner persistence failure');
                }
                return target.add(storeName, value);
              };
            }
            const value = Reflect.get(target, property);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        return callback(failingTx);
      }),
    );

    await expectAsync(service.autoResolveConflictsLWW(conflicts)).toBeRejectedWithError(
      'injected final-winner persistence failure',
    );

    expect((await opLogStore.getOpsAfterSeq(0)).map(({ op }) => op.id)).toEqual([
      'local-op',
    ]);
    opLogStore.clearVectorClockCache();
    expect(await opLogStore.getVectorClock()).toEqual({ [LOCAL_CLIENT_ID]: 1 });
    expect(operationApplier.applyOperations).not.toHaveBeenCalled();
  });
});
