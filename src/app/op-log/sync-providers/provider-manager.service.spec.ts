import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { provideMockStore } from '@ngrx/store/testing';
import {
  SyncProviderManager,
  notifyFileProviderTargetChanged,
} from './provider-manager.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { SnackService } from '../../core/snack/snack.service';
import { SyncProviderId } from './provider.const';
import { SyncProviderBase } from './provider.interface';

/**
 * Task 2 (sync-simplification plan). providerConfigChanged$ fires on every save
 * and carries `isTargetChanged`: true only when the save moved the TARGET. That
 * flag drives invalidateAllTargets(), which wipes the seq cursor — so a false
 * positive sends the next sync down the sinceSeq===0 snapshot-bootstrap path.
 * The picker / Android setupSaf / OneDrive pre-auth write bypass
 * setProviderConfig() entirely and assert a target change directly.
 */
describe('SyncProviderManager target-change notification', () => {
  let service: SyncProviderManager;
  let configSpy: jasmine.Spy;

  const webdavCfg = {
    baseUrl: 'https://a.example/dav',
    userName: 'me',
    password: 'pw',
    encryptKey: 'key-1',
    isEncryptionEnabled: true,
  };

  /** Stubs getProviderById so setProviderConfig can run without loading providers. */
  const stubProvider = (loadedCfg: unknown): jasmine.SpyObj<SyncProviderBase<never>> => {
    const provider = {
      id: SyncProviderId.WebDAV,
      setPrivateCfg: jasmine.createSpy('setPrivateCfg').and.resolveTo(undefined),
      privateCfg: { load: jasmine.createSpy('load').and.resolveTo(loadedCfg) },
    } as unknown as jasmine.SpyObj<SyncProviderBase<never>>;
    spyOn(service, 'getProviderById').and.resolveTo(
      provider as unknown as SyncProviderBase<SyncProviderId>,
    );
    return provider;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        SyncProviderManager,
        provideMockStore({}),
        {
          provide: DataInitStateService,
          // Never emits, so the constructor's sync-config subscription stays
          // inert and we don't need to mock provider loading.
          useValue: { isAllDataLoadedInitially$: new Subject<boolean>() },
        },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
      ],
    });
    service = TestBed.inject(SyncProviderManager);

    configSpy = jasmine.createSpy('providerConfigChanged');
    service.providerConfigChanged$.subscribe(configSpy);
  });

  describe('notifyProviderTargetChanged() (bypass ingresses)', () => {
    it('emits isTargetChanged — the caller asserts the move directly', () => {
      service.notifyProviderTargetChanged();

      expect(configSpy).toHaveBeenCalledOnceWith({ isTargetChanged: true });
    });

    it('routes the module-level notifyFileProviderTargetChanged() to the registered instance', () => {
      // Injecting the service self-registered it as the module singleton.
      notifyFileProviderTargetChanged();

      expect(configSpy).toHaveBeenCalledOnceWith({ isTargetChanged: true });
    });
  });

  describe('setProviderConfig()', () => {
    // The per-field identity matrix lives in sync-target-identity.util.spec.ts.
    // These two only pin that the flag is wired to the diff, in both directions.
    it('reports isTargetChanged:false when nothing moved (e.g. Save with no edits)', async () => {
      // The sync-settings dialog saves with isForce=true, bypassing the
      // equality dedup, so this rewrite happens on every Save — including one
      // that only touched a global setting like the sync interval.
      stubProvider(webdavCfg);

      await service.setProviderConfig(SyncProviderId.WebDAV, { ...webdavCfg } as never);

      expect(configSpy).toHaveBeenCalledOnceWith({ isTargetChanged: false });
    });

    it('reports isTargetChanged:true when the folder moves', async () => {
      stubProvider(webdavCfg);

      await service.setProviderConfig(SyncProviderId.WebDAV, {
        ...webdavCfg,
        syncFolderPath: '/elsewhere',
      } as never);

      expect(configSpy).toHaveBeenCalledOnceWith({ isTargetChanged: true });
    });

    it('reads the previous config BEFORE overwriting it', async () => {
      // The diff is only meaningful against the pre-write value.
      const provider = stubProvider(webdavCfg);

      await service.setProviderConfig(SyncProviderId.WebDAV, {
        ...webdavCfg,
        userName: 'someone-else',
      } as never);

      expect(provider.privateCfg.load).toHaveBeenCalledBefore(provider.setPrivateCfg);
    });
  });

  /**
   * Task 3. Deferred background work captures the epoch and revalidates it
   * before I/O, so a request queued against one target cannot execute against
   * another. Anything that moves the target or the authority to reach it must
   * tick, or stale work runs against the wrong remote.
   */
  describe('configEpoch', () => {
    /**
     * Drives the real switch path. It is private because nothing outside the
     * constructor's config subscription may choose the active provider; the
     * async tail is inert here because getProviderById is stubbed.
     */
    const setActiveProvider = (id: SyncProviderId | null): void =>
      (
        service as unknown as { _setActiveProvider: (i: SyncProviderId | null) => void }
      )._setActiveProvider(id);

    it('starts at a stable value and does not drift on its own', () => {
      const first = service.configEpoch;

      expect(service.configEpoch).toBe(first);
    });

    it('advances on every provider-config write', async () => {
      stubProvider(webdavCfg);
      const before = service.configEpoch;

      await service.setProviderConfig(SyncProviderId.WebDAV, { ...webdavCfg } as never);

      expect(service.configEpoch).toBeGreaterThan(before);
    });

    it('advances on a target move asserted by a bypass ingress', () => {
      const before = service.configEpoch;

      service.notifyProviderTargetChanged();

      expect(service.configEpoch).toBeGreaterThan(before);
    });

    it('advances on an active provider switch', () => {
      // A switch emits NO providerConfigChanged$ by design, so an epoch derived
      // from that stream would miss it and let work captured against the old
      // provider survive.
      stubProvider(webdavCfg);
      const before = service.configEpoch;

      setActiveProvider(SyncProviderId.WebDAV);

      expect(service.configEpoch).toBeGreaterThan(before);
      expect(configSpy).not.toHaveBeenCalled();
    });

    it('does not advance when the provider is set to what it already was', () => {
      stubProvider(webdavCfg);
      setActiveProvider(SyncProviderId.WebDAV);
      const before = service.configEpoch;

      setActiveProvider(SyncProviderId.WebDAV);

      expect(service.configEpoch).toBe(before);
    });

    it('advances on a credential revoke', async () => {
      // Also emits no providerConfigChanged$, but revokes the authority a queued
      // request captured.
      const provider = {
        id: SyncProviderId.WebDAV,
        clearAuthCredentials: jasmine.createSpy('clear').and.resolveTo(undefined),
        isReady: jasmine.createSpy('isReady').and.resolveTo(false),
        privateCfg: { load: jasmine.createSpy('load').and.resolveTo(webdavCfg) },
      } as unknown as SyncProviderBase<SyncProviderId>;
      spyOn(service, 'getProviderById').and.resolveTo(provider);
      const before = service.configEpoch;

      await service.clearAuthCredentials(SyncProviderId.WebDAV);

      expect(service.configEpoch).toBeGreaterThan(before);
    });

    it('is monotonic across a burst of transitions', () => {
      stubProvider(webdavCfg);
      const seen: number[] = [service.configEpoch];
      service.notifyProviderTargetChanged();
      seen.push(service.configEpoch);
      setActiveProvider(SyncProviderId.WebDAV);
      seen.push(service.configEpoch);
      service.notifyProviderTargetChanged();
      seen.push(service.configEpoch);

      const isStrictlyIncreasing = seen.every((v, i) => i === 0 || v > seen[i - 1]);
      expect(isStrictlyIncreasing).toBeTrue();
    });
  });
});
