import { TestBed } from '@angular/core/testing';
import { RemoteOpsProcessingService } from '../../sync/remote-ops-processing.service';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import {
  SchemaMigrationService,
  MAX_VERSION_SKIP,
} from '../../persistence/schema-migration.service';
import { SnackService } from '../../../core/snack/snack.service';
import { VectorClockService } from '../../sync/vector-clock.service';
import { OperationApplierService } from '../../apply/operation-applier.service';
import { ConflictResolutionService } from '../../sync/conflict-resolution.service';
import { ValidateStateService } from '../../validation/validate-state.service';
import { provideMockStore } from '@ngrx/store/testing';
import { ActionType, Operation, OpType } from '../../core/operation.types';
import { T } from '../../../t.const';
import { resetTestUuidCounter } from './helpers/test-client.helper';
import { LockService } from '../../sync/lock.service';
import { OperationLogCompactionService } from '../../persistence/operation-log-compaction.service';
import { SyncImportFilterService } from '../../sync/sync-import-filter.service';
import { CURRENT_SCHEMA_VERSION } from '@sp/shared-schema';

/**
 * Integration tests for Schema Migration Handling in Sync.
 *
 * Verifies that RemoteOpsProcessingService correctly integrates with
 * SchemaMigrationService to handle version mismatches during sync.
 */
