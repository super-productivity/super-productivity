import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { OperationLogHydratorService } from './operation-log-hydrator.service';
import { OperationLogStoreService } from './operation-log-store.service';
import { OperationLogMigrationService } from './operation-log-migration.service';
import { SchemaMigrationService } from './schema-migration.service';
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
import { MAX_CONFLICT_RETRY_ATTEMPTS } from '../core/operation-log.const';
import { ActionType, EntityType, Operation, OpType } from '../core/operation.types';
import { ApplyOperationsResult } from '../core/types/apply.types';
import { uuidv7 } from '../../util/uuid-v7';

/**
 * Integration coverage for retryFailedRemoteOps (#8305 fix (b)) against the REAL
 * OperationLogStoreService (real IndexedDB), with only the applier controlled.
 *
 * The co-located unit spec mocks the store, so it can't prove the actual status
 * transitions the retry depends on: failed -> applied on success, the
 * slice-from-failure re-mark, and the retry-count -> reject lifecycle that ends
 * with getFailedRemoteOps filtering the op out. These tests exercise exactly
 * that, end to end, across simulated reboots.
 */
describe('OperationLogHydratorService retryFailedRemoteOps (integration, real store)', () => {
  let hydrator: OperationLogHydratorService;
  let store: OperationLogStoreService;
  let applier: jasmine.SpyObj<OperationApplierService>;

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
    applier = jasmine.createSpyObj<OperationApplierService>('OperationApplierService', [
      'applyOperations',
    ]);

    TestBed.configureTestingModule({
      providers: [
        OperationLogHydratorService,
        OperationLogStoreService,
        VectorClockService,
        { provide: CLIENT_ID_PROVIDER, useValue: mockClientIdProvider },
        { provide: OperationApplierService, useValue: applier },
        // retryFailedRemoteOps touches only the store + applier; the remaining
        // hydrator deps must exist for DI but are never called on this path.
        { provide: Store, useValue: jasmine.createSpyObj('Store', ['dispatch']) },
        { provide: OperationLogMigrationService, useValue: {} },
        { provide: SchemaMigrationService, useValue: {} },
        { provide: OperationLogSnapshotService, useValue: {} },
        { provide: OperationLogRecoveryService, useValue: {} },
        { provide: SyncHydrationService, useValue: {} },
        { provide: ArchiveMigrationService, useValue: {} },
        { provide: StateSnapshotService, useValue: {} },
        { provide: SnackService, useValue: {} },
        { provide: ValidateStateService, useValue: {} },
        { provide: HydrationStateService, useValue: {} },
      ],
    });

    hydrator = TestBed.inject(OperationLogHydratorService);
    store = TestBed.inject(OperationLogStoreService);
    await store.init();
    await store._clearAllDataForTesting();
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

  it('eventually rejects a permanently-failing op across reboots, then stops returning it', async () => {
    const op = createOp();
    await seedFailedRemoteOps([op]); // retryCount starts at 1 after the seed markFailed
    applier.applyOperations.and.callFake((toApply: Operation[]) =>
      Promise.resolve({
        appliedOps: [],
        failedOp: { op: toApply[0], error: new Error('still failing') },
      } as ApplyOperationsResult),
    );

    // Each call simulates one boot's retry. The seed left retryCount at 1, so
    // it takes MAX_CONFLICT_RETRY_ATTEMPTS - 1 more failed retries to hit the cap.
    let guard = 0;
    while ((await store.getFailedRemoteOps()).length > 0 && guard < 10) {
      await hydrator.retryFailedRemoteOps();
      guard++;
    }

    // Op is gone from the retry set and persisted as rejected, not failed.
    expect(await store.getFailedRemoteOps()).toEqual([]);
    expect(guard).toBe(MAX_CONFLICT_RETRY_ATTEMPTS - 1);
    const rejected = await store.getOpById(op.id);
    expect(rejected?.rejectedAt).toBeTruthy();
    expect(rejected?.applicationStatus).toBeUndefined();
  });
});
