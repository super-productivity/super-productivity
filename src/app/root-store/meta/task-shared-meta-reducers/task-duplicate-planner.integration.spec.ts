import { Action, ActionReducer } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { initialNoteState } from '../../../features/note/store/note.reducer';
import { initialSectionState } from '../../../features/section/store/section.reducer';
import { Store } from '@ngrx/store';
import { TaskDuplicateService } from '../../../features/tasks/task-duplicate.service';
import { TaskService } from '../../../features/tasks/task.service';
import { DEFAULT_TASK, Task, TaskWithSubTasks } from '../../../features/tasks/task.model';
import {
  taskReducer,
  TASK_FEATURE_NAME,
} from '../../../features/tasks/store/task.reducer';
import { tagReducer, TAG_FEATURE_NAME } from '../../../features/tag/store/tag.reducer';
import {
  projectReducer,
  PROJECT_FEATURE_NAME,
} from '../../../features/project/store/project.reducer';
import {
  plannerReducer,
  plannerFeatureKey,
} from '../../../features/planner/store/planner.reducer';
import { TaskSharedActions } from '../task-shared.actions';
import { WorkContextType } from '../../../features/work-context/work-context.model';
import { RootState } from '../../root-state';
import { createCombinedTaskSharedMetaReducer } from './test-helpers';
import { createBaseState } from './test-utils';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { selectActiveWorkContext } from '../../../features/work-context/store/work-context.selectors';

describe('Task duplication Planner membership integration', () => {
  let service: TaskDuplicateService;
  let taskService: jasmine.SpyObj<TaskService>;
  let store: jasmine.SpyObj<Store>;
  let state: RootState;
  let reducer: ActionReducer<RootState, Action>;

  beforeEach(() => {
    taskService = jasmine.createSpyObj<TaskService>('TaskService', [
      'add',
      'createNewTaskWithDefaults',
    ]);
    store = jasmine.createSpyObj<Store>('Store', ['dispatch', 'selectSignal']);
    const initialState = {
      ...createBaseState(),
      workContext: { activeId: 'project1', activeType: WorkContextType.PROJECT },
      section: initialSectionState,
      note: initialNoteState,
    };
    state = initialState;
    const stateSignal = signal(state);
    store.selectSignal.and.callFake(<K>(selector: (value: object) => K) =>
      computed(() => selector(stateSignal())),
    );

    const coreReducer: ActionReducer<RootState, Action> = (currentState, action) => {
      const rootState = currentState ?? state;
      return {
        ...rootState,
        [TASK_FEATURE_NAME]: taskReducer(rootState[TASK_FEATURE_NAME], action),
        [TAG_FEATURE_NAME]: tagReducer(rootState[TAG_FEATURE_NAME], action),
        [PROJECT_FEATURE_NAME]: projectReducer(rootState[PROJECT_FEATURE_NAME], action),
        [plannerFeatureKey]: plannerReducer(rootState[plannerFeatureKey], action),
      };
    };
    reducer = createCombinedTaskSharedMetaReducer(coreReducer);
    store.dispatch.and.callFake((action) => {
      state = reducer(state, action);
      stateSignal.set(state);
      return action;
    });

    taskService.add.and.callFake((title, isAddToBacklog, additional, isAddToBottom) => {
      const task: Task = {
        ...DEFAULT_TASK,
        ...additional,
        id: 'new-parent',
        title: title ?? '',
        projectId: 'project1',
        subTaskIds: [],
      };
      store.dispatch(
        TaskSharedActions.addTask({
          task,
          workContextId: 'project1',
          workContextType: WorkContextType.PROJECT,
          isAddToBacklog: isAddToBacklog ?? false,
          isAddToBottom: isAddToBottom ?? false,
        }),
      );
      return task.id;
    });
    taskService.createNewTaskWithDefaults.and.callFake(({ title, additional }) => ({
      ...DEFAULT_TASK,
      ...additional,
      id: 'new-subtask',
      title: title ?? '',
      projectId: 'project1',
    }));

    TestBed.configureTestingModule({
      providers: [
        TaskDuplicateService,
        { provide: TranslateService, useValue: { instant: () => ' (copy)' } },
        { provide: TaskService, useValue: taskService },
        { provide: Store, useValue: store },
      ],
    });
    service = TestBed.inject(TaskDuplicateService);
  });

  it('adds a copied future all-day subtask to its Planner day when its parent is scheduled Today', () => {
    const today = getDbDateStr();
    const futureDay = '2099-12-31';
    const subTask: Task = {
      ...DEFAULT_TASK,
      id: 'original-subtask',
      title: 'Subtask',
      projectId: 'project1',
      dueDay: futureDay,
    };
    const parent: TaskWithSubTasks = {
      ...DEFAULT_TASK,
      id: 'original-parent',
      title: 'Parent',
      projectId: 'project1',
      dueDay: today,
      subTaskIds: [subTask.id],
      subTasks: [subTask],
    };

    service.duplicate(parent);

    expect(state[TASK_FEATURE_NAME].entities['new-subtask']?.dueDay).toBe(futureDay);
    expect(state[plannerFeatureKey].days[futureDay]).toEqual(['new-subtask']);
  });

  for (const stored of [[], ['hidden']]) {
    it(`keeps a Today copy adjacent with stored order ${JSON.stringify(stored)}`, () => {
      const today = getDbDateStr();
      const tasks = ['before', 'original', 'after'].map((id) => ({
        ...DEFAULT_TASK,
        id,
        title: id,
        projectId: 'project1',
        dueDay: today,
      }));
      const hidden = {
        ...DEFAULT_TASK,
        id: 'hidden',
        title: 'Future',
        projectId: 'project1',
        dueDay: '2099-12-31',
      };
      state = {
        ...state,
        workContext: { activeId: 'TODAY', activeType: WorkContextType.TAG },
        tasks: {
          ...state.tasks,
          ids: [...tasks.map((task) => task.id), hidden.id],
          entities: Object.fromEntries([...tasks, hidden].map((task) => [task.id, task])),
        },
        tag: {
          ...state.tag,
          entities: {
            ...state.tag.entities,
            TODAY: { ...state.tag.entities['TODAY']!, taskIds: stored },
          },
        },
      };
      service.duplicate({ ...tasks[1], subTasks: [] });
      expect(selectActiveWorkContext(state).taskIds).toEqual([
        'before',
        'original',
        'new-parent',
        'after',
      ]);
      expect(state.tag.entities['TODAY']!.taskIds).toEqual([
        ...stored,
        'before',
        'original',
        'new-parent',
        'after',
      ]);
    });
  }
});
