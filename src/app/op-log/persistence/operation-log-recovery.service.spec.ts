import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { OperationLogRecoveryService } from './operation-log-recovery.service';
import { OperationLogStoreService } from './operation-log-store.service';
import { LegacyPfDbService } from '../../core/persistence/legacy-pf-db.service';
import { ClientIdService } from '../../core/util/client-id.service';
import { ActionType, OpType } from '../core/operation.types';
import { ValidateStateService } from '../validation/validate-state.service';
import { LockService } from '../sync/lock.service';
import { LOCK_NAMES } from '../core/operation-log.const';

describe('OperationLogRecoveryService', () => {
  let service: OperationLogRecoveryService;
  let mockStore: jasmine.SpyObj<Store>;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockLegacyPfDb: jasmine.SpyObj<LegacyPfDbService>;
  let mockClientIdService: jasmine.SpyObj<ClientIdService>;
  let mockValidateStateService: jasmine.SpyObj<ValidateStateService>;
  let mockLockService: jasmine.SpyObj<LockService>;

  beforeEach(() => {
    mockStore = jasmine.createSpyObj('Store', ['dispatch']);
    mockOpLogStore = jasmine.createSpyObj('OperationLogStoreService', [
      'append',
      'appendRecoveryOperationAndSnapshot',
      'getLastSeq',
      'loadStateCache',
      'saveStateCache',
      'setVectorClock',
      'getPendingRemoteOps',
      'recoverLegacyTerminalRemoteFailures',
      'markRejected',
      'markFailed',
      'markApplied',
      'markReducersCommittedAndMergeClocks',
      'getUnsynced',
    ]);
    mockOpLogStore.setVectorClock.and.resolveTo(undefined);
    mockOpLogStore.getLastSeq.and.resolveTo(0);
    mockOpLogStore.loadStateCache.and.resolveTo(null);
    mockOpLogStore.recoverLegacyTerminalRemoteFailures.and.resolveTo(0);
    mockLegacyPfDb = jasmine.createSpyObj('LegacyPfDbService', [
      'hasUsableEntityData',
      'loadAllEntityData',
    ]);
    mockClientIdService = jasmine.createSpyObj('ClientIdService', ['loadClientId']);
    mockValidateStateService = jasmine.createSpyObj('ValidateStateService', [
      'validateState',
    ]);
    mockLockService = jasmine.createSpyObj('LockService', ['request']);
    mockLockService.request.and.callFake(async (_lockName, callback) => callback());
    mockValidateStateService.validateState.and.resolveTo({
      isValid: true,
      typiaErrors: [],
    });

    TestBed.configureTestingModule({
      providers: [
        OperationLogRecoveryService,
        { provide: Store, useValue: mockStore },
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        { provide: LegacyPfDbService, useValue: mockLegacyPfDb },
        { provide: ClientIdService, useValue: mockClientIdService },
        { provide: ValidateStateService, useValue: mockValidateStateService },
        { provide: LockService, useValue: mockLockService },
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
      mockOpLogStore.getLastSeq.and.returnValues(Promise.resolve(0), Promise.resolve(1));
      mockOpLogStore.saveStateCache.and.resolveTo(undefined);

      await service.attemptRecovery();

      expect(
        (
          mockOpLogStore as unknown as {
            appendRecoveryOperationAndSnapshot: jasmine.Spy;
          }
        ).appendRecoveryOperationAndSnapshot,
      ).toHaveBeenCalledWith(
        jasmine.objectContaining({
          actionType: ActionType.RECOVERY_DATA_IMPORT,
          opType: OpType.Batch,
          entityType: 'RECOVERY',
          payload: legacyData,
        }),
        legacyData,
      );
      expect(mockOpLogStore.append).not.toHaveBeenCalled();
      expect(mockOpLogStore.saveStateCache).not.toHaveBeenCalled();
      expect(mockOpLogStore.setVectorClock).not.toHaveBeenCalled();
      expect(mockStore.dispatch).toHaveBeenCalled();
      expect(mockLockService.request).toHaveBeenCalledWith(
        LOCK_NAMES.OPERATION_LOG,
        jasmine.any(Function),
      );
    });

    it('should not recover when no usable legacy data exists', async () => {
      mockLegacyPfDb.hasUsableEntityData.and.resolveTo(false);

      await service.attemptRecovery();

      expect(mockLegacyPfDb.loadAllEntityData).not.toHaveBeenCalled();
      expect(mockOpLogStore.append).not.toHaveBeenCalled();
      expect(mockStore.dispatch).not.toHaveBeenCalled();
    });

    it('should refuse recovery when a SUP_OPS snapshot exists', async () => {
      mockOpLogStore.loadStateCache.and.resolveTo({ state: {} } as any);

      await expectAsync(service.attemptRecovery()).toBeRejectedWithError(
        /Refusing legacy recovery.*snapshot/i,
      );

      expect(mockLegacyPfDb.hasUsableEntityData).not.toHaveBeenCalled();
      expect(mockOpLogStore.append).not.toHaveBeenCalled();
      expect(mockOpLogStore.saveStateCache).not.toHaveBeenCalled();
    });

    it('should refuse recovery when the SUP_OPS log is non-empty', async () => {
      mockOpLogStore.getLastSeq.and.resolveTo(3);

      await expectAsync(service.attemptRecovery()).toBeRejectedWithError(
        /Refusing legacy recovery.*operation log/i,
      );

      expect(mockLegacyPfDb.hasUsableEntityData).not.toHaveBeenCalled();
      expect(mockOpLogStore.append).not.toHaveBeenCalled();
      expect(mockOpLogStore.saveStateCache).not.toHaveBeenCalled();
    });

    it('should propagate SUP_OPS inspection errors without attempting writes', async () => {
      mockOpLogStore.loadStateCache.and.rejectWith(new Error('SUP_OPS unavailable'));

      await expectAsync(service.attemptRecovery()).toBeRejectedWithError(
        'SUP_OPS unavailable',
      );

      expect(mockLegacyPfDb.hasUsableEntityData).not.toHaveBeenCalled();
      expect(mockOpLogStore.append).not.toHaveBeenCalled();
      expect(mockOpLogStore.saveStateCache).not.toHaveBeenCalled();
    });

    it('should propagate legacy database access errors', async () => {
      mockLegacyPfDb.hasUsableEntityData.and.rejectWith(new Error('Database error'));

      await expectAsync(service.attemptRecovery()).toBeRejectedWithError(
        'Database error',
      );
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

      expect(mockOpLogStore.appendRecoveryOperationAndSnapshot).toHaveBeenCalledWith(
        jasmine.objectContaining({
          actionType: ActionType.RECOVERY_DATA_IMPORT,
          opType: OpType.Batch,
          entityType: 'RECOVERY',
          entityId: '*',
          payload: legacyData,
          clientId: 'testClient',
          vectorClock: { testClient: 1 },
        }),
        legacyData,
      );
    });

    it('should throw when clientId cannot be loaded', async () => {
      mockClientIdService.loadClientId.and.resolveTo(null);

      await expectAsync(service.recoverFromLegacyData({})).toBeRejectedWithError(
        /Failed to load clientId/,
      );
    });

    it('should pass recovered state to the atomic persistence boundary', async () => {
      const legacyData = { task: { ids: ['task1'] } };
      mockClientIdService.loadClientId.and.resolveTo('testClient');
      mockOpLogStore.append.and.resolveTo(undefined);
      mockOpLogStore.getLastSeq.and.resolveTo(5);
      mockOpLogStore.saveStateCache.and.resolveTo(undefined);

      await service.recoverFromLegacyData(legacyData);

      expect(mockOpLogStore.appendRecoveryOperationAndSnapshot).toHaveBeenCalledWith(
        jasmine.any(Object),
        legacyData,
      );
    });

    it('should include the recovery clock in the atomically persisted operation', async () => {
      const legacyData = { task: { ids: ['task1'] } };
      mockClientIdService.loadClientId.and.resolveTo('testClient');
      mockOpLogStore.append.and.resolveTo(undefined);
      mockOpLogStore.getLastSeq.and.resolveTo(1);
      mockOpLogStore.saveStateCache.and.resolveTo(undefined);

      await service.recoverFromLegacyData(legacyData);

      expect(mockOpLogStore.appendRecoveryOperationAndSnapshot).toHaveBeenCalledWith(
        jasmine.objectContaining({ vectorClock: { testClient: 1 } }),
        legacyData,
      );
    });

    it('should reject invalid legacy data before writing or dispatching it', async () => {
      mockValidateStateService.validateState.and.resolveTo({
        isValid: false,
        typiaErrors: [{ path: '$input.task', expected: 'TaskState' }],
      });

      await expectAsync(
        service.recoverFromLegacyData({ task: null }),
      ).toBeRejectedWithError(/Legacy recovery data validation failed/);

      expect(mockOpLogStore.append).not.toHaveBeenCalled();
      expect(mockOpLogStore.saveStateCache).not.toHaveBeenCalled();
      expect(mockOpLogStore.setVectorClock).not.toHaveBeenCalled();
      expect(mockStore.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('recoverPendingRemoteOps', () => {
    it('should do nothing when no pending ops exist', async () => {
      mockOpLogStore.getPendingRemoteOps.and.resolveTo([]);

      await service.recoverPendingRemoteOps();

      expect(mockOpLogStore.markReducersCommittedAndMergeClocks).not.toHaveBeenCalled();
      expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
      expect(mockOpLogStore.markFailed).not.toHaveBeenCalled();
    });

    it('should leave crash-interrupted ops pending until hydration replays their reducers', async () => {
      const now = Date.now();
      const pendingOps = [
        { seq: 1, op: { id: 'op1' }, appliedAt: now - 1000, source: 'remote' },
        { seq: 2, op: { id: 'op2' }, appliedAt: now - 2000, source: 'remote' },
      ] as any;
      mockOpLogStore.getPendingRemoteOps.and.resolveTo(pendingOps);
      const result = await service.recoverPendingRemoteOps();

      expect(result).toEqual(pendingOps);
      expect(mockOpLogStore.markReducersCommittedAndMergeClocks).not.toHaveBeenCalled();
      expect(mockOpLogStore.markApplied).not.toHaveBeenCalled();
    });

    it('should return every pending op regardless of age without changing status', async () => {
      const now = Date.now();
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      const pendingOps = [
        { seq: 1, op: { id: 'fresh' }, appliedAt: now - 1000, source: 'remote' },
        {
          seq: 2,
          op: { id: 'week-old' },
          appliedAt: now - weekMs,
          source: 'remote',
        },
      ] as any;
      mockOpLogStore.getPendingRemoteOps.and.resolveTo(pendingOps);
      const result = await service.recoverPendingRemoteOps();

      expect(result).toEqual(pendingOps);
      expect(mockOpLogStore.markReducersCommittedAndMergeClocks).not.toHaveBeenCalled();
      expect(mockOpLogStore.markFailed).not.toHaveBeenCalled();
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
