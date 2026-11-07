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
  let service: CertTrustService;

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
    service = TestBed.inject(CertTrustService);
    service.trustedHosts$.subscribe((h) => emitted.push(h));
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

  it('does not trust the default Plainspace server', () => {
    store.overrideSelector(selectEnabledIssueProviders, [
      { id: 'p', host: 'https://plainspace.org' },
    ] as never);
    store.refreshState();

    expect(emitted.at(-1)).toEqual([]);
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

  it('merges pending configs until their owner clears them', () => {
    const issueDialog = {};
    const syncDialog = {};
    store.overrideSelector(selectEnabledIssueProviders, [
      { id: 'a', host: 'https://jira.corp.local' },
    ] as never);
    store.refreshState();

    void service.setPendingConfig(issueDialog, {
      pluginConfig: { gitlabBaseUrl: 'gitlab.corp.lan', project: 'group/repo' },
    });
    void service.setPendingConfig(syncDialog, { baseUrl: 'https://nas.lan/dav' });
    expect(emitted.at(-1)).toEqual(['gitlab.corp.lan', 'jira.corp.local', 'nas.lan']);

    void service.setPendingConfig(issueDialog, null);
    expect(emitted.at(-1)).toEqual(['jira.corp.local', 'nas.lan']);
    void service.setPendingConfig(syncDialog, null);
    expect(emitted.at(-1)).toEqual(['jira.corp.local']);
  });

  it('resolves setPendingConfig only once the main process applied the hosts', async () => {
    const sent: string[][] = [];
    const acks: (() => void)[] = [];
    service.init({
      setTrustedHosts: (hosts) => {
        sent.push(hosts);
        return new Promise<void>((resolve) => acks.push(resolve));
      },
    });
    acks[0]();

    let isApplied = false;
    const applied = service
      .setPendingConfig({}, { serverUrl: ' https://cloud.lan ' })
      .then(() => (isApplied = true));
    await Promise.resolve();

    expect(sent.at(-1)).toEqual(['cloud.lan']);
    expect(isApplied).toBe(false);
    acks[1]();
    await applied;
    expect(isApplied).toBe(true);
  });
});
