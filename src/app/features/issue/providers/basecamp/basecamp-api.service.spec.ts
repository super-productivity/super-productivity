import { provideHttpClient } from '@angular/common/http';
import { HttpHeaders } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { HANDLED_ERROR_PROP_STR } from '../../../../app.constants';
import { SnackService } from '../../../../core/snack/snack.service';
import { BasecampApiService } from './basecamp-api.service';
import { BasecampOAuthFlowService } from './basecamp-oauth-flow.service';
import { DEFAULT_BASECAMP_CFG } from './basecamp-cfg-form.const';
import { BasecampCfg } from './basecamp.model';

describe('BasecampApiService', () => {
  let service: BasecampApiService;
  let httpMock: HttpTestingController;
  let snackService: jasmine.SpyObj<SnackService>;
  let store: MockStore;
  let oauthFlow: jasmine.SpyObj<BasecampOAuthFlowService>;

  const cfg: BasecampCfg = {
    ...DEFAULT_BASECAMP_CFG,
    isEnabled: true,
    accessToken: 'test-token',
    accountId: '123456',
    bucketId: '654321',
    todolistId: '777',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideMockStore(),
        BasecampApiService,
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj<SnackService>('SnackService', ['open']),
        },
        {
          provide: BasecampOAuthFlowService,
          useValue: jasmine.createSpyObj('BasecampOAuthFlowService', ['refresh']),
        },
      ],
    });

    service = TestBed.inject(BasecampApiService);
    httpMock = TestBed.inject(HttpTestingController);
    snackService = TestBed.inject(SnackService) as jasmine.SpyObj<SnackService>;
    store = TestBed.inject(MockStore);
    oauthFlow = TestBed.inject(
      BasecampOAuthFlowService,
    ) as jasmine.SpyObj<BasecampOAuthFlowService>;
    spyOn(store, 'dispatch');
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('builds the todolist URL and bearer headers for getTodolist$', (done) => {
    service.getTodolist$('777', cfg).subscribe((result) => {
      expect(result.title).toBe('Sprint Backlog');
      done();
    });

    const req = httpMock.expectOne('https://3.basecampapi.com/123456/todolists/777.json');
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.get('Authorization')).toBe('Bearer test-token');
    expect(req.request.headers.get('Accept')).toBe('application/json');
    req.flush({ id: 777, title: 'Sprint Backlog', completed: false });
  });

  it('builds the todo URL for getTodo$', (done) => {
    service.getTodo$('42', cfg).subscribe((todo) => {
      expect(todo.id).toBe(42);
      expect(todo.content).toBe('Follow up with client');
      done();
    });

    const req = httpMock.expectOne('https://3.basecampapi.com/123456/todos/42.json');
    expect(req.request.method).toBe('GET');
    req.flush({ id: 42, content: 'Follow up with client', completed: false });
  });

  it('aggregates paginated todo responses and preserves first-page total count', (done) => {
    service
      .listTodos$('777', cfg, { completed: true, status: 'archived' })
      .subscribe((result) => {
        expect(result.totalCount).toBe(3);
        expect(result.items.map((item) => item.id)).toEqual([1, 2, 3]);
        done();
      });

    const page1 = httpMock.expectOne(
      (request) =>
        request.url === 'https://3.basecampapi.com/123456/todolists/777/todos.json',
    );
    expect(page1.request.method).toBe('GET');
    expect(page1.request.params.get('completed')).toBe('true');
    expect(page1.request.params.get('status')).toBe('archived');
    page1.flush(
      [
        { id: 1, content: 'First', completed: true },
        { id: 2, content: 'Second', completed: true },
      ],
      {
        headers: new HttpHeaders()
          .set(
            'Link',
            '<https://3.basecampapi.com/123456/todolists/777/todos.json?page=2>; rel="next"',
          )
          .set('X-Total-Count', '3'),
        status: 200,
        statusText: 'OK',
      },
    );

    const page2 = httpMock.expectOne(
      'https://3.basecampapi.com/123456/todolists/777/todos.json?page=2',
    );
    expect(page2.request.method).toBe('GET');
    page2.flush([{ id: 3, content: 'Third', completed: true }], {
      headers: new HttpHeaders(),
      status: 200,
      statusText: 'OK',
    });
  });

  it('sends completion POST and DELETE requests to the Basecamp completion endpoint', (done) => {
    service.completeTodo$('42', cfg).subscribe(() => {
      service.uncompleteTodo$('42', cfg).subscribe(() => done());

      const deleteReq = httpMock.expectOne(
        'https://3.basecampapi.com/123456/todos/42/completion.json',
      );
      expect(deleteReq.request.method).toBe('DELETE');
      deleteReq.flush(null);
    });

    const postReq = httpMock.expectOne(
      'https://3.basecampapi.com/123456/todos/42/completion.json',
    );
    expect(postReq.request.method).toBe('POST');
    expect(postReq.request.body).toEqual({});
    postReq.flush(null);
  });

  it('throws a handled configuration error when account credentials are missing', () => {
    const invalidCfg = { ...cfg, accessToken: null };

    expect(() => service.getTodo$('42', invalidCfg).subscribe()).toThrowError(
      'Basecamp: Not enough settings',
    );
    expect(snackService.open).toHaveBeenCalled();
  });

  it('routes HTTP failures through the shared provider error handler', (done) => {
    service.getTodo$('42', cfg).subscribe({
      next: () => fail('expected request to fail'),
      error: (err) => {
        expect(snackService.open).toHaveBeenCalledWith(
          jasmine.objectContaining({
            type: 'ERROR',
          }),
        );
        expect(err[HANDLED_ERROR_PROP_STR]).toContain('Basecamp:');
        expect(err[HANDLED_ERROR_PROP_STR]).toContain('404 Not Found');
        done();
      },
    });

    const req = httpMock.expectOne('https://3.basecampapi.com/123456/todos/42.json');
    req.flush({ message: 'Todo not found' }, { status: 404, statusText: 'Not Found' });
  });

  describe('refresh on 401', () => {
    const cfgWithRefresh = { ...cfg, refreshToken: 'old-refresh', id: 'provider-1' };

    it('refreshes on 401, retries once with the new token, and persists', async () => {
      oauthFlow.refresh.and.resolveTo({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        tokenExpiresAt: 999,
      });

      let result: unknown;
      service.getTodo$('42', cfgWithRefresh).subscribe((t) => (result = t));

      const req1 = httpMock.expectOne('https://3.basecampapi.com/123456/todos/42.json');
      expect(req1.request.headers.get('Authorization')).toBe('Bearer test-token');
      req1.flush(null, { status: 401, statusText: 'Unauthorized' });

      await new Promise((r) => setTimeout(r));

      expect(oauthFlow.refresh).toHaveBeenCalledOnceWith('old-refresh');

      const req2 = httpMock.expectOne('https://3.basecampapi.com/123456/todos/42.json');
      expect(req2.request.headers.get('Authorization')).toBe('Bearer new-access');
      req2.flush({ id: 42, content: 'x', completed: false });

      await new Promise((r) => setTimeout(r));

      expect(store.dispatch).toHaveBeenCalled();
      expect((result as unknown as { id: number }).id).toBe(42);
    });

    it('does not refresh when there is no refresh token', async () => {
      let errorRaised = false;
      service.getTodo$('42', cfg).subscribe({
        next: () => fail('expected request to fail'),
        error: () => {
          errorRaised = true;
        },
      });

      const req = httpMock.expectOne('https://3.basecampapi.com/123456/todos/42.json');
      req.flush(null, { status: 401, statusText: 'Unauthorized' });

      await new Promise((r) => setTimeout(r));

      expect(oauthFlow.refresh).not.toHaveBeenCalled();
      expect(errorRaised).toBe(true);
    });

    it('surfaces the error and does not loop when the retry also 401s', async () => {
      oauthFlow.refresh.and.resolveTo({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        tokenExpiresAt: 999,
      });

      let errorRaised = false;
      service.getTodo$('42', cfgWithRefresh).subscribe({
        next: () => fail('expected request to fail'),
        error: () => {
          errorRaised = true;
        },
      });

      const req1 = httpMock.expectOne('https://3.basecampapi.com/123456/todos/42.json');
      req1.flush(null, { status: 401, statusText: 'Unauthorized' });

      await new Promise((r) => setTimeout(r));

      const req2 = httpMock.expectOne('https://3.basecampapi.com/123456/todos/42.json');
      req2.flush(null, { status: 401, statusText: 'Unauthorized' });

      await new Promise((r) => setTimeout(r));

      expect(errorRaised).toBe(true);
      httpMock.expectNone('https://3.basecampapi.com/123456/todos/42.json');
    });
  });
});
