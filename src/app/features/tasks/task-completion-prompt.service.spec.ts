import { TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { TaskCompletionPromptService } from './task-completion-prompt.service';
import { TaskService } from './task.service';
import { GlobalConfigService } from '../config/global-config.service';
import { DialogMarkTaskDoneComponent } from './dialog-mark-task-done/dialog-mark-task-done.component';
import { Task } from './task.model';
import { MarkTaskDoneDialogResult } from './dialog-mark-task-done/dialog-mark-task-done.model';

describe('TaskCompletionPromptService', () => {
  let service: TaskCompletionPromptService;
  let taskServiceSpy: jasmine.SpyObj<TaskService>;
  let matDialogSpy: jasmine.SpyObj<MatDialog>;
  let globalConfigServiceSpy: {
    cfg: jasmine.Spy;
    timelineCfg: jasmine.Spy;
  };
  let dialogRefSpy: jasmine.SpyObj<MatDialogRef<DialogMarkTaskDoneComponent>>;

  const createMockTask = (overrides: Partial<Task> = {}): Task =>
    ({
      id: 'task-1',
      title: 'Test Task',
      timeSpent: 0,
      timeEstimate: 0,
      dueWithTime: null,
      parentId: null,
      repeatCfgId: null,
      isDone: false,
      subTaskIds: [],
      tagIds: [],
      ...overrides,
    }) as unknown as Task;

  beforeEach(() => {
    taskServiceSpy = jasmine.createSpyObj('TaskService', ['setDone', 'update']);
    matDialogSpy = jasmine.createSpyObj('MatDialog', ['open']);
    dialogRefSpy = jasmine.createSpyObj('MatDialogRef', ['afterClosed']);

    matDialogSpy.open.and.returnValue(dialogRefSpy as any);

    globalConfigServiceSpy = {
      cfg: jasmine.createSpy('cfg').and.returnValue({
        schedule: {
          isPromptOnTaskDoneSchedule: true,
        },
      }),
      timelineCfg: jasmine.createSpy('timelineCfg').and.returnValue({
        isPromptOnTaskDoneSchedule: true,
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        TaskCompletionPromptService,
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: MatDialog, useValue: matDialogSpy },
        { provide: GlobalConfigService, useValue: globalConfigServiceSpy },
      ],
    });

    service = TestBed.inject(TaskCompletionPromptService);
  });

  describe('Scope Guards & Bypasses', () => {
    it('US 24: Completing subtasks (parentId != null) bypasses schedule dialog completely and completes immediately', () => {
      const task = createMockTask({ parentId: 'parent-123' });
      let emitted = false;

      service.completeTask(task).subscribe((res) => {
        emitted = res;
      });

      expect(matDialogSpy.open).not.toHaveBeenCalled();
      expect(taskServiceSpy.setDone).toHaveBeenCalledTimes(1);
      expect(taskServiceSpy.setDone).toHaveBeenCalledWith('task-1');
      expect(emitted).toBeTrue();
    });

    it('US 25: Completing recurring/repeat tasks (repeatCfgId != null) bypasses schedule dialog in MVP and completes immediately', () => {
      const task = createMockTask({ repeatCfgId: 'repeat-cfg-1' });
      let emitted = false;

      service.completeTask(task).subscribe((res) => {
        emitted = res;
      });

      expect(matDialogSpy.open).not.toHaveBeenCalled();
      expect(taskServiceSpy.setDone).toHaveBeenCalledTimes(1);
      expect(taskServiceSpy.setDone).toHaveBeenCalledWith('task-1');
      expect(emitted).toBeTrue();
    });

    it('should bypass dialog and complete immediately when isPromptOnTaskDoneSchedule config is false', () => {
      globalConfigServiceSpy.cfg.and.returnValue({
        schedule: { isPromptOnTaskDoneSchedule: false },
      });
      globalConfigServiceSpy.timelineCfg.and.returnValue({
        isPromptOnTaskDoneSchedule: false,
      });

      const task = createMockTask({ dueWithTime: null });
      service.completeTask(task);

      expect(matDialogSpy.open).not.toHaveBeenCalled();
      expect(taskServiceSpy.setDone).toHaveBeenCalledTimes(1);
      expect(taskServiceSpy.setDone).toHaveBeenCalledWith('task-1');
    });

    it('US 26: Completing an already scheduled task with zero time tracked (timeSpent === 0) bypasses dialog, preserving its planned block', () => {
      const task = createMockTask({
        dueWithTime: 1770000000000,
        timeSpent: 0,
        timeEstimate: 3600000,
      });
      service.completeTask(task);

      expect(matDialogSpy.open).not.toHaveBeenCalled();
      expect(taskServiceSpy.setDone).toHaveBeenCalledTimes(1);
      expect(taskServiceSpy.setDone).toHaveBeenCalledWith('task-1');
      expect(taskServiceSpy.update).not.toHaveBeenCalled();
    });

    it('US 26: Completing an already scheduled task with zero time tracked and zero estimate bypasses dialog', () => {
      const task = createMockTask({
        dueWithTime: 1770000000000,
        timeSpent: 0,
        timeEstimate: 0,
      });
      service.completeTask(task);

      expect(matDialogSpy.open).not.toHaveBeenCalled();
      expect(taskServiceSpy.setDone).toHaveBeenCalledTimes(1);
      expect(taskServiceSpy.setDone).toHaveBeenCalledWith('task-1');
    });

    it('US 27: Completing an already scheduled task where tracked time matches estimate (timeSpent === timeEstimate) bypasses dialog and completes immediately', () => {
      const task = createMockTask({
        dueWithTime: 1770000000000,
        timeSpent: 3600000,
        timeEstimate: 3600000,
      });
      service.completeTask(task);

      expect(matDialogSpy.open).not.toHaveBeenCalled();
      expect(taskServiceSpy.setDone).toHaveBeenCalledTimes(1);
      expect(taskServiceSpy.setDone).toHaveBeenCalledWith('task-1');
      expect(taskServiceSpy.update).not.toHaveBeenCalled();
    });

    it('should bypass dialog if task is already done', () => {
      const task = createMockTask({ isDone: true });
      service.completeTask(task);

      expect(matDialogSpy.open).not.toHaveBeenCalled();
      expect(taskServiceSpy.setDone).toHaveBeenCalledTimes(1);
    });
  });

  describe('Schedule Context Completion', () => {
    it('should open dialog when completed from schedule view even if timeSpent is 0', () => {
      dialogRefSpy.afterClosed.and.returnValue(of(undefined));
      const scheduledTime = 1770030000000;
      const task = createMockTask({
        id: 't-sched-zero',
        title: 'Zero Spent Scheduled Task',
        timeSpent: 0,
        timeEstimate: 3600000,
        dueWithTime: scheduledTime,
      });

      service.completeTask(task, undefined, { isFromSchedule: true });

      expect(matDialogSpy.open).toHaveBeenCalledTimes(1);
      expect(matDialogSpy.open).toHaveBeenCalledWith(DialogMarkTaskDoneComponent, {
        data: {
          taskId: 't-sched-zero',
          taskTitle: 'Zero Spent Scheduled Task',
          timeSpent: 0,
          timeEstimate: 3600000,
          currentScheduledTime: scheduledTime,
          dueDay: null,
        },
      });
    });

    it('should open dialog when completing unscheduled task from schedule view', () => {
      dialogRefSpy.afterClosed.and.returnValue(of(undefined));
      const task = createMockTask({
        id: 't-unsched-sched-view',
        title: 'Unscheduled Task on Schedule View',
        timeSpent: 0,
        timeEstimate: 1800000,
        dueWithTime: null,
        dueDay: '2026-10-12',
      });

      service.completeTask(task, undefined, { isFromSchedule: true });

      expect(matDialogSpy.open).toHaveBeenCalledTimes(1);
      expect(matDialogSpy.open).toHaveBeenCalledWith(DialogMarkTaskDoneComponent, {
        data: {
          taskId: 't-unsched-sched-view',
          taskTitle: 'Unscheduled Task on Schedule View',
          timeSpent: 0,
          timeEstimate: 1800000,
          currentScheduledTime: null,
          dueDay: '2026-10-12',
        },
      });
    });

    it('should bypass dialog from schedule view when timeSpent matches positive timeEstimate', () => {
      const task = createMockTask({
        dueWithTime: 1770000000000,
        timeSpent: 3600000,
        timeEstimate: 3600000,
      });

      service.completeTask(task, undefined, { isFromSchedule: true });

      expect(matDialogSpy.open).not.toHaveBeenCalled();
      expect(taskServiceSpy.setDone).toHaveBeenCalledWith('task-1');
    });
  });

  describe('Dialog Invocation', () => {
    it('should open DialogMarkTaskDoneComponent for unscheduled tasks', () => {
      dialogRefSpy.afterClosed.and.returnValue(of(undefined));
      const task = createMockTask({
        id: 't-unscheduled',
        title: 'Unscheduled Work',
        timeSpent: 1800000,
        timeEstimate: 3600000,
        dueWithTime: null,
      });

      service.completeTask(task);

      expect(matDialogSpy.open).toHaveBeenCalledTimes(1);
      expect(matDialogSpy.open).toHaveBeenCalledWith(DialogMarkTaskDoneComponent, {
        data: {
          taskId: 't-unscheduled',
          taskTitle: 'Unscheduled Work',
          timeSpent: 1800000,
          timeEstimate: 3600000,
          currentScheduledTime: null,
          dueDay: null,
        },
      });
    });

    it('should open DialogMarkTaskDoneComponent for already scheduled tasks with duration discrepancy (timeSpent !== timeEstimate and timeSpent > 0)', () => {
      dialogRefSpy.afterClosed.and.returnValue(of(undefined));
      const scheduledTime = 1770030000000;
      const task = createMockTask({
        id: 't-scheduled-discrepancy',
        title: 'Discrepancy Work',
        timeSpent: 5400000,
        timeEstimate: 3600000,
        dueWithTime: scheduledTime,
      });

      service.completeTask(task);

      expect(matDialogSpy.open).toHaveBeenCalledTimes(1);
      expect(matDialogSpy.open).toHaveBeenCalledWith(DialogMarkTaskDoneComponent, {
        data: {
          taskId: 't-scheduled-discrepancy',
          taskTitle: 'Discrepancy Work',
          timeSpent: 5400000,
          timeEstimate: 3600000,
          currentScheduledTime: scheduledTime,
          dueDay: null,
        },
      });
    });
  });

  describe('Dialog Cancellation (US 14)', () => {
    it('US 14: Pressing Escape or clicking Cancel dismisses dialog, invokes onCancel callback, and leaves task incomplete (isDone: false)', () => {
      dialogRefSpy.afterClosed.and.returnValue(of(undefined));
      const onCancelSpy = jasmine.createSpy('onCancel');
      let resultValue: boolean | undefined;

      const task = createMockTask({ dueWithTime: null });
      service.completeTask(task, onCancelSpy).subscribe((res) => {
        resultValue = res;
      });

      expect(onCancelSpy).toHaveBeenCalledTimes(1);
      expect(taskServiceSpy.update).not.toHaveBeenCalled();
      expect(taskServiceSpy.setDone).not.toHaveBeenCalled();
      expect(resultValue).toBeFalse();
    });

    it('US 14: Closing dialog with confirmed: false invokes onCancel and leaves task incomplete', () => {
      dialogRefSpy.afterClosed.and.returnValue(
        of({
          confirmed: false,
          placement: { type: 'ALL_DAY', dueWithTime: 0 },
        } as MarkTaskDoneDialogResult),
      );
      const onCancelSpy = jasmine.createSpy('onCancel');

      const task = createMockTask({ dueWithTime: null });
      service.completeTask(task, onCancelSpy);

      expect(onCancelSpy).toHaveBeenCalledTimes(1);
      expect(taskServiceSpy.update).not.toHaveBeenCalled();
      expect(taskServiceSpy.setDone).not.toHaveBeenCalled();
    });
  });

  describe('Dialog Confirmation & State Commit (US 7, US 13)', () => {
    it('US 7 & US 13: Confirming 12:00 AM (All Day) slots task at 00:00:00 midnight timestamp, updates timeEstimate, and marks task done', () => {
      const midnightTimestamp = new Date(2026, 9, 12, 0, 0, 0, 0).getTime();
      const dialogResult: MarkTaskDoneDialogResult = {
        confirmed: true,
        placement: {
          type: 'ALL_DAY',
          dueWithTime: midnightTimestamp,
        },
        durationAdjustment: {
          type: 'ADJUST_TO_TRACKED',
          newEstimateDurationMs: 1800000,
        },
      };
      dialogRefSpy.afterClosed.and.returnValue(of(dialogResult));

      const task = createMockTask({
        id: 't-confirm',
        dueWithTime: null,
      });

      let resultValue: boolean | undefined;
      service.completeTask(task).subscribe((res) => {
        resultValue = res;
      });

      expect(taskServiceSpy.update).toHaveBeenCalledTimes(1);
      expect(taskServiceSpy.update).toHaveBeenCalledWith('t-confirm', {
        dueWithTime: midnightTimestamp,
        dueDay: undefined,
        timeEstimate: 1800000,
      });
      expect(taskServiceSpy.setDone).toHaveBeenCalledTimes(1);
      expect(taskServiceSpy.setDone).toHaveBeenCalledWith('t-confirm');
      expect(resultValue).toBeTrue();
    });

    it('US 13: Confirming Custom Time commits specific dueWithTime without duration adjustment when not adjusted', () => {
      const customTimestamp = new Date(2026, 9, 12, 14, 30, 0, 0).getTime();
      const dialogResult: MarkTaskDoneDialogResult = {
        confirmed: true,
        placement: {
          type: 'CUSTOM_TIME',
          dueWithTime: customTimestamp,
        },
      };
      dialogRefSpy.afterClosed.and.returnValue(of(dialogResult));

      const task = createMockTask({
        id: 't-custom-confirm',
        dueWithTime: null,
      });

      service.completeTask(task);

      expect(taskServiceSpy.update).toHaveBeenCalledTimes(1);
      expect(taskServiceSpy.update).toHaveBeenCalledWith('t-custom-confirm', {
        dueWithTime: customTimestamp,
        dueDay: undefined,
      });
      expect(taskServiceSpy.setDone).toHaveBeenCalledTimes(1);
      expect(taskServiceSpy.setDone).toHaveBeenCalledWith('t-custom-confirm');
    });
  });
});
