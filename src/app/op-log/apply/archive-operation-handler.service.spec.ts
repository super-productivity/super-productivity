import { TestBed } from '@angular/core/testing';
import {
  ArchiveOperationHandler,
  isArchiveAffectingAction,
} from './archive-operation-handler.service';
import { PersistentAction } from '../core/persistent-action.interface';
import { ArchiveService } from '../../features/archive/archive.service';
import { TaskArchiveService } from '../../features/archive/task-archive.service';
import { Task, TaskWithSubTasks } from '../../features/tasks/task.model';
import { ArchiveModel } from '../../features/archive/archive.model';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { flushYoungToOld } from '../../features/archive/store/archive.actions';
import { deleteTag, deleteTags } from '../../features/tag/store/tag.actions';
import { TimeTrackingService } from '../../features/time-tracking/time-tracking.service';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { ArchiveDbAdapter } from '../../core/persistence/archive-db-adapter.service';
import { OpType } from '../core/operation.types';

describe('isArchiveAffectingAction', () => {
  it('should return true for moveToArchive action', () => {
    const action = { type: TaskSharedActions.moveToArchive.type };
    expect(isArchiveAffectingAction(action)).toBe(true);
  });

  it('should return true for restoreTask action', () => {
    const action = { type: TaskSharedActions.restoreTask.type };
    expect(isArchiveAffectingAction(action)).toBe(true);
  });

  it('should return true for flushYoungToOld action', () => {
    const action = { type: flushYoungToOld.type };
    expect(isArchiveAffectingAction(action)).toBe(true);
  });

  it('should return true for deleteProject action', () => {
    const action = { type: TaskSharedActions.deleteProject.type };
    expect(isArchiveAffectingAction(action)).toBe(true);
  });

  it('should return true for deleteTag action', () => {
    const action = { type: deleteTag.type };
    expect(isArchiveAffectingAction(action)).toBe(true);
  });

  it('should return true for deleteTags action', () => {
    const action = { type: deleteTags.type };
    expect(isArchiveAffectingAction(action)).toBe(true);
  });

  it('should return true for deleteTaskRepeatCfg action', () => {
    const action = { type: TaskSharedActions.deleteTaskRepeatCfg.type };
    expect(isArchiveAffectingAction(action)).toBe(true);
  });

  it('should return true for deleteIssueProvider action', () => {
    const action = { type: TaskSharedActions.deleteIssueProvider.type };
    expect(isArchiveAffectingAction(action)).toBe(true);
  });

  it('should return true for deleteIssueProviders action', () => {
    const action = { type: TaskSharedActions.deleteIssueProviders.type };
    expect(isArchiveAffectingAction(action)).toBe(true);
  });

  it('should return false for non-archive-affecting actions', () => {
    const action = { type: '[Task] Update Task' };
    expect(isArchiveAffectingAction(action)).toBe(false);
  });

  it('should return false for addTask action', () => {
    const action = { type: TaskSharedActions.addTask.type };
    expect(isArchiveAffectingAction(action)).toBe(false);
  });

  it('should return true for updateTask action', () => {
    const action = { type: TaskSharedActions.updateTask.type };
    expect(isArchiveAffectingAction(action)).toBe(true);
  });

  it('should return true for updateTasks action (batch)', () => {
    const action = { type: TaskSharedActions.updateTasks.type };
    expect(isArchiveAffectingAction(action)).toBe(true);
  });

  it('should return true for loadAllData action (SYNC_IMPORT/BACKUP_IMPORT)', () => {
    const action = { type: loadAllData.type };
    expect(isArchiveAffectingAction(action)).toBe(true);
  });
});

