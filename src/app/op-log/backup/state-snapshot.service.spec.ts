import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { StateSnapshotService } from './state-snapshot.service';
import { ArchiveDbAdapter } from '../../core/persistence/archive-db-adapter.service';
import { selectTaskFeatureState } from '../../features/tasks/store/task.selectors';
import { selectProjectFeatureState } from '../../features/project/store/project.selectors';
import { selectTagFeatureState } from '../../features/tag/store/tag.reducer';
import { selectConfigFeatureState } from '../../features/config/store/global-config.reducer';
import { selectNoteFeatureState } from '../../features/note/store/note.reducer';
import { selectIssueProviderState } from '../../features/issue/store/issue-provider.selectors';
import { selectPlannerState } from '../../features/planner/store/planner.selectors';
import { selectBoardsState } from '../../features/boards/store/boards.selectors';
import { selectMetricFeatureState } from '../../features/metric/store/metric.selectors';
import { selectSimpleCounterFeatureState } from '../../features/simple-counter/store/simple-counter.reducer';
import { selectTaskRepeatCfgFeatureState } from '../../features/task-repeat-cfg/store/task-repeat-cfg.selectors';
import { selectMenuTreeState } from '../../features/menu-tree/store/menu-tree.selectors';
import { selectTimeTrackingState } from '../../features/time-tracking/store/time-tracking.selectors';
import { selectPluginUserDataFeatureState } from '../../plugins/store/plugin-user-data.reducer';
import { selectPluginMetadataFeatureState } from '../../plugins/store/plugin-metadata.reducer';
import { selectReminderFeatureState } from '../../features/reminder/store/reminder.reducer';
import { ArchiveModel } from '../../features/time-tracking/time-tracking.model';
import { initialTimeTrackingState } from '../../features/time-tracking/store/time-tracking.reducer';
import { TaskTimeSyncService } from '../../features/tasks/task-time-sync.service';
import { DEFAULT_TASK, Task, TaskState } from '../../features/tasks/task.model';
import { initialTaskState } from '../../features/tasks/store/task.reducer';
import { OperationCaptureService } from '../capture/operation-capture.service';
import { OpType } from '../core/operation.types';
import { PersistentAction } from '../core/persistent-action.interface';

