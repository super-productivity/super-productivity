import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import {
  HttpClient,
  HTTP_INTERCEPTORS,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptorsFromDi,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { NetworkRetryInterceptorService } from './network-retry-interceptor.service';

describe('NetworkRetryInterceptorService', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        {
          provide: HTTP_INTERCEPTORS,
          useClass: NetworkRetryInterceptorService,
          multi: true,
        },
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('retries a GET once on status 0 then succeeds', fakeAsync(() => {
    let result: unknown = null;
    http.get('/x').subscribe((r) => (result = r));

    const first = httpMock.expectOne('/x');
    first.error(new ProgressEvent('error'), { status: 0, statusText: '' });
    tick(500);

    const second = httpMock.expectOne('/x');
    second.flush({ ok: true });

    expect(result).toEqual({ ok: true });
  }));

  it('surfaces the error if the retry also fails', fakeAsync(() => {
    let err: HttpErrorResponse | null = null;
    http.get('/x').subscribe({ error: (e) => (err = e) });

    httpMock.expectOne('/x').error(new ProgressEvent('error'), { status: 0 });
    tick(500);
    httpMock.expectOne('/x').error(new ProgressEvent('error'), { status: 0 });

    expect(err).toBeTruthy();
    expect(err!.status).toBe(0);
  }));

  it('does not retry on non-zero status (e.g. 500)', () => {
    let err: HttpErrorResponse | null = null;
    http.get('/x').subscribe({ error: (e) => (err = e) });

    httpMock.expectOne('/x').flush('oops', { status: 500, statusText: 'Server' });

    httpMock.expectNone('/x');
    expect(err!.status).toBe(500);
  });

  it('does not retry non-GET requests on status 0', () => {
    let err: HttpErrorResponse | null = null;
    http.post('/x', { a: 1 }).subscribe({ error: (e) => (err = e) });

    httpMock.expectOne('/x').error(new ProgressEvent('error'), { status: 0 });

    httpMock.expectNone('/x');
    expect(err!.status).toBe(0);
  });
});
