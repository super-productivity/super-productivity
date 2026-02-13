import { TestBed } from '@angular/core/testing';
import { TaskService } from './task.service';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { WorkContextService } from '../work-context/work-context.service';
import { GlobalTrackingIntervalService } from '../../core/global-tracking-interval/global-tracking-interval.service';
import { DateService } from '../../core/date/date.service';
import { Router } from '@angular/router';
import { ArchiveService } from '../archive/archive.service';
import { TaskArchiveService } from '../archive/task-archive.service';
import { GlobalConfigService } from '../config/global-config.service';
import { TaskFocusService } from './task-focus.service';
import { ImexViewService } from '../../imex/imex-meta/imex-view.service';
import { DEFAULT_TASK, Task, TaskWithSubTasks } from './task.model';
import { WorkContextType } from '../work-context/work-context.model';
import { of, Subject } from 'rxjs';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import {
  setCurrentTask,
  unsetCurrentTask,
  setSelectedTask,
  addSubTask,
  moveSubTaskToTop,
  moveSubTaskToBottom,
} from './store/task.actions';
import { TaskDetailTargetPanel, TaskReminderOptionId } from './task.model';
import { TODAY_TAG } from '../tag/tag.const';
import { INBOX_PROJECT } from '../project/project.const';
import { signal } from '@angular/core';

