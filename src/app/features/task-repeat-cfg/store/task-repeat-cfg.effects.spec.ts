import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Observable, of } from 'rxjs';
import { Action } from '@ngrx/store';
import { TaskRepeatCfgEffects } from './task-repeat-cfg.effects';
import { TaskService } from '../../tasks/task.service';
import { TaskRepeatCfgService } from '../task-repeat-cfg.service';
import { MatDialog } from '@angular/material/dialog';
import { TaskArchiveService } from '../../archive/task-archive.service';
import { addTaskRepeatCfgToTask, updateTaskRepeatCfg } from './task-repeat-cfg.actions';
import {
  DEFAULT_TASK,
  Task,
  TaskWithSubTasks,
  TaskReminderOptionId,
} from '../../tasks/task.model';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfgCopy } from '../task-repeat-cfg.model';
import { addSubTask } from '../../tasks/store/task.actions';
import { TestScheduler } from 'rxjs/testing';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';
import { remindOptionToMilliseconds } from '../../tasks/util/remind-option-to-milliseconds';
import { isToday } from '../../../util/is-today.util';

describe('TaskRepeatCfgEffects - Repeatable Subtasks', () => {
  let actions$: Observable<Action>;
  let effects: TaskRepeatCfgEffects;
  let taskService: jasmine.SpyObj<TaskService>;
  let taskRepeatCfgService: jasmine.SpyObj<TaskRepeatCfgService>;
  let taskArchiveService: jasmine.SpyObj<TaskArchiveService>;
  let testScheduler: TestScheduler;

  const mockTask: Task = {
    ...DEFAULT_TASK,
    id: 'parent-task-id',
    title: 'Parent Task',
    projectId: 'test-project',
    repeatCfgId: 'repeat-cfg-id',
    subTaskIds: ['sub1', 'sub2'],
    created: Date.now(),
  };

  const mockSubTask1: Task = {
    ...DEFAULT_TASK,
    id: 'sub1',
    title: 'SubTask 1',
    projectId: 'test-project',
    notes: 'Notes 1',
    timeEstimate: 3600000,
    parentId: 'parent-task-id',
  };

  const mockSubTask2: Task = {
    ...DEFAULT_TASK,
    id: 'sub2',
    title: 'SubTask 2',
    projectId: 'test-project',
    notes: 'Notes 2',
    timeEstimate: 7200000,
    parentId: 'parent-task-id',
  };

  const mockTaskWithSubTasks: TaskWithSubTasks = {
    ...mockTask,
    subTasks: [mockSubTask1, mockSubTask2],
  };

  const mockRepeatCfg: TaskRepeatCfgCopy = {
    ...DEFAULT_TASK_REPEAT_CFG,
    id: 'repeat-cfg-id',
    lastTaskCreationDay: getDbDateStr(),
    shouldInheritSubtasks: true,
    disableAutoUpdateSubtasks: false,
    subTaskTemplates: [],
  };

  beforeEach(() => {
    const taskServiceSpy = jasmine.createSpyObj('TaskService', [
      'getByIdWithSubTaskData$',
      'getByIdOnce$',
      'getTasksByRepeatCfgId$',
      'getByIdsLive$',
      'getArchiveTasksForRepeatCfgId',
      'update',
    ]);

    const taskRepeatCfgServiceSpy = jasmine.createSpyObj('TaskRepeatCfgService', [
      'updateTaskRepeatCfg',
      'getTaskRepeatCfgById$',
    ]);

    const matDialogSpy = jasmine.createSpyObj('MatDialog', ['open']);
    const taskArchiveServiceSpy = jasmine.createSpyObj('TaskArchiveService', ['load']);

    TestBed.configureTestingModule({
      providers: [
        TaskRepeatCfgEffects,
        provideMockActions(() => actions$),
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: TaskRepeatCfgService, useValue: taskRepeatCfgServiceSpy },
        { provide: MatDialog, useValue: matDialogSpy },
        { provide: TaskArchiveService, useValue: taskArchiveServiceSpy },
      ],
    });

    effects = TestBed.inject(TaskRepeatCfgEffects);
    taskService = TestBed.inject(TaskService) as jasmine.SpyObj<TaskService>;
    taskRepeatCfgService = TestBed.inject(
      TaskRepeatCfgService,
    ) as jasmine.SpyObj<TaskRepeatCfgService>;
    taskArchiveService = TestBed.inject(
      TaskArchiveService,
    ) as jasmine.SpyObj<TaskArchiveService>;

    testScheduler = new TestScheduler((actual, expected) => {
      expect(actual).toEqual(expected);
    });
  });

  describe('Helper Methods', () => {
    it('should convert tasks to subtask templates', () => {
      const subs = [mockSubTask1, mockSubTask2];
      const templates = (effects as any)._toSubTaskTemplates(subs);

      expect(templates).toEqual([
        {
          title: 'SubTask 1',
          notes: 'Notes 1',
          timeEstimate: 3600000,
        },
        {
          title: 'SubTask 2',
          notes: 'Notes 2',
          timeEstimate: 7200000,
        },
      ]);
    });

    it('should correctly compare template arrays for equality', () => {
      const templates1 = [
        { title: 'Task 1', notes: 'Notes 1', timeEstimate: 3600000 },
        { title: 'Task 2', notes: '', timeEstimate: 0 },
      ];

      const templates2 = [
        { title: 'Task 1', notes: 'Notes 1', timeEstimate: 3600000 },
        { title: 'Task 2', notes: '', timeEstimate: 0 },
      ];

      const templates3 = [
        { title: 'Task 1', notes: 'Notes 1', timeEstimate: 3600000 },
        { title: 'Task 2 Modified', notes: '', timeEstimate: 0 },
      ];

      expect((effects as any)._templatesEqual(templates1, templates2)).toBe(true);
      expect((effects as any)._templatesEqual(templates1, templates3)).toBe(false);
      expect((effects as any)._templatesEqual(undefined, [])).toBe(true);
      expect((effects as any)._templatesEqual([], templates1)).toBe(false);
    });

    it('should handle missing notes and timeEstimate in template comparison', () => {
      const templates1 = [{ title: 'Task 1' }];
      const templates2 = [{ title: 'Task 1', notes: '', timeEstimate: 0 }];

      expect((effects as any)._templatesEqual(templates1, templates2)).toBe(true);
    });
  });

  describe('updateTaskAfterMakingItRepeatable$', () => {
    it('should capture subtasks as templates and set lastTaskCreationDay when adding repeat config', () => {
      const action = addTaskRepeatCfgToTask({
        taskRepeatCfg: mockRepeatCfg,
        taskId: 'parent-task-id',
      });

      actions$ = of(action);
      taskService.getByIdWithSubTaskData$.and.returnValue(of(mockTaskWithSubTasks));

      // Since this is a side effect, we verify the service methods are called
      spyOn(effects as any, '_updateRegularTaskInstance');

      effects.updateTaskAfterMakingItRepeatable$.subscribe().unsubscribe();

      // Should update config with subtask templates AND lastTaskCreationDay (#5594)
      expect(taskRepeatCfgService.updateTaskRepeatCfg).toHaveBeenCalledWith(
        'repeat-cfg-id',
        jasmine.objectContaining({
          subTaskTemplates: [
            { title: 'SubTask 1', notes: 'Notes 1', timeEstimate: 3600000 },
            { title: 'SubTask 2', notes: 'Notes 2', timeEstimate: 7200000 },
          ],
          lastTaskCreationDay: jasmine.any(String),
          lastTaskCreation: jasmine.any(Number),
        }),
      );
      expect((effects as any)._updateRegularTaskInstance).toHaveBeenCalled();
    });

    it('should handle task with no subtasks and still set lastTaskCreationDay', () => {
      const taskWithoutSubs: TaskWithSubTasks = {
        ...mockTask,
        subTasks: [],
      };

      const action = addTaskRepeatCfgToTask({
        taskRepeatCfg: mockRepeatCfg,
        taskId: 'parent-task-id',
      });

      actions$ = of(action);
      taskService.getByIdWithSubTaskData$.and.returnValue(of(taskWithoutSubs));

      spyOn(effects as any, '_updateRegularTaskInstance');

      effects.updateTaskAfterMakingItRepeatable$.subscribe().unsubscribe();

      // Should update config with empty subtasks AND lastTaskCreationDay (#5594)
      expect(taskRepeatCfgService.updateTaskRepeatCfg).toHaveBeenCalledWith(
        'repeat-cfg-id',
        jasmine.objectContaining({
          subTaskTemplates: [],
          lastTaskCreationDay: jasmine.any(String),
          lastTaskCreation: jasmine.any(Number),
        }),
      );
    });

    it('should update task dueDay when first occurrence differs from current (#5594)', () => {
      // Scenario: Task is created today, but repeat config only matches future days
      // Use a day that is 3 days from today (guaranteed to not be today)
      const today = new Date();
      const todayStr = getDbDateStr(today);
      const todayDayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat

      // Pick a weekday that is 3 days from now (guaranteed to not be today)
      const targetDayOfWeek = (todayDayOfWeek + 3) % 7;
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + 3);
      const targetDateStr = getDbDateStr(targetDate);

      const taskCreatedToday: TaskWithSubTasks = {
        ...mockTask,
        subTasks: [],
        dueDay: todayStr,
        created: today.getTime(),
      };

      // Create weekday booleans with only the target day set to true
      const weeklyRepeatCfg: TaskRepeatCfgCopy = {
        ...mockRepeatCfg,
        repeatCycle: 'WEEKLY',
        repeatEvery: 1,
        startDate: todayStr,
        sunday: targetDayOfWeek === 0,
        monday: targetDayOfWeek === 1,
        tuesday: targetDayOfWeek === 2,
        wednesday: targetDayOfWeek === 3,
        thursday: targetDayOfWeek === 4,
        friday: targetDayOfWeek === 5,
        saturday: targetDayOfWeek === 6,
      };

      const action = addTaskRepeatCfgToTask({
        taskRepeatCfg: weeklyRepeatCfg,
        taskId: 'parent-task-id',
      });

      actions$ = of(action);
      taskService.getByIdWithSubTaskData$.and.returnValue(of(taskCreatedToday));

      spyOn(effects as any, '_updateRegularTaskInstance');

      effects.updateTaskAfterMakingItRepeatable$.subscribe().unsubscribe();

      // Verify that update was called with the target day (3 days from today)
      expect(taskService.update).toHaveBeenCalledWith('parent-task-id', {
        dueDay: targetDateStr,
      });
    });

    it('should NOT update task dueDay when first occurrence matches current', () => {
      // Scenario: Task dueDay already matches first occurrence
      // Use daily repeat starting today - first occurrence is today
      const today = new Date();
      const todayStr = getDbDateStr(today);

      const taskCreatedToday: TaskWithSubTasks = {
        ...mockTask,
        subTasks: [],
        dueDay: todayStr, // Matches first occurrence
        created: today.getTime(),
      };

      const dailyRepeatCfg: TaskRepeatCfgCopy = {
        ...mockRepeatCfg,
        repeatCycle: 'DAILY',
        repeatEvery: 1,
        startDate: todayStr,
      };

      const action = addTaskRepeatCfgToTask({
        taskRepeatCfg: dailyRepeatCfg,
        taskId: 'parent-task-id',
      });

      actions$ = of(action);
      taskService.getByIdWithSubTaskData$.and.returnValue(of(taskCreatedToday));

      spyOn(effects as any, '_updateRegularTaskInstance');

      effects.updateTaskAfterMakingItRepeatable$.subscribe().unsubscribe();

      // Verify that update was NOT called (same date)
      expect(taskService.update).not.toHaveBeenCalled();
    });

    it('should update dueDay for daily repeat with future start date', () => {
      // Scenario: Task created today, but start date is 7 days in the future
      const today = new Date();
      const todayStr = getDbDateStr(today);
      const futureDate = new Date(today);
      futureDate.setDate(today.getDate() + 7);
      const futureStartStr = getDbDateStr(futureDate);

      const taskCreatedToday: TaskWithSubTasks = {
        ...mockTask,
        subTasks: [],
        dueDay: todayStr,
        created: today.getTime(),
      };

      const dailyRepeatCfg: TaskRepeatCfgCopy = {
        ...mockRepeatCfg,
        repeatCycle: 'DAILY',
        repeatEvery: 1,
        startDate: futureStartStr,
      };

      const action = addTaskRepeatCfgToTask({
        taskRepeatCfg: dailyRepeatCfg,
        taskId: 'parent-task-id',
      });

      actions$ = of(action);
      taskService.getByIdWithSubTaskData$.and.returnValue(of(taskCreatedToday));

      spyOn(effects as any, '_updateRegularTaskInstance');

      effects.updateTaskAfterMakingItRepeatable$.subscribe().unsubscribe();

      // Verify that update was called with future start date
      expect(taskService.update).toHaveBeenCalledWith('parent-task-id', {
        dueDay: futureStartStr,
      });
    });

    it('should update dueDay for monthly repeat when today is after repeat day', () => {
      // Scenario: Monthly repeat on the 1st, but we're past the 1st
      // First occurrence should be next month's 1st
      const today = new Date();
      const todayStr = getDbDateStr(today);

      // Find next 1st of month
      const nextFirst = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      const nextFirstStr = getDbDateStr(nextFirst);

      // Start date is the 1st of current month (already passed)
      const startDate = new Date(today.getFullYear(), today.getMonth(), 1);
      const startDateStr = getDbDateStr(startDate);

      const taskCreatedToday: TaskWithSubTasks = {
        ...mockTask,
        subTasks: [],
        dueDay: todayStr,
        created: today.getTime(),
      };

      const monthlyRepeatCfg: TaskRepeatCfgCopy = {
        ...mockRepeatCfg,
        repeatCycle: 'MONTHLY',
        repeatEvery: 1,
        startDate: startDateStr, // 1st of month
      };

      const action = addTaskRepeatCfgToTask({
        taskRepeatCfg: monthlyRepeatCfg,
        taskId: 'parent-task-id',
      });

      actions$ = of(action);
      taskService.getByIdWithSubTaskData$.and.returnValue(of(taskCreatedToday));

      spyOn(effects as any, '_updateRegularTaskInstance');

      effects.updateTaskAfterMakingItRepeatable$.subscribe().unsubscribe();

      // Should update if today is not the 1st
      if (today.getDate() !== 1) {
        expect(taskService.update).toHaveBeenCalledWith('parent-task-id', {
          dueDay: nextFirstStr,
        });
      } else {
        // If today IS the 1st, no update needed
        expect(taskService.update).not.toHaveBeenCalled();
      }
    });

    it('should use task created date as fallback when dueDay is missing', () => {
      // Scenario: Task has no dueDay, should use created date for comparison
      // Use a day that is 3 days from today (guaranteed to not be today)
      const today = new Date();
      const todayStr = getDbDateStr(today);
      const todayDayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat

      // Pick a weekday that is 3 days from now (guaranteed to not be today)
      const targetDayOfWeek = (todayDayOfWeek + 3) % 7;
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + 3);
      const targetDateStr = getDbDateStr(targetDate);

      const taskWithoutDueDay: TaskWithSubTasks = {
        ...mockTask,
        subTasks: [],
        dueDay: undefined, // No dueDay
        created: today.getTime(),
      };

      // Create weekday booleans with only the target day set to true
      const weeklyRepeatCfg: TaskRepeatCfgCopy = {
        ...mockRepeatCfg,
        repeatCycle: 'WEEKLY',
        repeatEvery: 1,
        startDate: todayStr,
        sunday: targetDayOfWeek === 0,
        monday: targetDayOfWeek === 1,
        tuesday: targetDayOfWeek === 2,
        wednesday: targetDayOfWeek === 3,
        thursday: targetDayOfWeek === 4,
        friday: targetDayOfWeek === 5,
        saturday: targetDayOfWeek === 6,
      };

      const action = addTaskRepeatCfgToTask({
        taskRepeatCfg: weeklyRepeatCfg,
        taskId: 'parent-task-id',
      });

      actions$ = of(action);
      taskService.getByIdWithSubTaskData$.and.returnValue(of(taskWithoutDueDay));

      spyOn(effects as any, '_updateRegularTaskInstance');

      effects.updateTaskAfterMakingItRepeatable$.subscribe().unsubscribe();

      // Verify that update was called with the target day (3 days from today)
      expect(taskService.update).toHaveBeenCalledWith('parent-task-id', {
        dueDay: targetDateStr,
      });
    });

    it('should update dueDay for Mon/Wed/Fri pattern when today is not a match (#5594 exact scenario)', () => {
      // This test replicates the exact bug scenario from issue #5594:
      // User creates Mon/Wed/Fri repeat, but dueDay incorrectly stays as today
      const today = new Date();
      const todayStr = getDbDateStr(today);
      const todayDayOfWeek = today.getDay();

      // Mon=1, Wed=3, Fri=5
      const isMonWedFri =
        todayDayOfWeek === 1 || todayDayOfWeek === 3 || todayDayOfWeek === 5;

      // Calculate expected first occurrence
      let expectedDate: Date;
      if (isMonWedFri) {
        expectedDate = new Date(today);
      } else {
        expectedDate = new Date(today);
        const daysToAdd = [1, 3, 5]
          .map((d) => (d - todayDayOfWeek + 7) % 7)
          .filter((d) => d > 0)
          .sort((a, b) => a - b)[0];
        expectedDate.setDate(expectedDate.getDate() + daysToAdd);
      }
      const expectedDateStr = getDbDateStr(expectedDate);

      const taskCreatedToday: TaskWithSubTasks = {
        ...mockTask,
        subTasks: [],
        dueDay: todayStr, // Task starts with today's date
        created: today.getTime(),
      };

      const monWedFriRepeatCfg: TaskRepeatCfgCopy = {
        ...mockRepeatCfg,
        repeatCycle: 'WEEKLY',
        repeatEvery: 1,
        startDate: todayStr,
        monday: true,
        tuesday: false,
        wednesday: true,
        thursday: false,
        friday: true,
        saturday: false,
        sunday: false,
      };

      const action = addTaskRepeatCfgToTask({
        taskRepeatCfg: monWedFriRepeatCfg,
        taskId: 'parent-task-id',
      });

      actions$ = of(action);
      taskService.getByIdWithSubTaskData$.and.returnValue(of(taskCreatedToday));

      spyOn(effects as any, '_updateRegularTaskInstance');

      effects.updateTaskAfterMakingItRepeatable$.subscribe().unsubscribe();

      // If today is Mon/Wed/Fri, no update needed (dueDay already correct)
      // If today is Tue/Thu/Sat/Sun, dueDay should be updated to next Mon/Wed/Fri
      if (isMonWedFri) {
        expect(taskService.update).not.toHaveBeenCalled();
      } else {
        expect(taskService.update).toHaveBeenCalledWith('parent-task-id', {
          dueDay: expectedDateStr,
        });
      }
    });
  });

  describe('updateStartDateOnComplete$', () => {
    it('should update startDate and lastTaskCreationDay when completing a repeat-on-complete task', () => {
      testScheduler.run(({ hot, expectObservable }) => {
        const action = TaskSharedActions.updateTask({
          task: { id: 'parent-task-id', changes: { isDone: true } },
        });

        actions$ = hot('-a', { a: action });

        // full task with repeatCfgId
        taskService.getByIdOnce$.and.returnValue(of(mockTask));

        // repeat cfg with repeatOnComplete true
        taskRepeatCfgService.getTaskRepeatCfgById$.and.returnValue(
          of({ ...mockRepeatCfg, repeatFromCompletionDate: true }),
        );

        const today = getDbDateStr();
        const expectedAction = updateTaskRepeatCfg({
          taskRepeatCfg: {
            id: 'repeat-cfg-id',
            changes: { startDate: today, lastTaskCreationDay: today },
          },
        });

        expectObservable(effects.updateStartDateOnComplete$).toBe('-a', {
          a: expectedAction,
        });
      });
    });

    it('should not emit when task has no repeatCfgId', () => {
      testScheduler.run(({ hot, expectObservable }) => {
        const action = TaskSharedActions.updateTask({
          task: { id: 'no-repeat-task-id', changes: { isDone: true } },
        });

        const taskWithoutRepeat: Task = {
          ...DEFAULT_TASK,
          id: 'no-repeat-task-id',
          title: 'No Repeat',
        } as Task;

        actions$ = hot('-a', { a: action });

        taskService.getByIdOnce$.and.returnValue(of(taskWithoutRepeat));

        expectObservable(effects.updateStartDateOnComplete$).toBe('--');
      });
    });

    it('should not emit when repeatOnComplete is false', () => {
      testScheduler.run(({ hot, expectObservable }) => {
        const action = TaskSharedActions.updateTask({
          task: { id: 'parent-task-id', changes: { isDone: true } },
        });

        actions$ = hot('-a', { a: action });

        taskService.getByIdOnce$.and.returnValue(of(mockTask));
        taskRepeatCfgService.getTaskRepeatCfgById$.and.returnValue(
          of({ ...mockRepeatCfg, repeatFromCompletionDate: false }),
        );

        expectObservable(effects.updateStartDateOnComplete$).toBe('--');
      });
    });

    it('should not emit when completing a non-latest instance', () => {
      testScheduler.run(({ hot, expectObservable }) => {
        const action = TaskSharedActions.updateTask({
          task: { id: 'parent-task-id', changes: { isDone: true } },
        });

        const oldTask: Task = {
          ...mockTask,
          created: new Date(2020, 0, 1).getTime(),
          dueDay: '2020-01-01',
        };

        actions$ = hot('-a', { a: action });

        taskService.getByIdOnce$.and.returnValue(of(oldTask));
        taskRepeatCfgService.getTaskRepeatCfgById$.and.returnValue(
          of({
            ...mockRepeatCfg,
            repeatFromCompletionDate: true,
            lastTaskCreationDay: '2020-01-02',
          }),
        );

        expectObservable(effects.updateStartDateOnComplete$).toBe('--');
      });
    });
  });

  describe('autoSyncSubtaskTemplatesFromNewest$', () => {
    it('should sync templates when subtask is added to repeatable task', () => {
      testScheduler.run(({ hot, expectObservable }) => {
        const action = addSubTask({
          task: mockSubTask1,
          parentId: 'parent-task-id',
        });

        actions$ = hot('-a', { a: action });

        taskService.getByIdOnce$.and.returnValue(of(mockTask));
        taskRepeatCfgService.getTaskRepeatCfgById$.and.returnValue(
          of({
            ...mockRepeatCfg,
            shouldInheritSubtasks: true,
            disableAutoUpdateSubtasks: false,
          }),
        );
        taskService.getTasksByRepeatCfgId$.and.returnValue(of([mockTask]));
        taskService.getByIdsLive$.and.returnValue(of([mockSubTask1, mockSubTask2]));

        const expectedAction = updateTaskRepeatCfg({
          taskRepeatCfg: {
            id: 'repeat-cfg-id',
            changes: {
              subTaskTemplates: [
                { title: 'SubTask 1', notes: 'Notes 1', timeEstimate: 3600000 },
                { title: 'SubTask 2', notes: 'Notes 2', timeEstimate: 7200000 },
              ],
            },
          },
          isAskToUpdateAllTaskInstances: false,
        });

        expectObservable(effects.autoSyncSubtaskTemplatesFromNewest$).toBe('-a', {
          a: expectedAction,
        });
      });
    });

    it('should not sync when inherit is disabled', () => {
      testScheduler.run(({ hot, expectObservable }) => {
        const action = addSubTask({
          task: mockSubTask1,
          parentId: 'parent-task-id',
        });

        actions$ = hot('-a', { a: action });

        taskService.getByIdOnce$.and.returnValue(of(mockTask));
        taskRepeatCfgService.getTaskRepeatCfgById$.and.returnValue(
          of({ ...mockRepeatCfg, shouldInheritSubtasks: false }),
        );

        expectObservable(effects.autoSyncSubtaskTemplatesFromNewest$).toBe('--');
      });
    });

    it('should not sync when auto-update is disabled', () => {
      testScheduler.run(({ hot, expectObservable }) => {
        const action = addSubTask({
          task: mockSubTask1,
          parentId: 'parent-task-id',
        });

        actions$ = hot('-a', { a: action });

        taskService.getByIdOnce$.and.returnValue(of(mockTask));
        taskRepeatCfgService.getTaskRepeatCfgById$.and.returnValue(
          of({
            ...mockRepeatCfg,
            shouldInheritSubtasks: true,
            disableAutoUpdateSubtasks: true,
          }),
        );

        expectObservable(effects.autoSyncSubtaskTemplatesFromNewest$).toBe('--');
      });
    });

    it('should not sync when templates are already equal', () => {
      testScheduler.run(({ hot, expectObservable }) => {
        const action = addSubTask({
          task: mockSubTask1,
          parentId: 'parent-task-id',
        });

        actions$ = hot('-a', { a: action });

        const existingTemplates = [
          { title: 'SubTask 1', notes: 'Notes 1', timeEstimate: 3600000 },
          { title: 'SubTask 2', notes: 'Notes 2', timeEstimate: 7200000 },
        ];

        taskService.getByIdOnce$.and.returnValue(of(mockTask));
        taskRepeatCfgService.getTaskRepeatCfgById$.and.returnValue(
          of({
            ...mockRepeatCfg,
            shouldInheritSubtasks: true,
            subTaskTemplates: existingTemplates,
          }),
        );
        taskService.getTasksByRepeatCfgId$.and.returnValue(of([mockTask]));
        taskService.getByIdsLive$.and.returnValue(of([mockSubTask1, mockSubTask2]));

        expectObservable(effects.autoSyncSubtaskTemplatesFromNewest$).toBe('--');
      });
    });
  });

  describe('enableAutoUpdateOrInheritSnapshot$', () => {
    it('should snapshot subtasks when enabling inherit', () => {
      testScheduler.run(({ hot, expectObservable }) => {
        const action = updateTaskRepeatCfg({
          taskRepeatCfg: {
            id: 'repeat-cfg-id',
            changes: { shouldInheritSubtasks: true },
          },
          isAskToUpdateAllTaskInstances: false,
        });

        actions$ = hot('-a', { a: action });

        taskRepeatCfgService.getTaskRepeatCfgById$.and.returnValue(of(mockRepeatCfg));
        taskService.getTasksByRepeatCfgId$.and.returnValue(of([mockTask]));
        taskService.getByIdsLive$.and.returnValue(of([mockSubTask1, mockSubTask2]));

        const expectedAction = updateTaskRepeatCfg({
          taskRepeatCfg: {
            id: 'repeat-cfg-id',
            changes: {
              subTaskTemplates: [
                { title: 'SubTask 1', notes: 'Notes 1', timeEstimate: 3600000 },
                { title: 'SubTask 2', notes: 'Notes 2', timeEstimate: 7200000 },
              ],
            },
          },
          isAskToUpdateAllTaskInstances: false,
        });

        expectObservable(effects.enableAutoUpdateOrInheritSnapshot$).toBe('-a', {
          a: expectedAction,
        });
      });
    });

    it('should fallback to archive when no live instances exist', (done) => {
      const action = updateTaskRepeatCfg({
        taskRepeatCfg: {
          id: 'repeat-cfg-id',
          changes: { shouldInheritSubtasks: true },
        },
        isAskToUpdateAllTaskInstances: false,
      });

      actions$ = of(action);

      const archiveTask = { ...mockTask, created: Date.now() - 86400000 }; // Yesterday
      const archiveState = {
        ids: ['sub1', 'sub2'],
        entities: {
          sub1: mockSubTask1,
          sub2: mockSubTask2,
        },
      };

      taskRepeatCfgService.getTaskRepeatCfgById$.and.returnValue(of(mockRepeatCfg));
      taskService.getTasksByRepeatCfgId$.and.returnValue(of([])); // No live instances
      taskService.getArchiveTasksForRepeatCfgId.and.returnValue(
        Promise.resolve([archiveTask]),
      );
      taskArchiveService.load.and.returnValue(Promise.resolve(archiveState));

      effects.enableAutoUpdateOrInheritSnapshot$.subscribe((result) => {
        expect(result.taskRepeatCfg.changes).toEqual({
          subTaskTemplates: [
            { title: 'SubTask 1', notes: 'Notes 1', timeEstimate: 3600000 },
            { title: 'SubTask 2', notes: 'Notes 2', timeEstimate: 7200000 },
          ],
        });
        done();
      });
    });

    it('should not snapshot when inherit is not being enabled', () => {
      testScheduler.run(({ hot, expectObservable }) => {
        const action = updateTaskRepeatCfg({
          taskRepeatCfg: {
            id: 'repeat-cfg-id',
            changes: { title: 'New Title' }, // Not enabling inherit
          },
          isAskToUpdateAllTaskInstances: false,
        });

        actions$ = hot('-a', { a: action });

        expectObservable(effects.enableAutoUpdateOrInheritSnapshot$).toBe('--');
      });
    });
  });

  describe('addRepeatCfgToTaskUpdateTask$', () => {
    it('should schedule task for today when DAILY repeat pattern matches (issue #5594)', () => {
      testScheduler.run(({ hot, expectObservable }) => {
        const todayStr = getDbDateStr();
        const startTimeStr = '10:00';
        const action = addTaskRepeatCfgToTask({
          taskRepeatCfg: {
            ...mockRepeatCfg,
            startDate: todayStr,
            repeatCycle: 'DAILY',
            repeatEvery: 1,
          },
          taskId: 'parent-task-id',
          startTime: startTimeStr,
          remindAt: TaskReminderOptionId.AtStart,
        });

        actions$ = hot('-a', { a: action });
        taskService.getByIdOnce$.and.returnValue(of(mockTask));

        // For DAILY repeat, getFirstRepeatOccurrence returns today
        const expectedDateTime = getDateTimeFromClockString(
          startTimeStr,
          dateStrToUtcDate(todayStr).getTime(),
        );

        const expectedAction = TaskSharedActions.scheduleTaskWithTime({
          task: mockTask,
          dueWithTime: expectedDateTime,
          remindAt: remindOptionToMilliseconds(
            expectedDateTime,
            TaskReminderOptionId.AtStart,
          ),
          isMoveToBacklog: false,
          isSkipAutoRemoveFromToday: isToday(expectedDateTime),
        });

        expectObservable(effects.addRepeatCfgToTaskUpdateTask$).toBe('-a', {
          a: expectedAction,
        });
      });
    });

    it('should schedule task for correct weekday when WEEKLY pattern is used (issue #5594)', () => {
      testScheduler.run(({ hot, expectObservable }) => {
        const todayStr = getDbDateStr();
        const today = new Date();
        const todayDayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
        const startTimeStr = '10:00';

        // Create a repeat config that repeats on today's weekday
        const weekdayKeys = [
          'sunday',
          'monday',
          'tuesday',
          'wednesday',
          'thursday',
          'friday',
          'saturday',
        ] as const;
        const todayWeekdayKey = weekdayKeys[todayDayOfWeek];

        const action = addTaskRepeatCfgToTask({
          taskRepeatCfg: {
            ...mockRepeatCfg,
            startDate: todayStr,
            repeatCycle: 'WEEKLY',
            repeatEvery: 1,
            monday: todayWeekdayKey === 'monday',
            tuesday: todayWeekdayKey === 'tuesday',
            wednesday: todayWeekdayKey === 'wednesday',
            thursday: todayWeekdayKey === 'thursday',
            friday: todayWeekdayKey === 'friday',
            saturday: todayWeekdayKey === 'saturday',
            sunday: todayWeekdayKey === 'sunday',
          },
          taskId: 'parent-task-id',
          startTime: startTimeStr,
          remindAt: TaskReminderOptionId.AtStart,
        });

        actions$ = hot('-a', { a: action });
        taskService.getByIdOnce$.and.returnValue(of(mockTask));

        // For WEEKLY repeat on today's weekday, should return today
        const expectedDateTime = getDateTimeFromClockString(
          startTimeStr,
          dateStrToUtcDate(todayStr).getTime(),
        );

        const expectedAction = TaskSharedActions.scheduleTaskWithTime({
          task: mockTask,
          dueWithTime: expectedDateTime,
          remindAt: remindOptionToMilliseconds(
            expectedDateTime,
            TaskReminderOptionId.AtStart,
          ),
          isMoveToBacklog: false,
          isSkipAutoRemoveFromToday: isToday(expectedDateTime),
        });

        expectObservable(effects.addRepeatCfgToTaskUpdateTask$).toBe('-a', {
          a: expectedAction,
        });
      });
    });

    it('should calculate next occurrence when startDate is undefined (issue #5594)', () => {
      testScheduler.run(({ hot, expectObservable }) => {
        const startTimeStr = '10:00';
        const today = new Date();
        const todayDayOfWeek = today.getDay();

        // Create a repeat config without startDate - getFirstRepeatOccurrence
        // will find the next matching weekday from today
        // Set the repeat to today's weekday so we get today's date
        const weekdayKeys = [
          'sunday',
          'monday',
          'tuesday',
          'wednesday',
          'thursday',
          'friday',
          'saturday',
        ] as const;
        const todayWeekdayKey = weekdayKeys[todayDayOfWeek];

        const action = addTaskRepeatCfgToTask({
          taskRepeatCfg: {
            ...mockRepeatCfg,
            startDate: undefined,
            repeatCycle: 'WEEKLY',
            repeatEvery: 1,
            monday: todayWeekdayKey === 'monday',
            tuesday: todayWeekdayKey === 'tuesday',
            wednesday: todayWeekdayKey === 'wednesday',
            thursday: todayWeekdayKey === 'thursday',
            friday: todayWeekdayKey === 'friday',
            saturday: todayWeekdayKey === 'saturday',
            sunday: todayWeekdayKey === 'sunday',
          },
          taskId: 'parent-task-id',
          startTime: startTimeStr,
          remindAt: TaskReminderOptionId.AtStart,
        });

        actions$ = hot('-a', { a: action });
        taskService.getByIdOnce$.and.returnValue(of(mockTask));

        // When startDate is undefined, getFirstRepeatOccurrence still calculates
        // the next valid occurrence. For WEEKLY on today's day, it returns today.
        const todayStr = getDbDateStr();
        const expectedDateTime = getDateTimeFromClockString(
          startTimeStr,
          dateStrToUtcDate(todayStr).getTime(),
        );

        const expectedAction = TaskSharedActions.scheduleTaskWithTime({
          task: mockTask,
          dueWithTime: expectedDateTime,
          remindAt: remindOptionToMilliseconds(
            expectedDateTime,
            TaskReminderOptionId.AtStart,
          ),
          isMoveToBacklog: false,
          isSkipAutoRemoveFromToday: isToday(expectedDateTime),
        });

        expectObservable(effects.addRepeatCfgToTaskUpdateTask$).toBe('-a', {
          a: expectedAction,
        });
      });
    });

    it('should calculate today for DAILY when startDate is undefined', () => {
      testScheduler.run(({ hot, expectObservable }) => {
        const startTimeStr = '10:00';

        const action = addTaskRepeatCfgToTask({
          taskRepeatCfg: {
            ...mockRepeatCfg,
            startDate: undefined,
            repeatCycle: 'DAILY',
            repeatEvery: 1,
          },
          taskId: 'parent-task-id',
          startTime: startTimeStr,
          remindAt: TaskReminderOptionId.AtStart,
        });

        actions$ = hot('-a', { a: action });
        taskService.getByIdOnce$.and.returnValue(of(mockTask));

        // For DAILY with undefined startDate, getFirstRepeatOccurrence returns today
        const todayStr = getDbDateStr();
        const expectedDateTime = getDateTimeFromClockString(
          startTimeStr,
          dateStrToUtcDate(todayStr).getTime(),
        );

        const expectedAction = TaskSharedActions.scheduleTaskWithTime({
          task: mockTask,
          dueWithTime: expectedDateTime,
          remindAt: remindOptionToMilliseconds(
            expectedDateTime,
            TaskReminderOptionId.AtStart,
          ),
          isMoveToBacklog: false,
          isSkipAutoRemoveFromToday: isToday(expectedDateTime),
        });

        expectObservable(effects.addRepeatCfgToTaskUpdateTask$).toBe('-a', {
          a: expectedAction,
        });
      });
    });

    it('should fallback to Date.now() when no dates available', () => {
      testScheduler.run(({ hot, expectObservable }) => {
        const startTimeStr = '10:00';
        const now = Date.now();

        // Mock Date.now for predictable results
        spyOn(Date, 'now').and.returnValue(now);

        const action = addTaskRepeatCfgToTask({
          taskRepeatCfg: {
            ...mockRepeatCfg,
            startDate: undefined,
            repeatCycle: 'DAILY',
            repeatEvery: 1,
          },
          taskId: 'parent-task-id',
          startTime: startTimeStr,
          remindAt: TaskReminderOptionId.AtStart,
        });

        actions$ = hot('-a', { a: action });

        const taskWithNoDates: Task = {
          ...mockTask,
          dueDay: undefined,
          dueWithTime: undefined,
        };

        taskService.getByIdOnce$.and.returnValue(of(taskWithNoDates));

        const expectedDateTime = getDateTimeFromClockString(startTimeStr, now);

        const expectedAction = TaskSharedActions.scheduleTaskWithTime({
          task: taskWithNoDates,
          dueWithTime: expectedDateTime,
          remindAt: remindOptionToMilliseconds(
            expectedDateTime,
            TaskReminderOptionId.AtStart,
          ),
          isMoveToBacklog: false,
          isSkipAutoRemoveFromToday: isToday(expectedDateTime),
        });

        expectObservable(effects.addRepeatCfgToTaskUpdateTask$).toBe('-a', {
          a: expectedAction,
        });
      });
    });

    it('should handle MONTHLY repeat pattern correctly (issue #5594)', () => {
      testScheduler.run(({ hot, expectObservable }) => {
        const todayStr = getDbDateStr();
        const startTimeStr = '10:00';

        // Set startDate to today so MONTHLY pattern matches today
        const action = addTaskRepeatCfgToTask({
          taskRepeatCfg: {
            ...mockRepeatCfg,
            startDate: todayStr,
            repeatCycle: 'MONTHLY',
            repeatEvery: 1,
          },
          taskId: 'parent-task-id',
          startTime: startTimeStr,
          remindAt: TaskReminderOptionId.AtStart,
        });

        actions$ = hot('-a', { a: action });
        taskService.getByIdOnce$.and.returnValue(of(mockTask));

        // For MONTHLY on the same day of month as startDate, should return today
        const expectedDateTime = getDateTimeFromClockString(
          startTimeStr,
          dateStrToUtcDate(todayStr).getTime(),
        );

        const expectedAction = TaskSharedActions.scheduleTaskWithTime({
          task: mockTask,
          dueWithTime: expectedDateTime,
          remindAt: remindOptionToMilliseconds(
            expectedDateTime,
            TaskReminderOptionId.AtStart,
          ),
          isMoveToBacklog: false,
          isSkipAutoRemoveFromToday: isToday(expectedDateTime),
        });

        expectObservable(effects.addRepeatCfgToTaskUpdateTask$).toBe('-a', {
          a: expectedAction,
        });
      });
    });

    it('should schedule for next matching weekday when WEEKLY pattern does not match today (issue #5594)', () => {
      testScheduler.run(({ hot, expectObservable }) => {
        const todayStr = getDbDateStr();
        const startTimeStr = '10:00';
        const today = new Date();
        const todayDayOfWeek = today.getDay();

        // Create a repeat config for a day that is 3 days from today
        const targetDayOfWeek = (todayDayOfWeek + 3) % 7;
        const weekdayKeys = [
          'sunday',
          'monday',
          'tuesday',
          'wednesday',
          'thursday',
          'friday',
          'saturday',
        ] as const;
        const targetWeekdayKey = weekdayKeys[targetDayOfWeek];

        const action = addTaskRepeatCfgToTask({
          taskRepeatCfg: {
            ...mockRepeatCfg,
            startDate: todayStr,
            repeatCycle: 'WEEKLY',
            repeatEvery: 1,
            monday: targetWeekdayKey === 'monday',
            tuesday: targetWeekdayKey === 'tuesday',
            wednesday: targetWeekdayKey === 'wednesday',
            thursday: targetWeekdayKey === 'thursday',
            friday: targetWeekdayKey === 'friday',
            saturday: targetWeekdayKey === 'saturday',
            sunday: targetWeekdayKey === 'sunday',
          },
          taskId: 'parent-task-id',
          startTime: startTimeStr,
          remindAt: TaskReminderOptionId.AtStart,
        });

        actions$ = hot('-a', { a: action });
        taskService.getByIdOnce$.and.returnValue(of(mockTask));

        // When WEEKLY pattern doesn't match today, getFirstRepeatOccurrence
        // returns the NEXT matching weekday (3 days from today)
        const nextMatchingDate = new Date(today);
        nextMatchingDate.setDate(nextMatchingDate.getDate() + 3);
        nextMatchingDate.setHours(12, 0, 0, 0);
        const nextMatchingDateStr = getDbDateStr(nextMatchingDate);

        const expectedDateTime = getDateTimeFromClockString(
          startTimeStr,
          dateStrToUtcDate(nextMatchingDateStr).getTime(),
        );

        const expectedAction = TaskSharedActions.scheduleTaskWithTime({
          task: mockTask,
          dueWithTime: expectedDateTime,
          remindAt: remindOptionToMilliseconds(
            expectedDateTime,
            TaskReminderOptionId.AtStart,
          ),
          isMoveToBacklog: false,
          isSkipAutoRemoveFromToday: isToday(expectedDateTime),
        });

        expectObservable(effects.addRepeatCfgToTaskUpdateTask$).toBe('-a', {
          a: expectedAction,
        });
      });
    });

    it('should fallback gracefully when repeatEvery is invalid (issue #5594)', () => {
      testScheduler.run(({ hot, expectObservable }) => {
        const todayStr = getDbDateStr();
        const dueDayStr = '2025-03-15';
        const startTimeStr = '10:00';

        // Create a repeat config with invalid repeatEvery (0)
        const action = addTaskRepeatCfgToTask({
          taskRepeatCfg: {
            ...mockRepeatCfg,
            startDate: todayStr,
            repeatCycle: 'DAILY',
            repeatEvery: 0, // Invalid!
          },
          taskId: 'parent-task-id',
          startTime: startTimeStr,
          remindAt: TaskReminderOptionId.AtStart,
        });

        actions$ = hot('-a', { a: action });

        const taskWithDueDay: Task = {
          ...mockTask,
          dueDay: dueDayStr,
        };

        taskService.getByIdOnce$.and.returnValue(of(taskWithDueDay));

        // Should handle gracefully and fall back to task.dueDay
        const expectedDateTime = getDateTimeFromClockString(
          startTimeStr,
          dateStrToUtcDate(dueDayStr).getTime(),
        );

        const expectedAction = TaskSharedActions.scheduleTaskWithTime({
          task: taskWithDueDay,
          dueWithTime: expectedDateTime,
          remindAt: remindOptionToMilliseconds(
            expectedDateTime,
            TaskReminderOptionId.AtStart,
          ),
          isMoveToBacklog: false,
          isSkipAutoRemoveFromToday: isToday(expectedDateTime),
        });

        expectObservable(effects.addRepeatCfgToTaskUpdateTask$).toBe('-a', {
          a: expectedAction,
        });
      });
    });

    it('should handle YEARLY repeat pattern correctly (issue #5594)', () => {
      testScheduler.run(({ hot, expectObservable }) => {
        const todayStr = getDbDateStr();
        const startTimeStr = '10:00';

        // Set startDate to today so YEARLY pattern matches today
        const action = addTaskRepeatCfgToTask({
          taskRepeatCfg: {
            ...mockRepeatCfg,
            startDate: todayStr,
            repeatCycle: 'YEARLY',
            repeatEvery: 1,
          },
          taskId: 'parent-task-id',
          startTime: startTimeStr,
          remindAt: TaskReminderOptionId.AtStart,
        });

        actions$ = hot('-a', { a: action });
        taskService.getByIdOnce$.and.returnValue(of(mockTask));

        // For YEARLY on the same day/month as startDate, should return today
        const expectedDateTime = getDateTimeFromClockString(
          startTimeStr,
          dateStrToUtcDate(todayStr).getTime(),
        );

        const expectedAction = TaskSharedActions.scheduleTaskWithTime({
          task: mockTask,
          dueWithTime: expectedDateTime,
          remindAt: remindOptionToMilliseconds(
            expectedDateTime,
            TaskReminderOptionId.AtStart,
          ),
          isMoveToBacklog: false,
          isSkipAutoRemoveFromToday: isToday(expectedDateTime),
        });

        expectObservable(effects.addRepeatCfgToTaskUpdateTask$).toBe('-a', {
          a: expectedAction,
        });
      });
    });

    it('should use dateStrToUtcDate to avoid UTC parsing issues (issue #5515)', () => {
      // This test verifies that date string parsing uses local midnight, not UTC midnight
      // In far-west timezones (e.g., Hawaii UTC-10), new Date('2025-01-15') would give
      // Jan 14th local date, but dateStrToUtcDate correctly gives Jan 15th local date
      testScheduler.run(({ hot, expectObservable }) => {
        const dateStr = getDbDateStr(); // Use today for predictable results
        const startTimeStr = '14:45'; // 2:45 PM - user's reported time
        const action = addTaskRepeatCfgToTask({
          taskRepeatCfg: {
            ...mockRepeatCfg,
            startDate: dateStr,
            repeatCycle: 'DAILY',
            repeatEvery: 1,
          },
          taskId: 'parent-task-id',
          startTime: startTimeStr,
          remindAt: TaskReminderOptionId.AtStart,
        });

        actions$ = hot('-a', { a: action });
        taskService.getByIdOnce$.and.returnValue(of(mockTask));

        // Verify dateStrToUtcDate gives correct local date
        const localDate = dateStrToUtcDate(dateStr);
        const today = new Date();
        expect(localDate.getDate()).toBe(today.getDate());
        expect(localDate.getMonth()).toBe(today.getMonth());
        expect(localDate.getFullYear()).toBe(today.getFullYear());

        // The scheduled time should be 14:45 on today local time
        const expectedDateTime = getDateTimeFromClockString(
          startTimeStr,
          localDate.getTime(),
        );
        const scheduledDate = new Date(expectedDateTime);
        expect(scheduledDate.getHours()).toBe(14);
        expect(scheduledDate.getMinutes()).toBe(45);

        const expectedAction = TaskSharedActions.scheduleTaskWithTime({
          task: mockTask,
          dueWithTime: expectedDateTime,
          remindAt: remindOptionToMilliseconds(
            expectedDateTime,
            TaskReminderOptionId.AtStart,
          ),
          isMoveToBacklog: false,
          isSkipAutoRemoveFromToday: isToday(expectedDateTime),
        });

        expectObservable(effects.addRepeatCfgToTaskUpdateTask$).toBe('-a', {
          a: expectedAction,
        });
      });
    });

    it('should NOT schedule task when remindAt is undefined', () => {
      testScheduler.run(({ hot, expectObservable }) => {
        const todayStr = getDbDateStr();
        const startTimeStr = '10:00';
        const action = addTaskRepeatCfgToTask({
          taskRepeatCfg: {
            ...mockRepeatCfg,
            startDate: todayStr,
            repeatCycle: 'DAILY',
            repeatEvery: 1,
          },
          taskId: 'parent-task-id',
          startTime: startTimeStr,
          remindAt: undefined, // No remindAt - should filter out
        });

        actions$ = hot('-a', { a: action });

        // Effect should NOT emit because remindAt is undefined
        expectObservable(effects.addRepeatCfgToTaskUpdateTask$).toBe('--');
      });
    });

    it('should NOT schedule task when startTime is undefined', () => {
      testScheduler.run(({ hot, expectObservable }) => {
        const todayStr = getDbDateStr();
        const action = addTaskRepeatCfgToTask({
          taskRepeatCfg: {
            ...mockRepeatCfg,
            startDate: todayStr,
            repeatCycle: 'DAILY',
            repeatEvery: 1,
          },
          taskId: 'parent-task-id',
          startTime: undefined, // No startTime - should filter out
          remindAt: TaskReminderOptionId.AtStart,
        });

        actions$ = hot('-a', { a: action });

        // Effect should NOT emit because startTime is undefined
        expectObservable(effects.addRepeatCfgToTaskUpdateTask$).toBe('--');
      });
    });

    it('should NOT schedule task when both startTime and remindAt are undefined', () => {
      testScheduler.run(({ hot, expectObservable }) => {
        const todayStr = getDbDateStr();
        const action = addTaskRepeatCfgToTask({
          taskRepeatCfg: {
            ...mockRepeatCfg,
            startDate: todayStr,
            repeatCycle: 'DAILY',
            repeatEvery: 1,
          },
          taskId: 'parent-task-id',
          startTime: undefined,
          remindAt: undefined,
        });

        actions$ = hot('-a', { a: action });

        // Effect should NOT emit because both are undefined
        expectObservable(effects.addRepeatCfgToTaskUpdateTask$).toBe('--');
      });
    });
  });
});

