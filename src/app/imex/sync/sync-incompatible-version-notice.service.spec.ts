import { TestBed } from '@angular/core/testing';
import { SUPER_SYNC_ERROR_CODES } from '@sp/shared-schema';
import { SUPER_SYNC_CLIENT_UPDATE_REQUIRED_CODE } from '@sp/sync-providers/super-sync';
import { SnackService } from '../../core/snack/snack.service';
import {
  AuthFailSPError,
  ClientUpdateRequiredSPError,
  SyncDataCorruptedError,
} from '../../op-log/core/errors/sync-errors';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { T } from '../../t.const';
import {
  isSyncIncompatibleVersionError,
  SyncIncompatibleVersionNoticeService,
} from './sync-incompatible-version-notice.service';

describe('SyncIncompatibleVersionNoticeService', () => {
  let service: SyncIncompatibleVersionNoticeService;
  let snackService: jasmine.SpyObj<SnackService>;
  let providerManager: jasmine.SpyObj<SyncProviderManager>;

  beforeEach(() => {
    snackService = jasmine.createSpyObj('SnackService', [
      'open',
      'hasPendingPersistentAction',
    ]);
    snackService.hasPendingPersistentAction.and.returnValue(false);
    providerManager = jasmine.createSpyObj('SyncProviderManager', ['setSyncStatus']);
    TestBed.configureTestingModule({
      providers: [
        { provide: SnackService, useValue: snackService },
        { provide: SyncProviderManager, useValue: providerManager },
      ],
    });
    service = TestBed.inject(SyncIncompatibleVersionNoticeService);
  });

  it('pins the provider-side code to the shared SuperSync error vocabulary', () => {
    expect(SUPER_SYNC_CLIENT_UPDATE_REQUIRED_CODE).toBe(
      SUPER_SYNC_ERROR_CODES.CLIENT_UPDATE_REQUIRED,
    );
  });

  it('recognises only the incompatible-version errors', () => {
    expect(isSyncIncompatibleVersionError(new ClientUpdateRequiredSPError())).toBe(true);
    expect(
      isSyncIncompatibleVersionError(new SyncDataCorruptedError('v3', 'sync-data.json')),
    ).toBe(true);
    expect(isSyncIncompatibleVersionError(new AuthFailSPError('401'))).toBe(false);
    expect(isSyncIncompatibleVersionError(new Error('x'))).toBe(false);
  });

  describe('client update required', () => {
    it('marks sync as failed and offers the app update once per session', () => {
      service.show(new ClientUpdateRequiredSPError());
      service.show(new ClientUpdateRequiredSPError());

      expect(providerManager.setSyncStatus).toHaveBeenCalledTimes(2);
      expect(providerManager.setSyncStatus).toHaveBeenCalledWith('ERROR');
      expect(snackService.open).toHaveBeenCalledTimes(1);
      expect(snackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          msg: T.F.SYNC.S.VERSION_TOO_OLD,
          actionStr: T.PS.UPDATE_APP,
        }),
      );
    });

    it('waits for a pending recovery action instead of spending its one notice', () => {
      snackService.hasPendingPersistentAction.and.returnValue(true);
      service.show(new ClientUpdateRequiredSPError());
      expect(snackService.open).not.toHaveBeenCalled();

      snackService.hasPendingPersistentAction.and.returnValue(false);
      service.show(new ClientUpdateRequiredSPError());
      expect(snackService.open).toHaveBeenCalledTimes(1);
    });
  });

  describe('incompatible sync file format', () => {
    it('asks to update the app for a newer remote format, without a force upload', () => {
      service.show(new SyncDataCorruptedError('v3', 'sync-data.json', true));

      expect(providerManager.setSyncStatus).toHaveBeenCalledWith('ERROR');
      expect(snackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({ msg: T.F.SYNC.S.VERSION_TOO_OLD, type: 'ERROR' }),
      );
      expect(snackService.open.calls.mostRecent().args[0]).not.toEqual(
        jasmine.objectContaining({ actionFn: jasmine.anything() }),
      );
    });

    it('reports a version mismatch for an older or unknown format', () => {
      service.show(new SyncDataCorruptedError('v1', 'sync-data.json'));
      service.show(new SyncDataCorruptedError('v1', 'sync-data.json'));

      expect(snackService.open).toHaveBeenCalledTimes(2);
      expect(snackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({ msg: T.F.SYNC.S.ERROR_SYNC_VERSION_MISMATCH }),
      );
    });
  });
});