describe('Migration Handling Integration', () => {
  let service: RemoteOpsProcessingService;
  let snackServiceSpy: jasmine.SpyObj<SnackService>;
  let opLogStore: OperationLogStoreService;
  let operationApplierSpy: jasmine.SpyObj<OperationApplierService>;

  beforeEach(async () => {
    snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);
    operationApplierSpy = jasmine.createSpyObj('OperationApplierService', [
      'applyOperations',
    ]);
    operationApplierSpy.applyOperations.and.returnValue(
      Promise.resolve({ appliedOps: [] }),
    );

    TestBed.configureTestingModule({
      providers: [
        RemoteOpsProcessingService,
        OperationLogStoreService,
        VectorClockService,
        SchemaMigrationService, // Use REAL service
        provideMockStore(),
        { provide: SnackService, useValue: snackServiceSpy },
        { provide: OperationApplierService, useValue: operationApplierSpy },
        {
          provide: ConflictResolutionService,
          useFactory: () => {
            const spy = jasmine.createSpyObj('ConflictResolutionService', [
              'autoResolveConflictsLWW',
              'checkOpForConflicts',
            ]);
            spy.checkOpForConflicts.and.resolveTo({
              isSupersededOrDuplicate: false,
              conflict: null,
            });
            return spy;
          },
        },
        {
          provide: ValidateStateService,
          useValue: jasmine.createSpyObj('ValidateStateService', [
            'validateAndRepairCurrentState',
          ]),
        },
        {
          provide: LockService,
          useValue: {
            request: async (_name: string, fn: () => Promise<void>) => fn(),
          },
        },
        {
          provide: OperationLogCompactionService,
          useFactory: () => {
            const spy = jasmine.createSpyObj('OperationLogCompactionService', [
              'compact',
            ]);
            spy.compact.and.returnValue(Promise.resolve());
            return spy;
          },
        },
        {
          provide: SyncImportFilterService,
          useValue: {
            filterOpsInvalidatedBySyncImport: async (ops: Operation[]) => ({
              validOps: ops,
              invalidatedOps: [],
            }),
          },
        },
      ],
    });

    service = TestBed.inject(RemoteOpsProcessingService);
    opLogStore = TestBed.inject(OperationLogStoreService);

    await opLogStore.init();
    await opLogStore._clearAllDataForTesting();
    resetTestUuidCounter();
  });

  describe('Incoming Remote Operations', () => {
    const createOp = (version: number): Operation => ({
      id: `op-v${version}`,
      clientId: 'remoteClientId',
      actionType: '[Test] Action' as ActionType,
      opType: OpType.Update,
      entityType: 'TASK',
      entityId: 'task-1',
      payload: {},
      vectorClock: { remoteClientId: 1 },
      timestamp: Date.now(),
      schemaVersion: version,
    });

    it('should accept operation with current schema version', async () => {
      const currentVersion = 1; // Assuming CURRENT_SCHEMA_VERSION is 1
      const op = createOp(currentVersion);

      await service.processRemoteOps([op]);

      // Should be applied (no error snackbar)
      expect(snackServiceSpy.open).not.toHaveBeenCalled();
      expect(operationApplierSpy.applyOperations).toHaveBeenCalledWith([
        jasmine.objectContaining({ id: op.id }),
      ]);
    });

    it('should accept operation with compatible future version (within skip limit)', async () => {
      // Logic: if opVersion <= current + MAX_VERSION_SKIP, it's accepted
      // MAX_VERSION_SKIP is 3. So version 4 should be accepted if current is 1.
      // Note: A WARNING snackbar may be shown for newer versions, but no ERROR.
      const compatibleVersion = 1 + MAX_VERSION_SKIP;
      const op = createOp(compatibleVersion);

      await service.processRemoteOps([op]);

      // Should NOT show error (operation is accepted)
      expect(snackServiceSpy.open).not.toHaveBeenCalledWith(
        jasmine.objectContaining({ type: 'ERROR' }),
      );
      expect(operationApplierSpy.applyOperations).toHaveBeenCalled();
    });

    it('should reject operation with incompatible future version', async () => {
      // Logic: if opVersion > current + MAX_VERSION_SKIP, update required
      const incompatibleVersion = CURRENT_SCHEMA_VERSION + MAX_VERSION_SKIP + 1;
      const op = createOp(incompatibleVersion);

      await service.processRemoteOps([op]);

      // Should trigger error snackbar
      expect(snackServiceSpy.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          msg: T.F.SYNC.S.VERSION_TOO_OLD,
        }),
      );

      // Should NOT apply operation
      expect(operationApplierSpy.applyOperations).not.toHaveBeenCalled();
    });

    it('should handle operations missing schemaVersion (default to 1)', async () => {
      const op = createOp(1);
      delete (op as any).schemaVersion; // Simulate legacy op

      await service.processRemoteOps([op]);

      expect(snackServiceSpy.open).not.toHaveBeenCalled();
      expect(operationApplierSpy.applyOperations).toHaveBeenCalledWith([
        jasmine.objectContaining({ id: op.id }),
      ]);
    });
  });

  describe('Application Failures', () => {
    const createOp = (id: string): Operation => ({
      id,
      clientId: 'remoteClientId',
      actionType: '[Test] Action' as ActionType,
      opType: OpType.Update,
      entityType: 'TASK',
      entityId: 'task-1',
      payload: {},
      vectorClock: { remoteClientId: 1 },
      timestamp: Date.now(),
      schemaVersion: 1,
    });

    it('should mark operations as failed if application returns failure result', async () => {
      const op = createOp('op-fail');

      // Make applier return failure result (new behavior with partial success support)
      operationApplierSpy.applyOperations.and.resolveTo({
        appliedOps: [],
        failedOp: {
          op,
          error: new Error('Simulated Apply Error'),
        },
      });

      // Spy on store to verify markFailed is called
      spyOn(opLogStore, 'markFailed').and.callThrough();

      try {
        await service.processRemoteOps([op]);
        fail('Should have thrown error');
      } catch (e) {
        expect((e as Error).message).toBe('Simulated Apply Error');
      }

      // Verify markFailed was called
      expect(opLogStore.markFailed).toHaveBeenCalledWith(['op-fail']);

      // Verify op status in store
      const ops = await opLogStore.getOpsAfterSeq(0);
      const storedOp = ops.find((e) => e.op.id === 'op-fail');
      expect(storedOp).toBeDefined();
      expect(storedOp!.applicationStatus).toBe('failed');
    });
  });
});
