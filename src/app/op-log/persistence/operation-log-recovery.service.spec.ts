import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { OperationLogRecoveryService } from './operation-log-recovery.service';
import { OperationLogStoreService } from './operation-log-store.service';
import { LegacyPfDbService } from '../../core/persistence/legacy-pf-db.service';
import { ClientIdService } from '../../core/util/client-id.service';
import { ActionType, OpType } from '../core/operation.types';
import { PENDING_OPERATION_EXPIRY_MS } from '../core/operation-log.const';

describe('OperationLogRecoveryService', () => {
  let service: OperationLogRecoveryService;
  let mockStore: jasmine.SpyObj<Store>;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockLegacyPfDb: jasmine.SpyObj<LegacyPfDbService>;
  let mockClientIdService: jasmine.SpyObj<ClientIdService>;

  beforeEach(() => {
    mockStore = jasmine.createSpyObj('Store', ['dispatch']);
    mockOpLogStore = jasmine.createSpyObj('OperationLogStoreService', [
      'append',
      'getLastSeq',
      'saveStateCache',
      'setVectorClock',
      'getPendingRemoteOps',
      'markRejected',
      'markApplied',
      'getUnsynced',
    ]);
    mockOpLogStore.setVectorClock.and.resolveTo(undefined);
    mockLegacyPfDb = jasmine.createSpyObj('LegacyPfDbService', [
      'hasUsableEntityData',
      'loadAllEntityData',
    ]);
    mockClientIdService = jasmine.createSpyObj('ClientIdService', ['loadClientId']);

    TestBed.configureTestingModule({
      providers: [
        OperationLogRecoveryService,
        { provide: Store, useValue: mockStore },
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        { provide: LegacyPfDbService, useValue: mockLegacyPfDb },
        { provide: ClientIdService, useValue: mockClientIdService },
      ],
    });
    service = TestBed.inject(OperationLogRecoveryService);
  });

  describe('attemptRecovery', () => {
    it('should recover from legacy data when available', async () => {
      const legacyData = { task: { ids: ['task1'] } };
      mockLegacyPfDb.hasUsableEntityData.and.resolveTo(true);
      mockLegacyPfDb.loadAllEntityData.and.resolveTo(legacyData as any);
      mockClientIdService.loadClientId.and.resolveTo('testClient');
      mockOpLogStore.append.and.resolveTo(undefined);
      mockOpLogStore.getLastSeq.and.resolveTo(1);
      mockOpLogStore.saveStateCache.and.resolveTo(undefined);

      await service.attemptRecovery();

      expect(mockOpLogStore.append).toHaveBeenCalledWith(
        jasmine.objectContaining({
          actionType: ActionType.RECOVERY_DATA_IMPORT,
          opType: OpType.Batch,
          entityType: 'RECOVERY',
          payload: legacyData,
        }),
      );
      expect(mockStore.dispatch).toHaveBeenCalled();
    });

    it('should not recover when no usable legacy data exists', async () => {
      mockLegacyPfDb.hasUsableEntityData.and.resolveTo(false);

      await service.attemptRecovery();

      expect(mockLegacyPfDb.loadAllEntityData).not.toHaveBeenCalled();
      expect(mockOpLogStore.append).not.toHaveBeenCalled();
      expect(mockStore.dispatch).not.toHaveBeenCalled();
    });

    it('should handle database access errors gracefully', async () => {
      mockLegacyPfDb.hasUsableEntityData.and.rejectWith(new Error('Database error'));

      // Should not throw
      await expectAsync(service.attemptRecovery()).toBeResolved();
      expect(mockOpLogStore.append).not.toHaveBeenCalled();
    });
  });

  describe('recoverFromLegacyData', () => {
    it('should create recovery operation with correct properties', async () => {
      const legacyData = {
        task: { ids: ['task1'], entities: { task1: { id: 'task1' } } },
      };
      mockClientIdService.loadClientId.and.resolveTo('testClient');
      mockOpLogStore.append.and.resolveTo(undefined);
      mockOpLogStore.getLastSeq.and.resolveTo(1);
      mockOpLogStore.saveStateCache.and.resolveTo(undefined);

      await service.recoverFromLegacyData(legacyData);

      expect(mockOpLogStore.append).toHaveBeenCalledWith(
        jasmine.objectContaining({
          actionType: ActionType.RECOVERY_DATA_IMPORT,
          opType: OpType.Batch,
          entityType: 'RECOVERY',
          entityId: '*',
          payload: legacyData,
          clientId: 'testClient',
          vectorClock: { testClient: 1 },
        }),
      );
    });

    it('should throw when clientId cannot be loaded', async () => {
      mockClientIdService.loadClientId.and.resolveTo(null);

      await expectAsync(service.recoverFromLegacyData({})).toBeRejectedWithError(
        /Failed to load clientId/,
      );
    });

    it('should save state cache after recovery', async () => {
      const legacyData = { task: { ids: ['task1'] } };
      mockClientIdService.loadClientId.and.resolveTo('testClient');
      mockOpLogStore.append.and.resolveTo(undefined);
      mockOpLogStore.getLastSeq.and.resolveTo(5);
      mockOpLogStore.saveStateCache.and.resolveTo(undefined);

      await service.recoverFromLegacyData(legacyData);

      expect(mockOpLogStore.saveStateCache).toHaveBeenCalledWith(
        jasmine.objectContaining({
          state: legacyData,
          lastAppliedOpSeq: 5,
          vectorClock: { testClient: 1 },
        }),
      );
    });

    it('should persist vector clock to IndexedDB store after recovery', async () => {
      const legacyData = { task: { ids: ['task1'] } };
      mockClientIdService.loadClientId.and.resolveTo('testClient');
      mockOpLogStore.append.and.resolveTo(undefined);
      mockOpLogStore.getLastSeq.and.resolveTo(1);
      mockOpLogStore.saveStateCache.and.resolveTo(undefined);

      await service.recoverFromLegacyData(legacyData);

      expect(mockOpLogStore.setVectorClock).toHaveBeenCalledWith({ testClient: 1 });
    });
  });

  describe('recoverPendingRemoteOps', () => {
    it('should do nothing when no pending ops exist', async () => {
      mockOpLogStore.getPendingRemoteOps.and.resolveTo([]);

      await service.recoverPendingRemoteOps();

      expect(mockOpLogStore.markApplied).not.toHaveBeenCalled();
      expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
    });

    it('should mark valid pending ops as applied', async () => {
      const now = Date.now();
      const pendingOps = [
        { seq: 1, op: { id: 'op1' }, appliedAt: now - 1000, source: 'remote' },
        { seq: 2, op: { id: 'op2' }, appliedAt: now - 2000, source: 'remote' },
      ] as any;
      mockOpLogStore.getPendingRemoteOps.and.resolveTo(pendingOps);
      mockOpLogStore.markApplied.and.resolveTo(undefined);

      await service.recoverPendingRemoteOps();

      expect(mockOpLogStore.markApplied).toHaveBeenCalledWith([1, 2]);
    });

    it('should reject ops that exceed PENDING_OPERATION_EXPIRY_MS', async () => {
      const now = Date.now();
      const pendingOps = [
        { seq: 1, op: { id: 'valid' }, appliedAt: now - 1000, source: 'remote' }, // Valid
        {
          seq: 2,
          op: { id: 'expired' },
          appliedAt: now - PENDING_OPERATION_EXPIRY_MS - 1,
          source: 'remote',
        }, // Expired
      ] as any;
      mockOpLogStore.getPendingRemoteOps.and.resolveTo(pendingOps);
      mockOpLogStore.markApplied.and.resolveTo(undefined);
      mockOpLogStore.markRejected.and.resolveTo(undefined);

      await service.recoverPendingRemoteOps();

      expect(mockOpLogStore.markApplied).toHaveBeenCalledWith([1]);
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['expired']);
    });

    it('should reject all expired ops when all are superseded', async () => {
      const now = Date.now();
      const expiredTime = now - PENDING_OPERATION_EXPIRY_MS - 100000;
      const pendingOps = [
        { seq: 1, op: { id: 'old1' }, appliedAt: expiredTime, source: 'remote' },
        { seq: 2, op: { id: 'old2' }, appliedAt: expiredTime - 1000, source: 'remote' },
      ] as any;
      mockOpLogStore.getPendingRemoteOps.and.resolveTo(pendingOps);
      mockOpLogStore.markRejected.and.resolveTo(undefined);

      await service.recoverPendingRemoteOps();

      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['old1', 'old2']);
      expect(mockOpLogStore.markApplied).not.toHaveBeenCalled();
    });

    it('should handle mixed valid and expired ops correctly', async () => {
      const now = Date.now();
      const pendingOps = [
        { seq: 1, op: { id: 'valid1' }, appliedAt: now - 1000, source: 'remote' },
        {
          seq: 2,
          op: { id: 'expired1' },
          appliedAt: now - PENDING_OPERATION_EXPIRY_MS - 1,
          source: 'remote',
        },
        { seq: 3, op: { id: 'valid2' }, appliedAt: now - 5000, source: 'remote' },
        {
          seq: 4,
          op: { id: 'expired2' },
          appliedAt: now - PENDING_OPERATION_EXPIRY_MS - 2,
          source: 'remote',
        },
      ] as any;
      mockOpLogStore.getPendingRemoteOps.and.resolveTo(pendingOps);
      mockOpLogStore.markApplied.and.resolveTo(undefined);
      mockOpLogStore.markRejected.and.resolveTo(undefined);

      await service.recoverPendingRemoteOps();

      expect(mockOpLogStore.markApplied).toHaveBeenCalledWith([1, 3]);
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['expired1', 'expired2']);
    });
  });

  describe('cleanupCorruptOps', () => {
    it('should do nothing when no unsynced ops exist', async () => {
      mockOpLogStore.getUnsynced.and.resolveTo([]);

      await service.cleanupCorruptOps();

      expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
    });

    it('should do nothing when all ops have valid entityId', async () => {
      const validOps = [
        { seq: 1, op: { id: 'op1', entityId: 'task-1', entityType: 'TASK' } },
        { seq: 2, op: { id: 'op2', entityId: 'tag-1', entityType: 'TAG' } },
      ] as any;
      mockOpLogStore.getUnsynced.and.resolveTo(validOps);

      await service.cleanupCorruptOps();

      expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
    });

    it('should reject ops with undefined entityId', async () => {
      const ops = [
        { seq: 1, op: { id: 'valid-op', entityId: 'task-1', entityType: 'TASK' } },
        { seq: 2, op: { id: 'corrupt-op', entityId: undefined, entityType: 'TASK' } },
      ] as any;
      mockOpLogStore.getUnsynced.and.resolveTo(ops);
      mockOpLogStore.markRejected.and.resolveTo(undefined);

      await service.cleanupCorruptOps();

      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['corrupt-op']);
    });

    it('should reject ops with null entityId', async () => {
      const ops = [
        { seq: 1, op: { id: 'corrupt-op', entityId: null, entityType: 'TASK' } },
      ] as any;
      mockOpLogStore.getUnsynced.and.resolveTo(ops);
      mockOpLogStore.markRejected.and.resolveTo(undefined);

      await service.cleanupCorruptOps();

      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['corrupt-op']);
    });

    it('should reject ops with non-string entityId', async () => {
      const ops = [
        { seq: 1, op: { id: 'corrupt-op', entityId: 123, entityType: 'TASK' } },
      ] as any;
      mockOpLogStore.getUnsynced.and.resolveTo(ops);
      mockOpLogStore.markRejected.and.resolveTo(undefined);

      await service.cleanupCorruptOps();

      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['corrupt-op']);
    });

    it('should not reject bulk ALL operations without entityId', async () => {
      const ops = [
        { seq: 1, op: { id: 'bulk-op', entityId: undefined, entityType: 'ALL' } },
        { seq: 2, op: { id: 'corrupt-op', entityId: undefined, entityType: 'TASK' } },
      ] as any;
      mockOpLogStore.getUnsynced.and.resolveTo(ops);
      mockOpLogStore.markRejected.and.resolveTo(undefined);

      await service.cleanupCorruptOps();

      // Only the TASK op should be rejected, not the ALL op
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['corrupt-op']);
    });

    it('should handle multiple corrupt ops', async () => {
      const ops = [
        { seq: 1, op: { id: 'corrupt1', entityId: undefined, entityType: 'TASK' } },
        { seq: 2, op: { id: 'valid', entityId: 'task-1', entityType: 'TASK' } },
        { seq: 3, op: { id: 'corrupt2', entityId: null, entityType: 'TAG' } },
      ] as any;
      mockOpLogStore.getUnsynced.and.resolveTo(ops);
      mockOpLogStore.markRejected.and.resolveTo(undefined);

      await service.cleanupCorruptOps();

      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['corrupt1', 'corrupt2']);
    });
  });
});
