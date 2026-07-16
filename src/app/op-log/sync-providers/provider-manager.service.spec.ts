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
});