/**
 * Deterministic tests using jasmine.clock() to mock specific dates.
 * These tests ensure reliable, reproducible results regardless of when they run.
 */
describe('TaskRepeatCfgEffects - Deterministic Date Scenarios', () => {
  let actions$: Observable<Action>;
  let effects: TaskRepeatCfgEffects;
  let taskService: jasmine.SpyObj<TaskService>;
  let testScheduler: TestScheduler;

  // Fixed reference date: Wednesday, January 15, 2025
  const FIXED_WEDNESDAY = new Date(2025, 0, 15, 12, 0, 0);

  const baseTask: Task = {
    ...DEFAULT_TASK,
    id: 'test-task-id',
    title: 'Test Task',
    projectId: 'test-project',
    repeatCfgId: 'repeat-cfg-id',
    subTaskIds: [],
    created: FIXED_WEDNESDAY.getTime(),
  };

  const baseRepeatCfg: TaskRepeatCfgCopy = {
    ...DEFAULT_TASK_REPEAT_CFG,
    id: 'repeat-cfg-id',
    title: 'Test Repeat',
    lastTaskCreationDay: '1970-01-01', // No previous creation
    shouldInheritSubtasks: false,
    disableAutoUpdateSubtasks: false,
    subTaskTemplates: [],
  };

  beforeEach(() => {
    // Install jasmine clock BEFORE TestBed setup
    jasmine.clock().install();
    jasmine.clock().mockDate(FIXED_WEDNESDAY);

    const taskServiceSpy = jasmine.createSpyObj('TaskService', [
      'getByIdWithSubTaskData$',
      'getByIdOnce$',
      'getTasksByRepeatCfgId$',
      'getByIdsLive$',
      'getArchiveTasksForRepeatCfgId',
    ]);

    const taskRepeatCfgServiceSpy = jasmine.createSpyObj('TaskRepeatCfgService', [
      'updateTaskRepeatCfg',
      'getTaskRepeatCfgById$',
    ]);

    const matDialogSpy = jasmine.createSpyObj('MatDialog', ['open']);
    const taskArchiveServiceSpy = jasmine.createSpyObj('TaskArchiveService', ['load']);

    TestBed.configureTestingModule({
      providers: [
        TaskRepeatCfgEffects,
        provideMockActions(() => actions$),
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: TaskRepeatCfgService, useValue: taskRepeatCfgServiceSpy },
        { provide: MatDialog, useValue: matDialogSpy },
        { provide: TaskArchiveService, useValue: taskArchiveServiceSpy },
      ],
    });

    effects = TestBed.inject(TaskRepeatCfgEffects);
    taskService = TestBed.inject(TaskService) as jasmine.SpyObj<TaskService>;

    testScheduler = new TestScheduler((actual, expected) => {
      expect(actual).toEqual(expected);
    });
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  describe('Scenario: Wednesday creating task for different weekdays', () => {
    // Today is Wednesday (Jan 15, 2025)
    // getFirstRepeatOccurrence finds the NEXT matching weekday from today
    const scenarios = [
      {
        name: 'WEEKLY on Wednesday (today) - should schedule for today',
        weekday: 'wednesday',
        expectedDateStr: '2025-01-15', // Today
        shouldMatchToday: true,
      },
      {
        // Friday is 2 days ahead - getFirstRepeatOccurrence finds next Friday
        name: 'WEEKLY on Friday - schedules for next Friday (Jan 17)',
        weekday: 'friday',
        expectedDateStr: '2025-01-17', // Next Friday (2 days from today)
        shouldMatchToday: true,
      },
      {
        // Monday is 5 days ahead - getFirstRepeatOccurrence finds next Monday
        name: 'WEEKLY on Monday - schedules for next Monday (Jan 20)',
        weekday: 'monday',
        expectedDateStr: '2025-01-20', // Next Monday (5 days from today)
        shouldMatchToday: true,
      },
    ];

    scenarios.forEach(({ name, weekday, expectedDateStr, shouldMatchToday }) => {
      it(name, () => {
        testScheduler.run(({ hot, expectObservable }) => {
          const startTimeStr = '10:00';
          const fallbackDueDay = '2025-01-20'; // Fallback date

          const repeatCfg: TaskRepeatCfgCopy = {
            ...baseRepeatCfg,
            startDate: '2025-01-15', // Today (Wednesday)
            repeatCycle: 'WEEKLY',
            repeatEvery: 1,
            monday: weekday === 'monday',
            tuesday: weekday === 'tuesday',
            wednesday: weekday === 'wednesday',
            thursday: weekday === 'thursday',
            friday: weekday === 'friday',
            saturday: weekday === 'saturday',
            sunday: weekday === 'sunday',
          };

          const action = addTaskRepeatCfgToTask({
            taskRepeatCfg: repeatCfg,
            taskId: 'test-task-id',
            startTime: startTimeStr,
            remindAt: TaskReminderOptionId.AtStart,
          });

          actions$ = hot('-a', { a: action });

          const taskWithFallback: Task = {
            ...baseTask,
            dueDay: fallbackDueDay,
          };

          taskService.getByIdOnce$.and.returnValue(of(taskWithFallback));

          // Calculate expected date
          const targetDateStr = shouldMatchToday ? expectedDateStr : fallbackDueDay;
          const expectedDateTime = getDateTimeFromClockString(
            startTimeStr,
            dateStrToUtcDate(targetDateStr!).getTime(),
          );

          const expectedAction = TaskSharedActions.scheduleTaskWithTime({
            task: taskWithFallback,
            dueWithTime: expectedDateTime,
            remindAt: remindOptionToMilliseconds(
              expectedDateTime,
              TaskReminderOptionId.AtStart,
            ),
            isMoveToBacklog: false,
            isSkipAutoRemoveFromToday: isToday(expectedDateTime),
          });

          expectObservable(effects.addRepeatCfgToTaskUpdateTask$).toBe('-a', {
            a: expectedAction,
          });
        });
      });
    });
  });

  describe('Scenario: Monthly repeat patterns', () => {
    it('should schedule for today when MONTHLY and today matches the day of month', () => {
      // Today is Jan 15, startDate is also the 15th
      testScheduler.run(({ hot, expectObservable }) => {
        const startTimeStr = '09:00';

        const repeatCfg: TaskRepeatCfgCopy = {
          ...baseRepeatCfg,
          startDate: '2024-12-15', // Previous month, same day
          repeatCycle: 'MONTHLY',
          repeatEvery: 1,
        };

        const action = addTaskRepeatCfgToTask({
          taskRepeatCfg: repeatCfg,
          taskId: 'test-task-id',
          startTime: startTimeStr,
          remindAt: TaskReminderOptionId.AtStart,
        });

        actions$ = hot('-a', { a: action });
        taskService.getByIdOnce$.and.returnValue(of(baseTask));

        // Should calculate Jan 15, 2025 as the target date
        const expectedDateTime = getDateTimeFromClockString(
          startTimeStr,
          dateStrToUtcDate('2025-01-15').getTime(),
        );

        const expectedAction = TaskSharedActions.scheduleTaskWithTime({
          task: baseTask,
          dueWithTime: expectedDateTime,
          remindAt: remindOptionToMilliseconds(
            expectedDateTime,
            TaskReminderOptionId.AtStart,
          ),
          isMoveToBacklog: false,
          isSkipAutoRemoveFromToday: isToday(expectedDateTime),
        });

        expectObservable(effects.addRepeatCfgToTaskUpdateTask$).toBe('-a', {
          a: expectedAction,
        });
      });
    });

    it('should schedule for future date when MONTHLY day has not occurred yet this month', () => {
      // Today is Jan 15, repeat is for the 20th
      // getFirstRepeatOccurrence returns Jan 20 (first future occurrence of the 20th)
      testScheduler.run(({ hot, expectObservable }) => {
        const startTimeStr = '09:00';
        // Jan 20, 2025 is the first 20th ON OR AFTER Jan 15, 2025
        const expectedDateStr = '2025-01-20';

        const repeatCfg: TaskRepeatCfgCopy = {
          ...baseRepeatCfg,
          startDate: '2024-12-20', // 20th of month
          repeatCycle: 'MONTHLY',
          repeatEvery: 1,
        };

        const action = addTaskRepeatCfgToTask({
          taskRepeatCfg: repeatCfg,
          taskId: 'test-task-id',
          startTime: startTimeStr,
          remindAt: TaskReminderOptionId.AtStart,
        });

        actions$ = hot('-a', { a: action });

        taskService.getByIdOnce$.and.returnValue(of(baseTask));

        // getFirstRepeatOccurrence returns Jan 20, 2025 (the next valid occurrence)
        const expectedDateTime = getDateTimeFromClockString(
          startTimeStr,
          dateStrToUtcDate(expectedDateStr).getTime(),
        );

        const expectedAction = TaskSharedActions.scheduleTaskWithTime({
          task: baseTask,
          dueWithTime: expectedDateTime,
          remindAt: remindOptionToMilliseconds(
            expectedDateTime,
            TaskReminderOptionId.AtStart,
          ),
          isMoveToBacklog: false,
          isSkipAutoRemoveFromToday: isToday(expectedDateTime),
        });

        expectObservable(effects.addRepeatCfgToTaskUpdateTask$).toBe('-a', {
          a: expectedAction,
        });
      });
    });
  });

  describe('Scenario: Daily patterns', () => {
    it('should always schedule for today with DAILY pattern', () => {
      testScheduler.run(({ hot, expectObservable }) => {
        const startTimeStr = '08:00';

        const repeatCfg: TaskRepeatCfgCopy = {
          ...baseRepeatCfg,
          startDate: '2025-01-01', // Started earlier this month
          repeatCycle: 'DAILY',
          repeatEvery: 1,
        };

        const action = addTaskRepeatCfgToTask({
          taskRepeatCfg: repeatCfg,
          taskId: 'test-task-id',
          startTime: startTimeStr,
          remindAt: TaskReminderOptionId.AtStart,
        });

        actions$ = hot('-a', { a: action });
        taskService.getByIdOnce$.and.returnValue(of(baseTask));

        // DAILY always matches today
        const expectedDateTime = getDateTimeFromClockString(
          startTimeStr,
          dateStrToUtcDate('2025-01-15').getTime(),
        );

        const expectedAction = TaskSharedActions.scheduleTaskWithTime({
          task: baseTask,
          dueWithTime: expectedDateTime,
          remindAt: remindOptionToMilliseconds(
            expectedDateTime,
            TaskReminderOptionId.AtStart,
          ),
          isMoveToBacklog: false,
          isSkipAutoRemoveFromToday: isToday(expectedDateTime),
        });

        expectObservable(effects.addRepeatCfgToTaskUpdateTask$).toBe('-a', {
          a: expectedAction,
        });
      });
    });

    it('should handle DAILY with repeatEvery > 1', () => {
      testScheduler.run(({ hot, expectObservable }) => {
        const startTimeStr = '08:00';

        // Start date Jan 13, repeatEvery 2 means: Jan 13, 15, 17...
        // Today is Jan 15, which is a valid day
        const repeatCfg: TaskRepeatCfgCopy = {
          ...baseRepeatCfg,
          startDate: '2025-01-13',
          repeatCycle: 'DAILY',
          repeatEvery: 2,
        };

        const action = addTaskRepeatCfgToTask({
          taskRepeatCfg: repeatCfg,
          taskId: 'test-task-id',
          startTime: startTimeStr,
          remindAt: TaskReminderOptionId.AtStart,
        });

        actions$ = hot('-a', { a: action });
        taskService.getByIdOnce$.and.returnValue(of(baseTask));

        // Jan 15 is 2 days from Jan 13, so it matches the pattern
        const expectedDateTime = getDateTimeFromClockString(
          startTimeStr,
          dateStrToUtcDate('2025-01-15').getTime(),
        );

        const expectedAction = TaskSharedActions.scheduleTaskWithTime({
          task: baseTask,
          dueWithTime: expectedDateTime,
          remindAt: remindOptionToMilliseconds(
            expectedDateTime,
            TaskReminderOptionId.AtStart,
          ),
          isMoveToBacklog: false,
          isSkipAutoRemoveFromToday: isToday(expectedDateTime),
        });

        expectObservable(effects.addRepeatCfgToTaskUpdateTask$).toBe('-a', {
          a: expectedAction,
        });
      });
    });
  });

  describe('Scenario: Edge cases and error handling', () => {
    it('should schedule for future startDate correctly (not fallback)', () => {
      testScheduler.run(({ hot, expectObservable }) => {
        const startTimeStr = '10:00';
        const futureStartDate = '2025-02-01';

        // startDate is in the future - getFirstRepeatOccurrence handles this correctly
        const repeatCfg: TaskRepeatCfgCopy = {
          ...baseRepeatCfg,
          startDate: futureStartDate, // Future date
          repeatCycle: 'DAILY',
          repeatEvery: 1,
        };

        const action = addTaskRepeatCfgToTask({
          taskRepeatCfg: repeatCfg,
          taskId: 'test-task-id',
          startTime: startTimeStr,
          remindAt: TaskReminderOptionId.AtStart,
        });

        actions$ = hot('-a', { a: action });

        taskService.getByIdOnce$.and.returnValue(of(baseTask));

        // Future startDate is handled by getFirstRepeatOccurrence - returns the startDate
        const expectedDateTime = getDateTimeFromClockString(
          startTimeStr,
          dateStrToUtcDate(futureStartDate).getTime(),
        );

        const expectedAction = TaskSharedActions.scheduleTaskWithTime({
          task: baseTask,
          dueWithTime: expectedDateTime,
          remindAt: remindOptionToMilliseconds(
            expectedDateTime,
            TaskReminderOptionId.AtStart,
          ),
          isMoveToBacklog: false,
          isSkipAutoRemoveFromToday: isToday(expectedDateTime),
        });

        expectObservable(effects.addRepeatCfgToTaskUpdateTask$).toBe('-a', {
          a: expectedAction,
        });
      });
    });
  });

  /**
   * Critical tests for isSkipAutoRemoveFromToday behavior (#5594 fix)
   * These tests explicitly verify that:
   * - Tasks scheduled for TODAY have isSkipAutoRemoveFromToday = true (stay in today list)
   * - Tasks scheduled for FUTURE have isSkipAutoRemoveFromToday = false (removed from today list)
   */
  describe('Scenario: isSkipAutoRemoveFromToday behavior', () => {
    it('should set isSkipAutoRemoveFromToday=TRUE when task is scheduled for TODAY', () => {
      // Today is Jan 15, 2025 (Wednesday) - DAILY pattern means scheduled for today
      testScheduler.run(({ hot, expectObservable }) => {
        const startTimeStr = '09:00';

        const repeatCfg: TaskRepeatCfgCopy = {
          ...baseRepeatCfg,
          startDate: '2025-01-15', // Today
          repeatCycle: 'DAILY',
          repeatEvery: 1,
        };

        const action = addTaskRepeatCfgToTask({
          taskRepeatCfg: repeatCfg,
          taskId: 'test-task-id',
          startTime: startTimeStr,
          remindAt: TaskReminderOptionId.AtStart,
        });

        actions$ = hot('-a', { a: action });
        taskService.getByIdOnce$.and.returnValue(of(baseTask));

        // Scheduled for today (Jan 15) - should stay in today list
        const expectedDateTime = getDateTimeFromClockString(
          startTimeStr,
          dateStrToUtcDate('2025-01-15').getTime(),
        );

        const expectedAction = TaskSharedActions.scheduleTaskWithTime({
          task: baseTask,
          dueWithTime: expectedDateTime,
          remindAt: remindOptionToMilliseconds(
            expectedDateTime,
            TaskReminderOptionId.AtStart,
          ),
          isMoveToBacklog: false,
          isSkipAutoRemoveFromToday: true, // MUST be true for today
        });

        expectObservable(effects.addRepeatCfgToTaskUpdateTask$).toBe('-a', {
          a: expectedAction,
        });
      });
    });

    it('should set isSkipAutoRemoveFromToday=FALSE when task is scheduled for FUTURE (WEEKLY)', () => {
      // Today is Jan 15, 2025 (Wednesday) - WEEKLY on Friday means scheduled for Jan 17
      testScheduler.run(({ hot, expectObservable }) => {
        const startTimeStr = '09:00';

        const repeatCfg: TaskRepeatCfgCopy = {
          ...baseRepeatCfg,
          startDate: '2025-01-15',
          repeatCycle: 'WEEKLY',
          repeatEvery: 1,
          monday: false,
          tuesday: false,
          wednesday: false,
          thursday: false,
          friday: true, // Friday is 2 days from Wednesday
          saturday: false,
          sunday: false,
        };

        const action = addTaskRepeatCfgToTask({
          taskRepeatCfg: repeatCfg,
          taskId: 'test-task-id',
          startTime: startTimeStr,
          remindAt: TaskReminderOptionId.AtStart,
        });

        actions$ = hot('-a', { a: action });
        taskService.getByIdOnce$.and.returnValue(of(baseTask));

        // Scheduled for Jan 17 (Friday) - should be removed from today list
        const expectedDateTime = getDateTimeFromClockString(
          startTimeStr,
          dateStrToUtcDate('2025-01-17').getTime(),
        );

        const expectedAction = TaskSharedActions.scheduleTaskWithTime({
          task: baseTask,
          dueWithTime: expectedDateTime,
          remindAt: remindOptionToMilliseconds(
            expectedDateTime,
            TaskReminderOptionId.AtStart,
          ),
          isMoveToBacklog: false,
          isSkipAutoRemoveFromToday: false, // MUST be false for future dates
        });

        expectObservable(effects.addRepeatCfgToTaskUpdateTask$).toBe('-a', {
          a: expectedAction,
        });
      });
    });

    it('should set isSkipAutoRemoveFromToday=FALSE when task is scheduled for FUTURE (MONTHLY)', () => {
      // Today is Jan 15, 2025 - MONTHLY on 20th means scheduled for Jan 20
      testScheduler.run(({ hot, expectObservable }) => {
        const startTimeStr = '09:00';

        const repeatCfg: TaskRepeatCfgCopy = {
          ...baseRepeatCfg,
          startDate: '2024-12-20', // 20th of month
          repeatCycle: 'MONTHLY',
          repeatEvery: 1,
        };

        const action = addTaskRepeatCfgToTask({
          taskRepeatCfg: repeatCfg,
          taskId: 'test-task-id',
          startTime: startTimeStr,
          remindAt: TaskReminderOptionId.AtStart,
        });

        actions$ = hot('-a', { a: action });
        taskService.getByIdOnce$.and.returnValue(of(baseTask));

        // Scheduled for Jan 20 - should be removed from today list
        const expectedDateTime = getDateTimeFromClockString(
          startTimeStr,
          dateStrToUtcDate('2025-01-20').getTime(),
        );

        const expectedAction = TaskSharedActions.scheduleTaskWithTime({
          task: baseTask,
          dueWithTime: expectedDateTime,
          remindAt: remindOptionToMilliseconds(
            expectedDateTime,
            TaskReminderOptionId.AtStart,
          ),
          isMoveToBacklog: false,
          isSkipAutoRemoveFromToday: false, // MUST be false for future dates
        });

        expectObservable(effects.addRepeatCfgToTaskUpdateTask$).toBe('-a', {
          a: expectedAction,
        });
      });
    });

    it('should set isSkipAutoRemoveFromToday=FALSE when startDate is in the FUTURE', () => {
      // Today is Jan 15, 2025 - startDate Feb 1 means scheduled for Feb 1
      testScheduler.run(({ hot, expectObservable }) => {
        const startTimeStr = '09:00';

        const repeatCfg: TaskRepeatCfgCopy = {
          ...baseRepeatCfg,
          startDate: '2025-02-01', // Future start date
          repeatCycle: 'DAILY',
          repeatEvery: 1,
        };

        const action = addTaskRepeatCfgToTask({
          taskRepeatCfg: repeatCfg,
          taskId: 'test-task-id',
          startTime: startTimeStr,
          remindAt: TaskReminderOptionId.AtStart,
        });

        actions$ = hot('-a', { a: action });
        taskService.getByIdOnce$.and.returnValue(of(baseTask));

        // Scheduled for Feb 1 (future start date) - should be removed from today list
        const expectedDateTime = getDateTimeFromClockString(
          startTimeStr,
          dateStrToUtcDate('2025-02-01').getTime(),
        );

        const expectedAction = TaskSharedActions.scheduleTaskWithTime({
          task: baseTask,
          dueWithTime: expectedDateTime,
          remindAt: remindOptionToMilliseconds(
            expectedDateTime,
            TaskReminderOptionId.AtStart,
          ),
          isMoveToBacklog: false,
          isSkipAutoRemoveFromToday: false, // MUST be false for future start dates
        });

        expectObservable(effects.addRepeatCfgToTaskUpdateTask$).toBe('-a', {
          a: expectedAction,
        });
      });
    });

    it('should set isSkipAutoRemoveFromToday=TRUE when WEEKLY matches TODAY', () => {
      // Today is Jan 15, 2025 (Wednesday) - WEEKLY on Wednesday means today
      testScheduler.run(({ hot, expectObservable }) => {
        const startTimeStr = '09:00';

        const repeatCfg: TaskRepeatCfgCopy = {
          ...baseRepeatCfg,
          startDate: '2025-01-15',
          repeatCycle: 'WEEKLY',
          repeatEvery: 1,
          monday: false,
          tuesday: false,
          wednesday: true, // Wednesday is today
          thursday: false,
          friday: false,
          saturday: false,
          sunday: false,
        };

        const action = addTaskRepeatCfgToTask({
          taskRepeatCfg: repeatCfg,
          taskId: 'test-task-id',
          startTime: startTimeStr,
          remindAt: TaskReminderOptionId.AtStart,
        });

        actions$ = hot('-a', { a: action });
        taskService.getByIdOnce$.and.returnValue(of(baseTask));

        // Scheduled for today (Wednesday) - should stay in today list
        const expectedDateTime = getDateTimeFromClockString(
          startTimeStr,
          dateStrToUtcDate('2025-01-15').getTime(),
        );

        const expectedAction = TaskSharedActions.scheduleTaskWithTime({
          task: baseTask,
          dueWithTime: expectedDateTime,
          remindAt: remindOptionToMilliseconds(
            expectedDateTime,
            TaskReminderOptionId.AtStart,
          ),
          isMoveToBacklog: false,
          isSkipAutoRemoveFromToday: true, // MUST be true for today
        });

        expectObservable(effects.addRepeatCfgToTaskUpdateTask$).toBe('-a', {
          a: expectedAction,
        });
      });
    });
  });
});