describe('TaskService', () => {
  let service: TaskService;
  let store: MockStore;
  let archiveService: jasmine.SpyObj<ArchiveService>;
  let tickSubject: Subject<{ duration: number; date: string }>;

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

  beforeEach(() => {
    tickSubject = new Subject();

    const workContextServiceSpy = jasmine.createSpyObj('WorkContextService', [''], {
      activeWorkContextType: WorkContextType.PROJECT,
      activeWorkContextId: 'test-project',
      mainListTaskIds$: of(['task-1', 'task-2']),
      backlogTaskIds$: of([]),
      doneTaskIds$: of([]),
      doneBacklogTaskIds$: of([]),
      startableTasksForActiveContext$: of([]),
      startableTasksForActiveContext: signal([]),
      activeWorkContext$: of({
        id: 'test-project',
        type: WorkContextType.PROJECT,
        taskIds: ['task-1', 'task-2'],
      }),
    });

    const globalTrackingIntervalServiceSpy = jasmine.createSpyObj(
      'GlobalTrackingIntervalService',
      [''],
      {
        tick$: tickSubject.asObservable(),
      },
    );

    const dateServiceSpy = jasmine.createSpyObj('DateService', ['todayStr']);
    dateServiceSpy.todayStr.and.returnValue('2026-01-05');

    const routerSpy = jasmine.createSpyObj('Router', ['navigate']);
    routerSpy.navigate.and.returnValue(Promise.resolve(true));

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
      'roundTimeSpent',
    ]);
    taskArchiveServiceSpy.load.and.returnValue(
      Promise.resolve({ ids: [], entities: {} }),
    );
    taskArchiveServiceSpy.getById.and.returnValue(Promise.resolve(null));

    const globalConfigServiceSpy = jasmine.createSpyObj('GlobalConfigService', [''], {
      cfg: signal({
        tasks: { defaultProjectId: null },
        reminder: { defaultTaskRemindOption: 'AT_START' },
        appFeatures: { isTimeTrackingEnabled: true },
      }),
      misc: signal({ isShowProductivityTipLonger: false }),
      tasks: signal({ defaultProjectId: null }),
      appFeatures: signal({ isTimeTrackingEnabled: true }),
    });

    const taskFocusServiceSpy = jasmine.createSpyObj('TaskFocusService', [''], {
      lastFocusedTaskComponent: signal(null),
    });

    const imexViewServiceSpy = jasmine.createSpyObj('ImexViewService', [''], {
      isDataImportInProgress$: of(false),
    });

    TestBed.configureTestingModule({
      providers: [
        TaskService,
        provideMockStore({
          initialState: {
            tasks: {
              ids: ['task-1', 'task-2'],
              entities: {
                ['task-1']: createMockTask('task-1'),
                ['task-2']: createMockTask('task-2'),
              },
              currentTaskId: null,
              selectedTaskId: null,
              taskDetailTargetPanel: null,
              isDataLoaded: true,
            },
          },
          selectors: [],
        }),
        { provide: WorkContextService, useValue: workContextServiceSpy },
        {
          provide: GlobalTrackingIntervalService,
          useValue: globalTrackingIntervalServiceSpy,
        },
        { provide: DateService, useValue: dateServiceSpy },
        { provide: Router, useValue: routerSpy },
        { provide: ArchiveService, useValue: archiveServiceSpy },
        { provide: TaskArchiveService, useValue: taskArchiveServiceSpy },
        { provide: GlobalConfigService, useValue: globalConfigServiceSpy },
        { provide: TaskFocusService, useValue: taskFocusServiceSpy },
        { provide: ImexViewService, useValue: imexViewServiceSpy },
      ],
    });

    service = TestBed.inject(TaskService);
    store = TestBed.inject(MockStore);
    archiveService = TestBed.inject(ArchiveService) as jasmine.SpyObj<ArchiveService>;

    spyOn(store, 'dispatch').and.callThrough();
  });

  afterEach(() => {
    store.resetSelectors();
  });

  describe('setCurrentId', () => {
    it('should dispatch setCurrentTask when id is provided', () => {
      service.setCurrentId('task-1');

      expect(store.dispatch).toHaveBeenCalledWith(setCurrentTask({ id: 'task-1' }));
    });

    it('should dispatch unsetCurrentTask when id is null', () => {
      service.setCurrentId(null);

      expect(store.dispatch).toHaveBeenCalledWith(unsetCurrentTask());
    });
  });

  describe('setSelectedId', () => {
    it('should dispatch setSelectedTask with default panel', () => {
      service.setSelectedId('task-1');

      expect(store.dispatch).toHaveBeenCalledWith(
        setSelectedTask({
          id: 'task-1',
          taskDetailTargetPanel: TaskDetailTargetPanel.Default,
        }),
      );
    });

    it('should dispatch setSelectedTask with specified panel', () => {
      service.setSelectedId('task-1', TaskDetailTargetPanel.Attachments);

      expect(store.dispatch).toHaveBeenCalledWith(
        setSelectedTask({
          id: 'task-1',
          taskDetailTargetPanel: TaskDetailTargetPanel.Attachments,
        }),
      );
    });

    it('should handle null id', () => {
      service.setSelectedId(null);

      expect(store.dispatch).toHaveBeenCalledWith(
        setSelectedTask({
          id: null,
          taskDetailTargetPanel: TaskDetailTargetPanel.Default,
        }),
      );
    });
  });

  describe('pauseCurrent', () => {
    it('should dispatch unsetCurrentTask', () => {
      service.pauseCurrent();

      expect(store.dispatch).toHaveBeenCalledWith(unsetCurrentTask());
    });
  });

  describe('add', () => {
    it('should dispatch addTask with correct payload', () => {
      const id = service.add('New Task');

      expect(store.dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: TaskSharedActions.addTask.type,
        }),
      );
      expect(id).toBeTruthy();
    });

    it('should create task with project context', () => {
      service.add('New Task');

      const dispatchCall = (store.dispatch as jasmine.Spy).calls.mostRecent();
      const action = dispatchCall.args[0] as ReturnType<typeof TaskSharedActions.addTask>;

      expect(action.task.projectId).toBe('test-project');
      expect(action.workContextType).toBe(WorkContextType.PROJECT);
    });

    it('should pass isAddToBacklog flag', () => {
      service.add('New Task', true);

      const dispatchCall = (store.dispatch as jasmine.Spy).calls.mostRecent();
      const action = dispatchCall.args[0] as ReturnType<typeof TaskSharedActions.addTask>;

      expect(action.isAddToBacklog).toBe(true);
    });

    it('should pass isAddToBottom flag', () => {
      service.add('New Task', false, {}, true);

      const dispatchCall = (store.dispatch as jasmine.Spy).calls.mostRecent();
      const action = dispatchCall.args[0] as ReturnType<typeof TaskSharedActions.addTask>;

      expect(action.isAddToBottom).toBe(true);
    });

    it('should merge additional fields', () => {
      service.add('New Task', false, { notes: 'Test notes' });

      const dispatchCall = (store.dispatch as jasmine.Spy).calls.mostRecent();
      const action = dispatchCall.args[0] as ReturnType<typeof TaskSharedActions.addTask>;

      expect(action.task.notes).toBe('Test notes');
    });
  });

  describe('addToToday', () => {
    it('should dispatch planTasksForToday', () => {
      const task = createMockTaskWithSubTasks(createMockTask('task-1'));

      service.addToToday(task);

      expect(store.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.planTasksForToday({ taskIds: ['task-1'] }),
      );
    });
  });

  describe('remove', () => {
    it('should dispatch deleteTask', () => {
      const task = createMockTaskWithSubTasks(createMockTask('task-1'));

      service.remove(task);

      expect(store.dispatch).toHaveBeenCalledWith(TaskSharedActions.deleteTask({ task }));
    });
  });

  describe('removeMultipleTasks', () => {
    it('should dispatch deleteTasks', () => {
      service.removeMultipleTasks(['task-1', 'task-2']);

      expect(store.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.deleteTasks({ taskIds: ['task-1', 'task-2'] }),
      );
    });
  });

  describe('update', () => {
    it('should dispatch updateTask with changes', () => {
      service.update('task-1', { title: 'Updated Title' });

      expect(store.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { title: 'Updated Title' } },
        }),
      );
    });
  });

  describe('updateTags', () => {
    it('should dispatch updateTask with unique tagIds', () => {
      const task = createMockTask('task-1');

      service.updateTags(task, ['tag-1', 'tag-2', 'tag-1']);

      expect(store.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { tagIds: ['tag-1', 'tag-2'] } },
        }),
      );
    });
  });

  describe('removeTagsForAllTask', () => {
    it('should dispatch removeTagsForAllTasks', () => {
      service.removeTagsForAllTask(['tag-1', 'tag-2']);

      expect(store.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.removeTagsForAllTasks({ tagIdsToRemove: ['tag-1', 'tag-2'] }),
      );
    });
  });

  describe('setDone', () => {
    it('should update task with isDone: true', () => {
      service.setDone('task-1');

      expect(store.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { isDone: true } },
        }),
      );
    });
  });

  describe('setUnDone', () => {
    it('should update task with isDone: false', () => {
      service.setUnDone('task-1');

      expect(store.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { isDone: false } },
        }),
      );
    });
  });

  describe('markIssueUpdatesAsRead', () => {
    it('should update task with issueWasUpdated: false', () => {
      service.markIssueUpdatesAsRead('task-1');

      expect(store.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { issueWasUpdated: false } },
        }),
      );
    });
  });

  describe('moveToTop', () => {
    it('should dispatch moveSubTaskToTop for subtask', () => {
      service.moveToTop('subtask-1', 'parent-1', false);

      expect(store.dispatch).toHaveBeenCalledWith(
        moveSubTaskToTop({ id: 'subtask-1', parentId: 'parent-1' }),
      );
    });
  });

  describe('moveToBottom', () => {
    it('should dispatch moveSubTaskToBottom for subtask', () => {
      service.moveToBottom('subtask-1', 'parent-1', false);

      expect(store.dispatch).toHaveBeenCalledWith(
        moveSubTaskToBottom({ id: 'subtask-1', parentId: 'parent-1' }),
      );
    });
  });

  describe('addSubTaskTo', () => {
    it('should dispatch addSubTask', () => {
      const id = service.addSubTaskTo('parent-1', { title: 'Subtask' });

      expect(store.dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: addSubTask.type,
          parentId: 'parent-1',
        }),
      );
      expect(id).toBeTruthy();
    });
  });

  describe('moveToArchive', () => {
    it('should dispatch moveToArchive and call archive service for parent tasks', async () => {
      const task = createMockTaskWithSubTasks(
        createMockTask('task-1', { projectId: 'test-project' }),
      );

      await service.moveToArchive(task);

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

      await service.moveToArchive(tasks);

      expect(store.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.moveToArchive({ tasks }),
      );
    });

    it('should only archive parent tasks (subtasks are handled separately)', async () => {
      // When archiving both parent and subtasks, only parent tasks are dispatched
      // Subtasks trigger a devError in PROJECT context (tested behavior)
      const parentTask = createMockTaskWithSubTasks(createMockTask('parent-1'));

      await service.moveToArchive([parentTask]);

      expect(store.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.moveToArchive({ tasks: [parentTask] }),
      );
    });

    it('should handle null/undefined gracefully', async () => {
      await service.moveToArchive(null as any);

      expect(store.dispatch).not.toHaveBeenCalledWith(
        jasmine.objectContaining({ type: TaskSharedActions.moveToArchive.type }),
      );
    });
  });

  describe('moveToProject', () => {
    it('should dispatch moveToOtherProject', () => {
      const task = createMockTaskWithSubTasks(createMockTask('task-1'));

      service.moveToProject(task, 'new-project');

      expect(store.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.moveToOtherProject({
          task,
          targetProjectId: 'new-project',
        }),
      );
    });

    it('should throw error for subtask', () => {
      const subtask = createMockTaskWithSubTasks(
        createMockTask('subtask-1', { parentId: 'parent-1' }),
      );

      expect(() => service.moveToProject(subtask, 'new-project')).toThrowError(
        'Wrong task model',
      );
    });
  });

  describe('restoreTask', () => {
    it('should dispatch restoreTask', () => {
      const task = createMockTask('task-1');
      const subTasks = [createMockTask('subtask-1', { parentId: 'task-1' })];

      service.restoreTask(task, subTasks);

      expect(store.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.restoreTask({ task, subTasks }),
      );
    });
  });

  describe('scheduleTask', () => {
    it('should dispatch scheduleTaskWithTime', () => {
      const task = createMockTask('task-1');
      const due = Date.now() + 3600000;

      service.scheduleTask(task, due, TaskReminderOptionId.AtStart);

      expect(store.dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: TaskSharedActions.scheduleTaskWithTime.type,
        }),
      );
    });
  });

  describe('reScheduleTask', () => {
    it('should dispatch reScheduleTaskWithTime', () => {
      const task = createMockTask('task-1');
      const due = Date.now() + 3600000;

      service.reScheduleTask({
        task,
        due,
        remindCfg: TaskReminderOptionId.AtStart,
        isMoveToBacklog: false,
      });

      expect(store.dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: TaskSharedActions.reScheduleTaskWithTime.type,
        }),
      );
    });
  });

  describe('createNewTaskWithDefaults', () => {
    it('should create task with default values', () => {
      const task = service.createNewTaskWithDefaults({ title: 'Test Task' });

      expect(task.title).toBe('Test Task');
      expect(task.id).toBeTruthy();
      expect(task.created).toBeTruthy();
      expect(task.projectId).toBe('test-project');
    });

    it('should set projectId for project context', () => {
      const task = service.createNewTaskWithDefaults({
        title: 'Test',
        workContextType: WorkContextType.PROJECT,
        workContextId: 'my-project',
      });

      expect(task.projectId).toBe('my-project');
    });

    it('should set tagIds for tag context (non-TODAY)', () => {
      const task = service.createNewTaskWithDefaults({
        title: 'Test',
        workContextType: WorkContextType.TAG,
        workContextId: 'my-tag',
      });

      expect(task.tagIds).toContain('my-tag');
    });

    it('should NOT set tagIds for TODAY tag context', () => {
      const task = service.createNewTaskWithDefaults({
        title: 'Test',
        workContextType: WorkContextType.TAG,
        workContextId: TODAY_TAG.id,
      });

      expect(task.tagIds).not.toContain(TODAY_TAG.id);
    });

    it('should set dueDay for TODAY tag context', () => {
      const task = service.createNewTaskWithDefaults({
        title: 'Test',
        workContextType: WorkContextType.TAG,
        workContextId: TODAY_TAG.id,
      });

      expect(task.dueDay).toBeTruthy();
    });

    it('should use custom id if provided', () => {
      const task = service.createNewTaskWithDefaults({
        title: 'Test',
        id: 'custom-id',
      });

      expect(task.id).toBe('custom-id');
    });

    it('should merge additional fields', () => {
      const task = service.createNewTaskWithDefaults({
        title: 'Test',
        additional: {
          notes: 'Some notes',
          timeEstimate: 3600000,
        },
      });

      expect(task.notes).toBe('Some notes');
      expect(task.timeEstimate).toBe(3600000);
    });

    it('should use INBOX_PROJECT if no projectId available', () => {
      // Create a task with TAG context but no default project configured
      const task = service.createNewTaskWithDefaults({
        title: 'Test',
        workContextType: WorkContextType.TAG,
        workContextId: 'some-tag',
      });

      // Should fallback to INBOX_PROJECT since no default is configured
      expect(task.projectId).toBe(INBOX_PROJECT.id);
    });

    it('should use INBOX_PROJECT when cfg() returns undefined', () => {
      // Simulate config not being loaded yet (e.g., during early sync)
      const globalConfigService = TestBed.inject(GlobalConfigService) as any;
      globalConfigService.cfg.set(undefined);

      const task = service.createNewTaskWithDefaults({
        title: 'Test',
        workContextType: WorkContextType.TAG,
        workContextId: 'some-tag',
      });

      expect(task.projectId).toBe(INBOX_PROJECT.id);
    });

    it('should use INBOX_PROJECT when cfg().tasks is undefined', () => {
      // Simulate partial/corrupted config during sync
      const globalConfigService = TestBed.inject(GlobalConfigService) as any;
      globalConfigService.cfg.set({ reminder: {}, appFeatures: {} });

      const task = service.createNewTaskWithDefaults({
        title: 'Test',
        workContextType: WorkContextType.TAG,
        workContextId: 'some-tag',
      });

      expect(task.projectId).toBe(INBOX_PROJECT.id);
    });
  });

  describe('getByIdOnce$', () => {
    it('should return observable that completes after one emission', (done) => {
      store.overrideSelector('selectTaskById', createMockTask('task-1'));

      let emissionCount = 0;
      service.getByIdOnce$('task-1').subscribe({
        next: (task) => {
          emissionCount++;
          expect(task).toBeTruthy();
        },
        complete: () => {
          expect(emissionCount).toBe(1);
          done();
        },
      });
    });
  });

  describe('addTimeSpent', () => {
    it('should dispatch addTimeSpent action', () => {
      const task = createMockTask('task-1');

      service.addTimeSpent(task, 60000);

      expect(store.dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: '[TimeTracking] Add time spent',
          task,
          duration: 60000,
        }),
      );
    });

    it('should use provided date', () => {
      const task = createMockTask('task-1');

      service.addTimeSpent(task, 60000, '2026-01-01');

      expect(store.dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({
          date: '2026-01-01',
        }),
      );
    });
  });

  describe('addTimeSpentAndSync', () => {
    it('should dispatch both addTimeSpent and syncTimeSpent', () => {
      const task = createMockTask('task-1');

      service.addTimeSpentAndSync(task, 60000);

      expect(store.dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: '[TimeTracking] Add time spent',
          task,
          duration: 60000,
          date: '2026-01-05',
        }),
      );
      expect(store.dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: '[TimeTracking] Sync time spent',
          taskId: 'task-1',
          duration: 60000,
          date: '2026-01-05',
        }),
      );
    });

    it('should use same date for both dispatches', () => {
      const task = createMockTask('task-1');

      service.addTimeSpentAndSync(task, 5000);

      const calls = (store.dispatch as jasmine.Spy).calls.allArgs();
      const addCall = calls.find(
        ([a]: any) => a.type === '[TimeTracking] Add time spent',
      );
      const syncCall = calls.find(
        ([a]: any) => a.type === '[TimeTracking] Sync time spent',
      );

      expect(addCall).toBeTruthy();
      expect(syncCall).toBeTruthy();
      expect(addCall![0].date).toBe(syncCall![0].date);
    });

    it('should not dispatch when duration is zero', () => {
      const task = createMockTask('task-1');
      (store.dispatch as jasmine.Spy).calls.reset();

      service.addTimeSpentAndSync(task, 0);

      expect(store.dispatch).not.toHaveBeenCalled();
    });

    it('should not dispatch when duration is negative', () => {
      const task = createMockTask('task-1');
      (store.dispatch as jasmine.Spy).calls.reset();

      service.addTimeSpentAndSync(task, -1000);

      expect(store.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('removeTimeSpent', () => {
    it('should dispatch removeTimeSpent action', () => {
      service.removeTimeSpent('task-1', 30000);

      expect(store.dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: '[Task] Remove time spent',
          id: 'task-1',
          duration: 30000,
        }),
      );
    });
  });

  describe('toggleStartTask', () => {
    it('should dispatch toggleStart when time tracking is enabled', () => {
      service.toggleStartTask();

      expect(store.dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: '[Task] Toggle start' }),
      );
    });
  });

  // Note: convertToMainTask requires complex selector mocking that doesn't work well
  // with the current test setup. It's better tested via integration tests.
});
