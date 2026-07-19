import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { provideMockStore } from '@ngrx/store/testing';
import { SyncProviderManager } from '../../sync-providers/provider-manager.service';
import { WrappedProviderService } from '../../sync-providers/wrapped-provider.service';
import { FileBasedSyncAdapterService } from '../../sync-providers/file-based/file-based-sync-adapter.service';
import { ArchiveDbAdapter } from '../../../core/persistence/archive-db-adapter.service';
import { StateSnapshotService } from '../../backup/state-snapshot.service';
import { DataInitStateService } from '../../../core/data-init/data-init-state.service';
import { SnackService } from '../../../core/snack/snack.service';
import { SyncProviderId } from '../../sync-providers/provider.const';
import { SyncProviderBase } from '../../sync-providers/provider.interface';

/**
 * Task 2 (#9063 + follow-up): the invalidation wiring, through the REAL injector.
 *
 * The other specs for this fix mock `SyncProviderManager` and assert against a
 * hand-made Subject, which proves the handler logic but assumes the wiring. Here
 * all three services are real and only `getProviderById` is stubbed, so the whole
 * production path runs: setProviderConfig -> isSyncTargetChanged ->
 * providerConfigChanged$ -> the real subscription -> invalidateAllTargets -> the
 * persisted cursor. Catches what mocked specs structurally cannot: the observable
 * never being subscribed, or the flag not reaching the adapter.
 */
describe('Target-invalidation wiring (real DI)', () => {
  let providerManager: SyncProviderManager;
  let adapterService: FileBasedSyncAdapterService;

  const webdavCfg = {
    baseUrl: 'https://a.example/dav',
    userName: 'me',
    password: 'pw',
    syncFolderPath: '/sp',
    encryptKey: 'key-1',
    isEncryptionEnabled: true,
  };

  /** Reads the cursor the way createAdapter's closure does. */
  const getCursor = (): number =>
    adapterService['_localSeqCounters'].get(SyncProviderId.WebDAV) ?? 0;

  const stubProvider = (storedCfg: Record<string, unknown>): void => {
    let stored = { ...storedCfg };
    spyOn(providerManager, 'getProviderById').and.resolveTo({
      id: SyncProviderId.WebDAV,
      isReady: async () => true,
      setPrivateCfg: async (cfg: Record<string, unknown>) => {
        stored = { ...cfg };
      },
      privateCfg: { load: async () => stored },
    } as unknown as SyncProviderBase<SyncProviderId>);
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        SyncProviderManager,
        WrappedProviderService,
        FileBasedSyncAdapterService,
        provideMockStore({}),
        {
          provide: DataInitStateService,
          // Never emits, so the manager's sync-config subscription stays inert.
          useValue: { isAllDataLoadedInitially$: new Subject<boolean>() },
        },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
        { provide: ArchiveDbAdapter, useValue: {} },
        { provide: StateSnapshotService, useValue: {} },
      ],
    });

    providerManager = TestBed.inject(SyncProviderManager);
    adapterService = TestBed.inject(FileBasedSyncAdapterService);
    // Constructing this is what registers the real subscription — exactly as the
    // effects -> SyncWrapperService -> WrappedProviderService chain does at boot.
    TestBed.inject(WrappedProviderService);

    adapterService['_localSeqCounters'].set(SyncProviderId.WebDAV, 42);
  });

  afterEach(() => {
    adapterService.invalidateAllTargets();
    localStorage.removeItem('FILE_SYNC_VERSION_state');
  });

  it('keeps the seq cursor when a save does not move the target', async () => {
    // The real Defect 1 trigger: the settings dialog saves with isForce=true, so
    // this rewrite happens even when only a global setting (sync interval,
    // compression) changed — or nothing at all.
    stubProvider(webdavCfg);

    await providerManager.setProviderConfig(SyncProviderId.WebDAV, {
      ...webdavCfg,
    } as never);

    expect(getCursor()).toBe(42);
  });

  it('keeps the seq cursor across an encryption-key rotation and the intent backfill', async () => {
    stubProvider({ ...webdavCfg, isEncryptionEnabled: undefined });

    await providerManager.setProviderConfig(SyncProviderId.WebDAV, {
      ...webdavCfg,
      encryptKey: 'key-2',
      isEncryptionEnabled: true,
    } as never);

    expect(getCursor()).toBe(42);
  });

  it('drops the seq cursor when the target actually moves', async () => {
    stubProvider(webdavCfg);

    await providerManager.setProviderConfig(SyncProviderId.WebDAV, {
      ...webdavCfg,
      syncFolderPath: '/elsewhere',
    } as never);

    expect(getCursor()).toBe(0);
  });

  it('drops the seq cursor when a bypass ingress asserts a move (picker / SAF / OneDrive)', () => {
    providerManager.notifyProviderTargetChanged();

    expect(getCursor()).toBe(0);
  });
});
