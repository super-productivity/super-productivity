import { TestBed } from '@angular/core/testing';
import { OperationLogSnapshotService } from './operation-log-snapshot.service';
import { OperationLogStoreService } from './operation-log-store.service';
import {
  CURRENT_SCHEMA_VERSION,
  MigratableStateCache,
  SchemaMigrationService,
} from './schema-migration.service';
import { VectorClockService } from '../sync/vector-clock.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { CLIENT_ID_PROVIDER, ClientIdProvider } from '../util/client-id.provider';
import { ValidateStateService } from '../validation/validate-state.service';
import { LockService } from '../sync/lock.service';
import { LOCK_NAMES } from '../core/operation-log.const';
import { OperationCaptureService } from '../capture/operation-capture.service';
import { OperationWriteFlushService } from '../sync/operation-write-flush.service';
import {
  bufferDeferredAction,
  clearDeferredActions,
} from '../capture/operation-capture.meta-reducer';
import { MAX_VECTOR_CLOCK_SIZE } from '@sp/sync-core';
import { PersistentAction } from '../core/persistent-action.interface';
import { OpType } from '../core/operation.types';

// Meaningful state (contains a task) so saveCurrentStateAsSnapshot proceeds past
// the empty-state guard (#7892). Tests that care only about clock pruning /
// compactedAt / entity keys use this so the save actually fires; the guard
// itself has a dedicated test.
const MEANINGFUL_SNAPSHOT_STATE = {
  task: { ids: ['t1'], entities: { t1: { id: 't1' } } },
} as unknown;

// Minimal persistent action for driving the real capture-service pending
// counter in the quiesce tests (#8469).
const FAKE_PENDING_ACTION = {
  type: '[Task] Test pending action',
  meta: { entityType: 'TASK', entityId: 't-pending' },
} as any;

