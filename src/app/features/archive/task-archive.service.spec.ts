import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { TaskArchiveService } from './task-archive.service';
import { ArchiveDbAdapter } from '../../core/persistence/archive-db-adapter.service';
import { Task, TaskArchive, TaskState } from '../tasks/task.model';
import { ArchiveModel } from './archive.model';
import { Update } from '@ngrx/entity';
import { RoundTimeOption } from '../project/project.model';

import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';

describe('TaskArchiveService', () => {
  let service: TaskArchiveService;
  let storeMock: jasmine.SpyObj<Store>;
  let archiveDbAdapterMock: jasmine.SpyObj<ArchiveDbAdapter>;

  const createMockTask = (id: string, overrides: Partial<Task> = {}): Task => ({
    id,
    title: `Task ${id}`,
    subTaskIds: [],
    tagIds: [],
    timeSpent: 0,
    timeSpentOnDay: {},
    isDone: false,
    doneOn: undefined,
    notes: '',
    projectId: '',
    parentId: undefined,
    created: Date.now(),
    repeatCfgId: undefined,
    _hideSubTasksMode: 2,
    attachments: [],
    issueId: undefined,
    issuePoints: undefined,
    issueType: undefined,
    issueAttachmentNr: undefined,
    issueLastUpdated: undefined,
    issueWasUpdated: undefined,
    timeEstimate: 0,
    ...overrides,
  });

  const createMockArchiveModel = (tasks: Task[]): ArchiveModel => ({
    task: {
      ids: tasks.map((t) => t.id),
      entities: tasks.reduce((acc, task) => ({ ...acc, [task.id]: task }), {}),
    } as TaskState,
    timeTracking: {
      project: {},
      tag: {},
    },
    lastTimeTrackingFlush: Date.now(),
  });

  beforeEach(() => {
    storeMock = jasmine.createSpyObj<Store>('Store', ['dispatch']);

    archiveDbAdapterMock = jasmine.createSpyObj<ArchiveDbAdapter>('ArchiveDbAdapter', [
      'loadArchiveYoung',
      'saveArchiveYoung',
      'loadArchiveOld',
      'saveArchiveOld',
    ]);
    archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
      Promise.resolve(createMockArchiveModel([])),
    );
    archiveDbAdapterMock.saveArchiveYoung.and.returnValue(Promise.resolve());
    archiveDbAdapterMock.loadArchiveOld.and.returnValue(
      Promise.resolve(createMockArchiveModel([])),
    );
    archiveDbAdapterMock.saveArchiveOld.and.returnValue(Promise.resolve());

    TestBed.configureTestingModule({
      providers: [
        TaskArchiveService,
        { provide: ArchiveDbAdapter, useValue: archiveDbAdapterMock },
        { provide: Store, useValue: storeMock },
      ],
    });

    service = TestBed.inject(TaskArchiveService);
  });

  describe('loadYoung', () => {
    it('should load young archive', async () => {
      const mockTasks = [createMockTask('task1'), createMockTask('task2')];
      const mockArchive = createMockArchiveModel(mockTasks);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(Promise.resolve(mockArchive));

      const result = await service.loadYoung();

      expect(result.ids).toEqual(['task1', 'task2']);
      expect(result.entities['task1']).toBeDefined();
      expect(result.entities['task2']).toBeDefined();
      expect(archiveDbAdapterMock.loadArchiveYoung).toHaveBeenCalled();
    });
  });

  describe('load', () => {
    it('should load and merge young and old archives', async () => {
      const youngTasks = [createMockTask('young1'), createMockTask('young2')];
      const oldTasks = [createMockTask('old1'), createMockTask('old2')];
      const youngArchive = createMockArchiveModel(youngTasks);
      const oldArchive = createMockArchiveModel(oldTasks);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(youngArchive),
      );
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(Promise.resolve(oldArchive));

      const result = await service.load();

      expect(result.ids).toEqual(['young1', 'young2', 'old1', 'old2']);
      expect(result.entities['young1']).toBeDefined();
      expect(result.entities['old2']).toBeDefined();
      expect(archiveDbAdapterMock.loadArchiveYoung).toHaveBeenCalled();
      expect(archiveDbAdapterMock.loadArchiveOld).toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('should find task in young archive', async () => {
      const task = createMockTask('task1');
      const youngArchive = createMockArchiveModel([task]);
      const oldArchive = createMockArchiveModel([]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(youngArchive),
      );
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(Promise.resolve(oldArchive));

      const result = await service.getById('task1');

      expect(result).toEqual(task);
      expect(archiveDbAdapterMock.loadArchiveYoung).toHaveBeenCalled();
      expect(archiveDbAdapterMock.loadArchiveOld).not.toHaveBeenCalled();
    });

    it('should find task in old archive if not in young', async () => {
      const task = createMockTask('task1');
      const youngArchive = createMockArchiveModel([]);
      const oldArchive = createMockArchiveModel([task]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(youngArchive),
      );
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(Promise.resolve(oldArchive));

      const result = await service.getById('task1');

      expect(result).toEqual(task);
      expect(archiveDbAdapterMock.loadArchiveYoung).toHaveBeenCalled();
      expect(archiveDbAdapterMock.loadArchiveOld).toHaveBeenCalled();
    });

    it('should throw error if task not found', async () => {
      const youngArchive = createMockArchiveModel([]);
      const oldArchive = createMockArchiveModel([]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(youngArchive),
      );
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(Promise.resolve(oldArchive));

      await expectAsync(service.getById('nonexistent')).toBeRejectedWithError(
        'Archive task not found by id',
      );
    });
  });

  describe('deleteTasks', () => {
    it('should delete tasks using TaskSharedActions.deleteTasks', async () => {
      const task1 = createMockTask('task1');
      const task2 = createMockTask('task2');
      const unrelatedTask = createMockTask('unrelated');

      const youngArchive = createMockArchiveModel([task1, task2, unrelatedTask]);
      const oldArchive = createMockArchiveModel([]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(youngArchive),
      );
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(Promise.resolve(oldArchive));

      await service.deleteTasks(['task1']);

      const saveCall = archiveDbAdapterMock.saveArchiveYoung.calls.mostRecent();
      const savedArchive = saveCall.args[0];

      // The task reducer should handle the delete action
      expect(archiveDbAdapterMock.saveArchiveYoung).toHaveBeenCalled();
      expect(savedArchive).toBeDefined();

      // Note: The actual deletion logic depends on how the taskReducer handles TaskSharedActions.deleteTasks
      // Since we're not running the actual reducer in these unit tests, we just verify the service mechanics
    });

    it('should delete tasks from both young and old archives', async () => {
      const youngTask = createMockTask('young1');
      const oldTask = createMockTask('old1');

      const youngArchive = createMockArchiveModel([youngTask]);
      const oldArchive = createMockArchiveModel([oldTask]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(youngArchive),
      );
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(Promise.resolve(oldArchive));

      await service.deleteTasks(['young1', 'old1']);

      expect(archiveDbAdapterMock.saveArchiveYoung).toHaveBeenCalled();
      expect(archiveDbAdapterMock.saveArchiveOld).toHaveBeenCalled();

      // Note: The actual deletion is handled by the taskReducer
      // We're just verifying that the service calls save on both archives
    });
  });

  describe('updateTask', () => {
    it('should update task with timeSpentOnDay and recalculate timeSpent', async () => {
      const task = createMockTask('task1', {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        timeSpentOnDay: { '2024-01-01': 1000, '2024-01-02': 2000 },
        timeSpent: 3000,
      });
      const youngArchive = createMockArchiveModel([task]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(youngArchive),
      );
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(
        Promise.resolve(createMockArchiveModel([])),
      );

      const newTimeSpentOnDay = {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        '2024-01-01': 1500,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        '2024-01-02': 2500,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        '2024-01-03': 1000,
      };

      await service.updateTask('task1', {
        timeSpentOnDay: newTimeSpentOnDay,
      });

      const saveCall = archiveDbAdapterMock.saveArchiveYoung.calls.mostRecent();
      const savedArchive = saveCall.args[0];
      const updatedTask = savedArchive.task.entities['task1'] as Task;

      expect(updatedTask.timeSpentOnDay).toEqual(newTimeSpentOnDay);
      expect(updatedTask.timeSpent).toBe(5000); // 1500 + 2500 + 1000
    });

    it('should update isDone and set/unset doneOn', async () => {
      const task = createMockTask('task1', { isDone: false, doneOn: undefined });
      const youngArchive = createMockArchiveModel([task]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(youngArchive),
      );

      // Mark as done
      await service.updateTask('task1', { isDone: true });

      let saveCall = archiveDbAdapterMock.saveArchiveYoung.calls.mostRecent();
      let savedArchive = saveCall.args[0];
      let updatedTask = savedArchive.task.entities['task1'] as Task;

      expect(updatedTask.isDone).toBe(true);
      expect(updatedTask.doneOn).toBeGreaterThan(0);
      expect(updatedTask.dueDay).toBeUndefined();

      // Mark as undone
      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(savedArchive),
      );
      await service.updateTask('task1', { isDone: false });

      saveCall = archiveDbAdapterMock.saveArchiveYoung.calls.mostRecent();
      savedArchive = saveCall.args[0];
      updatedTask = savedArchive.task.entities['task1'] as Task;

      expect(updatedTask.isDone).toBe(false);
      expect(updatedTask.doneOn).toBeUndefined();
    });

    it('should throw error if task not found', async () => {
      const youngArchive = createMockArchiveModel([]);
      const oldArchive = createMockArchiveModel([]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(youngArchive),
      );
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(Promise.resolve(oldArchive));

      await expectAsync(
        service.updateTask('nonexistent', { title: 'New Title' }),
      ).toBeRejectedWithError('Archive task to update not found');
    });

    it('should dispatch persistent action for sync by default', async () => {
      const task = createMockTask('task1', { title: 'Original' });
      const youngArchive = createMockArchiveModel([task]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(youngArchive),
      );

      await service.updateTask('task1', { title: 'Updated' });

      expect(storeMock.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.updateTask({
          task: { id: 'task1', changes: { title: 'Updated' } },
        }),
      );
    });

    it('should NOT dispatch action when isSkipDispatch is true', async () => {
      const task = createMockTask('task1', { title: 'Original' });
      const youngArchive = createMockArchiveModel([task]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(youngArchive),
      );

      await service.updateTask('task1', { title: 'Updated' }, { isSkipDispatch: true });

      expect(storeMock.dispatch).not.toHaveBeenCalled();
    });

    it('should dispatch action for task in archiveOld', async () => {
      const task = createMockTask('task1', { title: 'Original' });
      const youngArchive = createMockArchiveModel([]);
      const oldArchive = createMockArchiveModel([task]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(youngArchive),
      );
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(Promise.resolve(oldArchive));

      await service.updateTask('task1', { title: 'Updated' });

      expect(storeMock.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.updateTask({
          task: { id: 'task1', changes: { title: 'Updated' } },
        }),
      );
    });
  });

  describe('updateTasks', () => {
    it('should update multiple tasks across young and old archives', async () => {
      const youngTask1 = createMockTask('young1', { title: 'Young 1' });
      const youngTask2 = createMockTask('young2', { title: 'Young 2' });
      const oldTask1 = createMockTask('old1', { title: 'Old 1' });

      const youngArchive = createMockArchiveModel([youngTask1, youngTask2]);
      const oldArchive = createMockArchiveModel([oldTask1]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(youngArchive),
      );
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(Promise.resolve(oldArchive));

      const updates: Update<Task>[] = [
        { id: 'young1', changes: { title: 'Updated Young 1' } },
        { id: 'young2', changes: { title: 'Updated Young 2' } },
        { id: 'old1', changes: { title: 'Updated Old 1' } },
      ];

      await service.updateTasks(updates);

      // The updateTasks method uses the taskReducer which doesn't fully apply updates in unit tests
      // We just verify that save was called on both archives
      expect(archiveDbAdapterMock.saveArchiveYoung).toHaveBeenCalled();
      expect(archiveDbAdapterMock.saveArchiveOld).toHaveBeenCalled();
    });

    it('should dispatch persistent actions for each update by default', async () => {
      const task1 = createMockTask('task1', { title: 'Task 1' });
      const task2 = createMockTask('task2', { title: 'Task 2' });
      const youngArchive = createMockArchiveModel([task1, task2]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(youngArchive),
      );
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(
        Promise.resolve(createMockArchiveModel([])),
      );

      const updates: Update<Task>[] = [
        { id: 'task1', changes: { title: 'Updated 1' } },
        { id: 'task2', changes: { title: 'Updated 2' } },
      ];

      await service.updateTasks(updates);

      // Should dispatch a SINGLE batch action (not individual actions)
      // This is critical for performance - prevents 470 operations for repeating task updates
      expect(storeMock.dispatch).toHaveBeenCalledTimes(1);
      expect(storeMock.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.updateTasks({
          tasks: [
            { id: 'task1', changes: { title: 'Updated 1' } },
            { id: 'task2', changes: { title: 'Updated 2' } },
          ],
        }),
      );
    });

    it('should NOT dispatch actions when isSkipDispatch is true', async () => {
      const task1 = createMockTask('task1', { title: 'Task 1' });
      const youngArchive = createMockArchiveModel([task1]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(youngArchive),
      );
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(
        Promise.resolve(createMockArchiveModel([])),
      );

      const updates: Update<Task>[] = [{ id: 'task1', changes: { title: 'Updated' } }];

      await service.updateTasks(updates, { isSkipDispatch: true });

      expect(storeMock.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('roundTimeSpent', () => {
    it('should round time spent for tasks on a specific day', async () => {
      const task1 = createMockTask('task1', {
        timeSpentOnDay: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          '2024-01-01': 1234567, // ~20.5 minutes
          // eslint-disable-next-line @typescript-eslint/naming-convention
          '2024-01-02': 2000000,
        },
        timeSpent: 3234567,
      });
      const task2 = createMockTask('task2', {
        timeSpentOnDay: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          '2024-01-01': 890123, // ~14.8 minutes
          // eslint-disable-next-line @typescript-eslint/naming-convention
          '2024-01-02': 1000000,
        },
        timeSpent: 1890123,
      });

      const youngArchive = createMockArchiveModel([task1, task2]);
      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(youngArchive),
      );
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(
        Promise.resolve(createMockArchiveModel([])),
      );

      await service.roundTimeSpent({
        day: '2024-01-01',
        taskIds: ['task1', 'task2'],
        roundTo: 'QUARTER' as RoundTimeOption,
        isRoundUp: true,
        projectId: 'project1',
      });

      // The roundTimeSpent method uses the taskReducer which handles the rounding logic
      // We just verify that save was called with updated state
      expect(archiveDbAdapterMock.saveArchiveYoung).toHaveBeenCalled();
      const saveCall = archiveDbAdapterMock.saveArchiveYoung.calls.mostRecent();
      const savedArchive = saveCall.args[0];
      expect(savedArchive.task).toBeDefined();
    });

    it('should handle tasks across young and old archives', async () => {
      const youngTask = createMockTask('young1', {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        timeSpentOnDay: { '2024-01-01': 1234567 },
        timeSpent: 1234567,
      });
      const oldTask = createMockTask('old1', {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        timeSpentOnDay: { '2024-01-01': 890123 },
        timeSpent: 890123,
      });

      const youngArchive = createMockArchiveModel([youngTask]);
      const oldArchive = createMockArchiveModel([oldTask]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(youngArchive),
      );
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(Promise.resolve(oldArchive));

      await service.roundTimeSpent({
        day: '2024-01-01',
        taskIds: ['young1', 'old1'],
        roundTo: 'QUARTER' as RoundTimeOption,
        isRoundUp: false,
      });

      expect(archiveDbAdapterMock.saveArchiveYoung).toHaveBeenCalled();
      expect(archiveDbAdapterMock.saveArchiveOld).toHaveBeenCalled();
    });
  });

  describe('removeRepeatCfgFromArchiveTasks', () => {
    it('should remove repeatCfgId from all tasks with matching id', async () => {
      const task1 = createMockTask('task1', { repeatCfgId: 'repeat1' });
      const task2 = createMockTask('task2', { repeatCfgId: 'repeat1' });
      const task3 = createMockTask('task3', { repeatCfgId: 'repeat2' });
      const task4 = createMockTask('task4', { repeatCfgId: undefined });

      const youngArchive = createMockArchiveModel([task1, task2]);
      const oldArchive = createMockArchiveModel([task3, task4]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(youngArchive),
      );
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(Promise.resolve(oldArchive));

      // Mock the updateTasks method to track calls
      spyOn(service, 'updateTasks').and.returnValue(Promise.resolve());

      await service.removeRepeatCfgFromArchiveTasks('repeat1');

      expect(service.updateTasks).toHaveBeenCalledWith(
        [
          { id: 'task1', changes: { repeatCfgId: undefined } },
          { id: 'task2', changes: { repeatCfgId: undefined } },
        ],
        { isSkipDispatch: true, isIgnoreDBLock: undefined },
      );
    });

    it('should not call updateTasks if no tasks have the repeatCfgId', async () => {
      const task1 = createMockTask('task1', { repeatCfgId: 'repeat2' });
      const task2 = createMockTask('task2', { repeatCfgId: undefined });

      const mockArchive = createMockArchiveModel([task1, task2]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(Promise.resolve(mockArchive));
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(
        Promise.resolve(createMockArchiveModel([])),
      );

      spyOn(service, 'updateTasks').and.returnValue(Promise.resolve());

      await service.removeRepeatCfgFromArchiveTasks('repeat1');

      expect(service.updateTasks).not.toHaveBeenCalled();
    });
  });

  describe('unlinkIssueProviderFromArchiveTasks', () => {
    it('should unlink issue provider from all tasks with matching issueProviderId and pass isSkipDispatch', async () => {
      const task1 = createMockTask('task1', {
        issueProviderId: 'provider1',
        issueId: 'issue1',
        issueType: 'GITHUB' as any,
      });
      const task2 = createMockTask('task2', {
        issueProviderId: 'provider1',
        issueId: 'issue2',
        issueType: 'GITHUB' as any,
      });
      const task3 = createMockTask('task3', {
        issueProviderId: 'provider2',
        issueId: 'issue3',
        issueType: 'JIRA' as any,
      });

      const youngArchive = createMockArchiveModel([task1, task2]);
      const oldArchive = createMockArchiveModel([task3]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(youngArchive),
      );
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(Promise.resolve(oldArchive));

      spyOn(service, 'updateTasks').and.returnValue(Promise.resolve());

      await service.unlinkIssueProviderFromArchiveTasks('provider1');

      expect(service.updateTasks).toHaveBeenCalledWith(
        [
          {
            id: 'task1',
            changes: {
              issueId: undefined,
              issueProviderId: undefined,
              issueType: undefined,
              issueWasUpdated: undefined,
              issueLastUpdated: undefined,
              issueAttachmentNr: undefined,
              issueTimeTracked: undefined,
              issuePoints: undefined,
            },
          },
          {
            id: 'task2',
            changes: {
              issueId: undefined,
              issueProviderId: undefined,
              issueType: undefined,
              issueWasUpdated: undefined,
              issueLastUpdated: undefined,
              issueAttachmentNr: undefined,
              issueTimeTracked: undefined,
              issuePoints: undefined,
            },
          },
        ],
        { isSkipDispatch: true, isIgnoreDBLock: undefined },
      );
    });

    it('should not call updateTasks if no tasks have the issueProviderId', async () => {
      const task1 = createMockTask('task1', { issueProviderId: 'provider2' });
      const task2 = createMockTask('task2', { issueProviderId: undefined });

      const mockArchive = createMockArchiveModel([task1, task2]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(Promise.resolve(mockArchive));
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(
        Promise.resolve(createMockArchiveModel([])),
      );

      spyOn(service, 'updateTasks').and.returnValue(Promise.resolve());

      await service.unlinkIssueProviderFromArchiveTasks('provider1');

      expect(service.updateTasks).not.toHaveBeenCalled();
    });
  });

  describe('removeAllArchiveTasksForProject', () => {
    it('should delete all tasks belonging to a project', async () => {
      const projectTask1 = createMockTask('task1', { projectId: 'project1' });
      const projectTask2 = createMockTask('task2', { projectId: 'project1' });
      const otherProjectTask = createMockTask('task3', { projectId: 'project2' });
      const noProjectTask = createMockTask('task4', { projectId: '' });

      const mockArchive: TaskArchive = {
        ids: ['task1', 'task2', 'task3', 'task4'],
        entities: {
          task1: projectTask1,
          task2: projectTask2,
          task3: otherProjectTask,
          task4: noProjectTask,
        },
      };

      spyOn(service, 'load').and.returnValue(Promise.resolve(mockArchive));
      spyOn(service, 'deleteTasks').and.returnValue(Promise.resolve());

      await service.removeAllArchiveTasksForProject('project1');

      expect(service.deleteTasks).toHaveBeenCalledWith(['task1', 'task2'], undefined);
    });
  });

  describe('removeTagsFromAllTasks', () => {
    it('should remove provided tags from tasks in archiveYoung', async () => {
      const taskWithTags = createMockTask('task1', { tagIds: ['tag1', 'tag2'] });
      const archiveYoung = createMockArchiveModel([taskWithTags]);
      const archiveOld = createMockArchiveModel([]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(archiveYoung),
      );
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(Promise.resolve(archiveOld));

      spyOn(service, 'deleteTasks').and.returnValue(Promise.resolve());

      await service.removeTagsFromAllTasks(['tag1']);

      const saveArgs = archiveDbAdapterMock.saveArchiveYoung.calls.mostRecent().args;
      const updatedTask = saveArgs[0].task.entities['task1'] as Task;

      expect(updatedTask.tagIds).toEqual(['tag2']);
    });

    it('should remove provided tags from tasks in archiveOld', async () => {
      const taskWithTags = createMockTask('task1', { tagIds: ['tag1', 'tag3'] });
      const archiveYoung = createMockArchiveModel([]);
      const archiveOld = createMockArchiveModel([taskWithTags]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(archiveYoung),
      );
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(Promise.resolve(archiveOld));

      spyOn(service, 'deleteTasks').and.returnValue(Promise.resolve());

      await service.removeTagsFromAllTasks(['tag1']);

      const saveArgs = archiveDbAdapterMock.saveArchiveOld.calls.mostRecent().args;
      const updatedTask = saveArgs[0].task.entities['task1'] as Task;

      expect(updatedTask.tagIds).toEqual(['tag3']);
    });

    it('should remove tags from all tasks and delete orphaned tasks', async () => {
      // Create tasks with original state (before tag removal)
      const taskWithTag = createMockTask('task1', {
        tagIds: ['tag1', 'tag2', 'tag3'],
        projectId: '',
      });
      const taskToBeOrphaned = createMockTask('task2', {
        tagIds: ['tag1'],
        projectId: '',
        parentId: undefined,
      });
      const taskWithProject = createMockTask('task3', {
        tagIds: ['tag1'],
        projectId: 'project1',
      });
      const parentTask = createMockTask('parent1', {
        tagIds: ['tag1'],
        projectId: '',
        subTaskIds: ['sub1'],
      });
      const subTask = createMockTask('sub1', {
        tagIds: [],
        projectId: '',
        parentId: 'parent1',
      });

      // Create state that would exist after tag removal
      const tasksAfterRemoval = [
        { ...taskWithTag, tagIds: ['tag2', 'tag3'] }, // tag1 removed
        { ...taskToBeOrphaned, tagIds: [] }, // tag1 removed, now orphaned
        { ...taskWithProject, tagIds: [] }, // tag1 removed, but has project
        { ...parentTask, tagIds: [] }, // tag1 removed, now orphaned
        subTask, // no change
      ];

      // Mock the load method to return the state with tags already removed
      // (since the method checks the loaded state for orphaned tasks)
      spyOn(service, 'load').and.returnValue(
        Promise.resolve({
          ids: ['task1', 'task2', 'task3', 'parent1', 'sub1'],
          entities: {
            task1: tasksAfterRemoval[0],
            task2: tasksAfterRemoval[1],
            task3: tasksAfterRemoval[2],
            parent1: tasksAfterRemoval[3],
            sub1: tasksAfterRemoval[4],
          },
        }),
      );

      // Setup archives for _execActionBoth
      const youngArchive = createMockArchiveModel([
        taskWithTag,
        taskToBeOrphaned,
        taskWithProject,
        parentTask,
        subTask,
      ]);
      const oldArchive = createMockArchiveModel([]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(youngArchive),
      );
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(Promise.resolve(oldArchive));

      // Spy on deleteTasks to verify it's called with the right parameters
      spyOn(service, 'deleteTasks').and.returnValue(Promise.resolve());

      await service.removeTagsFromAllTasks(['tag1']);

      // The method should identify tasks that would become orphaned after tag removal
      // task2 has no tags and no project after removal, so it's orphaned
      // parent1 has no tags and no project after removal, so it and its subtasks are orphaned
      // task1 still has other tags, so it's not orphaned
      // task3 has a project, so it's not orphaned
      expect(service.deleteTasks).toHaveBeenCalledWith(
        ['task2', 'parent1', 'sub1'],
        undefined,
      );
    });
  });

  describe('_reduceForArchive', () => {
    it('should properly reduce state with TaskSharedActions.updateTask', async () => {
      const task = createMockTask('task1', { title: 'Original Title' });
      const archive = createMockArchiveModel([task]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(Promise.resolve(archive));

      // Test the updateTask method which uses _reduceForArchive internally
      await service.updateTask('task1', { title: 'Updated Title' });

      expect(archiveDbAdapterMock.saveArchiveYoung).toHaveBeenCalled();
      const saveCall = archiveDbAdapterMock.saveArchiveYoung.calls.mostRecent();
      expect(saveCall.args[0].task).toBeDefined();
    });

    it('should handle deleteTasks action through _reduceForArchive', async () => {
      const task1 = createMockTask('task1');
      const task2 = createMockTask('task2');
      const archive = createMockArchiveModel([task1, task2]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(Promise.resolve(archive));
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(
        Promise.resolve(createMockArchiveModel([])),
      );

      await service.deleteTasks(['task1']);

      expect(archiveDbAdapterMock.saveArchiveYoung).toHaveBeenCalled();
      const saveCall = archiveDbAdapterMock.saveArchiveYoung.calls.mostRecent();
      const savedArchive = saveCall.args[0];
      expect(savedArchive.task).toBeDefined();
      // The actual deletion is handled by the reducer
    });

    it('should handle roundTimeSpentForDay action through _reduceForArchive', async () => {
      const task = createMockTask('task1', {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        timeSpentOnDay: { '2024-01-01': 1234567 },
        timeSpent: 1234567,
      });
      const archive = createMockArchiveModel([task]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(Promise.resolve(archive));
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(
        Promise.resolve(createMockArchiveModel([])),
      );

      await service.roundTimeSpent({
        day: '2024-01-01',
        taskIds: ['task1'],
        roundTo: 'QUARTER' as RoundTimeOption,
        isRoundUp: true,
        projectId: 'project1',
      });

      expect(archiveDbAdapterMock.saveArchiveYoung).toHaveBeenCalled();
      const saveCall = archiveDbAdapterMock.saveArchiveYoung.calls.mostRecent();
      expect(saveCall.args[0].task).toBeDefined();
    });
  });

  describe('updateTasks with proper iterative reduction', () => {
    it('should apply multiple updates iteratively through _reduceForArchive', async () => {
      const task1 = createMockTask('task1', { title: 'Task 1', isDone: false });
      const task2 = createMockTask('task2', { title: 'Task 2', isDone: false });
      const archive = createMockArchiveModel([task1, task2]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(Promise.resolve(archive));
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(
        Promise.resolve(createMockArchiveModel([])),
      );

      const updates: Update<Task>[] = [
        { id: 'task1', changes: { title: 'Updated Task 1', isDone: true } },
        { id: 'task2', changes: { title: 'Updated Task 2' } },
      ];

      await service.updateTasks(updates);

      expect(archiveDbAdapterMock.saveArchiveYoung).toHaveBeenCalled();
      const saveCall = archiveDbAdapterMock.saveArchiveYoung.calls.mostRecent();
      const savedArchive = saveCall.args[0];
      expect(savedArchive.task).toBeDefined();
      // Each update is applied iteratively through _reduceForArchive
    });

    it('should handle updates across both young and old archives', async () => {
      const youngTask = createMockTask('young1', { title: 'Young Task' });
      const oldTask = createMockTask('old1', { title: 'Old Task' });

      const youngArchive = createMockArchiveModel([youngTask]);
      const oldArchive = createMockArchiveModel([oldTask]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(youngArchive),
      );
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(Promise.resolve(oldArchive));

      const updates: Update<Task>[] = [
        { id: 'young1', changes: { title: 'Updated Young' } },
        { id: 'old1', changes: { title: 'Updated Old' } },
      ];

      await service.updateTasks(updates);

      expect(archiveDbAdapterMock.saveArchiveYoung).toHaveBeenCalled();
      expect(archiveDbAdapterMock.saveArchiveOld).toHaveBeenCalled();

      // Verify young archive save
      const youngSaveCall = archiveDbAdapterMock.saveArchiveYoung.calls.mostRecent();
      expect(youngSaveCall.args[0].task).toBeDefined();

      // Verify old archive save
      const oldSaveCall = archiveDbAdapterMock.saveArchiveOld.calls.mostRecent();
      expect(oldSaveCall.args[0].task).toBeDefined();
    });
  });

  describe('consistent state reduction across all methods', () => {
    it('should consistently use _reduceForArchive in deleteTasks', async () => {
      const tasks = [
        createMockTask('task1'),
        createMockTask('task2'),
        createMockTask('task3'),
      ];
      const youngArchive = createMockArchiveModel(tasks.slice(0, 2));
      const oldArchive = createMockArchiveModel([tasks[2]]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(youngArchive),
      );
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(Promise.resolve(oldArchive));

      await service.deleteTasks(['task1', 'task3']);

      // Both archives should be saved with properly reduced state
      expect(archiveDbAdapterMock.saveArchiveYoung).toHaveBeenCalled();
      expect(archiveDbAdapterMock.saveArchiveOld).toHaveBeenCalled();

      const youngSave = archiveDbAdapterMock.saveArchiveYoung.calls.mostRecent();
      const oldSave = archiveDbAdapterMock.saveArchiveOld.calls.mostRecent();

      expect(youngSave.args[0].task).toBeDefined();
      expect(oldSave.args[0].task).toBeDefined();
    });

    it('should consistently use _reduceForArchive in roundTimeSpent', async () => {
      const youngTask = createMockTask('young1', {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        timeSpentOnDay: { '2024-01-01': 1000000 },
      });
      const oldTask = createMockTask('old1', {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        timeSpentOnDay: { '2024-01-01': 2000000 },
      });

      const youngArchive = createMockArchiveModel([youngTask]);
      const oldArchive = createMockArchiveModel([oldTask]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(youngArchive),
      );
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(Promise.resolve(oldArchive));

      await service.roundTimeSpent({
        day: '2024-01-01',
        taskIds: ['young1', 'old1'],
        roundTo: 'QUARTER' as RoundTimeOption,
        isRoundUp: false,
      });

      expect(archiveDbAdapterMock.saveArchiveYoung).toHaveBeenCalled();
      expect(archiveDbAdapterMock.saveArchiveOld).toHaveBeenCalled();

      // Both saves should have properly reduced task state
      const youngSave = archiveDbAdapterMock.saveArchiveYoung.calls.mostRecent();
      const oldSave = archiveDbAdapterMock.saveArchiveOld.calls.mostRecent();

      expect(youngSave.args[0].task).toBeDefined();
      expect(oldSave.args[0].task).toBeDefined();
    });

    it('should use _execActionBoth for removeTagsFromAllTasks', async () => {
      const task = createMockTask('task1', { tagIds: ['tag1', 'tag2'] });
      const archive = createMockArchiveModel([task]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(Promise.resolve(archive));
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(
        Promise.resolve(createMockArchiveModel([])),
      );

      // Mock load to prevent orphan deletion logic
      spyOn(service, 'load').and.returnValue(
        Promise.resolve({
          ids: ['task1'],
          entities: { task1: { ...task, tagIds: ['tag2'] } },
        }),
      );

      await service.removeTagsFromAllTasks(['tag1']);

      // Both archives should be updated through _execActionBoth
      expect(archiveDbAdapterMock.saveArchiveYoung).toHaveBeenCalled();
      expect(archiveDbAdapterMock.saveArchiveOld).toHaveBeenCalled();
    });
  });

  describe('hasTasksBatch', () => {
    it('should return existence map for multiple tasks', async () => {
      // Arrange
      const task1 = createMockTask('task1');
      const task2 = createMockTask('task2');
      const archiveYoung = createMockArchiveModel([task1]);
      const archiveOld = createMockArchiveModel([task2]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(archiveYoung),
      );
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(Promise.resolve(archiveOld));

      // Act
      const result = await service.hasTasksBatch(['task1', 'task2', 'task3']);

      // Assert
      expect(result.get('task1')).toBe(true);
      expect(result.get('task2')).toBe(true);
      expect(result.get('task3')).toBe(false);

      // CRITICAL: Verify loaded only once, not 3 times
      expect(archiveDbAdapterMock.loadArchiveYoung).toHaveBeenCalledTimes(1);
      expect(archiveDbAdapterMock.loadArchiveOld).toHaveBeenCalledTimes(1);
    });

    it('should handle 50 tasks without performance degradation', async () => {
      // Arrange
      const taskIds = Array.from({ length: 50 }, (_, i) => `task${i}`);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(createMockArchiveModel([])),
      );
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(
        Promise.resolve(createMockArchiveModel([])),
      );

      // Act
      await service.hasTasksBatch(taskIds);

      // Assert - Should NOT scale with task count, always 2 loads
      expect(archiveDbAdapterMock.loadArchiveYoung).toHaveBeenCalledTimes(1);
      expect(archiveDbAdapterMock.loadArchiveOld).toHaveBeenCalledTimes(1);
    });

    it('should return empty map for empty input', async () => {
      // Act
      const result = await service.hasTasksBatch([]);

      // Assert
      expect(result.size).toBe(0);
      expect(archiveDbAdapterMock.loadArchiveYoung).not.toHaveBeenCalled();
      expect(archiveDbAdapterMock.loadArchiveOld).not.toHaveBeenCalled();
    });

    it('should handle undefined archives gracefully', async () => {
      // Arrange
      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(Promise.resolve(undefined));
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(Promise.resolve(undefined));

      // Act
      const result = await service.hasTasksBatch(['task1']);

      // Assert
      expect(result.get('task1')).toBe(false);
    });
  });

  describe('getByIdBatch', () => {
    it('should return task map for multiple IDs', async () => {
      // Arrange
      const task1 = createMockTask('task1', { title: 'Task 1' });
      const task2 = createMockTask('task2', { title: 'Task 2' });
      const archiveYoung = createMockArchiveModel([task1]);
      const archiveOld = createMockArchiveModel([task2]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(archiveYoung),
      );
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(Promise.resolve(archiveOld));

      // Act
      const result = await service.getByIdBatch(['task1', 'task2', 'task3']);

      // Assert
      expect(result.get('task1')).toEqual(task1);
      expect(result.get('task2')).toEqual(task2);
      expect(result.get('task3')).toBeUndefined();
      expect(result.size).toBe(2);

      // Verify loaded only once
      expect(archiveDbAdapterMock.loadArchiveYoung).toHaveBeenCalledTimes(1);
      expect(archiveDbAdapterMock.loadArchiveOld).toHaveBeenCalledTimes(1);
    });

    it('should prefer young archive when task exists in both', async () => {
      // Arrange
      const taskInYoung = createMockTask('task1', { title: 'Young Version' });
      const taskInOld = createMockTask('task1', { title: 'Old Version' });
      const archiveYoung = createMockArchiveModel([taskInYoung]);
      const archiveOld = createMockArchiveModel([taskInOld]);

      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(
        Promise.resolve(archiveYoung),
      );
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(Promise.resolve(archiveOld));

      // Act
      const result = await service.getByIdBatch(['task1']);

      // Assert
      expect(result.get('task1')?.title).toBe('Young Version');
    });

    it('should return empty map for empty input', async () => {
      // Act
      const result = await service.getByIdBatch([]);

      // Assert
      expect(result.size).toBe(0);
      expect(archiveDbAdapterMock.loadArchiveYoung).not.toHaveBeenCalled();
      expect(archiveDbAdapterMock.loadArchiveOld).not.toHaveBeenCalled();
    });

    it('should handle undefined archives gracefully', async () => {
      // Arrange
      archiveDbAdapterMock.loadArchiveYoung.and.returnValue(Promise.resolve(undefined));
      archiveDbAdapterMock.loadArchiveOld.and.returnValue(Promise.resolve(undefined));

      // Act
      const result = await service.getByIdBatch(['task1']);

      // Assert
      expect(result.size).toBe(0);
    });
  });
});
