import { inject, Injectable, InjectionToken } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { firstValueFrom } from 'rxjs';
import { DroidLog } from '../../core/log';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { LocalBackupService } from '../../imex/local-backup/local-backup.service';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { GlobalConfigService } from '../config/global-config.service';
import { androidInterface } from './android-interface';

/**
 * Native switch from the legacy online mode (this bundle loaded from the web
 * into the old WebView activity) to the bundled offline app. Null in every
 * other runtime, and on APKs that predate the switch.
 */
export const LEGACY_ONLINE_MODE_SWITCH = new InjectionToken<(() => boolean) | null>(
  'LEGACY_ONLINE_MODE_SWITCH',
  {
    providedIn: 'root',
    factory: () =>
      IS_ANDROID_WEB_VIEW &&
      !Capacitor.isNativePlatform() &&
      androidInterface.switchToOfflineMode
        ? () => androidInterface.switchToOfflineMode?.() === true
        : null,
  },
);

/**
 * Sunsets the legacy Android online mode (#8832). The offline app restores the
 * native-store backup on its blank first start, so the switch only happens once
 * that backup provably holds the current state; otherwise the user stays online
 * and the next launch retries. Synced users stay online for now: their sync
 * credentials are not in the backup.
 */
@Injectable({ providedIn: 'root' })
export class AndroidOnlineModeSunsetService {
  private _switchToOffline = inject(LEGACY_ONLINE_MODE_SWITCH);
  private _dataInitState = inject(DataInitStateService);
  private _localBackup = inject(LocalBackupService);
  private _globalConfig = inject(GlobalConfigService);

  async handOverToOfflineApp(): Promise<void> {
    if (!this._switchToOffline) {
      return;
    }
    await firstValueFrom(this._dataInitState.isAllDataLoadedInitially$);
    // shortcut: synced users keep the legacy shell — hand over their
    // credentials too before switching them. Same rule as the offline app's
    // silent restore (backupStrHasSyncEnabled): any configured provider counts.
    const sync = this._globalConfig.sync();
    if (sync?.isEnabled || sync?.syncProvider) {
      return;
    }
    try {
      if (!(await this._localBackup.writeVerifiedAndroidBackup())) {
        DroidLog.warn('Online-mode sunset: backup not verified, staying online');
        return;
      }
    } catch (e) {
      DroidLog.err('Online-mode sunset: backup failed, staying online', e);
      return;
    }
    if (!this._switchToOffline()) {
      DroidLog.warn('Online-mode sunset: native switch refused');
    }
  }
}
