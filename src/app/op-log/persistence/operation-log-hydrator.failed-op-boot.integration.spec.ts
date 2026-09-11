import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { applyRemoteOperations, replayOperationBatch } from '@sp/sync-core';
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
import { ApplyOperationsOptions, ApplyOperationsResult } from '../core/types/apply.types';
import { uuidv7 } from '../../util/uuid-v7';
import { bulkApplyOperations } from '../apply/bulk-hydration.action';

/**
 * #8305 reproduction attempt: a remote batch whose archive side effect fails
 * mid-batch leaves ops as `applied` / `failed` / `archive_pending` although
 * every op's reducer effect already committed via the single bulk dispatch.
 * The issue's claim was that the next boot applies those reducers AGAIN — once
 * through the status-blind tail replay and once more through
 * retryFailedRemoteOps() — so additive reducers would double-count.
 *
 * These tests drive the REAL pieces the claim is about — the real
 * OperationLogStoreService (real IndexedDB status transitions), the real
 * sync-core coordinators (applyRemoteOperations + replayOperationBatch) and the
 * real hydrator boot path — and replace only the NgRx reducer and the archive
 * handler with counters. The invariant under test: within one boot, every op's
 * reducer is dispatched at most once, and exactly once when the snapshot does
 * not already carry it.
 */
