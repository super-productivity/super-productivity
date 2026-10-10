import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import type { HttpOptions } from '@capacitor/core';
import {
  PLAINSPACE_NATIVE_HTTP,
  PlainspaceApiService,
  PlainspaceNativeHttp,
} from './plainspace-api.service';
import { Log } from '../../../../core/log';
import { PlainspaceCfg } from './plainspace.model';
import { DEFAULT_PLAINSPACE_CFG } from './plainspace-cfg-form.const';

// Covers the real Plainspace integration API: PAT auth, the SPTask -> internal
// PlainspaceIssue mapping, per-space scoping, claim/create, and fail-soft reads.
describe('PlainspaceApiService', () => {
  let service: PlainspaceApiService;
  let httpMock: HttpTestingController;

  const cfg: PlainspaceCfg = {
    ...DEFAULT_PLAINSPACE_CFG,
    host: 'https://plainspace.org',
    spaceId: 'space-1',
    token: 'pat_test',
  };
  const BASE = 'https://plainspace.org/api/integration';

  const spTask = (
    id: string,
    projectId: string,
    done = false,
    scheduledAt: string | null = null,
    isRecurring = false,
  ): SPTaskLike => ({
    id,
    title: `Task ${id}`,
    done,
    projectId,
    projectName: 'P',
    projectSlug: 'p',
    listId: 'l',
    url: `https://plainspace.org/p/item/${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    scheduledAt,
    isRecurring,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [PlainspaceApiService],
    });
    service = TestBed.inject(PlainspaceApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('getMyTasks$ sends the PAT, keeps only this space, and maps to PlainspaceIssue', async () => {
    const p = firstValueFrom(service.getMyTasks$(cfg));
    const req = httpMock.expectOne(`${BASE}/tasks`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer pat_test');
    req.flush({ tasks: [spTask('a', 'space-1', true), spTask('b', 'other')] });
    const tasks = await p;
    expect(tasks.map((t) => t.id)).toEqual(['a']);
    expect(tasks[0].isDone).toBe(true);
    expect(tasks[0].url).toBe('https://plainspace.org/p/item/a');
  });

  it('getUnclaimedTasks$ fetches the claim pool and keeps only this space', async () => {
    const p = firstValueFrom(service.getUnclaimedTasks$(cfg));
    const req = httpMock.expectOne(`${BASE}/claimable-tasks`);
    req.flush({ tasks: [spTask('u1', 'space-1'), spTask('u2', 'other')] });
    expect((await p).map((t) => t.id)).toEqual(['u1']);
  });

  it('getMyTasks$ matches the bound space by slug, not just the id', async () => {
    const slugCfg: PlainspaceCfg = { ...cfg, spaceId: 'my-slug' };
    const p = firstValueFrom(service.getMyTasks$(slugCfg));
    const req = httpMock.expectOne(`${BASE}/tasks`);
    req.flush({
      tasks: [
        { ...spTask('a', 'uuid-1'), projectSlug: 'my-slug' },
        { ...spTask('b', 'uuid-2'), projectSlug: 'other-slug' },
      ],
    });
    expect((await p).map((t) => t.id)).toEqual(['a']);
  });

  it('claimTask$ POSTs to the claim endpoint and maps the task', async () => {
    const p = firstValueFrom(service.claimTask$('u1', cfg));
    const req = httpMock.expectOne(`${BASE}/tasks/u1/claim`);
    expect(req.request.method).toBe('POST');
    req.flush({ task: spTask('u1', 'space-1') });
    expect((await p)?.id).toBe('u1');
  });

  it('getById$ returns null on 404', async () => {
    const p = firstValueFrom(service.getById$('missing', cfg));
    httpMock
      .expectOne(`${BASE}/tasks/missing`)
      .flush({ error: 'Task not found' }, { status: 404, statusText: 'Not Found' });
    expect(await p).toBeNull();
  });

  it('patchTask$ PATCHes completion and maps its confirmation', async () => {
    const p = firstValueFrom(service.patchTask$('a', { done: true }, cfg));
    const req = httpMock.expectOne(`${BASE}/tasks/a`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ done: true });
    req.flush({ task: spTask('a', 'space-1', true) });
    const issue = await p;
    expect(issue?.isDone).toBe(true);
  });

  it('patchTask$ reports a failed completion update as null', async () => {
    const p = firstValueFrom(service.patchTask$('a', { done: true }, cfg));
    httpMock
      .expectOne(`${BASE}/tasks/a`)
      .flush('boom', { status: 500, statusText: 'Server Error' });
    expect(await p).toBeNull();
  });

  it('patchTask$ accepts a minimal completion confirmation', async () => {
    const p = firstValueFrom(service.patchTask$('a', { done: true }, cfg));
    httpMock.expectOne(`${BASE}/tasks/a`).flush({ task: { id: 'a', done: true } });
    expect(await p).toEqual({ id: 'a', isDone: true });
  });

  it('patchTask$ rejects a malformed completion confirmation', async () => {
    const p = firstValueFrom(service.patchTask$('a', { done: true }, cfg));
    httpMock.expectOne(`${BASE}/tasks/a`).flush({ task: { id: 'a', done: 'yes' } });
    expect(await p).toBeNull();
  });

  // #9988: the connect dialog must be able to tell "the server rejected this
  // token" from "we never got an answer" — collapsing both into one message is
  // what made a transport failure look like a mistyped token.
  it('verifyToken$ reports ok with the account on a valid token', async () => {
    const p = firstValueFrom(service.verifyToken$(cfg));
    const req = httpMock.expectOne(`${BASE}/me`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer pat_test');
    req.flush({ email: 'a@b.c', projects: [] });
    expect(await p).toEqual({ status: 'ok', me: { email: 'a@b.c', projects: [] } });
  });

  [401, 403].forEach((status) => {
    it(`verifyToken$ reports invalid-token on ${status}`, async () => {
      const p = firstValueFrom(service.verifyToken$(cfg));
      httpMock.expectOne(`${BASE}/me`).flush('nope', { status, statusText: 'x' });
      expect(await p).toEqual({ status: 'invalid-token' });
    });
  });

  it('verifyToken$ reports unreachable when there is no response at all', async () => {
    const p = firstValueFrom(service.verifyToken$(cfg));
    httpMock.expectOne(`${BASE}/me`).error(new ProgressEvent('error'), { status: 0 });
    expect(await p).toEqual({ status: 'unreachable' });
  });

  // An empty body is no verdict on the token: HttpClient emits null for it, and
  // treating that as `ok` crashed connect() on `me.email` (#9988 follow-up).
  it('verifyToken$ reports unreachable on a 204 with no body', async () => {
    const p = firstValueFrom(service.verifyToken$(cfg));
    httpMock
      .expectOne(`${BASE}/me`)
      .flush(null, { status: 204, statusText: 'No Content' });
    expect(await p).toEqual({ status: 'unreachable' });
  });

  it('verifyToken$ reports unreachable on a 200 with an empty body', async () => {
    const p = firstValueFrom(service.verifyToken$(cfg));
    httpMock.expectOne(`${BASE}/me`).flush(null);
    expect(await p).toEqual({ status: 'unreachable' });
  });

  [500, 502, 404].forEach((status) => {
    it(`verifyToken$ reports unreachable on ${status} (no verdict on the token)`, async () => {
      const p = firstValueFrom(service.verifyToken$(cfg));
      httpMock.expectOne(`${BASE}/me`).flush('boom', { status, statusText: 'x' });
      expect(await p).toEqual({ status: 'unreachable' });
    });
  });

  it('getSpaces$ maps the account spaces from /me', async () => {
    const p = firstValueFrom(service.getSpaces$(cfg));
    const req = httpMock.expectOne(`${BASE}/me`);
    req.flush({
      email: 'a@b.c',
      projects: [
        { id: 'p1', name: 'One', slug: 'one', memberDisplayName: 'Me', role: 'admin' },
        { id: 'p2', name: 'Two', slug: 'two', memberDisplayName: 'Me', role: 'member' },
      ],
    });
    expect(await p).toEqual([
      { id: 'p1', name: 'One', slug: 'one' },
      { id: 'p2', name: 'Two', slug: 'two' },
    ]);
  });

  it('getSpaces$ returns null on error (so callers can tell error from empty)', async () => {
    const p = firstValueFrom(service.getSpaces$(cfg));
    httpMock
      .expectOne(`${BASE}/me`)
      .flush('boom', { status: 500, statusText: 'Server Error' });
    expect(await p).toBeNull();
  });

  it('getSpaceUrl$ resolves {host}/{slug} by matching the stored space id', async () => {
    const p = firstValueFrom(service.getSpaceUrl$({ ...cfg, spaceId: 'p2' }));
    const req = httpMock.expectOne(`${BASE}/me`);
    req.flush({
      email: 'a@b.c',
      projects: [
        { id: 'p1', name: 'One', slug: 'one', memberDisplayName: 'Me', role: 'admin' },
        { id: 'p2', name: 'Two', slug: 'two', memberDisplayName: 'Me', role: 'member' },
      ],
    });
    expect(await p).toBe('https://plainspace.org/two');
  });

  it('getSpaceUrl$ also matches the bound space by slug', async () => {
    const p = firstValueFrom(service.getSpaceUrl$({ ...cfg, spaceId: 'two' }));
    httpMock.expectOne(`${BASE}/me`).flush({
      email: 'a@b.c',
      projects: [
        { id: 'p2', name: 'Two', slug: 'two', memberDisplayName: 'Me', role: 'member' },
      ],
    });
    expect(await p).toBe('https://plainspace.org/two');
  });

  it('getSpaceUrl$ returns null when the space is not in the account', async () => {
    const p = firstValueFrom(service.getSpaceUrl$({ ...cfg, spaceId: 'gone' }));
    httpMock.expectOne(`${BASE}/me`).flush({ email: 'a@b.c', projects: [] });
    expect(await p).toBeNull();
  });

  it('getSpaceUrl$ returns null on error (offline / invalid token)', async () => {
    const p = firstValueFrom(service.getSpaceUrl$(cfg));
    httpMock
      .expectOne(`${BASE}/me`)
      .flush('boom', { status: 401, statusText: 'Unauthorized' });
    expect(await p).toBeNull();
  });

  it('getSpaceUrl$ returns null (no throw) on a malformed /me body', async () => {
    const p = firstValueFrom(service.getSpaceUrl$({ ...cfg, spaceId: 'p2' }));
    // 200 with a non-array `projects` — not caught by getMe$'s HTTP catchError.
    httpMock.expectOne(`${BASE}/me`).flush({ email: 'a@b.c' });
    expect(await p).toBeNull();
  });

  it('getSpaceUrl$ returns null when the matched space has a blank slug', async () => {
    const p = firstValueFrom(service.getSpaceUrl$({ ...cfg, spaceId: 'p2' }));
    httpMock.expectOne(`${BASE}/me`).flush({
      email: 'a@b.c',
      projects: [
        { id: 'p2', name: 'Two', slug: '', memberDisplayName: 'Me', role: 'member' },
      ],
    });
    expect(await p).toBeNull();
  });

  it('getSpaceUrl$ returns null without a request when host/spaceId are missing', async () => {
    expect(
      await firstValueFrom(service.getSpaceUrl$({ ...cfg, spaceId: null })),
    ).toBeNull();
    // httpMock.verify() in afterEach asserts no /me call was made.
  });

  it('creates a space, keeps its UUID for the provider, and resolves its slug for opening', async () => {
    const p = firstValueFrom(service.createSpace$('My Space', cfg));
    const req = httpMock.expectOne(`${BASE}/spaces`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'My Space' });
    const project = { id: 'proj-new', name: 'My Space', slug: 'new-space-slug' };
    const url = 'https://plainspace.org/new-space-slug';
    req.flush({ project, url, memberId: 'm' });
    const created = await p;
    expect(created.id).toBe(project.id);

    const openedUrl = firstValueFrom(
      service.getSpaceUrl$({ ...cfg, spaceId: created.id }),
    );
    httpMock.expectOne(`${BASE}/me`).flush({
      email: 'me@example.com',
      projects: [{ ...project, memberDisplayName: 'Me', role: 'admin' }],
    });
    expect(await openedUrl).toBe(url);
  });

  for (const status of [401, 429, 500]) {
    it(`propagates space creation errors (${status}) so the share flow can report them`, async () => {
      const created = firstValueFrom(service.createSpace$('My Space', cfg));
      httpMock
        .expectOne(`${BASE}/spaces`)
        .flush({ error: 'Cannot create space' }, { status, statusText: 'API error' });

      await expectAsync(created).toBeRejected();
    });
  }

  it('createTask$ POSTs { spaceId, title } and maps the created task', async () => {
    const p = firstValueFrom(service.createTask$('Buy milk', cfg));
    const req = httpMock.expectOne(`${BASE}/tasks`);
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Authorization')).toBe('Bearer pat_test');
    expect(req.request.body).toEqual({ spaceId: 'space-1', title: 'Buy milk' });
    req.flush({ task: { ...spTask('new-1', 'space-1'), title: 'Buy milk' } });
    const issue = await p;
    expect(issue.id).toBe('new-1');
    expect(issue.title).toBe('Buy milk');
    expect(issue.isDone).toBe(false);
  });

  it('createTask$ lets errors propagate (so the auto-create effect can report)', async () => {
    const p = firstValueFrom(service.createTask$('x', cfg));
    httpMock
      .expectOne(`${BASE}/tasks`)
      .flush('boom', { status: 500, statusText: 'Server Error' });
    await expectAsync(p).toBeRejected();
  });

  it('searchIssues$ filters my tasks by title', async () => {
    const p = firstValueFrom(service.searchIssues$('task a', cfg));
    httpMock
      .expectOne(`${BASE}/tasks`)
      .flush({ tasks: [spTask('a', 'space-1'), spTask('b', 'space-1')] });
    const res = await p;
    expect(res.length).toBe(1);
    expect(res[0].issueType).toBe('PLAINSPACE');
  });

  it('reads fail soft to [] on a network error', async () => {
    const p = firstValueFrom(service.getMyTasks$(cfg));
    httpMock
      .expectOne(`${BASE}/tasks`)
      .flush('boom', { status: 500, statusText: 'Server Error' });
    expect(await p).toEqual([]);
  });
});

// #9988: on Android the WebView's patched XHR turns every native failure into a
// bare status 0. The token check calls native HTTP directly so the native
// exception (e.g. a TLS trust failure) reaches the log.
describe('PlainspaceApiService native token check', () => {
  const cfg: PlainspaceCfg = {
    ...DEFAULT_PLAINSPACE_CFG,
    host: 'https://plainspace.org',
    token: 'pat_test',
  };
  let nativeHttp: jasmine.Spy<PlainspaceNativeHttp>;
  let httpMock: HttpTestingController;

  const setup = (native: PlainspaceNativeHttp | null): PlainspaceApiService => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [{ provide: PLAINSPACE_NATIVE_HTTP, useValue: native }],
    });
    httpMock = TestBed.inject(HttpTestingController);
    return TestBed.inject(PlainspaceApiService);
  };

  beforeEach(() => {
    nativeHttp = jasmine.createSpy('nativeHttp');
  });

  afterEach(() => httpMock.verify());

  it('sends GET /me with the PAT through native HTTP, not HttpClient', async () => {
    nativeHttp.and.resolveTo({
      status: 200,
      data: { email: 'a@b.c', projects: [] },
      headers: {},
      url: '',
    });
    const service = setup(nativeHttp);
    const res = await firstValueFrom(service.verifyToken$(cfg));
    expect(res).toEqual({ status: 'ok', me: { email: 'a@b.c', projects: [] } });
    const opts = nativeHttp.calls.mostRecent().args[0] as HttpOptions;
    expect(opts.url).toBe('https://plainspace.org/api/integration/me');
    expect(opts.method).toBe('GET');
    expect(opts.headers).toEqual({ Authorization: 'Bearer pat_test' });
  });

  [401, 403].forEach((status) => {
    it(`reports invalid-token on a native ${status}`, async () => {
      nativeHttp.and.resolveTo({ status, data: 'nope', headers: {}, url: '' });
      const res = await firstValueFrom(setup(nativeHttp).verifyToken$(cfg));
      expect(res).toEqual({ status: 'invalid-token' });
    });
  });

  it('reports unreachable on a native 200 with an empty body', async () => {
    nativeHttp.and.resolveTo({ status: 200, data: '', headers: {}, url: '' });
    const res = await firstValueFrom(setup(nativeHttp).verifyToken$(cfg));
    expect(res).toEqual({ status: 'unreachable' });
  });

  it('reports unreachable on a native 500 and logs the status', async () => {
    const errSpy = spyOn(Log, 'err');
    nativeHttp.and.resolveTo({ status: 500, data: 'boom', headers: {}, url: '' });
    const res = await firstValueFrom(setup(nativeHttp).verifyToken$(cfg));
    expect(res).toEqual({ status: 'unreachable' });
    expect(errSpy).toHaveBeenCalledWith('Plainspace: token check failed', {
      status: 500,
    });
  });

  it('logs the native error class and message, never the token or host', async () => {
    const errSpy = spyOn(Log, 'err');
    nativeHttp.and.rejectWith(
      Object.assign(
        new Error(
          'Chain validation failed for plainspace.org: Trust anchor for certification path not found.',
        ),
        { code: 'SSLHandshakeException' },
      ),
    );
    const res = await firstValueFrom(setup(nativeHttp).verifyToken$(cfg));
    expect(res).toEqual({ status: 'unreachable' });
    expect(errSpy).toHaveBeenCalledWith('Plainspace: token check failed natively', {
      errorName: 'SSLHandshakeException',
      errorMessage:
        'Chain validation failed for <host>: Trust anchor for certification path not found.',
    });
    const logged = JSON.stringify(errSpy.calls.allArgs());
    expect(logged).not.toContain('pat_test');
    expect(logged).not.toContain('plainspace.org');
  });

  // Mirrors NetworkRetryInterceptorService, which the native call bypasses:
  // sockets can be briefly unusable right after an Android resume.
  it('retries a native rejection once before reporting unreachable', async () => {
    nativeHttp.and.returnValues(
      Promise.reject(new Error('Software caused connection abort')),
      Promise.resolve({
        status: 200,
        data: { email: 'a@b.c', projects: [] },
        headers: {},
        url: '',
      }),
    );
    const res = await firstValueFrom(setup(nativeHttp).verifyToken$(cfg));
    expect(res).toEqual({ status: 'ok', me: { email: 'a@b.c', projects: [] } });
    expect(nativeHttp).toHaveBeenCalledTimes(2);
  });

  it('logs a rejection without an error class and redacts the host', async () => {
    const errSpy = spyOn(Log, 'err');
    nativeHttp.and.callFake(() =>
      Promise.reject('Unable to resolve host "plainspace.org"'),
    );
    const res = await firstValueFrom(setup(nativeHttp).verifyToken$(cfg));
    expect(res).toEqual({ status: 'unreachable' });
    expect(nativeHttp).toHaveBeenCalledTimes(2);
    expect(errSpy).toHaveBeenCalledWith('Plainspace: token check failed natively', {
      errorName: null,
      errorMessage: 'Unable to resolve host "<host>"',
    });
  });

  it('keeps the web path on HttpClient when there is no native HTTP', async () => {
    const service = setup(null);
    const p = firstValueFrom(service.verifyToken$(cfg));
    httpMock.expectOne('https://plainspace.org/api/integration/me').flush({
      email: 'a@b.c',
      projects: [],
    });
    expect(await p).toEqual({ status: 'ok', me: { email: 'a@b.c', projects: [] } });
    expect(nativeHttp).not.toHaveBeenCalled();
  });
});

interface SPTaskLike {
  id: string;
  title: string;
  done: boolean;
  projectId: string;
  projectName: string;
  projectSlug: string;
  listId: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  scheduledAt: string | null;
  isRecurring: boolean;
}
