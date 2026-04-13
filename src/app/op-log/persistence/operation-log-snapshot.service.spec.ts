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
import { MAX_VECTOR_CLOCK_SIZE } from '@sp/shared-schema';

describe('OperationLogSnapshotService', () => {
  let service: OperationLogSnapshotService;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockVectorClockService: jasmine.SpyObj<VectorClockService>;
  let mockStateSnapshotService: jasmine.SpyObj<StateSnapshotService>;
  let mockSchemaMigrationService: jasmine.SpyObj<SchemaMigrationService>;
  let mockClientIdProvider: jasmine.SpyObj<ClientIdProvider>;

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
    ]);
    mockSchemaMigrationService = jasmine.createSpyObj('SchemaMigrationService', [
      'migrateStateIfNeeded',
    ]);
    mockClientIdProvider = jasmine.createSpyObj('ClientIdProvider', ['loadClientId']);
    mockClientIdProvider.loadClientId.and.resolveTo('test-client');

    TestBed.configureTestingModule({
      providers: [
        OperationLogSnapshotService,
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        { provide: VectorClockService, useValue: mockVectorClockService },
        { provide: StateSnapshotService, useValue: mockStateSnapshotService },
        { provide: SchemaMigrationService, useValue: mockSchemaMigrationService },
        { provide: CLIENT_ID_PROVIDER, useValue: mockClientIdProvider },
      ],
    });
    service = TestBed.inject(OperationLogSnapshotService);
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
      mockStateSnapshotService.getStateSnapshot.and.returnValue({} as any);
      mockVectorClockService.getCurrentVectorClock.and.resolveTo({});
      mockOpLogStore.getLastSeq.and.resolveTo(1);
      mockOpLogStore.saveStateCache.and.rejectWith(new Error('Save failed'));

      // Should not throw - errors are caught internally
      await expectAsync(service.saveCurrentStateAsSnapshot()).toBeResolved();
    });

    it('should prune vector clock before saving when it exceeds MAX_VECTOR_CLOCK_SIZE', async () => {
      // Create a bloated vector clock with more entries than MAX_VECTOR_CLOCK_SIZE
      const bloatedClock: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE + 10; i++) {
        bloatedClock[`client-${i}`] = i + 1;
      }
      // Ensure the local client is in the clock
      bloatedClock['test-client'] = 999;

      mockStateSnapshotService.getStateSnapshot.and.returnValue({} as any);
      mockVectorClockService.getCurrentVectorClock.and.resolveTo(bloatedClock);
      mockOpLogStore.getLastSeq.and.resolveTo(1);
      mockOpLogStore.saveStateCache.and.resolveTo(undefined);

      await service.saveCurrentStateAsSnapshot();

      const savedCache = mockOpLogStore.saveStateCache.calls.mostRecent().args[0];
      const savedClockSize = Object.keys(savedCache.vectorClock).length;
      expect(savedClockSize).toBeLessThanOrEqual(MAX_VECTOR_CLOCK_SIZE);
      // Local client ID must be preserved after pruning
      expect(savedCache.vectorClock['test-client']).toBe(999);
    });

    it('should not prune vector clock when it is within MAX_VECTOR_CLOCK_SIZE', async () => {
      const smallClock = { client1: 5, client2: 3 };
      mockStateSnapshotService.getStateSnapshot.and.returnValue({} as any);
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
      mockStateSnapshotService.getStateSnapshot.and.returnValue({} as any);
      mockVectorClockService.getCurrentVectorClock.and.resolveTo(exactClock);
      mockOpLogStore.getLastSeq.and.resolveTo(1);
      mockOpLogStore.saveStateCache.and.resolveTo(undefined);

      await service.saveCurrentStateAsSnapshot();

      const savedCache = mockOpLogStore.saveStateCache.calls.mostRecent().args[0];
      expect(savedCache.vectorClock).toEqual(exactClock);
    });

    it('should save unpruned clock if clientId is null', async () => {
      mockClientIdProvider.loadClientId.and.resolveTo(null);
      const clock = { client1: 5 };
      mockStateSnapshotService.getStateSnapshot.and.returnValue({} as any);
      mockVectorClockService.getCurrentVectorClock.and.resolveTo(clock);
      mockOpLogStore.getLastSeq.and.resolveTo(1);
      mockOpLogStore.saveStateCache.and.resolveTo(undefined);

      await service.saveCurrentStateAsSnapshot();

      const savedCache = mockOpLogStore.saveStateCache.calls.mostRecent().args[0];
      expect(savedCache.vectorClock).toEqual(clock);
    });

    it('should include compactedAt timestamp', async () => {
      const beforeTime = Date.now();
      mockStateSnapshotService.getStateSnapshot.and.returnValue({} as any);
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
  });
});
