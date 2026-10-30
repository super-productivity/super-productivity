import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import {
  AssistantCaptureService,
  parseAssistantCaptureInput,
} from './assistant-capture.service';
import { TaskService } from '../task.service';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { OperationCaptureService } from '../../../op-log/capture/operation-capture.service';
import { OperationWriteFlushService } from '../../../op-log/sync/operation-write-flush.service';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { WorkContextType } from '../../work-context/work-context.model';
import { INBOX_PROJECT } from '../../project/project.const';
import { DEFAULT_TASK, Task } from '../task.model';
import { GlobalConfigService } from '../../config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';
import { DateService } from '../../../core/date/date.service';
import { addTaskRepeatCfgToTask } from '../../task-repeat-cfg/store/task-repeat-cfg.actions';

describe('AssistantCaptureService', () => {
  let service: AssistantCaptureService;
  let store: MockStore;
  let dispatchSpy: jasmine.Spy;
  let taskService: jasmine.SpyObj<TaskService>;
  let hydrationState: jasmine.SpyObj<HydrationStateService>;
  let operationCapture: jasmine.SpyObj<OperationCaptureService>;
  let writeFlush: jasmine.SpyObj<OperationWriteFlushService>;
  let config: { cfg: () => typeof DEFAULT_GLOBAL_CONFIG };

  const task = { id: 'new-task', title: 'Buy milk #shop' } as Task;

  beforeEach(() => {
    taskService = jasmine.createSpyObj<TaskService>('TaskService', [
      'createNewTaskWithDefaults',
    ]);
    taskService.createNewTaskWithDefaults.and.returnValue(task);
    hydrationState = jasmine.createSpyObj<HydrationStateService>(
      'HydrationStateService',
      ['isApplyingRemoteOps'],
    );
    hydrationState.isApplyingRemoteOps.and.returnValue(false);
    operationCapture = jasmine.createSpyObj<OperationCaptureService>(
      'OperationCaptureService',
      ['hasUnrecoveredPersistFailure'],
    );
    operationCapture.hasUnrecoveredPersistFailure.and.returnValue(false);
    writeFlush = jasmine.createSpyObj<OperationWriteFlushService>(
      'OperationWriteFlushService',
      ['flushPendingWrites'],
    );
    writeFlush.flushPendingWrites.and.resolveTo();
    config = { cfg: () => DEFAULT_GLOBAL_CONFIG };

    TestBed.configureTestingModule({
      providers: [
        AssistantCaptureService,
        provideMockStore(),
        { provide: TaskService, useValue: taskService },
        { provide: HydrationStateService, useValue: hydrationState },
        { provide: OperationCaptureService, useValue: operationCapture },
        { provide: OperationWriteFlushService, useValue: writeFlush },
        { provide: GlobalConfigService, useValue: config },
        { provide: DateService, useValue: { todayStr: () => '2026-10-17' } },
      ],
    });
    service = TestBed.inject(AssistantCaptureService);
    store = TestBed.inject(MockStore);
    dispatchSpy = spyOn(store, 'dispatch');
  });

  it('adds one task pinned to the Inbox, without short syntax, and reports it', async () => {
    const result = await service.capture({ title: 'Buy milk #shop', notes: 'n' });

    expect(result).toEqual({ status: 'created', id: 'new-task' });
    // The active view must not contribute anything: an explicit Inbox project
    // context means no tag from a tag view and no Today date.
    expect(taskService.createNewTaskWithDefaults).toHaveBeenCalledOnceWith({
      title: 'Buy milk #shop',
      additional: { notes: 'n' },
      workContextType: WorkContextType.PROJECT,
      workContextId: INBOX_PROJECT.id,
    });
    expect(dispatchSpy).toHaveBeenCalledOnceWith(
      TaskSharedActions.addTask({
        task,
        workContextId: INBOX_PROJECT.id,
        workContextType: WorkContextType.PROJECT,
        isAddToBacklog: false,
        isAddToBottom: false,
        isIgnoreShortSyntax: true,
      }),
    );
    expect(writeFlush.flushPendingWrites).toHaveBeenCalled();
  });

  it('refuses while remote ops are applied, before dispatching anything', async () => {
    hydrationState.isApplyingRemoteOps.and.returnValue(true);
    expect(await service.capture({ title: 'x' })).toEqual({ status: 'APP_BUSY' });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('refuses when earlier writes already failed to persist', async () => {
    operationCapture.hasUnrecoveredPersistFailure.and.returnValue(true);
    expect(await service.capture({ title: 'x' })).toEqual({ status: 'PERSIST_DEGRADED' });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('does not claim success when a persist failure appears during the flush', async () => {
    operationCapture.hasUnrecoveredPersistFailure.and.returnValues(false, true);
    expect(await service.capture({ title: 'x' })).toEqual({
      status: 'OUTCOME_UNKNOWN',
      id: 'new-task',
    });
  });

  it('does not claim success when the flush times out', async () => {
    writeFlush.flushPendingWrites.and.rejectWith(new Error('timeout'));
    expect(await service.capture({ title: 'x' })).toEqual({
      status: 'OUTCOME_UNKNOWN',
      id: 'new-task',
    });
  });

  it('includes a configured default estimate in the add op', async () => {
    config.cfg = () => ({
      ...DEFAULT_GLOBAL_CONFIG,
      timeTracking: { ...DEFAULT_GLOBAL_CONFIG.timeTracking, defaultEstimate: 3600000 },
    });
    taskService.createNewTaskWithDefaults.and.callFake(({ additional }) => ({
      ...DEFAULT_TASK,
      ...additional,
      id: 'new-task',
      title: 'x',
      projectId: INBOX_PROJECT.id,
    }));

    await service.capture({ title: 'x' });

    expect(taskService.createNewTaskWithDefaults).toHaveBeenCalledOnceWith({
      title: 'x',
      additional: { timeEstimate: 3600000 },
      workContextType: WorkContextType.PROJECT,
      workContextId: INBOX_PROJECT.id,
    });
    expect(dispatchSpy.calls.mostRecent().args[0].task.timeEstimate).toBe(3600000);
  });

  it('schedules a day-only capture as dueDay in the add op', async () => {
    await service.capture({ title: 'x', dueDay: '2026-11-02' });

    expect(taskService.createNewTaskWithDefaults).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({ additional: { dueDay: '2026-11-02' } }),
    );
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });

  it('schedules a timed capture in the one add op, with the default reminder', async () => {
    await service.capture({ title: 'x', dueDay: '2026-11-02', dueTime: [9, 30] });

    const dueWithTime = new Date(2026, 10, 2, 9, 30).getTime();
    expect(taskService.createNewTaskWithDefaults).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        additional: {
          dueDay: undefined,
          dueWithTime,
          hasPlannedTime: true,
          remindAt: dueWithTime,
        },
      }),
    );
    // One op, no scheduleTaskWithTime: same as a timed hosted capture.
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy.calls.mostRecent().args[0].type).toBe(
      TaskSharedActions.addTask.type,
    );
  });

  it('makes a recurring capture repeatable before the flush', async () => {
    writeFlush.flushPendingWrites.and.callFake(async () => {
      expect(dispatchSpy).toHaveBeenCalledTimes(2);
    });

    await service.capture({
      title: 'x',
      repeat: { cycle: 'WEEKLY', every: 1, weekdays: [1] },
    });

    const action = dispatchSpy.calls.mostRecent().args[0];
    expect(action.type).toBe(addTaskRepeatCfgToTask.type);
    expect(action.taskId).toBe('new-task');
    expect(action.taskRepeatCfg).toEqual(
      jasmine.objectContaining({
        repeatCycle: 'WEEKLY',
        startDate: '2026-10-17',
        monday: true,
        tuesday: false,
        projectId: INBOX_PROJECT.id,
      }),
    );
    expect(action.startTime).toBeUndefined();
    expect(writeFlush.flushPendingWrites).toHaveBeenCalledTimes(1);
  });

  it('gives a timed recurring capture its start day and time', async () => {
    await service.capture({
      title: 'x',
      dueDay: '2026-11-02',
      dueTime: [7, 5],
      repeat: { cycle: 'DAILY', every: 2 },
    });

    const action = dispatchSpy.calls.mostRecent().args[0];
    expect(action.type).toBe(addTaskRepeatCfgToTask.type);
    expect(action.taskRepeatCfg.startDate).toBe('2026-11-02');
    expect(action.startTime).toBe('07:05');
    expect(action.remindAt).toBe(DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption);
  });
});

