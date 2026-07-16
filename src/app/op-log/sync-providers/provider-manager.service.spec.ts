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
import { SyncEpochChangedError } from '../core/errors/sync-errors';

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
});
