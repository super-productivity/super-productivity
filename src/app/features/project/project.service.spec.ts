import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { ProjectService } from './project.service';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { selectTaskFeatureState } from '../tasks/store/task.selectors';
import { TaskState } from '../tasks/task.model';
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

describe('ProjectService', () => {
  let service: ProjectService;
  let store: MockStore;
  let taskService: jasmine.SpyObj<TaskService>;
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
    ]);
    taskService.createNewTaskWithDefaults.and.callFake(() => {
      taskCounter++;
      return createTask({
        id: `new-task-${taskCounter}`,
        title: `New Task ${taskCounter}`,
      });
    });
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
                project1: createProject({ id: 'project-1', title: 'Project 1' }),
                project2: createProject({ id: 'project-2', title: 'Project 2' }),
              },
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
        { provide: SnackService, useValue: { open: () => {} } },
        {
          provide: TaskRepeatCfgService,
          useValue: { getTaskRepeatCfgsWithLabels$: () => of([]) },
        },
        { provide: TimeTrackingService, useValue: timeTrackingService },
      ],
    });
    workContextService.activeWorkContext$ = EMPTY;
    workContextService.activeWorkContextTypeAndId$ = of({
      activeId: 'project-1',
      activeType: WorkContextType.PROJECT,
    });
    (timeTrackingService.state$ as any) = of({});
    service = TestBed.inject(ProjectService);
    store = TestBed.inject(Store) as MockStore<any>;
    store.overrideSelector(selectTaskFeatureState, initialTaskState);
    store.overrideSelector(selectNoteFeatureState, initialNoteState);
  });

  afterEach(() => {
    // Reset selector mocks to prevent interference with other test files
    store.resetSelectors();
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

    it('should throw an error if the template project is not found', fakeAsync(() => {
      spyOn(service, 'getByIdOnce$').and.returnValue(of(undefined as any));
      service.duplicateProject('non-existing-project').catch((e) => {
        expect(e.message).toBe('Template project not found');
      });
      tick();
    }));

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
});
