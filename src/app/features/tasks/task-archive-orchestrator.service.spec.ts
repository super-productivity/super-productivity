import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';
import { TaskArchiveOrchestratorService } from './task-archive-orchestrator.service';
import { TaskService } from './task.service';
import { WorkContextService } from '../work-context/work-context.service';
import { WorkContextType } from '../work-context/work-context.model';
import { ArchiveService } from '../archive/archive.service';
import { TaskArchiveService } from '../archive/task-archive.service';
import { DEFAULT_TASK, Task, TaskWithSubTasks } from './task.model';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';

describe('TaskArchiveOrchestratorService', () => {
  let orchestrator: TaskArchiveOrchestratorService;
  let store: MockStore;
  let taskService: jasmine.SpyObj<TaskService>;
  let archiveService: jasmine.SpyObj<ArchiveService>;
  let taskArchiveService: jasmine.SpyObj<TaskArchiveService>;
  let workContext: {
    activeWorkContextType: WorkContextType;
    activeWorkContextId: string | null;
  };

  const createMockTask = (id: string, overrides: Partial<Task> = {}): Task =>
    ({
      ...DEFAULT_TASK,
      id,
      title: `Task ${id}`,
      created: Date.now(),
      projectId: 'test-project',
      ...overrides,
    }) as Task;

  const createMockTaskWithSubTasks = (
    task: Task,
    subTasks: Task[] = [],
  ): TaskWithSubTasks => ({
    ...task,
    subTasks,
  });

  const task1 = createMockTask('task-1');

  beforeEach(() => {
    workContext = {
      activeWorkContextType: WorkContextType.PROJECT,
      activeWorkContextId: 'test-project',
    };

    const taskServiceSpy = jasmine.createSpyObj(
      'TaskService',
      ['updateTags', 'update', 'getByIdOnce$'],
      {
        taskFeatureState$: of({ ids: ['task-1'], entities: { ['task-1']: task1 } }),
        allTasks$: of([task1]),
      },
    );

    const archiveServiceSpy = jasmine.createSpyObj('ArchiveService', [
      'moveTasksToArchiveAndFlushArchiveIfDue',
    ]);
    archiveServiceSpy.moveTasksToArchiveAndFlushArchiveIfDue.and.returnValue(
      Promise.resolve(),
    );

    const taskArchiveServiceSpy = jasmine.createSpyObj('TaskArchiveService', [
      'load',
      'updateTask',
      'updateTasks',
      'getById',
    ]);
    taskArchiveServiceSpy.load.and.returnValue(
      Promise.resolve({ ids: [], entities: {} }),
    );
    taskArchiveServiceSpy.getById.and.returnValue(Promise.resolve(null));

    TestBed.configureTestingModule({
      providers: [
        TaskArchiveOrchestratorService,
        provideMockStore({ initialState: {} }),
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: WorkContextService, useValue: workContext },
        { provide: ArchiveService, useValue: archiveServiceSpy },
        { provide: TaskArchiveService, useValue: taskArchiveServiceSpy },
      ],
    });

    orchestrator = TestBed.inject(TaskArchiveOrchestratorService);
    store = TestBed.inject(MockStore);
    taskService = TestBed.inject(TaskService) as jasmine.SpyObj<TaskService>;
    archiveService = TestBed.inject(ArchiveService) as jasmine.SpyObj<ArchiveService>;
    taskArchiveService = TestBed.inject(
      TaskArchiveService,
    ) as jasmine.SpyObj<TaskArchiveService>;

    spyOn(store, 'dispatch').and.callThrough();
  });

  describe('moveToArchive', () => {
    it('should persist parent tasks before dispatching the archive action', async () => {
      const task = createMockTaskWithSubTasks(createMockTask('task-1'));
      const callOrder: string[] = [];
      archiveService.moveTasksToArchiveAndFlushArchiveIfDue.and.callFake(async () => {
        callOrder.push('persist-archive');
      });
      store.dispatch = jasmine
        .createSpy('dispatch')
        .and.callFake(() => callOrder.push('dispatch'));

      await orchestrator.moveToArchive(task);

      expect(callOrder).toEqual(['persist-archive', 'dispatch']);
    });

    it('should coalesce concurrent archive requests for the same task', async () => {
      const task = createMockTaskWithSubTasks(createMockTask('task-1'));
      let finishPersistence: (() => void) | undefined;
      archiveService.moveTasksToArchiveAndFlushArchiveIfDue.and.returnValue(
        new Promise<void>((resolve) => {
          finishPersistence = resolve;
        }),
      );

      const first = orchestrator.moveToArchive(task);
      const duplicate = orchestrator.moveToArchive(task);
      let duplicateResolved = false;
      void duplicate.then(() => {
        duplicateResolved = true;
      });

      expect(archiveService.moveTasksToArchiveAndFlushArchiveIfDue).toHaveBeenCalledTimes(
        1,
      );
      expect(store.dispatch).not.toHaveBeenCalledWith(
        jasmine.objectContaining({ type: TaskSharedActions.moveToArchive.type }),
      );
      await Promise.resolve();
      expect(duplicateResolved).toBeFalse();

      finishPersistence?.();
      await Promise.all([first, duplicate]);

      expect(duplicateResolved).toBeTrue();
      expect(store.dispatch).toHaveBeenCalledTimes(1);
    });

    it('should release the in-flight archive guard after persistence fails', async () => {
      const task = createMockTaskWithSubTasks(createMockTask('task-1'));
      archiveService.moveTasksToArchiveAndFlushArchiveIfDue.and.rejectWith(
        new Error('archive write failed'),
      );

      await expectAsync(orchestrator.moveToArchive(task)).toBeRejectedWithError(
        'archive write failed',
      );

      archiveService.moveTasksToArchiveAndFlushArchiveIfDue.and.resolveTo();
      await orchestrator.moveToArchive(task);

      expect(archiveService.moveTasksToArchiveAndFlushArchiveIfDue).toHaveBeenCalledTimes(
        2,
      );
      expect(store.dispatch).toHaveBeenCalledTimes(1);
    });

    it('should dispatch moveToArchive and call archive service for parent tasks', async () => {
      const task = createMockTaskWithSubTasks(
        createMockTask('task-1', { projectId: 'test-project' }),
      );

      await orchestrator.moveToArchive(task);

      expect(store.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.moveToArchive({ tasks: [task] }),
      );
      expect(archiveService.moveTasksToArchiveAndFlushArchiveIfDue).toHaveBeenCalledWith([
        task,
      ]);
    });

    it('should handle array of tasks', async () => {
      const tasks = [
        createMockTaskWithSubTasks(createMockTask('task-1')),
        createMockTaskWithSubTasks(createMockTask('task-2')),
      ];

      await orchestrator.moveToArchive(tasks);

      expect(store.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.moveToArchive({ tasks }),
      );
    });

    it('should only archive parent tasks (subtasks are handled separately)', async () => {
      // When archiving both parent and subtasks, only parent tasks are dispatched
      // Subtasks trigger a devError in PROJECT context (tested behavior)
      const parentTask = createMockTaskWithSubTasks(createMockTask('parent-1'));

      await orchestrator.moveToArchive([parentTask]);

      expect(store.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.moveToArchive({ tasks: [parentTask] }),
      );
    });

    it('should handle null/undefined gracefully', async () => {
      await orchestrator.moveToArchive(null as unknown as TaskWithSubTasks[]);

      expect(store.dispatch).not.toHaveBeenCalledWith(
        jasmine.objectContaining({ type: TaskSharedActions.moveToArchive.type }),
      );
    });

    it('should delegate malformed-task filtering to archive.service', async () => {
      // Sanitization lives in archive.service (sanitizeTasksForArchiving) so the
      // same rules apply to both moveTasksToArchiveAndFlushArchiveIfDue and
      // writeTasksToArchiveForRemoteSync. The orchestrator is a pass-through here.
      const invalidTask = {
        title: 'Broken task',
        subTasks: [],
      } as unknown as TaskWithSubTasks;

      await orchestrator.moveToArchive([invalidTask]);

      expect(archiveService.moveTasksToArchiveAndFlushArchiveIfDue).toHaveBeenCalledWith([
        invalidTask,
      ]);
    });

    it('strips the active tag from subtasks before persisting and dispatching parents', async () => {
      workContext.activeWorkContextType = WorkContextType.TAG;
      workContext.activeWorkContextId = 'tag-a';
      const parent = createMockTaskWithSubTasks(createMockTask('p1'));
      const sub = createMockTaskWithSubTasks(
        createMockTask('s1', { parentId: 'p1', tagIds: ['tag-a', 'tag-b'] }),
      );
      const log: string[] = [];
      taskService.updateTags.and.callFake((t: Task) => {
        log.push(`updateTags:${t.id}`);
      });
      archiveService.moveTasksToArchiveAndFlushArchiveIfDue.and.callFake(async () => {
        log.push('persist');
      });
      (store.dispatch as jasmine.Spy).and.callFake(() => log.push('dispatch'));

      await orchestrator.moveToArchive([parent, sub]);

      expect(log).toEqual(['updateTags:s1', 'persist', 'dispatch']);
      expect(taskService.updateTags).toHaveBeenCalledWith(sub, ['tag-b']);
      expect(archiveService.moveTasksToArchiveAndFlushArchiveIfDue).toHaveBeenCalledWith([
        parent,
      ]);
      expect(store.dispatch).toHaveBeenCalledOnceWith(
        TaskSharedActions.moveToArchive({ tasks: [parent] }),
      );
    });
  });

  describe('restoreTask', () => {
    it('should dispatch restoreTask', () => {
      const task = createMockTask('task-1');
      const subTasks = [createMockTask('subtask-1', { parentId: 'task-1' })];

      orchestrator.restoreTask(task, subTasks);

      expect(store.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.restoreTask({ task, subTasks }),
      );
    });
  });

  describe('updateEverywhere', () => {
    it('updates an active task via TaskService', async () => {
      await orchestrator.updateEverywhere('task-1', { title: 'x' });

      expect(taskService.update).toHaveBeenCalledWith('task-1', { title: 'x' });
      expect(taskArchiveService.updateTask).not.toHaveBeenCalled();
    });

    it('updates an archive-only task in the archive', async () => {
      await orchestrator.updateEverywhere('arch-1', { timeSpent: 5 });

      expect(taskArchiveService.updateTask).toHaveBeenCalledWith('arch-1', {
        timeSpent: 5,
      });
      expect(taskService.update).not.toHaveBeenCalled();
      expect(store.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('updateArchiveTask', () => {
    it('updates the task in the archive', async () => {
      await orchestrator.updateArchiveTask('arch-1', { title: 'x' });

      expect(taskArchiveService.updateTask).toHaveBeenCalledWith('arch-1', {
        title: 'x',
      });
    });
  });

  describe('updateArchiveTasks', () => {
    it('updates the tasks in the archive', async () => {
      const updates = [{ id: 'arch-1', changes: { projectId: 'p2' } }];

      await orchestrator.updateArchiveTasks(updates);

      expect(taskArchiveService.updateTasks).toHaveBeenCalledWith(updates);
    });
  });

  describe('getByIdFromEverywhere', () => {
    it('falls back to archive', async () => {
      const archTask = createMockTask('arch-1');
      taskService.getByIdOnce$.and.returnValue(of(undefined as unknown as Task));
      taskArchiveService.getById.and.resolveTo(archTask);

      const result = await orchestrator.getByIdFromEverywhere('arch-1');

      expect(result).toBe(archTask);
    });
  });

  describe('getAllTasksEverywhere', () => {
    it('tolerates an empty archive', async () => {
      (taskArchiveService.load as jasmine.Spy).and.resolveTo(undefined);

      const result = await orchestrator.getAllTasksEverywhere();

      expect(result).toEqual([task1]);
    });
  });
});
