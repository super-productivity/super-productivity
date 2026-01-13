import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { BackupService } from './backup.service';
import { ImexViewService } from '../../imex/imex-meta/imex-view.service';
import { StateSnapshotService } from './state-snapshot.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { VectorClockService } from '../sync/vector-clock.service';
import { ClientIdService } from '../../core/util/client-id.service';
import { ArchiveDbAdapter } from '../../core/persistence/archive-db-adapter.service';
import { ArchiveModel } from '../../features/archive/archive.model';
import { loadAllData } from '../../root-store/meta/load-all-data.action';

describe('BackupService', () => {
  let service: BackupService;
  let mockStore: jasmine.SpyObj<Store>;
  let mockImexViewService: jasmine.SpyObj<ImexViewService>;
  let mockStateSnapshotService: jasmine.SpyObj<StateSnapshotService>;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockVectorClockService: jasmine.SpyObj<VectorClockService>;
  let mockClientIdService: jasmine.SpyObj<ClientIdService>;
  let mockArchiveDbAdapter: jasmine.SpyObj<ArchiveDbAdapter>;

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
    ]);
    mockOpLogStore = jasmine.createSpyObj('OperationLogStoreService', [
      'loadStateCache',
      'saveImportBackup',
      'clearAllOperations',
      'append',
      'getLastSeq',
      'saveStateCache',
    ]);
    mockVectorClockService = jasmine.createSpyObj('VectorClockService', [
      'getCurrentVectorClock',
    ]);
    mockClientIdService = jasmine.createSpyObj('ClientIdService', [
      'loadClientId',
      'generateNewClientId',
    ]);
    mockArchiveDbAdapter = jasmine.createSpyObj('ArchiveDbAdapter', [
      'saveArchiveYoung',
      'saveArchiveOld',
    ]);

    // Default mock returns
    mockOpLogStore.loadStateCache.and.returnValue(Promise.resolve(null));
    mockOpLogStore.clearAllOperations.and.returnValue(Promise.resolve());
    mockOpLogStore.append.and.returnValue(Promise.resolve(1));
    mockOpLogStore.getLastSeq.and.returnValue(Promise.resolve(1));
    mockOpLogStore.saveStateCache.and.returnValue(Promise.resolve());
    mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
    mockClientIdService.loadClientId.and.returnValue(Promise.resolve('test-client-id'));
    mockArchiveDbAdapter.saveArchiveYoung.and.returnValue(Promise.resolve());
    mockArchiveDbAdapter.saveArchiveOld.and.returnValue(Promise.resolve());

    TestBed.configureTestingModule({
      providers: [
        BackupService,
        { provide: Store, useValue: mockStore },
        { provide: ImexViewService, useValue: mockImexViewService },
        { provide: StateSnapshotService, useValue: mockStateSnapshotService },
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        { provide: VectorClockService, useValue: mockVectorClockService },
        { provide: ClientIdService, useValue: mockClientIdService },
        { provide: ArchiveDbAdapter, useValue: mockArchiveDbAdapter },
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

      expect(mockOpLogStore.append).toHaveBeenCalled();
      expect(mockOpLogStore.saveStateCache).toHaveBeenCalled();
    });

    it('should write archiveYoung to IndexedDB when present in backup', async () => {
      const archiveYoung = createArchiveModel('archived-task-1', 'Archived Task Young');
      const backupData = {
        ...createMinimalValidBackup(),
        archiveYoung,
        archiveOld: createEmptyArchiveModel(),
      };

      await service.importCompleteBackup(backupData as any, true, true);

      // dataRepair may modify the data, so check it was called with archive data
      expect(mockArchiveDbAdapter.saveArchiveYoung).toHaveBeenCalled();
      const calledWith = mockArchiveDbAdapter.saveArchiveYoung.calls.mostRecent().args[0];
      expect(calledWith.task.ids).toContain('archived-task-1');
    });

    it('should write archiveOld to IndexedDB when present in backup', async () => {
      // Note: dataRepair merges archiveOld into archiveYoung, but both are still written
      const archiveOld = createArchiveModel('archived-task-old', 'Archived Task Old');
      const backupData = {
        ...createMinimalValidBackup(),
        archiveYoung: createEmptyArchiveModel(),
        archiveOld,
      };

      await service.importCompleteBackup(backupData as any, true, true);

      // After dataRepair, archiveOld is empty (merged into archiveYoung)
      // Both should be written
      expect(mockArchiveDbAdapter.saveArchiveYoung).toHaveBeenCalled();
      expect(mockArchiveDbAdapter.saveArchiveOld).toHaveBeenCalled();

      // The archiveOld task should have been merged into archiveYoung by dataRepair
      const youngCalledWith =
        mockArchiveDbAdapter.saveArchiveYoung.calls.mostRecent().args[0];
      expect(youngCalledWith.task.ids).toContain('archived-task-old');
    });

    it('should write both archiveYoung and archiveOld when both present', async () => {
      const archiveYoung = createArchiveModel('young-task', 'Young Archived Task');
      const archiveOld = createArchiveModel('old-task', 'Old Archived Task');
      const backupData = {
        ...createMinimalValidBackup(),
        archiveYoung,
        archiveOld,
      };

      await service.importCompleteBackup(backupData as any, true, true);

      expect(mockArchiveDbAdapter.saveArchiveYoung).toHaveBeenCalled();
      expect(mockArchiveDbAdapter.saveArchiveOld).toHaveBeenCalled();

      // dataRepair merges archiveOld into archiveYoung
      const youngCalledWith =
        mockArchiveDbAdapter.saveArchiveYoung.calls.mostRecent().args[0];
      expect(youngCalledWith.task.ids).toContain('young-task');
      expect(youngCalledWith.task.ids).toContain('old-task');
    });

    it('should write default empty archives when not present in backup (added by dataRepair)', async () => {
      // dataRepair adds default empty archives if not present
      const backupData = createMinimalValidBackup();
      // No archiveYoung or archiveOld property

      await service.importCompleteBackup(backupData as any, true, true);

      // dataRepair adds default archives, so they should be written
      expect(mockArchiveDbAdapter.saveArchiveYoung).toHaveBeenCalled();
      expect(mockArchiveDbAdapter.saveArchiveOld).toHaveBeenCalled();
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

      expect(mockArchiveDbAdapter.saveArchiveYoung).toHaveBeenCalled();
      const calledWith = mockArchiveDbAdapter.saveArchiveYoung.calls.mostRecent().args[0];
      expect(calledWith.task.ids).toContain('wrapped-task');
    });
  });
});
