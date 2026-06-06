import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { LocalRestApiHandlerService } from './local-rest-api-handler.service';
import { TaskService } from '../../features/tasks/task.service';
import { TaskArchiveService } from '../../features/archive/task-archive.service';
import { ProjectService } from '../../features/project/project.service';
import { TagService } from '../../features/tag/tag.service';
import { TODAY_TAG } from '../../features/tag/tag.const';
import { DateService } from '../date/date.service';
import { Task, TaskWithSubTasks, TaskArchive } from '../../features/tasks/task.model';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../electron/shared-with-frontend/local-rest-api.model';

describe('LocalRestApiHandlerService', () => {
  let service: LocalRestApiHandlerService;
  let taskServiceMock: jasmine.SpyObj<TaskService>;
  let taskArchiveServiceMock: jasmine.SpyObj<TaskArchiveService>;
  let projectServiceMock: jasmine.SpyObj<ProjectService>;
  let tagServiceMock: jasmine.SpyObj<TagService>;
  let dateServiceMock: jasmine.SpyObj<DateService>;
  let requestHandler: ((payload: LocalRestApiRequestPayload) => void) | null = null;
  let responsePromiseResolve: ((response: LocalRestApiResponsePayload) => void) | null =
    null;

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

  const mockElectronApi = (): void => {
    (window as any).ea = {
      onLocalRestApiRequest: (handler: (payload: LocalRestApiRequestPayload) => void) => {
        requestHandler = handler;
      },
      sendLocalRestApiResponse: (response: LocalRestApiResponsePayload) => {
        if (responsePromiseResolve) {
          responsePromiseResolve(response);
        }
      },
    };
  };

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

  const sendRequestAndWait = async (
    request: LocalRestApiRequestPayload,
  ): Promise<LocalRestApiResponsePayload> => {
    const responsePromise = new Promise<LocalRestApiResponsePayload>((resolve) => {
      responsePromiseResolve = resolve;
    });
    requestHandler!(request);
    return responsePromise;
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
    requestHandler = null;
    responsePromiseResolve = null;

    mockElectronApi();

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

    projectServiceMock = jasmine.createSpyObj(
      'ProjectService',
      ['add', 'update', 'remove', 'archive'],
      {
        list$: of([]),
      },
    );

    tagServiceMock = jasmine.createSpyObj(
      'TagService',
      ['addTag', 'updateTag', 'deleteTag'],
      {
        tags$: of([]),
      },
    );

    dateServiceMock = jasmine.createSpyObj<DateService>(
      'DateService',
      ['todayStr', 'getStartOfNextDayDiffMs'],
      {},
    );
    dateServiceMock.todayStr.and.returnValue('2026-05-12');
    dateServiceMock.getStartOfNextDayDiffMs.and.returnValue(0);

    TestBed.configureTestingModule({
      providers: [
        LocalRestApiHandlerService,
        { provide: TaskService, useValue: taskServiceMock },
        { provide: TaskArchiveService, useValue: taskArchiveServiceMock },
        { provide: ProjectService, useValue: projectServiceMock },
        { provide: TagService, useValue: tagServiceMock },
        { provide: DateService, useValue: dateServiceMock },
      ],
    });

    service = TestBed.inject(LocalRestApiHandlerService);
  });

  afterEach(() => {
    delete (window as any).ea;
  });

  describe('initialization', () => {
    it('should register request handler on init', () => {
      expect(requestHandler).toBeNull();
      service.init();
      expect(requestHandler).not.toBeNull();
    });

    it('should not register handler twice on multiple init calls', () => {
      service.init();
      const firstHandler = requestHandler;
      service.init();
      expect(requestHandler).toBe(firstHandler);
    });
  });

  describe('GET /status', () => {
    beforeEach(() => {
      service.init();
    });

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
    beforeEach(() => {
      service.init();
    });

    describe('GET /tasks', () => {
      it('should return all active tasks by default', async () => {
        const tasks = [createMockTask('task-1'), createMockTask('task-2')];
        Object.defineProperty(taskServiceMock, 'allTasks$', { get: () => of(tasks) });

        const response = await sendRequestAndWait(createRequest('GET', '/tasks'));

        expect(response.body.ok).toBe(true);
        expect(response.status).toBe(200);
        expectTaskIds(response, ['task-1', 'task-2']);
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
    beforeEach(() => {
      service.init();
    });

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

  describe('project routes', () => {
    beforeEach(() => {
      service.init();
    });

    describe('GET /projects', () => {
      it('should return all projects', async () => {
        const projects = [
          { id: 'p1', title: 'Project 1' },
          { id: 'p2', title: 'Project 2' },
        ];
        Object.defineProperty(projectServiceMock, 'list$', { get: () => of(projects) });

        const response = await sendRequestAndWait(createRequest('GET', '/projects'));

        expect(response.body.ok).toBe(true);
      });

      it('should filter projects by query', async () => {
        const projects = [
          { id: 'p1', title: 'Work' },
          { id: 'p2', title: 'Personal' },
        ];
        Object.defineProperty(projectServiceMock, 'list$', { get: () => of(projects) });

        const response = await sendRequestAndWait(
          createRequest('GET', '/projects', { query: { query: 'work' } }),
        );

        expect(response.body.ok).toBe(true);
      });
    });
  });

  describe('tag routes', () => {
    beforeEach(() => {
      service.init();
    });

    describe('GET /tags', () => {
      it('should return all tags', async () => {
        const tags = [
          { id: 't1', title: 'Tag 1' },
          { id: 't2', title: 'Tag 2' },
        ];
        Object.defineProperty(tagServiceMock, 'tags$', { get: () => of(tags) });

        const response = await sendRequestAndWait(createRequest('GET', '/tags'));

        expect(response.body.ok).toBe(true);
      });

      it('should filter tags by query', async () => {
        const tags = [
          { id: 't1', title: 'Urgent' },
          { id: 't2', title: 'Important' },
        ];
        Object.defineProperty(tagServiceMock, 'tags$', { get: () => of(tags) });

        const response = await sendRequestAndWait(
          createRequest('GET', '/tags', { query: { query: 'urgent' } }),
        );

        expect(response.body.ok).toBe(true);
      });
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      service.init();
    });

    it('should return 404 for unknown routes', async () => {
      const response = await sendRequestAndWait(createRequest('GET', '/unknown-route'));

      expect(response.body.ok).toBe(false);
      expect(response.status).toBe(404);
      expect((response.body as any).error.code).toBe('NOT_FOUND');
    });

    it('should handle internal errors gracefully', async () => {
      Object.defineProperty(taskServiceMock, 'allTasks$', {
        get: () => {
          throw new Error('Test error');
        },
      });

      const response = await sendRequestAndWait(createRequest('GET', '/tasks'));

      expect(response.body.ok).toBe(false);
      expect(response.status).toBe(500);
      expect((response.body as any).error.code).toBe('INTERNAL_ERROR');
    });
  });
});
