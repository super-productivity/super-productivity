import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { OperationLogHydratorService } from './operation-log-hydrator.service';
import { OperationLogStoreService } from './operation-log-store.service';
import { OperationLogMigrationService } from './operation-log-migration.service';
import { SchemaMigrationService } from './schema-migration.service';
import { CURRENT_SCHEMA_VERSION } from './schema-migration.service';
import { OperationLogSnapshotService } from './operation-log-snapshot.service';
import { OperationLogRecoveryService } from './operation-log-recovery.service';
import { SyncHydrationService } from './sync-hydration.service';
import { ArchiveMigrationService } from './archive-migration.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { SnackService } from '../../core/snack/snack.service';
import { ValidateStateService } from '../validation/validate-state.service';
import { OperationApplierService } from '../apply/operation-applier.service';
import { HydrationStateService } from '../apply/hydration-state.service';
import { VectorClockService } from '../sync/vector-clock.service';
import { CLIENT_ID_PROVIDER, ClientIdProvider } from '../util/client-id.provider';
import { ActionType, EntityType, Operation, OpType } from '../core/operation.types';
import { ApplyOperationsResult } from '../core/types/apply.types';
import { uuidv7 } from '../../util/uuid-v7';
import { bulkApplyOperations } from '../apply/bulk-hydration.action';
import { bulkOperationsMetaReducer } from '../apply/bulk-hydration.meta-reducer';
import { reportBulkReplayReducerFailure } from '../apply/bulk-replay-failure-collector';

/**
 * Integration coverage for retryFailedRemoteOps (#8305 fix (b)) against the REAL
 * OperationLogStoreService (real IndexedDB), with only the applier controlled.
 *
 * The co-located unit spec mocks the store, so it can't prove the actual status
 * transitions the retry depends on: failed -> applied on success and durable
 * failed quarantine across repeated startup retries. These tests exercise that
 * end to end, across simulated reboots.
 */
