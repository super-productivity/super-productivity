import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';
import { LocalRestApiProjectRoutesService } from './local-rest-api-project-routes.service';
import { ProjectService } from './project.service';
import { Project } from './project.model';
import { INBOX_PROJECT } from './project.const';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../electron/shared-with-frontend/local-rest-api.model';

describe('LocalRestApiProjectRoutesService', () => {
  let service: LocalRestApiProjectRoutesService;
  let projectServiceMock: jasmine.SpyObj<ProjectService>;
  let store: MockStore;
  let dispatchSpy: jasmine.Spy;

  const createProject = (id: string, overrides: Record<string, unknown> = {}): Project =>
    ({
      id,
      title: `Project ${id}`,
      icon: 'list_alt',
      isArchived: false,
      isHiddenFromMenu: false,
      isEnableBacklog: false,
      taskIds: [],
      backlogTaskIds: [],
      noteIds: [],
      advancedCfg: {},
      theme: {},
      ...overrides,
    }) as unknown as Project;

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

  /** Store lookup like the app's: a plain-object map, prototype included. */
  const setProjectStore = (projects: (Project | undefined)[]): void => {
    projectServiceMock.getByIdOnce$.and.callFake((id: string) =>
      of(projects.find((p) => p?.id === id)),
    );
  };

  beforeEach(() => {
    projectServiceMock = jasmine.createSpyObj<ProjectService>('ProjectService', [
      'add',
      'update',
      'remove',
      'getByIdOnce$',
    ]);
    projectServiceMock.add.and.returnValue('new-project-id');
    setProjectStore([]);

    TestBed.configureTestingModule({
      providers: [
        LocalRestApiProjectRoutesService,
        { provide: ProjectService, useValue: projectServiceMock },
        provideMockStore({ initialState: {} }),
      ],
    });
    service = TestBed.inject(LocalRestApiProjectRoutesService);
    store = TestBed.inject(MockStore);
    dispatchSpy = spyOn(store, 'dispatch');
  });

  describe('routing', () => {
    it('does not handle routes it does not own', async () => {
      expect(await service.handle(request('GET', '/tasks'))).toBeUndefined();
      expect(await service.handle(request('GET', '/tags'))).toBeUndefined();
      expect(await service.handle(request('POST', '/projects'))).not.toBeUndefined();
    });

    it('leaves the project list to the core handler', async () => {
      // `GET /projects` is a core route; only the write routes live here.
      expect(await service.handle(request('GET', '/projects'))).toBeUndefined();
    });

    it('ignores project sub-routes it does not know', async () => {
      expect(
        await service.handle(request('POST', '/projects/p1/unknown')),
      ).toBeUndefined();
      expect(
        await service.handle(request('GET', '/projects/p1/unknown')),
      ).toBeUndefined();
    });

    it('answers 405 for a known path with an unsupported verb', async () => {
      // Distinct from the core handler's 404: the route exists, the verb does
      // not. `GET /projects` is core, so PUT here is the feature's to refuse.
      const cases: [string, string, string][] = [
        ['PUT', '/projects', 'GET, POST'],
        ['DELETE', '/projects', 'GET, POST'],
        ['PUT', '/projects/p1', 'GET, PATCH, DELETE'],
        ['POST', '/projects/p1', 'GET, PATCH, DELETE'],
        ['GET', '/projects/p1/archive', 'POST'],
        ['DELETE', '/projects/p1/unarchive', 'POST'],
      ];
      for (const [method, path, allowed] of cases) {
        const response = await service.handle(request(method, path));
        expect(response?.status).toBe(405);
        expect(response?.body.ok).toBe(false);
        expect(response && !response.body.ok ? response.body.error.code : '').toBe(
          'METHOD_NOT_ALLOWED',
        );
        expect(
          response && !response.body.ok ? response.body.error.message : '',
        ).toContain(allowed);
      }
    });
  });

  describe('GET /projects/:id', () => {
    it('returns a project by id', async () => {
      const project = createProject('p1', { title: 'Work' });
      setProjectStore([project]);

      const response = await handle(request('GET', '/projects/p1'));

      expect(response.status).toBe(200);
      expect(data<Project>(response)).toEqual(project);
    });

    it('returns 404 for unknown and prototype ids', async () => {
      for (const id of ['missing', '__proto__', 'constructor']) {
        const response = await handle(request('GET', `/projects/${id}`));
        expect(response.status).toBe(404);
        expect(errorCode(response)).toBe('PROJECT_NOT_FOUND');
      }
    });
  });

  describe('POST /projects', () => {
    it('creates a project and strips unknown fields', async () => {
      const created = createProject('new-project-id', {
        title: 'Symphony',
        icon: 'hub',
      });
      setProjectStore([created]);

      const response = await handle(
        request('POST', '/projects', {
          title: '  Symphony  ',
          icon: 'hub',
          unknownField: 'ignored',
        }),
      );

      expect(response.status).toBe(201);
      expect(projectServiceMock.add).toHaveBeenCalledWith({
        title: 'Symphony',
        icon: 'hub',
      });
      expect(data<Project>(response)).toEqual(created);
    });

    it('does not let an injected id through', async () => {
      setProjectStore([createProject('new-project-id', { title: 'X' })]);

      await handle(request('POST', '/projects', { title: 'X', id: 'injected-id' }));

      expect(projectServiceMock.add).toHaveBeenCalledWith({ title: 'X' });
    });

    it('rejects relational fields with 400 UNSUPPORTED_FIELD and does not create', async () => {
      for (const field of ['taskIds', 'backlogTaskIds', 'noteIds']) {
        const response = await handle(
          request('POST', '/projects', { title: 'X', [field]: [] }),
        );
        expect(response.status).toBe(400);
        expect(errorCode(response)).toBe('UNSUPPORTED_FIELD');
      }
      expect(projectServiceMock.add).not.toHaveBeenCalled();
    });

    it('returns 400 for missing, empty or non-string titles', async () => {
      for (const body of [{ icon: 'hub' }, { title: '   ' }, { title: 123 }]) {
        const response = await handle(request('POST', '/projects', body));
        expect(response.status).toBe(400);
        expect(errorCode(response)).toBe('INVALID_INPUT');
      }
      expect(projectServiceMock.add).not.toHaveBeenCalled();
    });

    it('returns 400 for a wrong-typed flag', async () => {
      const response = await handle(
        request('POST', '/projects', { title: 'X', isEnableBacklog: 'yes' }),
      );

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('INVALID_INPUT');
      expect(response.body.ok ? undefined : response.body.error.details).toBeDefined();
      expect(projectServiceMock.add).not.toHaveBeenCalled();
    });

    it('strips isArchived silently (use /archive instead)', async () => {
      setProjectStore([createProject('new-project-id', { title: 'X' })]);

      const response = await handle(
        request('POST', '/projects', { title: 'X', isArchived: 'true' }),
      );

      // Not in the allowlist: the value is dropped like any unknown field.
      expect(response.body.ok).toBe(true);
      expect(projectServiceMock.add).toHaveBeenCalledWith({ title: 'X' });
    });

    it('returns 400 for a non-object body', async () => {
      const response = await handle(request('POST', '/projects', 'just a string'));

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('INVALID_INPUT');
    });
  });

  describe('PATCH /projects/:id', () => {
    it('updates an existing project', async () => {
      setProjectStore([createProject('p1', { title: 'Old' })]);

      const response = await handle(
        request('PATCH', '/projects/p1', {
          title: '  New  ',
          icon: 'hub',
          unknownField: 'ignored',
        }),
      );

      expect(response.status).toBe(200);
      expect(projectServiceMock.update).toHaveBeenCalledWith('p1', {
        title: 'New',
        icon: 'hub',
      });
    });

    it('returns 404 for unknown and prototype ids', async () => {
      for (const id of ['missing', '__proto__']) {
        const response = await handle(
          request('PATCH', `/projects/${id}`, { title: 'New' }),
        );
        expect(response.status).toBe(404);
        expect(errorCode(response)).toBe('PROJECT_NOT_FOUND');
      }
      expect(projectServiceMock.update).not.toHaveBeenCalled();
    });

    it('rejects relational fields with 400 UNSUPPORTED_FIELD', async () => {
      setProjectStore([createProject('p1')]);

      const response = await handle(
        request('PATCH', '/projects/p1', { taskIds: ['unsafe'] }),
      );

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('UNSUPPORTED_FIELD');
      expect(projectServiceMock.update).not.toHaveBeenCalled();
    });

    it('returns 400 for an empty title and a wrong-typed flag', async () => {
      setProjectStore([createProject('p1')]);

      const emptyTitle = await handle(request('PATCH', '/projects/p1', { title: '  ' }));
      expect(errorCode(emptyTitle)).toBe('INVALID_INPUT');

      const wrongType = await handle(
        request('PATCH', '/projects/p1', { isHiddenFromMenu: 1 }),
      );
      expect(errorCode(wrongType)).toBe('INVALID_INPUT');
      expect(projectServiceMock.update).not.toHaveBeenCalled();
    });

    it('returns 400 when nothing writable is sent, instead of a silent no-op', async () => {
      // A body of only unknown fields (or none) would previously run
      // update(id, {}) and answer 200, indistinguishable from a real update.
      setProjectStore([createProject('p1')]);

      for (const body of [{}, { unknownField: 'ignored' }]) {
        const response = await handle(request('PATCH', '/projects/p1', body));
        expect(response.status).toBe(400);
        expect(errorCode(response)).toBe('INVALID_INPUT');
      }
      expect(projectServiceMock.update).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /projects/:id', () => {
    it('deletes an existing project', async () => {
      const project = createProject('p1');
      setProjectStore([project]);

      const response = await handle(request('DELETE', '/projects/p1'));

      expect(response.status).toBe(200);
      expect(data<unknown>(response)).toEqual({ id: 'p1', deleted: true });
      expect(projectServiceMock.remove).toHaveBeenCalledOnceWith(project);
    });

    it('returns 404 for unknown and prototype ids', async () => {
      for (const id of ['missing', '__proto__']) {
        const response = await handle(request('DELETE', `/projects/${id}`));
        expect(response.status).toBe(404);
        expect(errorCode(response)).toBe('PROJECT_NOT_FOUND');
      }
      expect(projectServiceMock.remove).not.toHaveBeenCalled();
    });

    it('rejects deleting the Inbox', async () => {
      // Uses the real constant, not a literal: the Inbox id is INBOX_PROJECT.id.
      setProjectStore([createProject(INBOX_PROJECT.id)]);

      const response = await handle(request('DELETE', `/projects/${INBOX_PROJECT.id}`));

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('UNSUPPORTED_FIELD');
      expect(projectServiceMock.remove).not.toHaveBeenCalled();
    });
  });

  describe('POST /projects/:id/archive and /unarchive', () => {
    it('archives an active project via the dedicated action', async () => {
      setProjectStore([createProject('p1', { isArchived: false })]);

      const response = await handle(request('POST', '/projects/p1/archive'));

      expect(response.status).toBe(200);
      expect(data<unknown>(response)).toEqual({ id: 'p1', archived: true });
      expect(dispatchSpy).toHaveBeenCalledOnceWith(
        jasmine.objectContaining({ id: 'p1' }),
      );
    });

    it('unarchives an archived project', async () => {
      setProjectStore([createProject('p1', { isArchived: true })]);

      const response = await handle(request('POST', '/projects/p1/unarchive'));

      expect(response.status).toBe(200);
      expect(data<unknown>(response)).toEqual({ id: 'p1', archived: false });
    });

    it('is idempotent when already in the requested state', async () => {
      setProjectStore([createProject('p1', { isArchived: true })]);

      const response = await handle(request('POST', '/projects/p1/archive'));

      expect(response.status).toBe(200);
      expect(data<unknown>(response)).toEqual({ id: 'p1', archived: true });
      // No dispatch for a no-op: the state already matches.
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('rejects archiving the Inbox before dispatching anything', async () => {
      // The project reducer ignores archiveProject for the Inbox, so the
      // endpoint must refuse rather than answer 200 for a change that never
      // happens. The Inbox is present: this is a rejection, not a not-found.
      setProjectStore([createProject(INBOX_PROJECT.id, { isArchived: false })]);

      const response = await handle(
        request('POST', `/projects/${INBOX_PROJECT.id}/archive`),
      );

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('UNSUPPORTED_FIELD');
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('returns 404 for unknown and prototype ids', async () => {
      for (const id of ['missing', '__proto__']) {
        const response = await handle(request('POST', `/projects/${id}/archive`));
        expect(response.status).toBe(404);
        expect(errorCode(response)).toBe('PROJECT_NOT_FOUND');
      }
      expect(dispatchSpy).not.toHaveBeenCalled();
    });
  });
});
