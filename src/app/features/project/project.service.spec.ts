import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { ProjectService } from './project.service';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { MatDialog } from '@angular/material/dialog';
import { selectTaskFeatureState } from '../tasks/store/task.selectors';
import { Task, TaskState } from '../tasks/task.model';
import { TaskService } from '../tasks/task.service';
import { Store, StoreModule } from '@ngrx/store';
import { createProject } from './project.test-helper';
import { EMPTY, of } from 'rxjs';
import { createTask } from '../tasks/task.test-helper';
import { TranslateService } from '@ngx-translate/core';
import { WorkContextService } from '../work-context/work-context.service';
import { SnackService } from '../../core/snack/snack.service';
import { TaskRepeatCfgService } from '../task-repeat-cfg/task-repeat-cfg.service';
import { TimeTrackingService } from '../time-tracking/time-tracking.service';
import { provideMockActions } from '@ngrx/effects/testing';
import { WorkContextType } from '../work-context/work-context.model';
import { T } from '../../t.const';
import { selectNoteFeatureState } from '../note/store/note.reducer';
import { NoteState } from '../note/note.model';
import { DateService } from '../../core/date/date.service';
import {
  selectUnarchivedProjects,
  selectUnarchivedProjectsWithoutCurrent,
} from './store/project.selectors';
import { selectMenuTreeProjectTree } from '../menu-tree/store/menu-tree.selectors';
import { MenuTreeKind } from '../menu-tree/store/menu-tree.model';
import { menuTreeFeatureKey } from '../menu-tree/store/menu-tree.reducer';

