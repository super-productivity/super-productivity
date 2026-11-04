import { Action, ActionReducer } from '@ngrx/store';
import { TestBed } from '@angular/core/testing';
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
    store = jasmine.createSpyObj<Store>('Store', ['dispatch']);
    state = createBaseState();

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
});
