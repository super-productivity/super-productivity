import { TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';
import { LocalRestApiTagRoutesService } from './local-rest-api-tag-routes.service';
import { TagService } from './tag.service';
import { Tag } from './tag.model';
import { DEFAULT_TAG, TODAY_TAG } from './tag.const';
import { DEFAULT_TAG_COLOR } from '../work-context/work-context.const';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../electron/shared-with-frontend/local-rest-api.model';

describe('LocalRestApiTagRoutesService', () => {
  let service: LocalRestApiTagRoutesService;
  let tagServiceMock: jasmine.SpyObj<TagService>;
  let tags: Tag[];

  const createTag = (id: string, overrides: Partial<Tag> = {}): Tag => ({
    ...DEFAULT_TAG,
    id,
    title: `Tag ${id}`,
    ...overrides,
  });

  const createRequest = (
    method: string,
    path: string,
    options: { body?: unknown } = {},
  ): LocalRestApiRequestPayload => ({
    requestId: 'test-request-id',
    method,
    path,
    query: {},
    body: options.body,
  });

  const handle = async (
    request: LocalRestApiRequestPayload,
  ): Promise<LocalRestApiResponsePayload> => {
    const response = await service.handle(request);
    if (!response) {
      throw new Error(`Route not handled: ${request.method} ${request.path}`);
    }
    return response;
  };

  const errorCode = (response: LocalRestApiResponsePayload): string | undefined =>
    response.body.ok ? undefined : response.body.error.code;

  const data = (response: LocalRestApiResponsePayload): unknown =>
    response.body.ok ? response.body.data : undefined;

  beforeEach(() => {
    tags = [
      TODAY_TAG,
      createTag('t1', { title: 'Urgent', color: '#ff0000' }),
      createTag('t2', { title: 'Important' }),
    ];
    tagServiceMock = jasmine.createSpyObj<TagService>('TagService', [
      'addTag',
      'updateTag',
    ]);
    Object.defineProperty(tagServiceMock, 'tags$', {
      get: (): Observable<Tag[]> => of(tags),
    });
    tagServiceMock.addTag.and.callFake((tag: Partial<Tag>) => {
      tags = [...tags, createTag('new-id', tag)];
      return 'new-id';
    });
    tagServiceMock.updateTag.and.callFake((id: string, changes: Partial<Tag>) => {
      tags = tags.map((t) => (t.id === id ? { ...t, ...changes } : t));
    });

    TestBed.configureTestingModule({
      providers: [
        LocalRestApiTagRoutesService,
        { provide: TagService, useValue: tagServiceMock },
      ],
    });
    service = TestBed.inject(LocalRestApiTagRoutesService);
  });

  describe('GET /tags/:id', () => {
    it('should return the tag', async () => {
      const response = await handle(createRequest('GET', '/tags/t2'));

      expect(response.status).toBe(200);
      expect((data(response) as Tag).title).toBe('Important');
    });

    it('should return 404 TAG_NOT_FOUND for unknown and prototype ids', async () => {
      for (const id of ['missing', '__proto__', 'constructor']) {
        const response = await handle(createRequest('GET', `/tags/${id}`));

        expect(response.status).withContext(id).toBe(404);
        expect(errorCode(response)).withContext(id).toBe('TAG_NOT_FOUND');
      }
    });
  });

  describe('POST /tags', () => {
    it('should create a tag from the given fields only', async () => {
      const response = await handle(
        createRequest('POST', '/tags', {
          body: { title: ' Waiting ', icon: 'hourglass_empty', color: '#00AA00' },
        }),
      );

      expect(tagServiceMock.addTag).toHaveBeenCalledOnceWith({
        title: 'Waiting',
        icon: 'hourglass_empty',
        color: '#00AA00',
      });
      expect(response.status).toBe(201);
      expect((data(response) as Tag).id).toBe('new-id');
    });

    it('should ignore fields outside the allowlist', async () => {
      await handle(
        createRequest('POST', '/tags', {
          body: { title: 'X', id: 'own-id', theme: { primary: '#fff' }, created: 1 },
        }),
      );

      expect(tagServiceMock.addTag).toHaveBeenCalledOnceWith({ title: 'X' });
    });

    it('should leave the color to TagService when none is given', async () => {
      await handle(createRequest('POST', '/tags', { body: { title: 'Plain' } }));

      expect(tagServiceMock.addTag).toHaveBeenCalledOnceWith({ title: 'Plain' });
    });

    it('should validate before creating', async () => {
      const cases: [unknown, string][] = [
        [undefined, 'INVALID_INPUT'],
        [{}, 'INVALID_INPUT'],
        [{ title: '  ' }, 'INVALID_INPUT'],
        [{ title: 'X', color: 'green' }, 'INVALID_INPUT'],
        [{ title: 'X', color: null }, 'INVALID_INPUT'],
        [{ title: 'X', icon: false }, 'INVALID_INPUT'],
        [{ title: 'X', taskIds: [] }, 'UNSUPPORTED_FIELD'],
      ];
      for (const [body, code] of cases) {
        const response = await handle(createRequest('POST', '/tags', { body }));

        expect(response.status).withContext(JSON.stringify(body)).toBe(400);
        expect(errorCode(response)).withContext(JSON.stringify(body)).toBe(code);
      }
      expect(tagServiceMock.addTag).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /tags/:id', () => {
    it('should update title and icon', async () => {
      const response = await handle(
        createRequest('PATCH', '/tags/t1', { body: { title: 'Now', icon: null } }),
      );

      expect(tagServiceMock.updateTag).toHaveBeenCalledOnceWith('t1', {
        title: 'Now',
        icon: null,
      });
      expect((data(response) as Tag).title).toBe('Now');
    });

    it('should mirror a color change into a default theme.primary', async () => {
      await handle(createRequest('PATCH', '/tags/t2', { body: { color: '#123456' } }));

      expect(tagServiceMock.updateTag).toHaveBeenCalledOnceWith('t2', {
        color: '#123456',
        theme: { ...DEFAULT_TAG.theme, primary: '#123456' },
      });
    });

    it('should mirror a color change into a theme.primary that follows the color', async () => {
      tags = tags.map((t) =>
        t.id === 't1' ? { ...t, theme: { ...t.theme, primary: '#ff0000' } } : t,
      );

      await handle(createRequest('PATCH', '/tags/t1', { body: { color: '#00ff00' } }));

      expect(tagServiceMock.updateTag.calls.mostRecent().args[1].theme?.primary).toBe(
        '#00ff00',
      );
    });

    it('should keep a deliberately customized theme.primary', async () => {
      tags = tags.map((t) =>
        t.id === 't1' ? { ...t, theme: { ...t.theme, primary: '#0000ff' } } : t,
      );
      expect(DEFAULT_TAG_COLOR).not.toBe('#0000ff');

      await handle(createRequest('PATCH', '/tags/t1', { body: { color: '#00ff00' } }));

      expect(tagServiceMock.updateTag).toHaveBeenCalledOnceWith('t1', {
        color: '#00ff00',
      });
    });

    it('should not dispatch when nothing changes', async () => {
      const response = await handle(createRequest('PATCH', '/tags/t1', { body: {} }));

      expect(response.status).toBe(200);
      expect(tagServiceMock.updateTag).not.toHaveBeenCalled();
    });

    it('should return 404 for an unknown tag', async () => {
      const response = await handle(
        createRequest('PATCH', '/tags/missing', { body: { title: 'X' } }),
      );

      expect(errorCode(response)).toBe('TAG_NOT_FOUND');
      expect(tagServiceMock.updateTag).not.toHaveBeenCalled();
    });

    it('should validate before updating', async () => {
      const cases: [unknown, string][] = [
        [{ title: '' }, 'INVALID_INPUT'],
        [{ color: 'red' }, 'INVALID_INPUT'],
        [{ icon: 1 }, 'INVALID_INPUT'],
        ['x', 'INVALID_INPUT'],
        [{ title: 'X', taskIds: [] }, 'UNSUPPORTED_FIELD'],
      ];
      for (const [body, code] of cases) {
        const response = await handle(createRequest('PATCH', '/tags/t1', { body }));

        expect(response.status).withContext(JSON.stringify(body)).toBe(400);
        expect(errorCode(response)).withContext(JSON.stringify(body)).toBe(code);
      }
      expect(tagServiceMock.updateTag).not.toHaveBeenCalled();
    });

    it('should ignore fields outside the allowlist', async () => {
      await handle(
        createRequest('PATCH', '/tags/t1', {
          body: { title: 'Now', id: 'other', theme: { primary: '#fff' } },
        }),
      );

      expect(tagServiceMock.updateTag).toHaveBeenCalledOnceWith('t1', { title: 'Now' });
    });
  });

  it('should not own other routes', async () => {
    for (const [method, path] of [
      ['GET', '/tags'],
      ['DELETE', '/tags/t1'],
      ['PUT', '/tags'],
      ['GET', '/tags/t1/tasks'],
      ['GET', '/projects'],
      ['GET', '/tagsx'],
    ]) {
      expect(await service.handle(createRequest(method, path)))
        .withContext(`${method} ${path}`)
        .toBeUndefined();
    }
  });
});