describe('ProjectService', () => {
  let service: ProjectService;
  let store: MockStore;
  let taskService: jasmine.SpyObj<TaskService>;
  let snackService: jasmine.SpyObj<SnackService>;
  let workContextService: jasmine.SpyObj<WorkContextService>;
  let timeTrackingService: jasmine.SpyObj<TimeTrackingService>;

  /* eslint-disable @typescript-eslint/naming-convention */
  const initialTaskState: TaskState = {
    ids: ['task-1', 'task-2', 'sub-task-1'],
    entities: {
      'task-1': createTask({
        id: 'task-1',
        title: 'Task 1',
        subTaskIds: ['sub-task-1'],
        projectId: 'project-1',
      }),
      'task-2': createTask({
        id: 'task-2',
        title: 'Task 2',
        subTaskIds: [],
        projectId: 'project-1',
      }),
      'sub-task-1': createTask({
        id: 'sub-task-1',
        title: 'Sub Task 1',
        subTaskIds: [],
        parentId: 'task-1',
        projectId: 'project-1',
      }),
    },
    currentTaskId: null,
    selectedTaskId: null,
    isDataLoaded: true,
    lastCurrentTaskId: null,
  };

  const initialNoteState: NoteState = {
    ids: ['note-1', 'note-2'],
    entities: {
      'note-1': {
        id: 'note-1',
        projectId: 'project-1',
        isPinnedToToday: false,
        content: 'Note 1 content',
        created: Date.now(),
        modified: Date.now(),
      },
      'note-2': {
        id: 'note-2',
        projectId: 'project-1',
        isPinnedToToday: true,
        content: 'Note 2 content',
        created: Date.now(),
        modified: Date.now(),
      },
    },
    todayOrder: [],
  };
  /* eslint-enable @typescript-eslint/naming-convention */

  beforeEach(() => {
    let taskCounter = 0;
    taskService = jasmine.createSpyObj('TaskService', [
      'add',
      'createNewTaskWithDefaults',
      'getByIdWithSubTaskData$',
      'moveToProject',
      'setDone',
      'setUnDone',
      'getAllTasksForProject',
    ]);
    taskService.createNewTaskWithDefaults.and.callFake(() => {
      taskCounter++;
      return createTask({
        id: `new-task-${taskCounter}`,
        title: `New Task ${taskCounter}`,
      });
    });
    taskService.getAllTasksForProject.and.callFake((projectId: string) =>
      Promise.resolve(
        Object.values(initialTaskState.entities).filter(
          (task): task is Task => task?.projectId === projectId,
        ),
      ),
    );
    workContextService = jasmine.createSpyObj('WorkContextService', [
      'getWorkContextById$',
      'onWorkContextChange$',
      'activeWorkContext$',
      'activeWorkContextTypeAndId$',
    ]);
    timeTrackingService = jasmine.createSpyObj('TimeTrackingService', ['state$']);

    TestBed.configureTestingModule({
      imports: [StoreModule.forRoot({})],
      providers: [
        ProjectService,
        provideMockStore({
          initialState: {
            projects: {
              ids: ['project-1', 'project-2'],
              entities: {
                /* eslint-disable @typescript-eslint/naming-convention */
                'project-1': createProject({ id: 'project-1', title: 'Project 1' }),
                'project-2': createProject({ id: 'project-2', title: 'Project 2' }),
                /* eslint-enable @typescript-eslint/naming-convention */
              },
            },
            [menuTreeFeatureKey]: {
              projectTree: [],
              tagTree: [],
            },
          },
        }),
        provideMockActions(() => EMPTY),
        { provide: TaskService, useValue: taskService },
        {
          provide: TranslateService,
          useValue: {
            instant: (str: string) => {
              if (str === T.GLOBAL.COPY_SUFFIX) {
                return ' (copy)';
              }
              return str;
            },
          },
        },
        { provide: WorkContextService, useValue: workContextService },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
        {
          provide: TaskRepeatCfgService,
          useValue: { getTaskRepeatCfgsWithLabels$: () => of([]) },
        },
        { provide: TimeTrackingService, useValue: timeTrackingService },
        {
          provide: DateService,
          useValue: {
            todayStr: () => '2026-01-05',
            getStartOfNextDayDiffMs: () => 0,
          },
        },
        {
          provide: MatDialog,
          useValue: jasmine.createSpyObj('MatDialog', ['open']),
        },
      ],
    });
    workContextService.activeWorkContext$ = EMPTY;
    workContextService.activeWorkContextTypeAndId$ = of({
      activeId: 'project-1',
      activeType: WorkContextType.PROJECT,
    });
    (timeTrackingService.state$ as any) = of({});
    service = TestBed.inject(ProjectService);
    snackService = TestBed.inject(SnackService) as jasmine.SpyObj<SnackService>;
    store = TestBed.inject(Store) as MockStore<any>;
    store.overrideSelector(selectTaskFeatureState, initialTaskState);
    store.overrideSelector(selectNoteFeatureState, initialNoteState);
  });

  afterEach(() => {
    // Reset selector mocks to prevent interference with other test files
    store.resetSelectors();
  });

  describe('tree order lists', () => {
    it('should expose visible projects in menu tree order', (done) => {
      const projects = [
        createProject({ id: 'project-1', title: 'Project 1' }),
        createProject({ id: 'project-2', title: 'Project 2' }),
        createProject({ id: 'project-3', title: 'Project 3', isHiddenFromMenu: true }),
        createProject({ id: 'project-4', title: 'Project 4' }),
      ];
      store.overrideSelector(selectUnarchivedProjects, projects);
      store.overrideSelector(selectMenuTreeProjectTree, [
        {
          id: 'folder-1',
          k: MenuTreeKind.FOLDER,
          name: 'Folder 1',
          children: [
            {
              id: 'project-2',
              k: MenuTreeKind.PROJECT,
            },
            {
              id: 'project-3',
              k: MenuTreeKind.PROJECT,
            },
          ],
        },
        {
          id: 'project-1',
          k: MenuTreeKind.PROJECT,
        },
      ]);
      store.refreshState();

      expect(service.listInTreeOrderForUI().map((project) => project.id)).toEqual([
        'project-2',
        'project-1',
        'project-4',
      ]);
      done();
    });

    it('should expose move candidates in menu tree order while excluding the current project', (done) => {
      const projects = [
        createProject({ id: 'project-1', title: 'Project 1' }),
        createProject({ id: 'project-2', title: 'Project 2' }),
        createProject({ id: 'project-4', title: 'Project 4' }),
      ];
      store.overrideSelector(selectUnarchivedProjectsWithoutCurrent, projects);
      store.overrideSelector(selectMenuTreeProjectTree, [
        {
          id: 'project-2',
          k: MenuTreeKind.PROJECT,
        },
        {
          id: 'project-1',
          k: MenuTreeKind.PROJECT,
        },
      ]);
      store.refreshState();

      service.getProjectsWithoutIdInTreeOrder$('project-3').subscribe((result) => {
        expect(result.map((project) => project.id)).toEqual([
          'project-2',
          'project-1',
          'project-4',
        ]);
        done();
      });
    });
  });

  describe('duplicateProject', () => {
    beforeEach(() => {
      spyOn(service, 'add').and.callFake(() => 'new-project-id');
    });

    it('should throw an error if no template project id is given', async () => {
      await expectAsync(service.duplicateProject('')).toBeRejectedWithError(
        'No template project id given',
      );
    });

    it('should throw an error if the template project is not found', async () => {
      spyOn(service, 'getByIdOnce$').and.returnValue(of(undefined as any));

      await expectAsync(
        service.duplicateProject('non-existing-project'),
      ).toBeRejectedWithError('Template project not found');
    });

    it('should create a new project with copied settings', fakeAsync(() => {
      spyOn(service, 'getByIdOnce$').and.returnValue(
        of(createProject({ id: 'project-1', title: 'Project 1' })),
      );
      service.duplicateProject('project-1');
      tick();
      expect(service.add).toHaveBeenCalledWith(
        jasmine.objectContaining({
          title: 'Project 1 (copy)',
        }),
      );
    }));

    it('should duplicate all tasks from the old project to the new one', fakeAsync(() => {
      const project = createProject({
        id: 'project-1',
        title: 'Project 1',
        taskIds: ['task-1', 'task-2'],
      });
      spyOn(service, 'getByIdOnce$').and.returnValue(of(project));
      service.duplicateProject('project-1');
      tick();
      // 2 parent tasks + 1 subtask (task-1 has sub-task-1)
      expect(taskService.createNewTaskWithDefaults).toHaveBeenCalledTimes(3);
    }));

    it('should duplicate subtasks via addSubTask action', fakeAsync(() => {
      const project = createProject({
        id: 'project-1',
        title: 'Project 1',
        taskIds: ['task-1'],
      });
      spyOn(service, 'getByIdOnce$').and.returnValue(of(project));
      const dispatchSpy = spyOn(store, 'dispatch').and.callThrough();
      service.duplicateProject('project-1');
      tick();
      // Should dispatch addSubTask for the subtask
      const addSubTaskCalls = dispatchSpy.calls
        .allArgs()
        .filter((args: any) => args[0]?.type === '[Task] Add SubTask');
      expect(addSubTaskCalls.length).toBe(1);
    }));

    it('should move backlog tasks to the new project backlog', fakeAsync(() => {
      const project = createProject({
        id: 'project-1',
        title: 'Project 1',
        backlogTaskIds: ['task-2'],
      });
      spyOn(service, 'getByIdOnce$').and.returnValue(of(project));
      service.duplicateProject('project-1');
      tick();
      expect(service.add).toHaveBeenCalledWith(
        jasmine.objectContaining({
          title: 'Project 1 (copy)',
        }),
      );
    }));

    it('should duplicate notes from the old project to the new one', fakeAsync(() => {
      const project = createProject({
        id: 'project-1',
        title: 'Project 1',
        noteIds: ['note-1', 'note-2'],
      });
      spyOn(service, 'getByIdOnce$').and.returnValue(of(project));
      const dispatchSpy = spyOn(store, 'dispatch').and.callThrough();
      service.duplicateProject('project-1');
      tick();
      // Should dispatch addNote for each note
      const addNoteCalls = dispatchSpy.calls
        .allArgs()
        .filter((args: any) => args[0]?.type === '[Note] Add Note');
      expect(addNoteCalls.length).toBe(2);
    }));

    it('should not copy isPinnedToToday for duplicated notes', fakeAsync(() => {
      const project = createProject({
        id: 'project-1',
        title: 'Project 1',
        noteIds: ['note-2'], // note-2 has isPinnedToToday: true
      });
      spyOn(service, 'getByIdOnce$').and.returnValue(of(project));
      const dispatchSpy = spyOn(store, 'dispatch').and.callThrough();
      service.duplicateProject('project-1');
      tick();
      const addNoteCalls = dispatchSpy.calls
        .allArgs()
        .filter((args: any) => args[0]?.type === '[Note] Add Note');
      expect(addNoteCalls.length).toBe(1);
      expect((addNoteCalls[0][0] as any).note.isPinnedToToday).toBe(false);
    }));
  });

  describe('unarchive', () => {
    it('dispatches unarchiveProject and shows a plain restore snack', async () => {
      const dispatchSpy = spyOn(store, 'dispatch').and.callThrough();
      await service.unarchive('project-1');
      const types = dispatchSpy.calls.allArgs().map((args: any) => args[0]?.type);
      expect(types).toContain('[Project] Unarchive Project');
      expect(snackService.open).toHaveBeenCalledWith({
        ico: 'unarchive',
        msg: T.F.PROJECT.S.UNARCHIVED,
      });
    });

    describe('when project is still hidden from the menu', () => {
      beforeEach(() => {
        store.setState({
          projects: {
            ids: ['project-1'],
            entities: {
              /* eslint-disable @typescript-eslint/naming-convention */
              'project-1': createProject({
                id: 'project-1',
                title: 'Hidden Project',
                isHiddenFromMenu: true,
              }),
              /* eslint-enable @typescript-eslint/naming-convention */
            },
          },
        });
      });

      it('should show the hidden-from-menu snack message', async () => {
        await service.unarchive('project-1');
        expect(snackService.open).toHaveBeenCalledWith(
          jasmine.objectContaining({
            ico: 'unarchive',
            msg: T.F.PROJECT.S.UNARCHIVED_HIDDEN_FROM_MENU,
            actionStr: T.F.PROJECT.S.SHOW_IN_MENU,
          }),
        );
      });

      it('should dispatch toggleHideFromMenu when the snack action is invoked', async () => {
        const dispatchSpy = spyOn(store, 'dispatch').and.callThrough();
        await service.unarchive('project-1');
        const callArgs = snackService.open.calls.mostRecent().args[0] as any;
        dispatchSpy.calls.reset();
        callArgs.actionFn();
        const types = dispatchSpy.calls.allArgs().map((args: any) => args[0]?.type);
        expect(types).toContain('[Project] Toggle hide from menu');
      });
    });
  });

  describe('complete', () => {
    it('dispatches the plain completeProject project action', () => {
      const dispatchSpy = spyOn(store, 'dispatch').and.callThrough();
      service.complete('project-1', 12345);
      const completeAction = dispatchSpy.calls
        .allArgs()
        .map((args: any) => args[0])
        .find((a: any) => a?.type === '[Project] Complete Project');
      expect(completeAction).toBeTruthy();
      expect(completeAction.id).toBe('project-1');
      expect(completeAction.doneOn).toBe(12345);
    });

    it('does not show an undo snack (completion is not reversible)', () => {
      service.complete('project-1', 1);
      expect(snackService.open).not.toHaveBeenCalled();
    });
  });

  describe('reopen', () => {
    it('dispatches reopenProject and shows a snack', () => {
      const dispatchSpy = spyOn(store, 'dispatch').and.callThrough();
      service.reopen('project-1');
      const types = dispatchSpy.calls.allArgs().map((args: any) => args[0]?.type);
      expect(types).toContain('[Project] Reopen Project');
      expect(snackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({ msg: T.F.PROJECT.S.REOPENED }),
      );
    });

    it('offers to show the project in the menu when reopening a hidden project', () => {
      const dispatchSpy = spyOn(store, 'dispatch').and.callThrough();
      service.reopen('project-1', { isHiddenFromMenu: true });
      const snackArg = snackService.open.calls.mostRecent().args[0] as any;

      expect(snackArg.actionStr).toBe(T.F.PROJECT.S.SHOW_IN_MENU);
      dispatchSpy.calls.reset();
      snackArg.actionFn();

      const types = dispatchSpy.calls.allArgs().map((args: any) => args[0]?.type);
      expect(types).toContain('[Project] Toggle hide from menu');
    });
  });

  describe('getCompletionInfo', () => {
    beforeEach(() => {
      store.setState({
        projects: {
          ids: ['project-1'],
          entities: {
            /* eslint-disable @typescript-eslint/naming-convention */
            'project-1': createProject({
              id: 'project-1',
              title: 'Project 1',
              taskIds: ['task-1', 'task-2'],
            }),
            /* eslint-enable @typescript-eslint/naming-convention */
          },
        },
      });
    });

    it('returns top-level tasks, all tasks incl. subtasks, and unfinished tasks', async () => {
      const info = await service.getCompletionInfo('project-1');
      expect(info.topLevelTasks.map((t) => t.id)).toEqual(['task-1', 'task-2']);
      // task-1 has sub-task-1 → included in allTasks, after its parent
      expect(info.allTasks.map((t) => t.id)).toEqual(['task-1', 'sub-task-1', 'task-2']);
      expect(info.unfinishedTasks.map((t) => t.id)).toEqual([
        'task-1',
        'sub-task-1',
        'task-2',
      ]);
      expect(info.topLevelTasksWithUnfinishedWork.map((t) => t.id)).toEqual([
        'task-1',
        'task-2',
      ]);
    });

    it('keeps a done parent with an unfinished subtask in topLevelTasksWithUnfinishedWork', async () => {
      store.overrideSelector(selectTaskFeatureState, {
        ...initialTaskState,
        entities: {
          ...initialTaskState.entities,
          /* eslint-disable-next-line @typescript-eslint/naming-convention */
          'task-1': { ...initialTaskState.entities['task-1'], isDone: true } as any,
        },
      });
      store.refreshState();
      const info = await service.getCompletionInfo('project-1');
      expect(info.unfinishedTasks.map((t) => t.id)).toEqual(['sub-task-1', 'task-2']);
      expect(info.topLevelTasksWithUnfinishedWork.map((t) => t.id)).toEqual([
        'task-1',
        'task-2',
      ]);
    });

    it('includes archived project tasks in stats lists without resolving them as unfinished work', async () => {
      const archivedParent = createTask({
        id: 'archived-task',
        title: 'Archived Task',
        projectId: 'project-1',
        isDone: true,
        subTaskIds: ['archived-sub-task'],
      });
      const archivedSubTask = createTask({
        id: 'archived-sub-task',
        title: 'Archived Sub Task',
        projectId: 'project-1',
        parentId: 'archived-task',
        isDone: false,
      });
      taskService.getAllTasksForProject.and.returnValue(
        Promise.resolve([
          initialTaskState.entities['task-1']!,
          initialTaskState.entities['sub-task-1']!,
          initialTaskState.entities['task-2']!,
          archivedParent,
          archivedSubTask,
        ]),
      );

      const info = await service.getCompletionInfo('project-1');

      expect(info.topLevelTasks.map((t) => t.id)).toEqual([
        'task-1',
        'task-2',
        'archived-task',
      ]);
      expect(info.allTasks.map((t) => t.id)).toEqual([
        'task-1',
        'sub-task-1',
        'task-2',
        'archived-task',
        'archived-sub-task',
      ]);
      expect(info.unfinishedTasks.map((t) => t.id)).toEqual([
        'task-1',
        'sub-task-1',
        'task-2',
      ]);
      expect(info.topLevelTasksWithUnfinishedWork.map((t) => t.id)).toEqual([
        'task-1',
        'task-2',
      ]);
    });
  });

  describe('resolve unfinished completion tasks', () => {
    it('moves top-level task trees with unfinished work to the Inbox', async () => {
      const task = { ...initialTaskState.entities['task-1']!, isDone: true };
      const taskWithSubTasks = {
        ...task,
        subTasks: [initialTaskState.entities['sub-task-1']!],
      };
      taskService.getByIdWithSubTaskData$.and.returnValue(of(taskWithSubTasks as any));

      await service.moveTasksToInbox([task]);

      expect(taskService.getByIdWithSubTaskData$).toHaveBeenCalledWith('task-1');
      expect(taskService.moveToProject).toHaveBeenCalledWith(
        taskWithSubTasks as any,
        'INBOX_PROJECT',
      );
      expect(taskService.setUnDone).toHaveBeenCalledWith('task-1');
    });

    it('does not re-open an unfinished task moved to the Inbox', async () => {
      const task = { ...initialTaskState.entities['task-1']!, isDone: false };
      taskService.getByIdWithSubTaskData$.and.returnValue(
        of({ ...task, subTasks: [] } as any),
      );

      await service.moveTasksToInbox([task]);

      expect(taskService.moveToProject).toHaveBeenCalled();
      expect(taskService.setUnDone).not.toHaveBeenCalled();
    });

    it('marks every unfinished task done, including subtasks', async () => {
      const parent = initialTaskState.entities['task-1']!;
      const subTask = initialTaskState.entities['sub-task-1']!;

      await service.markTasksDone([parent, subTask]);

      expect(taskService.setDone).toHaveBeenCalledWith('task-1');
      expect(taskService.setDone).toHaveBeenCalledWith('sub-task-1');
      // Exactly the passed set — no dropped or double-dispatched tasks.
      expect(taskService.setDone).toHaveBeenCalledTimes(2);
    });
  });
});
