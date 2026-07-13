import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { CleanSlateService } from '../../clean-slate/clean-slate.service';
import { StateSnapshotService } from '../../backup/state-snapshot.service';
import { SyncLocalStateService } from '../../sync/sync-local-state.service';
import { TranslateService } from '@ngx-translate/core';
import { CURRENT_SCHEMA_VERSION } from '../../persistence/schema-migration.service';
import { Operation } from '../../core/operation.types';
import { SINGLETON_KEY, STORE_NAMES } from '../../persistence/db-keys.const';
import { TaskTimeSyncService } from '../../../features/tasks/task-time-sync.service';

/**
 * Integration tests for issue #7709 — `createCleanSlate` / `BackupService` import
 * interrupted mid-sequence.
 *
 * The reported bug requires that on a surviving device, `isWhollyFreshClient()`
 * returns true (i.e. `state_cache===null && lastSeq===0`) while NgRx in-memory
 * state still has meaningful data. The pre-fix code reached that state by an
 * interrupt between `clearAllOperations()` and `saveStateCache(...)`.
 *
 * After PR-A, `runDestructiveStateReplacement` makes the destructive sequence
 * either commit fully or leave the prior state intact. The tests below
 * exercise the fix by injecting failures inside the helper's destructive tx
 * and asserting that the device's prior state is preserved.
 *
 * Tests use real IndexedDB.
 */
