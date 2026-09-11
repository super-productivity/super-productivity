import { inject, Injectable } from '@angular/core';
import { NotifyModel } from './notify.model';
import { environment } from '../../../environments/environment';
import { IS_ELECTRON } from '../../app.constants';
import { IS_MOBILE } from '../../util/is-mobile';
import { TranslateService } from '@ngx-translate/core';
import { UiHelperService } from '../../features/ui-helper/ui-helper.service';
import { Log } from '../log';
import { generateNotificationId } from '../../features/android/android-notification-id.util';
import { CapacitorNotificationService } from '../platform/capacitor-notification.service';
import { CapacitorPlatformService } from '../platform/capacitor-platform.service';
import { androidInterface } from '../../features/android/android-interface';

@Injectable({
  providedIn: 'root',
})
export class NotifyService {
  private _translateService = inject(TranslateService);
  private _uiHelperService = inject(UiHelperService);
  private _platformService = inject(CapacitorPlatformService);
  private _notificationService = inject(CapacitorNotificationService);

  async notifyDesktop(options: NotifyModel): Promise<Notification | undefined> {
    if (!IS_MOBILE) {
      return this.notify(options);
    }
    return;
  }

  async notify(options: NotifyModel): Promise<Notification | undefined> {
    const title =
      options.title &&
      this._translateService.instant(options.title, options.translateParams);
    const body =
      options.body &&
      this._translateService.instant(options.body, options.translateParams);

    if (this._platformService.isLegacyAndroidWebView) {
      // The legacy Android WebView shell has no Capacitor bridge, so
      // `LocalNotifications` falls back to its web implementation. That one
      // gates on `Notification.permission`, which Android WebView leaves at
      // 'default' no matter the OS POST_NOTIFICATIONS state (#7408) — so every
      // schedule here silently no-ops (#5376). JS in this shell only runs while
      // the app is in the foreground (exactly why reminders go through
      // AlarmManager instead), so a native toast carries the same information.
      //
      // Deliberately the SUPAndroid toast rather than SnackService: the app's
      // single snack slot suppresses non-sticky messages while a sticky
      // actionable snack is pending (sync errors, conflict recovery) and
      // debounces bursts into one — both of which would reintroduce the silent
      // drop this branch exists to remove.
      const msg = [title, body].filter((part) => !!part).join(' - ');
      if (msg) {
        this._showLegacyAndroidToast(msg);
      }
      return undefined;
    }

    if (this._platformService.isNative) {
      // Use Capacitor LocalNotifications for iOS and Android.
      // Must run before the service-worker branch: WKWebView exposes
      // navigator.serviceWorker but Notification.requestPermission() never
      // prompts under capacitor://, so the SW path silently swallows iOS
      // notifications and the native permission dialog is never reached.
      try {
        const notificationKey = `plugin-notification:${title}:${body}`;
        const notificationId = generateNotificationId(notificationKey);

        const success = await this._notificationService.schedule({
          id: notificationId,
          title,
          body,
        });

        if (success) {
          Log.log('NotifyService: Mobile notification scheduled successfully', {
            id: notificationId,
            platform: this._platformService.platform,
          });
        }
      } catch (error) {
        Log.err('NotifyService: Failed to show mobile notification', error);
      }
      return undefined;
    }

    const svcReg =
      this._isServiceWorkerAvailable() &&
      (await navigator.serviceWorker.getRegistration('ngsw-worker.js'));

    if (svcReg && svcReg.showNotification) {
      // service worker also seems to need to request permission...
      // @see: https://github.com/super-productivity/super-productivity/issues/408
      const per = await Notification.requestPermission();
      // not supported for basic notifications so we delete them
      if (per === 'granted') {
        await svcReg.showNotification(title, {
          icon: 'assets/icons/icon-128x128.png',
          silent: false,
          data: {
            dateOfArrival: Date.now(),
            primaryKey: 1,
          },
          ...options,
          body,
        });
      }
    } else if (this._isBasicNotificationSupport()) {
      const permission = await Notification.requestPermission();
      // not supported for basic notifications so we delete them
      // delete options.actions;
      if (permission === 'granted') {
        const instance = new Notification(title, {
          icon: 'assets/icons/icon-128x128.png',
          silent: false,
          data: {
            dateOfArrival: Date.now(),
            primaryKey: 1,
          },
          ...options,
          body,
        });
        instance.onclick = () => {
          instance.close();
          if (IS_ELECTRON) {
            this._uiHelperService.focusApp();
          }
        };
        setTimeout(() => {
          instance.close();
        }, options.duration || 10000);
        return instance;
      }
    } else {
      Log.warn('NotifyService: No notification method available', {
        platform: this._platformService.platform,
        isNative: this._platformService.isNative,
        hasServiceWorker: this._isServiceWorkerAvailable(),
        hasBasicNotification: this._isBasicNotificationSupport(),
      });
    }
    return undefined;
  }

  // Thin seam over the `window.SUPAndroid` singleton (undefined off-device) so
  // the legacy branch is unit-testable without an emulator — same pattern as
  // LocalBackupService's `_nativeDb*` wrappers.
  private _showLegacyAndroidToast(msg: string): void {
    androidInterface.showToast(msg);
  }

  private _isBasicNotificationSupport(): boolean {
    return 'Notification' in window;
  }

  private _isServiceWorkerAvailable(): boolean {
    return (
      'serviceWorker' in navigator &&
      (environment.production || environment.stage) &&
      !IS_ELECTRON
    );
  }
}
