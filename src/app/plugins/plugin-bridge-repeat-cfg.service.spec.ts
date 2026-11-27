import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import { PluginBridgeRepeatCfgService } from './plugin-bridge-repeat-cfg.service';
import { TaskRepeatCfgService } from '../features/task-repeat-cfg/task-repeat-cfg.service';
import {
  DEFAULT_TASK_REPEAT_CFG,
  TaskRepeatCfg,
} from '../features/task-repeat-cfg/task-repeat-cfg.model';
import { TaskService } from '../features/tasks/task.service';
import { DEFAULT_TASK, Task } from '../features/tasks/task.model';
import { DateService } from '../core/date/date.service';
import { GlobalConfigService } from '../features/config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../features/config/default-global-config.const';

describe('PluginBridgeRepeatCfgService', () => {
  let service: PluginBridgeRepeatCfgService;
  let cfgs$: BehaviorSubject<TaskRepeatCfg[]>;
  let repeatCfgServiceMock: jasmine.SpyObj<TaskRepeatCfgService>;

  const task = (id: string, overrides: Partial<Task> = {}): Task => ({
    ...DEFAULT_TASK,
    id,
    title: id,
    projectId: 'p1',
    ...overrides,
  });
  const tasks: Record<string, Task> = {
    // 2026-10-13 is the second Tuesday of October 2026
    t1: task('t1', { title: 'Water plants', dueDay: '2026-10-13' }),
    other: task('other'),
    sub: task('sub', { parentId: 't1' }),
  };

  const storedCfg = (id: string): TaskRepeatCfg | undefined =>
    cfgs$.value.find((cfg) => cfg.id === id);

  beforeEach(() => {
    cfgs$ = new BehaviorSubject<TaskRepeatCfg[]>([
      {
        ...DEFAULT_TASK_REPEAT_CFG,
        id: 'daily',
        projectId: 'p1',
        quickSetting: 'DAILY',
        repeatCycle: 'DAILY',
        startDate: '2026-09-01',
      },
    ]);
    repeatCfgServiceMock = jasmine.createSpyObj<TaskRepeatCfgService>(
      'TaskRepeatCfgService',
      ['addTaskRepeatCfgToTask', 'updateTaskRepeatCfg'],
      { taskRepeatCfgs$: cfgs$ },
    );
    repeatCfgServiceMock.addTaskRepeatCfgToTask.and.callFake((taskId, projectId, cfg) => {
      cfgs$.next([...cfgs$.value, { ...cfg, projectId, id: `cfg-${taskId}` }]);
      return `cfg-${taskId}`;
    });
    repeatCfgServiceMock.updateTaskRepeatCfg.and.callFake((id, changes) => {
      cfgs$.next(cfgs$.value.map((c) => (c.id === id ? { ...c, ...changes } : c)));
    });
    const taskServiceMock = jasmine.createSpyObj<TaskService>('TaskService', [
      'getByIdOnce$',
    ]);
    taskServiceMock.getByIdOnce$.and.callFake((id: string) => of(tasks[id]));

    TestBed.configureTestingModule({
      providers: [
        { provide: TaskRepeatCfgService, useValue: repeatCfgServiceMock },
        { provide: TaskService, useValue: taskServiceMock },
        {
          provide: DateService,
          useValue: {
            todayStr: (): string => '2026-10-04',
            getLogicalTodayDate: (): Date => new Date(2026, 9, 4),
            getStartOfNextDayDiffMs: (): number => 0,
          },
        },
        {
          provide: GlobalConfigService,
          useValue: { cfg: signal(DEFAULT_GLOBAL_CONFIG) },
        },
      ],
    });
    service = TestBed.inject(PluginBridgeRepeatCfgService);
  });

  describe('addTaskRepeatCfg', () => {
    it('makes the task repeat and resolves with the new config id', async () => {
      const { addTaskRepeatCfg } = service.createBoundMethods();

      const id = await addTaskRepeatCfg('t1', { quickSetting: 'MONTHLY_NTH_WEEKDAY' });

      expect(id).toBe('cfg-t1');
      expect(storedCfg(id)).toEqual(
        jasmine.objectContaining({
          title: 'Water plants',
          quickSetting: 'MONTHLY_NTH_WEEKDAY',
          repeatCycle: 'MONTHLY',
          startDate: '2026-10-13',
          monthlyWeekOfMonth: 2,
          monthlyWeekday: 2,
        }),
      );
    });

    it('repeats daily from the task day without a schedule', async () => {
      const id = await service.createBoundMethods().addTaskRepeatCfg('t1');

      expect(storedCfg(id)).toEqual(
        jasmine.objectContaining({
          quickSetting: 'DAILY',
          repeatCycle: 'DAILY',
          startDate: '2026-10-13',
        }),
      );
    });

    it('rejects a taskId inside the schedule', async () => {
      const schedule = { taskId: 'other' } as unknown as Record<string, never>;

      await expectAsync(
        service.createBoundMethods().addTaskRepeatCfg('t1', schedule),
      ).toBeRejectedWithError(
        'UNSUPPORTED_FIELD: Field(s) cannot be set through this endpoint: taskId',
      );
      expect(repeatCfgServiceMock.addTaskRepeatCfgToTask).not.toHaveBeenCalled();
    });

    it('rejects with the reason when the task cannot repeat', async () => {
      await expectAsync(
        service.createBoundMethods().addTaskRepeatCfg('sub'),
      ).toBeRejectedWithError('INVALID_INPUT: Subtasks cannot repeat');
      const existingId = await service.createBoundMethods().addTaskRepeatCfg('other');
      tasks.other = task('other', { repeatCfgId: existingId });
      await expectAsync(
        service.createBoundMethods().addTaskRepeatCfg('other'),
      ).toBeRejectedWithError(
        'INVALID_INPUT: Task already repeats; change its repeat config with PATCH /task-repeat-cfgs/:id',
      );
      tasks.other = task('other');
      await expectAsync(
        service.createBoundMethods().addTaskRepeatCfg('missing'),
      ).toBeRejectedWithError('TASK_NOT_FOUND: Task not found');
      expect(repeatCfgServiceMock.addTaskRepeatCfgToTask).toHaveBeenCalledTimes(1);
    });

    it('rejects fields outside the schedule and a non-object schedule', async () => {
      const { addTaskRepeatCfg } = service.createBoundMethods();
      const withTitle = { title: 'x' } as unknown as Record<string, never>;

      await expectAsync(addTaskRepeatCfg('t1', withTitle)).toBeRejectedWithError(
        'UNSUPPORTED_FIELD: Field(s) cannot be set through this endpoint: title',
      );
      await expectAsync(
        addTaskRepeatCfg('t1', 'daily' as unknown as Record<string, never>),
      ).toBeRejectedWithError('Repeat config schedule must be an object');
      expect(repeatCfgServiceMock.addTaskRepeatCfgToTask).not.toHaveBeenCalled();
    });
  });

  describe('end day and repeating after completion', () => {
    it('stores "2 weeks after completion" as 14 days that wait for completion', async () => {
      const id = await service.createBoundMethods().addTaskRepeatCfg('t1', {
        quickSetting: 'CUSTOM',
        repeatCycle: 'WEEKLY',
        repeatEvery: 2,
        repeatFromCompletionDate: true,
        repeatUntilDay: '2026-12-31',
      });

      expect(storedCfg(id)).toEqual(
        jasmine.objectContaining({
          quickSetting: 'CUSTOM',
          repeatCycle: 'DAILY',
          repeatEvery: 14,
          repeatFromCompletionDate: true,
          waitForCompletion: true,
          repeatUntilDay: '2026-12-31',
        }),
      );
    });

    it('rejects after completion with a preset and an end before the start', async () => {
      const { addTaskRepeatCfg } = service.createBoundMethods();

      await expectAsync(
        addTaskRepeatCfg('t1', { quickSetting: 'DAILY', repeatFromCompletionDate: true }),
      ).toBeRejectedWithError(
        'INVALID_INPUT: repeatFromCompletionDate can only be set with quickSetting "CUSTOM"',
      );
      await expectAsync(
        addTaskRepeatCfg('t1', { repeatUntilDay: '' }),
      ).toBeRejectedWithError(
        'INVALID_INPUT: repeatUntilDay must be a valid YYYY-MM-DD date',
      );
      await expectAsync(
        addTaskRepeatCfg('t1', { repeatUntilDay: '2026-10-12' }),
      ).toBeRejectedWithError(
        'INVALID_INPUT: repeatUntilDay must not be before startDate 2026-10-13',
      );
      expect(repeatCfgServiceMock.addTaskRepeatCfgToTask).not.toHaveBeenCalled();
    });

    it('removes the end day with null and leaves after completion on a new schedule', async () => {
      const { addTaskRepeatCfg, updateTaskRepeatCfg } = service.createBoundMethods();
      const id = await addTaskRepeatCfg('t1', {
        quickSetting: 'CUSTOM',
        repeatCycle: 'DAILY',
        repeatEvery: 3,
        repeatFromCompletionDate: true,
        repeatUntilDay: '2026-12-31',
      });

      await updateTaskRepeatCfg(id, { quickSetting: 'DAILY', repeatUntilDay: null });

      expect(storedCfg(id)).toEqual(
        jasmine.objectContaining({
          quickSetting: 'DAILY',
          repeatEvery: 1,
          repeatFromCompletionDate: false,
          waitForCompletion: false,
          repeatUntilDay: undefined,
        }),
      );
    });
  });

  describe('updateTaskRepeatCfg', () => {
    it('rejects a new start after the stored end day', async () => {
      const { updateTaskRepeatCfg } = service.createBoundMethods();
      await updateTaskRepeatCfg('daily', { repeatUntilDay: '2026-09-30' });

      await expectAsync(
        updateTaskRepeatCfg('daily', { quickSetting: 'DAILY', startDate: '2026-10-01' }),
      ).toBeRejectedWithError(
        'INVALID_INPUT: repeatUntilDay must not be before startDate 2026-10-01',
      );
      expect(storedCfg('daily')?.startDate).toBe('2026-09-01');
    });

    it('changes the schedule of an existing config', async () => {
      await service.createBoundMethods().updateTaskRepeatCfg('daily', {
        quickSetting: 'CUSTOM',
        repeatCycle: 'WEEKLY',
        repeatEvery: 2,
        friday: true,
      });

      expect(storedCfg('daily')).toEqual(
        jasmine.objectContaining({
          quickSetting: 'CUSTOM',
          repeatCycle: 'WEEKLY',
          repeatEvery: 2,
          monday: false,
          friday: true,
        }),
      );
    });

    it('rejects an unknown id and an invalid schedule', async () => {
      const { updateTaskRepeatCfg } = service.createBoundMethods();

      await expectAsync(
        updateTaskRepeatCfg('nope', { isPaused: true }),
      ).toBeRejectedWithError('REPEAT_CFG_NOT_FOUND: Repeat config not found');
      await expectAsync(
        updateTaskRepeatCfg('daily', { repeatEvery: 3 }),
      ).toBeRejectedWithError(
        'INVALID_INPUT: quickSetting is required when changing the schedule',
      );
      expect(repeatCfgServiceMock.updateTaskRepeatCfg).not.toHaveBeenCalled();
    });
  });
});
