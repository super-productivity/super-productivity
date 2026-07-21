import { TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { OperationLogMigrationService } from '../../persistence/operation-log-migration.service';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { LegacyPfDbService } from '../../../core/persistence/legacy-pf-db.service';
import { ClientIdService } from '../../../core/util/client-id.service';
import { LanguageService } from '../../../core/language/language.service';
import { ActionType, Operation, OpType } from '../../core/operation.types';
import { resetTestUuidCounter } from './helpers/test-client.helper';
import { createValidAppData } from '../../validation/state-validity-test-utils';
import { CURRENT_SCHEMA_VERSION } from '../../persistence/schema-migration.service';
import { LanguageCode } from '../../../core/locale.constants';

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
  let mockTranslateService: jasmine.SpyObj<TranslateService>;
  let mockLanguageService: jasmine.SpyObj<LanguageService>;

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
      'loadClientId',
      'getOrGenerateClientId',
      'persistClientId',
      'clearCache',
    ]);
    mockMatDialog = jasmine.createSpyObj('MatDialog', ['open']);
    mockTranslateService = jasmine.createSpyObj('TranslateService', [
      'instant',
      'getBrowserCultureLang',
      'getBrowserLang',
      'use',
    ]);
    mockLanguageService = jasmine.createSpyObj('LanguageService', ['setLng', 'detect']);

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
        { provide: TranslateService, useValue: mockTranslateService },
        { provide: LanguageService, useValue: mockLanguageService },
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

  describe('Successful migration persistence', () => {
    it('replays a second-tab append after restart without regressing its clock', async () => {
      const legacyClientId = 'legacyClient';
      const legacyData = createValidAppData();
      mockLegacyPfDb.hasUsableEntityData.and.resolveTo(true);
      mockLegacyPfDb.acquireMigrationLock.and.resolveTo(true);
      mockLegacyPfDb.releaseMigrationLock.and.resolveTo();
      mockLegacyPfDb.loadAllEntityData.and.resolveTo(legacyData);
      mockLegacyPfDb.loadMetaModel.and.resolveTo({
        vectorClock: { [legacyClientId]: 5 },
      });
      mockLegacyPfDb.loadClientId.and.resolveTo(legacyClientId);
      mockClientIdService.loadClientId.and.resolveTo(legacyClientId);
      mockClientIdService.getOrGenerateClientId.and.resolveTo(legacyClientId);
      mockClientIdService.persistClientId.and.resolveTo();
      mockTranslateService.use.and.returnValue(of({}));
      mockLanguageService.detect.and.returnValue(LanguageCode.en);

      const dialogRef = {
        componentInstance: {
          status: { set: jasmine.createSpy('statusSet') },
          error: { set: jasmine.createSpy('errorSet') },
        },
        afterClosed: jasmine.createSpy('afterClosed').and.returnValue(of(undefined)),
        close: jasmine.createSpy('close'),
      };
      mockMatDialog.open.and.returnValue(dialogRef as never);
      spyOn(
        migrationService as unknown as {
          _createAutoBackup: () => Promise<void>;
        },
        '_createAutoBackup',
      ).and.resolveTo();

      const secondTabStore = TestBed.runInInjectionContext(
        () => new OperationLogStoreService(),
      );
      await secondTabStore.init();
      const concurrentOp: Operation = {
        id: 'second-tab-after-migration',
        actionType: '[Task] Update Task' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-from-second-tab',
        payload: { title: 'Second tab' },
        clientId: legacyClientId,
        vectorClock: { [legacyClientId]: 6 },
        timestamp: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      };
      let concurrentAppend: Promise<number> | undefined;
      const appendFromSecondTab = async (): Promise<void> => {
        concurrentAppend ??= secondTabStore.appendWithVectorClockOverwrite(
          concurrentOp,
          'local',
        );
        await concurrentAppend;
      };

      const realAppend = opLogStore.append.bind(opLogStore);
      spyOn(opLogStore, 'append').and.callFake(async (op, source, options) => {
        const seq = await realAppend(op, source, options);
        await appendFromSecondTab();
        return seq;
      });
      const realAtomicAppend = opLogStore.appendOperationAndSnapshot.bind(opLogStore);
      spyOn(opLogStore, 'appendOperationAndSnapshot').and.callFake(
        async (op, source, snapshot) => {
          const seq = await realAtomicAppend(op, source, snapshot);
          await appendFromSecondTab();
          return seq;
        },
      );

      await migrationService.checkAndMigrate();

      const restartedStore = TestBed.runInInjectionContext(
        () => new OperationLogStoreService(),
      );
      await restartedStore.init();
      const cache = await restartedStore.loadStateCache();
      expect(cache?.lastAppliedOpSeq).toBe(1);
      const replayTail = await restartedStore.getOpsAfterSeq(
        cache?.lastAppliedOpSeq ?? 0,
      );
      expect(replayTail.map((entry) => entry.op.id)).toEqual([concurrentOp.id]);
      expect(replayTail[0].seq).toBe(2);
      expect(await restartedStore.getVectorClock()).toEqual({
        [legacyClientId]: 6,
      });
    });
  });
});