describe('OperationLogSnapshotService', () => {
  let service: OperationLogSnapshotService;
  let captureService: OperationCaptureService;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockVectorClockService: jasmine.SpyObj<VectorClockService>;
  let mockStateSnapshotService: jasmine.SpyObj<StateSnapshotService>;
  let mockSchemaMigrationService: jasmine.SpyObj<SchemaMigrationService>;
  let mockClientIdProvider: jasmine.SpyObj<ClientIdProvider>;
  let mockValidateStateService: jasmine.SpyObj<ValidateStateService>;
  let mockLockService: jasmine.SpyObj<LockService>;

  beforeEach(() => {
    mockOpLogStore = jasmine.createSpyObj('OperationLogStoreService', [
      'saveStateCache',
      'saveStateCacheBackup',
      'clearStateCacheBackup',
      'restoreStateCacheFromBackup',
      'getLastSeq',
    ]);
    mockVectorClockService = jasmine.createSpyObj('VectorClockService', [
      'getCurrentVectorClock',
    ]);
    mockStateSnapshotService = jasmine.createSpyObj('StateSnapshotService', [
      'getStateSnapshot',
      'getStateSnapshotForOperationLog',
    ]);
    mockStateSnapshotService.getStateSnapshotForOperationLog.and.callFake(() =>
      mockStateSnapshotService.getStateSnapshot(),
    );
    mockSchemaMigrationService = jasmine.createSpyObj('SchemaMigrationService', [
      'migrateStateIfNeeded',
    ]);
    mockClientIdProvider = jasmine.createSpyObj('ClientIdProvider', ['loadClientId']);
    mockClientIdProvider.loadClientId.and.resolveTo('test-client');
    mockValidateStateService = jasmine.createSpyObj('ValidateStateService', [
      'validateState',
    ]);
    mockValidateStateService.validateState.and.resolveTo({
      isValid: true,
      typiaErrors: [],
    });
    mockLockService = jasmine.createSpyObj('LockService', ['request']);
    // Default: execute the callback inline (mirrors real Web Locks behavior in Chrome)
    mockLockService.request.and.callFake(async <T>(_name: string, fn: () => Promise<T>) =>
      fn(),
    );

    TestBed.configureTestingModule({
      providers: [
        OperationLogSnapshotService,
        // Real quiesce pipeline (flush + capture counter) on top of the mocked
        // lock, so the #8469 tests exercise the actual drain behavior.
        OperationWriteFlushService,
        OperationCaptureService,
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        { provide: VectorClockService, useValue: mockVectorClockService },
        { provide: StateSnapshotService, useValue: mockStateSnapshotService },
        { provide: SchemaMigrationService, useValue: mockSchemaMigrationService },
        { provide: CLIENT_ID_PROVIDER, useValue: mockClientIdProvider },
        { provide: ValidateStateService, useValue: mockValidateStateService },
        { provide: LockService, useValue: mockLockService },
      ],
    });
    service = TestBed.inject(OperationLogSnapshotService);
    captureService = TestBed.inject(OperationCaptureService);
    // The save bails on a non-empty MODULE-LEVEL deferred buffer (#8469);
    // start clean so a leak from another spec can't fail these tests
    // order-dependently under jasmine's random order.
    clearDeferredActions();
  });

  describe('isValidSnapshot', () => {
    const createValidSnapshot = (
      overrides: Partial<MigratableStateCache> = {},
    ): MigratableStateCache => ({
      state: { task: {}, project: {}, globalConfig: {} },
      lastAppliedOpSeq: 1,
      vectorClock: { client1: 1 },
      compactedAt: Date.now(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      ...overrides,
    });

    it('should return true for valid snapshot with all core models', () => {
      const snapshot = createValidSnapshot();
      expect(service.isValidSnapshot(snapshot)).toBe(true);
    });

    it('should return false when state is missing', () => {
      const snapshot = createValidSnapshot({ state: undefined as any });
      expect(service.isValidSnapshot(snapshot)).toBe(false);
    });

    it('should return false when lastAppliedOpSeq is missing', () => {
      const snapshot = createValidSnapshot({ lastAppliedOpSeq: undefined as any });
      expect(service.isValidSnapshot(snapshot)).toBe(false);
    });

    it('should return false when state is null', () => {
      const snapshot = createValidSnapshot({ state: null as any });
      expect(service.isValidSnapshot(snapshot)).toBe(false);
    });

    it('should return false when state is not an object', () => {
      const snapshot = createValidSnapshot({ state: 'invalid' as any });
      expect(service.isValidSnapshot(snapshot)).toBe(false);
    });

    it('should return false when task model is missing', () => {
      const snapshot = createValidSnapshot({
        state: { project: {}, globalConfig: {} },
      });
      expect(service.isValidSnapshot(snapshot)).toBe(false);
    });

    it('should return false when project model is missing', () => {
      const snapshot = createValidSnapshot({
        state: { task: {}, globalConfig: {} },
      });
      expect(service.isValidSnapshot(snapshot)).toBe(false);
    });

    it('should return false when globalConfig model is missing', () => {
      const snapshot = createValidSnapshot({
        state: { task: {}, project: {} },
      });
      expect(service.isValidSnapshot(snapshot)).toBe(false);
    });

    it('should return true when additional models beyond core exist', () => {
      const snapshot = createValidSnapshot({
        state: { task: {}, project: {}, globalConfig: {}, tag: {}, note: {} },
      });
      expect(service.isValidSnapshot(snapshot)).toBe(true);
    });

    it('should return false when lastAppliedOpSeq is not a number', () => {
      const snapshot = createValidSnapshot({ lastAppliedOpSeq: '5' as any });
      expect(service.isValidSnapshot(snapshot)).toBe(false);
    });

    it('should return false when compactedAt is missing', () => {
      const snapshot = createValidSnapshot({ compactedAt: undefined as any });
      expect(service.isValidSnapshot(snapshot)).toBe(false);
    });

    it('should return false when vectorClock is missing', () => {
      const snapshot = createValidSnapshot({ vectorClock: undefined as any });
      expect(service.isValidSnapshot(snapshot)).toBe(false);
    });

    it('should return false when vectorClock is an array', () => {
      const snapshot = createValidSnapshot({ vectorClock: [] as any });
      expect(service.isValidSnapshot(snapshot)).toBe(false);
    });
  });

  describe('saveCurrentStateAsSnapshot', () => {
    it('should save snapshot with current state data', async () => {
      const stateData = {
        task: { ids: ['t1'] },
        project: { ids: ['p1'] },
        globalConfig: {},
      };
      const vectorClock = { client1: 5, client2: 3 };
      mockStateSnapshotService.getStateSnapshot.and.returnValue(stateData as any);
      mockVectorClockService.getCurrentVectorClock.and.resolveTo(vectorClock);
      mockOpLogStore.getLastSeq.and.resolveTo(10);
      mockOpLogStore.saveStateCache.and.resolveTo(undefined);

      await service.saveCurrentStateAsSnapshot();

      expect(mockOpLogStore.saveStateCache).toHaveBeenCalledWith(
        jasmine.objectContaining({
          state: stateData,
          lastAppliedOpSeq: 10,
          vectorClock: vectorClock,
          schemaVersion: CURRENT_SCHEMA_VERSION,
        }),
      );
    });

    it('should include snapshotEntityKeys in saved snapshot', async () => {
      const stateData = {
        task: { ids: ['t1', 't2'] },
        project: { ids: ['p1'] },
        globalConfig: { someSetting: true },
      };
      mockStateSnapshotService.getStateSnapshot.and.returnValue(stateData as any);
      mockVectorClockService.getCurrentVectorClock.and.resolveTo({ client1: 1 });
      mockOpLogStore.getLastSeq.and.resolveTo(5);
      mockOpLogStore.saveStateCache.and.resolveTo(undefined);

      await service.saveCurrentStateAsSnapshot();

      const savedCache = mockOpLogStore.saveStateCache.calls.mostRecent().args[0];
      expect(savedCache.snapshotEntityKeys).toBeDefined();
      expect(savedCache.snapshotEntityKeys).toContain('TASK:t1');
      expect(savedCache.snapshotEntityKeys).toContain('TASK:t2');
      expect(savedCache.snapshotEntityKeys).toContain('PROJECT:p1');
      expect(savedCache.snapshotEntityKeys).toContain('GLOBAL_CONFIG:GLOBAL_CONFIG');
    });

    it('should not throw when save fails', async () => {
      mockStateSnapshotService.getStateSnapshot.and.returnValue(
        MEANINGFUL_SNAPSHOT_STATE as any,
      );
      mockVectorClockService.getCurrentVectorClock.and.resolveTo({});
      mockOpLogStore.getLastSeq.and.resolveTo(1);
      mockOpLogStore.saveStateCache.and.rejectWith(new Error('Save failed'));

      // Should not throw - errors are caught internally
      await expectAsync(service.saveCurrentStateAsSnapshot()).toBeResolved();
    });

    it('should skip saving when state has no meaningful data (#7892)', async () => {
      // A transient empty/initial NgRx state must never be cached over good data.
      mockStateSnapshotService.getStateSnapshot.and.returnValue({} as any);
      mockVectorClockService.getCurrentVectorClock.and.resolveTo({ client1: 1 });
      mockOpLogStore.getLastSeq.and.resolveTo(10);
      mockOpLogStore.saveStateCache.and.resolveTo(undefined);

      await service.saveCurrentStateAsSnapshot();

      expect(mockOpLogStore.saveStateCache).not.toHaveBeenCalled();
    });

    // Vector-clock pruning is store-owned (saveStateCache prunes internally,
    // #9096) — covered by the OperationLogStoreService spec. This service
    // passes the clock through unmodified:
    it('should not prune vector clock when it is within MAX_VECTOR_CLOCK_SIZE', async () => {
      const smallClock = { client1: 5, client2: 3 };
      mockStateSnapshotService.getStateSnapshot.and.returnValue(
        MEANINGFUL_SNAPSHOT_STATE as any,
      );
      mockVectorClockService.getCurrentVectorClock.and.resolveTo(smallClock);
      mockOpLogStore.getLastSeq.and.resolveTo(1);
      mockOpLogStore.saveStateCache.and.resolveTo(undefined);

      await service.saveCurrentStateAsSnapshot();

      const savedCache = mockOpLogStore.saveStateCache.calls.mostRecent().args[0];
      expect(savedCache.vectorClock).toEqual(smallClock);
    });

    it('should not prune vector clock at exactly MAX_VECTOR_CLOCK_SIZE entries', async () => {
      const exactClock: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        exactClock[`client-${i}`] = i + 1;
      }
      mockStateSnapshotService.getStateSnapshot.and.returnValue(
        MEANINGFUL_SNAPSHOT_STATE as any,
      );
      mockVectorClockService.getCurrentVectorClock.and.resolveTo(exactClock);
      mockOpLogStore.getLastSeq.and.resolveTo(1);
      mockOpLogStore.saveStateCache.and.resolveTo(undefined);

      await service.saveCurrentStateAsSnapshot();

      const savedCache = mockOpLogStore.saveStateCache.calls.mostRecent().args[0];
      expect(savedCache.vectorClock).toEqual(exactClock);
    });

    it('should save the clock from the vector clock service verbatim', async () => {
      const clock = { client1: 5 };
      mockStateSnapshotService.getStateSnapshot.and.returnValue(
        MEANINGFUL_SNAPSHOT_STATE as any,
      );
      mockVectorClockService.getCurrentVectorClock.and.resolveTo(clock);
      mockOpLogStore.getLastSeq.and.resolveTo(1);
      mockOpLogStore.saveStateCache.and.resolveTo(undefined);

      await service.saveCurrentStateAsSnapshot();

      const savedCache = mockOpLogStore.saveStateCache.calls.mostRecent().args[0];
      expect(savedCache.vectorClock).toEqual(clock);
    });

    it('should include compactedAt timestamp', async () => {
      const beforeTime = Date.now();
      mockStateSnapshotService.getStateSnapshot.and.returnValue(
        MEANINGFUL_SNAPSHOT_STATE as any,
      );
      mockVectorClockService.getCurrentVectorClock.and.resolveTo({});
      mockOpLogStore.getLastSeq.and.resolveTo(1);
      mockOpLogStore.saveStateCache.and.resolveTo(undefined);

      await service.saveCurrentStateAsSnapshot();
      const afterTime = Date.now();

      const savedCache = mockOpLogStore.saveStateCache.calls.mostRecent().args[0];
      expect(savedCache.compactedAt).toBeGreaterThanOrEqual(beforeTime);
      expect(savedCache.compactedAt).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('saveCurrentStateAsSnapshot — phantom-change guards (#8751)', () => {
    // Live state containing changes with no durable op behind them must never
    // be written to state_cache — the save is only a boot-speed cache, so
    // skipping is always safe.
    const createPersistentAction = (): PersistentAction =>
      ({
        type: '[Task] Update Task',
        meta: {
          isPersistent: true,
          isRemote: false,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: 't1',
        },
      }) as PersistentAction;

    beforeEach(() => {
      mockOpLogStore.getLastSeq.and.resolveTo(1);
      mockStateSnapshotService.getStateSnapshot.and.returnValue(
        MEANINGFUL_SNAPSHOT_STATE as any,
      );
      // Stubbed for the whole describe so the save path runs with a realistic
      // clock. (Historically load-bearing: the service used to prune here and
      // threw on an unstubbed clock, which made the "should skip" tests below
      // vacuously green; pruning is store-owned now — #9096.)
      mockVectorClockService.getCurrentVectorClock.and.resolveTo({ c1: 1 });
      clearDeferredActions();
    });

    afterEach(() => {
      clearDeferredActions();
    });

    it('should skip the save after an unrecovered persist failure', async () => {
      TestBed.inject(OperationCaptureService).markUnrecoveredPersistFailure();

      await service.saveCurrentStateAsSnapshot();

      expect(mockOpLogStore.saveStateCache).not.toHaveBeenCalled();
      // The guard must bail BEFORE the state read, not merely before the write.
      expect(
        mockStateSnapshotService.getStateSnapshotForOperationLog,
      ).not.toHaveBeenCalled();
    });

    it('should skip the save while captured writes are still pending', async () => {
      const writeFlushService = TestBed.inject(OperationWriteFlushService);
      spyOn(writeFlushService, 'flushThenRunExclusive').and.callFake(
        async <T>(fn: () => Promise<T>) => {
          captureService.incrementPending(createPersistentAction());
          return fn();
        },
      );

      await service.saveCurrentStateAsSnapshot();

      expect(mockOpLogStore.saveStateCache).not.toHaveBeenCalled();
    });

    it('should skip the save while deferred actions from a sync window are buffered', async () => {
      bufferDeferredAction(createPersistentAction());

      await service.saveCurrentStateAsSnapshot();

      expect(mockOpLogStore.saveStateCache).not.toHaveBeenCalled();
    });

    it('should save once the phantom risk has cleared', async () => {
      const writeFlushService = TestBed.inject(OperationWriteFlushService);
      const action = createPersistentAction();
      const flushThenRunExclusive = spyOn(
        writeFlushService,
        'flushThenRunExclusive',
      ).and.callFake(async <T>(fn: () => Promise<T>) => {
        captureService.incrementPending(action);
        return fn();
      });

      await service.saveCurrentStateAsSnapshot();
      expect(mockOpLogStore.saveStateCache).not.toHaveBeenCalled();

      captureService.decrementPending(action);
      flushThenRunExclusive.and.callThrough();
      mockVectorClockService.getCurrentVectorClock.and.resolveTo({ c1: 1 });

      await service.saveCurrentStateAsSnapshot();
      expect(mockOpLogStore.saveStateCache).toHaveBeenCalled();
    });
  });

  describe('saveCurrentStateAsSnapshot — lock regression', () => {
    it('should acquire OPERATION_LOG lock before saving (#8308)', async () => {
      mockStateSnapshotService.getStateSnapshot.and.returnValue(
        MEANINGFUL_SNAPSHOT_STATE as any,
      );
      mockVectorClockService.getCurrentVectorClock.and.resolveTo({});
      mockOpLogStore.getLastSeq.and.resolveTo(1);
      mockOpLogStore.saveStateCache.and.resolveTo(undefined);

      await service.saveCurrentStateAsSnapshot();

      expect(mockLockService.request).toHaveBeenCalledWith(
        LOCK_NAMES.OPERATION_LOG,
        jasmine.any(Function),
      );
    });

    it('should read state BEFORE lastSeq inside the lock (quiesced capture, #8469)', async () => {
      const callOrder: string[] = [];

      mockLockService.request.and.callFake(
        async <T>(_name: string, fn: () => Promise<T>) => {
          callOrder.push('lock-start');
          const r = await fn();
          callOrder.push('lock-end');
          return r;
        },
      );

      mockOpLogStore.getLastSeq.and.callFake(async () => {
        callOrder.push('getLastSeq');
        return 1;
      });

      mockStateSnapshotService.getStateSnapshot.and.callFake((() => {
        callOrder.push('getStateSnapshot');
        return MEANINGFUL_SNAPSHOT_STATE;
      }) as any);

      mockVectorClockService.getCurrentVectorClock.and.resolveTo({});
      mockOpLogStore.saveStateCache.and.resolveTo(undefined);

      await service.saveCurrentStateAsSnapshot();

      // The flush pre-pass acquires/releases the lock once on its own; the
      // capture body runs inside the LAST lock window.
      const lockStartIndex = callOrder.lastIndexOf('lock-start');
      const lockEndIndex = callOrder.lastIndexOf('lock-end');
      expect(callOrder.indexOf('getLastSeq')).toBeGreaterThan(lockStartIndex);
      expect(callOrder.indexOf('getLastSeq')).toBeLessThan(lockEndIndex);
      expect(callOrder.indexOf('getStateSnapshot')).toBeGreaterThan(lockStartIndex);
      expect(callOrder.indexOf('getStateSnapshot')).toBeLessThan(lockEndIndex);

      // Key invariant (#8469): with the capture pipeline drained and the lock
      // held, no op can gain a seq during the body. State is read first
      // (synchronously, before any await can let a dispatch interleave) and
      // lastSeq after — so every op with seq <= lastAppliedOpSeq has its
      // effect in the captured state, and every later dispatch is absent from
      // it and replays cleanly. (Pre-quiesce the order was inverted to bias
      // the race toward re-replay instead of op-loss.)
      expect(callOrder.indexOf('getStateSnapshot')).toBeLessThan(
        callOrder.indexOf('getLastSeq'),
      );
    });

    it('should catch lock errors without throwing (hydration must not fail)', async () => {
      mockLockService.request.and.rejectWith(new Error('Lock timeout'));

      // Should not throw — errors are caught internally
      await expectAsync(service.saveCurrentStateAsSnapshot()).toBeResolved();
    });
  });

  describe('saveCurrentStateAsSnapshot — quiesced capture (#8469)', () => {
    beforeEach(() => {
      mockStateSnapshotService.getStateSnapshot.and.returnValue(
        MEANINGFUL_SNAPSHOT_STATE as any,
      );
      mockVectorClockService.getCurrentVectorClock.and.resolveTo({});
      mockOpLogStore.saveStateCache.and.resolveTo(undefined);
    });

    it('should wait for in-flight op writes to drain before capturing', async () => {
      // An action whose reducer has already run but whose op write is still
      // queued must end up covered by the saved lastAppliedOpSeq — otherwise
      // the next boot's tail replay re-applies an op whose effect is already
      // baked into the snapshot state (double-applying non-idempotent
      // reducers: accumulating time/metric deltas, plain-append branches).
      captureService.incrementPending(FAKE_PENDING_ACTION);
      let opWriteDurable = false;
      mockOpLogStore.getLastSeq.and.callFake(async () => (opWriteDurable ? 11 : 10));

      // Simulate the persist effect completing the queued write while the
      // snapshot's flush pre-pass is polling.
      setTimeout(() => {
        opWriteDurable = true;
        captureService.decrementPending();
      }, 30);

      await service.saveCurrentStateAsSnapshot();

      expect(mockOpLogStore.saveStateCache).toHaveBeenCalledWith(
        jasmine.objectContaining({ lastAppliedOpSeq: 11 }),
      );
    });

    it('should skip the save without throwing when the pipeline cannot quiesce', async () => {
      const writeFlushService = TestBed.inject(OperationWriteFlushService);
      spyOn(writeFlushService, 'flushThenRunExclusive').and.rejectWith(
        new Error('Operation write cutoff not reached'),
      );
      mockOpLogStore.getLastSeq.and.resolveTo(1);

      // Skipping is always correctness-safe: the snapshot is only a boot-time
      // cache and the op-log stays the source of truth.
      await expectAsync(service.saveCurrentStateAsSnapshot()).toBeResolved();
      expect(mockOpLogStore.saveStateCache).not.toHaveBeenCalled();
    });

    it('should skip the save when deferred actions are pending durable write', async () => {
      // Deferred actions (buffered during a sync window, kept across windows
      // after a failed drain) have their reducer effects in state but no seq
      // yet and are invisible to the pending counter — capturing would tag
      // the snapshot behind their future seqs.
      bufferDeferredAction(FAKE_PENDING_ACTION);
      try {
        mockOpLogStore.getLastSeq.and.resolveTo(1);

        await service.saveCurrentStateAsSnapshot();

        expect(mockOpLogStore.saveStateCache).not.toHaveBeenCalled();
      } finally {
        // Module-level buffer persists across TestBed resets — always clean up.
        clearDeferredActions();
      }
    });
  });

  describe('migrateSnapshotWithBackup', () => {
    const createSnapshot = (): MigratableStateCache => ({
      state: { task: {}, project: {}, globalConfig: {} },
      lastAppliedOpSeq: 5,
      vectorClock: { client1: 3 },
      compactedAt: Date.now(),
      schemaVersion: 1,
    });

    it('should create backup before migration', async () => {
      const snapshot = createSnapshot();
      const migratedSnapshot = { ...snapshot, schemaVersion: CURRENT_SCHEMA_VERSION };
      mockOpLogStore.saveStateCacheBackup.and.resolveTo(undefined);
      mockSchemaMigrationService.migrateStateIfNeeded.and.returnValue(migratedSnapshot);
      mockOpLogStore.saveStateCache.and.resolveTo(undefined);
      mockOpLogStore.clearStateCacheBackup.and.resolveTo(undefined);

      await service.migrateSnapshotWithBackup(snapshot);

      expect(mockOpLogStore.saveStateCacheBackup).toHaveBeenCalled();
      expect(mockOpLogStore.saveStateCacheBackup).toHaveBeenCalledBefore(
        mockSchemaMigrationService.migrateStateIfNeeded,
      );
    });

    it('should save migrated snapshot after successful migration', async () => {
      const snapshot = createSnapshot();
      const migratedSnapshot = { ...snapshot, schemaVersion: CURRENT_SCHEMA_VERSION };
      mockOpLogStore.saveStateCacheBackup.and.resolveTo(undefined);
      mockSchemaMigrationService.migrateStateIfNeeded.and.returnValue(migratedSnapshot);
      mockOpLogStore.saveStateCache.and.resolveTo(undefined);
      mockOpLogStore.clearStateCacheBackup.and.resolveTo(undefined);

      await service.migrateSnapshotWithBackup(snapshot);

      expect(mockOpLogStore.saveStateCache).toHaveBeenCalledWith(migratedSnapshot);
    });

    it('should clear backup after successful migration', async () => {
      const snapshot = createSnapshot();
      const migratedSnapshot = { ...snapshot, schemaVersion: CURRENT_SCHEMA_VERSION };
      mockOpLogStore.saveStateCacheBackup.and.resolveTo(undefined);
      mockSchemaMigrationService.migrateStateIfNeeded.and.returnValue(migratedSnapshot);
      mockOpLogStore.saveStateCache.and.resolveTo(undefined);
      mockOpLogStore.clearStateCacheBackup.and.resolveTo(undefined);

      await service.migrateSnapshotWithBackup(snapshot);

      expect(mockOpLogStore.clearStateCacheBackup).toHaveBeenCalled();
    });

    it('should return migrated snapshot on success', async () => {
      const snapshot = createSnapshot();
      const migratedSnapshot = { ...snapshot, schemaVersion: CURRENT_SCHEMA_VERSION };
      mockOpLogStore.saveStateCacheBackup.and.resolveTo(undefined);
      mockSchemaMigrationService.migrateStateIfNeeded.and.returnValue(migratedSnapshot);
      mockOpLogStore.saveStateCache.and.resolveTo(undefined);
      mockOpLogStore.clearStateCacheBackup.and.resolveTo(undefined);

      const result = await service.migrateSnapshotWithBackup(snapshot);

      expect(result).toBe(migratedSnapshot);
    });

    it('should restore backup when migration fails', async () => {
      const snapshot = createSnapshot();
      mockOpLogStore.saveStateCacheBackup.and.resolveTo(undefined);
      mockSchemaMigrationService.migrateStateIfNeeded.and.throwError(
        new Error('Migration failed'),
      );
      mockOpLogStore.restoreStateCacheFromBackup.and.resolveTo(undefined);

      await expectAsync(
        service.migrateSnapshotWithBackup(snapshot),
      ).toBeRejectedWithError('Migration failed');

      expect(mockOpLogStore.restoreStateCacheFromBackup).toHaveBeenCalled();
    });

    it('should throw combined error when both migration and restore fail', async () => {
      const snapshot = createSnapshot();
      mockOpLogStore.saveStateCacheBackup.and.resolveTo(undefined);
      mockSchemaMigrationService.migrateStateIfNeeded.and.throwError(
        new Error('Migration failed'),
      );
      mockOpLogStore.restoreStateCacheFromBackup.and.rejectWith(
        new Error('Restore failed'),
      );

      await expectAsync(
        service.migrateSnapshotWithBackup(snapshot),
      ).toBeRejectedWithError(
        /Schema migration failed and backup restore also failed.*Migration failed.*Restore failed/,
      );
    });

    it('should not clear backup when migration fails', async () => {
      const snapshot = createSnapshot();
      mockOpLogStore.saveStateCacheBackup.and.resolveTo(undefined);
      mockSchemaMigrationService.migrateStateIfNeeded.and.throwError(
        new Error('Migration failed'),
      );
      mockOpLogStore.restoreStateCacheFromBackup.and.resolveTo(undefined);

      await expectAsync(service.migrateSnapshotWithBackup(snapshot)).toBeRejected();

      expect(mockOpLogStore.clearStateCacheBackup).not.toHaveBeenCalled();
    });

    it('should restore backup when saveStateCache fails after migration', async () => {
      const snapshot = createSnapshot();
      const migratedSnapshot = { ...snapshot, schemaVersion: CURRENT_SCHEMA_VERSION };
      mockOpLogStore.saveStateCacheBackup.and.resolveTo(undefined);
      mockSchemaMigrationService.migrateStateIfNeeded.and.returnValue(migratedSnapshot);
      mockOpLogStore.saveStateCache.and.rejectWith(new Error('Save failed'));
      mockOpLogStore.restoreStateCacheFromBackup.and.resolveTo(undefined);

      await expectAsync(
        service.migrateSnapshotWithBackup(snapshot),
      ).toBeRejectedWithError('Save failed');

      expect(mockOpLogStore.restoreStateCacheFromBackup).toHaveBeenCalled();
    });

    it('should validate migrated snapshot before saving and clearing backup', async () => {
      const snapshot = createSnapshot();
      const migratedSnapshot = { ...snapshot, schemaVersion: CURRENT_SCHEMA_VERSION };
      mockOpLogStore.saveStateCacheBackup.and.resolveTo(undefined);
      mockSchemaMigrationService.migrateStateIfNeeded.and.returnValue(migratedSnapshot);
      mockOpLogStore.saveStateCache.and.resolveTo(undefined);
      mockOpLogStore.clearStateCacheBackup.and.resolveTo(undefined);

      await service.migrateSnapshotWithBackup(snapshot);

      expect(mockValidateStateService.validateState).toHaveBeenCalledWith(
        migratedSnapshot.state as Record<string, unknown>,
      );
      expect(mockValidateStateService.validateState).toHaveBeenCalledBefore(
        mockOpLogStore.saveStateCache,
      );
    });

    it('should restore backup and not save when migrated state fails validation', async () => {
      const snapshot = createSnapshot();
      const migratedSnapshot = { ...snapshot, schemaVersion: CURRENT_SCHEMA_VERSION };
      mockOpLogStore.saveStateCacheBackup.and.resolveTo(undefined);
      mockSchemaMigrationService.migrateStateIfNeeded.and.returnValue(migratedSnapshot);
      mockValidateStateService.validateState.and.resolveTo({
        isValid: false,
        typiaErrors: [{ path: '$input.task', expected: 'TaskState' }],
      });
      mockOpLogStore.restoreStateCacheFromBackup.and.resolveTo(undefined);

      await expectAsync(
        service.migrateSnapshotWithBackup(snapshot),
      ).toBeRejectedWithError(/Migrated snapshot validation failed/);

      expect(mockOpLogStore.saveStateCache).not.toHaveBeenCalled();
      expect(mockOpLogStore.restoreStateCacheFromBackup).toHaveBeenCalled();
      expect(mockOpLogStore.clearStateCacheBackup).not.toHaveBeenCalled();
    });

    it('should restore backup and not save when migrated metadata is invalid', async () => {
      const snapshot = createSnapshot();
      // Drop a required field so isValidSnapshot rejects it
      const migratedSnapshot = {
        ...snapshot,
        lastAppliedOpSeq: undefined as any,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      };
      mockOpLogStore.saveStateCacheBackup.and.resolveTo(undefined);
      mockSchemaMigrationService.migrateStateIfNeeded.and.returnValue(migratedSnapshot);
      mockOpLogStore.restoreStateCacheFromBackup.and.resolveTo(undefined);

      await expectAsync(
        service.migrateSnapshotWithBackup(snapshot),
      ).toBeRejectedWithError(/Migrated snapshot metadata validation failed/);

      expect(mockValidateStateService.validateState).not.toHaveBeenCalled();
      expect(mockOpLogStore.saveStateCache).not.toHaveBeenCalled();
      expect(mockOpLogStore.restoreStateCacheFromBackup).toHaveBeenCalled();
      expect(mockOpLogStore.clearStateCacheBackup).not.toHaveBeenCalled();
    });
  });
});
