import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { OperationLogMigrationService } from './operation-log-migration.service';
import { OperationLogStoreService } from './operation-log-store.service';
import { LegacyPfDbService } from '../../core/persistence/legacy-pf-db.service';
import { ClientIdService } from '../../core/util/client-id.service';
import { LanguageService } from '../../core/language/language.service';
import { OpLog } from '../../core/log';
import { ActionType, OpType } from '../core/operation.types';

describe('OperationLogMigrationService', () => {
  let service: OperationLogMigrationService;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockLegacyPfDb: jasmine.SpyObj<LegacyPfDbService>;
  let mockMatDialog: jasmine.SpyObj<MatDialog>;
  let mockStore: jasmine.SpyObj<Store>;
  let mockClientIdService: jasmine.SpyObj<ClientIdService>;
  let mockTranslateService: jasmine.SpyObj<TranslateService>;
  let mockLanguageService: jasmine.SpyObj<LanguageService>;

  beforeEach(() => {
    mockOpLogStore = jasmine.createSpyObj('OperationLogStoreService', [
      'loadStateCache',
      'getOpsAfterSeq',
      'deleteOpsWhere',
      'append',
      'getLastSeq',
      'saveStateCache',
      'setVectorClock',
    ]);

    mockLegacyPfDb = jasmine.createSpyObj('LegacyPfDbService', [
      'hasUsableEntityData',
      'loadAllEntityData',
      'loadMetaModel',
      'loadClientId',
      'acquireMigrationLock',
      'releaseMigrationLock',
    ]);

    mockMatDialog = jasmine.createSpyObj('MatDialog', ['open']);
    mockStore = jasmine.createSpyObj('Store', ['dispatch']);
    mockClientIdService = jasmine.createSpyObj('ClientIdService', [
      'generateNewClientId',
    ]);
    mockTranslateService = jasmine.createSpyObj('TranslateService', [
      'instant',
      'getBrowserCultureLang',
      'getBrowserLang',
    ]);
    mockLanguageService = jasmine.createSpyObj('LanguageService', ['setLng']);

    // Default returns for legacy db
    mockLegacyPfDb.hasUsableEntityData.and.resolveTo(false);

    spyOn(OpLog, 'normal');
    spyOn(OpLog, 'warn');

    TestBed.configureTestingModule({
      providers: [
        OperationLogMigrationService,
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        { provide: LegacyPfDbService, useValue: mockLegacyPfDb },
        { provide: MatDialog, useValue: mockMatDialog },
        { provide: Store, useValue: mockStore },
        { provide: ClientIdService, useValue: mockClientIdService },
        { provide: TranslateService, useValue: mockTranslateService },
        { provide: LanguageService, useValue: mockLanguageService },
      ],
    });
    service = TestBed.inject(OperationLogMigrationService);
  });

  describe('checkAndMigrate', () => {
    describe('when state cache (snapshot) exists', () => {
      it('should return early if snapshot exists', async () => {
        mockOpLogStore.loadStateCache.and.resolveTo({
          state: { task: { ids: ['t1'] } },
          lastAppliedOpSeq: 5,
          vectorClock: { client1: 5 },
          compactedAt: Date.now(),
        });

        await service.checkAndMigrate();

        expect(mockOpLogStore.loadStateCache).toHaveBeenCalled();
        expect(mockOpLogStore.getOpsAfterSeq).not.toHaveBeenCalled();
      });
    });

    describe('when no snapshot exists but operations exist', () => {
      beforeEach(() => {
        mockOpLogStore.loadStateCache.and.resolveTo(null);
      });

      it('should skip if Genesis operation exists', async () => {
        mockOpLogStore.getOpsAfterSeq.and.resolveTo([
          {
            seq: 1,
            op: {
              id: 'genesis-op',
              entityType: 'MIGRATION',
              actionType: '[Migration] Genesis Import' as ActionType,
              opType: OpType.Batch,
              clientId: 'client1',
              vectorClock: { client1: 1 },
              timestamp: Date.now(),
              payload: { task: { ids: ['t1'] } },
              schemaVersion: 1,
            },
            appliedAt: Date.now(),
            source: 'local',
          },
        ]);

        await service.checkAndMigrate();

        expect(mockOpLogStore.deleteOpsWhere).not.toHaveBeenCalled();
        expect(OpLog.normal).toHaveBeenCalledWith(
          jasmine.stringContaining('Genesis operation found'),
        );
      });

      it('should skip if Recovery operation exists', async () => {
        mockOpLogStore.getOpsAfterSeq.and.resolveTo([
          {
            seq: 1,
            op: {
              id: 'recovery-op',
              entityType: 'RECOVERY',
              actionType: '[Recovery] Data Recovery Import' as ActionType,
              opType: OpType.Batch,
              clientId: 'client1',
              vectorClock: { client1: 1 },
              timestamp: Date.now(),
              payload: { task: { ids: ['t1'] } },
              schemaVersion: 1,
            },
            appliedAt: Date.now(),
            source: 'local',
          },
        ]);

        await service.checkAndMigrate();

        expect(mockOpLogStore.deleteOpsWhere).not.toHaveBeenCalled();
      });

      it('should clear orphan operations when legacy data exists', async () => {
        mockOpLogStore.getOpsAfterSeq.and.resolveTo([
          {
            seq: 1,
            op: {
              id: 'orphan-op-1',
              entityType: 'TASK',
              actionType: '[Task] Update Task' as ActionType,
              opType: OpType.Update,
              clientId: 'client1',
              vectorClock: { client1: 1 },
              timestamp: Date.now(),
              payload: { id: 't1', title: 'Test' },
              schemaVersion: 1,
            },
            appliedAt: Date.now(),
            source: 'local',
          },
          {
            seq: 2,
            op: {
              id: 'orphan-op-2',
              entityType: 'TAG',
              actionType: '[Tag] Update Tag' as ActionType,
              opType: OpType.Update,
              clientId: 'client1',
              vectorClock: { client1: 2 },
              timestamp: Date.now(),
              payload: { id: 'tag1', name: 'Test Tag' },
              schemaVersion: 1,
            },
            appliedAt: Date.now(),
            source: 'local',
          },
        ]);
        mockOpLogStore.deleteOpsWhere.and.resolveTo();
        // Legacy data exists - orphan ops should be cleared before migration
        mockLegacyPfDb.hasUsableEntityData.and.resolveTo(true);
        // Lock acquisition fails - prevents migration from proceeding (test focuses on clearing)
        mockLegacyPfDb.acquireMigrationLock.and.resolveTo(false);

        await service.checkAndMigrate();

        expect(OpLog.warn).toHaveBeenCalledWith(
          jasmine.stringContaining('Found 2 orphan operations'),
        );
        expect(mockOpLogStore.deleteOpsWhere).toHaveBeenCalled();
        expect(mockLegacyPfDb.hasUsableEntityData).toHaveBeenCalled();
      });

      it('should NOT clear orphan operations when no legacy data exists (fresh install)', async () => {
        mockOpLogStore.getOpsAfterSeq.and.resolveTo([
          {
            seq: 1,
            op: {
              id: 'orphan-op-1',
              entityType: 'TASK',
              actionType: '[Task] Update Task' as ActionType,
              opType: OpType.Update,
              clientId: 'client1',
              vectorClock: { client1: 1 },
              timestamp: Date.now(),
              payload: { id: 't1', title: 'Test' },
              schemaVersion: 1,
            },
            appliedAt: Date.now(),
            source: 'local',
          },
        ]);
        // No legacy data - orphan ops are kept (fresh install scenario)
        mockLegacyPfDb.hasUsableEntityData.and.resolveTo(false);

        await service.checkAndMigrate();

        expect(OpLog.normal).toHaveBeenCalledWith(
          jasmine.stringContaining('fresh install'),
        );
        expect(mockOpLogStore.deleteOpsWhere).not.toHaveBeenCalled();
      });
    });

    describe('when no snapshot and no operations exist (fresh install)', () => {
      beforeEach(() => {
        mockOpLogStore.loadStateCache.and.resolveTo(null);
        mockOpLogStore.getOpsAfterSeq.and.resolveTo([]);
        mockLegacyPfDb.hasUsableEntityData.and.resolveTo(false);
      });

      it('should check for legacy data and log fresh start', async () => {
        await service.checkAndMigrate();

        expect(mockOpLogStore.loadStateCache).toHaveBeenCalled();
        expect(mockOpLogStore.getOpsAfterSeq).toHaveBeenCalledWith(0);
        expect(mockLegacyPfDb.hasUsableEntityData).toHaveBeenCalled();
        expect(OpLog.normal).toHaveBeenCalledWith(
          jasmine.stringContaining('No legacy data found'),
        );
      });
    });

    describe('when legacy data exists', () => {
      beforeEach(() => {
        mockOpLogStore.loadStateCache.and.resolveTo(null);
        mockOpLogStore.getOpsAfterSeq.and.resolveTo([]);
        mockLegacyPfDb.hasUsableEntityData.and.resolveTo(true);
      });

      it('should skip migration if lock cannot be acquired', async () => {
        mockLegacyPfDb.acquireMigrationLock.and.resolveTo(false);

        await service.checkAndMigrate();

        expect(mockLegacyPfDb.acquireMigrationLock).toHaveBeenCalled();
        expect(mockMatDialog.open).not.toHaveBeenCalled();
        expect(OpLog.warn).toHaveBeenCalledWith(
          jasmine.stringContaining('Migration lock held by another instance'),
        );
      });
    });

    describe('when hasUsableEntityData throws an error', () => {
      beforeEach(() => {
        mockOpLogStore.loadStateCache.and.resolveTo(null);
        spyOn(OpLog, 'err');
      });

      it('should show error dialog and re-throw when database access fails', async () => {
        const dbError = new Error('Failed to read legacy database. DB error');
        mockLegacyPfDb.hasUsableEntityData.and.rejectWith(dbError);

        const mockDialogRef = {
          componentInstance: { error: { set: jasmine.createSpy('set') } },
          afterClosed: jasmine.createSpy('afterClosed').and.returnValue(of(undefined)),
        };
        mockMatDialog.open.and.returnValue(mockDialogRef as any);
        mockTranslateService.use = jasmine
          .createSpy('use')
          .and.returnValue(of(undefined));
        (service as any).languageService = {
          detect: jasmine.createSpy('detect').and.returnValue('en'),
        };

        await expectAsync(service.checkAndMigrate()).toBeRejected();

        expect(OpLog.err).toHaveBeenCalledWith(
          jasmine.stringContaining('Failed to check legacy data'),
          dbError,
        );
        expect(mockMatDialog.open).toHaveBeenCalled();
        expect(mockDialogRef.componentInstance.error.set).toHaveBeenCalledWith(
          jasmine.stringContaining('Failed to read your existing data'),
        );
      });
    });
  });
});
