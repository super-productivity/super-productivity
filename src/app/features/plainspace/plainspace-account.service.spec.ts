import { TestBed } from '@angular/core/testing';
import { PlainspaceAccountService } from './plainspace-account.service';
import { PLAINSPACE_MOCK_CURRENT_USER_ID } from './plainspace-identity.const';
import { LS } from '../../core/persistence/storage-keys.const';

describe('PlainspaceAccountService', () => {
  let service: PlainspaceAccountService;

  beforeEach(() => {
    localStorage.removeItem(LS.PLAINSPACE_ACCOUNT);
    TestBed.configureTestingModule({ providers: [PlainspaceAccountService] });
    service = TestBed.inject(PlainspaceAccountService);
  });

  afterEach(() => {
    localStorage.removeItem(LS.PLAINSPACE_ACCOUNT);
  });

  it('starts logged out', () => {
    expect(service.isLoggedIn()).toBe(false);
    expect(service.currentUserId()).toBeNull();
  });

  it('login sets the mock identity and persists it', () => {
    const account = service.login('Alice');
    expect(service.isLoggedIn()).toBe(true);
    expect(service.currentUserId()).toBe(PLAINSPACE_MOCK_CURRENT_USER_ID);
    expect(account.displayName).toBe('Alice');
    expect(account.token).toBeTruthy();
    expect(localStorage.getItem(LS.PLAINSPACE_ACCOUNT)).toContain(
      PLAINSPACE_MOCK_CURRENT_USER_ID,
    );
  });

  it('login falls back to a default display name when blank', () => {
    const account = service.login('   ');
    expect(account.displayName).toBe('Me');
  });

  it('logout clears the account and storage', () => {
    service.login('Alice');
    service.logout();
    expect(service.isLoggedIn()).toBe(false);
    expect(service.currentUserId()).toBeNull();
    expect(localStorage.getItem(LS.PLAINSPACE_ACCOUNT)).toBeNull();
  });

  it('restores a persisted account on construction', () => {
    service.login('Bob');
    // a fresh instance reads the persisted account from localStorage
    const fresh = TestBed.runInInjectionContext(() => new PlainspaceAccountService());
    expect(fresh.isLoggedIn()).toBe(true);
    expect(fresh.account()?.displayName).toBe('Bob');
  });
});
