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

describe('OperationLogSnapshotService', () => {
  let service: OperationLogSnapshotService;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockVectorClockService: jasmine.SpyObj<VectorClockService>;
  let mockStateSnapshotService: jasmine.SpyObj<StateSnapshotService>;
  let mockSchemaMigrationService: jasmine.SpyObj<SchemaMigrationService>;

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

    TestBed.configureTestingModule({
      providers: [
        OperationLogSnapshotService,
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        { provide: VectorClockService, useValue: mockVectorClockService },
        { provide: StateSnapshotService, useValue: mockStateSnapshotService },
        { provide: SchemaMigrationService, useValue: mockSchemaMigrationService },
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

    it('should not throw when save fails', async () => {
      mockStateSnapshotService.getStateSnapshot.and.returnValue({} as any);
      mockVectorClockService.getCurrentVectorClock.and.resolveTo({});
      mockOpLogStore.getLastSeq.and.resolveTo(1);
      mockOpLogStore.saveStateCache.and.rejectWith(new Error('Save failed'));

      // Should not throw - errors are caught internally
      await expectAsync(service.saveCurrentStateAsSnapshot()).toBeResolved();
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
