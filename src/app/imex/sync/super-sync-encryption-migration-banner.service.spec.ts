import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { SuperSyncEncryptionMigrationBannerService } from './super-sync-encryption-migration-banner.service';
import { BannerService } from '../../core/banner/banner.service';
import { BannerId, Banner } from '../../core/banner/banner.model';
import { LS } from '../../core/persistence/storage-keys.const';
import { SnackService } from '../../core/snack/snack.service';
import { SyncWrapperService } from './sync-wrapper.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';

const NOW = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

interface MockProviderOpts {
  id?: SyncProviderId;
  isReady?: boolean;
  seq?: number;
  encryptKey?: string | undefined;
  operationSyncCapable?: boolean;
}

describe('SuperSyncEncryptionMigrationBannerService', () => {
  let service: SuperSyncEncryptionMigrationBannerService;
  let bannerService: jasmine.SpyObj<BannerService>;
  let matDialog: jasmine.SpyObj<MatDialog>;
  let snackService: jasmine.SpyObj<SnackService>;
  let syncSpy: jasmine.Spy;
  let getActiveProviderSpy: jasmine.Spy;
  let lsStore: Record<string, string>;

  const lastBanner = (): Banner =>
    bannerService.open.calls.mostRecent().args[0] as Banner;

  // Flush pending microtasks so the void-returning banner action's async chain
  // (_startMigration → sync → re-check → dialog/snack) settles before asserting.
  const flush = (): Promise<void> => new Promise<void>((r) => setTimeout(r));

  // A clearly-eligible active provider: SuperSync, ready, established, unencrypted.
  const makeProvider = (opts: MockProviderOpts = {}): unknown => {
    const capable = opts.operationSyncCapable ?? true;
    return {
      id: opts.id ?? SyncProviderId.SuperSync,
      ...(capable ? { supportsOperationSync: true, providerMode: 'superSyncOps' } : {}),
      isReady: jasmine.createSpy('isReady').and.resolveTo(opts.isReady ?? true),
      getLastServerSeq: jasmine
        .createSpy('getLastServerSeq')
        .and.resolveTo(opts.seq ?? 5),
      getEncryptKey: jasmine.createSpy('getEncryptKey').and.resolveTo(opts.encryptKey),
    };
  };

  const setProvider = (opts: MockProviderOpts = {}): void => {
    getActiveProviderSpy.and.returnValue(makeProvider(opts));
  };

  beforeEach(() => {
    lsStore = {};
    spyOn(Date, 'now').and.returnValue(NOW);
    spyOn(localStorage, 'getItem').and.callFake((k) => lsStore[k] ?? null);
    spyOn(localStorage, 'setItem').and.callFake((k, v) => {
      lsStore[k] = v;
    });

    bannerService = jasmine.createSpyObj<BannerService>('BannerService', ['open']);
    matDialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open'], {
      openDialogs: [],
    });
    snackService = jasmine.createSpyObj<SnackService>('SnackService', ['open']);
    syncSpy = jasmine.createSpy('sync').and.resolveTo('IN_SYNC');
    getActiveProviderSpy = jasmine.createSpy('getActiveProvider');
    setProvider();

    TestBed.configureTestingModule({
      providers: [
        SuperSyncEncryptionMigrationBannerService,
        { provide: BannerService, useValue: bannerService },
        { provide: MatDialog, useValue: matDialog },
        { provide: SnackService, useValue: snackService },
        { provide: SyncWrapperService, useValue: { sync: syncSpy } },
        {
          provide: SyncProviderManager,
          useValue: { getActiveProvider: getActiveProviderSpy },
        },
      ],
    });
    service = TestBed.inject(SuperSyncEncryptionMigrationBannerService);
  });

  describe('detection', () => {
    it('shows the banner for an established, unencrypted SuperSync account', async () => {
      await service.showBannerIfNeeded();
      expect(bannerService.open).toHaveBeenCalledTimes(1);
      expect(lastBanner().id).toBe(BannerId.SuperSyncEncryptionMigration);
    });

    it('does not show while snoozed', async () => {
      lsStore[LS.SUPER_SYNC_ENCRYPTION_MIGRATION_SNOOZE_UNTIL] = (
        NOW + DAY_MS
      ).toString();
      await service.showBannerIfNeeded();
      expect(bannerService.open).not.toHaveBeenCalled();
    });

    it('shows again once the snooze has elapsed', async () => {
      lsStore[LS.SUPER_SYNC_ENCRYPTION_MIGRATION_SNOOZE_UNTIL] = (
        NOW - DAY_MS
      ).toString();
      await service.showBannerIfNeeded();
      expect(bannerService.open).toHaveBeenCalledTimes(1);
    });

    it('does not show when encryption is already enabled (key present)', async () => {
      setProvider({ encryptKey: 'derived-key' });
      await service.showBannerIfNeeded();
      expect(bannerService.open).not.toHaveBeenCalled();
    });

    it('does not show for the needs-password cohort (isReady() false)', async () => {
      setProvider({ isReady: false });
      await service.showBannerIfNeeded();
      expect(bannerService.open).not.toHaveBeenCalled();
    });

    it('does not show for a brand-new, never-synced config (seq 0)', async () => {
      setProvider({ seq: 0 });
      await service.showBannerIfNeeded();
      expect(bannerService.open).not.toHaveBeenCalled();
    });

    it('does not show when the active provider is not SuperSync', async () => {
      setProvider({ id: SyncProviderId.Dropbox });
      await service.showBannerIfNeeded();
      expect(bannerService.open).not.toHaveBeenCalled();
    });

    it('does not show when there is no active provider', async () => {
      getActiveProviderSpy.and.returnValue(null);
      await service.showBannerIfNeeded();
      expect(bannerService.open).not.toHaveBeenCalled();
    });
  });

  describe('actions', () => {
    it('snoozes when the user picks "Later"', async () => {
      await service.showBannerIfNeeded();
      lastBanner().action2!.fn();
      expect(+lsStore[LS.SUPER_SYNC_ENCRYPTION_MIGRATION_SNOOZE_UNTIL]).toBeGreaterThan(
        NOW,
      );
    });

    it('on "Enable": re-syncs, opens the escapable dialog, and snoozes only at that point', async () => {
      const openSpy = spyOn(
        service as unknown as { _openEnableEncryptionDialog: () => Promise<void> },
        '_openEnableEncryptionDialog',
      ).and.resolveTo();
      await service.showBannerIfNeeded();

      lastBanner().action!.fn();
      await flush();

      expect(syncSpy).toHaveBeenCalledWith(true);
      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(snackService.open).not.toHaveBeenCalled();
      // Snooze is set once we reach the migration decision (not on click).
      expect(+lsStore[LS.SUPER_SYNC_ENCRYPTION_MIGRATION_SNOOZE_UNTIL]).toBeGreaterThan(
        NOW,
      );
    });

    it('on "Enable": defers WITHOUT snoozing when the pre-sync returns HANDLED_ERROR', async () => {
      syncSpy.and.resolveTo('HANDLED_ERROR');
      const openSpy = spyOn(
        service as unknown as { _openEnableEncryptionDialog: () => Promise<void> },
        '_openEnableEncryptionDialog',
      ).and.resolveTo();
      await service.showBannerIfNeeded();

      lastBanner().action!.fn();
      await flush();

      expect(openSpy).not.toHaveBeenCalled();
      expect(snackService.open).not.toHaveBeenCalled();
      // Must NOT snooze on a failed attempt — the user never reached the decision.
      expect(lsStore[LS.SUPER_SYNC_ENCRYPTION_MIGRATION_SNOOZE_UNTIL]).toBeUndefined();
    });

    it('on "Enable": shows a snack (no dialog) when the server got encrypted meanwhile', async () => {
      const openSpy = spyOn(
        service as unknown as { _openEnableEncryptionDialog: () => Promise<void> },
        '_openEnableEncryptionDialog',
      ).and.resolveTo();
      // First detection (banner) sees unencrypted; the post-sync re-check sees a key.
      getActiveProviderSpy.and.returnValues(
        makeProvider(),
        makeProvider({ encryptKey: 'someone-elses-key' }),
      );
      await service.showBannerIfNeeded();

      lastBanner().action!.fn();
      await flush();

      expect(openSpy).not.toHaveBeenCalled();
      expect(snackService.open).toHaveBeenCalledTimes(1);
    });

    it('on "Enable": defers WITHOUT snoozing when another dialog is already open', async () => {
      (matDialog.openDialogs as unknown as unknown[]).push({});
      const openSpy = spyOn(
        service as unknown as { _openEnableEncryptionDialog: () => Promise<void> },
        '_openEnableEncryptionDialog',
      ).and.resolveTo();
      await service.showBannerIfNeeded();

      lastBanner().action!.fn();
      await flush();

      expect(openSpy).not.toHaveBeenCalled();
      expect(lsStore[LS.SUPER_SYNC_ENCRYPTION_MIGRATION_SNOOZE_UNTIL]).toBeUndefined();
    });
  });
});
