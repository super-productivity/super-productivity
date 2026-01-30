import { TestBed } from '@angular/core/testing';
import { CleanSlateService } from './clean-slate.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { VectorClockService } from '../sync/vector-clock.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { ClientIdService } from '../../core/util/client-id.service';
import { PreMigrationBackupService } from './pre-migration-backup.service';
import { Operation, OpType } from '../core/operation.types';
import { ActionType } from '../core/action-types.enum';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';

describe('CleanSlateService', () => {
  let service: CleanSlateService;
  let mockStateSnapshotService: jasmine.SpyObj<StateSnapshotService>;
  let mockVectorClockService: jasmine.SpyObj<VectorClockService>;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockClientIdService: jasmine.SpyObj<ClientIdService>;
  let mockPreMigrationBackupService: jasmine.SpyObj<PreMigrationBackupService>;

  const mockState = {
    task: { ids: [], entities: {} },
    project: { ids: ['INBOX'], entities: {} },
    globalConfig: {},
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };

  const mockVectorClock = { oldClient1: 5, oldClient2: 3 };

  beforeEach(() => {
    mockStateSnapshotService = jasmine.createSpyObj('StateSnapshotService', [
      'getStateSnapshotAsync',
    ]);
    mockVectorClockService = jasmine.createSpyObj('VectorClockService', [
      'getCurrentVectorClock',
    ]);
    mockOpLogStore = jasmine.createSpyObj('OperationLogStoreService', [
      'clearAllOperations',
      'append',
      'setVectorClock',
      'saveStateCache',
      'setProtectedClientIds',
    ]);
    mockClientIdService = jasmine.createSpyObj('ClientIdService', [
      'generateNewClientId',
    ]);
    mockPreMigrationBackupService = jasmine.createSpyObj('PreMigrationBackupService', [
      'createPreMigrationBackup',
    ]);

    TestBed.configureTestingModule({
      providers: [
        CleanSlateService,
        { provide: StateSnapshotService, useValue: mockStateSnapshotService },
        { provide: VectorClockService, useValue: mockVectorClockService },
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        { provide: ClientIdService, useValue: mockClientIdService },
        {
          provide: PreMigrationBackupService,
          useValue: mockPreMigrationBackupService,
        },
      ],
    });

    service = TestBed.inject(CleanSlateService);

    // Setup default mock responses
    mockStateSnapshotService.getStateSnapshotAsync.and.resolveTo(mockState as any);
    mockVectorClockService.getCurrentVectorClock.and.resolveTo(mockVectorClock);
    mockClientIdService.generateNewClientId.and.resolveTo('eNewC');
    mockPreMigrationBackupService.createPreMigrationBackup.and.resolveTo();
    mockOpLogStore.clearAllOperations.and.resolveTo();
    mockOpLogStore.append.and.resolveTo(1);
    mockOpLogStore.setVectorClock.and.resolveTo();
    mockOpLogStore.saveStateCache.and.resolveTo();
    mockOpLogStore.setProtectedClientIds.and.resolveTo();
  });

  describe('createCleanSlate', () => {
    it('should create a clean slate successfully', async () => {
      await service.createCleanSlate('ENCRYPTION_CHANGE');

      // Should create pre-migration backup
      expect(mockPreMigrationBackupService.createPreMigrationBackup).toHaveBeenCalledWith(
        'ENCRYPTION_CHANGE',
      );

      // Should get current state (async version to include archives)
      expect(mockStateSnapshotService.getStateSnapshotAsync).toHaveBeenCalled();

      // Should generate new client ID
      expect(mockClientIdService.generateNewClientId).toHaveBeenCalled();

      // Should clear all operations
      expect(mockOpLogStore.clearAllOperations).toHaveBeenCalled();

      // Should append SYNC_IMPORT operation
      expect(mockOpLogStore.append).toHaveBeenCalled();
      const appendedOp = mockOpLogStore.append.calls.mostRecent().args[0] as Operation;
      expect(appendedOp.actionType).toBe(ActionType.LOAD_ALL_DATA);
      expect(appendedOp.opType).toBe(OpType.SyncImport);
      expect(appendedOp.entityType).toBe('ALL');
      expect(appendedOp.payload).toBe(mockState);
      expect(appendedOp.clientId).toBe('eNewC');
      expect(appendedOp.vectorClock).toEqual({ eNewC: 1 });
      expect(appendedOp.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);

      // Should update vector clock
      expect(mockOpLogStore.setVectorClock).toHaveBeenCalledWith({ eNewC: 1 });

      // Should save snapshot
      expect(mockOpLogStore.saveStateCache).toHaveBeenCalledWith({
        state: mockState,
        lastAppliedOpSeq: 0,
        vectorClock: { eNewC: 1 },
        compactedAt: jasmine.any(Number),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });
    });

    it('should work with different reasons', async () => {
      await service.createCleanSlate('FULL_IMPORT');

      expect(mockPreMigrationBackupService.createPreMigrationBackup).toHaveBeenCalledWith(
        'FULL_IMPORT',
      );
    });

    it('should work with MANUAL reason', async () => {
      await service.createCleanSlate('MANUAL');

      expect(mockPreMigrationBackupService.createPreMigrationBackup).toHaveBeenCalledWith(
        'MANUAL',
      );
    });

    it('should continue if pre-migration backup fails', async () => {
      mockPreMigrationBackupService.createPreMigrationBackup.and.rejectWith(
        new Error('Backup failed'),
      );

      // Should not throw - backup failure is non-fatal
      await expectAsync(service.createCleanSlate('ENCRYPTION_CHANGE')).toBeResolved();

      // Should still complete the clean slate
      expect(mockOpLogStore.clearAllOperations).toHaveBeenCalled();
      expect(mockOpLogStore.append).toHaveBeenCalled();
    });

    it('should generate fresh vector clock starting at 1', async () => {
      await service.createCleanSlate('ENCRYPTION_CHANGE');

      const appendedOp = mockOpLogStore.append.calls.mostRecent().args[0] as Operation;
      expect(appendedOp.vectorClock).toEqual({ eNewC: 1 });
    });

    it('should create operation with valid UUIDv7', async () => {
      await service.createCleanSlate('ENCRYPTION_CHANGE');

      const appendedOp = mockOpLogStore.append.calls.mostRecent().args[0] as Operation;
      // UUIDv7 format: 8-4-4-4-12 characters
      expect(appendedOp.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('should throw if state snapshot fails', async () => {
      mockStateSnapshotService.getStateSnapshotAsync.and.rejectWith(
        new Error('State error'),
      );

      await expectAsync(service.createCleanSlate('ENCRYPTION_CHANGE')).toBeRejectedWith(
        jasmine.objectContaining({ message: 'State error' }),
      );
    });

    it('should throw if client ID generation fails', async () => {
      mockClientIdService.generateNewClientId.and.rejectWith(new Error('ClientID error'));

      await expectAsync(service.createCleanSlate('ENCRYPTION_CHANGE')).toBeRejectedWith(
        jasmine.objectContaining({ message: 'ClientID error' }),
      );
    });

    it('should throw if operation append fails', async () => {
      mockOpLogStore.append.and.rejectWith(new Error('Append error'));

      await expectAsync(service.createCleanSlate('ENCRYPTION_CHANGE')).toBeRejectedWith(
        jasmine.objectContaining({ message: 'Append error' }),
      );
    });
  });

  describe('createCleanSlateFromImport', () => {
    const importedState = {
      task: { ids: ['task1'], entities: {} },
      project: { ids: ['project1'], entities: {} },
      globalConfig: {},
    };

    it('should create clean slate from imported state', async () => {
      await service.createCleanSlateFromImport(importedState, 'FULL_IMPORT');

      // Should create pre-migration backup
      expect(mockPreMigrationBackupService.createPreMigrationBackup).toHaveBeenCalledWith(
        'FULL_IMPORT',
      );

      // Should NOT call getStateSnapshotAsync (uses imported state instead)
      expect(mockStateSnapshotService.getStateSnapshotAsync).not.toHaveBeenCalled();

      // Should generate new client ID
      expect(mockClientIdService.generateNewClientId).toHaveBeenCalled();

      // Should clear operations
      expect(mockOpLogStore.clearAllOperations).toHaveBeenCalled();

      // Should append SYNC_IMPORT with imported state
      const appendedOp = mockOpLogStore.append.calls.mostRecent().args[0] as Operation;
      expect(appendedOp.payload).toBe(importedState);
      expect(appendedOp.opType).toBe(OpType.SyncImport);
    });

    it('should increment existing vector clock', async () => {
      await service.createCleanSlateFromImport(importedState, 'FULL_IMPORT');

      const appendedOp = mockOpLogStore.append.calls.mostRecent().args[0] as Operation;
      // Should increment clock for new client (oldClient1: 5 → eNewC gets incremented value)
      expect(appendedOp.vectorClock.eNewC).toBeGreaterThan(0);
    });

    it('should save snapshot with imported state', async () => {
      await service.createCleanSlateFromImport(importedState, 'FULL_IMPORT');

      expect(mockOpLogStore.saveStateCache).toHaveBeenCalledWith(
        jasmine.objectContaining({
          state: importedState,
          lastAppliedOpSeq: 0,
        }),
      );
    });

    it('should call setProtectedClientIds with all vector clock keys from SYNC_IMPORT', async () => {
      // BUG FIX: After creating a SYNC_IMPORT locally, we must protect all vector clock keys.
      // Without this, when new ops are created, limitVectorClockSize() would prune low-counter
      // entries, causing those ops to appear CONCURRENT with the import instead of GREATER_THAN.
      // This leads to the bug where other clients filter out legitimate ops.

      // Setup: vector clock has multiple clients
      const multiClientClock = {
        oldClient1: 5,
        oldClient2: 3,
        oldClient3: 10,
        oldClient4: 1,
      };
      mockVectorClockService.getCurrentVectorClock.and.resolveTo(multiClientClock);

      await service.createCleanSlateFromImport(importedState, 'FULL_IMPORT');

      expect(mockOpLogStore.setProtectedClientIds).toHaveBeenCalled();

      // The protected IDs should include ALL keys from the SYNC_IMPORT's vector clock
      // The new clock will be: { ...multiClientClock, eNewC: increment }
      const protectedIds = mockOpLogStore.setProtectedClientIds.calls.mostRecent()
        .args[0] as string[];

      // Should contain the new client ID
      expect(protectedIds).toContain('eNewC');
      // Should contain all the old client IDs from the merged clock
      expect(protectedIds).toContain('oldClient1');
      expect(protectedIds).toContain('oldClient2');
      expect(protectedIds).toContain('oldClient3');
      expect(protectedIds).toContain('oldClient4');
    });

    it('should set protected client IDs after setting vector clock', async () => {
      const callOrder: string[] = [];
      mockOpLogStore.setVectorClock.and.callFake(async () => {
        callOrder.push('setVectorClock');
      });
      mockOpLogStore.setProtectedClientIds.and.callFake(async () => {
        callOrder.push('setProtectedClientIds');
      });

      await service.createCleanSlateFromImport(importedState, 'FULL_IMPORT');

      // setProtectedClientIds must be called after setVectorClock
      expect(callOrder).toEqual(['setVectorClock', 'setProtectedClientIds']);
    });

    it('should continue if pre-migration backup fails', async () => {
      mockPreMigrationBackupService.createPreMigrationBackup.and.rejectWith(
        new Error('Backup failed'),
      );

      await expectAsync(
        service.createCleanSlateFromImport(importedState, 'FULL_IMPORT'),
      ).toBeResolved();

      expect(mockOpLogStore.append).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should propagate clearAllOperations errors', async () => {
      mockOpLogStore.clearAllOperations.and.rejectWith(new Error('Clear failed'));

      await expectAsync(service.createCleanSlate('ENCRYPTION_CHANGE')).toBeRejectedWith(
        jasmine.objectContaining({ message: 'Clear failed' }),
      );
    });

    it('should propagate setVectorClock errors', async () => {
      mockOpLogStore.setVectorClock.and.rejectWith(new Error('VectorClock failed'));

      await expectAsync(service.createCleanSlate('ENCRYPTION_CHANGE')).toBeRejectedWith(
        jasmine.objectContaining({ message: 'VectorClock failed' }),
      );
    });

    it('should propagate saveStateCache errors', async () => {
      mockOpLogStore.saveStateCache.and.rejectWith(new Error('SaveCache failed'));

      await expectAsync(service.createCleanSlate('ENCRYPTION_CHANGE')).toBeRejectedWith(
        jasmine.objectContaining({ message: 'SaveCache failed' }),
      );
    });
  });

  describe('operation ordering', () => {
    it('should clear operations before appending new SYNC_IMPORT', async () => {
      const callOrder: string[] = [];
      mockOpLogStore.clearAllOperations.and.callFake(async () => {
        callOrder.push('clear');
      });
      mockOpLogStore.append.and.callFake(async () => {
        callOrder.push('append');
        return 1;
      });

      await service.createCleanSlate('ENCRYPTION_CHANGE');

      expect(callOrder).toEqual(['clear', 'append']);
    });

    it('should append operation before updating vector clock', async () => {
      const callOrder: string[] = [];
      mockOpLogStore.append.and.callFake(async () => {
        callOrder.push('append');
        return 1;
      });
      mockOpLogStore.setVectorClock.and.callFake(async () => {
        callOrder.push('setVectorClock');
      });

      await service.createCleanSlate('ENCRYPTION_CHANGE');

      expect(callOrder).toEqual(['append', 'setVectorClock']);
    });
  });
});
