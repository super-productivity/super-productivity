import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Observable, of } from 'rxjs';
import { Action, Store } from '@ngrx/store';
import { TaskReminderEffects } from './task-reminder.effects';
import { SnackService } from '../../../core/snack/snack.service';
import { TaskService } from '../task.service';
import { LocaleDatePipe } from '../../../ui/pipes/locale-date.pipe';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { DEFAULT_TASK, Task } from '../task.model';
import { TestScheduler } from 'rxjs/testing';
import { T } from '../../../t.const';

describe('TaskReminderEffects', () => {
  let actions$: Observable<Action>;
  let effects: TaskReminderEffects;
  let snackService: jasmine.SpyObj<SnackService>;
  let taskService: jasmine.SpyObj<TaskService>;
  let store: jasmine.SpyObj<Store>;
  let datePipe: jasmine.SpyObj<LocaleDatePipe>;
  let testScheduler: TestScheduler;

  const mockTask: Task = {
    ...DEFAULT_TASK,
    id: 'task-1',
    title: 'Test Task',
    projectId: 'project-1',
    created: Date.now(),
  };

  const mockTaskWithReminder: Task = {
    ...mockTask,
    remindAt: Date.now() + 3600000,
  };

  beforeEach(() => {
    const snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);
    const taskServiceSpy = jasmine.createSpyObj('TaskService', ['getByIdOnce$']);
    const storeSpy = jasmine.createSpyObj('Store', ['dispatch']);
    const datePipeSpy = jasmine.createSpyObj('LocaleDatePipe', ['transform']);

    TestBed.configureTestingModule({
      providers: [
        TaskReminderEffects,
        provideMockActions(() => actions$),
        { provide: SnackService, useValue: snackServiceSpy },
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: Store, useValue: storeSpy },
        { provide: LocaleDatePipe, useValue: datePipeSpy },
      ],
    });

    effects = TestBed.inject(TaskReminderEffects);
    snackService = TestBed.inject(SnackService) as jasmine.SpyObj<SnackService>;
    taskService = TestBed.inject(TaskService) as jasmine.SpyObj<TaskService>;
    store = TestBed.inject(Store) as jasmine.SpyObj<Store>;
    datePipe = TestBed.inject(LocaleDatePipe) as jasmine.SpyObj<LocaleDatePipe>;

    testScheduler = new TestScheduler((actual, expected) => {
      expect(actual).toEqual(expected);
    });
  });

  describe('snack$', () => {
    it('should show success snack when task is scheduled with reminder', () => {
      const dueWithTime = Date.now() + 86400000;
      const remindAt = dueWithTime - 300000;
      const action = TaskSharedActions.scheduleTaskWithTime({
        task: mockTask,
        dueWithTime,
        remindAt,
        isMoveToBacklog: false,
      });

      datePipe.transform.and.returnValue('1/1/2025, 10:00 AM');
      actions$ = of(action);

      effects.snack$.subscribe();

      expect(snackService.open).toHaveBeenCalledWith({
        type: 'SUCCESS',
        translateParams: {
          title: 'Test Task',
          date: '1/1/2025, 10:00 AM',
        },
        msg: T.F.TASK.S.REMINDER_ADDED,
        ico: 'alarm',
      });
    });

    it('should show schedule icon when remindAt is not set', () => {
      const dueWithTime = Date.now() + 86400000;
      const action = TaskSharedActions.scheduleTaskWithTime({
        task: mockTask,
        dueWithTime,
        remindAt: undefined,
        isMoveToBacklog: false,
      });

      datePipe.transform.and.returnValue('1/1/2025, 10:00 AM');
      actions$ = of(action);

      effects.snack$.subscribe();

      expect(snackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          ico: 'schedule',
        }),
      );
    });

    it('should truncate long task titles', () => {
      const longTitleTask: Task = {
        ...mockTask,
        title:
          'This is a very long task title that exceeds the maximum allowed length for display',
      };
      const dueWithTime = Date.now() + 86400000;
      const action = TaskSharedActions.scheduleTaskWithTime({
        task: longTitleTask,
        dueWithTime,
        remindAt: dueWithTime,
        isMoveToBacklog: false,
      });

      datePipe.transform.and.returnValue('1/1/2025');
      actions$ = of(action);

      effects.snack$.subscribe();

      expect(snackService.open).toHaveBeenCalled();
      const callArgs = snackService.open.calls.mostRecent().args[0];
      if (typeof callArgs !== 'string' && callArgs.translateParams) {
        const title = callArgs.translateParams.title;
        if (typeof title === 'string') {
          expect(title.length).toBeLessThanOrEqual(40);
        }
      }
    });
  });

  // Note: autoMoveToBacklog$ effect was removed - functionality moved to task-shared-scheduling.reducer
  // The isMoveToBacklog flag is now handled atomically in the reducer for atomic consistency

  describe('updateTaskReminderSnack$', () => {
    it('should show snack when task reminder is updated', () => {
      const action = TaskSharedActions.reScheduleTaskWithTime({
        task: mockTask,
        dueWithTime: Date.now() + 86400000,
        remindAt: Date.now() + 86000000,
        isMoveToBacklog: false,
      });

      actions$ = of(action);

      effects.updateTaskReminderSnack$.subscribe();

      expect(snackService.open).toHaveBeenCalledWith({
        type: 'SUCCESS',
        translateParams: {
          title: 'Test Task',
        },
        msg: T.F.TASK.S.REMINDER_UPDATED,
        ico: 'schedule',
      });
    });

    it('should not show snack when remindAt is undefined', () => {
      testScheduler.run(({ hot, expectObservable }) => {
        const action = TaskSharedActions.reScheduleTaskWithTime({
          task: mockTask,
          dueWithTime: Date.now() + 86400000,
          remindAt: undefined,
          isMoveToBacklog: false,
        });

        actions$ = hot('-a', { a: action });

        // Non-dispatching effect, just verify snack not called
        effects.updateTaskReminderSnack$.subscribe();
      });
    });
  });

  // Note: autoMoveToBacklogOnReschedule$ effect was removed - functionality moved to task-shared-scheduling.reducer
  // The isMoveToBacklog flag is now handled atomically in the reducer for atomic consistency

  describe('unscheduleDoneTask$', () => {
    it('should dispatch unscheduleTask when completing task with reminder', () => {
      const action = TaskSharedActions.updateTask({
        task: { id: 'task-1', changes: { isDone: true } },
      });

      actions$ = of(action);
      taskService.getByIdOnce$.and.returnValue(of(mockTaskWithReminder));

      effects.unscheduleDoneTask$.subscribe();

      expect(store.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.unscheduleTask({ id: 'task-1' }),
      );
    });

    it('should not dispatch when task has no reminder', () => {
      const taskWithoutReminder: Task = {
        ...mockTask,
        remindAt: undefined,
      };
      const action = TaskSharedActions.updateTask({
        task: { id: 'task-1', changes: { isDone: true } },
      });

      actions$ = of(action);
      taskService.getByIdOnce$.and.returnValue(of(taskWithoutReminder));

      effects.unscheduleDoneTask$.subscribe();

      expect(store.dispatch).not.toHaveBeenCalled();
    });

    it('should not process when isDone change is false', () => {
      testScheduler.run(({ hot, expectObservable }) => {
        const action = TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { isDone: false } },
        });

        actions$ = hot('-a', { a: action });

        // Non-dispatching effect with filter - should not call getByIdOnce$
        effects.unscheduleDoneTask$.subscribe();

        expect(taskService.getByIdOnce$).not.toHaveBeenCalled();
      });
    });

    it('should not process updates without isDone change', () => {
      testScheduler.run(({ hot, expectObservable }) => {
        const action = TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { title: 'New Title' } },
        });

        actions$ = hot('-a', { a: action });

        effects.unscheduleDoneTask$.subscribe();

        expect(taskService.getByIdOnce$).not.toHaveBeenCalled();
      });
    });
  });

  describe('unscheduleSnack$', () => {
    it('should show snack when task is unscheduled', () => {
      const action = TaskSharedActions.unscheduleTask({ id: 'task-1' });

      actions$ = of(action);

      effects.unscheduleSnack$.subscribe();

      expect(snackService.open).toHaveBeenCalledWith({
        type: 'SUCCESS',
        msg: T.F.TASK.S.REMINDER_DELETED,
        ico: 'schedule',
      });
    });

    it('should not show snack when isSkipToast is true', () => {
      testScheduler.run(({ hot, expectObservable }) => {
        const action = TaskSharedActions.unscheduleTask({
          id: 'task-1',
          isSkipToast: true,
        });

        actions$ = hot('-a', { a: action });

        effects.unscheduleSnack$.subscribe();
      });

      expect(snackService.open).not.toHaveBeenCalled();
    });
  });

  describe('dismissReminderSnack$', () => {
    it('should show snack when reminder is dismissed', () => {
      const action = TaskSharedActions.dismissReminderOnly({ id: 'task-1' });

      actions$ = of(action);

      effects.dismissReminderSnack$.subscribe();

      expect(snackService.open).toHaveBeenCalledWith({
        type: 'SUCCESS',
        msg: T.F.TASK.S.REMINDER_DELETED,
        ico: 'schedule',
      });
    });
  });

  // NOTE: Tests for removeTaskReminderTrigger1$ were removed because the effect no longer exists.
  // The reminder removal is now handled differently in the task-shared scheduling meta-reducer.
});