describe('OperationLogHydratorService boot after a mid-batch archive failure (integration, real store) — #8305', () => {
  let store: OperationLogStoreService;
  let ngrxStore: jasmine.SpyObj<Store>;
  let applier: jasmine.SpyObj<OperationApplierService>;
  let recovery: jasmine.SpyObj<OperationLogRecoveryService>;

  /** How often each op id went through a bulkApplyOperations dispatch. */
  let reducerDispatchCountByOpId: Map<string, number>;
  /** Op ids whose archive side effect was attempted, in call order. */
  let archiveAttemptedOpIds: string[];
  /** Op ids whose archive side effect throws. */
  let archiveFailingOpIds: Set<string>;

  interface ReplayAction {
    type: string;
    meta: { opId: string };
  }

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
    schemaVersion: CURRENT_SCHEMA_VERSION,
    ...overrides,
  });

  /**
   * Stand-in for OperationApplierService.applyOperations that keeps the REAL
   * sync-core replay ordering (bulk dispatch → reducer commit checkpoint →
   * per-op archive side effects) and only swaps the NgRx store and the archive
   * handler for counters.
   */
  const applyThroughRealCoordinator = (
    ops: Operation[],
    options: ApplyOperationsOptions = {},
  ): Promise<ApplyOperationsResult> =>
    replayOperationBatch<Operation, ReturnType<typeof bulkApplyOperations>, ReplayAction>(
      {
        ops,
        applyOptions: {
          isLocalHydration: options.isLocalHydration,
          skipReducerDispatch: options.skipReducerDispatch,
        },
        dispatcher: { dispatch: (action) => ngrxStore.dispatch(action) },
        createBulkApplyAction: (operations) =>
          bulkApplyOperations({ operations, localClientId: 'testClient' }),
        remoteApplyWindow: {
          startApplyingRemoteOps: () => {},
          endApplyingRemoteOps: () => {},
          startPostSyncCooldown: () => {},
        },
        deferredLocalActions: { processDeferredActions: () => undefined },
        archiveSideEffects: {
          handleOperation: async (action) => {
            archiveAttemptedOpIds.push(action.meta.opId);
            if (archiveFailingOpIds.has(action.meta.opId)) {
              throw new Error('archive side effect failed');
            }
          },
        },
        operationToAction: (op) => ({ type: op.actionType, meta: { opId: op.id } }),
        isArchiveAffectingAction: () => true,
        onReducersCommitted: options.onReducersCommitted,
      },
    );

  /** The primary remote-apply path (RemoteOpsProcessingService → sync-core). */
  const receiveRemoteBatch = (
    ops: Operation[],
  ): ReturnType<typeof applyRemoteOperations> =>
    applyRemoteOperations({
      ops,
      store,
      applier: {
        applyOperations: (opsToApply, applyOptions) =>
          applyThroughRealCoordinator(opsToApply, {
            skipDeferredLocalActions: true,
            onReducersCommitted: applyOptions.onReducersCommitted,
          }),
      },
    });

  /** One app start: fresh hydrator instance, counters reset. */
  const boot = async (): Promise<void> => {
    reducerDispatchCountByOpId.clear();
    archiveAttemptedOpIds = [];
    applier.applyOperations.calls.reset();
    const hydrator = TestBed.runInInjectionContext(
      () => new OperationLogHydratorService(),
    );
    await hydrator.hydrateStore();
  };

  const saveSnapshotAnchoredAt = (lastAppliedOpSeq: number): Promise<void> =>
    store.saveStateCache({
      state: {},
      lastAppliedOpSeq,
      vectorClock: {},
      compactedAt: Date.now(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });

  const statusOf = async (op: Operation): Promise<string | undefined> =>
    (await store.getOpById(op.id))?.applicationStatus;

  const reducerDispatchCounts = (ops: Operation[]): number[] =>
    ops.map((op) => reducerDispatchCountByOpId.get(op.id) ?? 0);

  beforeEach(async () => {
    reducerDispatchCountByOpId = new Map();
    archiveAttemptedOpIds = [];
    archiveFailingOpIds = new Set();

    ngrxStore = jasmine.createSpyObj<Store>('Store', ['dispatch']);
    ngrxStore.dispatch.and.callFake(((action: { type: string }) => {
      if (action.type === bulkApplyOperations.type) {
        const { operations } = action as ReturnType<typeof bulkApplyOperations>;
        for (const op of operations) {
          reducerDispatchCountByOpId.set(
            op.id,
            (reducerDispatchCountByOpId.get(op.id) ?? 0) + 1,
          );
        }
      }
    }) as never);

    applier = jasmine.createSpyObj<OperationApplierService>('OperationApplierService', [
      'applyOperations',
    ]);
    applier.applyOperations.and.callFake(applyThroughRealCoordinator);

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
            saveCurrentStateAsSnapshot: () => Promise.resolve(false),
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
        { provide: SnackService, useValue: { open: () => {} } },
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
            startPostSyncCooldown: () => {},
            setHydrationInProgress: () => {},
            setHydrationFallbackActive: () => {},
          },
        },
      ],
    });

    store = TestBed.inject(OperationLogStoreService);
    await store.init();
    await store._clearAllDataForTesting();
    recovery.recoverPendingRemoteOps.and.callFake(() => store.getPendingRemoteOps());
  });

  /**
   * Seeds the exact on-disk shape the issue describes: one bulk dispatch for
   * [a, b, c], archive side effect throws at b → a applied, b failed,
   * c archive_pending (never attempted), with all three reducers committed.
   */
  const receiveBatchFailingAtSecondOp = async (): Promise<Operation[]> => {
    const ops = [createOp(), createOp(), createOp()];
    const [a, b, c] = ops;
    archiveFailingOpIds = new Set([b.id]);

    const result = await receiveRemoteBatch(ops);

    expect(reducerDispatchCounts(ops)).toEqual([1, 1, 1]);
    expect(result.failedOp?.op.id).toBe(b.id);
    expect(archiveAttemptedOpIds).toEqual([a.id, b.id]);
    expect(await statusOf(a)).toBe('applied');
    expect(await statusOf(b)).toBe('failed');
    expect(await statusOf(c)).toBe('archive_pending');
    return ops;
  };

  it('applies each reducer exactly once per boot when the snapshot predates the failed batch', async () => {
    await saveSnapshotAnchoredAt(await store.getLastSeq());
    const ops = await receiveBatchFailingAtSecondOp();
    const [a, b, c] = ops;

    archiveFailingOpIds.clear();
    await boot();

    // The snapshot lacks the batch, so the tail replay restores every reducer
    // effect once. The retry must add NO further reducer dispatch.
    expect(reducerDispatchCounts(ops)).toEqual([1, 1, 1]);
    expect(applier.applyOperations).toHaveBeenCalledTimes(1);
    expect(applier.applyOperations.calls.argsFor(0)[1]).toEqual(
      jasmine.objectContaining({ skipReducerDispatch: true }),
    );
    // Only the outstanding archive work re-runs: the failed op and its
    // never-attempted successor, in seq order. The already-applied op is left alone.
    expect(archiveAttemptedOpIds).toEqual([b.id, c.id]);
    expect(await statusOf(a)).toBe('applied');
    expect(await statusOf(b)).toBe('applied');
    expect(await statusOf(c)).toBe('applied');
    expect(await store.getFailedRemoteOps()).toEqual([]);
    expect(recovery.attemptRecovery).not.toHaveBeenCalled();

    // A healthy follow-up boot has nothing left to retry.
    await boot();
    expect(reducerDispatchCounts(ops)).toEqual([1, 1, 1]);
    expect(applier.applyOperations).not.toHaveBeenCalled();
    expect(archiveAttemptedOpIds).toEqual([]);
  });

  it('dispatches no reducer at all when the snapshot already carries the failed batch', async () => {
    const ops = await receiveBatchFailingAtSecondOp();
    const [a, b, c] = ops;
    // saveCurrentStateAsSnapshot anchors at the global last seq, so a snapshot
    // taken after the failed batch covers the failed/archive_pending rows too.
    await saveSnapshotAnchoredAt(await store.getLastSeq());

    archiveFailingOpIds.clear();
    await boot();

    expect(reducerDispatchCounts(ops)).toEqual([0, 0, 0]);
    expect(applier.applyOperations).toHaveBeenCalledTimes(1);
    expect(archiveAttemptedOpIds).toEqual([b.id, c.id]);
    expect(await statusOf(a)).toBe('applied');
    expect(await statusOf(b)).toBe('applied');
    expect(await statusOf(c)).toBe('applied');
    expect(recovery.attemptRecovery).not.toHaveBeenCalled();
  });

  it('applies each reducer exactly once per boot with no snapshot (replay from scratch)', async () => {
    const ops = await receiveBatchFailingAtSecondOp();
    const [, b, c] = ops;

    archiveFailingOpIds.clear();
    await boot();

    expect(reducerDispatchCounts(ops)).toEqual([1, 1, 1]);
    expect(archiveAttemptedOpIds).toEqual([b.id, c.id]);
    expect(await store.getFailedRemoteOps()).toEqual([]);
    expect(recovery.attemptRecovery).not.toHaveBeenCalled();
  });

  it('keeps reducer application at once per boot while the archive failure persists', async () => {
    await saveSnapshotAnchoredAt(await store.getLastSeq());
    const ops = await receiveBatchFailingAtSecondOp();
    const [a, b, c] = ops;

    // Archive keeps failing on b across two more boots.
    for (let bootNo = 0; bootNo < 2; bootNo++) {
      await boot();

      expect(reducerDispatchCounts(ops)).toEqual([1, 1, 1]);
      // b is retried and blocks; c stays queued behind it without an attempt.
      expect(archiveAttemptedOpIds).toEqual([b.id]);
      expect(await statusOf(a)).toBe('applied');
      expect(await statusOf(b)).toBe('failed');
      expect(await statusOf(c)).toBe('archive_pending');
      expect(recovery.attemptRecovery).not.toHaveBeenCalled();
    }
    expect((await store.getOpById(b.id))?.retryCount).toBe(3);

    // Once the archive recovers, one boot drains the queue in seq order.
    archiveFailingOpIds.clear();
    await boot();
    expect(reducerDispatchCounts(ops)).toEqual([1, 1, 1]);
    expect(archiveAttemptedOpIds).toEqual([b.id, c.id]);
    expect(await store.getFailedRemoteOps()).toEqual([]);
  });
});
