import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { LocalBackupService } from '../../imex/local-backup/local-backup.service';
import { GlobalConfigService } from '../config/global-config.service';
import {
  AndroidOnlineModeSunsetService,
  LEGACY_ONLINE_MODE_SWITCH,
} from './android-online-mode-sunset.service';

describe('AndroidOnlineModeSunsetService', () => {
  let localBackup: jasmine.SpyObj<LocalBackupService>;
  let switchToOffline: jasmine.Spy<() => boolean>;
  let syncCfg: { isEnabled: boolean; syncProvider: string | null };

  const setup = (switchFn: (() => boolean) | null): AndroidOnlineModeSunsetService => {
    TestBed.configureTestingModule({
      providers: [
        AndroidOnlineModeSunsetService,
        { provide: LEGACY_ONLINE_MODE_SWITCH, useValue: switchFn },
        { provide: LocalBackupService, useValue: localBackup },
        {
          provide: GlobalConfigService,
          useValue: { sync: () => syncCfg },
        },
        {
          provide: DataInitStateService,
          useValue: { isAllDataLoadedInitially$: of(true) },
        },
      ],
    });
    return TestBed.inject(AndroidOnlineModeSunsetService);
  };

  beforeEach(() => {
    localBackup = jasmine.createSpyObj('LocalBackupService', [
      'writeVerifiedAndroidBackup',
    ]);
    switchToOffline = jasmine.createSpy('switchToOffline').and.returnValue(true);
    syncCfg = { isEnabled: false, syncProvider: null };
  });

  // Sync credentials are not part of the backup, so a synced user would land in
  // the offline app with sync broken and behind a restore prompt.
  it('stays in online mode while sync is enabled', async () => {
    syncCfg = { isEnabled: true, syncProvider: 'WebDAV' };
    localBackup.writeVerifiedAndroidBackup.and.resolveTo(true);

    await setup(switchToOffline).handOverToOfflineApp();

    expect(localBackup.writeVerifiedAndroidBackup).not.toHaveBeenCalled();
    expect(switchToOffline).not.toHaveBeenCalled();
  });

  // The offline app only restores silently when the backup shows no sync
  // provider either; otherwise a declinable prompt could leave it blank.
  it('stays in online mode when a sync provider is set but sync is off', async () => {
    syncCfg = { isEnabled: false, syncProvider: 'WebDAV' };
    localBackup.writeVerifiedAndroidBackup.and.resolveTo(true);

    await setup(switchToOffline).handOverToOfflineApp();

    expect(switchToOffline).not.toHaveBeenCalled();
  });

  it('switches to the offline app once the backup is verified', async () => {
    localBackup.writeVerifiedAndroidBackup.and.resolveTo(true);

    await setup(switchToOffline).handOverToOfflineApp();

    expect(switchToOffline).toHaveBeenCalledTimes(1);
  });

  it('stays in online mode when the backup could not be verified', async () => {
    localBackup.writeVerifiedAndroidBackup.and.resolveTo(false);

    await setup(switchToOffline).handOverToOfflineApp();

    expect(switchToOffline).not.toHaveBeenCalled();
  });

  it('stays in online mode when writing the backup fails', async () => {
    localBackup.writeVerifiedAndroidBackup.and.rejectWith(new Error('Java exception'));

    await setup(switchToOffline).handOverToOfflineApp();

    expect(switchToOffline).not.toHaveBeenCalled();
  });

  it('does nothing outside legacy online mode or on an APK without the switch', async () => {
    await setup(null).handOverToOfflineApp();

    expect(localBackup.writeVerifiedAndroidBackup).not.toHaveBeenCalled();
  });
});
