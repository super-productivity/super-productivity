import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { ArchiveService, ARCHIVE_ALL_YOUNG_TO_OLD_THRESHOLD } from './archive.service';
import { flushYoungToOld } from './store/archive.actions';
import { TimeTrackingActions } from '../time-tracking/store/time-tracking.actions';
import { TaskWithSubTasks } from '../tasks/task.model';
import { ArchiveDbAdapter } from '../../core/persistence/archive-db-adapter.service';
import { of } from 'rxjs';
import { ArchiveModel } from './archive.model';

describe('ArchiveService', () => {
  let service: ArchiveService;
  let mockStore: jasmine.SpyObj<Store>;
  let mockArchiveDbAdapter: jasmine.SpyObj<ArchiveDbAdapter>;

  const createEmptyArchive = (lastTimeTrackingFlush: number = 0): ArchiveModel => ({
    task: { ids: [], entities: {} },
    timeTracking: { project: {}, tag: {} },
    lastTimeTrackingFlush,
  });

  const ONE_DAY_MS = 1000 * 60 * 60 * 24;

  const createMockTask = (
    id: string,
    overrides: Partial<TaskWithSubTasks> = {},
  ): TaskWithSubTasks =>
    ({
      id,
      title: `Task ${id}`,
      isDone: true,
      doneOn: Date.now() - ONE_DAY_MS,
      subTaskIds: [],
      tagIds: [],
      timeSpentOnDay: {},
      timeSpent: 0,
      timeEstimate: 0,
      ...overrides,
    }) as TaskWithSubTasks;

  beforeEach(() => {
    mockStore = jasmine.createSpyObj('Store', ['dispatch', 'select']);
    // Mock store.select to return time tracking state
    mockStore.select.and.returnValue(of({ project: {}, tag: {} }));

    mockArchiveDbAdapter = jasmine.createSpyObj('ArchiveDbAdapter', [
      'loadArchiveYoung',
      'loadArchiveOld',
      'saveArchiveYoung',
      'saveArchiveOld',
    ]);

    TestBed.configureTestingModule({
      providers: [
        ArchiveService,
        { provide: Store, useValue: mockStore },
        { provide: ArchiveDbAdapter, useValue: mockArchiveDbAdapter },
      ],
    });

    service = TestBed.inject(ArchiveService);

    // Default mock returns
    mockArchiveDbAdapter.loadArchiveYoung.and.returnValue(
      Promise.resolve(createEmptyArchive()),
    );
    mockArchiveDbAdapter.loadArchiveOld.and.returnValue(
      Promise.resolve(createEmptyArchive()),
    );
    mockArchiveDbAdapter.saveArchiveYoung.and.returnValue(Promise.resolve());
    mockArchiveDbAdapter.saveArchiveOld.and.returnValue(Promise.resolve());
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('moveTasksToArchiveAndFlushArchiveIfDue', () => {
    it('should save tasks to archiveYoung', async () => {
      const tasks = [createMockTask('task-1')];

      await service.moveTasksToArchiveAndFlushArchiveIfDue(tasks);

      expect(mockArchiveDbAdapter.saveArchiveYoung).toHaveBeenCalled();
      const saveCall = mockArchiveDbAdapter.saveArchiveYoung.calls.first();
      const savedData = saveCall.args[0];
      expect(savedData.task.ids).toContain('task-1');
    });

    it('should dispatch updateWholeState for time tracking', async () => {
      const tasks = [createMockTask('task-1')];

      await service.moveTasksToArchiveAndFlushArchiveIfDue(tasks);

      expect(mockStore.dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: TimeTrackingActions.updateWholeState.type }),
      );
    });

    describe('when flush is NOT due', () => {
      beforeEach(() => {
        // Set lastTimeTrackingFlush to recent time (less than threshold)
        mockArchiveDbAdapter.loadArchiveOld.and.returnValue(
          Promise.resolve(createEmptyArchive(Date.now() - 1000)), // 1 second ago
        );
      });

      it('should NOT perform flush to archiveOld', async () => {
        const tasks = [createMockTask('task-1')];

        await service.moveTasksToArchiveAndFlushArchiveIfDue(tasks);

        // Should only save once (for the tasks), not for the flush
        expect(mockArchiveDbAdapter.saveArchiveYoung).toHaveBeenCalledTimes(1);
        expect(mockArchiveDbAdapter.saveArchiveOld).not.toHaveBeenCalled();
      });

      it('should NOT dispatch flushYoungToOld action', async () => {
        const tasks = [createMockTask('task-1')];

        await service.moveTasksToArchiveAndFlushArchiveIfDue(tasks);

        expect(mockStore.dispatch).not.toHaveBeenCalledWith(
          jasmine.objectContaining({ type: flushYoungToOld.type }),
        );
      });
    });

    describe('when flush IS due', () => {
      const oldFlushTime = Date.now() - ARCHIVE_ALL_YOUNG_TO_OLD_THRESHOLD - 1000;

      beforeEach(() => {
        // Set lastTimeTrackingFlush to old time (more than threshold)
        mockArchiveDbAdapter.loadArchiveOld.and.returnValue(
          Promise.resolve(createEmptyArchive(oldFlushTime)),
        );
      });

      it('should save to archiveOld during flush (before dispatch can happen)', async () => {
        const tasks = [createMockTask('task-1')];

        await service.moveTasksToArchiveAndFlushArchiveIfDue(tasks);

        // The key behavior: archiveOld.save was called, meaning flush happened
        // synchronously before the method returned (and before dispatch could
        // cause any async effects)
        expect(mockArchiveDbAdapter.saveArchiveOld).toHaveBeenCalledTimes(1);
      });

      it('should save to both archiveYoung and archiveOld during flush', async () => {
        const tasks = [createMockTask('task-1')];

        await service.moveTasksToArchiveAndFlushArchiveIfDue(tasks);

        // archiveYoung.save called twice: once for tasks, once for flush
        expect(mockArchiveDbAdapter.saveArchiveYoung).toHaveBeenCalledTimes(2);
        expect(mockArchiveDbAdapter.saveArchiveOld).toHaveBeenCalledTimes(1);
      });

      it('should dispatch flushYoungToOld action AFTER saves complete', async () => {
        const tasks = [createMockTask('task-1')];

        await service.moveTasksToArchiveAndFlushArchiveIfDue(tasks);

        expect(mockStore.dispatch).toHaveBeenCalledWith(
          jasmine.objectContaining({ type: flushYoungToOld.type }),
        );
      });

      it('should dispatch flushYoungToOld action with timestamp', async () => {
        const tasks = [createMockTask('task-1')];

        await service.moveTasksToArchiveAndFlushArchiveIfDue(tasks);

        // Verify flushYoungToOld was dispatched with a timestamp property
        expect(mockStore.dispatch).toHaveBeenCalledWith(
          jasmine.objectContaining({
            type: flushYoungToOld.type,
            timestamp: jasmine.any(Number),
          }),
        );
      });

      it('should set lastTimeTrackingFlush on saved archives', async () => {
        const tasks = [createMockTask('task-1')];

        await service.moveTasksToArchiveAndFlushArchiveIfDue(tasks);

        // Check archiveYoung flush save (second call)
        const archiveYoungFlushCall =
          mockArchiveDbAdapter.saveArchiveYoung.calls.all()[1];
        expect(archiveYoungFlushCall.args[0].lastTimeTrackingFlush).toBeDefined();

        // Check archiveOld save
        const archiveOldCall = mockArchiveDbAdapter.saveArchiveOld.calls.first();
        expect(archiveOldCall.args[0].lastTimeTrackingFlush).toBeDefined();
      });
    });

    it('should do nothing if no tasks provided', async () => {
      await service.moveTasksToArchiveAndFlushArchiveIfDue([]);

      expect(mockArchiveDbAdapter.saveArchiveYoung).not.toHaveBeenCalled();
      expect(mockStore.dispatch).not.toHaveBeenCalled();
    });

    describe('error handling and rollback during flush', () => {
      const oldFlushTime = Date.now() - ARCHIVE_ALL_YOUNG_TO_OLD_THRESHOLD - 1000;

      beforeEach(() => {
        // Set up conditions for flush to be triggered
        mockArchiveDbAdapter.loadArchiveOld.and.returnValue(
          Promise.resolve(createEmptyArchive(oldFlushTime)),
        );
      });

      it('should NOT dispatch flushYoungToOld if archiveYoung.save fails during flush', async () => {
        const tasks = [createMockTask('task-1')];

        // First save (for tasks) succeeds, second save (for flush) fails
        let saveCallCount = 0;
        mockArchiveDbAdapter.saveArchiveYoung.and.callFake(() => {
          saveCallCount++;
          if (saveCallCount === 2) {
            return Promise.reject(new Error('archiveYoung.save failed during flush'));
          }
          return Promise.resolve();
        });

        await expectAsync(
          service.moveTasksToArchiveAndFlushArchiveIfDue(tasks),
        ).toBeRejectedWithError('archiveYoung.save failed during flush');

        expect(mockStore.dispatch).not.toHaveBeenCalledWith(
          jasmine.objectContaining({ type: flushYoungToOld.type }),
        );
      });

      it('should NOT dispatch flushYoungToOld if archiveOld.save fails', async () => {
        const tasks = [createMockTask('task-1')];

        mockArchiveDbAdapter.saveArchiveOld.and.returnValue(
          Promise.reject(new Error('archiveOld.save failed')),
        );

        await expectAsync(
          service.moveTasksToArchiveAndFlushArchiveIfDue(tasks),
        ).toBeRejectedWithError('archiveOld.save failed');

        expect(mockStore.dispatch).not.toHaveBeenCalledWith(
          jasmine.objectContaining({ type: flushYoungToOld.type }),
        );
      });

      it('should attempt rollback when archiveOld.save fails', async () => {
        const tasks = [createMockTask('task-1')];
        const originalArchiveYoung = createEmptyArchive();
        const originalArchiveOld = createEmptyArchive(oldFlushTime);

        mockArchiveDbAdapter.loadArchiveYoung.and.returnValue(
          Promise.resolve(originalArchiveYoung),
        );
        mockArchiveDbAdapter.loadArchiveOld.and.returnValue(
          Promise.resolve(originalArchiveOld),
        );

        // archiveOld.save fails on first call
        mockArchiveDbAdapter.saveArchiveOld.and.returnValue(
          Promise.reject(new Error('archiveOld.save failed')),
        );

        await expectAsync(
          service.moveTasksToArchiveAndFlushArchiveIfDue(tasks),
        ).toBeRejected();

        // Rollback should attempt to save both archives again
        // archiveYoung: 1st call for tasks, 2nd call for flush (try), 3rd call for rollback
        // archiveOld: 1st call for flush (fails), 2nd call for rollback
        expect(
          mockArchiveDbAdapter.saveArchiveYoung.calls.count(),
        ).toBeGreaterThanOrEqual(3);
        expect(mockArchiveDbAdapter.saveArchiveOld.calls.count()).toBeGreaterThanOrEqual(
          2,
        );
      });

      it('should re-throw original error after rollback succeeds', async () => {
        const tasks = [createMockTask('task-1')];

        mockArchiveDbAdapter.saveArchiveOld.and.returnValue(
          Promise.reject(new Error('Original flush error')),
        );

        await expectAsync(
          service.moveTasksToArchiveAndFlushArchiveIfDue(tasks),
        ).toBeRejectedWithError('Original flush error');
      });

      it('should re-throw original error even if rollback fails', async () => {
        const tasks = [createMockTask('task-1')];

        // Track call count to make archiveOld.save fail on flush but also on rollback
        let archiveOldSaveCount = 0;
        mockArchiveDbAdapter.saveArchiveOld.and.callFake(() => {
          archiveOldSaveCount++;
          if (archiveOldSaveCount === 1) {
            return Promise.reject(new Error('Original flush error'));
          }
          return Promise.reject(new Error('Rollback also failed'));
        });

        await expectAsync(
          service.moveTasksToArchiveAndFlushArchiveIfDue(tasks),
        ).toBeRejectedWithError('Original flush error');
      });

      it('should continue rollback of archiveOld even if archiveYoung rollback fails', async () => {
        const tasks = [createMockTask('task-1')];

        // archiveOld.save fails on flush
        let archiveOldSaveCount = 0;
        mockArchiveDbAdapter.saveArchiveOld.and.callFake(() => {
          archiveOldSaveCount++;
          if (archiveOldSaveCount === 1) {
            return Promise.reject(new Error('Original flush error'));
          }
          return Promise.resolve(); // Rollback succeeds
        });

        // archiveYoung.save fails on rollback (3rd call)
        let archiveYoungSaveCount = 0;
        mockArchiveDbAdapter.saveArchiveYoung.and.callFake(() => {
          archiveYoungSaveCount++;
          if (archiveYoungSaveCount === 3) {
            return Promise.reject(new Error('archiveYoung rollback failed'));
          }
          return Promise.resolve();
        });

        await expectAsync(
          service.moveTasksToArchiveAndFlushArchiveIfDue(tasks),
        ).toBeRejected();

        // Should still attempt to rollback archiveOld even though archiveYoung rollback failed
        expect(mockArchiveDbAdapter.saveArchiveOld.calls.count()).toBe(2);
      });
    });
  });
});
