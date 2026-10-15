import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { LocalRestApiTagRoutesService } from './local-rest-api-tag-routes.service';
import { TagService } from './tag.service';
import { Tag } from './tag.model';
import {
  DEFAULT_TAG,
  IMPORTANT_TAG,
  IN_PROGRESS_TAG,
  TODAY_TAG,
  URGENT_TAG,
} from './tag.const';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../electron/shared-with-frontend/local-rest-api.model';

describe('LocalRestApiTagRoutesService', () => {
  let service: LocalRestApiTagRoutesService;
  let tagServiceMock: jasmine.SpyObj<TagService>;
  let tags$: BehaviorSubject<Tag[]>;

  const createTag = (id: string, overrides: Partial<Tag> = {}): Tag => ({
    ...DEFAULT_TAG,
    id,
    title: `Tag ${id}`,
    ...overrides,
  });

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
    expect(tagServiceMock.addTag).not.toHaveBeenCalled();
    expect(tagServiceMock.updateTag).not.toHaveBeenCalled();
    expect(tagServiceMock.deleteTag).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    tags$ = new BehaviorSubject<Tag[]>([
      { ...TODAY_TAG },
      createTag('t1', { icon: 'label' }),
      { ...URGENT_TAG },
      { ...IMPORTANT_TAG },
      { ...IN_PROGRESS_TAG },
    ]);

    tagServiceMock = jasmine.createSpyObj<TagService>(
      'TagService',
      ['addTag', 'updateTag', 'deleteTag'],
      { tags$ },
    );
    tagServiceMock.addTag.and.callFake((tag: Partial<Tag>) => {
      const id = 'new-tag';
      tags$.next([...tags$.value, createTag(id, { icon: null, ...tag })]);
      return id;
    });
    tagServiceMock.updateTag.and.callFake((id: string, changes: Partial<Tag>) => {
      tags$.next(tags$.value.map((t) => (t.id === id ? { ...t, ...changes } : t)));
    });

    TestBed.configureTestingModule({
      providers: [
        LocalRestApiTagRoutesService,
        { provide: TagService, useValue: tagServiceMock },
      ],
    });
    service = TestBed.inject(LocalRestApiTagRoutesService);
  });

  describe('unowned requests', () => {
    it('leaves other paths and methods to the rest of the handler', async () => {
      const unowned = [
        request('GET', '/tags'),
        request('GET', '/tags/t1'),
        request('PUT', '/tags/t1', { title: 'x' }),
        request('POST', '/tags/t1', { title: 'x' }),
        request('PATCH', '/tags', { title: 'x' }),
        request('DELETE', '/tags'),
        request('DELETE', '/tags/t1/extra'),
        request('POST', '/projects', { title: 'x' }),
        request('POST', '/tagsx', { title: 'x' }),
      ];
      for (const req of unowned) {
        expect(await service.handle(req))
          .withContext(`${req.method} ${req.path}`)
          .toBeUndefined();
      }
      expectNoWrite();
    });
  });

  describe('POST /tags', () => {
    it('creates a tag with a trimmed title and returns it with 201', async () => {
      const response = await handle(
        request('POST', '/tags', { title: '  Errands ', icon: 'shopping_cart' }),
      );

      expect(response.status).toBe(201);
      expect(tagServiceMock.addTag).toHaveBeenCalledOnceWith({
        title: 'Errands',
        icon: 'shopping_cart',
      });
      const tag = data<Tag>(response);
      expect(tag.id).toBe('new-tag');
      expect(tag.title).toBe('Errands');
      expect(tag.icon).toBe('shopping_cart');
    });

    it('leaves the icon to the default when not given', async () => {
      await handle(request('POST', '/tags', { title: 'Plain' }));

      expect(tagServiceMock.addTag).toHaveBeenCalledOnceWith({ title: 'Plain' });
    });

    it('accepts a null icon', async () => {
      const response = await handle(request('POST', '/tags', { title: 'X', icon: null }));

      expect(response.status).toBe(201);
      expect(tagServiceMock.addTag).toHaveBeenCalledOnceWith({ title: 'X', icon: null });
    });

    it('strips a leading # like the task editor and short syntax do', async () => {
      for (const title of ['#errands', ' ## errands ']) {
        tagServiceMock.addTag.calls.reset();
        tags$.next(tags$.value.filter((t) => t.id !== 'new-tag'));

        const response = await handle(request('POST', '/tags', { title }));

        expect(response.status).withContext(title).toBe(201);
        expect(tagServiceMock.addTag).toHaveBeenCalledOnceWith({ title: 'errands' });
      }
    });

    it('keeps a # inside the title', async () => {
      await handle(request('POST', '/tags', { title: 'C#' }));

      expect(tagServiceMock.addTag).toHaveBeenCalledOnceWith({ title: 'C#' });
    });

    it('rejects a title that is only #', async () => {
      for (const title of ['#', ' # ', '###']) {
        const response = await handle(request('POST', '/tags', { title }));
        expect(response.status).withContext(title).toBe(400);
        expect(errorCode(response)).toBe('INVALID_INPUT');
      }
      expectNoWrite();
    });

    it('refuses a title an existing tag has, ignoring case and a leading #', async () => {
      for (const title of ['Tag t1', 'tag T1', '#TAG T1', ' Tag t1 ']) {
        const response = await handle(request('POST', '/tags', { title }));
        expect(response.status).withContext(title).toBe(409);
        expect(errorCode(response)).toBe('TAG_EXISTS');
        expect(response.body.ok ? undefined : response.body.error.details).toEqual({
          id: 't1',
          title: 'Tag t1',
        });
      }
      expectNoWrite();
    });

    it('refuses the title of a built-in tag', async () => {
      const response = await handle(request('POST', '/tags', { title: TODAY_TAG.title }));

      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('TAG_EXISTS');
      expectNoWrite();
    });

    it('requires a title', async () => {
      const response = await handle(request('POST', '/tags', { icon: 'label' }));

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('INVALID_INPUT');
      expectNoWrite();
    });

    it('rejects a blank title', async () => {
      const response = await handle(request('POST', '/tags', { title: '   ' }));

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('INVALID_INPUT');
      expectNoWrite();
    });

    it('rejects wrong value types', async () => {
      for (const body of [{ title: 42 }, { title: 'X', icon: 7 }]) {
        const response = await handle(request('POST', '/tags', body));
        expect(response.status).withContext(JSON.stringify(body)).toBe(400);
        expect(errorCode(response)).toBe('INVALID_INPUT');
      }
      expectNoWrite();
    });

    it('rejects a body that is not an object', async () => {
      for (const body of [undefined, null, 'Errands', ['Errands'], 3]) {
        const response = await handle(request('POST', '/tags', body));
        expect(response.status).withContext(String(body)).toBe(400);
        expect(errorCode(response)).toBe('INVALID_INPUT');
      }
      expectNoWrite();
    });

    it('rejects fields other than title and icon', async () => {
      const response = await handle(
        request('POST', '/tags', { title: 'X', color: '#fff', id: 'mine' }),
      );

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('UNSUPPORTED_FIELD');
      expect(response.body.ok ? undefined : response.body.error.details).toEqual({
        fields: ['color', 'id'],
      });
      expectNoWrite();
    });
  });

  describe('PATCH /tags/:id', () => {
    it('updates title and icon and returns the tag', async () => {
      const response = await handle(
        request('PATCH', '/tags/t1', { title: ' Renamed ', icon: null }),
      );

      expect(response.status).toBe(200);
      expect(tagServiceMock.updateTag).toHaveBeenCalledOnceWith(
        't1',
        { title: 'Renamed', icon: null },
        true,
      );
      const tag = data<Tag>(response);
      expect(tag.title).toBe('Renamed');
      expect(tag.icon).toBeNull();
    });

    it('updates only the icon', async () => {
      await handle(request('PATCH', '/tags/t1', { icon: 'star' }));

      expect(tagServiceMock.updateTag).toHaveBeenCalledOnceWith(
        't1',
        { icon: 'star' },
        true,
      );
    });

    it('strips a leading # from a new title', async () => {
      await handle(request('PATCH', '/tags/t1', { title: '#renamed' }));

      expect(tagServiceMock.updateTag).toHaveBeenCalledOnceWith(
        't1',
        { title: 'renamed' },
        true,
      );
    });

    it('rejects a new title that is only #', async () => {
      const response = await handle(request('PATCH', '/tags/t1', { title: '#' }));

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('INVALID_INPUT');
      expectNoWrite();
    });

    it('refuses renaming to the title of another tag', async () => {
      tags$.next([...tags$.value, createTag('t2', { title: 'Errands' })]);

      const response = await handle(request('PATCH', '/tags/t1', { title: '#errands' }));

      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('TAG_EXISTS');
      expect(response.body.ok ? undefined : response.body.error.details).toEqual({
        id: 't2',
        title: 'Errands',
      });
      expectNoWrite();
    });

    it('allows changing the case of its own title', async () => {
      const response = await handle(request('PATCH', '/tags/t1', { title: 'TAG T1' }));

      expect(response.status).toBe(200);
      expect(data<Tag>(response).title).toBe('TAG T1');
    });

    it('returns the unchanged tag for an empty body without writing', async () => {
      const response = await handle(request('PATCH', '/tags/t1', {}));

      expect(response.status).toBe(200);
      expect(data<Tag>(response).id).toBe('t1');
      expectNoWrite();
    });

    it('can rename a board tag', async () => {
      const response = await handle(
        request('PATCH', `/tags/${URGENT_TAG.id}`, { title: 'asap' }),
      );

      expect(response.status).toBe(200);
      expect(data<Tag>(response).title).toBe('asap');
    });

    it('refuses the Today tag', async () => {
      const response = await handle(
        request('PATCH', `/tags/${TODAY_TAG.id}`, { title: 'Now' }),
      );

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('UNSUPPORTED_FIELD');
      expectNoWrite();
    });

    it('returns 404 for an unknown tag', async () => {
      const response = await handle(request('PATCH', '/tags/nope', { title: 'X' }));

      expect(response.status).toBe(404);
      expect(errorCode(response)).toBe('TAG_NOT_FOUND');
      expectNoWrite();
    });

    it('returns 404 for prototype property names', async () => {
      for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
        const response = await handle(request('PATCH', `/tags/${id}`, { title: 'X' }));
        expect(response.status).withContext(id).toBe(404);
        expect(errorCode(response)).toBe('TAG_NOT_FOUND');
      }
      expectNoWrite();
    });

    it('rejects a blank title', async () => {
      const response = await handle(request('PATCH', '/tags/t1', { title: '' }));

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('INVALID_INPUT');
      expectNoWrite();
    });

    it('rejects wrong value types', async () => {
      const response = await handle(request('PATCH', '/tags/t1', { icon: true }));

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('INVALID_INPUT');
      expectNoWrite();
    });

    it('rejects a body that is not an object', async () => {
      const response = await handle(request('PATCH', '/tags/t1', ['title']));

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('INVALID_INPUT');
      expectNoWrite();
    });

    it('rejects fields other than title and icon', async () => {
      const response = await handle(request('PATCH', '/tags/t1', { taskIds: ['a'] }));

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('UNSUPPORTED_FIELD');
      expectNoWrite();
    });
  });

  describe('DELETE /tags/:id', () => {
    it('deletes the tag', async () => {
      const response = await handle(request('DELETE', '/tags/t1'));

      expect(response.status).toBe(200);
      expect(data(response)).toEqual({ deleted: true, id: 't1' });
      expect(tagServiceMock.deleteTag).toHaveBeenCalledOnceWith('t1');
    });

    it('deletes board tags, as the UI allows', async () => {
      for (const id of [URGENT_TAG.id, IMPORTANT_TAG.id, IN_PROGRESS_TAG.id]) {
        const response = await handle(request('DELETE', `/tags/${id}`));
        expect(response.status).withContext(id).toBe(200);
        expect(tagServiceMock.deleteTag).toHaveBeenCalledWith(id);
      }
    });

    it('refuses the Today tag', async () => {
      const response = await handle(request('DELETE', `/tags/${TODAY_TAG.id}`));

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('UNSUPPORTED_FIELD');
      expectNoWrite();
    });

    it('returns 404 for an unknown tag', async () => {
      const response = await handle(request('DELETE', '/tags/nope'));

      expect(response.status).toBe(404);
      expect(errorCode(response)).toBe('TAG_NOT_FOUND');
      expectNoWrite();
    });

    it('returns 404 for prototype property names', async () => {
      for (const id of ['__proto__', 'constructor', 'valueOf']) {
        const response = await handle(request('DELETE', `/tags/${id}`));
        expect(response.status).withContext(id).toBe(404);
        expect(errorCode(response)).toBe('TAG_NOT_FOUND');
      }
      expectNoWrite();
    });
  });
});
