import { TestBed, fakeAsync, tick } from '@angular/core/testing';
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
import { DateService } from '../../../core/date/date.service';
import { TimeTrackingActions } from '../../time-tracking/store/time-tracking.actions';

describe('TaskRelatedModelEffects', () => {
  let effects: TaskRelatedModelEffects;
  let actions$: Subject<Action>;
  let store: MockStore;
  let taskService: jasmine.SpyObj<TaskService>;
  let hydrationStateService: jasmine.SpyObj<HydrationStateService>;
  let dateService: jasmine.SpyObj<DateService>;

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
    const dateServiceSpy = jasmine.createSpyObj<DateService>('DateService', [
      'todayStr',
      'getStartOfNextDayDiffMs',
    ]);
    dateServiceSpy.todayStr.and.returnValue(getDbDateStr());
    dateServiceSpy.getStartOfNextDayDiffMs.and.returnValue(0);

    TestBed.configureTestingModule({
      providers: [
        TaskRelatedModelEffects,
        provideMockActions(() => actions$),
        provideMockStore({
          selectors: [{ selector: selectTodayTaskIds, value: [] }],
        }),
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: DateService, useValue: dateServiceSpy },
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
    dateService = TestBed.inject(DateService) as jasmine.SpyObj<DateService>;
  });

  afterEach(() => {
    store.resetSelectors();
    actions$.complete();
  });

  describe('autoAddTodayTagOnTracking', () => {
    const dispatchAddTimeSpent = (task: Task): void => {
      actions$.next(
        TimeTrackingActions.addTimeSpent({
          task,
          date: dateService.todayStr(),
          duration: 1000,
          isFromTrackingReminder: false,
        }),
      );
    };

    it('should dispatch planTasksForToday when tracking an unscheduled task', (done) => {
      const task = createTask('task-1', {
        dueDay: undefined,
        dueWithTime: undefined,
      });

      effects.autoAddTodayTagOnTracking.subscribe({
        next: (action) => {
          expect(action).toEqual(
            jasmine.objectContaining({
              taskIds: ['task-1'],
              today: dateService.todayStr(),
              startOfNextDayDiffMs: dateService.getStartOfNextDayDiffMs(),
            }),
          );
          done();
        },
        error: done.fail,
      });

      dispatchAddTimeSpent(task);
    });

    it('should NOT dispatch planTasksForToday when tracked task has an existing dueDay', fakeAsync(() => {
      const task = createTask('task-1', {
        dueDay: '2026-05-16',
        dueWithTime: undefined,
      });
      let emitted = false;
      const subscription = effects.autoAddTodayTagOnTracking.subscribe(() => {
        emitted = true;
      });

      dispatchAddTimeSpent(task);
      tick();

      expect(emitted).toBe(false);
      subscription.unsubscribe();
    }));

    it('should NOT dispatch planTasksForToday when tracked task has dueWithTime', fakeAsync(() => {
      const task = createTask('task-1', {
        dueDay: undefined,
        dueWithTime: Date.now(),
      });
      let emitted = false;
      const subscription = effects.autoAddTodayTagOnTracking.subscribe(() => {
        emitted = true;
      });

      dispatchAddTimeSpent(task);
      tick();

      expect(emitted).toBe(false);
      subscription.unsubscribe();
    }));
  });

  describe('autoAddTodayTagOnMarkAsDone', () => {
    it('should dispatch planTasksForToday when an unscheduled task is marked done', (done) => {
      const task = createTask('task-1', {
        parentId: undefined,
        dueDay: undefined,
        dueWithTime: undefined,
      });
      taskService.getByIdOnce$.and.returnValue(of(task));

      effects.autoAddTodayTagOnMarkAsDone.subscribe({
        next: (action) => {
          expect(action).toEqual(
            jasmine.objectContaining({
              taskIds: ['task-1'],
              today: dateService.todayStr(),
              startOfNextDayDiffMs: dateService.getStartOfNextDayDiffMs(),
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

    it('should NOT dispatch planTasksForToday when marked done task has an existing dueDay', fakeAsync(() => {
      const task = createTask('task-1', {
        parentId: undefined,
        dueDay: '2026-05-16',
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
      tick();

      expect(emitted).toBe(false);
      subscription.unsubscribe();
    }));

    it('should NOT dispatch planTasksForToday when marked done task has dueWithTime', fakeAsync(() => {
      const task = createTask('task-1', {
        parentId: undefined,
        dueWithTime: Date.now(),
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
      tick();

      expect(emitted).toBe(false);
      subscription.unsubscribe();
    }));

    it('should NOT dispatch planTasksForToday when task is marked done but already has dueDay set to today', fakeAsync(() => {
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
      tick();

      expect(emitted).toBe(false);
      subscription.unsubscribe();
    }));

    it('should NOT dispatch planTasksForToday when task has a parent', fakeAsync(() => {
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
      tick();

      expect(emitted).toBe(false);
      subscription.unsubscribe();
    }));

    it('should NOT dispatch when hydration is in progress', fakeAsync(() => {
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
      tick();

      expect(emitted).toBe(false);
      subscription.unsubscribe();
    }));

    it('should NOT dispatch when isDone is false', fakeAsync(() => {
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
      tick();

      expect(emitted).toBe(false);
      subscription.unsubscribe();
    }));
  });
});