describe('parseAssistantCaptureInput', () => {
  it('accepts a title with optional notes and trims the title', () => {
    expect(parseAssistantCaptureInput({ title: '  a  ' })).toEqual({ title: 'a' });
    expect(parseAssistantCaptureInput({ title: 'a', notes: 'b' })).toEqual({
      title: 'a',
      notes: 'b',
    });
  });

  it('rejects anything else', () => {
    expect(parseAssistantCaptureInput(undefined)).toBeUndefined();
    expect(parseAssistantCaptureInput({ title: '   ' })).toBeUndefined();
    expect(parseAssistantCaptureInput({ title: 'a'.repeat(501) })).toBeUndefined();
    expect(parseAssistantCaptureInput({ title: 'a', notes: 1 })).toBeUndefined();
    expect(parseAssistantCaptureInput({ title: 'a', projectId: 'p' })).toBeUndefined();
  });

  it('accepts dueDate, dueTime and repeat', () => {
    expect(
      parseAssistantCaptureInput({
        title: 'a',
        dueDate: '2026-11-02',
        dueTime: '09:30',
        repeat: { cycle: 'weekly', weekdays: ['mon'] },
      }),
    ).toEqual({
      title: 'a',
      dueDay: '2026-11-02',
      dueTime: [9, 30],
      repeat: { cycle: 'WEEKLY', every: 1, weekdays: [1] },
    });
  });

  it('rejects invalid scheduling fields instead of dropping them', () => {
    for (const extra of [
      { dueTime: '09:30' },
      { dueDate: '2026-02-30' },
      { dueDate: '0999-01-01' },
      { repeat: { cycle: 'hourly' } },
    ]) {
      expect(parseAssistantCaptureInput({ title: 'a', ...extra }))
        .withContext(JSON.stringify(extra))
        .toBeUndefined();
    }
  });
});
