import { inject, Injectable } from '@angular/core';
import { NotifyModel } from './notify.model';
import { environment } from '../../../environments/environment';
import { IS_ELECTRON } from '../../app.constants';
import { IS_MOBILE } from '../../util/is-mobile';
import { TranslateService } from '@ngx-translate/core';
import { UiHelperService } from '../../features/ui-helper/ui-helper.service';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { Log } from '../log';
import { LocalNotifications } from '@capacitor/local-notifications';
import { generateNotificationId } from '../../features/android/android-notification-id.util';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { GlobalConfigService } from '../../features/config/global-config.service';

@Injectable({
  providedIn: 'root',
})
export class NotifyService {
  private _translateService = inject(TranslateService);
  private _uiHelperService = inject(UiHelperService);
  private _httpClient = inject(HttpClient);
  private _globalConfigService = inject(GlobalConfigService);

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

    // --- 3. Trigger Ntfy Notification (Fire and Forget) ---
    // MODIFIED: We hardcode the title to 'Super Productivity' and use the 
    // original title variable (which contains the Task Name) as the body content.
    this._sendNtfyNotification('Super Productivity', title || body).catch((e) =>
      Log.err('NotifyService: Ntfy failed', e)
    );

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
    } else if (IS_ANDROID_WEB_VIEW) {
      try {
        // Check permissions
        const checkResult = await LocalNotifications.checkPermissions();
        let displayPermissionGranted = checkResult.display === 'granted';

        // Request permissions if not granted
        if (!displayPermissionGranted) {
          const requestResult = await LocalNotifications.requestPermissions();
          displayPermissionGranted = requestResult.display === 'granted';
          if (!displayPermissionGranted) {
            Log.warn('NotifyService: Notification permission not granted');
            return;
          }
        }

        // Generate a deterministic notification ID from title and body
        // Use a prefix to distinguish plugin notifications from reminders
        const notificationKey = `plugin-notification:${title}:${body}`;
        const notificationId = generateNotificationId(notificationKey);

        // Schedule an immediate notification
        await LocalNotifications.schedule({
          notifications: [
            {
              id: notificationId,
              title,
              body,
              schedule: {
                at: new Date(Date.now() + 1000), // Show after 1 second
                allowWhileIdle: true,
              },
            },
          ],
        });

        Log.log('NotifyService: Android notification scheduled successfully', {
          id: notificationId,
          title,
        });
      } catch (error) {
        Log.err('NotifyService: Failed to show Android notification', error);
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
    }
    Log.err('No notifications supported');
    return undefined;
  }

  // --- Ntfy Implementation ---
  private async _sendNtfyNotification(title: string, body: string) {
    // Includes previous fix: Optional chaining for config
    const cfg = this._globalConfigService.cfg?.()?.ntfy;

    // Includes previous fix: Added missing brace }
    if (!cfg || !cfg.isEnabled || !cfg.topic) {
      return;
    }

    const ntfyTopic = cfg.topic;
    const ntfyBaseUrl = cfg.baseUrl || 'https://ntfy.sh';
    const url = `${ntfyBaseUrl.replace(/\/$/, '')}/${ntfyTopic}`;

    const headers: any = {
      Title: title, // This will now receive 'Super Productivity'
      // Priority must be a string for headers
      Priority: cfg.priority ? cfg.priority.toString() : '3',
    };

    try {
      // 'body' here will now contain the actual Task Name
      await firstValueFrom(
        this._httpClient.post(url, body, {
          headers,
          responseType: 'text',
        })
      );
    } catch (e) {
      // Re-throw to be caught by the calling function's logger
      throw e;
    }
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