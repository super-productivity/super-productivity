import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { SuperSyncEncryptionSetupService } from './super-sync-encryption-setup.service';
import { SnackService } from '../../core/snack/snack.service';
import { SyncWrapperService } from './sync-wrapper.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { T } from '../../t.const';

describe('SuperSyncEncryptionSetupService', () => {
  let service: SuperSyncEncryptionSetupService;
  let matDialog: jasmine.SpyObj<MatDialog>;
  let snackService: jasmine.SpyObj<SnackService>;
  let syncSpy: jasmine.Spy;
  let getActiveProviderSpy: jasmine.Spy;

  const makeProvider = (encryptKey: string | undefined): unknown => ({
    id: SyncProviderId.SuperSync,
    supportsOperationSync: true,
    providerMode: 'superSyncOps',
    getEncryptKey: jasmine.createSpy('getEncryptKey').and.resolveTo(encryptKey),
  });

  beforeEach(() => {
    matDialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open'], {
      openDialogs: [],
    });
    snackService = jasmine.createSpyObj<SnackService>('SnackService', ['open']);
    syncSpy = jasmine.createSpy('sync').and.resolveTo('IN_SYNC');
    getActiveProviderSpy = jasmine
      .createSpy('getActiveProvider')
      .and.returnValue(makeProvider(undefined));

    TestBed.configureTestingModule({
      providers: [
        SuperSyncEncryptionSetupService,
        { provide: MatDialog, useValue: matDialog },
        { provide: SnackService, useValue: snackService },
        { provide: SyncWrapperService, useValue: { sync: syncSpy } },
        {
          provide: SyncProviderManager,
          useValue: { getActiveProvider: getActiveProviderSpy },
        },
      ],
    });
    service = TestBed.inject(SuperSyncEncryptionSetupService);
  });

  it('preflight-syncs user-triggered (only the encryption snack suppressed), then opens the dialog', async () => {
    const outcome = await service.syncThenOfferSetup();

    expect(syncSpy).toHaveBeenCalledWith(true, {
      suppressEncryptionRequiredSnack: true,
    });
    expect(outcome).toBe('opened');
    expect(matDialog.open).toHaveBeenCalledWith(jasmine.any(Function), {
      data: { providerType: 'supersync', initialSetup: false },
    });
    expect(snackService.open).not.toHaveBeenCalled();
  });

  it('defers without opening the dialog when the preflight sync fails', async () => {
    syncSpy.and.resolveTo('HANDLED_ERROR');

    const outcome = await service.syncThenOfferSetup();

    expect(outcome).toBe('deferred');
    expect(matDialog.open).not.toHaveBeenCalled();
    expect(snackService.open).not.toHaveBeenCalled();
  });

  it('reports already-encrypted instead of opening the dialog when a key exists post-sync', async () => {
    getActiveProviderSpy.and.returnValue(makeProvider('some-derived-key'));

    const outcome = await service.syncThenOfferSetup();

    expect(outcome).toBe('not_needed');
    expect(matDialog.open).not.toHaveBeenCalled();
    expect(snackService.open).toHaveBeenCalledWith(
      jasmine.objectContaining({
        msg: T.APP.B_SUPER_SYNC_ENCRYPTION.ALREADY_ENCRYPTED,
      }),
    );
  });

  it('treats a non-SuperSync provider as not needing setup', async () => {
    getActiveProviderSpy.and.returnValue(null);

    const outcome = await service.syncThenOfferSetup();

    expect(outcome).toBe('not_needed');
    expect(matDialog.open).not.toHaveBeenCalled();
  });

  it('defers when another dialog is already open (no stacking)', async () => {
    (matDialog.openDialogs as unknown as unknown[]).push({});

    const outcome = await service.syncThenOfferSetup();

    expect(outcome).toBe('deferred');
    expect(matDialog.open).not.toHaveBeenCalled();
  });

  it('honors a caller-supplied isStillNeeded re-check', async () => {
    const outcome = await service.syncThenOfferSetup({
      isStillNeeded: () => Promise.resolve(false),
    });

    expect(outcome).toBe('not_needed');
    expect(matDialog.open).not.toHaveBeenCalled();
  });
});
