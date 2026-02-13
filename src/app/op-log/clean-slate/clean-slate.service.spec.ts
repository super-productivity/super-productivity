import { TestBed } from '@angular/core/testing';
import { CleanSlateService } from './clean-slate.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { ClientIdService } from '../../core/util/client-id.service';
import { PreMigrationBackupService } from './pre-migration-backup.service';
import { Operation, OpType } from '../core/operation.types';
import { ActionType } from '../core/action-types.enum';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';

describe('CleanSlateService', () => {
  let service: CleanSlateService;
  let mockStateSnapshotService: jasmine.SpyObj<StateSnapshotService>;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockClientIdService: jasmine.SpyObj<ClientIdService>;
  let mockPreMigrationBackupService: jasmine.SpyObj<PreMigrationBackupService>;

  const mockState = {
    task: { ids: [], entities: {} },
    project: { ids: ['INBOX'], entities: {} },
    globalConfig: {},
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };

  beforeEach(() => {
    mockStateSnapshotService = jasmine.createSpyObj('StateSnapshotService', [
      'getStateSnapshotAsync',
    ]);
    mockOpLogStore = jasmine.createSpyObj('OperationLogStoreService', [
      'clearAllOperations',
      'append',
      'setVectorClock',
      'saveStateCache',
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
    mockClientIdService.generateNewClientId.and.resolveTo('eNewC');
    mockPreMigrationBackupService.createPreMigrationBackup.and.resolveTo();
    mockOpLogStore.clearAllOperations.and.resolveTo();
    mockOpLogStore.append.and.resolveTo(1);
    mockOpLogStore.setVectorClock.and.resolveTo();
    mockOpLogStore.saveStateCache.and.resolveTo();
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
