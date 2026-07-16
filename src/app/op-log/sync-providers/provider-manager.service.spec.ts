import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { provideMockStore } from '@ngrx/store/testing';
import { SyncProviderManager } from './provider-manager.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { SnackService } from '../../core/snack/snack.service';
import { SyncProviderId } from './provider.const';
import { SyncProviderBase } from './provider.interface';
import { SyncEpochChangedError } from '../core/errors/sync-errors';

/**
 * Task 2 (sync-simplification plan). providerConfigChanged$ fires on every save
 * and carries `isTargetChanged`: true only when the save moved the TARGET. That
 * flag drives invalidateAllTargets(), which wipes the seq cursor — so a false
 * positive sends the next sync down the sinceSeq===0 snapshot-bootstrap path.
 * The Electron LocalFile folder commit / OneDrive pre-auth write bypass
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

  describe('sync epoch (#9074)', () => {
    it('assertSyncEpochUnchanged is a no-op for undefined (unfenced flow) and throws after a bump', () => {
      const captured = service.syncEpoch;

      expect(() => service.assertSyncEpochUnchanged(undefined, 'test')).not.toThrow();
      expect(() => service.assertSyncEpochUnchanged(captured, 'test')).not.toThrow();

      service.bumpSyncEpoch('test');

      expect(service.syncEpoch).toBe(captured + 1);
      expect(() => service.assertSyncEpochUnchanged(captured, 'test')).toThrowError(
        SyncEpochChangedError,
      );
      expect(() => service.assertSyncEpochUnchanged(undefined, 'test')).not.toThrow();
    });

    it('bumps on a target-moving config save but NOT on a content-only save', async () => {
      // A false-positive bump here would abort a healthy sync cycle on every
      // settings Save (the dialog rewrites the whole privateCfg each time).
      stubProvider(webdavCfg);
      const before = service.syncEpoch;

      await service.setProviderConfig(SyncProviderId.WebDAV, { ...webdavCfg } as never);
      expect(service.syncEpoch).toBe(before);

      await service.setProviderConfig(SyncProviderId.WebDAV, {
        ...webdavCfg,
        baseUrl: 'https://b.example/dav',
      } as never);
      expect(service.syncEpoch).toBe(before + 1);
    });

    it('does NOT bump on a first-time config save (no previous target to fence)', async () => {
      // First-time setup has no old target an in-flight cycle could be running
      // against; a bump here races the fresh config's first sync into a
      // spurious abort (every conflict-dialog E2E timed out on it).
      stubProvider(null);
      const before = service.syncEpoch;

      await service.setProviderConfig(SyncProviderId.WebDAV, { ...webdavCfg } as never);

      expect(service.syncEpoch).toBe(before);
    });

    it('bumps via notifyProviderTargetChanged (bypass ingresses)', () => {
      const before = service.syncEpoch;

      service.notifyProviderTargetChanged();

      expect(service.syncEpoch).toBe(before + 1);
    });

    it('bumps AFTER the swap on a real switch and on disable, but NOT on first activation', async () => {
      // Bump-after-swap: a cycle starting between the config change and the
      // swap still reads the OLD provider, so it must keep a stale-able epoch.
      // First activation (null → X) must not bump: no cycle can have run
      // against a previous target, and the async bump would race the fresh
      // setup's first sync into a spurious abort.
      const provider = stubProvider(webdavCfg);
      (provider as unknown as { isReady: jasmine.Spy }).isReady = jasmine
        .createSpy('isReady')
        .and.resolveTo(true);
      const before = service.syncEpoch;

      service['_setActiveProvider'](SyncProviderId.WebDAV);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(service.syncEpoch).toBe(before); // first activation — no bump
      expect(service.getActiveProvider()).toBe(
        provider as unknown as SyncProviderBase<SyncProviderId>,
      );

      service['_setActiveProvider'](SyncProviderId.Dropbox);
      expect(service.syncEpoch).toBe(before); // not yet — swap is async
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(service.syncEpoch).toBe(before + 1);

      service['_setActiveProvider'](null);
      expect(service.syncEpoch).toBe(before + 2); // null path swaps synchronously
      expect(service.getActiveProvider()).toBeNull();
    });

    it('does not bump when the provider id is unchanged', () => {
      const before = service.syncEpoch;

      // Initial id is null; setting null again must early-return without a bump.
      service['_setActiveProvider'](null);

      expect(service.syncEpoch).toBe(before);
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
