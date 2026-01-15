import { TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { MatDialog } from '@angular/material/dialog';
import { OperationLogMigrationService } from '../../persistence/operation-log-migration.service';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { LegacyPfDbService } from '../../../core/persistence/legacy-pf-db.service';
import { ClientIdService } from '../../../core/util/client-id.service';
import { ActionType, OpType } from '../../core/operation.types';
import { resetTestUuidCounter } from './helpers/test-client.helper';

/**
 * Integration tests for Operation Log Migration Service.
 *
 * NOTE: Legacy PFAPI migration was removed in the PFAPI elimination refactoring.
 * The migration service now only handles:
 * - Checking if a valid state snapshot exists
 * - Checking if a Genesis/Recovery operation exists
 * - Clearing orphan operations (ops captured before proper initialization)
 */
describe('Legacy Data Migration Integration', () => {
  let migrationService: OperationLogMigrationService;
  let opLogStore: OperationLogStoreService;
  let mockLegacyPfDb: jasmine.SpyObj<LegacyPfDbService>;
  let mockClientIdService: jasmine.SpyObj<ClientIdService>;
  let mockMatDialog: jasmine.SpyObj<MatDialog>;

  beforeEach(async () => {
    mockLegacyPfDb = jasmine.createSpyObj('LegacyPfDbService', [
      'hasUsableEntityData',
      'acquireMigrationLock',
      'releaseMigrationLock',
      'loadAllEntityData',
      'loadMetaModel',
      'loadClientId',
    ]);
    mockClientIdService = jasmine.createSpyObj('ClientIdService', [
      'generateNewClientId',
    ]);
    mockMatDialog = jasmine.createSpyObj('MatDialog', ['open']);

    // Default mocks - no legacy data by default
    mockLegacyPfDb.hasUsableEntityData.and.returnValue(Promise.resolve(false));

    TestBed.configureTestingModule({
      providers: [
        OperationLogMigrationService,
        OperationLogStoreService,
        provideMockStore(),
        { provide: LegacyPfDbService, useValue: mockLegacyPfDb },
        { provide: ClientIdService, useValue: mockClientIdService },
        { provide: MatDialog, useValue: mockMatDialog },
      ],
    });

    migrationService = TestBed.inject(OperationLogMigrationService);
    opLogStore = TestBed.inject(OperationLogStoreService);

    await opLogStore.init();
    await opLogStore._clearAllDataForTesting();
    resetTestUuidCounter();
  });

  afterEach(async () => {
    await opLogStore._clearAllDataForTesting();
  });

  describe('Snapshot Already Exists', () => {
    it('should skip if snapshot already exists', async () => {
      // Pre-create a snapshot
      await opLogStore.saveStateCache({
        state: { task: { ids: ['existing'] } },
        lastAppliedOpSeq: 5,
        vectorClock: { client1: 5 },
        compactedAt: Date.now(),
      });

      await migrationService.checkAndMigrate();

      // Should NOT create any operations
      const ops = await opLogStore.getOpsAfterSeq(0);
      expect(ops.length).toBe(0);
    });
  });

  describe('Genesis Operation Already Exists', () => {
    it('should skip if Genesis operation exists but no snapshot', async () => {
      // Pre-create a Genesis operation (simulating snapshot loss)
      await opLogStore.append({
        id: 'genesis-existing',
        actionType: '[Migration] Genesis Import' as ActionType,
        opType: OpType.Batch,
        entityType: 'MIGRATION',
        entityId: '*',
        payload: { task: { ids: ['old-data'] } },
        clientId: 'oldClient',
        vectorClock: { oldClient: 1 },
        timestamp: Date.now() - 100000,
        schemaVersion: 1,
      });

      await migrationService.checkAndMigrate();

      // Should still have only 1 operation (the existing genesis)
      const ops = await opLogStore.getOpsAfterSeq(0);
      expect(ops.length).toBe(1);
      expect(ops[0].op.id).toBe('genesis-existing');
    });

    it('should skip if Recovery operation exists', async () => {
      await opLogStore.append({
        id: 'recovery-existing',
        actionType: '[Recovery] Data Recovery' as ActionType,
        opType: OpType.Batch,
        entityType: 'RECOVERY',
        entityId: '*',
        payload: { task: { ids: ['recovered-data'] } },
        clientId: 'recoveryClient',
        vectorClock: { recoveryClient: 1 },
        timestamp: Date.now() - 100000,
        schemaVersion: 1,
      });

      await migrationService.checkAndMigrate();

      // Should NOT clear the operation
      const ops = await opLogStore.getOpsAfterSeq(0);
      expect(ops.length).toBe(1);
    });
  });

  describe('Orphan Operations Handling', () => {
    it('should clear orphan operations when legacy data exists', async () => {
      // Pre-create orphan operations (e.g., from effects that ran before migration)
      await opLogStore.append({
        id: 'orphan-op-1',
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Updated' },
        clientId: 'orphanClient',
        vectorClock: { orphanClient: 1 },
        timestamp: Date.now() - 50000,
        schemaVersion: 1,
      });

      // Legacy data exists - orphan ops should be cleared before migration
      mockLegacyPfDb.hasUsableEntityData.and.returnValue(Promise.resolve(true));
      // Lock acquisition fails - prevents migration from proceeding (test focuses on clearing)
      mockLegacyPfDb.acquireMigrationLock.and.returnValue(Promise.resolve(false));

      await migrationService.checkAndMigrate();

      // Should have cleared orphan ops
      const ops = await opLogStore.getOpsAfterSeq(0);
      expect(ops.length).toBe(0);
    });

    it('should NOT clear orphan operations when no legacy data exists (fresh install)', async () => {
      // Pre-create orphan operations
      await opLogStore.append({
        id: 'orphan-op-1',
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Updated' },
        clientId: 'orphanClient',
        vectorClock: { orphanClient: 1 },
        timestamp: Date.now() - 50000,
        schemaVersion: 1,
      });

      // No legacy data - orphan ops should be kept (fresh install scenario)
      mockLegacyPfDb.hasUsableEntityData.and.returnValue(Promise.resolve(false));

      await migrationService.checkAndMigrate();

      // Should NOT clear orphan ops - they will be replayed by hydrator
      const ops = await opLogStore.getOpsAfterSeq(0);
      expect(ops.length).toBe(1);
    });

    it('should not clear operations if first op is Genesis', async () => {
      // Pre-create a Genesis operation followed by normal operations
      await opLogStore.append({
        id: 'genesis-valid',
        actionType: '[Migration] Genesis Import' as ActionType,
        opType: OpType.Batch,
        entityType: 'MIGRATION',
        entityId: '*',
        payload: { task: { ids: ['t1'] } },
        clientId: 'client1',
        vectorClock: { client1: 1 },
        timestamp: Date.now() - 100000,
        schemaVersion: 1,
      });
      await opLogStore.append({
        id: 'normal-op',
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Updated' },
        clientId: 'client1',
        vectorClock: { client1: 2 },
        timestamp: Date.now() - 50000,
        schemaVersion: 1,
      });

      await migrationService.checkAndMigrate();

      // Should NOT clear any operations
      const ops = await opLogStore.getOpsAfterSeq(0);
      expect(ops.length).toBe(2);
      expect(ops[0].op.id).toBe('genesis-valid');
      expect(ops[1].op.id).toBe('normal-op');
    });
  });
});
