import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject } from 'rxjs';
import { CertTrustService } from './cert-trust.service';
import { selectEnabledIssueProviders } from './store/issue-provider.selectors';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { CurrentProviderPrivateCfg } from '../../op-log/core/types/sync.types';
import { DEFAULT_GLOBAL_CONFIG } from '../config/default-global-config.const';

describe('CertTrustService', () => {
  let store: MockStore;
  let privateCfg$: BehaviorSubject<CurrentProviderPrivateCfg | null>;
  let emitted: string[][];

  beforeEach(() => {
    privateCfg$ = new BehaviorSubject<CurrentProviderPrivateCfg | null>(null);
    TestBed.configureTestingModule({
      providers: [
        provideMockStore({
          selectors: [{ selector: selectEnabledIssueProviders, value: [] }],
        }),
        {
          provide: SyncProviderManager,
          useValue: { currentProviderPrivateCfg$: privateCfg$ },
        },
      ],
    });
    store = TestBed.inject(MockStore);
    emitted = [];
    TestBed.inject(CertTrustService).trustedHosts$.subscribe((h) => emitted.push(h));
  });

  it('combines enabled issue provider and active sync provider hosts', () => {
    store.overrideSelector(selectEnabledIssueProviders, [
      { id: 'a', host: 'https://jira.corp.local' },
      { id: 'b', pluginConfig: { url: 'https://gitea.lan:3000' } },
    ] as never);
    store.refreshState();
    privateCfg$.next({
      providerId: 'WebDAV',
      privateCfg: { baseUrl: 'https://nas.lan/dav', userName: 'u' },
    } as never);

    expect(emitted.at(-1)).toEqual(['gitea.lan:3000', 'jira.corp.local', 'nas.lan']);
  });

  it('does not trust the default SuperSync server', () => {
    privateCfg$.next({
      providerId: 'SuperSync',
      privateCfg: { baseUrl: DEFAULT_GLOBAL_CONFIG.sync.superSync!.baseUrl },
    } as never);

    expect(emitted).toEqual([[]]);
  });

  it('emits only when the host list changes', () => {
    privateCfg$.next({
      providerId: 'WebDAV',
      privateCfg: { baseUrl: 'https://nas.lan/a' },
    } as never);
    privateCfg$.next({
      providerId: 'WebDAV',
      privateCfg: { baseUrl: 'https://nas.lan/b' },
    } as never);

    expect(emitted).toEqual([[], ['nas.lan']]);
  });
});
