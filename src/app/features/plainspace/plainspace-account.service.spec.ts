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

    expect(await p).toBe(true);
    expect(service.isLoggedIn()).toBe(true);
    expect(service.token()).toBe('pat_x');
    expect(service.account()?.email).toBe('me@example.com');
    expect(localStorage.getItem(LS.PLAINSPACE_ACCOUNT)).toContain('pat_x');
  });

  it('connect returns false and stays logged out on an invalid token', async () => {
    const p = service.connect('bad');
    httpMock
      .expectOne(ME_URL)
      .flush({ error: 'nope' }, { status: 401, statusText: 'Unauthorized' });

    expect(await p).toBe(false);
    expect(service.isLoggedIn()).toBe(false);
    expect(localStorage.getItem(LS.PLAINSPACE_ACCOUNT)).toBeNull();
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
});
