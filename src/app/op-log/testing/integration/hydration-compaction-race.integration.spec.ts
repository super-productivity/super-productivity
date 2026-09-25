import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { OperationLogHydratorService } from '../../persistence/operation-log-hydrator.service';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { OperationLogCompactionService } from '../../persistence/operation-log-compaction.service';
import { OperationLogMigrationService } from '../../persistence/operation-log-migration.service';
import { SchemaMigrationService } from '../../persistence/schema-migration.service';
import { CURRENT_SCHEMA_VERSION } from '../../persistence/schema-migration.service';
import { OperationLogSnapshotService } from '../../persistence/operation-log-snapshot.service';
import { OperationLogRecoveryService } from '../../persistence/operation-log-recovery.service';
import { SyncHydrationService } from '../../persistence/sync-hydration.service';
import { ArchiveMigrationService } from '../../persistence/archive-migration.service';
import { StateSnapshotService } from '../../backup/state-snapshot.service';
import { SnackService } from '../../../core/snack/snack.service';
import { ValidateStateService } from '../../validation/validate-state.service';
import { OperationApplierService } from '../../apply/operation-applier.service';
import { VectorClockService } from '../../sync/vector-clock.service';
import { OperationCaptureService } from '../../capture/operation-capture.service';
import { CLIENT_ID_PROVIDER, ClientIdProvider } from '../../util/client-id.provider';
import { OpType } from '../../core/operation.types';
import {
  COMPACTION_RETENTION_MS,
  STARTUP_COMPACTION_OP_THRESHOLD,
} from '../../core/operation-log.const';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { TestClient, resetTestUuidCounter } from './helpers/test-client.helper';
import { clearDeferredActions } from '../../capture/operation-capture.meta-reducer';
import {
  createTaskOperation,
  createMinimalTaskPayload,
} from './helpers/operation-factory.helper';

/**
 * End-to-end coverage for the #9084 race: compaction fired while the REAL
 * hydrator is parked between the snapshot's loadAllData dispatch and the
 * tail-op replay. Unlike the unit specs (which set the hydration flag by
 * hand), this drives OperationLogHydratorService.hydrateStore() itself against
 * the real IndexedDB store and the real compaction pipeline, staging the
 * racing moment with a one-shot barrier on getOpsAfterSeq().
 */
