import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { PlainspaceAccountService } from './plainspace-account.service';
import { LS } from '../../core/persistence/storage-keys.const';
import { IssueProvider } from '../issue/issue.model';
import { IssueProviderActions } from '../issue/store/issue-provider.actions';
import { selectAll as selectAllIssueProviders } from '../issue/store/issue-provider.selectors';
import { PlainspaceConnectionStateService } from '../issue/providers/plainspace/plainspace-connection-state.service';
import { HttpErrorResponse } from '@angular/common/http';

describe('PlainspaceAccountService', () => {
  let service: PlainspaceAccountService;
  let httpMock: HttpTestingController;
  let store: MockStore;
  const ME_URL = 'https://plainspace.org/api/integration/me';
  // Two providers share the old token (same account, two shared projects); a
  // third points at a different account/host and must keep its own token.
  const providers = [
    { id: 'ps-a', issueProviderKey: 'PLAINSPACE', token: 'pat_old' },
    { id: 'ps-b', issueProviderKey: 'PLAINSPACE', token: 'pat_old', isEnabled: false },
    { id: 'ps-other', issueProviderKey: 'PLAINSPACE', token: 'pat_other_account' },
    // Shared later, after a token was minted on another device: holds the
    // account token this device currently has saved.
    { id: 'ps-current', issueProviderKey: 'PLAINSPACE', token: 'pat_current' },
    // Bound to a space (the providers above leave it open).
    {
      id: 'ps-space-b',
      issueProviderKey: 'PLAINSPACE',
      token: 'pat_b',
      spaceId: 'space-b',
    },
    // One account sharing two Spaces on one token; it later left one of them.
    { id: 'ps-in', issueProviderKey: 'PLAINSPACE', token: 'pat_t', spaceId: 'space-in' },
    {
      id: 'ps-left',
      issueProviderKey: 'PLAINSPACE',
      token: 'pat_t',
      spaceId: 'space-left',
    },
    { id: 'gh', issueProviderKey: 'GITHUB', token: 'pat_old' },
  ] as unknown as IssueProvider[];

  beforeEach(() => {
    localStorage.removeItem(LS.PLAINSPACE_ACCOUNT);
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        PlainspaceAccountService,
        provideMockStore({
          selectors: [{ selector: selectAllIssueProviders, value: providers }],
        }),
      ],
    });
    service = TestBed.inject(PlainspaceAccountService);
    httpMock = TestBed.inject(HttpTestingController);
    store = TestBed.inject(MockStore);
    spyOn(store, 'dispatch');
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

  // #8616: one PAT per account, minting a new one revokes the old one.
  describe('scoped token replacement on reconnect', () => {
    const connect = async (
      token: string,
      email = 'me@example.com',
      replacedToken?: string | null,
    ): Promise<void> => {
      const p = service.connect(token, undefined, replacedToken);
      httpMock.expectOne(ME_URL).flush({ email, projects: [] });
      expect(await p).toBe('ok');
    };
    const tokenUpdate = (id: string, token: string): unknown =>
      IssueProviderActions.updateIssueProvider({
        issueProvider: { id, changes: { token } },
      });

    it('writes nothing on a first connect', async () => {
      await connect('pat_old');
      expect(store.dispatch).not.toHaveBeenCalled();
    });

    it('writes the new token only to Plainspace providers that held the old one', async () => {
      await connect('pat_old');
      await connect('pat_new');
      expect(store.dispatch).toHaveBeenCalledTimes(2);
      expect(store.dispatch).toHaveBeenCalledWith(
        tokenUpdate('ps-a', 'pat_new') as never,
      );
      expect(store.dispatch).toHaveBeenCalledWith(
        tokenUpdate('ps-b', 'pat_new') as never,
      );
    });

    it('leaves providers alone when the new token is for a different account', async () => {
      await connect('pat_old');
      await connect('pat_new', 'someone-else@example.com');
      expect(store.dispatch).not.toHaveBeenCalled();
    });

    it('leaves providers alone when the same email connects on another host', async () => {
      await connect('pat_old');
      const p = service.connect('pat_self_hosted', 'https://self.example');
      httpMock
        .expectOne('https://self.example/api/integration/me')
        .flush({ email: 'me@example.com', projects: [] });
      expect(await p).toBe('ok');
      expect(store.dispatch).not.toHaveBeenCalled();
    });

    it('replaces an explicitly given token (provider reconnect) and clears its state', async () => {
      const state = TestBed.inject(PlainspaceConnectionStateService);
      state.reportError('ps-other', new HttpErrorResponse({ status: 401 }));
      await connect('pat_fresh', 'other@example.com', 'pat_other_account');
      expect(store.dispatch).toHaveBeenCalledOnceWith(
        tokenUpdate('ps-other', 'pat_fresh') as never,
      );
      expect(state.rejectedProviderIds().has('ps-other')).toBe(false);
    });

    // #8616 state: P1 holds an older revoked token, P2 the saved account token.
    // Minting the new token revokes the saved one too, so one reconnect must
    // move both groups, or reconnecting each would break the other forever.
    it('moves every revoked token group of the account in one reconnect', async () => {
      await connect('pat_current');
      await connect('pat_fresh', 'me@example.com', 'pat_old');
      expect(store.dispatch).toHaveBeenCalledTimes(3);
      for (const id of ['ps-a', 'ps-b', 'ps-current']) {
        expect(store.dispatch).toHaveBeenCalledWith(
          tokenUpdate(id, 'pat_fresh') as never,
        );
      }
    });

    it('reconnecting a provider on another host keeps the saved account', async () => {
      await connect('pat_current');
      const p = service.connect('pat_fresh', 'https://self.example', 'pat_other_account');
      httpMock
        .expectOne('https://self.example/api/integration/me')
        .flush({ email: 'me@example.com', projects: [] });
      expect(await p).toBe('ok');
      expect(service.account()).toEqual({
        host: 'https://plainspace.org',
        token: 'pat_current',
        email: 'me@example.com',
      });
      expect(store.dispatch).toHaveBeenCalledOnceWith(
        tokenUpdate('ps-other', 'pat_fresh') as never,
      );
    });

    it('reconnecting a provider of another account on the same host keeps the saved account', async () => {
      await connect('pat_current');
      await connect('pat_fresh', 'other@example.com', 'pat_other_account');
      expect(service.account()).toEqual({
        host: 'https://plainspace.org',
        token: 'pat_current',
        email: 'me@example.com',
      });
      expect(store.dispatch).toHaveBeenCalledOnceWith(
        tokenUpdate('ps-other', 'pat_fresh') as never,
      );
    });

    // Review finding: another account's token, pasted on a provider's
    // reconnect, was written to it, and every task of that space then read as
    // no longer assigned to me.
    describe('membership of the provider space', () => {
      const reconnectSpaceB = async (projects: unknown[]): Promise<string> => {
        const p = service.connect('pat_fresh', undefined, 'pat_b');
        httpMock.expectOne(ME_URL).flush({ email: 'other@example.com', projects });
        return p;
      };

      it("refuses a token whose account isn't a member of the space", async () => {
        await connect('pat_current');
        expect(await reconnectSpaceB([{ id: 'space-c', slug: 'c' }])).toBe(
          'other-account',
        );
        expect(store.dispatch).not.toHaveBeenCalled();
        expect(service.token()).toBe('pat_current');
      });

      it('accepts a member; the space may be bound by its slug', async () => {
        expect(await reconnectSpaceB([{ id: 'uuid-b', slug: 'space-b' }])).toBe('ok');
        expect(store.dispatch).toHaveBeenCalledOnceWith(
          tokenUpdate('ps-space-b', 'pat_fresh') as never,
        );
      });

      // Re-review finding: reconnecting the Space I'm still in was refused
      // because another Space on the same token had been left.
      it('reconnects the member Space of a token whose other Space was left', async () => {
        const p = service.connect('pat_fresh', undefined, 'pat_t');
        httpMock
          .expectOne(ME_URL)
          .flush({ email: 'me@example.com', projects: [{ id: 'space-in', slug: 'in' }] });
        expect(await p).toBe('ok');
        expect(store.dispatch).toHaveBeenCalledOnceWith(
          tokenUpdate('ps-in', 'pat_fresh') as never,
        );
      });

      it('leaves a provider of a space the account left on its token', async () => {
        await connect('pat_b');
        await connect('pat_new');
        expect(store.dispatch).not.toHaveBeenCalled();
      });
    });

    it('writes nothing when reconnecting with the same token', async () => {
      await connect('pat_old');
      await connect('pat_old');
      expect(store.dispatch).not.toHaveBeenCalled();
    });
  });

  // A key replaced from the connect dialog: the old key is unknown to SP, so
  // it is found among the tokens this device holds before it is revoked.
  describe('findAccountTokens', () => {
    const HOST = 'https://plainspace.org';
    const hosted = [
      { id: 'mine', issueProviderKey: 'PLAINSPACE', host: HOST, token: 'pat_mine' },
      { id: 'mine-2', issueProviderKey: 'PLAINSPACE', host: HOST, token: 'pat_mine' },
      { id: 'theirs', issueProviderKey: 'PLAINSPACE', host: HOST, token: 'pat_theirs' },
      { id: 'dead', issueProviderKey: 'PLAINSPACE', host: HOST, token: 'pat_dead' },
      {
        id: 'elsewhere',
        issueProviderKey: 'PLAINSPACE',
        host: 'https://self.example',
        token: 'pat_elsewhere',
      },
      { id: 'gh', issueProviderKey: 'GITHUB', host: HOST, token: 'pat_gh' },
    ] as unknown as IssueProvider[];

    beforeEach(() => {
      store.overrideSelector(selectAllIssueProviders, hosted);
      store.refreshState();
    });

    it('returns the tokens on this host that belong to the email', async () => {
      const p = service.findAccountTokens(HOST, ' Me@Example.com ');
      // The providers are read before the checks go out.
      await new Promise((resolve) => setTimeout(resolve));
      // Each distinct token on the host is checked once.
      const reqs = httpMock.match(ME_URL);
      expect(reqs.map((r) => r.request.headers.get('Authorization')).sort()).toEqual([
        'Bearer pat_dead',
        'Bearer pat_mine',
        'Bearer pat_theirs',
      ]);
      for (const req of reqs) {
        const auth = req.request.headers.get('Authorization');
        if (auth === 'Bearer pat_dead') {
          req.flush({ error: 'Invalid' }, { status: 401, statusText: 'Unauthorized' });
        } else {
          req.flush({
            email: auth === 'Bearer pat_mine' ? 'me@example.com' : 'them@example.com',
            projects: [],
          });
        }
      }
      expect(await p).toEqual(['pat_mine']);
    });

    it('replaces the found token on every provider holding it', async () => {
      const p = service.connect('pat_new', HOST, null, ['pat_mine']);
      httpMock.expectOne(ME_URL).flush({ email: 'me@example.com', projects: [] });
      expect(await p).toBe('ok');
      expect(store.dispatch).toHaveBeenCalledTimes(2);
      for (const id of ['mine', 'mine-2']) {
        expect(store.dispatch).toHaveBeenCalledWith(
          IssueProviderActions.updateIssueProvider({
            issueProvider: { id, changes: { token: 'pat_new' } },
          }) as never,
        );
      }
    });

    // Review finding: a replace refused for another account's provider
    // reconnect had already revoked the found key, so its providers broke.
    it("still hands the new key to the found token's providers when the reconnect is refused", async () => {
      store.overrideSelector(selectAllIssueProviders, [
        ...hosted,
        {
          id: 'not-member',
          issueProviderKey: 'PLAINSPACE',
          host: HOST,
          token: 'pat_rejected',
          spaceId: 'space-x',
        },
      ] as unknown as IssueProvider[]);
      store.refreshState();
      const p = service.connect('pat_new', HOST, 'pat_rejected', ['pat_mine']);
      httpMock.expectOne(ME_URL).flush({ email: 'me@example.com', projects: [] });
      expect(await p).toBe('other-account');
      expect(store.dispatch).toHaveBeenCalledTimes(2);
      for (const id of ['mine', 'mine-2']) {
        expect(store.dispatch).toHaveBeenCalledWith(
          IssueProviderActions.updateIssueProvider({
            issueProvider: { id, changes: { token: 'pat_new' } },
          }) as never,
        );
      }
      expect(service.account()).toBeNull();
    });
  });
});
