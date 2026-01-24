import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { of, Subject } from 'rxjs';
import { Action } from '@ngrx/store';
import { TaskRelatedModelEffects } from './task-related-model.effects';
import { TaskService } from '../task.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { DEFAULT_TASK, Task } from '../task.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { selectTodayTaskIds } from '../../work-context/store/work-context.selectors';

describe('TaskRelatedModelEffects', () => {
  let effects: TaskRelatedModelEffects;
  let actions$: Subject<Action>;
  let store: MockStore;
  let taskService: jasmine.SpyObj<TaskService>;
  let hydrationStateService: jasmine.SpyObj<HydrationStateService>;

  const createTask = (id: string, partial: Partial<Task> = {}): Task => ({
    ...DEFAULT_TASK,
    id,
    title: `Task ${id}`,
    projectId: 'project-1',
    created: Date.now(),
    ...partial,
  });

  beforeEach(() => {
    actions$ = new Subject<Action>();

    const taskServiceSpy = jasmine.createSpyObj('TaskService', ['getByIdOnce$']);
    const hydrationStateServiceSpy = jasmine.createSpyObj('HydrationStateService', [
      'isApplyingRemoteOps',
    ]);
    hydrationStateServiceSpy.isApplyingRemoteOps.and.returnValue(false);

    TestBed.configureTestingModule({
      providers: [
        TaskRelatedModelEffects,
        provideMockActions(() => actions$),
        provideMockStore({
          selectors: [{ selector: selectTodayTaskIds, value: [] }],
        }),
        { provide: TaskService, useValue: taskServiceSpy },
        {
          provide: GlobalConfigService,
          useValue: {
            tasks$: of({ isAutoAddWorkedOnToToday: true }),
          },
        },
        { provide: HydrationStateService, useValue: hydrationStateServiceSpy },
        { provide: LOCAL_ACTIONS, useValue: actions$ },
      ],
    });

    effects = TestBed.inject(TaskRelatedModelEffects);
    store = TestBed.inject(MockStore);
    taskService = TestBed.inject(TaskService) as jasmine.SpyObj<TaskService>;
    hydrationStateService = TestBed.inject(
      HydrationStateService,
    ) as jasmine.SpyObj<HydrationStateService>;
  });

  afterEach(() => {
    store.resetSelectors();
    actions$.complete();
  });

  describe('autoAddTodayTagOnMarkAsDone', () => {
    it('should dispatch planTasksForToday when task is marked done and dueDay is not today', (done) => {
      const task = createTask('task-1', {
        parentId: undefined,
        dueDay: undefined, // NOT set to today
      });
      taskService.getByIdOnce$.and.returnValue(of(task));

      effects.autoAddTodayTagOnMarkAsDone.subscribe({
        next: (action) => {
          expect(action).toEqual(
            TaskSharedActions.planTasksForToday({
              taskIds: ['task-1'],
            }),
          );
          done();
        },
        error: done.fail,
      });

      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { isDone: true } },
        }),
      );
    });

    it('should NOT dispatch planTasksForToday when task is marked done but already has dueDay set to today', (done) => {
      const today = getDbDateStr();
      const task = createTask('task-1', {
        parentId: undefined,
        dueDay: today, // Already set to today
      });
      taskService.getByIdOnce$.and.returnValue(of(task));

      let emitted = false;
      const subscription = effects.autoAddTodayTagOnMarkAsDone.subscribe(() => {
        emitted = true;
      });

      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { isDone: true } },
        }),
      );

      // Wait a bit to ensure no emission
      setTimeout(() => {
        expect(emitted).toBe(false);
        subscription.unsubscribe();
        done();
      }, 100);
    });

    it('should NOT dispatch planTasksForToday when task has a parent', (done) => {
      const task = createTask('task-1', {
        parentId: 'parent-task', // Has parent
        dueDay: undefined,
      });
      taskService.getByIdOnce$.and.returnValue(of(task));

      let emitted = false;
      const subscription = effects.autoAddTodayTagOnMarkAsDone.subscribe(() => {
        emitted = true;
      });

      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { isDone: true } },
        }),
      );

      setTimeout(() => {
        expect(emitted).toBe(false);
        subscription.unsubscribe();
        done();
      }, 100);
    });

    it('should NOT dispatch when hydration is in progress', (done) => {
      hydrationStateService.isApplyingRemoteOps.and.returnValue(true);

      const task = createTask('task-1', {
        parentId: undefined,
        dueDay: undefined,
      });
      taskService.getByIdOnce$.and.returnValue(of(task));

      let emitted = false;
      const subscription = effects.autoAddTodayTagOnMarkAsDone.subscribe(() => {
        emitted = true;
      });

      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { isDone: true } },
        }),
      );

      setTimeout(() => {
        expect(emitted).toBe(false);
        subscription.unsubscribe();
        done();
      }, 100);
    });

    it('should NOT dispatch when isDone is false', (done) => {
      const task = createTask('task-1', {
        parentId: undefined,
        dueDay: undefined,
      });
      taskService.getByIdOnce$.and.returnValue(of(task));

      let emitted = false;
      const subscription = effects.autoAddTodayTagOnMarkAsDone.subscribe(() => {
        emitted = true;
      });

      actions$.next(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { isDone: false } },
        }),
      );

      setTimeout(() => {
        expect(emitted).toBe(false);
        subscription.unsubscribe();
        done();
      }, 100);
    });
  });
});
