import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PlainspaceAccountService } from './plainspace-account.service';
import { LS } from '../../core/persistence/storage-keys.const';

describe('PlainspaceAccountService', () => {
  let service: PlainspaceAccountService;
  let httpMock: HttpTestingController;
  const ME_URL = 'https://plainspace.org/api/integration/me';

  beforeEach(() => {
    localStorage.removeItem(LS.PLAINSPACE_ACCOUNT);
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [PlainspaceAccountService],
    });
    service = TestBed.inject(PlainspaceAccountService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    localStorage.removeItem(LS.PLAINSPACE_ACCOUNT);
    httpMock.verify();
  });

  it('starts logged out', () => {
    expect(service.isLoggedIn()).toBe(false);
    expect(service.token()).toBeNull();
  });

  it('connect validates the token via /me, stores it, and persists', async () => {
    const p = service.connect('pat_x');
    const req = httpMock.expectOne(ME_URL);
    expect(req.request.headers.get('Authorization')).toBe('Bearer pat_x');
    req.flush({ email: 'me@example.com', projects: [] });

    expect(await p).toBe('ok');
    expect(service.isLoggedIn()).toBe(true);
    expect(service.token()).toBe('pat_x');
    expect(service.account()?.email).toBe('me@example.com');
    expect(localStorage.getItem(LS.PLAINSPACE_ACCOUNT)).toContain('pat_x');
  });

  it('connect reports invalid-token and stays logged out on a rejected token', async () => {
    const p = service.connect('bad');
    httpMock
      .expectOne(ME_URL)
      .flush({ error: 'nope' }, { status: 401, statusText: 'Unauthorized' });

    expect(await p).toBe('invalid-token');
    expect(service.isLoggedIn()).toBe(false);
    expect(localStorage.getItem(LS.PLAINSPACE_ACCOUNT)).toBeNull();
  });

  // #9988: a host we never reached must not be reported as a bad token.
  it('connect reports unreachable when the request never gets an answer', async () => {
    const p = service.connect('pat_x');
    httpMock.expectOne(ME_URL).error(new ProgressEvent('error'), { status: 0 });

    expect(await p).toBe('unreachable');
    expect(service.isLoggedIn()).toBe(false);
  });

  // Regression guard: `me` is null for an empty body, and reading `me.email`
  // threw, leaving the connect dialog stuck on its spinner (#9988 follow-up).
  it('connect reports unreachable (no throw) when the body is empty', async () => {
    const p = service.connect('pat_x');
    httpMock.expectOne(ME_URL).flush(null, { status: 204, statusText: 'No Content' });

    await expectAsync(p).toBeResolvedTo('unreachable');
    expect(service.isLoggedIn()).toBe(false);
    expect(localStorage.getItem(LS.PLAINSPACE_ACCOUNT)).toBeNull();
  });

  it('connect reports unreachable on a server error', async () => {
    const p = service.connect('pat_x');
    httpMock
      .expectOne(ME_URL)
      .flush('boom', { status: 500, statusText: 'Internal Server Error' });

    expect(await p).toBe('unreachable');
    expect(service.isLoggedIn()).toBe(false);
  });

  it('logout clears the account and storage', async () => {
    const p = service.connect('pat_x');
    httpMock.expectOne(ME_URL).flush({ email: 'me@example.com', projects: [] });
    await p;

    service.logout();
    expect(service.isLoggedIn()).toBe(false);
    expect(service.token()).toBeNull();
    expect(localStorage.getItem(LS.PLAINSPACE_ACCOUNT)).toBeNull();
  });

  it('restores a saved account on reinitialization, but stays disconnected after logout', async () => {
    const connected = service.connect('pat_x');
    httpMock.expectOne(ME_URL).flush({ email: 'me@example.com', projects: [] });
    await connected;

    const restored = TestBed.runInInjectionContext(() => new PlainspaceAccountService());
    expect(restored.account()).toEqual(service.account());
    expect(restored.isLoggedIn()).toBe(true);

    restored.logout();

    const restarted = TestBed.runInInjectionContext(() => new PlainspaceAccountService());
    expect(restarted.account()).toBeNull();
    expect(restarted.isLoggedIn()).toBe(false);
    expect(restarted.host()).toBeNull();
    expect(restarted.token()).toBeNull();
  });

  it('stays disconnected when a pending reconnect succeeds after logout', async () => {
    const connected = service.connect('pat_initial');
    httpMock.expectOne(ME_URL).flush({ email: 'me@example.com', projects: [] });
    await connected;

    const reconnecting = service.connect('pat_pending');
    const pendingRequest = httpMock.expectOne(ME_URL);
    service.logout();
    pendingRequest.flush({ email: 'me@example.com', projects: [] });

    expect(await reconnecting).toBe('aborted');
    expect(service.account()).toBeNull();
    expect(service.isLoggedIn()).toBe(false);
    expect(localStorage.getItem(LS.PLAINSPACE_ACCOUNT)).toBeNull();
    const restarted = TestBed.runInInjectionContext(() => new PlainspaceAccountService());
    expect(restarted.isLoggedIn()).toBe(false);
  });

  it('allows a new connection after logout without an older response overwriting it', async () => {
    const pending = service.connect('pat_old');
    const oldRequest = httpMock.expectOne(ME_URL);
    service.logout();

    const connecting = service.connect('pat_new');
    httpMock.expectOne(ME_URL).flush({ email: 'new@example.com', projects: [] });
    expect(await connecting).toBe('ok');
    oldRequest.flush({ email: 'old@example.com', projects: [] });

    expect(await pending).toBe('aborted');
    expect(service.token()).toBe('pat_new');
    expect(service.account()?.email).toBe('new@example.com');
    const restarted = TestBed.runInInjectionContext(() => new PlainspaceAccountService());
    expect(restarted.account()).toEqual(service.account());
  });
});
