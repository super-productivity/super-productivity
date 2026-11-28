import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject } from 'rxjs';
import { LocalRestApiProjectRoutesService } from './local-rest-api-project-routes.service';
import { ProjectService } from './project.service';
import { Project } from './project.model';
import { INBOX_PROJECT } from './project.const';
import { createProject } from './project.test-helper';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../electron/shared-with-frontend/local-rest-api.model';
import { TaskArchiveService } from '../archive/task-archive.service';
import { DEFAULT_TASK, TaskArchive } from '../tasks/task.model';
import { selectAllTaskRepeatCfgs } from '../task-repeat-cfg/store/task-repeat-cfg.selectors';
import {
  DEFAULT_TASK_REPEAT_CFG,
  TaskRepeatCfg,
} from '../task-repeat-cfg/task-repeat-cfg.model';
import { TimeTrackingService } from '../time-tracking/time-tracking.service';
import { TimeTrackingState } from '../time-tracking/time-tracking.model';

describe('LocalRestApiProjectRoutesService', () => {
  let service: LocalRestApiProjectRoutesService;
  let projectServiceMock: jasmine.SpyObj<ProjectService>;
  let list$: BehaviorSubject<Project[]>;
  let store: MockStore;
  let taskArchiveMock: jasmine.SpyObj<TaskArchiveService>;
  let timeTracking$: BehaviorSubject<TimeTrackingState>;

  const EMPTY_CONTENTS = {
    taskCount: 0,
    backlogTaskCount: 0,
    archivedTaskCount: 0,
    noteCount: 0,
    repeatCfgCount: 0,
    timeTrackingDayCount: 0,
  };

  const archiveWith = (...tasks: { id: string; projectId: string }[]): TaskArchive => ({
    ids: tasks.map((t) => t.id),
    entities: Object.fromEntries(
      tasks.map((t) => [t.id, { ...DEFAULT_TASK, ...t, title: t.id }]),
    ),
  });

  const repeatCfg = (id: string, projectId: string | null): TaskRepeatCfg => ({
    ...DEFAULT_TASK_REPEAT_CFG,
    id,
    projectId,
  });

  /** Time-tracking work start/end for the given days. */
  const workDays = (...days: string[]): Record<string, { s: number; e: number }> =>
    Object.fromEntries(days.map((day) => [day, { s: 1, e: 2 }]));

  const errorOf = (
    response: LocalRestApiResponsePayload,
  ): { message: string; details?: unknown } => {
    if (response.body.ok) {
      throw new Error('Expected an error response');
    }
    return response.body.error;
  };

  const request = (
    method: string,
    path: string,
    body?: unknown,
  ): LocalRestApiRequestPayload => ({
    requestId: 'test-request-id',
    method,
    path,
    query: {},
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

  const expectNoWrite = (): void => {
    expect(projectServiceMock.add).not.toHaveBeenCalled();
    expect(projectServiceMock.update).not.toHaveBeenCalled();
    expect(projectServiceMock.remove).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    // The service's list$ only holds unarchived projects.
    list$ = new BehaviorSubject<Project[]>([
      { ...INBOX_PROJECT, taskIds: [] },
      createProject({ id: 'empty', title: 'Empty', icon: 'list_alt' }),
      createProject({ id: 'withNotes', title: 'With notes', noteIds: ['n1', 'n2'] }),
      createProject({ id: 'withTasks', title: 'With tasks', taskIds: ['t1'] }),
      createProject({
        id: 'withBacklog',
        title: 'With backlog',
        isEnableBacklog: true,
        backlogTaskIds: ['b1'],
      }),
    ]);

    projectServiceMock = jasmine.createSpyObj<ProjectService>(
      'ProjectService',
      ['add', 'update', 'remove'],
      { list$ },
    );
    projectServiceMock.add.and.callFake((project: Partial<Project>) => {
      const id = 'new-project';
      list$.next([...list$.value, createProject({ ...project, id })]);
      return id;
    });
    projectServiceMock.update.and.callFake(
      (id: string, changes: Partial<Project>): void => {
        list$.next(list$.value.map((p) => (p.id === id ? { ...p, ...changes } : p)));
      },
    );
    projectServiceMock.remove.and.resolveTo();

    taskArchiveMock = jasmine.createSpyObj<TaskArchiveService>('TaskArchiveService', [
      'load',
    ]);
    taskArchiveMock.load.and.resolveTo(archiveWith());
    timeTracking$ = new BehaviorSubject<TimeTrackingState>({ project: {}, tag: {} });

    TestBed.configureTestingModule({
      providers: [
        LocalRestApiProjectRoutesService,
        { provide: ProjectService, useValue: projectServiceMock },
        { provide: TaskArchiveService, useValue: taskArchiveMock },
        { provide: TimeTrackingService, useValue: { state$: timeTracking$ } },
        provideMockStore({
          selectors: [{ selector: selectAllTaskRepeatCfgs, value: [] }],
        }),
      ],
    });
    service = TestBed.inject(LocalRestApiProjectRoutesService);
    store = TestBed.inject(MockStore);
  });

  describe('unowned requests', () => {
    it('leaves other paths and methods to the rest of the handler', async () => {
      const unowned = [
        request('GET', '/projects'),
        request('GET', '/projects/empty'),
        request('PUT', '/projects/empty', { title: 'x' }),
        request('POST', '/projects/empty', { title: 'x' }),
        request('PATCH', '/projects', { title: 'x' }),
        request('DELETE', '/projects'),
        request('DELETE', '/projects/empty/extra'),
        request('POST', '/tags', { title: 'x' }),
        request('POST', '/projectsx', { title: 'x' }),
      ];
      for (const req of unowned) {
        expect(await service.handle(req))
          .withContext(`${req.method} ${req.path}`)
          .toBeUndefined();
      }
      expectNoWrite();
    });
  });

  describe('POST /projects', () => {
    it('creates a project with a trimmed title and returns it with 201', async () => {
      const response = await handle(
        request('POST', '/projects', { title: ' Garden  ', icon: 'yard' }),
      );

      expect(response.status).toBe(201);
      expect(projectServiceMock.add).toHaveBeenCalledOnceWith({
        title: 'Garden',
        icon: 'yard',
      });
      const project = data<Project>(response);
      expect(project.id).toBe('new-project');
      expect(project.title).toBe('Garden');
      expect(project.icon).toBe('yard');
    });

    it('leaves the icon to the default when not given', async () => {
      await handle(request('POST', '/projects', { title: 'Plain' }));

      expect(projectServiceMock.add).toHaveBeenCalledOnceWith({ title: 'Plain' });
    });

    it('requires a non-blank title', async () => {
      for (const body of [{}, { icon: 'yard' }, { title: '' }, { title: ' \n ' }]) {
        const response = await handle(request('POST', '/projects', body));
        expect(response.status).withContext(JSON.stringify(body)).toBe(400);
        expect(errorCode(response)).toBe('INVALID_INPUT');
      }
      expectNoWrite();
    });

    it('rejects wrong value types', async () => {
      for (const body of [{ title: ['x'] }, { title: 'X', icon: {} }]) {
        const response = await handle(request('POST', '/projects', body));
        expect(response.status).withContext(JSON.stringify(body)).toBe(400);
        expect(errorCode(response)).toBe('INVALID_INPUT');
      }
      expectNoWrite();
    });

    it('rejects a body that is not an object', async () => {
      for (const body of [undefined, null, 'Garden', [{ title: 'Garden' }], true]) {
        const response = await handle(request('POST', '/projects', body));
        expect(response.status).withContext(String(body)).toBe(400);
        expect(errorCode(response)).toBe('INVALID_INPUT');
      }
      expectNoWrite();
    });

    it('rejects fields other than title and icon', async () => {
      const response = await handle(
        request('POST', '/projects', { title: 'X', taskIds: ['t1'], isArchived: true }),
      );

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('UNSUPPORTED_FIELD');
      expect(response.body.ok ? undefined : response.body.error.details).toEqual({
        fields: ['taskIds', 'isArchived'],
      });
      expectNoWrite();
    });
  });

  describe('PATCH /projects/:id', () => {
    it('updates title and icon and returns the project', async () => {
      const response = await handle(
        request('PATCH', '/projects/empty', { title: ' Renamed ', icon: 'star' }),
      );

      expect(response.status).toBe(200);
      expect(projectServiceMock.update).toHaveBeenCalledOnceWith(
        'empty',
        { title: 'Renamed', icon: 'star' },
        true,
      );
      const project = data<Project>(response);
      expect(project.title).toBe('Renamed');
      expect(project.icon).toBe('star');
    });

    it('accepts a null icon', async () => {
      await handle(request('PATCH', '/projects/empty', { icon: null }));

      expect(projectServiceMock.update).toHaveBeenCalledOnceWith(
        'empty',
        { icon: null },
        true,
      );
    });

    it('returns the unchanged project for an empty body without writing', async () => {
      const response = await handle(request('PATCH', '/projects/empty', {}));

      expect(response.status).toBe(200);
      expect(data<Project>(response).id).toBe('empty');
      expectNoWrite();
    });

    it('returns 404 for an unknown or archived project', async () => {
      const response = await handle(request('PATCH', '/projects/nope', { title: 'X' }));

      expect(response.status).toBe(404);
      expect(errorCode(response)).toBe('PROJECT_NOT_FOUND');
      expectNoWrite();
    });

    it('returns 404 for prototype property names', async () => {
      for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
        const response = await handle(request('PATCH', `/projects/${id}`, { icon: 'x' }));
        expect(response.status).withContext(id).toBe(404);
        expect(errorCode(response)).toBe('PROJECT_NOT_FOUND');
      }
      expectNoWrite();
    });

    it('rejects a blank title', async () => {
      const response = await handle(request('PATCH', '/projects/empty', { title: ' ' }));

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('INVALID_INPUT');
      expectNoWrite();
    });

    it('rejects wrong value types', async () => {
      const response = await handle(request('PATCH', '/projects/empty', { title: 1 }));

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('INVALID_INPUT');
      expectNoWrite();
    });

    it('rejects a body that is not an object', async () => {
      const response = await handle(request('PATCH', '/projects/empty', 'Renamed'));

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('INVALID_INPUT');
      expectNoWrite();
    });

    it('rejects fields other than title and icon', async () => {
      const response = await handle(
        request('PATCH', '/projects/empty', { title: 'X', isHiddenFromMenu: true }),
      );

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('UNSUPPORTED_FIELD');
      expectNoWrite();
    });
  });

  describe('DELETE /projects/:id', () => {
    it('deletes an empty project', async () => {
      const response = await handle(request('DELETE', '/projects/empty'));

      expect(response.status).toBe(200);
      expect(data(response)).toEqual({ deleted: true, id: 'empty' });
      expect(projectServiceMock.remove).toHaveBeenCalledOnceWith(
        jasmine.objectContaining({ id: 'empty' }),
      );
    });

    it('deletes a project whose sections hold nothing', async () => {
      // Sections are not counted: with no tasks left they are empty headings.
      const response = await handle(request('DELETE', '/projects/empty'));

      expect(response.status).toBe(200);
    });

    it('ignores archived tasks, repeat configs and time tracking of other projects', async () => {
      taskArchiveMock.load.and.resolveTo(
        archiveWith({ id: 'a1', projectId: 'withTasks' }),
      );
      store.overrideSelector(selectAllTaskRepeatCfgs, [
        repeatCfg('r1', 'withTasks'),
        repeatCfg('r2', null),
      ]);
      store.refreshState();
      timeTracking$.next({
        project: { withTasks: workDays('2026-10-01') },
        tag: { empty: workDays('2026-10-01') },
      });

      const response = await handle(request('DELETE', '/projects/empty'));

      expect(response.status).toBe(200);
      expect(projectServiceMock.remove).toHaveBeenCalledTimes(1);
    });

    it('refuses a project with notes', async () => {
      const response = await handle(request('DELETE', '/projects/withNotes'));

      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('PROJECT_NOT_EMPTY');
      expect(errorOf(response).details).toEqual({ ...EMPTY_CONTENTS, noteCount: 2 });
      expect(errorOf(response).message).toContain('notes');
      expectNoWrite();
    });

    it('refuses a project with tasks', async () => {
      const response = await handle(request('DELETE', '/projects/withTasks'));

      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('PROJECT_NOT_EMPTY');
      expect(errorOf(response).details).toEqual({ ...EMPTY_CONTENTS, taskCount: 1 });
      expect(errorOf(response).message).toContain('tasks');
      expectNoWrite();
    });

    it('refuses a project with only backlog tasks', async () => {
      const response = await handle(request('DELETE', '/projects/withBacklog'));

      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('PROJECT_NOT_EMPTY');
      expect(errorOf(response).details).toEqual({
        ...EMPTY_CONTENTS,
        backlogTaskCount: 1,
      });
      expect(errorOf(response).message).toContain('backlog tasks');
      expectNoWrite();
    });

    it('refuses a project with archived tasks', async () => {
      taskArchiveMock.load.and.resolveTo(
        archiveWith(
          { id: 'a1', projectId: 'empty' },
          { id: 'a2', projectId: 'empty' },
          { id: 'a3', projectId: 'other' },
        ),
      );

      const response = await handle(request('DELETE', '/projects/empty'));

      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('PROJECT_NOT_EMPTY');
      expect(errorOf(response).details).toEqual({
        ...EMPTY_CONTENTS,
        archivedTaskCount: 2,
      });
      expect(errorOf(response).message).toContain('archived tasks');
      expectNoWrite();
    });

    it('refuses a project with repeat configs', async () => {
      store.overrideSelector(selectAllTaskRepeatCfgs, [
        repeatCfg('r1', 'empty'),
        repeatCfg('r2', 'other'),
      ]);
      store.refreshState();

      const response = await handle(request('DELETE', '/projects/empty'));

      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('PROJECT_NOT_EMPTY');
      expect(errorOf(response).details).toEqual({ ...EMPTY_CONTENTS, repeatCfgCount: 1 });
      expect(errorOf(response).message).toContain('repeat configs');
      expectNoWrite();
    });

    it('refuses a project with time-tracking data and says where it can go', async () => {
      timeTracking$.next({
        project: {
          empty: workDays('2026-10-01', '2026-10-02'),
        },
        tag: {},
      });

      const response = await handle(request('DELETE', '/projects/empty'));

      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('PROJECT_NOT_EMPTY');
      expect(errorOf(response).details).toEqual({
        ...EMPTY_CONTENTS,
        timeTrackingDayCount: 2,
      });
      expect(errorOf(response).message).toContain('time-tracking data');
      expect(errorOf(response).message).toContain('in the app');
      expectNoWrite();
    });

    it('lists every blocker at once', async () => {
      taskArchiveMock.load.and.resolveTo(
        archiveWith({ id: 'a1', projectId: 'withNotes' }),
      );

      const response = await handle(request('DELETE', '/projects/withNotes'));

      expect(errorOf(response).details).toEqual({
        ...EMPTY_CONTENTS,
        archivedTaskCount: 1,
        noteCount: 2,
      });
      expect(errorOf(response).message).toContain('archived tasks, notes');
      expect(errorOf(response).message).not.toContain('in the app');
      expectNoWrite();
    });

    it('refuses the Inbox project, even when empty', async () => {
      const response = await handle(request('DELETE', `/projects/${INBOX_PROJECT.id}`));

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('UNSUPPORTED_FIELD');
      expectNoWrite();
    });

    it('returns 404 for an unknown or archived project', async () => {
      const response = await handle(request('DELETE', '/projects/nope'));

      expect(response.status).toBe(404);
      expect(errorCode(response)).toBe('PROJECT_NOT_FOUND');
      expectNoWrite();
    });

    it('returns 404 for prototype property names', async () => {
      for (const id of ['__proto__', 'constructor', 'valueOf']) {
        const response = await handle(request('DELETE', `/projects/${id}`));
        expect(response.status).withContext(id).toBe(404);
        expect(errorCode(response)).toBe('PROJECT_NOT_FOUND');
      }
      expectNoWrite();
    });
  });
});
