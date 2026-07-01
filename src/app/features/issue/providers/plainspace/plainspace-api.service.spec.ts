import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { PlainspaceApiService } from './plainspace-api.service';
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

  it('patchTask$ PATCHes the given fields and maps scheduledAt back', async () => {
    const p = firstValueFrom(
      service.patchTask$(
        'a',
        { done: true, scheduledAt: '2026-01-02T09:00:00.000Z' },
        cfg,
      ),
    );
    const req = httpMock.expectOne(`${BASE}/tasks/a`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({
      done: true,
      scheduledAt: '2026-01-02T09:00:00.000Z',
    });
    req.flush({ task: spTask('a', 'space-1', true, '2026-01-02T09:00:00.000Z') });
    const issue = await p;
    expect(issue?.isDone).toBe(true);
    expect(issue?.scheduledAt).toBe('2026-01-02T09:00:00.000Z');
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

  it('createSpace$ returns the new project id', async () => {
    const p = firstValueFrom(service.createSpace$('My Space', cfg));
    const req = httpMock.expectOne(`${BASE}/spaces`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'My Space' });
    req.flush({ project: { id: 'proj-new' }, url: 'x', memberId: 'm' });
    expect((await p).id).toBe('proj-new');
  });

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
