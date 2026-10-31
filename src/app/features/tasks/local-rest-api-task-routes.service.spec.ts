import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';
import { LocalRestApiTaskRoutesService } from './local-rest-api-task-routes.service';
import { TaskService } from './task.service';
import { TaskArchiveService } from '../archive/task-archive.service';
import { ProjectService } from '../project/project.service';
import { Project } from '../project/project.model';
import { IssueLog } from '../../core/log';
import { LocalRestApiFeatureBridgeService } from './local-rest-api-feature-bridge.service';
import { TODAY_TAG } from '../tag/tag.const';
import { DateService } from '../../core/date/date.service';
import { Task, TaskWithSubTasks, TaskArchive } from './task.model';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../electron/shared-with-frontend/local-rest-api.model';
import { ArchiveOperationHandler } from '../../op-log/apply/archive-operation-handler.service';

describe('LocalRestApiTaskRoutesService', () => {
  let service: LocalRestApiTaskRoutesService;
  let taskServiceMock: jasmine.SpyObj<TaskService>;
  let taskArchiveServiceMock: jasmine.SpyObj<TaskArchiveService>;
  let archiveOperationHandlerMock: jasmine.SpyObj<ArchiveOperationHandler>;
  let projectServiceMock: jasmine.SpyObj<ProjectService>;
  let dateServiceMock: jasmine.SpyObj<DateService>;
  let featureBridgeMock: jasmine.SpyObj<LocalRestApiFeatureBridgeService>;
  let store: MockStore;
  let dispatchSpy: jasmine.Spy;
  let activeProjects: Project[];

  const createMockTask = (id: string, overrides: Partial<Task> = {}): Task =>
    ({
      id,
      title: `Task ${id}`,
      notes: '',
      isDone: false,
      projectId: 'INBOX_PROJECT',
      tagIds: [],
      subTaskIds: [],
      timeEstimate: 0,
      timeSpent: 0,
      timeSpentOnDay: {},
      created: Date.now(),
      ...overrides,
    }) as Task;

  const createMockTaskWithSubTasks = (
    task: Task,
    subTasks: Task[] = [],
  ): TaskWithSubTasks => ({
    ...task,
    subTasks,
  });

  const createRequest = (
    method: string,
    path: string,
    options: {
      body?: unknown;
      query?: Record<string, string | string[]>;
    } = {},
  ): LocalRestApiRequestPayload => ({
    requestId: 'test-request-id',
    method,
    path,
    query: options.query || {},
    body: options.body,
  });

  // The routes answer directly; the router's IPC round trip has its own spec.
  const sendRequestAndWait = async (
    request: LocalRestApiRequestPayload,
  ): Promise<LocalRestApiResponsePayload> => {
    const response = await service.handle(request);
    if (!response) {
      throw new Error(`No task route answered ${request.method} ${request.path}`);
    }
    return response;
  };

  const expectTaskIds = (
    response: LocalRestApiResponsePayload,
    expectedIds: string[],
  ): void => {
    expect(response.body.ok).toBe(true);
    if (!response.body.ok) {
      throw new Error(`Expected success response, got ${response.body.error.code}`);
    }
    expect((response.body.data as Task[]).map((task) => task.id)).toEqual(expectedIds);
  };

  beforeEach(() => {
    activeProjects = [];

    taskServiceMock = jasmine.createSpyObj(
      'TaskService',
      [
        'add',
        'addSubTaskTo',
        'update',
        'remove',
        'setCurrentId',
        'moveToArchive',
        'restoreTask',
        'getAllTasksEverywhere',
      ],
      {
        allTasks$: of([]),
        currentTask$: of(null),
        getByIdOnce$: (_id: string) => of(undefined),
        getByIdWithSubTaskData$: (_id: string) => of(undefined),
      },
    );
    (taskServiceMock as any).add.and.returnValue('new-task-id');
    (taskServiceMock as any).addSubTaskTo.and.returnValue('new-subtask-id');

    taskArchiveServiceMock = jasmine.createSpyObj(
      'TaskArchiveService',
      ['load', 'getById', 'hasTask'],
      {},
    );
    (taskArchiveServiceMock as any).load.and.returnValue(
      Promise.resolve({ ids: [], entities: {} } as TaskArchive),
    );
    (taskArchiveServiceMock as any).hasTask.and.returnValue(Promise.resolve(false));

    archiveOperationHandlerMock = jasmine.createSpyObj<ArchiveOperationHandler>(
      'ArchiveOperationHandler',
      ['whenLocalOperationsSettled'],
    );
    archiveOperationHandlerMock.whenLocalOperationsSettled.and.returnValue(
      Promise.resolve(),
    );

    projectServiceMock = jasmine.createSpyObj(
      'ProjectService',
      ['add', 'update', 'remove', 'archive'],
      {
        list$: of([]),
        archived$: of([]),
      },
    );
    Object.defineProperty(projectServiceMock, 'list', {
      value: (() => activeProjects) as ProjectService['list'],
    });

    dateServiceMock = jasmine.createSpyObj<DateService>(
      'DateService',
      ['todayStr', 'getStartOfNextDayDiffMs'],
      {},
    );
    dateServiceMock.todayStr.and.returnValue('2026-05-12');
    dateServiceMock.getStartOfNextDayDiffMs.and.returnValue(0);

    featureBridgeMock = jasmine.createSpyObj<LocalRestApiFeatureBridgeService>(
      'LocalRestApiFeatureBridgeService',
      [
        'issueLink',
        'addLiteralSubTask',
        'addTimeSpentOnDay',
        'moveTaskToProject',
        'updateTaskWithDueTime',
      ],
    );
    featureBridgeMock.issueLink.and.returnValue(Promise.resolve(''));

    TestBed.configureTestingModule({
      providers: [
        LocalRestApiTaskRoutesService,
        { provide: TaskService, useValue: taskServiceMock },
        { provide: TaskArchiveService, useValue: taskArchiveServiceMock },
        { provide: ArchiveOperationHandler, useValue: archiveOperationHandlerMock },
        { provide: ProjectService, useValue: projectServiceMock },
        { provide: DateService, useValue: dateServiceMock },
        { provide: LocalRestApiFeatureBridgeService, useValue: featureBridgeMock },
        provideMockStore(),
      ],
    });

    service = TestBed.inject(LocalRestApiTaskRoutesService);
    store = TestBed.inject(MockStore);
    dispatchSpy = spyOn(store, 'dispatch');
  });

  describe('GET /status', () => {
    it('should return status with current task info', async () => {
      const mockTask = createMockTask('task-1');
      Object.defineProperty(taskServiceMock, 'currentTask$', { get: () => of(mockTask) });
      Object.defineProperty(taskServiceMock, 'allTasks$', { get: () => of([mockTask]) });

      const response = await sendRequestAndWait(createRequest('GET', '/status'));

      expect(response.body.ok).toBe(true);
      expect(response.status).toBe(200);
    });
  });

  describe('task routes', () => {
    describe('GET /tasks', () => {
      it('should return all active tasks by default', async () => {
        const tasks = [createMockTask('task-1'), createMockTask('task-2')];
        Object.defineProperty(taskServiceMock, 'allTasks$', { get: () => of(tasks) });

        const response = await sendRequestAndWait(createRequest('GET', '/tasks'));

        expect(response.body.ok).toBe(true);
        expect(response.status).toBe(200);
        expectTaskIds(response, ['task-1', 'task-2']);
      });

      it('should leave out tasks of archived projects by default', async () => {
        const tasks = [
          createMockTask('task-1', { projectId: 'live' }),
          createMockTask('task-2', { projectId: 'shelved' }),
        ];
        Object.defineProperty(taskServiceMock, 'allTasks$', { get: () => of(tasks) });
        Object.defineProperty(projectServiceMock, 'archived$', {
          get: () => of([{ id: 'shelved', isArchived: true } as Project]),
        });

        const response = await sendRequestAndWait(createRequest('GET', '/tasks'));

        expectTaskIds(response, ['task-1']);
      });

      it('should filter tasks by query', async () => {
        const tasks = [
          createMockTask('task-1', { title: 'Buy milk' }),
          createMockTask('task-2', { title: 'Walk dog' }),
        ];
        Object.defineProperty(taskServiceMock, 'allTasks$', { get: () => of(tasks) });

        const response = await sendRequestAndWait(
          createRequest('GET', '/tasks', { query: { query: 'milk' } }),
        );

        expectTaskIds(response, ['task-1']);
      });

      it('should filter tasks by projectId', async () => {
        const tasks = [
          createMockTask('task-1', { projectId: 'project-1' }),
          createMockTask('task-2', { projectId: 'project-2' }),
        ];
        Object.defineProperty(taskServiceMock, 'allTasks$', { get: () => of(tasks) });

        const response = await sendRequestAndWait(
          createRequest('GET', '/tasks', { query: { projectId: 'project-1' } }),
        );

        expectTaskIds(response, ['task-1']);
      });

      it('should filter tasks by tagId', async () => {
        const tasks = [
          createMockTask('task-1', { tagIds: ['tag-1'] }),
          createMockTask('task-2', { tagIds: ['tag-2'] }),
        ];
        Object.defineProperty(taskServiceMock, 'allTasks$', { get: () => of(tasks) });

        const response = await sendRequestAndWait(
          createRequest('GET', '/tasks', { query: { tagId: 'tag-1' } }),
        );

        expectTaskIds(response, ['task-1']);
      });

      it('should filter tasks by the virtual TODAY tag using dueDay', async () => {
        const tasks = [
          createMockTask('task-1', { dueDay: '2026-05-12' }),
          createMockTask('task-2', { dueDay: '2026-05-13' }),
          createMockTask('task-3', { dueDay: '2026-05-11' }),
          createMockTask('task-4'),
        ];
        Object.defineProperty(taskServiceMock, 'allTasks$', { get: () => of(tasks) });

        const response = await sendRequestAndWait(
          createRequest('GET', '/tasks', { query: { tagId: TODAY_TAG.id } }),
        );

        expectTaskIds(response, ['task-1']);
      });

      it('should combine the virtual TODAY tag filter with projectId and query', async () => {
        const tasks = [
          createMockTask('task-1', {
            title: 'Buy milk',
            projectId: 'project-1',
            dueDay: '2026-05-12',
          }),
          createMockTask('task-2', {
            title: 'Buy bread',
            projectId: 'project-2',
            dueDay: '2026-05-12',
          }),
          createMockTask('task-3', {
            title: 'Walk dog',
            projectId: 'project-1',
            dueDay: '2026-05-12',
          }),
        ];
        Object.defineProperty(taskServiceMock, 'allTasks$', { get: () => of(tasks) });

        const response = await sendRequestAndWait(
          createRequest('GET', '/tasks', {
            query: { tagId: TODAY_TAG.id, projectId: 'project-1', query: 'milk' },
          }),
        );

        expectTaskIds(response, ['task-1']);
      });

      it('should include done virtual TODAY tasks when includeDone=true', async () => {
        const tasks = [
          createMockTask('task-1', { dueDay: '2026-05-12', isDone: false }),
          createMockTask('task-2', { dueDay: '2026-05-12', isDone: true }),
        ];
        Object.defineProperty(taskServiceMock, 'allTasks$', { get: () => of(tasks) });

        const response = await sendRequestAndWait(
          createRequest('GET', '/tasks', {
            query: { tagId: TODAY_TAG.id, includeDone: 'true' },
          }),
        );

        expectTaskIds(response, ['task-1', 'task-2']);
      });

      it('should filter virtual TODAY tasks by dueWithTime and start-of-next-day offset', async () => {
        dateServiceMock.todayStr.and.returnValue('2026-02-15');
        dateServiceMock.getStartOfNextDayDiffMs.and.returnValue(4 * 60 * 60 * 1000);
        const tasks = [
          createMockTask('task-1', {
            dueWithTime: new Date(2026, 1, 16, 2, 0).getTime(),
          }),
          createMockTask('task-2', {
            dueWithTime: new Date(2026, 1, 16, 5, 0).getTime(),
          }),
        ];
        Object.defineProperty(taskServiceMock, 'allTasks$', { get: () => of(tasks) });

        const response = await sendRequestAndWait(
          createRequest('GET', '/tasks', { query: { tagId: TODAY_TAG.id } }),
        );

        expectTaskIds(response, ['task-1']);
      });

      it('should let dueWithTime take priority over dueDay for the virtual TODAY tag', async () => {
        const tasks = [
          createMockTask('task-1', {
            dueDay: '2026-05-12',
            dueWithTime: new Date(2026, 4, 13, 10, 0).getTime(),
          }),
          createMockTask('task-2', {
            dueDay: '2026-05-12',
          }),
        ];
        Object.defineProperty(taskServiceMock, 'allTasks$', { get: () => of(tasks) });

        const response = await sendRequestAndWait(
          createRequest('GET', '/tasks', { query: { tagId: TODAY_TAG.id } }),
        );

        expectTaskIds(response, ['task-2']);
      });

      it('should not fail the virtual TODAY filter for invalid dueWithTime values', async () => {
        const tasks = [
          createMockTask('task-1', {
            dueDay: '2026-05-12',
            dueWithTime: -1,
          }),
          createMockTask('task-2', {
            dueWithTime: -1,
          }),
          createMockTask('task-3', {
            dueDay: '2026-05-12',
            dueWithTime: 8_640_000_000_000_001,
          }),
          createMockTask('task-4', {
            dueWithTime: 8_640_000_000_000_001,
          }),
        ];
        Object.defineProperty(taskServiceMock, 'allTasks$', { get: () => of(tasks) });

        const response = await sendRequestAndWait(
          createRequest('GET', '/tasks', { query: { tagId: TODAY_TAG.id } }),
        );

        expectTaskIds(response, ['task-1', 'task-3']);
      });

      it('should filter TODAY virtual tag by due fields', async () => {
        // Noon UTC on 2026-05-12 — resolves to 2026-05-12 in both Europe/Berlin
        // (UTC+2 DST) and America/Los_Angeles (UTC-7 DST) test timezones.
        const dueTimeToday = new Date('2026-05-12T12:00:00Z').getTime();
        const tasks = [
          createMockTask('due-day', { dueDay: '2026-05-12' }),
          createMockTask('due-time', { dueWithTime: dueTimeToday }),
          createMockTask('normal-tag', { tagIds: [TODAY_TAG.id] }),
          createMockTask('tomorrow', { dueDay: '2026-05-13' }),
        ];
        Object.defineProperty(taskServiceMock, 'allTasks$', { get: () => of(tasks) });

        const response = await sendRequestAndWait(
          createRequest('GET', '/tasks', { query: { tagId: TODAY_TAG.id } }),
        );

        expect(response.body.ok).toBe(true);
        expect(
          ((response.body as { data: Task[] }).data || []).map((task) => task.id),
        ).toEqual(['due-day', 'due-time']);
      });

      it('should exclude done tasks by default', async () => {
        const tasks = [
          createMockTask('task-1', { isDone: false }),
          createMockTask('task-2', { isDone: true }),
        ];
        Object.defineProperty(taskServiceMock, 'allTasks$', { get: () => of(tasks) });

        const response = await sendRequestAndWait(createRequest('GET', '/tasks'));

        expectTaskIds(response, ['task-1']);
      });

      it('should include done tasks when includeDone=true', async () => {
        const tasks = [
          createMockTask('task-1', { isDone: false }),
          createMockTask('task-2', { isDone: true }),
        ];
        Object.defineProperty(taskServiceMock, 'allTasks$', { get: () => of(tasks) });

        const response = await sendRequestAndWait(
          createRequest('GET', '/tasks', { query: { includeDone: 'true' } }),
        );

        expectTaskIds(response, ['task-1', 'task-2']);
      });

      it('should return archived tasks when source=archived', async () => {
        const archivedTask = createMockTask('archivedTask1');
        (taskArchiveServiceMock as any).load.and.returnValue(
          Promise.resolve({
            ids: ['archivedTask1'],
            entities: { archivedTask1: archivedTask },
          } as TaskArchive),
        );

        const response = await sendRequestAndWait(
          createRequest('GET', '/tasks', { query: { source: 'archived' } }),
        );

        expect(response.body.ok).toBe(true);
        expectTaskIds(response, ['archivedTask1']);
        expect(taskArchiveServiceMock.load).toHaveBeenCalled();
      });

      it('should return all tasks when source=all', async () => {
        (taskServiceMock as any).getAllTasksEverywhere.and.returnValue(
          Promise.resolve([
            createMockTask('task-1'),
            createMockTask('archivedTask1', { isDone: true }),
          ]),
        );

        const response = await sendRequestAndWait(
          createRequest('GET', '/tasks', { query: { source: 'all' } }),
        );

        expect(response.body.ok).toBe(true);
        expectTaskIds(response, ['task-1']);
        expect(taskServiceMock.getAllTasksEverywhere).toHaveBeenCalled();
      });
    });

    describe('POST /tasks', () => {
      it('should create a task with valid input', async () => {
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(createMockTask('new-task-id')),
        });

        const response = await sendRequestAndWait(
          createRequest('POST', '/tasks', { body: { title: 'New Task' } }),
        );

        expect(response.body.ok).toBe(true);
        expect(response.status).toBe(201);
        expect(taskServiceMock.add).toHaveBeenCalledWith(
          'New Task',
          false,
          jasmine.any(Object),
        );
      });

      it('should map plannedAt to dueWithTime when creating a task', async () => {
        const plannedAt = new Date('2026-07-12T10:00:00Z').getTime();
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(createMockTask('new-task-id')),
        });

        await sendRequestAndWait(
          createRequest('POST', '/tasks', {
            body: { title: 'New Task', plannedAt },
          }),
        );

        expect(taskServiceMock.add).toHaveBeenCalledWith('New Task', false, {
          title: 'New Task',
          dueWithTime: plannedAt,
        });
      });

      it('should let dueWithTime override plannedAt when creating a task', async () => {
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(createMockTask('new-task-id')),
        });

        await sendRequestAndWait(
          createRequest('POST', '/tasks', {
            body: { title: 'New Task', plannedAt: 1, dueWithTime: 2 },
          }),
        );

        expect(taskServiceMock.add).toHaveBeenCalledWith('New Task', false, {
          title: 'New Task',
          dueWithTime: 2,
        });
      });

      it('should report invalid plannedAt input on create', async () => {
        const response = await sendRequestAndWait(
          createRequest('POST', '/tasks', {
            body: { title: 'New Task', plannedAt: 'not-a-number' },
          }),
        );

        expect(response.body.ok).toBe(false);
        expect(response.status).toBe(400);
        expect((response.body as any).error.details).toContain(
          jasmine.objectContaining({ path: '$input.plannedAt' }),
        );
        expect(taskServiceMock.add).not.toHaveBeenCalled();
      });

      it('should set a deadline after creating the task and then read the response', async () => {
        const taskLookup = jasmine.createSpy('taskLookup').and.callFake(() => {
          expect(dispatchSpy).toHaveBeenCalled();
          return of(createMockTask('new-task-id', { deadlineDay: '2026-05-12' }));
        });
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => taskLookup,
        });

        const response = await sendRequestAndWait(
          createRequest('POST', '/tasks', {
            body: {
              title: 'Deadline task',
              notes: 'created through REST',
              deadlineDay: '2026-05-12',
            },
          }),
        );

        expect(taskServiceMock.add).toHaveBeenCalledWith('Deadline task', false, {
          title: 'Deadline task',
          notes: 'created through REST',
        });
        expect(dispatchSpy).toHaveBeenCalledOnceWith(
          TaskSharedActions.setDeadline({
            taskId: 'new-task-id',
            deadlineDay: '2026-05-12',
            autoPlanToday: '2026-05-12',
            autoPlanStartOfNextDayDiffMs: 0,
            isSkipSnack: true,
          }),
        );
        expect(response.body.ok).toBe(true);
        if (!response.body.ok) {
          throw new Error('Expected a success response');
        }
        expect(response.body.data).toEqual(
          jasmine.objectContaining({ deadlineDay: '2026-05-12' }),
        );
      });

      it('should not dispatch a deadline removal for all-null deadline fields', async () => {
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(createMockTask('new-task-id')),
        });

        const response = await sendRequestAndWait(
          createRequest('POST', '/tasks', {
            body: {
              title: 'Task without deadline',
              deadlineDay: null,
              deadlineWithTime: null,
              deadlineRemindAt: null,
            },
          }),
        );

        expect(response.status).toBe(201);
        expect(dispatchSpy).not.toHaveBeenCalled();
      });

      it('should reject conflicting deadline fields on create', async () => {
        const response = await sendRequestAndWait(
          createRequest('POST', '/tasks', {
            body: {
              title: 'Invalid deadline',
              deadlineDay: '2026-05-12',
              deadlineWithTime: 1_778_582_400_000,
            },
          }),
        );

        expect(response.status).toBe(400);
        expect(response.body.ok).toBe(false);
        if (response.body.ok) {
          throw new Error('Expected an error response');
        }
        expect(response.body.error.code).toBe('INVALID_INPUT');
        expect(taskServiceMock.add).not.toHaveBeenCalled();
      });

      it('should return 400 for missing title', async () => {
        const response = await sendRequestAndWait(
          createRequest('POST', '/tasks', { body: { notes: 'some notes' } }),
        );

        expect(response.body.ok).toBe(false);
        expect(response.status).toBe(400);
        expect((response.body as any).error.code).toBe('INVALID_INPUT');
      });

      it('should return 400 for empty title', async () => {
        const response = await sendRequestAndWait(
          createRequest('POST', '/tasks', { body: { title: '   ' } }),
        );

        expect(response.body.ok).toBe(false);
        expect(response.status).toBe(400);
      });

      it('should strip disallowed fields from the body', async () => {
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(createMockTask('new-task-id')),
        });

        await sendRequestAndWait(
          createRequest('POST', '/tasks', {
            body: {
              title: 'New Task',
              notes: 'allowed',
              id: 'injected-id',
            },
          }),
        );

        expect(taskServiceMock.add).toHaveBeenCalledWith('New Task', false, {
          title: 'New Task',
          notes: 'allowed',
        });
      });

      it('should pass a priority to the new task', async () => {
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(createMockTask('new-task-id')),
        });

        await sendRequestAndWait(
          createRequest('POST', '/tasks', {
            body: { title: 'New Task', priority: 2 },
          }),
        );

        expect(taskServiceMock.add).toHaveBeenCalledWith('New Task', false, {
          title: 'New Task',
          priority: 2,
        });
      });

      it('should return 400 for an unknown priority on create', async () => {
        const response = await sendRequestAndWait(
          createRequest('POST', '/tasks', {
            body: { title: 'New Task', priority: 'high' },
          }),
        );

        expect(response.status).toBe(400);
        expect((response.body as any).error.code).toBe('INVALID_INPUT');
        expect(taskServiceMock.add).not.toHaveBeenCalled();
      });

      it('should return 400 when an allowed field has an invalid type', async () => {
        const response = await sendRequestAndWait(
          createRequest('POST', '/tasks', {
            body: { title: 'New Task', timeEstimate: 'not-a-number' },
          }),
        );

        expect(response.body.ok).toBe(false);
        expect(response.status).toBe(400);
        expect((response.body as any).error.code).toBe('INVALID_INPUT');
        expect(taskServiceMock.add).not.toHaveBeenCalled();
      });

      it('should reject subTaskIds in body with 400', async () => {
        const response = await sendRequestAndWait(
          createRequest('POST', '/tasks', {
            body: { title: 'New Task', subTaskIds: ['s1'] },
          }),
        );

        expect(response.body.ok).toBe(false);
        expect(response.status).toBe(400);
        expect((response.body as any).error.code).toBe('UNSUPPORTED_FIELD');
        expect(taskServiceMock.add).not.toHaveBeenCalled();
      });

      describe('isIgnoreShortSyntax', () => {
        beforeEach(() => {
          Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
            get: () => (id: string) =>
              id === 'parent-1'
                ? of(createMockTask('parent-1', { projectId: 'project-1' }))
                : of(createMockTask(id)),
          });
        });

        it('should store a top-level title literally when asked', async () => {
          await sendRequestAndWait(
            createRequest('POST', '/tasks', {
              body: { title: 'Fix #12 in 30m', isIgnoreShortSyntax: true },
            }),
          );

          expect(taskServiceMock.add).toHaveBeenCalledWith(
            'Fix #12 in 30m',
            false,
            { title: 'Fix #12 in 30m' },
            false,
            true,
          );
        });

        it('should create a literal subtask without the parsing path', async () => {
          featureBridgeMock.addLiteralSubTask.and.returnValue('literal-sub');

          const response = await sendRequestAndWait(
            createRequest('POST', '/tasks', {
              body: {
                title: 'Child #x',
                parentId: 'parent-1',
                isIgnoreShortSyntax: true,
              },
            }),
          );

          expect(response.status).toBe(201);
          expect(taskServiceMock.addSubTaskTo).not.toHaveBeenCalled();
          expect(featureBridgeMock.addLiteralSubTask).toHaveBeenCalledOnceWith(
            'parent-1',
            { title: 'Child #x' },
          );
          expect((response.body as any).data.id).toBe('literal-sub');
        });

        it('should reject a non-boolean flag', async () => {
          const response = await sendRequestAndWait(
            createRequest('POST', '/tasks', {
              body: { title: 'T', isIgnoreShortSyntax: 'yes' },
            }),
          );

          expect(response.status).toBe(400);
          expect(taskServiceMock.add).not.toHaveBeenCalled();
        });

        it('should update a title literally when asked', async () => {
          await sendRequestAndWait(
            createRequest('PATCH', '/tasks/task-1', {
              body: { title: 'Renamed #tag', isIgnoreShortSyntax: true },
            }),
          );

          expect(taskServiceMock.update).not.toHaveBeenCalled();
          expect(dispatchSpy).toHaveBeenCalledOnceWith(
            TaskSharedActions.updateTask({
              task: { id: 'task-1', changes: { title: 'Renamed #tag' } },
              isIgnoreShortSyntax: true,
            }),
          );
        });

        it('should reject a non-boolean flag on PATCH', async () => {
          const response = await sendRequestAndWait(
            createRequest('PATCH', '/tasks/task-1', {
              body: { title: 'T', isIgnoreShortSyntax: 1 },
            }),
          );

          expect(response.status).toBe(400);
          expect(taskServiceMock.update).not.toHaveBeenCalled();
          expect(dispatchSpy).not.toHaveBeenCalled();
        });

        it('should keep non-title changes on the regular update path', async () => {
          await sendRequestAndWait(
            createRequest('PATCH', '/tasks/task-1', {
              body: { title: 'Renamed #tag', notes: 'n', isIgnoreShortSyntax: true },
            }),
          );

          expect(taskServiceMock.update).toHaveBeenCalledWith('task-1', {
            title: 'Renamed #tag',
            notes: 'n',
          });
          expect(dispatchSpy).not.toHaveBeenCalled();
        });

        it('should keep parsing by default', async () => {
          await sendRequestAndWait(
            createRequest('PATCH', '/tasks/task-1', { body: { title: 'Renamed #tag' } }),
          );

          expect(taskServiceMock.update).toHaveBeenCalledWith('task-1', {
            title: 'Renamed #tag',
          });
        });
      });

      describe('with parentId (create subtask)', () => {
        it('should create a subtask when parentId refers to an existing top-level task', async () => {
          const parentTask = createMockTask('parent-1', { projectId: 'project-1' });
          const newSubTask = createMockTask('new-subtask-id', {
            parentId: 'parent-1',
            projectId: 'project-1',
          });
          Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
            get: () => (id: string) =>
              id === 'parent-1' ? of(parentTask) : of(newSubTask),
          });

          const response = await sendRequestAndWait(
            createRequest('POST', '/tasks', {
              body: { title: 'Child', parentId: 'parent-1', notes: 'child notes' },
            }),
          );

          expect(response.body.ok).toBe(true);
          expect(response.status).toBe(201);
          expect(taskServiceMock.addSubTaskTo).toHaveBeenCalledWith('parent-1', {
            title: 'Child',
            notes: 'child notes',
          });
          expect(taskServiceMock.add).not.toHaveBeenCalled();
        });

        it('should set a deadline on a newly created subtask', async () => {
          const parentTask = createMockTask('parent-1', { projectId: 'project-1' });
          const newSubTask = createMockTask('new-subtask-id', {
            parentId: 'parent-1',
            projectId: 'project-1',
            deadlineWithTime: 1_778_582_400_000,
          });
          Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
            get: () => (id: string) =>
              id === 'parent-1' ? of(parentTask) : of(newSubTask),
          });

          const response = await sendRequestAndWait(
            createRequest('POST', '/tasks', {
              body: {
                title: 'Child with deadline',
                parentId: 'parent-1',
                deadlineWithTime: 1_778_582_400_000,
              },
            }),
          );

          expect(taskServiceMock.addSubTaskTo).toHaveBeenCalledWith('parent-1', {
            title: 'Child with deadline',
          });
          expect(dispatchSpy).toHaveBeenCalledOnceWith(
            TaskSharedActions.setDeadline({
              taskId: 'new-subtask-id',
              deadlineWithTime: 1_778_582_400_000,
              autoPlanToday: '2026-05-12',
              autoPlanStartOfNextDayDiffMs: 0,
              isSkipSnack: true,
            }),
          );
          expect(response.status).toBe(201);
        });

        it('should return 404 when parentId does not exist', async () => {
          Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
            get: () => (_id: string) => of(undefined),
          });

          const response = await sendRequestAndWait(
            createRequest('POST', '/tasks', {
              body: { title: 'Child', parentId: 'does-not-exist' },
            }),
          );

          expect(response.body.ok).toBe(false);
          expect(response.status).toBe(404);
          expect((response.body as any).error.code).toBe('PARENT_NOT_FOUND');
          expect(taskServiceMock.addSubTaskTo).not.toHaveBeenCalled();
        });

        it('should return 400 when parentId refers to a task that is itself a subtask', async () => {
          const nestedParent = createMockTask('parent-1', { parentId: 'grandparent' });
          Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
            get: () => (_id: string) => of(nestedParent),
          });

          const response = await sendRequestAndWait(
            createRequest('POST', '/tasks', {
              body: { title: 'Child', parentId: 'parent-1' },
            }),
          );

          expect(response.body.ok).toBe(false);
          expect(response.status).toBe(400);
          expect((response.body as any).error.code).toBe('INVALID_PARENT');
          expect(taskServiceMock.addSubTaskTo).not.toHaveBeenCalled();
        });

        it('should return 400 when parentId is not a string', async () => {
          const response = await sendRequestAndWait(
            createRequest('POST', '/tasks', {
              body: { title: 'Child', parentId: 123 },
            }),
          );

          expect(response.body.ok).toBe(false);
          expect(response.status).toBe(400);
          expect((response.body as any).error.code).toBe('INVALID_INPUT');
        });

        it('should return 400 when projectId is sent alongside parentId', async () => {
          const response = await sendRequestAndWait(
            createRequest('POST', '/tasks', {
              body: {
                title: 'Child',
                parentId: 'parent-1',
                projectId: 'mismatched-project',
              },
            }),
          );

          expect(response.body.ok).toBe(false);
          expect(response.status).toBe(400);
          expect((response.body as any).error.code).toBe('UNSUPPORTED_FIELD');
          expect(taskServiceMock.addSubTaskTo).not.toHaveBeenCalled();
        });

        it('should return 400 when tagIds is sent alongside parentId', async () => {
          const response = await sendRequestAndWait(
            createRequest('POST', '/tasks', {
              body: {
                title: 'Child',
                parentId: 'parent-1',
                tagIds: ['tag-1'],
              },
            }),
          );

          expect(response.body.ok).toBe(false);
          expect(response.status).toBe(400);
          expect((response.body as any).error.code).toBe('UNSUPPORTED_FIELD');
          expect(taskServiceMock.addSubTaskTo).not.toHaveBeenCalled();
        });
      });
    });

    describe('GET /tasks/:id', () => {
      it('should return task by id', async () => {
        const mockTask = createMockTask('task-1');
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(createRequest('GET', '/tasks/task-1'));

        expect(response.body.ok).toBe(true);
        expect(response.status).toBe(200);
      });

      it('should return 404 for non-existent task', async () => {
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(undefined),
        });

        const response = await sendRequestAndWait(
          createRequest('GET', '/tasks/non-existent'),
        );

        expect(response.body.ok).toBe(false);
        expect(response.status).toBe(404);
        expect((response.body as any).error.code).toBe('TASK_NOT_FOUND');
      });

      it('should hide a task of an archived project only when source=active', async () => {
        const shelvedTask = createMockTask('task-1', { projectId: 'shelved' });
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(shelvedTask),
        });
        Object.defineProperty(projectServiceMock, 'archived$', {
          get: () => of([{ id: 'shelved', isArchived: true } as Project]),
        });

        const active = await sendRequestAndWait(
          createRequest('GET', '/tasks/task-1', { query: { source: 'active' } }),
        );
        const plain = await sendRequestAndWait(createRequest('GET', '/tasks/task-1'));

        expect(active.status).toBe(404);
        expect((active.body as any).error.code).toBe('TASK_NOT_FOUND');
        expect(plain.status).toBe(200);
      });

      describe('issueUrl', () => {
        const issueTask = createMockTask('task-1', {
          issueType: 'GITHUB',
          issueId: '42',
          issueProviderId: 'provider-1',
        });

        const mockGetTask = (task: Task): void => {
          Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
            get: () => (_id: string) => of(task),
          });
        };

        const getData = (
          response: LocalRestApiResponsePayload,
        ): Record<string, unknown> => {
          if (!response.body.ok) {
            throw new Error(`Expected success response, got ${response.body.error.code}`);
          }
          return response.body.data as Record<string, unknown>;
        };

        const withIssueUrl = { query: { include: 'issueUrl' } };

        it('should include issueUrl when asked and the provider builds a link', async () => {
          mockGetTask(issueTask);
          featureBridgeMock.issueLink.and.returnValue(
            Promise.resolve('https://github.com/o/r/issues/42'),
          );

          const response = await sendRequestAndWait(
            createRequest('GET', '/tasks/task-1', withIssueUrl),
          );

          expect(response.status).toBe(200);
          expect(featureBridgeMock.issueLink).toHaveBeenCalledWith(
            'GITHUB',
            '42',
            'provider-1',
          );
          const data = getData(response);
          expect(data.issueUrl).toBe('https://github.com/o/r/issues/42');
          expect(data.id).toBe('task-1');
        });

        it('should not look up the link unless asked', async () => {
          mockGetTask(issueTask);

          const response = await sendRequestAndWait(
            createRequest('GET', '/tasks/task-1'),
          );

          expect(response.status).toBe(200);
          expect(featureBridgeMock.issueLink).not.toHaveBeenCalled();
          expect('issueUrl' in getData(response)).toBe(false);
        });

        it('should accept a repeated include parameter', async () => {
          mockGetTask(issueTask);
          featureBridgeMock.issueLink.and.returnValue(
            Promise.resolve('https://github.com/o/r/issues/42'),
          );

          const response = await sendRequestAndWait(
            createRequest('GET', '/tasks/task-1', {
              query: { include: ['subTasks', 'issueUrl'] },
            }),
          );

          expect(getData(response).issueUrl).toBe('https://github.com/o/r/issues/42');
        });

        it('should accept issueUrl in a comma-separated include list', async () => {
          mockGetTask(issueTask);
          featureBridgeMock.issueLink.and.returnValue(
            Promise.resolve('https://github.com/o/r/issues/42'),
          );

          const response = await sendRequestAndWait(
            createRequest('GET', '/tasks/task-1', {
              query: { include: 'subTasks, issueUrl' },
            }),
          );

          expect(getData(response).issueUrl).toBe('https://github.com/o/r/issues/42');
        });

        it('should omit issueUrl and not look it up for a task without an issue', async () => {
          mockGetTask(createMockTask('task-1'));

          const response = await sendRequestAndWait(
            createRequest('GET', '/tasks/task-1', withIssueUrl),
          );

          expect(response.status).toBe(200);
          expect(featureBridgeMock.issueLink).not.toHaveBeenCalled();
          expect('issueUrl' in getData(response)).toBe(false);
        });

        it('should omit issueUrl when the provider returns an empty link', async () => {
          mockGetTask(issueTask);
          featureBridgeMock.issueLink.and.returnValue(Promise.resolve(''));

          const response = await sendRequestAndWait(
            createRequest('GET', '/tasks/task-1', withIssueUrl),
          );

          expect(response.status).toBe(200);
          expect('issueUrl' in getData(response)).toBe(false);
        });

        it('should return 200 without issueUrl when building the link fails', async () => {
          mockGetTask(issueTask);
          const warnSpy = spyOn(IssueLog, 'warn');
          featureBridgeMock.issueLink.and.returnValue(
            Promise.reject(new Error('provider config missing')),
          );

          const response = await sendRequestAndWait(
            createRequest('GET', '/tasks/task-1', withIssueUrl),
          );

          expect(response.status).toBe(200);
          expect('issueUrl' in getData(response)).toBe(false);
          expect(warnSpy).toHaveBeenCalledWith(jasmine.any(String), { id: 'task-1' });
        });

        it('should return 200 without issueUrl when building the link hangs', async () => {
          mockGetTask(issueTask);
          let markCalled!: () => void;
          const isCalled = new Promise<void>((resolve) => (markCalled = resolve));
          featureBridgeMock.issueLink.and.callFake(() => {
            markCalled();
            return new Promise<string>(() => undefined);
          });

          jasmine.clock().install();
          try {
            const responsePromise = sendRequestAndWait(
              createRequest('GET', '/tasks/task-1', withIssueUrl),
            );
            await isCalled;
            jasmine.clock().tick(3000);
            const response = await responsePromise;

            expect(response.status).toBe(200);
            expect('issueUrl' in getData(response)).toBe(false);
          } finally {
            jasmine.clock().uninstall();
          }
        });

        it('should not look up issue links for the task list', async () => {
          Object.defineProperty(taskServiceMock, 'allTasks$', {
            get: () => of([issueTask]),
          });

          const response = await sendRequestAndWait(createRequest('GET', '/tasks'));

          expect(response.status).toBe(200);
          expect(featureBridgeMock.issueLink).not.toHaveBeenCalled();
        });
      });
    });

    describe('PATCH /tasks/:id', () => {
      it('should update a task', async () => {
        const mockTask = createMockTask('task-1');
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', { body: { title: 'Updated Title' } }),
        );

        expect(response.body.ok).toBe(true);
        expect(taskServiceMock.update).toHaveBeenCalledWith(
          'task-1',
          jasmine.any(Object),
        );
      });

      describe('dueWithTime', () => {
        const dueWithTime = 1_778_590_800_000;

        it('should update through the bridge so the reminder follows', async () => {
          const mockTask = createMockTask('task-1', {
            dueWithTime,
            remindAt: dueWithTime,
          });
          Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
            get: () => (_id: string) => of(mockTask),
          });

          const response = await sendRequestAndWait(
            createRequest('PATCH', '/tasks/task-1', {
              body: { dueWithTime: null, title: 'Unscheduled' },
            }),
          );

          expect(response.status).toBe(200);
          expect(featureBridgeMock.updateTaskWithDueTime).toHaveBeenCalledOnceWith(
            mockTask,
            { dueWithTime: null, title: 'Unscheduled' },
          );
          expect(taskServiceMock.update).not.toHaveBeenCalled();
        });

        it('should not go through the bridge when dueWithTime is not sent', async () => {
          const mockTask = createMockTask('task-1', {
            dueWithTime,
            remindAt: dueWithTime,
          });
          Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
            get: () => (_id: string) => of(mockTask),
          });

          await sendRequestAndWait(
            createRequest('PATCH', '/tasks/task-1', { body: { timeEstimate: 60000 } }),
          );

          expect(taskServiceMock.update).toHaveBeenCalledOnceWith('task-1', {
            timeEstimate: 60000,
          });
          expect(featureBridgeMock.updateTaskWithDueTime).not.toHaveBeenCalled();
        });
      });

      it('should set a day deadline through the deadline action', async () => {
        const mockTask = createMockTask('task-1');
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: { deadlineDay: '2026-05-12' },
          }),
        );

        expect(response.status).toBe(200);
        expect(dispatchSpy).toHaveBeenCalledOnceWith(
          TaskSharedActions.setDeadline({
            taskId: 'task-1',
            deadlineDay: '2026-05-12',
            autoPlanToday: '2026-05-12',
            autoPlanStartOfNextDayDiffMs: 0,
            isSkipSnack: true,
          }),
        );
        expect(taskServiceMock.update).not.toHaveBeenCalled();
      });

      it('should set a timed deadline and clear the day deadline via the action', async () => {
        const mockTask = createMockTask('task-1', { deadlineDay: '2026-05-11' });
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: { deadlineWithTime: 1_778_582_400_000 },
          }),
        );

        expect(dispatchSpy).toHaveBeenCalledOnceWith(
          TaskSharedActions.setDeadline({
            taskId: 'task-1',
            deadlineWithTime: 1_778_582_400_000,
            autoPlanToday: '2026-05-12',
            autoPlanStartOfNextDayDiffMs: 0,
            isSkipSnack: true,
          }),
        );
      });

      it('should remove a deadline when both deadline fields are null', async () => {
        const mockTask = createMockTask('task-1', {
          deadlineDay: '2026-05-12',
          deadlineRemindAt: 1_778_496_000_000,
        });
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: { deadlineDay: null, deadlineWithTime: null },
          }),
        );

        expect(dispatchSpy).toHaveBeenCalledOnceWith(
          TaskSharedActions.removeDeadline({ taskId: 'task-1', isSkipSnack: true }),
        );
        expect(taskServiceMock.update).not.toHaveBeenCalled();
      });

      it('should ignore nulling deadlineWithTime when the task has a day deadline', async () => {
        const mockTask = createMockTask('task-1', {
          deadlineDay: '2026-05-12',
          deadlineRemindAt: 1_778_496_000_000,
        });
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: { deadlineWithTime: null },
          }),
        );

        expect(response.status).toBe(200);
        expect(dispatchSpy).not.toHaveBeenCalled();
        expect(taskServiceMock.update).not.toHaveBeenCalled();
      });

      it('should ignore nulling deadlineDay when the task has a timed deadline', async () => {
        const mockTask = createMockTask('task-1', {
          deadlineWithTime: 1_778_582_400_000,
          deadlineRemindAt: 1_778_496_000_000,
        });
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: { deadlineDay: null },
          }),
        );

        expect(response.status).toBe(200);
        expect(dispatchSpy).not.toHaveBeenCalled();
        expect(taskServiceMock.update).not.toHaveBeenCalled();
      });

      it('should keep the reminder when re-sending the unchanged day deadline', async () => {
        const mockTask = createMockTask('task-1', {
          deadlineDay: '2026-05-12',
          deadlineRemindAt: 1_778_496_000_000,
        });
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: { deadlineDay: '2026-05-12' },
          }),
        );

        expect(response.status).toBe(200);
        expect(dispatchSpy).not.toHaveBeenCalled();
        expect(taskServiceMock.update).not.toHaveBeenCalled();
      });

      it('should keep the reminder when re-sending the unchanged timed deadline', async () => {
        const mockTask = createMockTask('task-1', {
          deadlineWithTime: 1_778_582_400_000,
          deadlineRemindAt: 1_778_496_000_000,
        });
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: { deadlineWithTime: 1_778_582_400_000 },
          }),
        );

        expect(response.status).toBe(200);
        expect(dispatchSpy).not.toHaveBeenCalled();
        expect(taskServiceMock.update).not.toHaveBeenCalled();
      });

      it('should clear only the reminder without re-planning a day deadline', async () => {
        const mockTask = createMockTask('task-1', {
          deadlineDay: '2026-05-12',
          deadlineRemindAt: 1_778_496_000_000,
        });
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: { deadlineRemindAt: null },
          }),
        );

        expect(response.status).toBe(200);
        expect(dispatchSpy).toHaveBeenCalledOnceWith(
          TaskSharedActions.clearDeadlineReminder({ taskId: 'task-1' }),
        );
        expect(taskServiceMock.update).not.toHaveBeenCalled();
      });

      it('should clear only the reminder without re-planning a timed deadline', async () => {
        const mockTask = createMockTask('task-1', {
          deadlineWithTime: 1_778_582_400_000,
          deadlineRemindAt: 1_778_496_000_000,
        });
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: { deadlineRemindAt: null },
          }),
        );

        expect(response.status).toBe(200);
        expect(dispatchSpy).toHaveBeenCalledOnceWith(
          TaskSharedActions.clearDeadlineReminder({ taskId: 'task-1' }),
        );
        expect(taskServiceMock.update).not.toHaveBeenCalled();
      });

      it('should treat a stored null reminder as no reminder', async () => {
        const mockTask = createMockTask('task-1', {
          deadlineDay: '2026-05-12',
          deadlineRemindAt: null,
        });
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: { deadlineRemindAt: null },
          }),
        );

        expect(response.status).toBe(200);
        expect(dispatchSpy).not.toHaveBeenCalled();
        expect(taskServiceMock.update).not.toHaveBeenCalled();
      });

      it('should treat a stored null reminder as no reminder when nulling the inactive deadline field', async () => {
        const mockTask = createMockTask('task-1', {
          deadlineDay: '2026-05-12',
          deadlineRemindAt: null,
        });
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: { deadlineWithTime: null, deadlineRemindAt: null },
          }),
        );

        expect(response.status).toBe(200);
        expect(dispatchSpy).not.toHaveBeenCalled();
        expect(taskServiceMock.update).not.toHaveBeenCalled();
      });

      it('should treat a stored null reminder as no reminder for a timed deadline', async () => {
        const mockTask = createMockTask('task-1', {
          deadlineWithTime: 1_778_582_400_000,
          deadlineRemindAt: null,
        });
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: { deadlineDay: null, deadlineRemindAt: null },
          }),
        );

        expect(response.status).toBe(200);
        expect(dispatchSpy).not.toHaveBeenCalled();
        expect(taskServiceMock.update).not.toHaveBeenCalled();
      });

      it('should set a deadline reminder alongside a deadline', async () => {
        const mockTask = createMockTask('task-1');
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: {
              deadlineDay: '2026-05-13',
              deadlineRemindAt: 1_778_496_000_000,
            },
          }),
        );

        expect(dispatchSpy).toHaveBeenCalledOnceWith(
          TaskSharedActions.setDeadline({
            taskId: 'task-1',
            deadlineDay: '2026-05-13',
            deadlineRemindAt: 1_778_496_000_000,
            isSkipSnack: true,
          }),
        );
      });

      it('should update a reminder while preserving the existing deadline', async () => {
        const mockTask = createMockTask('task-1', {
          deadlineDay: '2026-05-13',
        });
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: { deadlineRemindAt: 1_778_496_000_000 },
          }),
        );

        expect(dispatchSpy).toHaveBeenCalledOnceWith(
          TaskSharedActions.setDeadline({
            taskId: 'task-1',
            deadlineDay: '2026-05-13',
            deadlineRemindAt: 1_778_496_000_000,
            isSkipSnack: true,
          }),
        );
      });

      it('should reject conflicting day and timed deadlines', async () => {
        const mockTask = createMockTask('task-1');
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: {
              deadlineDay: '2026-05-13',
              deadlineWithTime: 1_778_582_400_000,
            },
          }),
        );

        expect(response.status).toBe(400);
        expect(response.body.ok).toBe(false);
        if (response.body.ok) {
          throw new Error('Expected an error response');
        }
        expect(response.body.error.code).toBe('INVALID_INPUT');
        expect(dispatchSpy).not.toHaveBeenCalled();
        expect(taskServiceMock.update).not.toHaveBeenCalled();
      });

      for (const invalidDeadlineDay of ['2026/05/13', '2026-02-30']) {
        it(`should reject an invalid deadline day (${invalidDeadlineDay})`, async () => {
          const response = await sendRequestAndWait(
            createRequest('PATCH', '/tasks/task-1', {
              body: { deadlineDay: invalidDeadlineDay },
            }),
          );

          expect(response.status).toBe(400);
          expect(response.body.ok).toBe(false);
          if (response.body.ok) {
            throw new Error('Expected an error response');
          }
          expect(response.body.error.code).toBe('INVALID_INPUT');
          expect(dispatchSpy).not.toHaveBeenCalled();
        });
      }

      for (const invalidField of ['deadlineWithTime', 'deadlineRemindAt'] as const) {
        it(`should reject a non-positive ${invalidField}`, async () => {
          const response = await sendRequestAndWait(
            createRequest('PATCH', '/tasks/task-1', {
              body: { [invalidField]: 0 },
            }),
          );

          expect(response.status).toBe(400);
          expect(response.body.ok).toBe(false);
          if (response.body.ok) {
            throw new Error('Expected an error response');
          }
          expect(response.body.error.code).toBe('INVALID_INPUT');
          expect(dispatchSpy).not.toHaveBeenCalled();
        });
      }

      it('should reject a deadline reminder without a deadline', async () => {
        const mockTask = createMockTask('task-1');
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: { deadlineRemindAt: 1_778_496_000_000 },
          }),
        );

        expect(response.status).toBe(400);
        expect(response.body.ok).toBe(false);
        if (response.body.ok) {
          throw new Error('Expected an error response');
        }
        expect(response.body.error.code).toBe('INVALID_INPUT');
        expect(dispatchSpy).not.toHaveBeenCalled();
      });

      it('should combine a deadline with normal task fields', async () => {
        const mockTask = createMockTask('task-1');
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: { title: 'Updated title', deadlineDay: '2026-05-13' },
          }),
        );

        expect(taskServiceMock.update).toHaveBeenCalledOnceWith('task-1', {
          title: 'Updated title',
        });
        expect(dispatchSpy).toHaveBeenCalledOnceWith(
          TaskSharedActions.setDeadline({
            taskId: 'task-1',
            deadlineDay: '2026-05-13',
            isSkipSnack: true,
          }),
        );
      });

      it('should set a deadline on an existing subtask', async () => {
        const mockTask = createMockTask('subtask-1', { parentId: 'parent-1' });
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/subtask-1', {
            body: { deadlineDay: '2026-05-13' },
          }),
        );

        expect(response.status).toBe(200);
        expect(dispatchSpy).toHaveBeenCalledOnceWith(
          TaskSharedActions.setDeadline({
            taskId: 'subtask-1',
            deadlineDay: '2026-05-13',
            isSkipSnack: true,
          }),
        );
      });

      it('should return 404 for non-existent task', async () => {
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(undefined),
        });

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/non-existent', { body: { title: 'Updated' } }),
        );

        expect(response.body.ok).toBe(false);
        expect(response.status).toBe(404);
      });

      it('should return 404 when PATCH targets an unavailable task', async () => {
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(undefined),
        });

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/archived-task', {
            body: { deadlineDay: '2026-05-13' },
          }),
        );

        expect(response.status).toBe(404);
        expect(response.body.ok).toBe(false);
        expect(dispatchSpy).not.toHaveBeenCalled();
        expect(taskArchiveServiceMock.hasTask).not.toHaveBeenCalled();
      });

      it('should return 400 for invalid body', async () => {
        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', { body: 'not an object' }),
        );

        expect(response.body.ok).toBe(false);
        expect(response.status).toBe(400);
      });

      it('should strip disallowed fields from PATCH body', async () => {
        const mockTask = createMockTask('task-1');
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: { title: 'Updated', id: 'injected-id' },
          }),
        );

        expect(taskServiceMock.update).toHaveBeenCalledWith('task-1', {
          title: 'Updated',
        });
      });

      it('should map plannedAt to dueWithTime when updating a task', async () => {
        const plannedAt = new Date('2026-07-13T09:30:00Z').getTime();
        const mockTask = createMockTask('task-1');
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', { body: { plannedAt } }),
        );

        expect(featureBridgeMock.updateTaskWithDueTime).toHaveBeenCalledOnceWith(
          mockTask,
          { dueWithTime: plannedAt },
        );
        expect(taskServiceMock.update).not.toHaveBeenCalled();
      });

      it('should let dueWithTime override plannedAt when updating a task', async () => {
        const mockTask = createMockTask('task-1');
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: { plannedAt: 1, dueWithTime: 2 },
          }),
        );

        expect(featureBridgeMock.updateTaskWithDueTime).toHaveBeenCalledOnceWith(
          mockTask,
          { dueWithTime: 2 },
        );
        expect(taskServiceMock.update).not.toHaveBeenCalled();
      });

      it('should map null plannedAt to clearing dueWithTime when updating a task', async () => {
        const mockTask = createMockTask('task-1', { dueWithTime: 1 });
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', { body: { plannedAt: null } }),
        );

        expect(featureBridgeMock.updateTaskWithDueTime).toHaveBeenCalledOnceWith(
          mockTask,
          { dueWithTime: null },
        );
        expect(taskServiceMock.update).not.toHaveBeenCalled();
      });

      it('should report invalid plannedAt input on PATCH', async () => {
        const mockTask = createMockTask('task-1');
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: { plannedAt: 'not-a-number' },
          }),
        );

        expect(response.body.ok).toBe(false);
        expect(response.status).toBe(400);
        expect((response.body as any).error.details).toContain(
          jasmine.objectContaining({ path: '$input.plannedAt' }),
        );
        expect(taskServiceMock.update).not.toHaveBeenCalled();
      });

      it('should reject parentId in PATCH body with 400', async () => {
        const mockTask = createMockTask('task-1');
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: { title: 'Updated', parentId: 'some-parent' },
          }),
        );

        expect(response.body.ok).toBe(false);
        expect(response.status).toBe(400);
        expect((response.body as any).error.code).toBe('UNSUPPORTED_FIELD');
        expect(taskServiceMock.update).not.toHaveBeenCalled();
      });

      it('should reject subTaskIds in PATCH body with 400', async () => {
        const mockTask = createMockTask('task-1');
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: { title: 'Updated', subTaskIds: ['s1'] },
          }),
        );

        expect(response.body.ok).toBe(false);
        expect(response.status).toBe(400);
        expect((response.body as any).error.code).toBe('UNSUPPORTED_FIELD');
        expect(taskServiceMock.update).not.toHaveBeenCalled();
      });

      it('should return 400 (not dispatch) when a field has an invalid type', async () => {
        const mockTask = createMockTask('task-1');
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: { tagIds: 123, timeEstimate: 'abc' },
          }),
        );

        expect(response.body.ok).toBe(false);
        expect(response.status).toBe(400);
        expect((response.body as any).error.code).toBe('INVALID_INPUT');
        expect(taskServiceMock.update).not.toHaveBeenCalled();
      });

      it('should accept valid typed fields and dispatch them', async () => {
        const mockTask = createMockTask('task-1');
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: { tagIds: ['tag-1'], timeEstimate: 1000, isDone: true },
          }),
        );

        expect(response.body.ok).toBe(true);
        expect(taskServiceMock.update).toHaveBeenCalledWith('task-1', {
          tagIds: ['tag-1'],
          timeEstimate: 1000,
          isDone: true,
        });
      });

      describe('priority', () => {
        beforeEach(() => {
          const mockTask = createMockTask('task-1');
          Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
            get: () => (_id: string) => of(mockTask),
          });
        });

        it('should set a priority level', async () => {
          const response = await sendRequestAndWait(
            createRequest('PATCH', '/tasks/task-1', { body: { priority: 3 } }),
          );

          expect(response.body.ok).toBe(true);
          expect(taskServiceMock.update).toHaveBeenCalledOnceWith('task-1', {
            priority: 3,
          });
        });

        it('should clear the priority with null', async () => {
          const response = await sendRequestAndWait(
            createRequest('PATCH', '/tasks/task-1', { body: { priority: null } }),
          );

          expect(response.body.ok).toBe(true);
          expect(taskServiceMock.update).toHaveBeenCalledOnceWith('task-1', {
            priority: null,
          });
        });

        it('should reject values other than 1, 2, 3 or null', async () => {
          for (const priority of [0, 4, 2.5, 'high', '3']) {
            const response = await sendRequestAndWait(
              createRequest('PATCH', '/tasks/task-1', { body: { priority } }),
            );

            expect(response.status).toBe(400);
            expect((response.body as any).error.code).toBe('INVALID_INPUT');
          }
          expect(taskServiceMock.update).not.toHaveBeenCalled();
        });
      });

      // A GET→PATCH round trip echoes `isDone: true`; a new `doneOn` stamp would
      // move the completion date and turn a won't-do task into a completed one.
      it('should drop an echoed isDone on a task that is already done', async () => {
        const mockTask = createMockTask('task-1', {
          isDone: true,
          doneOn: 5,
          wontDoOn: 5,
        });
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: { title: 'Renamed', isDone: true },
          }),
        );

        expect(response.body.ok).toBe(true);
        expect(taskServiceMock.update).toHaveBeenCalledOnceWith('task-1', {
          title: 'Renamed',
        });
      });

      it('should move the task and then apply the other fields', async () => {
        let mockTask = createMockTask('task-1', { projectId: 'project-1' });
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });
        taskServiceMock.update.and.callFake((id, changes) => {
          if (id === mockTask.id) {
            mockTask = { ...mockTask, ...changes };
          }
        });
        activeProjects = [{ id: 'project-2' } as Project];

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: { projectId: 'project-2', title: 'Moved task' },
          }),
        );

        expect(response.body.ok).toBe(true);
        expect(featureBridgeMock.moveTaskToProject).toHaveBeenCalledOnceWith(
          'task-1',
          'project-2',
        );
        expect(featureBridgeMock.moveTaskToProject).toHaveBeenCalledBefore(
          taskServiceMock.update,
        );
        expect(taskServiceMock.update).toHaveBeenCalledOnceWith('task-1', {
          projectId: 'project-2',
          title: 'Moved task',
        });
        if (!response.body.ok) {
          throw new Error('Expected a success response');
        }
        expect(response.body.data).toEqual(
          jasmine.objectContaining({
            projectId: 'project-2',
            title: 'Moved task',
          }),
        );
      });

      it('should only move the task when projectId is the only change', async () => {
        let mockTask = createMockTask('task-1', { projectId: 'project-1' });
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });
        featureBridgeMock.moveTaskToProject.and.callFake(async (_id, projectId) => {
          mockTask = { ...mockTask, projectId };
        });
        activeProjects = [{ id: 'project-2' } as Project];

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: { projectId: 'project-2' },
          }),
        );

        expect(response.body.ok).toBe(true);
        expect(featureBridgeMock.moveTaskToProject).toHaveBeenCalledOnceWith(
          'task-1',
          'project-2',
        );
        expect(taskServiceMock.update).not.toHaveBeenCalled();
        expect(dispatchSpy).not.toHaveBeenCalled();
        if (!response.body.ok) {
          throw new Error('Expected a success response');
        }
        expect(response.body.data).toEqual(
          jasmine.objectContaining({ projectId: 'project-2' }),
        );
      });

      it('should reject projectId changes for subtasks', async () => {
        const mockTask = createMockTask('subtask-1', {
          parentId: 'parent-1',
          projectId: 'project-1',
        });
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/subtask-1', {
            body: { projectId: 'project-2' },
          }),
        );

        expect(response.status).toBe(400);
        expect(response.body.ok).toBe(false);
        if (response.body.ok) {
          throw new Error('Expected an error response');
        }
        expect(response.body.error.code).toBe('UNSUPPORTED_FIELD');
        expect(taskServiceMock.update).not.toHaveBeenCalled();
        expect(featureBridgeMock.moveTaskToProject).not.toHaveBeenCalled();
      });

      it('should allow an unchanged inherited projectId on subtasks', async () => {
        let mockTask = createMockTask('subtask-1', {
          parentId: 'parent-1',
          projectId: 'project-1',
        });
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });
        taskServiceMock.update.and.callFake((id, changes) => {
          if (id === mockTask.id) {
            mockTask = { ...mockTask, ...changes };
          }
        });
        activeProjects = [{ id: 'project-1' } as Project];

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/subtask-1', {
            body: { projectId: 'project-1', title: 'Round-tripped subtask' },
          }),
        );

        expect(response.body.ok).toBe(true);
        expect(featureBridgeMock.moveTaskToProject).not.toHaveBeenCalled();
        expect(taskServiceMock.update).toHaveBeenCalledOnceWith('subtask-1', {
          projectId: 'project-1',
          title: 'Round-tripped subtask',
        });
      });

      it('should allow an unchanged archived projectId in a task round trip', async () => {
        const mockTask = createMockTask('task-1', {
          projectId: 'archived-project',
        });
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: {
              projectId: 'archived-project',
              title: 'Round-tripped task',
            },
          }),
        );

        expect(response.body.ok).toBe(true);
        expect(featureBridgeMock.moveTaskToProject).not.toHaveBeenCalled();
        expect(taskServiceMock.update).toHaveBeenCalledOnceWith('task-1', {
          projectId: 'archived-project',
          title: 'Round-tripped task',
        });
      });

      it('should reject an unknown destination project', async () => {
        const mockTask = createMockTask('task-1', { projectId: 'project-1' });
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });
        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: { projectId: 'missing-project' },
          }),
        );

        expect(response.status).toBe(404);
        expect(response.body.ok).toBe(false);
        if (response.body.ok) {
          throw new Error('Expected an error response');
        }
        expect(response.body.error.code).toBe('PROJECT_NOT_FOUND');
        expect(taskServiceMock.update).not.toHaveBeenCalled();
        expect(featureBridgeMock.moveTaskToProject).not.toHaveBeenCalled();
      });

      it('should reject an archived destination project', async () => {
        const mockTask = createMockTask('task-1', { projectId: 'project-1' });
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });
        activeProjects = [
          {
            id: 'archived-project',
            isArchived: true,
          } as Project,
        ];

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: { projectId: 'archived-project' },
          }),
        );

        expect(response.status).toBe(404);
        expect(response.body.ok).toBe(false);
        if (response.body.ok) {
          throw new Error('Expected an error response');
        }
        expect(response.body.error.code).toBe('PROJECT_NOT_FOUND');
        expect(taskServiceMock.update).not.toHaveBeenCalled();
      });

      it('should reject prototype-property names as missing project ids', async () => {
        const mockTask = createMockTask('task-1', { projectId: 'project-1' });
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/task-1', {
            body: { projectId: 'constructor' },
          }),
        );

        expect(response.status).toBe(404);
        expect(response.body.ok).toBe(false);
        if (response.body.ok) {
          throw new Error('Expected an error response');
        }
        expect(response.body.error.code).toBe('PROJECT_NOT_FOUND');
        expect(taskServiceMock.update).not.toHaveBeenCalled();
      });

      it('should reject prototype-property names as missing task ids', async () => {
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(Object.prototype as Task),
        });

        const response = await sendRequestAndWait(
          createRequest('PATCH', '/tasks/constructor', {
            body: { title: 'Ignored' },
          }),
        );

        expect(response.status).toBe(404);
        expect(response.body.ok).toBe(false);
        if (response.body.ok) {
          throw new Error('Expected an error response');
        }
        expect(response.body.error.code).toBe('TASK_NOT_FOUND');
        expect(taskServiceMock.update).not.toHaveBeenCalled();
      });

      it('should reject empty or whitespace-only projectIds', async () => {
        const mockTask = createMockTask('task-1', { projectId: 'project-1' });
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        for (const projectId of ['', '   ']) {
          const response = await sendRequestAndWait(
            createRequest('PATCH', '/tasks/task-1', {
              body: { projectId },
            }),
          );

          expect(response.status).toBe(400);
          expect(response.body.ok).toBe(false);
          if (response.body.ok) {
            throw new Error('Expected an error response');
          }
          expect(response.body.error.code).toBe('INVALID_INPUT');
        }
        expect(taskServiceMock.update).not.toHaveBeenCalled();
      });
    });

    describe('DELETE /tasks/:id', () => {
      it('should delete a task', async () => {
        const mockTask = createMockTask('task-1');
        Object.defineProperty(taskServiceMock, 'getByIdWithSubTaskData$', {
          get: () => (_id: string) => of(createMockTaskWithSubTasks(mockTask)),
        });

        const response = await sendRequestAndWait(
          createRequest('DELETE', '/tasks/task-1'),
        );

        expect(response.body.ok).toBe(true);
        expect(taskServiceMock.remove).toHaveBeenCalled();
      });

      it('should return 404 for non-existent task', async () => {
        Object.defineProperty(taskServiceMock, 'getByIdWithSubTaskData$', {
          get: () => (_id: string) => of(undefined),
        });

        const response = await sendRequestAndWait(
          createRequest('DELETE', '/tasks/non-existent'),
        );

        expect(response.body.ok).toBe(false);
        expect(response.status).toBe(404);
      });
    });

    describe('POST /tasks/:id/start', () => {
      it('should start a task', async () => {
        const mockTask = createMockTask('task-1');
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('POST', '/tasks/task-1/start'),
        );

        expect(response.body.ok).toBe(true);
        expect(taskServiceMock.setCurrentId).toHaveBeenCalledWith('task-1');
      });

      it('should return 404 for non-existent task', async () => {
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(undefined),
        });

        const response = await sendRequestAndWait(
          createRequest('POST', '/tasks/non-existent/start'),
        );

        expect(response.body.ok).toBe(false);
        expect(response.status).toBe(404);
      });
    });

    describe('POST /tasks/:id/time', () => {
      const HOUR_MS = 60 * 60 * 1000;
      const DAY_MS = 24 * HOUR_MS;

      const expectInvalidInput = async (body: unknown): Promise<void> => {
        const getByIdOnceSpy = jasmine
          .createSpy('getByIdOnce$')
          .and.returnValue(of(createMockTask('task-1')));
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => getByIdOnceSpy,
        });

        const response = await sendRequestAndWait(
          createRequest('POST', '/tasks/task-1/time', { body }),
        );

        expect(response.status).toBe(400);
        expect((response.body as any).error.code).toBe('INVALID_INPUT');
        // Body is validated before the task is looked up.
        expect(getByIdOnceSpy).not.toHaveBeenCalled();
        expect(featureBridgeMock.addTimeSpentOnDay).not.toHaveBeenCalled();
      };

      it('should add time spent on the given day and return the task', async () => {
        const mockTask = createMockTask('task-1');
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('POST', '/tasks/task-1/time', {
            body: { date: '2026-05-10', duration: HOUR_MS },
          }),
        );

        expect(response.status).toBe(200);
        expect(response.body.ok).toBe(true);
        expect((response.body as any).data.id).toBe('task-1');
        expect(featureBridgeMock.addTimeSpentOnDay).toHaveBeenCalledOnceWith(
          mockTask,
          HOUR_MS,
          '2026-05-10',
        );
      });

      it('should accept exactly 24h', async () => {
        const mockTask = createMockTask('task-1');
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('POST', '/tasks/task-1/time', {
            body: { date: '2026-05-10', duration: DAY_MS },
          }),
        );

        expect(response.status).toBe(200);
        expect(featureBridgeMock.addTimeSpentOnDay).toHaveBeenCalledOnceWith(
          mockTask,
          DAY_MS,
          '2026-05-10',
        );
      });

      it('should return 400 for a non-object body', async () => {
        await expectInvalidInput([{ date: '2026-05-10', duration: HOUR_MS }]);
      });

      it('should return 400 for a missing body', async () => {
        await expectInvalidInput(undefined);
      });

      it('should return 400 for a missing date', async () => {
        await expectInvalidInput({ duration: HOUR_MS });
      });

      it('should return 400 for a malformed date', async () => {
        await expectInvalidInput({ date: '10.05.2026', duration: HOUR_MS });
      });

      it('should return 400 for an impossible calendar date', async () => {
        await expectInvalidInput({ date: '2026-02-30', duration: HOUR_MS });
      });

      it('should return 400 for a non-number duration', async () => {
        await expectInvalidInput({ date: '2026-05-10', duration: '3600000' });
      });

      it('should return 400 for a non-integer duration', async () => {
        await expectInvalidInput({ date: '2026-05-10', duration: 1.5 });
      });

      it('should return 400 for a non-finite duration', async () => {
        await expectInvalidInput({ date: '2026-05-10', duration: Infinity });
      });

      it('should return 400 for a zero duration', async () => {
        await expectInvalidInput({ date: '2026-05-10', duration: 0 });
      });

      it('should return 400 for a negative duration', async () => {
        await expectInvalidInput({ date: '2026-05-10', duration: -HOUR_MS });
      });

      it('should return 400 for a duration over 24h', async () => {
        await expectInvalidInput({ date: '2026-05-10', duration: DAY_MS + 1 });
      });

      it('should accept today (logical today from DateService)', async () => {
        const mockTask = createMockTask('task-1');
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('POST', '/tasks/task-1/time', {
            body: { date: '2026-05-12', duration: HOUR_MS },
          }),
        );

        expect(response.status).toBe(200);
        expect(featureBridgeMock.addTimeSpentOnDay).toHaveBeenCalledOnceWith(
          mockTask,
          HOUR_MS,
          '2026-05-12',
        );
      });

      it('should return 400 for a date after today', async () => {
        await expectInvalidInput({ date: '2026-05-13', duration: HOUR_MS });
      });

      it('should return 400 UNSUPPORTED_FIELD for any field besides date and duration', async () => {
        const getByIdOnceSpy = jasmine
          .createSpy('getByIdOnce$')
          .and.returnValue(of(createMockTask('task-1')));
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => getByIdOnceSpy,
        });

        const response = await sendRequestAndWait(
          createRequest('POST', '/tasks/task-1/time', {
            body: { date: '2026-05-10', duration: HOUR_MS, timeSpent: HOUR_MS },
          }),
        );

        expect(response.status).toBe(400);
        expect((response.body as any).error.code).toBe('UNSUPPORTED_FIELD');
        expect((response.body as any).error.message).toContain('timeSpent');
        expect(getByIdOnceSpy).not.toHaveBeenCalled();
        expect(featureBridgeMock.addTimeSpentOnDay).not.toHaveBeenCalled();
      });

      it('should return 400 for a parent task with subtasks', async () => {
        const parent = createMockTask('task-1', { subTaskIds: ['sub-1'] });
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(parent),
        });

        const response = await sendRequestAndWait(
          createRequest('POST', '/tasks/task-1/time', {
            body: { date: '2026-05-10', duration: HOUR_MS },
          }),
        );

        expect(response.status).toBe(400);
        expect((response.body as any).error.code).toBe('INVALID_INPUT');
        expect((response.body as any).error.message).toContain('subtask');
        expect(featureBridgeMock.addTimeSpentOnDay).not.toHaveBeenCalled();
      });

      it('should return 400 when the day would exceed 24h', async () => {
        const mockTask = createMockTask('task-1', {
          timeSpentOnDay: { ['2026-05-10']: 23 * HOUR_MS },
        });
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('POST', '/tasks/task-1/time', {
            body: { date: '2026-05-10', duration: HOUR_MS + 1 },
          }),
        );

        expect(response.status).toBe(400);
        expect((response.body as any).error.code).toBe('INVALID_INPUT');
        expect(featureBridgeMock.addTimeSpentOnDay).not.toHaveBeenCalled();
      });

      it('should accept time that fills the day up to exactly 24h', async () => {
        const mockTask = createMockTask('task-1', {
          timeSpentOnDay: { ['2026-05-10']: 23 * HOUR_MS },
        });
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('POST', '/tasks/task-1/time', {
            body: { date: '2026-05-10', duration: HOUR_MS },
          }),
        );

        expect(response.status).toBe(200);
        expect(featureBridgeMock.addTimeSpentOnDay).toHaveBeenCalledOnceWith(
          mockTask,
          HOUR_MS,
          '2026-05-10',
        );
      });

      it('should return 404 for a non-existent task', async () => {
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(undefined),
        });

        const response = await sendRequestAndWait(
          createRequest('POST', '/tasks/non-existent/time', {
            body: { date: '2026-05-10', duration: HOUR_MS },
          }),
        );

        expect(response.status).toBe(404);
        expect((response.body as any).error.code).toBe('TASK_NOT_FOUND');
        expect(featureBridgeMock.addTimeSpentOnDay).not.toHaveBeenCalled();
      });
    });

    describe('PUT /tasks/:id/time', () => {
      const DATE = '2026-05-10';
      const HOUR_MS = 60 * 60 * 1000;
      const DAY_MS = 24 * HOUR_MS;

      const provideTask = (task: Task | undefined): void => {
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(task),
        });
      };
      const putTime = (
        body: unknown,
        id = 'task-1',
      ): Promise<LocalRestApiResponsePayload> =>
        sendRequestAndWait(createRequest('PUT', `/tasks/${id}/time`, { body }));

      it('sets a day absolutely, preserves other days and returns the re-read task', async () => {
        const task = createMockTask('task-1', {
          timeSpentOnDay: { [DATE]: 2 * HOUR_MS, ['2026-05-09']: HOUR_MS },
        });
        const updated = createMockTask('task-1', {
          timeSpentOnDay: { [DATE]: HOUR_MS, ['2026-05-09']: HOUR_MS },
          timeSpent: 2 * HOUR_MS,
        });
        const lookup = jasmine.createSpy().and.returnValues(of(task), of(updated));
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', { get: () => lookup });

        const response = await putTime({ date: DATE, duration: HOUR_MS });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ ok: true, data: updated });
        expect(taskServiceMock.update).toHaveBeenCalledOnceWith('task-1', {
          timeSpentOnDay: updated.timeSpentOnDay,
        });
        expect(task.timeSpentOnDay[DATE]).toBe(2 * HOUR_MS);
        expect(featureBridgeMock.addTimeSpentOnDay).not.toHaveBeenCalled();
      });

      it('adds a missing day and accepts exactly 24 hours', async () => {
        provideTask(createMockTask('task-1', { timeSpentOnDay: { ['2026-05-09']: 1 } }));
        expect((await putTime({ date: DATE, duration: DAY_MS })).status).toBe(200);
        expect(taskServiceMock.update).toHaveBeenCalledOnceWith('task-1', {
          timeSpentOnDay: { ['2026-05-09']: 1, [DATE]: DAY_MS },
        });
      });

      for (const previous of [HOUR_MS, 0]) {
        it(`removes an existing ${previous}ms entry when duration is zero`, async () => {
          provideTask(
            createMockTask('task-1', {
              timeSpentOnDay: { [DATE]: previous, ['2026-05-09']: HOUR_MS },
            }),
          );
          expect((await putTime({ date: DATE, duration: 0 })).status).toBe(200);
          expect(taskServiceMock.update).toHaveBeenCalledOnceWith('task-1', {
            timeSpentOnDay: { ['2026-05-09']: HOUR_MS },
          });
        });
      }

      it('does not dispatch for an unchanged value or a zero on a missing day', async () => {
        provideTask(createMockTask('task-1', { timeSpentOnDay: { [DATE]: HOUR_MS } }));
        expect((await putTime({ date: DATE, duration: HOUR_MS })).status).toBe(200);
        expect((await putTime({ date: '2026-05-09', duration: 0 })).status).toBe(200);
        expect(taskServiceMock.update).not.toHaveBeenCalled();
      });

      it('allows a subtask and logical today', async () => {
        provideTask(createMockTask('task-1', { parentId: 'parent' }));
        expect((await putTime({ date: '2026-05-12', duration: HOUR_MS })).status).toBe(
          200,
        );
        expect(taskServiceMock.update).toHaveBeenCalledOnceWith('task-1', {
          timeSpentOnDay: { ['2026-05-12']: HOUR_MS },
        });
      });

      it('rejects a parent with subtasks before updating', async () => {
        provideTask(createMockTask('task-1', { subTaskIds: ['subtask'] }));
        const response = await putTime({ date: DATE, duration: HOUR_MS });
        expect(response.status).toBe(400);
        expect(response.body).toEqual(
          jasmine.objectContaining({
            error: jasmine.objectContaining({ code: 'INVALID_INPUT' }),
          }),
        );
        expect(taskServiceMock.update).not.toHaveBeenCalled();
      });

      it('returns 404 for unknown task ids', async () => {
        provideTask(undefined);
        const response = await putTime({ date: DATE, duration: HOUR_MS }, 'missing');
        expect(response.status).toBe(404);
        expect(response.body).toEqual(
          jasmine.objectContaining({
            error: jasmine.objectContaining({ code: 'TASK_NOT_FOUND' }),
          }),
        );
        expect(taskServiceMock.update).not.toHaveBeenCalled();
      });

      it('returns 404 when a prototype-like id resolves to an inherited value', async () => {
        // The store selector reads `entities[id]`, so these ids return
        // Object.prototype and Object instead of undefined.
        const entities: Record<string, Task> = {};
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (id: string) => of(entities[id]),
        });
        for (const id of ['__proto__', 'constructor']) {
          const response = await putTime({ date: DATE, duration: HOUR_MS }, id);
          expect(response.status).toBe(404);
          expect(response.body).toEqual(
            jasmine.objectContaining({
              error: jasmine.objectContaining({ code: 'TASK_NOT_FOUND' }),
            }),
          );
        }
        expect(taskServiceMock.update).not.toHaveBeenCalled();
      });

      it('validates the body before looking up or updating a task', async () => {
        const lookup = jasmine.createSpy().and.returnValue(of(createMockTask('task-1')));
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', { get: () => lookup });
        const invalidBodies: unknown[] = [
          undefined,
          null,
          [],
          'text',
          {},
          { duration: 0 },
          { date: DATE },
          { date: '2026-02-30', duration: 1 },
          { date: '__proto__', duration: 1 },
          { date: '2026-05-13', duration: 1 },
          ...[-1, 1.5, Infinity, NaN, DAY_MS + 1, '1', null].map((duration) => ({
            date: DATE,
            duration,
          })),
        ];
        for (const body of invalidBodies) {
          const response = await putTime(body);
          expect(response.status).toBe(400);
          expect(response.body).toEqual(
            jasmine.objectContaining({
              error: jasmine.objectContaining({ code: 'INVALID_INPUT' }),
            }),
          );
        }
        const unsupported = await putTime({ date: DATE, duration: 0, ms: 0 });
        expect(unsupported.status).toBe(400);
        expect(unsupported.body).toEqual(
          jasmine.objectContaining({
            error: jasmine.objectContaining({ code: 'UNSUPPORTED_FIELD' }),
          }),
        );
        expect(lookup).not.toHaveBeenCalled();
        expect(taskServiceMock.update).not.toHaveBeenCalled();
        expect(featureBridgeMock.addTimeSpentOnDay).not.toHaveBeenCalled();
      });

      it('does not match other methods or extra path segments', async () => {
        for (const [method, path] of [
          ['PATCH', '/tasks/task-1/time'],
          ['DELETE', '/tasks/task-1/time'],
          ['PUT', '/tasks/task-1/time/extra'],
        ]) {
          const response = await sendRequestAndWait(
            createRequest(method, path, {
              body: { date: DATE, duration: HOUR_MS },
            }),
          );
          expect(response.status).toBe(404);
        }
        expect(taskServiceMock.update).not.toHaveBeenCalled();
      });
    });

    describe('POST /tasks/:id/archive', () => {
      it('should archive a task', async () => {
        const mockTask = createMockTask('task-1');
        Object.defineProperty(taskServiceMock, 'getByIdWithSubTaskData$', {
          get: () => (_id: string) => of(createMockTaskWithSubTasks(mockTask)),
        });
        (taskServiceMock as any).moveToArchive.and.returnValue(Promise.resolve());

        const response = await sendRequestAndWait(
          createRequest('POST', '/tasks/task-1/archive'),
        );

        expect(response.body.ok).toBe(true);
        expect(taskServiceMock.moveToArchive).toHaveBeenCalled();
      });

      it('should return 404 for non-existent task', async () => {
        Object.defineProperty(taskServiceMock, 'getByIdWithSubTaskData$', {
          get: () => (_id: string) => of(undefined),
        });

        const response = await sendRequestAndWait(
          createRequest('POST', '/tasks/non-existent/archive'),
        );

        expect(response.body.ok).toBe(false);
        expect(response.status).toBe(404);
      });
    });

    describe('POST /tasks/:id/restore', () => {
      it('should restore an archived task', async () => {
        const archivedTask = createMockTask('archivedTask1', { isDone: true });
        (taskArchiveServiceMock as any).hasTask.and.returnValue(Promise.resolve(true));
        (taskArchiveServiceMock as any).getById.and.returnValue(
          Promise.resolve(archivedTask),
        );
        (taskArchiveServiceMock as any).load.and.returnValue(
          Promise.resolve({ ids: [], entities: {} } as TaskArchive),
        );
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(archivedTask),
        });

        const response = await sendRequestAndWait(
          createRequest('POST', '/tasks/archivedTask1/restore'),
        );

        expect(response.body.ok).toBe(true);
        expect(taskServiceMock.restoreTask).toHaveBeenCalled();
      });

      it('should not respond before the archive removal has settled (#9952)', async () => {
        const archivedTask = createMockTask('archivedTask1', { isDone: true });
        (taskArchiveServiceMock as any).hasTask.and.returnValue(Promise.resolve(true));
        (taskArchiveServiceMock as any).getById.and.returnValue(
          Promise.resolve(archivedTask),
        );
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(archivedTask),
        });
        let settleArchive!: () => void;
        archiveOperationHandlerMock.whenLocalOperationsSettled.and.returnValue(
          new Promise<void>((resolve) => (settleArchive = resolve)),
        );
        let response: LocalRestApiResponsePayload | undefined;

        const responsePromise = sendRequestAndWait(
          createRequest('POST', '/tasks/archivedTask1/restore'),
        ).then((r) => (response = r));
        await new Promise((resolve) => setTimeout(resolve));

        expect(taskServiceMock.restoreTask).toHaveBeenCalled();
        expect(response).toBeUndefined();

        settleArchive();
        await responsePromise;
        expect(response?.status).toBe(200);
      });

      it('should return 404 if task not in archive', async () => {
        (taskArchiveServiceMock as any).hasTask.and.returnValue(Promise.resolve(false));

        const response = await sendRequestAndWait(
          createRequest('POST', '/tasks/non-existent/restore'),
        );

        expect(response.body.ok).toBe(false);
        expect(response.status).toBe(404);
        expect((response.body as any).error.code).toBe('TASK_NOT_FOUND');
      });
    });
  });

  describe('task-control routes', () => {
    describe('GET /task-control/current', () => {
      it('should return current task', async () => {
        const mockTask = createMockTask('current-task');
        Object.defineProperty(taskServiceMock, 'currentTask$', {
          get: () => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('GET', '/task-control/current'),
        );

        expect(response.body.ok).toBe(true);
      });
    });

    describe('POST /task-control/stop', () => {
      it('should stop current task', async () => {
        const response = await sendRequestAndWait(
          createRequest('POST', '/task-control/stop'),
        );

        expect(response.body.ok).toBe(true);
        expect(taskServiceMock.setCurrentId).toHaveBeenCalledWith(null);
      });
    });

    describe('POST /task-control/current', () => {
      it('should set current task with valid taskId', async () => {
        const mockTask = createMockTask('task-1');
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(mockTask),
        });

        const response = await sendRequestAndWait(
          createRequest('POST', '/task-control/current', { body: { taskId: 'task-1' } }),
        );

        expect(response.body.ok).toBe(true);
        expect(taskServiceMock.setCurrentId).toHaveBeenCalledWith('task-1');
      });

      it('should clear current task with null taskId', async () => {
        const response = await sendRequestAndWait(
          createRequest('POST', '/task-control/current', { body: { taskId: null } }),
        );

        expect(response.body.ok).toBe(true);
        expect(taskServiceMock.setCurrentId).toHaveBeenCalledWith(null);
      });

      it('should return 404 for non-existent task', async () => {
        Object.defineProperty(taskServiceMock, 'getByIdOnce$', {
          get: () => (_id: string) => of(undefined),
        });

        const response = await sendRequestAndWait(
          createRequest('POST', '/task-control/current', {
            body: { taskId: 'non-existent' },
          }),
        );

        expect(response.body.ok).toBe(false);
        expect(response.status).toBe(404);
      });

      it('should return 400 for missing taskId', async () => {
        const response = await sendRequestAndWait(
          createRequest('POST', '/task-control/current', { body: {} }),
        );

        expect(response.body.ok).toBe(false);
        expect(response.status).toBe(400);
      });
    });
  });
  describe('route ownership', () => {
    it('should leave requests outside its routes to the other route providers', async () => {
      for (const [method, path] of [
        ['GET', '/focus'],
        ['GET', '/projects'],
        ['GET', '/tags'],
        ['GET', '/notes'],
        ['GET', '/taskss'],
        ['DELETE', '/tasks'],
        ['POST', '/status'],
        ['GET', '/task-control/unknown'],
      ]) {
        expect(await service.handle(createRequest(method, path)))
          .withContext(`${method} ${path}`)
          .toBeUndefined();
      }
    });

    it('should answer unknown routes under a task itself', async () => {
      const response = await sendRequestAndWait(
        createRequest('GET', '/tasks/task-1/unknown'),
      );

      expect(response.status).toBe(404);
      expect((response.body as any).error.code).toBe('NOT_FOUND');
    });
  });
});
