import { TestBed } from '@angular/core/testing';
import { CleanSlateService } from './clean-slate.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { ClientIdService } from '../../core/util/client-id.service';
import { PreMigrationBackupService } from './pre-migration-backup.service';
import { OpType, OperationLogEntry } from '../core/operation.types';
import { ActionType } from '../core/action-types.enum';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';
import { OpLog } from '../../core/log';

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
      'runDestructiveStateReplacement',
      'getVectorClock',
      'getUnsynced',
    ]);
    mockClientIdService = jasmine.createSpyObj('ClientIdService', [
      'generateNewClientId',
      'loadClientId',
      'persistClientId',
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
    mockClientIdService.loadClientId.and.resolveTo('ePrior');
    mockClientIdService.generateNewClientId.and.resolveTo('eNewC');
    mockClientIdService.persistClientId.and.resolveTo();
    mockPreMigrationBackupService.createPreMigrationBackup.and.resolveTo();
    mockOpLogStore.runDestructiveStateReplacement.and.resolveTo();
    mockOpLogStore.getVectorClock.and.resolveTo(null);
    mockOpLogStore.getUnsynced.and.resolveTo([]);
  });

  describe('createCleanSlate', () => {
    it('should create a clean slate successfully', async () => {
      await service.createCleanSlate('ENCRYPTION_CHANGE', 'PASSWORD_CHANGED');

      // Should create pre-migration backup
      expect(mockPreMigrationBackupService.createPreMigrationBackup).toHaveBeenCalledWith(
        'ENCRYPTION_CHANGE',
      );

      // Should get current state (async version to include archives)
      expect(mockStateSnapshotService.getStateSnapshotAsync).toHaveBeenCalled();

      // Should generate new client ID
      expect(mockClientIdService.generateNewClientId).toHaveBeenCalled();

      // Should route through the atomic helper (issue #7709)
      expect(mockOpLogStore.runDestructiveStateReplacement).toHaveBeenCalledTimes(1);
      const args = mockOpLogStore.runDestructiveStateReplacement.calls.mostRecent()
        .args[0] as Parameters<typeof mockOpLogStore.runDestructiveStateReplacement>[0];

      const appendedOp = args.syncImportOp;
      expect(appendedOp.actionType).toBe(ActionType.LOAD_ALL_DATA);
      expect(appendedOp.opType).toBe(OpType.SyncImport);
      expect(appendedOp.entityType).toBe('ALL');
      expect(appendedOp.payload).toBe(mockState);
      expect(appendedOp.clientId).toBe('eNewC');
      expect(appendedOp.vectorClock).toEqual({ eNewC: 1 });
      expect(appendedOp.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);

      expect(args.newVectorClock).toEqual({ eNewC: 1 });
      expect(args.newState).toBe(mockState);
      expect(args.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });

    it('should log diagnostic snapshot of prior clock and unsynced ops before mutation', async () => {
      const opLogSpy = spyOn(OpLog, 'normal');
      mockOpLogStore.getVectorClock.and.resolveTo({
        ['B_old']: 42,
        ['B_other']: 7,
      });
      mockOpLogStore.getUnsynced.and.resolveTo([
        {
          seq: 1,
          op: { opType: OpType.Create, id: 'a' } as any,
          appliedAt: 0,
        },
        {
          seq: 2,
          op: { opType: OpType.Create, id: 'b' } as any,
          appliedAt: 0,
        },
        {
          seq: 3,
          op: { opType: OpType.Update, id: 'c' } as any,
          appliedAt: 0,
        },
      ] as OperationLogEntry[]);

      await service.createCleanSlate('ENCRYPTION_CHANGE', 'PASSWORD_CHANGED');

      expect(opLogSpy).toHaveBeenCalledWith(
        '[CleanSlate] Starting clean slate process',
        jasmine.objectContaining({
          reason: 'ENCRYPTION_CHANGE',
          syncImportReason: 'PASSWORD_CHANGED',
          priorUnsyncedCount: 3,
          priorUnsyncedByOpType: jasmine.objectContaining({
            [OpType.Create]: 2,
            [OpType.Update]: 1,
          }),
          priorClockSize: 2,
          priorClock: { ['B_old']: 42, ['B_other']: 7 },
        }),
      );
      // Order invariant: diagnostic snapshot reads must precede the
      // destructive atomic replacement.
      expect(mockOpLogStore.getVectorClock).toHaveBeenCalledBefore(
        mockOpLogStore.runDestructiveStateReplacement,
      );
      expect(mockOpLogStore.getUnsynced).toHaveBeenCalledBefore(
        mockOpLogStore.runDestructiveStateReplacement,
      );
    });

    it('should work with MANUAL reason', async () => {
      await service.createCleanSlate('MANUAL', 'PASSWORD_CHANGED');

      expect(mockPreMigrationBackupService.createPreMigrationBackup).toHaveBeenCalledWith(
        'MANUAL',
      );
    });

    it('should continue if pre-migration backup fails', async () => {
      mockPreMigrationBackupService.createPreMigrationBackup.and.rejectWith(
        new Error('Backup failed'),
      );

      // Should not throw - backup failure is non-fatal
      await expectAsync(
        service.createCleanSlate('ENCRYPTION_CHANGE', 'PASSWORD_CHANGED'),
      ).toBeResolved();

      // Should still complete the destructive replacement
      expect(mockOpLogStore.runDestructiveStateReplacement).toHaveBeenCalledTimes(1);
    });

    it('should generate fresh vector clock starting at 1', async () => {
      await service.createCleanSlate('ENCRYPTION_CHANGE', 'PASSWORD_CHANGED');

      const args = mockOpLogStore.runDestructiveStateReplacement.calls.mostRecent()
        .args[0] as Parameters<typeof mockOpLogStore.runDestructiveStateReplacement>[0];
      expect(args.syncImportOp.vectorClock).toEqual({ eNewC: 1 });
      expect(args.newVectorClock).toEqual({ eNewC: 1 });
    });

    it('should create operation with valid UUIDv7', async () => {
      await service.createCleanSlate('ENCRYPTION_CHANGE', 'PASSWORD_CHANGED');

      const args = mockOpLogStore.runDestructiveStateReplacement.calls.mostRecent()
        .args[0] as Parameters<typeof mockOpLogStore.runDestructiveStateReplacement>[0];
      // UUIDv7 format: 8-4-4-4-12 characters
      expect(args.syncImportOp.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('should throw if state snapshot fails', async () => {
      mockStateSnapshotService.getStateSnapshotAsync.and.rejectWith(
        new Error('State error'),
      );

      await expectAsync(
        service.createCleanSlate('ENCRYPTION_CHANGE', 'PASSWORD_CHANGED'),
      ).toBeRejectedWith(jasmine.objectContaining({ message: 'State error' }));
    });

    it('should throw if client ID generation fails', async () => {
      mockClientIdService.generateNewClientId.and.rejectWith(new Error('ClientID error'));

      await expectAsync(
        service.createCleanSlate('ENCRYPTION_CHANGE', 'PASSWORD_CHANGED'),
      ).toBeRejectedWith(jasmine.objectContaining({ message: 'ClientID error' }));
    });

    it('should propagate errors from runDestructiveStateReplacement', async () => {
      // Atomicity is guaranteed by the helper itself (see
      // clean-slate-interrupt.integration.spec.ts). Here we only verify that
      // CleanSlateService surfaces the helper's failure to its caller.
      mockOpLogStore.runDestructiveStateReplacement.and.rejectWith(
        new Error('Atomic replacement failed'),
      );

      await expectAsync(
        service.createCleanSlate('ENCRYPTION_CHANGE', 'PASSWORD_CHANGED'),
      ).toBeRejectedWith(
        jasmine.objectContaining({ message: 'Atomic replacement failed' }),
      );
    });

    it('should roll back the rotated clientId if the destructive replacement fails', async () => {
      // The clientId lives in a separate IndexedDB database (`pf`) that
      // cannot share the atomic SUP_OPS transaction. Without rollback, a
      // failed clean-slate leaves `pf` with the NEW clientId while OPS /
      // vector_clock still reference the OLD one — a state-divergence
      // scenario that breaks vector-clock continuity on the next sync.
      mockClientIdService.loadClientId.and.resolveTo('ePrior');
      mockOpLogStore.runDestructiveStateReplacement.and.rejectWith(
        new Error('Atomic replacement failed'),
      );

      await expectAsync(
        service.createCleanSlate('ENCRYPTION_CHANGE', 'PASSWORD_CHANGED'),
      ).toBeRejected();

      expect(mockClientIdService.persistClientId).toHaveBeenCalledWith('ePrior');
    });

    it('should not attempt rollback when there was no prior clientId', async () => {
      // Wholly fresh device — no prior clientId to restore.
      mockClientIdService.loadClientId.and.resolveTo(null);
      mockOpLogStore.runDestructiveStateReplacement.and.rejectWith(
        new Error('Atomic replacement failed'),
      );

      await expectAsync(
        service.createCleanSlate('ENCRYPTION_CHANGE', 'PASSWORD_CHANGED'),
      ).toBeRejected();

      expect(mockClientIdService.persistClientId).not.toHaveBeenCalled();
    });

    it('should surface the original destructive failure when the clientId rollback also fails', async () => {
      // If the rollback persistClientId throws, we must still propagate the
      // ORIGINAL destructive failure to the caller — not the rollback error.
      // The rollback failure is logged at critical level for forensics.
      const criticalSpy = spyOn(OpLog, 'critical');
      mockClientIdService.loadClientId.and.resolveTo('ePrior');
      mockOpLogStore.runDestructiveStateReplacement.and.rejectWith(
        new Error('Atomic replacement failed'),
      );
      mockClientIdService.persistClientId.and.rejectWith(
        new Error('pf write also broken'),
      );

      await expectAsync(
        service.createCleanSlate('ENCRYPTION_CHANGE', 'PASSWORD_CHANGED'),
      ).toBeRejectedWith(
        jasmine.objectContaining({ message: 'Atomic replacement failed' }),
      );

      expect(criticalSpy).toHaveBeenCalledWith(
        jasmine.stringMatching(/[Ff]ailed to roll back clientId/),
        jasmine.objectContaining({ priorClientId: 'ePrior' }),
      );
    });

    it('should pass snapshotEntityKeys derived from current state', async () => {
      // Without snapshotEntityKeys, the persisted state_cache singleton looks
      // like the "old snapshot format" to remote-ops-processing, which
      // triggers an unnecessary background recompaction after every
      // clean-slate. Callers must pass it.
      await service.createCleanSlate('ENCRYPTION_CHANGE', 'PASSWORD_CHANGED');

      const args = mockOpLogStore.runDestructiveStateReplacement.calls.mostRecent()
        .args[0] as Parameters<typeof mockOpLogStore.runDestructiveStateReplacement>[0];
      expect(args.snapshotEntityKeys).toBeDefined();
      expect(Array.isArray(args.snapshotEntityKeys)).toBe(true);
    });
  });
});