describe('OperationLogHydratorService retryFailedRemoteOps (integration, real store)', () => {
  let hydrator: OperationLogHydratorService;
  let store: OperationLogStoreService;
  let ngrxStore: jasmine.SpyObj<Store>;
  let applier: jasmine.SpyObj<OperationApplierService>;
  let recovery: jasmine.SpyObj<OperationLogRecoveryService>;

  const mockClientIdProvider: ClientIdProvider = {
    loadClientId: () => Promise.resolve('testClient'),
    getOrGenerateClientId: () => Promise.resolve('testClient'),
    clearCache: () => {},
  };

  const createOp = (overrides: Partial<Operation> = {}): Operation => ({
    id: uuidv7(),
    actionType: '[Task] Update' as ActionType,
    opType: OpType.Update,
    entityType: 'TASK' as EntityType,
    entityId: 'task1',
    payload: { title: 'Test Task' },
    clientId: 'remoteClient',
    vectorClock: { remoteClient: 1 },
    timestamp: Date.now(),
    schemaVersion: 1,
    ...overrides,
  });

  /**
   * Seeds remote ops in the store in 'failed' state (source=remote,
   * applicationStatus=failed) — the shape getFailedRemoteOps selects — by
   * appending them as pending remote ops and then marking them failed.
   */
  const seedFailedRemoteOps = async (
    ops: Operation[],
  ): Promise<{ id: string; seq: number }[]> => {
    const { seqs } = await store.appendBatchSkipDuplicates(ops, 'remote', {
      pendingApply: true,
    });
    await store.markFailed(ops.map((o) => o.id));
    return ops.map((o, i) => ({ id: o.id, seq: seqs[i] }));
  };

  beforeEach(async () => {
    ngrxStore = jasmine.createSpyObj<Store>('Store', ['dispatch']);
    applier = jasmine.createSpyObj<OperationApplierService>('OperationApplierService', [
      'applyOperations',
    ]);
    recovery = jasmine.createSpyObj<OperationLogRecoveryService>(
      'OperationLogRecoveryService',
      ['recoverPendingRemoteOps', 'cleanupCorruptOps', 'attemptRecovery'],
    );
    recovery.cleanupCorruptOps.and.resolveTo();
    recovery.attemptRecovery.and.resolveTo();

    TestBed.configureTestingModule({
      providers: [
        OperationLogHydratorService,
        OperationLogStoreService,
        VectorClockService,
        { provide: CLIENT_ID_PROVIDER, useValue: mockClientIdProvider },
        { provide: OperationApplierService, useValue: applier },
        // retryFailedRemoteOps touches only the store + applier; the remaining
        // hydrator deps must exist for DI but are never called on this path.
        { provide: Store, useValue: ngrxStore },
        {
          provide: OperationLogMigrationService,
          useValue: { checkAndMigrate: () => Promise.resolve() },
        },
        SchemaMigrationService,
        {
          provide: OperationLogSnapshotService,
          useValue: {
            isValidSnapshot: () => true,
            migrateSnapshotWithBackup: (snapshot: unknown) => Promise.resolve(snapshot),
            saveCurrentStateAsSnapshot: () => Promise.resolve(),
          },
        },
        { provide: OperationLogRecoveryService, useValue: recovery },
        { provide: SyncHydrationService, useValue: {} },
        {
          provide: ArchiveMigrationService,
          useValue: { migrateArchivesIfNeeded: () => Promise.resolve() },
        },
        {
          provide: StateSnapshotService,
          useValue: { getStateSnapshot: () => ({}) },
        },
        { provide: SnackService, useValue: {} },
        {
          provide: ValidateStateService,
          useValue: {
            validateState: () => Promise.resolve({ isValid: true, typiaErrors: [] }),
          },
        },
        {
          provide: HydrationStateService,
          useValue: {
            startApplyingRemoteOps: () => {},
            endApplyingRemoteOps: () => {},
          },
        },
      ],
    });

    hydrator = TestBed.inject(OperationLogHydratorService);
    store = TestBed.inject(OperationLogStoreService);
    await store.init();
    await store._clearAllDataForTesting();
    recovery.recoverPendingRemoteOps.and.callFake(() => store.getPendingRemoteOps());
  });

  it('replays a split pending migration from its original durable row on two boots', async () => {
    const legacyConfigOp = createOp({
      id: 'legacy-config-op',
      actionType: ActionType.GLOBAL_CONFIG_UPDATE_SECTION,
      entityType: 'GLOBAL_CONFIG',
      entityId: 'misc',
      entityIds: ['misc'],
      payload: {
        actionPayload: {
          sectionKey: 'misc',
          sectionCfg: {
            isConfirmBeforeTaskDelete: true,
            unrelatedMiscSetting: 'keep-me',
          },
        },
        entityChanges: [],
      },
      schemaVersion: 1,
    });
    await store.saveStateCache({
      state: {},
      lastAppliedOpSeq: 0,
      vectorClock: {},
      compactedAt: Date.now(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });
    await store.appendBatchSkipDuplicates([legacyConfigOp], 'remote', {
      pendingApply: true,
    });
    applier.applyOperations.and.callFake(async (ops) => ({ appliedOps: ops }));
    const expectedMigratedIds = ['legacy-config-op_misc', 'legacy-config-op_tasks'];

    await hydrator.hydrateStore();

    expect(ngrxStore.dispatch.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        type: bulkApplyOperations.type,
        operations: jasmine.arrayWithExactContents([
          jasmine.objectContaining({ id: expectedMigratedIds[0] }),
          jasmine.objectContaining({ id: expectedMigratedIds[1] }),
        ]),
      }),
    );
    const durableAfterFirstBoot = await store.getOpById(legacyConfigOp.id);
    expect(durableAfterFirstBoot?.applicationStatus).toBe('applied');
    expect(durableAfterFirstBoot?.reducerRejectedAt).toBeUndefined();

    ngrxStore.dispatch.calls.reset();
    const rebootedHydrator = TestBed.runInInjectionContext(
      () => new OperationLogHydratorService(),
    );
    await rebootedHydrator.hydrateStore();

    expect(ngrxStore.dispatch.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        type: bulkApplyOperations.type,
        operations: jasmine.arrayWithExactContents([
          jasmine.objectContaining({ id: expectedMigratedIds[0] }),
          jasmine.objectContaining({ id: expectedMigratedIds[1] }),
        ]),
      }),
    );
  });

  it('keeps a partially failing split migration absent across two boots', async () => {
    const legacyConfigOp = createOp({
      id: 'legacy-config-op-with-failing-child',
      actionType: ActionType.GLOBAL_CONFIG_UPDATE_SECTION,
      entityType: 'GLOBAL_CONFIG',
      entityId: 'misc',
      entityIds: ['misc'],
      payload: {
        actionPayload: {
          sectionKey: 'misc',
          sectionCfg: {
            isConfirmBeforeTaskDelete: true,
            unrelatedMiscSetting: 'keep-me',
          },
        },
        entityChanges: [],
      },
      schemaVersion: 1,
    });
    await store.saveStateCache({
      state: {},
      lastAppliedOpSeq: 0,
      vectorClock: {},
      compactedAt: Date.now(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });
    await store.appendBatchSkipDuplicates([legacyConfigOp], 'remote', {
      pendingApply: true,
    });
    type ReplayState = { sections: string[] };
    let replayState: ReplayState = { sections: [] };
    let bulkDispatchCount = 0;
    const replayReducer = bulkOperationsMetaReducer<ReplayState>(
      (state = { sections: [] }, action) => {
        const sectionKey = (action as { sectionKey?: string }).sectionKey;
        if (sectionKey === 'tasks') {
          throw new Error('tasks migration child failed');
        }
        return sectionKey ? { sections: [...state.sections, sectionKey] } : state;
      },
    );
    ngrxStore.dispatch.and.callFake(((action: { type: string }) => {
      if (action.type === bulkApplyOperations.type) {
        bulkDispatchCount++;
        replayState = replayReducer(replayState, action);
      }
    }) as never);

    await hydrator.hydrateStore();

    expect(replayState.sections).toEqual([]);
    const durableAfterFirstBoot = await store.getOpById(legacyConfigOp.id);
    expect(durableAfterFirstBoot?.reducerRejectedAt).toBeDefined();

    ngrxStore.dispatch.calls.reset();
    bulkDispatchCount = 0;
    const rebootedHydrator = TestBed.runInInjectionContext(
      () => new OperationLogHydratorService(),
    );
    await rebootedHydrator.hydrateStore();

    expect(replayState.sections).toEqual([]);
    expect(bulkDispatchCount).toBe(0);
  });

  it('keeps a failed full-state row pending until a healthy boot applies it', async () => {
    const fullStateOp = createOp({
      id: 'pending-sync-import',
      actionType: ActionType.LOAD_ALL_DATA,
      opType: OpType.SyncImport,
      entityType: 'ALL',
      entityId: undefined,
      payload: { appDataComplete: {} },
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });
    await store.saveStateCache({
      state: {},
      lastAppliedOpSeq: 0,
      vectorClock: {},
      compactedAt: Date.now(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });
    await store.appendBatchSkipDuplicates([fullStateOp], 'remote', {
      pendingApply: true,
    });
    let shouldFailReducer = true;
    ngrxStore.dispatch.and.callFake(((action: { type: string }) => {
      if (shouldFailReducer && action.type === bulkApplyOperations.type) {
        reportBulkReplayReducerFailure(
          fullStateOp,
          new Error('full-state reducer failed'),
        );
      }
    }) as never);

    await hydrator.hydrateStore();

    const failedEntry = await store.getOpById(fullStateOp.id);
    expect(failedEntry?.applicationStatus).toBe('pending');
    expect(failedEntry?.rejectedAt).toBeUndefined();
    expect(failedEntry?.reducerRejectedAt).toBeUndefined();
    expect(recovery.attemptRecovery).toHaveBeenCalled();

    shouldFailReducer = false;
    applier.applyOperations.and.callFake(async (ops) => ({ appliedOps: ops }));
    const rebootedHydrator = TestBed.runInInjectionContext(
      () => new OperationLogHydratorService(),
    );
    await rebootedHydrator.hydrateStore();

    expect((await store.getOpById(fullStateOp.id))?.applicationStatus).toBe('applied');
    expect(applier.applyOperations).toHaveBeenCalledWith(
      [
        jasmine.objectContaining({
          id: fullStateOp.id,
          opType: OpType.SyncImport,
          payload: fullStateOp.payload,
        }),
      ],
      {
        skipReducerDispatch: true,
        skipDeferredLocalActions: true,
      },
    );
  });

  it('clears all failed ops to applied when the whole batch succeeds', async () => {
    const ops = [createOp(), createOp(), createOp()];
    const seeded = await seedFailedRemoteOps(ops);
    // Real applier returns appliedOps === input ops on full success.
    applier.applyOperations.and.callFake((toApply: Operation[]) =>
      Promise.resolve({ appliedOps: toApply } as ApplyOperationsResult),
    );

    await hydrator.retryFailedRemoteOps();

    expect(await store.getFailedRemoteOps()).toEqual([]);
    for (const { id } of seeded) {
      expect((await store.getOpById(id))?.applicationStatus).toBe('applied');
    }
  });

  it('applies in one batch: the applier is called once with every failed op', async () => {
    const ops = [createOp(), createOp(), createOp()];
    await seedFailedRemoteOps(ops);
    applier.applyOperations.and.callFake((toApply: Operation[]) =>
      Promise.resolve({ appliedOps: toApply } as ApplyOperationsResult),
    );

    await hydrator.retryFailedRemoteOps();

    expect(applier.applyOperations).toHaveBeenCalledTimes(1);
    const passed = applier.applyOperations.calls.argsFor(0)[0] as Operation[];
    expect(passed.length).toBe(3);
    // Archive side effects only: the failed ops' reducers committed in the
    // batch that marked them failed, so a reducer re-dispatch would
    // double-apply additive reducers.
    expect(applier.applyOperations.calls.argsFor(0)[1]).toEqual({
      skipReducerDispatch: true,
      skipDeferredLocalActions: true,
    });
  });

  it('on partial failure marks the failed op and every op after it as still-failing', async () => {
    const ops = [createOp(), createOp(), createOp()];
    const seeded = await seedFailedRemoteOps(ops);
    const [a, b, c] = seeded;
    // Applier stops at op b: a applied, b failed, c dropped.
    applier.applyOperations.and.callFake((toApply: Operation[]) =>
      Promise.resolve({
        appliedOps: toApply.slice(0, 1),
        failedOp: { op: toApply[1], error: new Error('archive side-effect failed') },
      } as ApplyOperationsResult),
    );

    await hydrator.retryFailedRemoteOps();

    expect((await store.getOpById(a.id))?.applicationStatus).toBe('applied');
    const stillFailed = (await store.getFailedRemoteOps()).map((e) => e.op.id).sort();
    expect(stillFailed).toEqual([b.id, c.id].sort());
  });

  it('keeps a permanently-failing archive op quarantined across retries', async () => {
    const op = createOp();
    await seedFailedRemoteOps([op]); // retryCount starts at 1 after the seed markFailed
    applier.applyOperations.and.callFake((toApply: Operation[]) =>
      Promise.resolve({
        appliedOps: [],
        failedOp: { op: toApply[0], error: new Error('still failing') },
      } as ApplyOperationsResult),
    );

    // Each call simulates one boot's retry. It must remain visible to both the
    // next startup retry and the sync safety gate instead of turning rejected.
    const repeatedStartupRetries = 6;
    for (let retry = 0; retry < repeatedStartupRetries; retry++) {
      await hydrator.retryFailedRemoteOps();
    }

    expect((await store.getFailedRemoteOps()).map((entry) => entry.op.id)).toEqual([
      op.id,
    ]);
    const quarantined = await store.getOpById(op.id);
    expect(quarantined?.rejectedAt).toBeUndefined();
    expect(quarantined?.applicationStatus).toBe('failed');
  });
});
