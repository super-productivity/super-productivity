import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { BackupService } from './backup.service';
import { ImexViewService } from '../../imex/imex-meta/imex-view.service';
import { StateSnapshotService } from './state-snapshot.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { ArchiveModel } from '../../features/archive/archive.model';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { OpType } from '../core/operation.types';
import { OperationWriteFlushService } from '../sync/operation-write-flush.service';
import { LockService } from '../sync/lock.service';
import { LOCK_NAMES } from '../core/operation-log.const';

describe('BackupService', () => {
  let service: BackupService;
  let mockStore: jasmine.SpyObj<Store>;
  let mockImexViewService: jasmine.SpyObj<ImexViewService>;
  let mockStateSnapshotService: jasmine.SpyObj<StateSnapshotService>;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockOperationWriteFlushService: jasmine.SpyObj<OperationWriteFlushService>;
  let mockLockService: jasmine.SpyObj<LockService>;

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const createMinimalValidBackup = () => ({
    task: { ids: [], entities: {}, currentTaskId: null, selectedTaskId: null },
    project: {
      ids: ['INBOX_PROJECT'],
      entities: {
        INBOX_PROJECT: {
          id: 'INBOX_PROJECT',
          title: 'Inbox',
          taskIds: [],
          backlogTaskIds: [],
          noteIds: [],
          isHiddenFromMenu: false,
          isArchived: false,
        },
      },
    },
    tag: {
      ids: ['TODAY'],
      entities: { TODAY: { id: 'TODAY', title: 'Today', taskIds: [], icon: 'wb_sunny' } },
    },
    globalConfig: {
      misc: { isDisableInitialDialog: true },
      sync: { isEnabled: false, syncProvider: null },
    },
    note: { ids: [], entities: {}, todayOrder: [] },
    simpleCounter: { ids: [], entities: {} },
    taskRepeatCfg: { ids: [], entities: {} },
    metric: { ids: [], entities: {} },
    planner: { days: {} },
    issueProvider: { ids: [], entities: {} },
    boards: { boardCfgs: [] },
    menuTree: { tagTree: [], projectTree: [] },
    timeTracking: { project: {}, tag: {} },
    reminders: [],
    pluginMetadata: [],
    pluginUserData: [],
  });

  const createEmptyArchiveModel = (): ArchiveModel => ({
    task: { ids: [], entities: {} },
    timeTracking: { project: {}, tag: {} },
    lastTimeTrackingFlush: 0,
  });

  const createArchiveModel = (taskId: string, taskTitle: string): ArchiveModel => ({
    task: {
      ids: [taskId],
      entities: {
        [taskId]: {
          id: taskId,
          title: taskTitle,
          subTaskIds: [],
          // eslint-disable-next-line @typescript-eslint/naming-convention
          timeSpentOnDay: { '2024-11-25': 3600000 },
          timeSpent: 3600000,
          timeEstimate: 3600000,
          isDone: true,
          doneOn: 1732665600000,
          notes: '',
          tagIds: [],
          created: 1732492800000,
          attachments: [],
          projectId: 'INBOX_PROJECT',
        },
      },
    },
    timeTracking: { project: {}, tag: {} },
    lastTimeTrackingFlush: 1732665600000,
  });

  beforeEach(() => {
    mockStore = jasmine.createSpyObj('Store', ['dispatch']);
    mockImexViewService = jasmine.createSpyObj('ImexViewService', [
      'setDataImportInProgress',
    ]);
    mockStateSnapshotService = jasmine.createSpyObj('StateSnapshotService', [
      'getAllSyncModelDataFromStore',
      'getAllSyncModelDataFromStoreAsync',
      'getStateSnapshotAsync',
    ]);
    mockOpLogStore = jasmine.createSpyObj('OperationLogStoreService', [
      'saveImportBackup',
      'runDestructiveStateReplacement',
    ]);
    mockOperationWriteFlushService = jasmine.createSpyObj('OperationWriteFlushService', [
      'flushPendingWrites',
    ]);
    mockLockService = jasmine.createSpyObj('LockService', ['request']);

    // Default mock returns
    mockStateSnapshotService.getStateSnapshotAsync.and.resolveTo(
      createMinimalValidBackup() as any,
    );
    mockOpLogStore.saveImportBackup.and.resolveTo();
    mockOpLogStore.runDestructiveStateReplacement.and.resolveTo();
    mockOperationWriteFlushService.flushPendingWrites.and.resolveTo();
    mockLockService.request.and.callFake(async (_lockName, fn) => fn());

    TestBed.configureTestingModule({
      providers: [
        BackupService,
        { provide: Store, useValue: mockStore },
        { provide: ImexViewService, useValue: mockImexViewService },
        { provide: StateSnapshotService, useValue: mockStateSnapshotService },
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        {
          provide: OperationWriteFlushService,
          useValue: mockOperationWriteFlushService,
        },
        { provide: LockService, useValue: mockLockService },
      ],
    });

    service = TestBed.inject(BackupService);
  });

  describe('importCompleteBackup', () => {
    it('should dispatch loadAllData with the imported data', async () => {
      const backupData = createMinimalValidBackup();

      await service.importCompleteBackup(backupData as any, true, true);

      expect(mockStore.dispatch).toHaveBeenCalled();
      const dispatchedAction = mockStore.dispatch.calls.mostRecent()
        .args[0] as unknown as {
        type: string;
        appDataComplete: unknown;
      };
      expect(dispatchedAction.type).toBe(loadAllData.type);
      expect((dispatchedAction.appDataComplete as any).task).toEqual(
        jasmine.objectContaining(backupData.task),
      );
    });

    it('should persist import to operation log', async () => {
      const backupData = createMinimalValidBackup();

      await service.importCompleteBackup(backupData as any, true, true);

      // Issue #7709: the destructive sequence is now a single atomic call.
      expect(mockOpLogStore.runDestructiveStateReplacement).toHaveBeenCalledTimes(1);
    });

    it('should flush pending writes and hold the op-log lock during import replacement', async () => {
      const callOrder: string[] = [];
      mockOperationWriteFlushService.flushPendingWrites.and.callFake(async () => {
        callOrder.push('flush');
      });
      mockLockService.request.and.callFake(async (lockName, fn) => {
        callOrder.push(`lock:${lockName}`);
        const r = await fn();
        callOrder.push('unlock');
        return r;
      });
      mockOpLogStore.runDestructiveStateReplacement.and.callFake(async () => {
        callOrder.push('replace');
      });

      await service.importCompleteBackup(createMinimalValidBackup() as any, true, true);

      expect(callOrder).toEqual([
        'flush',
        `lock:${LOCK_NAMES.OPERATION_LOG}`,
        'replace',
        'unlock',
      ]);
    });

    it('should normalize invalid startOfNextDay config before persisting import', async () => {
      const backupData = createMinimalValidBackup();
      backupData.globalConfig.misc = {
        ...backupData.globalConfig.misc,
        startOfNextDay: 4,
        startOfNextDayTime: '24:00',
      } as any;

      await service.importCompleteBackup(backupData as any, true, true);

      const args = mockOpLogStore.runDestructiveStateReplacement.calls.mostRecent()
        .args[0] as Parameters<typeof mockOpLogStore.runDestructiveStateReplacement>[0];

      const appendedPayload = args.syncImportOp.payload as any;
      expect(appendedPayload.globalConfig.misc.startOfNextDay).toBe(4);
      expect(appendedPayload.globalConfig.misc.startOfNextDayTime).toBe('04:00');
    });

    it('should pass archiveYoung to the atomic replacement when present in backup', async () => {
      const archiveYoung = createArchiveModel('archived-task-1', 'Archived Task Young');
      const backupData = {
        ...createMinimalValidBackup(),
        archiveYoung,
        archiveOld: createEmptyArchiveModel(),
      };

      await service.importCompleteBackup(backupData as any, true, true);

      const args = mockOpLogStore.runDestructiveStateReplacement.calls.mostRecent()
        .args[0] as Parameters<typeof mockOpLogStore.runDestructiveStateReplacement>[0];
      expect(args.archiveYoung?.task.ids).toContain('archived-task-1');
    });

    it('should pass archiveOld separately to the atomic replacement when present in backup', async () => {
      // Note: Dual-archive architecture keeps archives separate (no merge)
      const archiveOld = createArchiveModel('archived-task-old', 'Archived Task Old');
      const backupData = {
        ...createMinimalValidBackup(),
        archiveYoung: createEmptyArchiveModel(),
        archiveOld,
      };

      await service.importCompleteBackup(backupData as any, true, true);

      const args = mockOpLogStore.runDestructiveStateReplacement.calls.mostRecent()
        .args[0] as Parameters<typeof mockOpLogStore.runDestructiveStateReplacement>[0];
      expect(args.archiveOld?.task.ids).toContain('archived-task-old');
      expect(args.archiveYoung?.task.ids).toEqual([]);
    });

    it('should pass both archiveYoung and archiveOld to the atomic replacement when both present', async () => {
      const archiveYoung = createArchiveModel('young-task', 'Young Archived Task');
      const archiveOld = createArchiveModel('old-task', 'Old Archived Task');
      const backupData = {
        ...createMinimalValidBackup(),
        archiveYoung,
        archiveOld,
      };

      await service.importCompleteBackup(backupData as any, true, true);

      const args = mockOpLogStore.runDestructiveStateReplacement.calls.mostRecent()
        .args[0] as Parameters<typeof mockOpLogStore.runDestructiveStateReplacement>[0];
      expect(args.archiveYoung?.task.ids).toContain('young-task');
      expect(args.archiveYoung?.task.ids).not.toContain('old-task');
      expect(args.archiveOld?.task.ids).toContain('old-task');
      expect(args.archiveOld?.task.ids).not.toContain('young-task');
    });

    it('should pass default empty archives when not present in backup (added by dataRepair)', async () => {
      // dataRepair adds default empty archives if not present
      const backupData = createMinimalValidBackup();
      // No archiveYoung or archiveOld property

      await service.importCompleteBackup(backupData as any, true, true);

      const args = mockOpLogStore.runDestructiveStateReplacement.calls.mostRecent()
        .args[0] as Parameters<typeof mockOpLogStore.runDestructiveStateReplacement>[0];
      expect(args.archiveYoung?.task.ids).toEqual([]);
      expect(args.archiveOld?.task.ids).toEqual([]);
    });

    it('should handle CompleteBackup wrapper format with archives', async () => {
      const archiveYoung = createArchiveModel('wrapped-task', 'Wrapped Archive Task');
      const wrappedBackup = {
        timestamp: Date.now(),
        lastUpdate: Date.now(),
        crossModelVersion: 4.5,
        data: {
          ...createMinimalValidBackup(),
          archiveYoung,
          archiveOld: createEmptyArchiveModel(),
        },
      };

      await service.importCompleteBackup(wrappedBackup as any, true, true);

      const args = mockOpLogStore.runDestructiveStateReplacement.calls.mostRecent()
        .args[0] as Parameters<typeof mockOpLogStore.runDestructiveStateReplacement>[0];
      expect(args.archiveYoung?.task.ids).toContain('wrapped-task');
    });

    it('should pass a fresh { [clientId]: 1 } vector clock to the atomic helper', async () => {
      const backupData = createMinimalValidBackup();

      await service.importCompleteBackup(backupData as any, true, true);

      const args = mockOpLogStore.runDestructiveStateReplacement.calls.mostRecent()
        .args[0] as Parameters<typeof mockOpLogStore.runDestructiveStateReplacement>[0];
      // The clientId is freshly minted (generateClientId) — new compact format.
      const op = args.syncImportOp;
      expect(op.clientId).toMatch(/^[BEAI]_[a-zA-Z0-9]{4}$/);
      expect(op.vectorClock).toEqual({ [op.clientId]: 1 });
    });

    it('should pass a fresh clock to the atomic helper on force-import', async () => {
      const backupData = createMinimalValidBackup();

      await service.importCompleteBackup(backupData as any, true, true, true);

      const args = mockOpLogStore.runDestructiveStateReplacement.calls.mostRecent()
        .args[0] as Parameters<typeof mockOpLogStore.runDestructiveStateReplacement>[0];
      const op = args.syncImportOp;
      expect(op.clientId).toMatch(/^[BEAI]_[a-zA-Z0-9]{4}$/);
      expect(op.vectorClock).toEqual({ [op.clientId]: 1 });
    });

    /**
     * CRITICAL: Backup imports MUST use OpType.BackupImport (not SyncImport).
     *
     * This ensures the server receives reason='recovery' which bypasses the
     * "SYNC_IMPORT already exists" check (409 error). Without this, users cannot
     * recover by importing a backup when a SYNC_IMPORT already exists on the server.
     *
     * @see packages/super-sync-server/src/sync/sync.routes.ts:703-733
     */
    it('should use OpType.BackupImport for recovery (not SyncImport)', async () => {
      const backupData = createMinimalValidBackup();

      await service.importCompleteBackup(backupData as any, true, true);

      const args = mockOpLogStore.runDestructiveStateReplacement.calls.mostRecent()
        .args[0] as Parameters<typeof mockOpLogStore.runDestructiveStateReplacement>[0];

      // CRITICAL: Must use BackupImport so server receives reason='recovery'
      expect(args.syncImportOp.opType).toBe(OpType.BackupImport);
      // Verify it's NOT using SyncImport (which would cause 409 errors)
      expect(args.syncImportOp.opType).not.toBe(OpType.SyncImport);
    });

    it('should produce fresh { [clientId]: 1 } clock on import', async () => {
      const backupData = createMinimalValidBackup();

      await service.importCompleteBackup(backupData as any, true, true, true);

      const args = mockOpLogStore.runDestructiveStateReplacement.calls.mostRecent()
        .args[0] as Parameters<typeof mockOpLogStore.runDestructiveStateReplacement>[0];
      const op = args.syncImportOp;
      expect(op.vectorClock).toEqual({ [op.clientId]: 1 });
    });

    it('should abort the import (and not dispatch loadAllData) when the pre-import backup fails', async () => {
      // Without this, the silent early-return in _persistImportToOperationLog
      // leaves the device in a hybrid state: NgRx + archive DBs + sync seqs
      // replaced with imported data, but OPS / state_cache / vector_clock
      // still hold the previous content.
      mockOpLogStore.saveImportBackup.and.rejectWith(new Error('IDB quota exceeded'));

      const backupData = createMinimalValidBackup();

      await expectAsync(
        service.importCompleteBackup(backupData as any, true, true),
      ).toBeRejected();

      expect(mockOpLogStore.runDestructiveStateReplacement).not.toHaveBeenCalled();
      expect(mockStore.dispatch).not.toHaveBeenCalled();
    });

    it('should save a fresh async state snapshot before import', async () => {
      const currentState = {
        ...createMinimalValidBackup(),
        archiveYoung: createArchiveModel('current-young', 'Current Young'),
        archiveOld: createArchiveModel('current-old', 'Current Old'),
      };
      mockStateSnapshotService.getStateSnapshotAsync.and.resolveTo(currentState as any);

      await service.importCompleteBackup(createMinimalValidBackup() as any, true, true);

      expect(mockStateSnapshotService.getStateSnapshotAsync).toHaveBeenCalled();
      expect(mockOpLogStore.saveImportBackup).toHaveBeenCalledWith(currentState);
    });

    it('should pass snapshotEntityKeys derived from the imported data', async () => {
      const backupData = createMinimalValidBackup();

      await service.importCompleteBackup(backupData as any, true, true);

      const args = mockOpLogStore.runDestructiveStateReplacement.calls.mostRecent()
        .args[0] as Parameters<typeof mockOpLogStore.runDestructiveStateReplacement>[0];
      expect(args.snapshotEntityKeys).toBeDefined();
      expect(Array.isArray(args.snapshotEntityKeys)).toBe(true);
    });
  });
});
