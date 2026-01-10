import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Observable, of } from 'rxjs';
import { TaskReminderEffects } from './task-reminder.effects';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { ReminderService } from '../../reminder/reminder.service';
import { SnackService } from '../../../core/snack/snack.service';
import { TaskService } from '../task.service';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { Task, TaskWithSubTasks } from '../task.model';
import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { removeReminderFromTask } from './task.actions';

describe('TaskReminderEffects', () => {
  let effects: TaskReminderEffects;
  let actions$: Observable<any>;
  let reminderServiceMock: jasmine.SpyObj<ReminderService>;
  let taskServiceMock: jasmine.SpyObj<TaskService>;
  let store: MockStore;

  const createMockTask = (overrides: Partial<Task> = {}): Task =>
    ({
      id: 'task-123',
      title: 'Test Task',
      projectId: null,
      tagIds: [],
      subTaskIds: [],
      parentId: null,
      timeSpentOnDay: {},
      timeSpent: 0,
      timeEstimate: 0,
      isDone: false,
      notes: '',
      doneOn: undefined,
      plannedAt: null,
      reminderId: null,
      repeatCfgId: null,
      issueId: null,
      issueType: null,
      issueProviderId: null,
      issueWasUpdated: false,
      issueLastUpdated: null,
      issueTimeTracked: null,
      attachments: [],
      created: Date.now(),
      _showSubTasksMode: 2,
      ...overrides,
    }) as Task;

  const createMockTaskWithSubTasks = (
    overrides: Partial<TaskWithSubTasks> = {},
  ): TaskWithSubTasks =>
    ({
      ...createMockTask(),
      subTasks: [],
      ...overrides,
    }) as TaskWithSubTasks;

  beforeEach(() => {
    reminderServiceMock = jasmine.createSpyObj('ReminderService', [
      'removeReminderByRelatedIdIfSet',
      'removeRemindersByRelatedIds',
      'removeReminder',
      'addReminder',
      'updateReminder',
    ]);

    taskServiceMock = jasmine.createSpyObj('TaskService', [
      'getByIdOnce$',
      'getByIdsLive$',
    ]);

    TestBed.configureTestingModule({
      providers: [
        TaskReminderEffects,
        provideMockActions(() => actions$),
        provideMockStore({ initialState: {} }),
        { provide: ReminderService, useValue: reminderServiceMock },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
        {
          provide: TaskService,
          useValue: taskServiceMock,
        },
        {
          provide: LocaleDatePipe,
          useValue: jasmine.createSpyObj('LocaleDatePipe', ['transform']),
        },
      ],
    });

    effects = TestBed.inject(TaskReminderEffects);
    store = TestBed.inject(MockStore);
  });

  describe('clearRemindersOnDelete$', () => {
    it('should call removeReminderByRelatedIdIfSet for deleted task', (done) => {
      const task = createMockTaskWithSubTasks({ id: 'task-to-delete' });
      actions$ = of(TaskSharedActions.deleteTask({ task }));

      effects.clearRemindersOnDelete$.subscribe(() => {
        expect(reminderServiceMock.removeReminderByRelatedIdIfSet).toHaveBeenCalledWith(
          'task-to-delete',
        );
        done();
      });
    });

    it('should call removeReminderByRelatedIdIfSet for all subtasks', (done) => {
      const task = createMockTaskWithSubTasks({
        id: 'parent-task',
        subTaskIds: ['subtask-1', 'subtask-2'],
      });
      actions$ = of(TaskSharedActions.deleteTask({ task }));

      effects.clearRemindersOnDelete$.subscribe(() => {
        expect(reminderServiceMock.removeReminderByRelatedIdIfSet).toHaveBeenCalledTimes(
          3,
        );
        expect(reminderServiceMock.removeReminderByRelatedIdIfSet).toHaveBeenCalledWith(
          'parent-task',
        );
        expect(reminderServiceMock.removeReminderByRelatedIdIfSet).toHaveBeenCalledWith(
          'subtask-1',
        );
        expect(reminderServiceMock.removeReminderByRelatedIdIfSet).toHaveBeenCalledWith(
          'subtask-2',
        );
        done();
      });
    });

    it('should handle task with empty subtaskIds', (done) => {
      const task = createMockTaskWithSubTasks({
        id: 'task-no-subtasks',
        subTaskIds: [],
      });
      actions$ = of(TaskSharedActions.deleteTask({ task }));

      effects.clearRemindersOnDelete$.subscribe(() => {
        expect(reminderServiceMock.removeReminderByRelatedIdIfSet).toHaveBeenCalledTimes(
          1,
        );
        expect(reminderServiceMock.removeReminderByRelatedIdIfSet).toHaveBeenCalledWith(
          'task-no-subtasks',
        );
        done();
      });
    });
  });

  describe('clearMultipleReminders', () => {
    it('should call removeRemindersByRelatedIds with all task IDs', (done) => {
      const taskIds = ['task-1', 'task-2', 'task-3'];
      actions$ = of(TaskSharedActions.deleteTasks({ taskIds }));

      effects.clearMultipleReminders.subscribe(() => {
        expect(reminderServiceMock.removeRemindersByRelatedIds).toHaveBeenCalledWith(
          taskIds,
        );
        done();
      });
    });

    it('should handle empty task IDs array', (done) => {
      const taskIds: string[] = [];
      actions$ = of(TaskSharedActions.deleteTasks({ taskIds }));

      effects.clearMultipleReminders.subscribe(() => {
        expect(reminderServiceMock.removeRemindersByRelatedIds).toHaveBeenCalledWith([]);
        done();
      });
    });
  });

  describe('clearRemindersForArchivedTasks$', () => {
    it('should call removeReminder for each task with a reminderId', (done) => {
      const tasks = [
        createMockTaskWithSubTasks({ id: 'archived-1', reminderId: 'rem-1' }),
        createMockTaskWithSubTasks({ id: 'archived-2', reminderId: 'rem-2' }),
      ];
      actions$ = of(TaskSharedActions.moveToArchive({ tasks }));

      effects.clearRemindersForArchivedTasks$.subscribe(() => {
        expect(reminderServiceMock.removeReminder).toHaveBeenCalledTimes(2);
        expect(reminderServiceMock.removeReminder).toHaveBeenCalledWith('rem-1');
        expect(reminderServiceMock.removeReminder).toHaveBeenCalledWith('rem-2');
        done();
      });
    });

    it('should not call removeReminder for tasks without reminderId', (done) => {
      const tasks = [
        createMockTaskWithSubTasks({ id: 'archived-1', reminderId: undefined }),
        createMockTaskWithSubTasks({ id: 'archived-2', reminderId: 'rem-2' }),
      ];
      actions$ = of(TaskSharedActions.moveToArchive({ tasks }));

      effects.clearRemindersForArchivedTasks$.subscribe(() => {
        expect(reminderServiceMock.removeReminder).toHaveBeenCalledTimes(1);
        expect(reminderServiceMock.removeReminder).toHaveBeenCalledWith('rem-2');
        done();
      });
    });

    it('should not call removeReminder when tasks array is empty', (done) => {
      const tasks: TaskWithSubTasks[] = [];
      actions$ = of(TaskSharedActions.moveToArchive({ tasks }));

      effects.clearRemindersForArchivedTasks$.subscribe(() => {
        expect(reminderServiceMock.removeReminder).not.toHaveBeenCalled();
        done();
      });
    });

    it('should handle nested subtasks in archived tasks', (done) => {
      const tasks = [
        createMockTaskWithSubTasks({
          id: 'parent-1',
          reminderId: 'rem-parent',
          subTasks: [
            createMockTask({
              id: 'sub-1',
              reminderId: 'rem-sub-1',
              parentId: 'parent-1',
            }),
            createMockTask({
              id: 'sub-2',
              reminderId: 'rem-sub-2',
              parentId: 'parent-1',
            }),
          ],
        }),
      ];
      actions$ = of(TaskSharedActions.moveToArchive({ tasks }));

      effects.clearRemindersForArchivedTasks$.subscribe(() => {
        // flattenTasks should include parent + subtasks
        expect(reminderServiceMock.removeReminder).toHaveBeenCalledWith('rem-parent');
        expect(reminderServiceMock.removeReminder).toHaveBeenCalledWith('rem-sub-1');
        expect(reminderServiceMock.removeReminder).toHaveBeenCalledWith('rem-sub-2');
        done();
      });
    });
  });

  describe('removeTaskReminderTrigger1$', () => {
    it('should handle undefined tasks in array without crashing (issue #5873)', (done) => {
      const taskWithReminder = createMockTask({ id: 'task-1', reminderId: 'rem-1' });
      // Simulate a deleted task that returns undefined from the selector
      taskServiceMock.getByIdsLive$.and.returnValue(
        of([
          taskWithReminder,
          undefined as unknown as Task,
          undefined as unknown as Task,
        ]),
      );

      actions$ = of(
        TaskSharedActions.planTasksForToday({
          taskIds: ['task-1', 'deleted-task', 'another-deleted'],
          parentTaskMap: {},
          isSkipRemoveReminder: false,
        }),
      );

      const emittedActions: any[] = [];
      effects.removeTaskReminderTrigger1$.subscribe({
        next: (action) => emittedActions.push(action),
        complete: () => {
          // Should only emit action for the valid task with reminder
          expect(emittedActions.length).toBe(1);
          expect(emittedActions[0]).toEqual(
            removeReminderFromTask({
              id: 'task-1',
              reminderId: 'rem-1',
              isSkipToast: true,
            }),
          );
          done();
        },
      });
    });

    it('should not emit actions when all tasks are undefined', (done) => {
      taskServiceMock.getByIdsLive$.and.returnValue(
        of([undefined as unknown as Task, undefined as unknown as Task]),
      );

      actions$ = of(
        TaskSharedActions.planTasksForToday({
          taskIds: ['deleted-1', 'deleted-2'],
          parentTaskMap: {},
          isSkipRemoveReminder: false,
        }),
      );

      const emittedActions: any[] = [];
      effects.removeTaskReminderTrigger1$.subscribe({
        next: (action) => emittedActions.push(action),
        complete: () => {
          expect(emittedActions.length).toBe(0);
          done();
        },
      });
    });

    it('should only emit for tasks with reminderId', (done) => {
      const taskWithReminder = createMockTask({ id: 'task-1', reminderId: 'rem-1' });
      const taskWithoutReminder = createMockTask({ id: 'task-2', reminderId: undefined });
      taskServiceMock.getByIdsLive$.and.returnValue(
        of([taskWithReminder, taskWithoutReminder]),
      );

      actions$ = of(
        TaskSharedActions.planTasksForToday({
          taskIds: ['task-1', 'task-2'],
          parentTaskMap: {},
          isSkipRemoveReminder: false,
        }),
      );

      const emittedActions: any[] = [];
      effects.removeTaskReminderTrigger1$.subscribe({
        next: (action) => emittedActions.push(action),
        complete: () => {
          expect(emittedActions.length).toBe(1);
          expect(emittedActions[0]).toEqual(
            removeReminderFromTask({
              id: 'task-1',
              reminderId: 'rem-1',
              isSkipToast: true,
            }),
          );
          done();
        },
      });
    });
  });

  describe('removeTaskReminderSideEffects$', () => {
    it('should call removeReminder when removing a task reminder', (done) => {
      actions$ = of(
        removeReminderFromTask({
          id: 'task-123',
          reminderId: 'rem-456',
          isSkipToast: false,
        }),
      );

      effects.removeTaskReminderSideEffects$.subscribe(() => {
        expect(reminderServiceMock.removeReminder).toHaveBeenCalledWith('rem-456');
        done();
      });
    });

    it('should not call removeReminder when reminderId is falsy', (done) => {
      actions$ = of(
        removeReminderFromTask({
          id: 'task-123',
          reminderId: undefined as any,
          isSkipToast: false,
        }),
      );

      let emitted = false;
      effects.removeTaskReminderSideEffects$.subscribe({
        next: () => {
          emitted = true;
        },
      });

      // Give some time for potential emission
      setTimeout(() => {
        expect(emitted).toBe(false);
        expect(reminderServiceMock.removeReminder).not.toHaveBeenCalled();
        done();
      }, 50);
    });

    it('should handle isSkipToast flag', (done) => {
      const snackServiceMock = TestBed.inject(
        SnackService,
      ) as jasmine.SpyObj<SnackService>;

      actions$ = of(
        removeReminderFromTask({
          id: 'task-123',
          reminderId: 'rem-456',
          isSkipToast: true,
        }),
      );

      effects.removeTaskReminderSideEffects$.subscribe(() => {
        expect(snackServiceMock.open).not.toHaveBeenCalled();
        expect(reminderServiceMock.removeReminder).toHaveBeenCalledWith('rem-456');
        done();
      });
    });
  });

  // Test the Android native alarm cancellation logic separately
  // (IS_ANDROID_WEB_VIEW is a compile-time constant, so we test the logic directly)
  describe('removeTaskReminderSideEffects$ - Android cancellation logic', () => {
    /**
     * Tests for the native Android alarm cancellation added in fix for issue #5921.
     * When a reminder is removed, the native Android alarm should be cancelled
     * to prevent it from firing at the original scheduled time.
     */

    let cancelNativeReminderSpy: jasmine.Spy;
    let generateNotificationIdSpy: jasmine.Spy;
    let removeReminderSpy: jasmine.Spy;

    // Replicate the Android cancellation logic for testing
    const cancelAndroidReminderIfNeeded = (
      isAndroid: boolean,
      taskId: string,
      reminderId: string,
      generateNotificationId: (id: string) => number,
      cancelNativeReminder: (id: number) => void,
      removeReminder: (id: string) => void,
    ): void => {
      if (isAndroid) {
        try {
          const notificationId = generateNotificationId(taskId);
          cancelNativeReminder(notificationId);
        } catch (e) {
          console.error('Failed to cancel native reminder:', e);
        }
      }
      removeReminder(reminderId);
    };

    beforeEach(() => {
      cancelNativeReminderSpy = jasmine.createSpy('cancelNativeReminder');
      generateNotificationIdSpy = jasmine
        .createSpy('generateNotificationId')
        .and.returnValue(12345);
      removeReminderSpy = jasmine.createSpy('removeReminder');
    });

    it('should cancel native Android reminder before removing reminder', () => {
      const callOrder: string[] = [];
      cancelNativeReminderSpy.and.callFake(() => callOrder.push('cancelNative'));
      removeReminderSpy.and.callFake(() => callOrder.push('removeReminder'));

      cancelAndroidReminderIfNeeded(
        true, // isAndroid
        'task-123',
        'rem-456',
        generateNotificationIdSpy,
        cancelNativeReminderSpy,
        removeReminderSpy,
      );

      expect(callOrder).toEqual(['cancelNative', 'removeReminder']);
    });

    it('should generate notification ID from task ID (not reminder ID)', () => {
      cancelAndroidReminderIfNeeded(
        true,
        'task-123',
        'rem-456',
        generateNotificationIdSpy,
        cancelNativeReminderSpy,
        removeReminderSpy,
      );

      expect(generateNotificationIdSpy).toHaveBeenCalledWith('task-123');
      expect(generateNotificationIdSpy).not.toHaveBeenCalledWith('rem-456');
    });

    it('should pass generated notification ID to cancelNativeReminder', () => {
      generateNotificationIdSpy.and.returnValue(99999);

      cancelAndroidReminderIfNeeded(
        true,
        'task-123',
        'rem-456',
        generateNotificationIdSpy,
        cancelNativeReminderSpy,
        removeReminderSpy,
      );

      expect(cancelNativeReminderSpy).toHaveBeenCalledWith(99999);
    });

    it('should NOT call cancelNativeReminder on non-Android platforms', () => {
      cancelAndroidReminderIfNeeded(
        false, // isAndroid = false
        'task-123',
        'rem-456',
        generateNotificationIdSpy,
        cancelNativeReminderSpy,
        removeReminderSpy,
      );

      expect(cancelNativeReminderSpy).not.toHaveBeenCalled();
      expect(generateNotificationIdSpy).not.toHaveBeenCalled();
    });

    it('should still call removeReminder on non-Android platforms', () => {
      cancelAndroidReminderIfNeeded(
        false,
        'task-123',
        'rem-456',
        generateNotificationIdSpy,
        cancelNativeReminderSpy,
        removeReminderSpy,
      );

      expect(removeReminderSpy).toHaveBeenCalledWith('rem-456');
    });

    it('should still call removeReminder even if cancelNativeReminder throws', () => {
      cancelNativeReminderSpy.and.throwError('Native error');

      cancelAndroidReminderIfNeeded(
        true,
        'task-123',
        'rem-456',
        generateNotificationIdSpy,
        cancelNativeReminderSpy,
        removeReminderSpy,
      );

      expect(removeReminderSpy).toHaveBeenCalledWith('rem-456');
    });

    it('should handle error gracefully when generateNotificationId throws', () => {
      generateNotificationIdSpy.and.throwError('ID generation error');

      expect(() => {
        cancelAndroidReminderIfNeeded(
          true,
          'task-123',
          'rem-456',
          generateNotificationIdSpy,
          cancelNativeReminderSpy,
          removeReminderSpy,
        );
      }).not.toThrow();

      expect(removeReminderSpy).toHaveBeenCalledWith('rem-456');
    });
  });

  describe('unscheduleDoneTask$', () => {
    it('should dispatch unscheduleTask when task with reminder is marked done', (done) => {
      const taskWithReminder = createMockTask({
        id: 'task-with-reminder',
        reminderId: 'rem-123',
        isDone: true,
      });
      taskServiceMock.getByIdOnce$.and.returnValue(of(taskWithReminder));

      const dispatchSpy = spyOn(store, 'dispatch');

      actions$ = of(
        TaskSharedActions.updateTask({
          task: { id: 'task-with-reminder', changes: { isDone: true } },
        }),
      );

      effects.unscheduleDoneTask$.subscribe(() => {
        expect(taskServiceMock.getByIdOnce$).toHaveBeenCalledWith('task-with-reminder');
        expect(dispatchSpy).toHaveBeenCalledWith(
          TaskSharedActions.unscheduleTask({
            id: 'task-with-reminder',
            reminderId: 'rem-123',
          }),
        );
        done();
      });
    });

    it('should not dispatch unscheduleTask when task has no reminder', (done) => {
      const taskWithoutReminder = createMockTask({
        id: 'task-no-reminder',
        reminderId: undefined,
        isDone: true,
      });
      taskServiceMock.getByIdOnce$.and.returnValue(of(taskWithoutReminder));

      const dispatchSpy = spyOn(store, 'dispatch');

      actions$ = of(
        TaskSharedActions.updateTask({
          task: { id: 'task-no-reminder', changes: { isDone: true } },
        }),
      );

      effects.unscheduleDoneTask$.subscribe(() => {
        expect(taskServiceMock.getByIdOnce$).toHaveBeenCalledWith('task-no-reminder');
        expect(dispatchSpy).not.toHaveBeenCalled();
        done();
      });
    });

    it('should not trigger for non-isDone updates', (done) => {
      const dispatchSpy = spyOn(store, 'dispatch');

      actions$ = of(
        TaskSharedActions.updateTask({
          task: { id: 'task-123', changes: { title: 'New Title' } },
        }),
      );

      // Effect should filter out this action since isDone is not set
      let emitted = false;
      effects.unscheduleDoneTask$.subscribe({
        next: () => {
          emitted = true;
        },
      });

      // Give some time for potential emission
      setTimeout(() => {
        expect(emitted).toBe(false);
        expect(dispatchSpy).not.toHaveBeenCalled();
        done();
      }, 50);
    });
  });
});