describe('CleanSlate / Backup interrupt (issue #7709 regression)', () => {
  let storeService: OperationLogStoreService;
  let syncLocalState: SyncLocalStateService;
  let cleanSlate: CleanSlateService;
  let mockStateSnapshot: jasmine.SpyObj<StateSnapshotService>;
  let mockTranslate: jasmine.SpyObj<TranslateService>;
  let mockTaskTimeSync: jasmine.SpyObj<TaskTimeSyncService>;

  const meaningfulState = {
    task: {
      ids: ['t1', 't2', 't3'],
      entities: { t1: { id: 't1' }, t2: { id: 't2' }, t3: { id: 't3' } },
    },
    project: { ids: ['INBOX'], entities: {} },
    tag: { ids: [], entities: {} },
    note: { ids: [], entities: {} },
    globalConfig: {},
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };

  beforeEach(async () => {
    mockStateSnapshot = jasmine.createSpyObj('StateSnapshotService', [
      'getStateSnapshot',
      'getStateSnapshotForOperationLogAsync',
    ]);
    mockStateSnapshot.getStateSnapshot.and.returnValue(meaningfulState as any);
    mockStateSnapshot.getStateSnapshotForOperationLogAsync.and.resolveTo(
      meaningfulState as any,
    );
    mockTaskTimeSync = jasmine.createSpyObj('TaskTimeSyncService', ['flush']);

    mockTranslate = jasmine.createSpyObj('TranslateService', ['instant']);
    mockTranslate.instant.and.callFake((k: string) => k);

    TestBed.configureTestingModule({
      providers: [
        OperationLogStoreService,
        SyncLocalStateService,
        CleanSlateService,
        { provide: StateSnapshotService, useValue: mockStateSnapshot },
        { provide: TaskTimeSyncService, useValue: mockTaskTimeSync },
        { provide: TranslateService, useValue: mockTranslate },
      ],
    });

    storeService = TestBed.inject(OperationLogStoreService);
    syncLocalState = TestBed.inject(SyncLocalStateService);
    cleanSlate = TestBed.inject(CleanSlateService);

    await storeService.init();
    await storeService._clearAllDataForTesting();
  });

  describe('baseline (no interrupt)', () => {
    it('completes the destructive sequence and leaves a populated state_cache', async () => {
      expect(await syncLocalState.isWhollyFreshClient()).toBe(true);

      await cleanSlate.createCleanSlate('ENCRYPTION_CHANGE', 'PASSWORD_CHANGED');

      expect(await storeService.getLastSeq()).toBeGreaterThan(0);
      const cache = await storeService.loadStateCache();
      expect(cache).not.toBeNull();
      expect(cache!.state).toEqual(meaningfulState as any);
      expect(await syncLocalState.isWhollyFreshClient()).toBe(false);

      // The clientId rotated atomically inside the destructive replacement.
      const rotatedId = await (storeService as any).db.get(
        STORE_NAMES.CLIENT_ID,
        SINGLETON_KEY,
      );
      expect(rotatedId).toMatch(/^[BEAI]_[a-zA-Z0-9]{6}$/);
    });
  });

  describe('runDestructiveStateReplacement atomicity', () => {
    it('preserves OPS, state_cache, and vector_clock when the destructive tx fails', async () => {
      // Seed the device: a few ops, a populated state_cache (post-compaction),
      // and a vector clock. This is the "normal-use" device state.
      const userOps: Operation[] = Array.from({ length: 3 }, (_, i) => ({
        id: `op-${i}`,
        actionType: 'TASK_ADD' as any,
        opType: 'Create' as any,
        entityType: 'TASK' as any,
        entityId: `t${i}`,
        payload: { id: `t${i}` },
        clientId: 'cPriorClient',
        vectorClock: { cPriorClient: i + 1 },
        timestamp: Date.now() + i,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      }));
      for (const op of userOps) {
        await storeService.append(op, 'local');
      }
      await storeService.saveStateCache({
        state: { sentinel: 'prior-state' } as any,
        lastAppliedOpSeq: 0,
        vectorClock: { cPriorClient: 3 },
        compactedAt: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });
      await storeService.setVectorClock({ cPriorClient: 3 });

      // Seed a prior clientId in SUP_OPS — the aborted rotation must not touch
      // it. This is the property withRotation used to provide by hand (#7732).
      await (storeService as any).db.put(STORE_NAMES.CLIENT_ID, 'B_seed', SINGLETON_KEY);

      const seqBefore = await storeService.getLastSeq();
      const cacheBefore = await storeService.loadStateCache();
      const clockBefore = await storeService.getVectorClock();

      // Inject a failure inside the destructive tx: opsStore.add throws after
      // the queued opsStore.clear(). IDB auto-aborts the tx; the prior OPS
      // entries must survive.
      const realTransaction = (storeService as any).db.transaction.bind(
        (storeService as any).db,
      );
      spyOn((storeService as any).db, 'transaction').and.callFake(
        (stores: any, mode: any) => {
          const tx = realTransaction(stores, mode);
          if (Array.isArray(stores) && stores.includes(STORE_NAMES.OPS)) {
            const opsStore = tx.objectStore(STORE_NAMES.OPS);
            opsStore.add = async () => {
              throw new Error('Simulated interrupt: append failed inside destructive tx');
            };
          }
          return tx;
        },
      );

      await expectAsync(
        cleanSlate.createCleanSlate('ENCRYPTION_CHANGE', 'PASSWORD_CHANGED'),
      ).toBeRejected();

      // POST: device is exactly as before the destructive call.
      expect(await storeService.getLastSeq()).toBe(seqBefore);
      const cacheAfter = await storeService.loadStateCache();
      expect(cacheAfter).not.toBeNull();
      expect((cacheAfter!.state as any).sentinel).toBe('prior-state');
      expect(cacheAfter!.vectorClock).toEqual(cacheBefore!.vectorClock);
      expect(await storeService.getVectorClock()).toEqual(clockBefore);
      // The rotated clientId was queued first inside the tx; the abort unwinds
      // it — SUP_OPS.client_id still holds the prior id.
      expect(
        await (storeService as any).db.get(STORE_NAMES.CLIENT_ID, SINGLETON_KEY),
      ).toBe('B_seed');
    });
  });

  describe('after fix: createCleanSlate interrupt no longer produces #7709 precondition', () => {
    it('on a never-compacted device, an interrupt leaves prior op-log intact', async () => {
      // Low-activity device: 3 ops, no state_cache (never compacted).
      const userOps: Operation[] = Array.from({ length: 3 }, (_, i) => ({
        id: `op-${i}`,
        actionType: 'TASK_ADD' as any,
        opType: 'Create' as any,
        entityType: 'TASK' as any,
        entityId: `t${i}`,
        payload: { id: `t${i}` },
        clientId: 'cPriorClient',
        vectorClock: { cPriorClient: i + 1 },
        timestamp: Date.now() + i,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      }));
      for (const op of userOps) {
        await storeService.append(op, 'local');
      }
      expect(await storeService.loadStateCache()).toBeNull();
      const seqBefore = await storeService.getLastSeq();

      // Inject a failure into the destructive tx (force opsStore.add to throw).
      const realTransaction = (storeService as any).db.transaction.bind(
        (storeService as any).db,
      );
      spyOn((storeService as any).db, 'transaction').and.callFake(
        (stores: any, mode: any) => {
          const tx = realTransaction(stores, mode);
          if (Array.isArray(stores) && stores.includes(STORE_NAMES.OPS)) {
            const opsStore = tx.objectStore(STORE_NAMES.OPS);
            opsStore.add = async () => {
              throw new Error('Simulated interrupt: append failed inside destructive tx');
            };
          }
          return tx;
        },
      );

      await expectAsync(
        cleanSlate.createCleanSlate('ENCRYPTION_CHANGE', 'PASSWORD_CHANGED'),
      ).toBeRejected();

      // POST-FIX behavior: device retains its prior ops and state_cache-null status.
      // Crucially, lastSeq is UNCHANGED — the IDB transaction's `clear()` was
      // rolled back when the subsequent `add` threw.
      // Without the atomicity fix, lastSeq would be 0 here and the next launch
      // would route through `isWhollyFreshClient + meaningful store data` and
      // throw `LocalDataConflictError(0, {})` — the #7709 chain.
      expect(await storeService.getLastSeq()).toBe(seqBefore);
      expect(await storeService.loadStateCache()).toBeNull();
      expect(syncLocalState.hasMeaningfulStoreData()).toBe(true);
      // The device is NOT classified as wholly fresh — even though state_cache
      // was missing before the destructive call too, the surviving op-log keeps
      // `lastSeq > 0` so `isWhollyFreshClient()` is false.
      expect(await syncLocalState.isWhollyFreshClient()).toBe(false);
    });
  });
});
