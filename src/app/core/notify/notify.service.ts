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
    } else if (this._platformService.isNative) {
      // Use Capacitor LocalNotifications for iOS and Android
      try {
        // Generate a deterministic notification ID from title and body
        // Use a prefix to distinguish plugin notifications from reminders
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
            title,
            platform: this._platformService.platform,
          });
        }
      } catch (error) {
        Log.err('NotifyService: Failed to show mobile notification', error);
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
