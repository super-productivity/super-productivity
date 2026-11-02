import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import { LocalRestApiRouterService } from './local-rest-api-router.service';
import { ProjectService } from '../../features/project/project.service';
import { TagService } from '../../features/tag/tag.service';
import {
  LOCAL_REST_API_FEATURE_ROUTES,
  LocalRestApiFeatureRoutes,
} from './local-rest-api-feature-routes';
import { DataInitStateService } from '../data-init/data-init-state.service';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../electron/shared-with-frontend/local-rest-api.model';

describe('LocalRestApiRouterService', () => {
  let isDataLoaded$: BehaviorSubject<boolean>;
  let service: LocalRestApiRouterService;
  let projectServiceMock: jasmine.SpyObj<ProjectService>;
  let tagServiceMock: jasmine.SpyObj<TagService>;
  let featureRoutes: LocalRestApiFeatureRoutes[];
  let requestHandler: ((payload: LocalRestApiRequestPayload) => void) | null = null;
  let responsePromiseResolve: ((response: LocalRestApiResponsePayload) => void) | null =
    null;

  const okResponse: LocalRestApiResponsePayload = {
    requestId: 'test-request-id',
    status: 200,
    body: { ok: true, data: null },
  };

  const createFeatureRoutes = (
    response?: LocalRestApiResponsePayload,
  ): jasmine.SpyObj<LocalRestApiFeatureRoutes> => {
    const routes = jasmine.createSpyObj<LocalRestApiFeatureRoutes>('FeatureRoutes', [
      'handle',
    ]);
    routes.handle.and.resolveTo(response);
    return routes;
  };

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

  beforeEach(() => {
    requestHandler = null;
    responsePromiseResolve = null;

    mockElectronApi();

    projectServiceMock = jasmine.createSpyObj('ProjectService', [], {
      list$: of([]),
    });

    tagServiceMock = jasmine.createSpyObj('TagService', [], {
      tags$: of([]),
    });

    featureRoutes = [];

    isDataLoaded$ = new BehaviorSubject<boolean>(true);

    TestBed.configureTestingModule({
      providers: [
        LocalRestApiRouterService,
        { provide: ProjectService, useValue: projectServiceMock },
        { provide: TagService, useValue: tagServiceMock },
        { provide: LOCAL_REST_API_FEATURE_ROUTES, useValue: featureRoutes },
        {
          provide: DataInitStateService,
          useValue: { isAllDataLoadedInitially$: isDataLoaded$ },
        },
      ],
    });

    service = TestBed.inject(LocalRestApiRouterService);
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

  describe('readiness', () => {
    beforeEach(() => {
      service.init();
    });

    it('answers APP_NOT_READY until the app data has loaded', async () => {
      const routes = createFeatureRoutes(okResponse);
      featureRoutes.push(routes);

      isDataLoaded$.next(false);
      const notReady = await sendRequestAndWait(createRequest('GET', '/tasks'));
      expect(notReady.status).toBe(503);
      expect(notReady.body).toEqual(
        jasmine.objectContaining({
          ok: false,
          error: jasmine.objectContaining({ code: 'APP_NOT_READY' }),
        }),
      );
      expect(routes.handle).not.toHaveBeenCalled();

      isDataLoaded$.next(true);
      const ready = await sendRequestAndWait(createRequest('GET', '/tasks'));
      expect(ready.status).toBe(200);
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

  describe('feature routes', () => {
    beforeEach(() => {
      service.init();
    });

    it('should answer with the first feature route that handles the request', async () => {
      const featureResponse: LocalRestApiResponsePayload = {
        requestId: 'test-request-id',
        status: 200,
        body: { ok: true, data: { handled: true } },
      };
      const notMine = createFeatureRoutes(undefined);
      const mine = createFeatureRoutes(featureResponse);
      const after = createFeatureRoutes(featureResponse);
      featureRoutes.push(notMine, mine, after);
      const request = createRequest('GET', '/feature-things');

      const response = await sendRequestAndWait(request);

      expect(response).toEqual(featureResponse);
      expect(notMine.handle).toHaveBeenCalledWith(request);
      expect(mine.handle).toHaveBeenCalledWith(request);
      expect(after.handle).not.toHaveBeenCalled();
    });

    it('should return 404 when no feature route handles the request', async () => {
      featureRoutes.push(createFeatureRoutes(undefined));

      const response = await sendRequestAndWait(createRequest('GET', '/feature-things'));

      expect(response.status).toBe(404);
      expect((response.body as any).error.code).toBe('NOT_FOUND');
    });

    it('should not ask feature routes about core routes', async () => {
      const routes = createFeatureRoutes(undefined);
      featureRoutes.push(routes);

      const response = await sendRequestAndWait(createRequest('GET', '/tags'));

      expect(response.status).toBe(200);
      expect(routes.handle).not.toHaveBeenCalled();
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
      const routes = createFeatureRoutes();
      routes.handle.and.rejectWith(new Error('Test error'));
      featureRoutes.push(routes);

      const response = await sendRequestAndWait(createRequest('GET', '/tasks'));

      expect(response.body.ok).toBe(false);
      expect(response.status).toBe(500);
      expect((response.body as any).error.code).toBe('INTERNAL_ERROR');
    });
  });
});
