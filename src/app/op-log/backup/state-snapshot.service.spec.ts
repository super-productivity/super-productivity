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