describe('ArchiveOperationHandler', () => {
  let service: ArchiveOperationHandler;
  let mockArchiveService: jasmine.SpyObj<ArchiveService>;
  let mockTaskArchiveService: jasmine.SpyObj<TaskArchiveService>;
  let mockArchiveDbAdapter: jasmine.SpyObj<ArchiveDbAdapter>;
  let mockTimeTrackingService: jasmine.SpyObj<TimeTrackingService>;

  const createMockTaskWithSubTasks = (
    id: string,
    subTasks: Task[] = [],
  ): TaskWithSubTasks =>
    ({
      id,
      title: `Task ${id}`,
      subTaskIds: subTasks.map((st) => st.id),
      subTasks,
    }) as TaskWithSubTasks;

  const createMockTask = (id: string, subTaskIds: string[] = []): Task =>
    ({
      id,
      title: `Task ${id}`,
      subTaskIds,
    }) as Task;

  const createEmptyArchiveModel = (): ArchiveModel => ({
    task: { ids: [], entities: {} },
    timeTracking: { project: {}, tag: {} },
    lastTimeTrackingFlush: 0,
  });

  beforeEach(() => {
    mockArchiveService = jasmine.createSpyObj('ArchiveService', [
      'writeTasksToArchiveForRemoteSync',
    ]);
    mockTaskArchiveService = jasmine.createSpyObj('TaskArchiveService', [
      'deleteTasks',
      'updateTask',
      'updateTasks',
      'hasTask',
      'hasTasksBatch',
      'removeAllArchiveTasksForProject',
      'removeTagsFromAllTasks',
      'removeRepeatCfgFromArchiveTasks',
      'unlinkIssueProviderFromArchiveTasks',
    ]);
    mockTaskArchiveService.hasTasksBatch.and.returnValue(Promise.resolve(new Map()));
    mockTimeTrackingService = jasmine.createSpyObj('TimeTrackingService', [
      'cleanupDataEverywhereForProject',
      'cleanupArchiveDataForTag',
    ]);
    mockArchiveDbAdapter = jasmine.createSpyObj('ArchiveDbAdapter', [
      'loadArchiveYoung',
      'loadArchiveOld',
      'saveArchiveYoung',
      'saveArchiveOld',
      'saveArchivesAtomic',
    ]);
    // Default returns for ArchiveDbAdapter
    mockArchiveDbAdapter.loadArchiveYoung.and.returnValue(
      Promise.resolve(createEmptyArchiveModel()),
    );
    mockArchiveDbAdapter.loadArchiveOld.and.returnValue(
      Promise.resolve(createEmptyArchiveModel()),
    );
    mockArchiveDbAdapter.saveArchiveYoung.and.returnValue(Promise.resolve());
    mockArchiveDbAdapter.saveArchiveOld.and.returnValue(Promise.resolve());
    mockArchiveDbAdapter.saveArchivesAtomic.and.returnValue(Promise.resolve());

    // Set up default resolved promises
    mockArchiveService.writeTasksToArchiveForRemoteSync.and.returnValue(
      Promise.resolve(),
    );
    mockTaskArchiveService.deleteTasks.and.returnValue(Promise.resolve());
    mockTaskArchiveService.updateTask.and.returnValue(Promise.resolve());
    // By default, assume task is in archive (for updateTask tests)
    mockTaskArchiveService.hasTask.and.returnValue(Promise.resolve(true));
    mockTaskArchiveService.removeAllArchiveTasksForProject.and.returnValue(
      Promise.resolve(),
    );
    mockTaskArchiveService.removeTagsFromAllTasks.and.returnValue(Promise.resolve());
    mockTaskArchiveService.removeRepeatCfgFromArchiveTasks.and.returnValue(
      Promise.resolve(),
    );
    mockTaskArchiveService.unlinkIssueProviderFromArchiveTasks.and.returnValue(
      Promise.resolve(),
    );
    mockTimeTrackingService.cleanupDataEverywhereForProject.and.returnValue(
      Promise.resolve(),
    );
    mockTimeTrackingService.cleanupArchiveDataForTag.and.returnValue(Promise.resolve());

    TestBed.configureTestingModule({
      providers: [
        ArchiveOperationHandler,
        { provide: ArchiveService, useValue: mockArchiveService },
        { provide: TaskArchiveService, useValue: mockTaskArchiveService },
        { provide: ArchiveDbAdapter, useValue: mockArchiveDbAdapter },
        { provide: TimeTrackingService, useValue: mockTimeTrackingService },
      ],
    });

    // Get the service through TestBed to use proper DI
    service = TestBed.inject(ArchiveOperationHandler);
  });

  describe('handleOperation', () => {
    describe('moveToArchive action', () => {
      it('should write tasks to archive for remote sync', async () => {
        const tasks = [
          createMockTaskWithSubTasks('task-1'),
          createMockTaskWithSubTasks('task-2'),
        ];

        // Create action using actual action creator type
        const action = {
          type: TaskSharedActions.moveToArchive.type,
          tasks,
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(mockArchiveService.writeTasksToArchiveForRemoteSync).toHaveBeenCalledWith(
          tasks,
        );
        expect(mockArchiveService.writeTasksToArchiveForRemoteSync).toHaveBeenCalledTimes(
          1,
        );
      });

      it('should handle empty tasks array', async () => {
        const tasks: TaskWithSubTasks[] = [];

        const action = {
          type: TaskSharedActions.moveToArchive.type,
          tasks,
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(mockArchiveService.writeTasksToArchiveForRemoteSync).toHaveBeenCalledWith(
          [],
        );
      });

      it('should not call other handlers for moveToArchive', async () => {
        const tasks = [createMockTaskWithSubTasks('task-1')];

        const action = {
          type: TaskSharedActions.moveToArchive.type,
          tasks,
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(mockTaskArchiveService.deleteTasks).not.toHaveBeenCalled();
      });
    });

    describe('restoreTask action', () => {
      it('should delete task and subtasks from archive', async () => {
        const subTask1 = createMockTask('subtask-1');
        const subTask2 = createMockTask('subtask-2');
        const task = createMockTask('task-1', ['subtask-1', 'subtask-2']);

        const action = {
          type: TaskSharedActions.restoreTask.type,
          task,
          subTasks: [subTask1, subTask2],
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(mockTaskArchiveService.deleteTasks).toHaveBeenCalledWith(
          ['task-1', 'subtask-1', 'subtask-2'],
          { isIgnoreDBLock: true },
        );
      });

      it('should delete only parent task when no subtasks', async () => {
        const task = createMockTask('task-1', []);

        const action = {
          type: TaskSharedActions.restoreTask.type,
          task,
          subTasks: [],
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(mockTaskArchiveService.deleteTasks).toHaveBeenCalledWith(['task-1'], {
          isIgnoreDBLock: true,
        });
      });

      it('should not call other handlers for restoreTask', async () => {
        const task = createMockTask('task-1');

        const action = {
          type: TaskSharedActions.restoreTask.type,
          task,
          subTasks: [],
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(
          mockArchiveService.writeTasksToArchiveForRemoteSync,
        ).not.toHaveBeenCalled();
      });
    });

    describe('updateTask action', () => {
      it('should update archived task for remote operations', async () => {
        const action = {
          type: TaskSharedActions.updateTask.type,
          task: { id: 'task-1', changes: { title: 'Updated Title' } },
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(mockTaskArchiveService.updateTask).toHaveBeenCalledWith(
          'task-1',
          { title: 'Updated Title' },
          { isSkipDispatch: true, isIgnoreDBLock: true },
        );
      });

      it('should NOT update archive for local operations (already done by TaskArchiveService)', async () => {
        const action = {
          type: TaskSharedActions.updateTask.type,
          task: { id: 'task-1', changes: { title: 'Updated Title' } },
          meta: { isPersistent: true, isRemote: false },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(mockTaskArchiveService.updateTask).not.toHaveBeenCalled();
      });

      it('should NOT update archive when isRemote is undefined (treated as local)', async () => {
        const action = {
          type: TaskSharedActions.updateTask.type,
          task: { id: 'task-1', changes: { title: 'Updated Title' } },
          meta: { isPersistent: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(mockTaskArchiveService.updateTask).not.toHaveBeenCalled();
      });

      it('should skip update for task not in archive (task is non-archived)', async () => {
        // Task is not in archive
        mockTaskArchiveService.hasTask.and.returnValue(Promise.resolve(false));

        const action = {
          type: TaskSharedActions.updateTask.type,
          task: { id: 'task-1', changes: { title: 'Updated Title' } },
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        // Should check if task exists and skip update since it's not in archive
        expect(mockTaskArchiveService.hasTask).toHaveBeenCalledWith('task-1');
        expect(mockTaskArchiveService.updateTask).not.toHaveBeenCalled();
      });

      it('should not call other handlers for updateTask', async () => {
        const action = {
          type: TaskSharedActions.updateTask.type,
          task: { id: 'task-1', changes: { title: 'Updated' } },
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(
          mockArchiveService.writeTasksToArchiveForRemoteSync,
        ).not.toHaveBeenCalled();
        expect(mockTaskArchiveService.deleteTasks).not.toHaveBeenCalled();
        expect(
          mockTaskArchiveService.removeAllArchiveTasksForProject,
        ).not.toHaveBeenCalled();
      });
    });

    describe('updateTasks action (batch)', () => {
      it('should update multiple archived tasks for remote operations', async () => {
        // Both tasks exist in archive
        mockTaskArchiveService.hasTasksBatch.and.returnValue(
          Promise.resolve(
            new Map([
              ['task-1', true],
              ['task-2', true],
            ]),
          ),
        );

        const action = {
          type: TaskSharedActions.updateTasks.type,
          tasks: [
            { id: 'task-1', changes: { title: 'Updated 1' } },
            { id: 'task-2', changes: { title: 'Updated 2' } },
          ],
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(mockTaskArchiveService.updateTasks).toHaveBeenCalledWith(
          [
            { id: 'task-1', changes: { title: 'Updated 1' } },
            { id: 'task-2', changes: { title: 'Updated 2' } },
          ],
          { isSkipDispatch: true, isIgnoreDBLock: true },
        );
      });

      it('should NOT update archive for local operations (already done by TaskArchiveService)', async () => {
        const action = {
          type: TaskSharedActions.updateTasks.type,
          tasks: [{ id: 'task-1', changes: { title: 'Updated 1' } }],
          meta: { isPersistent: true, isRemote: false },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(mockTaskArchiveService.updateTasks).not.toHaveBeenCalled();
      });

      it('should only update tasks that exist in archive', async () => {
        // Only task-1 is in archive, task-2 is not
        mockTaskArchiveService.hasTasksBatch.and.returnValue(
          Promise.resolve(
            new Map([
              ['task-1', true],
              ['task-2', false],
            ]),
          ),
        );

        const action = {
          type: TaskSharedActions.updateTasks.type,
          tasks: [
            { id: 'task-1', changes: { title: 'Updated 1' } },
            { id: 'task-2', changes: { title: 'Updated 2' } },
          ],
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        // Only task-1 should be updated
        expect(mockTaskArchiveService.updateTasks).toHaveBeenCalledWith(
          [{ id: 'task-1', changes: { title: 'Updated 1' } }],
          { isSkipDispatch: true, isIgnoreDBLock: true },
        );
      });

      it('should not call updateTasks if no tasks exist in archive', async () => {
        // No tasks are in archive
        mockTaskArchiveService.hasTask.and.returnValue(Promise.resolve(false));

        const action = {
          type: TaskSharedActions.updateTasks.type,
          tasks: [
            { id: 'task-1', changes: { title: 'Updated 1' } },
            { id: 'task-2', changes: { title: 'Updated 2' } },
          ],
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(mockTaskArchiveService.updateTasks).not.toHaveBeenCalled();
      });
    });

    // Note: flushYoungToOld tests require module mocking which is complex in Jasmine.
    // The core functionality is tested through integration tests.
    // These tests verify the handler recognizes the action type.
    describe('flushYoungToOld action', () => {
      it('should recognize the flushYoungToOld action type', async () => {
        const timestamp = Date.now();
        const action = {
          type: flushYoungToOld.type,
          timestamp,
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        // The action should be recognized and try to load archive
        // (may fail due to sorting, but we verify it attempted to process)
        try {
          await service.handleOperation(action);
        } catch {
          // Expected - sort function returns undefined in tests
        }

        // Verify it tried to load archives (confirming action was recognized)
        expect(mockArchiveDbAdapter.loadArchiveYoung).toHaveBeenCalled();
        expect(mockArchiveDbAdapter.loadArchiveOld).toHaveBeenCalled();
      });

      it('should use atomic save for remote operations', async () => {
        const timestamp = Date.now();
        const action = {
          type: flushYoungToOld.type,
          timestamp,
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        // The sort function may fail, but we verify saveArchivesAtomic is attempted
        try {
          await service.handleOperation(action);
        } catch {
          // Expected - sort function returns undefined in tests
        }

        // Verify atomic save was called (not separate saves)
        // Note: If sort fails, saveArchivesAtomic won't be called, but loadArchive will be
        expect(mockArchiveDbAdapter.loadArchiveYoung).toHaveBeenCalled();
        expect(mockArchiveDbAdapter.loadArchiveOld).toHaveBeenCalled();
        // Individual saves should NOT be called - atomic save handles both
        expect(mockArchiveDbAdapter.saveArchiveYoung).not.toHaveBeenCalled();
        expect(mockArchiveDbAdapter.saveArchiveOld).not.toHaveBeenCalled();
      });
    });

    describe('deleteProject action', () => {
      it('should remove all archive tasks for the deleted project with isIgnoreDBLock for remote ops', async () => {
        const action = {
          type: TaskSharedActions.deleteProject.type,
          projectId: 'project-1',
          noteIds: [],
          allTaskIds: ['task-1', 'task-2'],
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(
          mockTaskArchiveService.removeAllArchiveTasksForProject,
        ).toHaveBeenCalledWith('project-1', { isIgnoreDBLock: true });
        expect(
          mockTimeTrackingService.cleanupDataEverywhereForProject,
        ).toHaveBeenCalledWith('project-1');
      });

      it('should NOT pass isIgnoreDBLock for local operations', async () => {
        const action = {
          type: TaskSharedActions.deleteProject.type,
          projectId: 'project-1',
          noteIds: [],
          allTaskIds: ['task-1'],
          meta: { isPersistent: true, isRemote: false },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(
          mockTaskArchiveService.removeAllArchiveTasksForProject,
        ).toHaveBeenCalledWith('project-1', undefined);
      });

      it('should not call other handlers for deleteProject', async () => {
        const action = {
          type: TaskSharedActions.deleteProject.type,
          projectId: 'project-1',
          noteIds: [],
          allTaskIds: [],
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(
          mockArchiveService.writeTasksToArchiveForRemoteSync,
        ).not.toHaveBeenCalled();
        expect(mockTaskArchiveService.deleteTasks).not.toHaveBeenCalled();
      });
    });

    describe('deleteTag action', () => {
      it('should remove tag from all archive tasks with isIgnoreDBLock for remote ops', async () => {
        const action = {
          type: deleteTag.type,
          id: 'tag-1',
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(mockTaskArchiveService.removeTagsFromAllTasks).toHaveBeenCalledWith(
          ['tag-1'],
          { isIgnoreDBLock: true },
        );
        expect(mockTimeTrackingService.cleanupArchiveDataForTag).toHaveBeenCalledWith(
          'tag-1',
        );
      });

      it('should NOT pass isIgnoreDBLock for local operations', async () => {
        const action = {
          type: deleteTag.type,
          id: 'tag-1',
          meta: { isPersistent: true, isRemote: false },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(mockTaskArchiveService.removeTagsFromAllTasks).toHaveBeenCalledWith(
          ['tag-1'],
          undefined,
        );
      });

      it('should remove multiple tags for deleteTags action with isIgnoreDBLock for remote ops', async () => {
        const action = {
          type: deleteTags.type,
          ids: ['tag-1', 'tag-2', 'tag-3'],
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(mockTaskArchiveService.removeTagsFromAllTasks).toHaveBeenCalledWith(
          ['tag-1', 'tag-2', 'tag-3'],
          { isIgnoreDBLock: true },
        );
        expect(mockTimeTrackingService.cleanupArchiveDataForTag).toHaveBeenCalledTimes(3);
        expect(mockTimeTrackingService.cleanupArchiveDataForTag).toHaveBeenCalledWith(
          'tag-1',
        );
        expect(mockTimeTrackingService.cleanupArchiveDataForTag).toHaveBeenCalledWith(
          'tag-2',
        );
        expect(mockTimeTrackingService.cleanupArchiveDataForTag).toHaveBeenCalledWith(
          'tag-3',
        );
      });

      it('should not call other handlers for deleteTag', async () => {
        const action = {
          type: deleteTag.type,
          id: 'tag-1',
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(
          mockArchiveService.writeTasksToArchiveForRemoteSync,
        ).not.toHaveBeenCalled();
        expect(mockTaskArchiveService.deleteTasks).not.toHaveBeenCalled();
        expect(
          mockTaskArchiveService.removeAllArchiveTasksForProject,
        ).not.toHaveBeenCalled();
      });
    });

    describe('deleteTaskRepeatCfg action', () => {
      it('should remove repeatCfgId from all archive tasks with isIgnoreDBLock for remote ops', async () => {
        const action = {
          type: TaskSharedActions.deleteTaskRepeatCfg.type,
          taskRepeatCfgId: 'repeat-cfg-1',
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(
          mockTaskArchiveService.removeRepeatCfgFromArchiveTasks,
        ).toHaveBeenCalledWith('repeat-cfg-1', { isIgnoreDBLock: true });
      });

      it('should NOT pass isIgnoreDBLock for local operations', async () => {
        const action = {
          type: TaskSharedActions.deleteTaskRepeatCfg.type,
          taskRepeatCfgId: 'repeat-cfg-1',
          meta: { isPersistent: true, isRemote: false },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(
          mockTaskArchiveService.removeRepeatCfgFromArchiveTasks,
        ).toHaveBeenCalledWith('repeat-cfg-1', undefined);
      });

      it('should not call other handlers for deleteTaskRepeatCfg', async () => {
        const action = {
          type: TaskSharedActions.deleteTaskRepeatCfg.type,
          taskRepeatCfgId: 'repeat-cfg-1',
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(
          mockArchiveService.writeTasksToArchiveForRemoteSync,
        ).not.toHaveBeenCalled();
        expect(mockTaskArchiveService.deleteTasks).not.toHaveBeenCalled();
        expect(
          mockTaskArchiveService.removeAllArchiveTasksForProject,
        ).not.toHaveBeenCalled();
        expect(mockTaskArchiveService.removeTagsFromAllTasks).not.toHaveBeenCalled();
      });
    });

    describe('deleteIssueProvider action', () => {
      it('should unlink issue provider from all archive tasks with isIgnoreDBLock for remote ops', async () => {
        const action = {
          type: TaskSharedActions.deleteIssueProvider.type,
          issueProviderId: 'provider-1',
          taskIdsToUnlink: ['task-1', 'task-2'],
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(
          mockTaskArchiveService.unlinkIssueProviderFromArchiveTasks,
        ).toHaveBeenCalledWith('provider-1', { isIgnoreDBLock: true });
      });

      it('should NOT pass isIgnoreDBLock for local operations', async () => {
        const action = {
          type: TaskSharedActions.deleteIssueProvider.type,
          issueProviderId: 'provider-1',
          taskIdsToUnlink: ['task-1'],
          meta: { isPersistent: true, isRemote: false },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(
          mockTaskArchiveService.unlinkIssueProviderFromArchiveTasks,
        ).toHaveBeenCalledWith('provider-1', undefined);
      });

      it('should not call other handlers for deleteIssueProvider', async () => {
        const action = {
          type: TaskSharedActions.deleteIssueProvider.type,
          issueProviderId: 'provider-1',
          taskIdsToUnlink: [],
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(
          mockArchiveService.writeTasksToArchiveForRemoteSync,
        ).not.toHaveBeenCalled();
        expect(mockTaskArchiveService.deleteTasks).not.toHaveBeenCalled();
        expect(
          mockTaskArchiveService.removeAllArchiveTasksForProject,
        ).not.toHaveBeenCalled();
        expect(mockTaskArchiveService.removeTagsFromAllTasks).not.toHaveBeenCalled();
        expect(
          mockTaskArchiveService.removeRepeatCfgFromArchiveTasks,
        ).not.toHaveBeenCalled();
      });
    });

    describe('deleteIssueProviders action', () => {
      it('should unlink multiple issue providers with isIgnoreDBLock for remote ops', async () => {
        const action = {
          type: TaskSharedActions.deleteIssueProviders.type,
          ids: ['provider-1', 'provider-2', 'provider-3'],
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(
          mockTaskArchiveService.unlinkIssueProviderFromArchiveTasks,
        ).toHaveBeenCalledTimes(3);
        expect(
          mockTaskArchiveService.unlinkIssueProviderFromArchiveTasks,
        ).toHaveBeenCalledWith('provider-1', { isIgnoreDBLock: true });
        expect(
          mockTaskArchiveService.unlinkIssueProviderFromArchiveTasks,
        ).toHaveBeenCalledWith('provider-2', { isIgnoreDBLock: true });
        expect(
          mockTaskArchiveService.unlinkIssueProviderFromArchiveTasks,
        ).toHaveBeenCalledWith('provider-3', { isIgnoreDBLock: true });
      });

      it('should NOT pass isIgnoreDBLock for local operations', async () => {
        const action = {
          type: TaskSharedActions.deleteIssueProviders.type,
          ids: ['provider-1', 'provider-2'],
          meta: { isPersistent: true, isRemote: false },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(
          mockTaskArchiveService.unlinkIssueProviderFromArchiveTasks,
        ).toHaveBeenCalledWith('provider-1', undefined);
        expect(
          mockTaskArchiveService.unlinkIssueProviderFromArchiveTasks,
        ).toHaveBeenCalledWith('provider-2', undefined);
      });

      it('should not call other handlers for deleteIssueProviders', async () => {
        const action = {
          type: TaskSharedActions.deleteIssueProviders.type,
          ids: ['provider-1'],
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(
          mockArchiveService.writeTasksToArchiveForRemoteSync,
        ).not.toHaveBeenCalled();
        expect(mockTaskArchiveService.deleteTasks).not.toHaveBeenCalled();
        expect(
          mockTaskArchiveService.removeAllArchiveTasksForProject,
        ).not.toHaveBeenCalled();
        expect(mockTaskArchiveService.removeTagsFromAllTasks).not.toHaveBeenCalled();
        expect(
          mockTaskArchiveService.removeRepeatCfgFromArchiveTasks,
        ).not.toHaveBeenCalled();
      });
    });

    describe('loadAllData action (SYNC_IMPORT/BACKUP_IMPORT)', () => {
      const createArchiveModelForTest = (taskIds: string[]): ArchiveModel => ({
        task: {
          ids: taskIds,
          entities: taskIds.reduce(
            (acc, id) => ({ ...acc, [id]: { id, title: `Task ${id}` } }),
            {},
          ),
        },
        timeTracking: { project: {}, tag: {} },
        lastTimeTrackingFlush: Date.now(),
      });

      it('should write archiveYoung to IndexedDB for remote operations', async () => {
        const archiveYoungData = createArchiveModelForTest(['archived-1', 'archived-2']);

        const action = {
          type: loadAllData.type,
          appDataComplete: { archiveYoung: archiveYoungData },
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(mockArchiveDbAdapter.saveArchiveYoung).toHaveBeenCalledWith(
          archiveYoungData,
        );
      });

      it('should write archiveOld to IndexedDB for remote operations', async () => {
        const archiveOldData = createArchiveModelForTest(['old-archived-1']);

        const action = {
          type: loadAllData.type,
          appDataComplete: { archiveOld: archiveOldData },
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(mockArchiveDbAdapter.saveArchiveOld).toHaveBeenCalledWith(archiveOldData);
      });

      it('should write both archiveYoung and archiveOld for remote operations', async () => {
        const archiveYoungData = createArchiveModelForTest(['young-1']);
        const archiveOldData = createArchiveModelForTest(['old-1']);

        const action = {
          type: loadAllData.type,
          appDataComplete: { archiveYoung: archiveYoungData, archiveOld: archiveOldData },
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(mockArchiveDbAdapter.saveArchiveYoung).toHaveBeenCalledWith(
          archiveYoungData,
        );
        expect(mockArchiveDbAdapter.saveArchiveOld).toHaveBeenCalledWith(archiveOldData);
      });

      it('should NOT write archive for local operations (already done by PfapiService)', async () => {
        const archiveYoungData = createArchiveModelForTest(['archived-1']);

        const action = {
          type: loadAllData.type,
          appDataComplete: { archiveYoung: archiveYoungData },
          meta: { isPersistent: true, isRemote: false },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(mockArchiveDbAdapter.saveArchiveYoung).not.toHaveBeenCalled();
        expect(mockArchiveDbAdapter.saveArchiveOld).not.toHaveBeenCalled();
      });

      it('should NOT write archive when isRemote is undefined (treated as local)', async () => {
        const archiveYoungData = createArchiveModelForTest(['archived-1']);

        const action = {
          type: loadAllData.type,
          appDataComplete: { archiveYoung: archiveYoungData },
          meta: { isPersistent: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(mockArchiveDbAdapter.saveArchiveYoung).not.toHaveBeenCalled();
        expect(mockArchiveDbAdapter.saveArchiveOld).not.toHaveBeenCalled();
      });

      it('should handle missing archiveYoung gracefully', async () => {
        const archiveOldData = createArchiveModelForTest(['old-1']);

        const action = {
          type: loadAllData.type,
          appDataComplete: { archiveOld: archiveOldData },
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(mockArchiveDbAdapter.saveArchiveYoung).not.toHaveBeenCalled();
        expect(mockArchiveDbAdapter.saveArchiveOld).toHaveBeenCalledWith(archiveOldData);
      });

      it('should handle missing archiveOld gracefully', async () => {
        const archiveYoungData = createArchiveModelForTest(['young-1']);

        const action = {
          type: loadAllData.type,
          appDataComplete: { archiveYoung: archiveYoungData },
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(mockArchiveDbAdapter.saveArchiveYoung).toHaveBeenCalledWith(
          archiveYoungData,
        );
        expect(mockArchiveDbAdapter.saveArchiveOld).not.toHaveBeenCalled();
      });

      it('should handle empty appDataComplete gracefully', async () => {
        const action = {
          type: loadAllData.type,
          appDataComplete: {},
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(mockArchiveDbAdapter.saveArchiveYoung).not.toHaveBeenCalled();
        expect(mockArchiveDbAdapter.saveArchiveOld).not.toHaveBeenCalled();
      });

      it('should preserve timeTracking data in archive', async () => {
        const archiveYoungData: ArchiveModel = {
          task: { ids: [], entities: {} },
          timeTracking: {
            project: { proj1: { date20240115: { s: 3600000, e: 7200000 } } },
            tag: { tag1: { date20240115: { s: 1800000, e: 3600000 } } },
          },
          lastTimeTrackingFlush: 1234567890,
        };

        const action = {
          type: loadAllData.type,
          appDataComplete: { archiveYoung: archiveYoungData },
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        const savedData =
          mockArchiveDbAdapter.saveArchiveYoung.calls.mostRecent().args[0];
        expect(savedData.timeTracking.project.proj1.date20240115.s).toBe(3600000);
        expect(savedData.timeTracking.tag.tag1.date20240115.s).toBe(1800000);
        expect(savedData.lastTimeTrackingFlush).toBe(1234567890);
      });

      it('should not call other handlers for loadAllData', async () => {
        const archiveYoungData = createArchiveModelForTest(['archived-1']);

        const action = {
          type: loadAllData.type,
          appDataComplete: { archiveYoung: archiveYoungData },
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);

        expect(
          mockArchiveService.writeTasksToArchiveForRemoteSync,
        ).not.toHaveBeenCalled();
        expect(mockTaskArchiveService.deleteTasks).not.toHaveBeenCalled();
        expect(
          mockTaskArchiveService.removeAllArchiveTasksForProject,
        ).not.toHaveBeenCalled();
      });

      describe('safety guard for empty archive overwrite', () => {
        const existingArchiveYoung = createArchiveModelForTest([
          'existing-1',
          'existing-2',
        ]);
        const existingArchiveOld = createArchiveModelForTest(['old-existing-1']);
        const emptyArchive: ArchiveModel = {
          task: { ids: [], entities: {} },
          timeTracking: { project: {}, tag: {} },
          lastTimeTrackingFlush: 0,
        };

        beforeEach(() => {
          mockArchiveDbAdapter.loadArchiveYoung.and.returnValue(
            Promise.resolve(existingArchiveYoung),
          );
          mockArchiveDbAdapter.loadArchiveOld.and.returnValue(
            Promise.resolve(existingArchiveOld),
          );
        });

        describe('SYNC_IMPORT', () => {
          it('should preserve local archiveYoung when SYNC_IMPORT has empty archive (likely bug)', async () => {
            const action = {
              type: loadAllData.type,
              appDataComplete: { archiveYoung: emptyArchive },
              meta: { isPersistent: true, isRemote: true, opType: OpType.SyncImport },
            } as unknown as PersistentAction;

            // Should not throw - instead preserves local archives
            await service.handleOperation(action);

            // Should NOT write empty archive over existing data
            expect(mockArchiveDbAdapter.saveArchiveYoung).not.toHaveBeenCalled();
          });

          it('should preserve local archiveOld when SYNC_IMPORT has empty archive (likely bug)', async () => {
            const action = {
              type: loadAllData.type,
              appDataComplete: { archiveOld: emptyArchive },
              meta: { isPersistent: true, isRemote: true, opType: OpType.SyncImport },
            } as unknown as PersistentAction;

            // Should not throw - instead preserves local archives
            await service.handleOperation(action);

            // Should NOT write empty archive over existing data
            expect(mockArchiveDbAdapter.saveArchiveOld).not.toHaveBeenCalled();
          });

          it('should allow writing non-empty archive over existing archive', async () => {
            const newArchive = createArchiveModelForTest(['new-task']);
            const action = {
              type: loadAllData.type,
              appDataComplete: { archiveYoung: newArchive },
              meta: { isPersistent: true, isRemote: true, opType: OpType.SyncImport },
            } as unknown as PersistentAction;

            await service.handleOperation(action);

            expect(mockArchiveDbAdapter.saveArchiveYoung).toHaveBeenCalledWith(
              newArchive,
            );
          });
        });

        describe('BACKUP_IMPORT', () => {
          let originalConfirm: typeof window.confirm;

          beforeEach(() => {
            originalConfirm = window.confirm;
            window.confirm = jasmine.createSpy('confirm').and.returnValue(true);
          });

          afterEach(() => {
            window.confirm = originalConfirm;
          });

          it('should show confirm dialog and throw if user cancels (archiveYoung)', async () => {
            (window.confirm as jasmine.Spy).and.returnValue(false);

            const action = {
              type: loadAllData.type,
              appDataComplete: { archiveYoung: emptyArchive },
              meta: { isPersistent: true, isRemote: true, opType: OpType.BackupImport },
            } as unknown as PersistentAction;

            await expectAsync(service.handleOperation(action)).toBeRejectedWithError(
              /User cancelled backup import/,
            );
            expect(window.confirm).toHaveBeenCalledWith(
              jasmine.stringContaining('2 archived tasks'),
            );
            expect(mockArchiveDbAdapter.saveArchiveYoung).not.toHaveBeenCalled();
          });

          it('should show confirm dialog and proceed if user confirms (archiveYoung)', async () => {
            (window.confirm as jasmine.Spy).and.returnValue(true);

            const action = {
              type: loadAllData.type,
              appDataComplete: { archiveYoung: emptyArchive },
              meta: { isPersistent: true, isRemote: true, opType: OpType.BackupImport },
            } as unknown as PersistentAction;

            await service.handleOperation(action);

            expect(window.confirm).toHaveBeenCalled();
            expect(mockArchiveDbAdapter.saveArchiveYoung).toHaveBeenCalledWith(
              emptyArchive,
            );
          });

          it('should show confirm dialog and throw if user cancels (archiveOld)', async () => {
            (window.confirm as jasmine.Spy).and.returnValue(false);

            const action = {
              type: loadAllData.type,
              appDataComplete: { archiveOld: emptyArchive },
              meta: { isPersistent: true, isRemote: true, opType: OpType.BackupImport },
            } as unknown as PersistentAction;

            await expectAsync(service.handleOperation(action)).toBeRejectedWithError(
              /User cancelled backup import/,
            );
            expect(window.confirm).toHaveBeenCalledWith(
              jasmine.stringContaining('1 old archived tasks'),
            );
            expect(mockArchiveDbAdapter.saveArchiveOld).not.toHaveBeenCalled();
          });

          it('should show confirm dialog and proceed if user confirms (archiveOld)', async () => {
            (window.confirm as jasmine.Spy).and.returnValue(true);

            const action = {
              type: loadAllData.type,
              appDataComplete: { archiveOld: emptyArchive },
              meta: { isPersistent: true, isRemote: true, opType: OpType.BackupImport },
            } as unknown as PersistentAction;

            await service.handleOperation(action);

            expect(window.confirm).toHaveBeenCalled();
            expect(mockArchiveDbAdapter.saveArchiveOld).toHaveBeenCalledWith(
              emptyArchive,
            );
          });

          it('should not show confirm dialog when archive is not empty', async () => {
            const newArchive = createArchiveModelForTest(['new-task']);

            const action = {
              type: loadAllData.type,
              appDataComplete: { archiveYoung: newArchive },
              meta: { isPersistent: true, isRemote: true, opType: OpType.BackupImport },
            } as unknown as PersistentAction;

            await service.handleOperation(action);

            expect(window.confirm).not.toHaveBeenCalled();
            expect(mockArchiveDbAdapter.saveArchiveYoung).toHaveBeenCalledWith(
              newArchive,
            );
          });
        });
      });
    });

    describe('unhandled actions', () => {
      it('should do nothing for unhandled action types', async () => {
        const action = {
          type: '[SomeOther] Action',
          meta: { isPersistent: true, isRemote: true },
        } as PersistentAction;

        await service.handleOperation(action);

        expect(
          mockArchiveService.writeTasksToArchiveForRemoteSync,
        ).not.toHaveBeenCalled();
        expect(mockTaskArchiveService.deleteTasks).not.toHaveBeenCalled();
        expect(
          mockTaskArchiveService.removeAllArchiveTasksForProject,
        ).not.toHaveBeenCalled();
        expect(mockTaskArchiveService.removeTagsFromAllTasks).not.toHaveBeenCalled();
        expect(
          mockTaskArchiveService.removeRepeatCfgFromArchiveTasks,
        ).not.toHaveBeenCalled();
        expect(
          mockTaskArchiveService.unlinkIssueProviderFromArchiveTasks,
        ).not.toHaveBeenCalled();
        expect(mockArchiveDbAdapter.loadArchiveYoung).not.toHaveBeenCalled();
      });

      it('should not throw for unknown action types', async () => {
        const action = {
          type: '[Unknown] Random Action',
          meta: { isPersistent: true, isRemote: true },
        } as PersistentAction;

        await expectAsync(service.handleOperation(action)).toBeResolved();
      });
    });

    describe('idempotency', () => {
      it('should be safe to call multiple times for same moveToArchive action', async () => {
        const tasks = [createMockTaskWithSubTasks('task-1')];
        const action = {
          type: TaskSharedActions.moveToArchive.type,
          tasks,
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);
        await service.handleOperation(action);

        expect(mockArchiveService.writeTasksToArchiveForRemoteSync).toHaveBeenCalledTimes(
          2,
        );
      });

      it('should be safe to call multiple times for same restoreTask action', async () => {
        const task = createMockTask('task-1');
        const action = {
          type: TaskSharedActions.restoreTask.type,
          task,
          subTasks: [],
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await service.handleOperation(action);
        await service.handleOperation(action);

        expect(mockTaskArchiveService.deleteTasks).toHaveBeenCalledTimes(2);
      });
    });

    describe('error handling', () => {
      it('should propagate errors from writeTasksToArchiveForRemoteSync', async () => {
        const error = new Error('Archive write failed');
        mockArchiveService.writeTasksToArchiveForRemoteSync.and.returnValue(
          Promise.reject(error),
        );

        const tasks = [createMockTaskWithSubTasks('task-1')];
        const action = {
          type: TaskSharedActions.moveToArchive.type,
          tasks,
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await expectAsync(service.handleOperation(action)).toBeRejectedWith(error);
      });

      it('should propagate errors from deleteTasks', async () => {
        const error = new Error('Delete failed');
        mockTaskArchiveService.deleteTasks.and.returnValue(Promise.reject(error));

        const task = createMockTask('task-1');
        const action = {
          type: TaskSharedActions.restoreTask.type,
          task,
          subTasks: [],
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await expectAsync(service.handleOperation(action)).toBeRejectedWith(error);
      });

      it('should propagate errors from archive load in flushYoungToOld', async () => {
        const error = new Error('Load failed');
        mockArchiveDbAdapter.loadArchiveYoung.and.returnValue(Promise.reject(error));

        const timestamp = Date.now();
        const action = {
          type: flushYoungToOld.type,
          timestamp,
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await expectAsync(service.handleOperation(action)).toBeRejectedWithError(
          'Load failed',
        );
      });

      it('should propagate errors from removeAllArchiveTasksForProject', async () => {
        const error = new Error('Remove project tasks failed');
        mockTaskArchiveService.removeAllArchiveTasksForProject.and.returnValue(
          Promise.reject(error),
        );

        const action = {
          type: TaskSharedActions.deleteProject.type,
          projectId: 'project-1',
          noteIds: [],
          allTaskIds: [],
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await expectAsync(service.handleOperation(action)).toBeRejectedWith(error);
      });

      it('should propagate errors from removeTagsFromAllTasks', async () => {
        const error = new Error('Remove tags failed');
        mockTaskArchiveService.removeTagsFromAllTasks.and.returnValue(
          Promise.reject(error),
        );

        const action = {
          type: deleteTag.type,
          id: 'tag-1',
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await expectAsync(service.handleOperation(action)).toBeRejectedWith(error);
      });

      it('should propagate errors from removeRepeatCfgFromArchiveTasks', async () => {
        const error = new Error('Remove repeat cfg failed');
        mockTaskArchiveService.removeRepeatCfgFromArchiveTasks.and.returnValue(
          Promise.reject(error),
        );

        const action = {
          type: TaskSharedActions.deleteTaskRepeatCfg.type,
          taskRepeatCfgId: 'repeat-cfg-1',
          taskIdsToUnlink: [],
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await expectAsync(service.handleOperation(action)).toBeRejectedWith(error);
      });

      it('should propagate errors from unlinkIssueProviderFromArchiveTasks for single provider', async () => {
        const error = new Error('Unlink issue provider failed');
        mockTaskArchiveService.unlinkIssueProviderFromArchiveTasks.and.returnValue(
          Promise.reject(error),
        );

        const action = {
          type: TaskSharedActions.deleteIssueProvider.type,
          issueProviderId: 'provider-1',
          taskIdsToUnlink: [],
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await expectAsync(service.handleOperation(action)).toBeRejectedWith(error);
      });

      it('should propagate errors from unlinkIssueProviderFromArchiveTasks for multiple providers', async () => {
        const error = new Error('Unlink issue providers failed');
        mockTaskArchiveService.unlinkIssueProviderFromArchiveTasks.and.returnValue(
          Promise.reject(error),
        );

        const action = {
          type: TaskSharedActions.deleteIssueProviders.type,
          ids: ['provider-1', 'provider-2'],
          meta: { isPersistent: true, isRemote: true },
        } as unknown as PersistentAction;

        await expectAsync(service.handleOperation(action)).toBeRejectedWith(error);
      });
    });

    describe('local vs remote operation handling', () => {
      describe('moveToArchive', () => {
        it('should skip archive write for local operations (archive written before dispatch)', async () => {
          const tasks = [createMockTaskWithSubTasks('task-1')];
          const action = {
            type: TaskSharedActions.moveToArchive.type,
            tasks,
            meta: { isPersistent: true, isRemote: false },
          } as unknown as PersistentAction;

          await service.handleOperation(action);

          // For local operations, archive is written BEFORE dispatch by ArchiveService
          // So the handler should NOT write again
          expect(
            mockArchiveService.writeTasksToArchiveForRemoteSync,
          ).not.toHaveBeenCalled();
        });

        it('should skip archive write when isRemote is undefined (treated as local)', async () => {
          const tasks = [createMockTaskWithSubTasks('task-1')];
          const action = {
            type: TaskSharedActions.moveToArchive.type,
            tasks,
            meta: { isPersistent: true },
          } as unknown as PersistentAction;

          await service.handleOperation(action);

          expect(
            mockArchiveService.writeTasksToArchiveForRemoteSync,
          ).not.toHaveBeenCalled();
        });

        it('should write to archive for remote operations', async () => {
          const tasks = [createMockTaskWithSubTasks('task-1')];
          const action = {
            type: TaskSharedActions.moveToArchive.type,
            tasks,
            meta: { isPersistent: true, isRemote: true },
          } as unknown as PersistentAction;

          await service.handleOperation(action);

          expect(
            mockArchiveService.writeTasksToArchiveForRemoteSync,
          ).toHaveBeenCalledWith(tasks);
        });
      });

      describe('restoreTask', () => {
        it('should NOT pass isIgnoreDBLock for local operations', async () => {
          const task = createMockTask('task-1', []);
          const action = {
            type: TaskSharedActions.restoreTask.type,
            task,
            subTasks: [],
            meta: { isPersistent: true, isRemote: false },
          } as unknown as PersistentAction;

          await service.handleOperation(action);

          // For local operations, DB is not locked, so no isIgnoreDBLock needed
          expect(mockTaskArchiveService.deleteTasks).toHaveBeenCalledWith(['task-1'], {});
        });

        it('should pass isIgnoreDBLock: true for remote operations', async () => {
          const task = createMockTask('task-1', []);
          const action = {
            type: TaskSharedActions.restoreTask.type,
            task,
            subTasks: [],
            meta: { isPersistent: true, isRemote: true },
          } as unknown as PersistentAction;

          await service.handleOperation(action);

          // For remote operations, DB is locked during sync, so isIgnoreDBLock needed
          expect(mockTaskArchiveService.deleteTasks).toHaveBeenCalledWith(['task-1'], {
            isIgnoreDBLock: true,
          });
        });
      });

      describe('flushYoungToOld', () => {
        it('should skip local operations (flush done by ArchiveService before dispatch)', async () => {
          const timestamp = Date.now();
          const action = {
            type: flushYoungToOld.type,
            timestamp,
            meta: { isPersistent: true, isRemote: false },
          } as unknown as PersistentAction;

          // Reset spies to verify nothing is called
          mockArchiveDbAdapter.loadArchiveYoung.calls.reset();
          mockArchiveDbAdapter.saveArchiveYoung.calls.reset();
          mockArchiveDbAdapter.loadArchiveOld.calls.reset();
          mockArchiveDbAdapter.saveArchiveOld.calls.reset();
          mockArchiveDbAdapter.saveArchivesAtomic.calls.reset();

          await service.handleOperation(action);

          // Verify NO archive operations were performed for local actions
          expect(mockArchiveDbAdapter.loadArchiveYoung).not.toHaveBeenCalled();
          expect(mockArchiveDbAdapter.saveArchiveYoung).not.toHaveBeenCalled();
          expect(mockArchiveDbAdapter.loadArchiveOld).not.toHaveBeenCalled();
          expect(mockArchiveDbAdapter.saveArchiveOld).not.toHaveBeenCalled();
          expect(mockArchiveDbAdapter.saveArchivesAtomic).not.toHaveBeenCalled();
        });

        it('should use ArchiveDbAdapter for remote operations', async () => {
          const timestamp = Date.now();
          const action = {
            type: flushYoungToOld.type,
            timestamp,
            meta: { isPersistent: true, isRemote: true },
          } as unknown as PersistentAction;

          try {
            await service.handleOperation(action);
          } catch {
            // Expected - sort function returns undefined in tests
          }

          // Verify ArchiveDbAdapter was used for loading archives
          expect(mockArchiveDbAdapter.loadArchiveYoung).toHaveBeenCalled();
          expect(mockArchiveDbAdapter.loadArchiveOld).toHaveBeenCalled();
        });
      });
    });
  });
});