describe('Hydration-replay vs compaction race (integration, real store, #9084)', () => {
  const SNAPSHOT_TASK = 'task-in-snapshot';
  const TAIL_TASK = 'task-from-tail-op';
  const EARLY_WRITE_TASK = 'task-from-early-write';

  let hydrator: OperationLogHydratorService;
  let storeService: OperationLogStoreService;
  let compactionService: OperationLogCompactionService;
  let ngrxStore: jasmine.SpyObj<Store>;
  let mockStateSnapshot: jasmine.SpyObj<StateSnapshotService>;

  const mockClientIdProvider: ClientIdProvider = {
    loadClientId: () => Promise.resolve('testClient'),
    getOrGenerateClientId: () => Promise.resolve('testClient'),
    clearCache: () => {},
  };

  const stateWithTasks = (ids: string[]): Record<string, unknown> => ({
    task: {
      ids,
      entities: ids.reduce<Record<string, unknown>>((acc, id) => {
        acc[id] = createMinimalTaskPayload(id);
        return acc;
      }, {}),
    },
  });

  const cachedTaskIds = (state: unknown): string[] =>
    (state as { task: { ids: string[] } }).task.ids;

  /**
   * Seeds one op covered by the on-disk snapshot plus two synced tail ops the
   * next boot has to replay, and returns the snapshot's lastAppliedOpSeq.
   */
  const seedSnapshotAndTailOps = async (client: TestClient): Promise<number> => {
    await storeService.append(
      createTaskOperation(client, SNAPSHOT_TASK, OpType.Create, {
        title: 'In snapshot',
      }),
      'local',
    );
    const snapshotSeq = (await storeService.getOpsAfterSeq(0))[0].seq;
    await storeService.saveStateCache({
      state: stateWithTasks([SNAPSHOT_TASK]),
      lastAppliedOpSeq: snapshotSeq,
      vectorClock: client.getCurrentClock(),
      compactedAt: Date.now(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });

    await storeService.append(
      createTaskOperation(client, TAIL_TASK, OpType.Create, { title: 'From tail op' }),
      'local',
    );
    await storeService.append(
      createTaskOperation(client, TAIL_TASK, OpType.Update, { title: 'Renamed' }),
      'local',
    );
    const tail = await storeService.getOpsAfterSeq(snapshotSeq);
    await storeService.markSynced(tail.map((e) => e.seq));
    return snapshotSeq;
  };

  beforeEach(async () => {
    ngrxStore = jasmine.createSpyObj<Store>('Store', ['dispatch']);
    mockStateSnapshot = jasmine.createSpyObj('StateSnapshotService', [
      'getStateSnapshot',
      'getStateSnapshotForOperationLog',
    ]);
    // Mid-hydration live state: the snapshot plus a write that landed in the
    // gap. The tail ops' effects are absent because their re-dispatch has not
    // happened yet.
    mockStateSnapshot.getStateSnapshot.and.returnValue(
      stateWithTasks([SNAPSHOT_TASK, EARLY_WRITE_TASK]) as any,
    );
    mockStateSnapshot.getStateSnapshotForOperationLog.and.callFake(() =>
      mockStateSnapshot.getStateSnapshot(),
    );

    const mockRecovery = jasmine.createSpyObj<OperationLogRecoveryService>(
      'OperationLogRecoveryService',
      ['recoverPendingRemoteOps', 'cleanupCorruptOps', 'attemptRecovery'],
    );
    mockRecovery.cleanupCorruptOps.and.resolveTo();
    mockRecovery.attemptRecovery.and.resolveTo();

    TestBed.configureTestingModule({
      providers: [
        OperationLogHydratorService,
        OperationLogStoreService,
        OperationLogCompactionService,
        VectorClockService,
        SchemaMigrationService,
        { provide: CLIENT_ID_PROVIDER, useValue: mockClientIdProvider },
        { provide: Store, useValue: ngrxStore },
        { provide: StateSnapshotService, useValue: mockStateSnapshot },
        { provide: OperationLogRecoveryService, useValue: mockRecovery },
        // The remaining hydrator deps must exist for DI but are not exercised
        // on the snapshot + tail-replay path this spec drives.
        {
          provide: OperationApplierService,
          useValue: { applyOperations: () => Promise.resolve({ appliedOps: [] }) },
        },
        {
          provide: OperationLogMigrationService,
          useValue: { checkAndMigrate: () => Promise.resolve() },
        },
        {
          provide: OperationLogSnapshotService,
          useValue: {
            isValidSnapshot: () => true,
            migrateSnapshotWithBackup: (snapshot: unknown) => Promise.resolve(snapshot),
            saveCurrentStateAsSnapshot: () => Promise.resolve(false),
          },
        },
        { provide: SyncHydrationService, useValue: {} },
        {
          provide: ArchiveMigrationService,
          useValue: { migrateArchivesIfNeeded: () => Promise.resolve() },
        },
        { provide: SnackService, useValue: {} },
        {
          provide: ValidateStateService,
          useValue: {
            validateState: () => Promise.resolve({ isValid: true, typiaErrors: [] }),
          },
        },
      ],
    });

    hydrator = TestBed.inject(OperationLogHydratorService);
    storeService = TestBed.inject(OperationLogStoreService);
    compactionService = TestBed.inject(OperationLogCompactionService);
    mockRecovery.recoverPendingRemoteOps.and.callFake(() =>
      storeService.getPendingRemoteOps(),
    );

    await storeService.init();
    await storeService._clearAllDataForTesting();
    resetTestUuidCounter();
    // The real compaction service bails on a non-empty module-level deferred
    // buffer (#8469) or an unrecovered persist failure (#8751) — start clean.
    TestBed.inject(OperationCaptureService).clear();
    clearDeferredActions();
  });

  afterEach(() => {
    TestBed.inject(OperationCaptureService).clear();
    clearDeferredActions();
  });

  it('skips a compaction fired mid-replay and compacts cleanly after hydration completes', async () => {
    const client = new TestClient('client-9084-race');
    const snapshotSeq = await seedSnapshotAndTailOps(client);

    // One-shot barrier parking hydrateStore() between the loadAllData
    // dispatch and the tail-op query — the exact #9084 window.
    let releaseBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => (releaseBarrier = resolve));
    let reachGap!: () => void;
    const gapReached = new Promise<void>((resolve) => (reachGap = resolve));
    const realGetOpsAfterSeq = storeService.getOpsAfterSeq.bind(storeService);
    let intercepted = false;
    spyOn(storeService, 'getOpsAfterSeq').and.callFake(async (seq: number) => {
      if (!intercepted) {
        intercepted = true;
        reachGap();
        await barrier;
      }
      return realGetOpsAfterSeq(seq);
    });

    const hydration = hydrator.hydrateStore();
    try {
      // Racing hydration in surfaces an early hydration error here instead of
      // hanging this await into the jasmine timeout (the race also consumes a
      // rejection, so it can't strand as an unhandled one).
      await Promise.race([gapReached, hydration]);

      // The snapshot state is live but the tail ops' effects are not yet.
      const dispatchedTypes = ngrxStore.dispatch.calls
        .allArgs()
        .map(([action]) => (action as unknown as { type: string }).type);
      expect(dispatchedTypes).toContain(loadAllData.type);

      // An early write's compaction trigger fires now: the REAL compact()
      // pipeline must skip via the #9084 guard, leaving the pre-hydration cache
      // and the tail ops untouched.
      // NB: `false` is attributable to #9084 only because every guard ahead of
      // it is verifiably disarmed here (no pending remote ops, capture/deferred
      // buffers cleared, no fallback, frontier still unestablished) — a future
      // guard inserted earlier in _doCompact could silently take over this
      // assertion.
      expect(await compactionService.compact()).toBe(false);
      const cacheDuring = await storeService.loadStateCache();
      expect(cacheDuring!.lastAppliedOpSeq).toBe(snapshotSeq);
      expect(cachedTaskIds(cacheDuring!.state)).toEqual([SNAPSHOT_TASK]);
      expect((await realGetOpsAfterSeq(snapshotSeq)).length).toBe(2);
    } finally {
      // A failed assertion above must not leave hydrateStore() parked forever
      // on the barrier across TestBed teardown.
      releaseBarrier();
    }
    await hydration;

    // Hydration finished; the tail ops are now reflected in live state and
    // compaction may advance the cache past them.
    mockStateSnapshot.getStateSnapshot.and.returnValue(
      stateWithTasks([SNAPSHOT_TASK, EARLY_WRITE_TASK, TAIL_TASK]) as any,
    );
    expect(await compactionService.compact()).toBe(true);
    const cacheAfter = await storeService.loadStateCache();
    expect(cacheAfter!.lastAppliedOpSeq).toBeGreaterThan(snapshotSeq);
    expect(cacheAfter!.snapshotEntityKeys).toContain(`TASK:${TAIL_TASK}`);
  });

  it('prunes old synced ops through the real pipeline when the log is bloated at boot (#8336)', async () => {
    const client = new TestClient('client-8336-prune');

    // Backdate the seeding: appliedAt/syncedAt land past the retention window,
    // making the two synced tail ops genuinely prunable. new Date() is
    // independent of the Date.now spy, so the base is real current time.
    const oneHourMs = 60 * 60 * 1000;
    const nowSpy = spyOn(Date, 'now').and.returnValue(
      new Date().getTime() - COMPACTION_RETENTION_MS - oneHourMs,
    );
    const snapshotSeq = await seedSnapshotAndTailOps(client);
    nowSpy.and.callThrough();

    // Trip the threshold without seeding 5000 real rows: only the trigger
    // METRIC is stubbed — everything it fires (hasSyncedOps gate, compact(),
    // the prune) runs for real against the real store.
    spyOn(storeService, 'countOps').and.resolveTo(STARTUP_COMPACTION_OP_THRESHOLD + 1);
    const bloatCheck = spyOn(compactionService, 'compactIfBloated').and.callThrough();
    // Post-hydration live state includes the replayed tail task, so the
    // compaction snapshot may legitimately advance past the tail ops.
    mockStateSnapshot.getStateSnapshot.and.returnValue(
      stateWithTasks([SNAPSHOT_TASK, TAIL_TASK]) as any,
    );

    await hydrator.hydrateStore();

    // hydrateStore() fire-and-forgets the check — await the promise the real
    // compactIfBloated returned so the assertion below is deterministic.
    expect(bloatCheck).toHaveBeenCalledTimes(1);
    await bloatCheck.calls.mostRecent().returnValue;

    // Both old synced tail ops are pruned; the never-synced snapshot op stays;
    // the cache anchor advanced past the pruned range.
    const survivingSeqs = (await storeService.getOpsAfterSeq(0)).map((e) => e.seq);
    expect(survivingSeqs).toEqual([snapshotSeq]);
    const cacheAfter = await storeService.loadStateCache();
    expect(cacheAfter!.lastAppliedOpSeq).toBeGreaterThan(snapshotSeq);
  });
});
