import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import { LocalRestApiTaskRepeatCfgRoutesService } from './local-rest-api-task-repeat-cfg-routes.service';
import { TaskRepeatCfgService } from './task-repeat-cfg.service';
import {
  DEFAULT_TASK_REPEAT_CFG,
  TaskRepeatCfg,
  TaskRepeatCfgCopy,
} from './task-repeat-cfg.model';
import { TaskService } from '../tasks/task.service';
import { DEFAULT_TASK, Task, TaskReminderOptionId } from '../tasks/task.model';
import { DateService } from '../../core/date/date.service';
import { GlobalConfigService } from '../config/global-config.service';
import { GlobalConfigState } from '../config/global-config.model';
import { DEFAULT_GLOBAL_CONFIG } from '../config/default-global-config.const';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../electron/shared-with-frontend/local-rest-api.model';

describe('LocalRestApiTaskRepeatCfgRoutesService', () => {
  const TODAY = '2026-10-04';

  let service: LocalRestApiTaskRepeatCfgRoutesService;
  let repeatCfgServiceMock: jasmine.SpyObj<TaskRepeatCfgService>;
  let cfgs$: BehaviorSubject<TaskRepeatCfg[]>;
  let tasks: Record<string, Task>;

  const createTask = (id: string, overrides: Partial<Task> = {}): Task => ({
    ...DEFAULT_TASK,
    id,
    title: `Task ${id}`,
    projectId: 'p1',
    ...overrides,
  });

  const createCfg = (
    id: string,
    overrides: Partial<TaskRepeatCfg> = {},
  ): TaskRepeatCfg => ({
    ...DEFAULT_TASK_REPEAT_CFG,
    id,
    projectId: 'p1',
    title: `Cfg ${id}`,
    quickSetting: 'DAILY',
    repeatCycle: 'DAILY',
    startDate: '2026-09-01',
    ...overrides,
  });

  const request = (
    method: string,
    path: string,
    body?: unknown,
    query: Record<string, string> = {},
  ): LocalRestApiRequestPayload => ({
    requestId: 'test-request-id',
    method,
    path,
    query,
    body,
  });

  const handle = async (
    req: LocalRestApiRequestPayload,
  ): Promise<LocalRestApiResponsePayload> => {
    const response = await service.handle(req);
    if (!response) {
      throw new Error(`Route not handled: ${req.method} ${req.path}`);
    }
    return response;
  };

  const errorCode = (response: LocalRestApiResponsePayload): string | undefined =>
    response.body.ok ? undefined : response.body.error.code;

  const data = <T>(response: LocalRestApiResponsePayload): T => {
    if (!response.body.ok) {
      throw new Error(`Expected success, got ${response.body.error.code}`);
    }
    return response.body.data as T;
  };

  /** The cfg passed to the last `addTaskRepeatCfgToTask` call. */
  const createdCfg = (): Omit<TaskRepeatCfgCopy, 'id'> =>
    repeatCfgServiceMock.addTaskRepeatCfgToTask.calls.mostRecent().args[2];

  const expectNoDispatch = (): void => {
    expect(repeatCfgServiceMock.addTaskRepeatCfgToTask).not.toHaveBeenCalled();
    expect(repeatCfgServiceMock.updateTaskRepeatCfg).not.toHaveBeenCalled();
    expect(repeatCfgServiceMock.deleteTaskRepeatCfg).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    tasks = {
      t1: createTask('t1', {
        notes: 'Some notes',
        tagIds: ['tag1', 'tag1', 'tag2'],
        timeEstimate: 900000,
      }),
      due: createTask('due', { dueDay: '2026-10-10' }),
      timed: createTask('timed', {
        dueWithTime: new Date(2026, 9, 6, 9, 30).getTime(),
      }),
      parent: createTask('parent', { subTaskIds: ['sub'] }),
      sub: createTask('sub', { parentId: 'parent' }),
      issue: createTask('issue', { issueId: '42', issueType: 'GITHUB' }),
      repeating: createTask('repeating', { repeatCfgId: 'daily' }),
      noProject: createTask('noProject', { projectId: '' }),
    };

    cfgs$ = new BehaviorSubject<TaskRepeatCfg[]>([
      createCfg('daily'),
      createCfg('lastDay', {
        projectId: 'p2',
        quickSetting: 'MONTHLY_LAST_DAY',
        repeatCycle: 'MONTHLY',
        startDate: '2099-01-31',
        monthlyLastDay: true,
      }),
      createCfg('weekly', {
        quickSetting: 'WEEKLY_CURRENT_WEEKDAY',
        repeatCycle: 'WEEKLY',
        startDate: '2026-10-07',
        monday: false,
        tuesday: false,
        wednesday: true,
        thursday: false,
        friday: false,
        saturday: false,
        sunday: false,
      }),
    ]);

    repeatCfgServiceMock = jasmine.createSpyObj<TaskRepeatCfgService>(
      'TaskRepeatCfgService',
      ['addTaskRepeatCfgToTask', 'updateTaskRepeatCfg', 'deleteTaskRepeatCfg'],
      { taskRepeatCfgs$: cfgs$ },
    );
    repeatCfgServiceMock.addTaskRepeatCfgToTask.and.callFake(
      (_taskId, projectId, cfg) => {
        cfgs$.next([...cfgs$.value, { ...cfg, projectId, id: 'new-cfg' }]);
        return 'new-cfg';
      },
    );
    repeatCfgServiceMock.updateTaskRepeatCfg.and.callFake((id, changes) => {
      cfgs$.next(cfgs$.value.map((c) => (c.id === id ? { ...c, ...changes } : c)));
    });
    repeatCfgServiceMock.deleteTaskRepeatCfg.and.callFake((id) => {
      cfgs$.next(cfgs$.value.filter((c) => c.id !== id));
    });

    const taskServiceMock = jasmine.createSpyObj<TaskService>('TaskService', [
      'getByIdOnce$',
    ]);
    // Like the store's entity lookup: a plain-object map, prototype included.
    taskServiceMock.getByIdOnce$.and.callFake((id: string) =>
      of((tasks as Record<string, Task>)[id]),
    );

    TestBed.configureTestingModule({
      providers: [
        LocalRestApiTaskRepeatCfgRoutesService,
        { provide: TaskRepeatCfgService, useValue: repeatCfgServiceMock },
        { provide: TaskService, useValue: taskServiceMock },
        { provide: DateService, useValue: { todayStr: (): string => TODAY } },
        {
          provide: GlobalConfigService,
          useValue: {
            cfg: signal<GlobalConfigState | undefined>({
              ...DEFAULT_GLOBAL_CONFIG,
              reminder: {
                ...DEFAULT_GLOBAL_CONFIG.reminder,
                defaultTaskRemindOption: TaskReminderOptionId.m10,
              },
            }),
          },
        },
      ],
    });
    service = TestBed.inject(LocalRestApiTaskRepeatCfgRoutesService);
  });

  describe('routing', () => {
    it('does not handle routes it does not own', async () => {
      expect(await service.handle(request('GET', '/tasks'))).toBeUndefined();
      expect(await service.handle(request('PUT', '/task-repeat-cfgs'))).toBeUndefined();
      expect(
        await service.handle(request('POST', '/task-repeat-cfgs/daily')),
      ).toBeUndefined();
      expect(
        await service.handle(request('GET', '/task-repeat-cfgs/daily/tasks')),
      ).toBeUndefined();
    });
  });

  describe('GET /task-repeat-cfgs', () => {
    it('lists all repeat configs', async () => {
      const response = await handle(request('GET', '/task-repeat-cfgs'));

      expect(response.status).toBe(200);
      expect(data<TaskRepeatCfg[]>(response).map((c) => c.id)).toEqual([
        'daily',
        'lastDay',
        'weekly',
      ]);
    });

    it('filters by projectId', async () => {
      const response = await handle(
        request('GET', '/task-repeat-cfgs', undefined, { projectId: 'p2' }),
      );

      expect(data<TaskRepeatCfg[]>(response).map((c) => c.id)).toEqual(['lastDay']);
    });
  });

  describe('GET /task-repeat-cfgs/:id', () => {
    it('returns the repeat config', async () => {
      const response = await handle(request('GET', '/task-repeat-cfgs/weekly'));

      expect(response.status).toBe(200);
      expect(data<TaskRepeatCfg>(response).id).toBe('weekly');
    });

    it('returns 404 for unknown and prototype ids', async () => {
      for (const id of ['missing', '__proto__', 'constructor']) {
        const response = await handle(request('GET', `/task-repeat-cfgs/${id}`));
        expect(response.status).toBe(404);
        expect(errorCode(response)).toBe('REPEAT_CFG_NOT_FOUND');
      }
    });
  });

  describe('POST /task-repeat-cfgs', () => {
    it('makes a task repeat daily by default, like the repeat dialog', async () => {
      const response = await handle(
        request('POST', '/task-repeat-cfgs', { taskId: 't1' }),
      );

      expect(response.status).toBe(201);
      expect(repeatCfgServiceMock.addTaskRepeatCfgToTask).toHaveBeenCalledOnceWith(
        't1',
        'p1',
        jasmine.any(Object),
      );
      expect(createdCfg()).toEqual(
        jasmine.objectContaining({
          quickSetting: 'DAILY',
          repeatCycle: 'DAILY',
          repeatEvery: 1,
          startDate: TODAY,
          startTime: undefined,
          remindAt: undefined,
          isPaused: false,
          skipOverdue: true,
          title: 'Task t1',
          notes: 'Some notes',
          tagIds: ['tag1', 'tag2'],
          defaultEstimate: 900000,
          shouldInheritSubtasks: false,
        }),
      );
      expect(data<TaskRepeatCfg>(response)).toEqual(
        jasmine.objectContaining({ id: 'new-cfg', projectId: 'p1' }),
      );
    });

    it("starts on the task's day", async () => {
      await handle(request('POST', '/task-repeat-cfgs', { taskId: 'due' }));

      expect(createdCfg().startDate).toBe('2026-10-10');
    });

    it("takes over the task's time with the default reminder", async () => {
      await handle(request('POST', '/task-repeat-cfgs', { taskId: 'timed' }));

      expect(createdCfg()).toEqual(
        jasmine.objectContaining({
          startDate: '2026-10-06',
          startTime: '9:30',
          remindAt: TaskReminderOptionId.m10,
        }),
      );
    });

    it('inherits subtasks of a parent task', async () => {
      await handle(request('POST', '/task-repeat-cfgs', { taskId: 'parent' }));

      expect(createdCfg().shouldInheritSubtasks).toBe(true);
    });

    it('passes null for a task without project', async () => {
      await handle(request('POST', '/task-repeat-cfgs', { taskId: 'noProject' }));

      expect(repeatCfgServiceMock.addTaskRepeatCfgToTask.calls.mostRecent().args[1]).toBe(
        null,
      );
    });

    it('expands a preset for the given start date', async () => {
      await handle(
        request('POST', '/task-repeat-cfgs', {
          taskId: 't1',
          quickSetting: 'WEEKLY_CURRENT_WEEKDAY',
          startDate: '2099-03-12',
        }),
      );

      expect(createdCfg()).toEqual(
        jasmine.objectContaining({
          quickSetting: 'WEEKLY_CURRENT_WEEKDAY',
          repeatCycle: 'WEEKLY',
          startDate: '2099-03-12',
          monday: false,
          thursday: true,
          friday: false,
          // Only an everyday schedule skips overdue instances by default.
          skipOverdue: false,
        }),
      );
    });

    it('takes a custom schedule', async () => {
      await handle(
        request('POST', '/task-repeat-cfgs', {
          taskId: 't1',
          quickSetting: 'CUSTOM',
          repeatCycle: 'WEEKLY',
          repeatEvery: 2,
          monday: false,
          tuesday: true,
          wednesday: false,
          thursday: false,
          friday: false,
        }),
      );

      expect(createdCfg()).toEqual(
        jasmine.objectContaining({
          quickSetting: 'CUSTOM',
          repeatCycle: 'WEEKLY',
          repeatEvery: 2,
          monday: false,
          tuesday: true,
          skipOverdue: false,
        }),
      );
    });

    it('honours explicit isPaused and skipOverdue', async () => {
      await handle(
        request('POST', '/task-repeat-cfgs', {
          taskId: 't1',
          isPaused: true,
          skipOverdue: false,
        }),
      );

      expect(createdCfg()).toEqual(
        jasmine.objectContaining({ isPaused: true, skipOverdue: false }),
      );
    });

    it('rejects a weekly custom schedule without weekdays', async () => {
      const response = await handle(
        request('POST', '/task-repeat-cfgs', {
          taskId: 't1',
          quickSetting: 'CUSTOM',
          repeatCycle: 'WEEKLY',
          monday: false,
          tuesday: false,
          wednesday: false,
          thursday: false,
          friday: false,
        }),
      );

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('INVALID_INPUT');
      expectNoDispatch();
    });

    it('rejects custom schedule fields with a preset', async () => {
      const response = await handle(
        request('POST', '/task-repeat-cfgs', { taskId: 't1', repeatEvery: 3 }),
      );

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('INVALID_INPUT');
      expectNoDispatch();
    });

    it('rejects invalid repeatEvery values', async () => {
      for (const repeatEvery of [0, 1.5, 1001, -1]) {
        const response = await handle(
          request('POST', '/task-repeat-cfgs', {
            taskId: 't1',
            quickSetting: 'CUSTOM',
            repeatCycle: 'DAILY',
            repeatEvery,
          }),
        );
        expect(errorCode(response)).toBe('INVALID_INPUT');
      }
      expectNoDispatch();
    });

    it('rejects invalid start dates and start dates in the past', async () => {
      for (const startDate of ['2026-02-30', 'tomorrow', '2026-10-03']) {
        const response = await handle(
          request('POST', '/task-repeat-cfgs', { taskId: 't1', startDate }),
        );
        expect(errorCode(response)).toBe('INVALID_INPUT');
      }
      const beforeDueDay = await handle(
        request('POST', '/task-repeat-cfgs', { taskId: 'due', startDate: '2026-10-09' }),
      );
      expect(errorCode(beforeDueDay)).toBe('INVALID_INPUT');
      expectNoDispatch();
    });

    it('rejects a preset that moves the start date past 9999', async () => {
      const response = await handle(
        request('POST', '/task-repeat-cfgs', {
          taskId: 't1',
          quickSetting: 'MONTHLY_FIRST_DAY',
          startDate: '9999-12-15',
        }),
      );

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('INVALID_INPUT');
      expectNoDispatch();
    });

    it('rejects tasks the repeat dialog does not offer repeating for', async () => {
      for (const taskId of ['sub', 'issue', 'repeating']) {
        const response = await handle(request('POST', '/task-repeat-cfgs', { taskId }));
        expect(response.status).toBe(400);
        expect(errorCode(response)).toBe('INVALID_INPUT');
      }
      expectNoDispatch();
    });

    it('returns 404 for unknown and prototype task ids', async () => {
      for (const taskId of ['missing', '__proto__', 'constructor']) {
        const response = await handle(request('POST', '/task-repeat-cfgs', { taskId }));
        expect(response.status).toBe(404);
        expect(errorCode(response)).toBe('TASK_NOT_FOUND');
      }
      expectNoDispatch();
    });

    it('rejects unsupported fields', async () => {
      const response = await handle(
        request('POST', '/task-repeat-cfgs', {
          taskId: 't1',
          title: 'Other',
          lastTaskCreationDay: '2026-01-01',
        }),
      );

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('UNSUPPORTED_FIELD');
      expect(response.body.ok ? undefined : response.body.error.details).toEqual({
        fields: ['title', 'lastTaskCreationDay'],
      });
      expectNoDispatch();
    });

    it('rejects invalid types and bodies', async () => {
      for (const body of [
        undefined,
        [],
        'x',
        {},
        { taskId: 1 },
        { taskId: 't1', quickSetting: 'HOURLY' },
        { taskId: 't1', quickSetting: 'CUSTOM', repeatCycle: 'HOURLY' },
        { taskId: 't1', isPaused: 'yes' },
      ]) {
        const response = await handle(request('POST', '/task-repeat-cfgs', body));
        expect(response.status).toBe(400);
        expect(errorCode(response)).toBe('INVALID_INPUT');
      }
      expectNoDispatch();
    });
  });

  describe('PATCH /task-repeat-cfgs/:id', () => {
    it('pauses without asking to update all instances', async () => {
      const response = await handle(
        request('PATCH', '/task-repeat-cfgs/daily', { isPaused: true }),
      );

      expect(response.status).toBe(200);
      expect(repeatCfgServiceMock.updateTaskRepeatCfg).toHaveBeenCalledOnceWith(
        'daily',
        { isPaused: true },
        false,
      );
      expect(data<TaskRepeatCfg>(response).isPaused).toBe(true);
    });

    it('sends only the schedule fields that change', async () => {
      await handle(
        request('PATCH', '/task-repeat-cfgs/weekly', {
          quickSetting: 'WEEKLY_CURRENT_WEEKDAY',
          startDate: '2099-03-12',
        }),
      );

      expect(repeatCfgServiceMock.updateTaskRepeatCfg).toHaveBeenCalledOnceWith(
        'weekly',
        { startDate: '2099-03-12', wednesday: false, thursday: true },
        false,
      );
    });

    it('drops the last-day anchor when leaving its preset', async () => {
      await handle(
        request('PATCH', '/task-repeat-cfgs/lastDay', {
          quickSetting: 'CUSTOM',
          repeatCycle: 'MONTHLY',
        }),
      );

      expect(repeatCfgServiceMock.updateTaskRepeatCfg).toHaveBeenCalledOnceWith(
        'lastDay',
        { quickSetting: 'CUSTOM', monthlyLastDay: undefined },
        false,
      );
    });

    it('requires quickSetting with any schedule field', async () => {
      const response = await handle(
        request('PATCH', '/task-repeat-cfgs/daily', { startDate: '2099-01-01' }),
      );

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('INVALID_INPUT');
      expectNoDispatch();
    });

    it('allows a past start date on an existing config, as the dialog does', async () => {
      await handle(
        request('PATCH', '/task-repeat-cfgs/daily', {
          quickSetting: 'DAILY',
          startDate: '2026-01-01',
        }),
      );

      expect(repeatCfgServiceMock.updateTaskRepeatCfg).toHaveBeenCalledOnceWith(
        'daily',
        { startDate: '2026-01-01' },
        false,
      );
    });

    it('rejects start dates a preset cannot expand', async () => {
      for (const startDate of ['0099-01-01', '0999-12-31']) {
        const response = await handle(
          request('PATCH', '/task-repeat-cfgs/daily', {
            quickSetting: 'MONTHLY_CURRENT_DATE',
            startDate,
          }),
        );
        expect(response.status).toBe(400);
        expect(errorCode(response)).toBe('INVALID_INPUT');
      }
      const pastLastYear = await handle(
        request('PATCH', '/task-repeat-cfgs/daily', {
          quickSetting: 'MONTHLY_FIRST_DAY',
          startDate: '9999-12-15',
        }),
      );
      expect(pastLastYear.status).toBe(400);
      expect(errorCode(pastLastYear)).toBe('INVALID_INPUT');
      expectNoDispatch();
    });

    it('expands a preset for the earliest supported start date', async () => {
      await handle(
        request('PATCH', '/task-repeat-cfgs/daily', {
          quickSetting: 'MONTHLY_CURRENT_DATE',
          startDate: '1000-01-01',
        }),
      );

      expect(repeatCfgServiceMock.updateTaskRepeatCfg).toHaveBeenCalledOnceWith(
        'daily',
        jasmine.objectContaining({ repeatCycle: 'MONTHLY', startDate: '1000-01-01' }),
        false,
      );
    });

    it('does not dispatch when nothing changes', async () => {
      const response = await handle(
        request('PATCH', '/task-repeat-cfgs/daily', {
          quickSetting: 'DAILY',
          isPaused: false,
        }),
      );

      expect(response.status).toBe(200);
      expectNoDispatch();
    });

    it('rejects unsupported fields and invalid types', async () => {
      const unsupported = await handle(
        request('PATCH', '/task-repeat-cfgs/daily', { taskId: 't1' }),
      );
      expect(errorCode(unsupported)).toBe('UNSUPPORTED_FIELD');

      const invalid = await handle(
        request('PATCH', '/task-repeat-cfgs/daily', { skipOverdue: 1 }),
      );
      expect(errorCode(invalid)).toBe('INVALID_INPUT');
      expectNoDispatch();
    });

    it('returns 404 for unknown and prototype ids', async () => {
      for (const id of ['missing', '__proto__']) {
        const response = await handle(
          request('PATCH', `/task-repeat-cfgs/${id}`, { isPaused: true }),
        );
        expect(response.status).toBe(404);
        expect(errorCode(response)).toBe('REPEAT_CFG_NOT_FOUND');
      }
      expectNoDispatch();
    });
  });

  describe('DELETE /task-repeat-cfgs/:id', () => {
    it('deletes the repeat config', async () => {
      const response = await handle(request('DELETE', '/task-repeat-cfgs/daily'));

      expect(response.status).toBe(200);
      expect(data<unknown>(response)).toEqual({ deleted: true, id: 'daily' });
      expect(repeatCfgServiceMock.deleteTaskRepeatCfg).toHaveBeenCalledOnceWith('daily');
    });

    it('returns 404 for unknown and prototype ids', async () => {
      for (const id of ['missing', '__proto__']) {
        const response = await handle(request('DELETE', `/task-repeat-cfgs/${id}`));
        expect(response.status).toBe(404);
        expect(errorCode(response)).toBe('REPEAT_CFG_NOT_FOUND');
      }
      expectNoDispatch();
    });
  });
});