describe('StateSnapshotService', () => {
  let service: StateSnapshotService;
  let store: MockStore;
  let archiveDbAdapterSpy: jasmine.SpyObj<ArchiveDbAdapter>;

  // Sample mock states for selectors
  const mockTaskState = {
    ids: ['task1'],
    entities: { task1: { id: 'task1', title: 'Test Task' } },
    selectedTaskId: 'task1',
    currentTaskId: 'task1',
  };
  const mockProjectState = { ids: [], entities: {} };
  const mockTagState = { ids: [], entities: {} };
  const mockConfigState = { misc: {} };
  const mockNoteState = { ids: [], entities: {} };
  const mockIssueProviderState = { ids: [], entities: {} };
  const mockPlannerState = { days: {} };
  const mockBoardsState = { ids: [], entities: {} };
  const mockMetricState = { ids: [], entities: {} };
  const mockSimpleCounterState = { ids: [], entities: {} };
  const mockTaskRepeatCfgState = { ids: [], entities: {} };
  const mockMenuTreeState = { root: [] };
  const mockTimeTrackingState = initialTimeTrackingState;
  const mockPluginUserDataState = {};
  const mockPluginMetadataState = {};
  const mockReminderState = { ids: [], entities: {} };

  const DEFAULT_ARCHIVE: ArchiveModel = {
    task: { ids: [], entities: {} },
    timeTracking: initialTimeTrackingState,
    lastTimeTrackingFlush: 0,
  };

  const mockArchiveYoung: ArchiveModel = {
    task: {
      ids: ['archived1'],
      entities: { archived1: { id: 'archived1', title: 'Archived Young' } as any },
    },
    timeTracking: initialTimeTrackingState,
    lastTimeTrackingFlush: 1000,
  };

  const mockArchiveOld: ArchiveModel = {
    task: {
      ids: ['archivedOld1'],
      entities: {
        archivedOld1: { id: 'archivedOld1', title: 'Archived Old' } as any,
      },
    },
    timeTracking: initialTimeTrackingState,
    lastTimeTrackingFlush: 500,
  };

  beforeEach(() => {
    archiveDbAdapterSpy = jasmine.createSpyObj('ArchiveDbAdapter', [
      'loadArchiveYoung',
      'loadArchiveOld',
    ]);
    archiveDbAdapterSpy.loadArchiveYoung.and.returnValue(
      Promise.resolve(mockArchiveYoung),
    );
    archiveDbAdapterSpy.loadArchiveOld.and.returnValue(Promise.resolve(mockArchiveOld));

    TestBed.configureTestingModule({
      providers: [
        StateSnapshotService,
        provideMockStore(),
        { provide: ArchiveDbAdapter, useValue: archiveDbAdapterSpy },
      ],
    });

    service = TestBed.inject(StateSnapshotService);
    store = TestBed.inject(MockStore);

    // Override selectors with mock values
    store.overrideSelector(selectTaskFeatureState, mockTaskState as any);
    store.overrideSelector(selectProjectFeatureState, mockProjectState as any);
    store.overrideSelector(selectTagFeatureState, mockTagState as any);
    store.overrideSelector(selectConfigFeatureState, mockConfigState as any);
    store.overrideSelector(selectNoteFeatureState, mockNoteState as any);
    store.overrideSelector(selectIssueProviderState, mockIssueProviderState as any);
    store.overrideSelector(selectPlannerState, mockPlannerState as any);
    store.overrideSelector(selectBoardsState, mockBoardsState as any);
    store.overrideSelector(selectMetricFeatureState, mockMetricState as any);
    store.overrideSelector(
      selectSimpleCounterFeatureState,
      mockSimpleCounterState as any,
    );
    store.overrideSelector(
      selectTaskRepeatCfgFeatureState,
      mockTaskRepeatCfgState as any,
    );
    store.overrideSelector(selectMenuTreeState, mockMenuTreeState as any);
    store.overrideSelector(selectTimeTrackingState, mockTimeTrackingState as any);
    store.overrideSelector(
      selectPluginUserDataFeatureState,
      mockPluginUserDataState as any,
    );
    store.overrideSelector(
      selectPluginMetadataFeatureState,
      mockPluginMetadataState as any,
    );
    store.overrideSelector(selectReminderFeatureState, mockReminderState as any);
  });

  afterEach(() => {
    store.resetSelectors();
  });

  describe('getStateSnapshot (sync)', () => {
    it('should return all feature states from NgRx store', () => {
      const snapshot = service.getStateSnapshot();

      expect(snapshot.project).toEqual(mockProjectState);
      expect(snapshot.tag).toEqual(mockTagState);
      expect(snapshot.globalConfig).toEqual(mockConfigState);
      expect(snapshot.note).toEqual(mockNoteState);
      expect(snapshot.issueProvider).toEqual(mockIssueProviderState);
      expect(snapshot.planner).toEqual(mockPlannerState);
      expect(snapshot.boards).toEqual(mockBoardsState);
      expect(snapshot.metric).toEqual(mockMetricState);
      expect(snapshot.simpleCounter).toEqual(mockSimpleCounterState);
      expect(snapshot.taskRepeatCfg).toEqual(mockTaskRepeatCfgState);
      expect(snapshot.menuTree).toEqual(mockMenuTreeState);
      expect(snapshot.timeTracking).toEqual(mockTimeTrackingState);
      expect(snapshot.pluginUserData).toEqual(mockPluginUserDataState);
      expect(snapshot.pluginMetadata).toEqual(mockPluginMetadataState);
      expect(snapshot.reminders).toEqual(mockReminderState);
    });

    it('should return default empty archives', () => {
      const snapshot = service.getStateSnapshot();

      expect(snapshot.archiveYoung).toEqual(DEFAULT_ARCHIVE);
      expect(snapshot.archiveOld).toEqual(DEFAULT_ARCHIVE);
    });

    it('should clear currentTaskId', () => {
      const snapshot = service.getStateSnapshot();

      expect((snapshot.task as any).currentTaskId).toBeNull();
    });

    it('should include task state with ids and entities', () => {
      const snapshot = service.getStateSnapshot();

      expect((snapshot.task as any).ids).toEqual(['task1']);
      expect((snapshot.task as any).entities).toBeDefined();
    });

    it('should exclude pending task time from an operation-log snapshot', () => {
      const task = {
        ...DEFAULT_TASK,
        id: 'task1',
        title: 'Test Task',
        created: 1,
        projectId: 'project-1',
        timeSpentOnDay: { ['2024-01-15']: 5000 },
        timeSpent: 5000,
      } as Task;
      store.overrideSelector(selectTaskFeatureState, {
        ...initialTaskState,
        ids: ['task1'],
        entities: { task1: task },
      });
      store.refreshState();
      TestBed.inject(TaskTimeSyncService).accumulate('task1', 5000, '2024-01-15');

      const liveSnapshot = service.getStateSnapshot();
      const opLogSnapshot = service.getStateSnapshotForOperationLog();

      expect((liveSnapshot.task as TaskState).entities['task1']!.timeSpent).toBe(5000);
      expect((opLogSnapshot.task as TaskState).entities['task1']!.timeSpent).toBe(0);
    });

    it('should exclude a task-time delta whose operation write is still pending', () => {
      const task = {
        ...DEFAULT_TASK,
        id: 'task1',
        title: 'Test Task',
        created: 1,
        projectId: 'project-1',
        timeSpentOnDay: { ['2024-01-15']: 5000 },
        timeSpent: 5000,
      } as Task;
      store.overrideSelector(selectTaskFeatureState, {
        ...initialTaskState,
        ids: ['task1'],
        entities: { task1: task },
      });
      store.refreshState();
      const captureService = TestBed.inject(OperationCaptureService);
      const action = {
        type: '[TimeTracking] Sync time spent',
        taskId: 'task1',
        date: '2024-01-15',
        duration: 5000,
        meta: {
          isPersistent: true,
          entityType: 'TASK',
          entityId: 'task1',
          opType: OpType.Update,
        },
      } as PersistentAction;
      captureService.incrementPending(action);

      const opLogSnapshot = service.getStateSnapshotForOperationLog();

      expect((opLogSnapshot.task as TaskState).entities['task1']!.timeSpent).toBe(0);
      captureService.decrementPending(action);
      expect(
        (service.getStateSnapshotForOperationLog().task as TaskState).entities['task1']!
          .timeSpent,
      ).toBe(5000);
    });
  });

  describe('getStateSnapshotAsync', () => {
    it('should return all feature states from NgRx store', async () => {
      const snapshot = await service.getStateSnapshotAsync();

      expect(snapshot.project).toEqual(mockProjectState);
      expect(snapshot.tag).toEqual(mockTagState);
      expect(snapshot.globalConfig).toEqual(mockConfigState);
    });

    it('should load archiveYoung from ArchiveDbAdapter', async () => {
      const snapshot = await service.getStateSnapshotAsync();

      expect(archiveDbAdapterSpy.loadArchiveYoung).toHaveBeenCalled();
      expect(snapshot.archiveYoung).toEqual(mockArchiveYoung);
    });

    it('should load archiveOld from ArchiveDbAdapter', async () => {
      const snapshot = await service.getStateSnapshotAsync();

      expect(archiveDbAdapterSpy.loadArchiveOld).toHaveBeenCalled();
      expect(snapshot.archiveOld).toEqual(mockArchiveOld);
    });

    it('should return default archive when adapter returns null for archiveYoung', async () => {
      archiveDbAdapterSpy.loadArchiveYoung.and.returnValue(Promise.resolve(null as any));

      const snapshot = await service.getStateSnapshotAsync();

      expect(snapshot.archiveYoung).toEqual(DEFAULT_ARCHIVE);
    });

    it('should return default archive when adapter returns null for archiveOld', async () => {
      archiveDbAdapterSpy.loadArchiveOld.and.returnValue(Promise.resolve(null as any));

      const snapshot = await service.getStateSnapshotAsync();

      expect(snapshot.archiveOld).toEqual(DEFAULT_ARCHIVE);
    });

    it('should clear currentTaskId in async version', async () => {
      const snapshot = await service.getStateSnapshotAsync();

      expect((snapshot.task as any).currentTaskId).toBeNull();
    });

    it('should load both archives in parallel', async () => {
      // Both should be called
      await service.getStateSnapshotAsync();

      expect(archiveDbAdapterSpy.loadArchiveYoung).toHaveBeenCalledTimes(1);
      expect(archiveDbAdapterSpy.loadArchiveOld).toHaveBeenCalledTimes(1);
    });

    it('should capture NgRx state before awaiting archive I/O', async () => {
      let releaseArchives!: () => void;
      const archiveGate = new Promise<void>((resolve) => {
        releaseArchives = resolve;
      });
      archiveDbAdapterSpy.loadArchiveYoung.and.callFake(async () => {
        await archiveGate;
        return mockArchiveYoung;
      });
      archiveDbAdapterSpy.loadArchiveOld.and.callFake(async () => {
        await archiveGate;
        return mockArchiveOld;
      });

      const snapshotPromise = service.getStateSnapshotAsync();
      store.overrideSelector(selectTaskFeatureState, {
        ...mockTaskState,
        ids: ['later-task'],
      } as unknown as TaskState);
      store.refreshState();
      releaseArchives();

      const snapshot = await snapshotPromise;
      expect((snapshot.task as TaskState).ids).toEqual(['task1']);
    });
  });

  describe('getStateSnapshotForOperationLogAsync', () => {
    it('should capture NgRx state before awaiting archive reads', async () => {
      let resolveArchiveYoung!: (archive: ArchiveModel) => void;
      archiveDbAdapterSpy.loadArchiveYoung.and.returnValue(
        new Promise<ArchiveModel>((resolve) => {
          resolveArchiveYoung = resolve;
        }),
      );

      const snapshotPromise = service.getStateSnapshotForOperationLogAsync();
      store.overrideSelector(selectTaskFeatureState, {
        ...mockTaskState,
        ids: ['task2'],
        entities: { task2: { id: 'task2', title: 'Later Task' } },
      } as any);
      store.refreshState();
      resolveArchiveYoung(mockArchiveYoung);

      const snapshot = await snapshotPromise;

      expect((snapshot.task as TaskState).ids).toEqual(['task1']);
    });
  });

  describe('backward compatibility aliases', () => {
    it('getAllSyncModelDataFromStore should call getStateSnapshot', () => {
      spyOn(service, 'getStateSnapshot').and.callThrough();

      service.getAllSyncModelDataFromStore();

      expect(service.getStateSnapshot).toHaveBeenCalled();
    });

    it('getAllSyncModelDataFromStoreAsync should call getStateSnapshotAsync', async () => {
      spyOn(service, 'getStateSnapshotAsync').and.callThrough();

      await service.getAllSyncModelDataFromStoreAsync();

      expect(service.getStateSnapshotAsync).toHaveBeenCalled();
    });
  });
});
