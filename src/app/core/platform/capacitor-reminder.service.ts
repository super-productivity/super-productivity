import { inject, Injectable } from '@angular/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Log } from '../log';
import { CapacitorPlatformService } from './capacitor-platform.service';
import {
  CapacitorNotificationService,
  NotificationActionEvent,
  REMINDER_ACTION_TYPE_ID,
} from './capacitor-notification.service';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { androidInterface } from '../../features/android/android-interface';
import { Observable } from 'rxjs';
import { GlobalConfigService } from '../../features/config/global-config.service';

export interface ScheduleReminderOptions {
  /**
   * Unique notification ID (numeric)
   */
  notificationId: number;
  /**
   * Reminder identifier (string, e.g., task ID)
   */
  reminderId: string;
  /**
   * Related entity ID (string, e.g., task ID)
   */
  relatedId: string;
  /**
   * Notification title
   */
  title: string;
  /**
   * Type of reminder (e.g., 'TASK')
   */
  reminderType: string;
  /**
   * Timestamp when the reminder should trigger (in milliseconds)
   */
  triggerAtMs: number;
}

/**
 * Service for scheduling reminders across platforms.
 *
 * On Android: Uses native AlarmManager via androidInterface for precise timing
 * On iOS: Uses Capacitor LocalNotifications for scheduled notifications
 */
@Injectable({
  providedIn: 'root',
})
export class CapacitorReminderService {
  private _platformService = inject(CapacitorPlatformService);
  private _notificationService = inject(CapacitorNotificationService);
  private _globalConfigService = inject(GlobalConfigService);

  /**
   * Observable that emits when a notification action is performed (iOS).
   * Use this to handle snooze/done button taps from notifications.
   */
  get action$(): Observable<NotificationActionEvent> {
    return this._notificationService.action$;
  }

  /**
   * Check if reminder scheduling is available on this platform
   */
  get isAvailable(): boolean {
    return this._platformService.capabilities.scheduledNotifications;
  }

  /**
   * Initialize the reminder service.
   * Registers notification action types on iOS.
   */
  async initialize(): Promise<void> {
    if (this._platformService.isIOS()) {
      await this._notificationService.registerReminderActions();
    }
  }

  /**
   * Schedule a reminder notification
   */
  async scheduleReminder(options: ScheduleReminderOptions): Promise<boolean> {
    if (!this.isAvailable) {
      Log.warn('CapacitorReminderService: Scheduled notifications not available');
      return false;
    }

    const now = Date.now();
    const triggerAt = options.triggerAtMs <= now ? now + 1000 : options.triggerAtMs;

    Log.log('📱 CapacitorReminderService.scheduleReminder called', {
      notificationId: options.notificationId,
      title: options.title.substring(0, 30),
      triggerAt: new Date(triggerAt).toISOString(),
      triggerInMs: triggerAt - now,
      triggerInMinutes: Math.round((triggerAt - now) / 1000 / 60),
      isAndroidWebView: IS_ANDROID_WEB_VIEW,
      hasNativeScheduler: !!androidInterface?.scheduleNativeReminder,
    });

    // On Android, use native AlarmManager for precision
    if (IS_ANDROID_WEB_VIEW && androidInterface.scheduleNativeReminder) {
      try {
        const useAlarmStyle =
          this._globalConfigService.cfg()?.reminder?.useAlarmStyleReminders ?? false;
        Log.log('🔔 Calling androidInterface.scheduleNativeReminder', {
          notificationId: options.notificationId,
          useAlarmStyle,
        });

        androidInterface.scheduleNativeReminder(
          options.notificationId,
          options.reminderId,
          options.relatedId,
          options.title,
          options.reminderType,
          triggerAt,
          useAlarmStyle,
        );

        Log.log('✅ CapacitorReminderService: Android reminder scheduled successfully', {
          notificationId: options.notificationId,
          title: options.title,
          triggerAt: new Date(triggerAt).toISOString(),
        });
        return true;
      } catch (error) {
        Log.err(
          '❌ CapacitorReminderService: Failed to schedule Android reminder',
          error,
        );
        return false;
      }
    }

    // On iOS (and Android as fallback), use Capacitor LocalNotifications
    if (this._platformService.isNative) {
      try {
        const hasPermission = await this._notificationService.ensurePermissions();
        if (!hasPermission) {
          Log.warn('CapacitorReminderService: Notification permission not granted');
          return false;
        }

        await LocalNotifications.schedule({
          notifications: [
            {
              id: options.notificationId,
              title: options.title,
              body: `Reminder: ${options.title}`,
              // Include action type for iOS notification actions (Snooze/Done buttons)
              actionTypeId: this._platformService.isIOS()
                ? REMINDER_ACTION_TYPE_ID
                : undefined,
              schedule: {
                at: new Date(triggerAt),
                allowWhileIdle: true,
              },
              extra: {
                reminderId: options.reminderId,
                relatedId: options.relatedId,
                reminderType: options.reminderType,
              },
            },
          ],
        });

        Log.log('CapacitorReminderService: iOS reminder scheduled', {
          notificationId: options.notificationId,
          title: options.title,
          triggerAt: new Date(triggerAt).toISOString(),
        });
        return true;
      } catch (error) {
        Log.err('CapacitorReminderService: Failed to schedule iOS reminder', error);
        return false;
      }
    }

    Log.warn('CapacitorReminderService: No reminder implementation for platform', {
      platform: this._platformService.platform,
    });
    return false;
  }

  /**
   * Cancel a scheduled reminder
   */
  async cancelReminder(notificationId: number): Promise<boolean> {
    if (!this.isAvailable) {
      return false;
    }

    Log.log('🚫 CapacitorReminderService.cancelReminder called', {
      notificationId,
      isAndroidWebView: IS_ANDROID_WEB_VIEW,
      hasNativeCanceller: !!androidInterface?.cancelNativeReminder,
    });

    // On Android, use native cancellation
    if (IS_ANDROID_WEB_VIEW && androidInterface.cancelNativeReminder) {
      try {
        androidInterface.cancelNativeReminder(notificationId);
        Log.log('✅ CapacitorReminderService: Android reminder cancelled', {
          notificationId,
        });
        return true;
      } catch (error) {
        Log.err('❌ CapacitorReminderService: Failed to cancel Android reminder', error);
        return false;
      }
    }

    // On iOS (and Android as fallback), use Capacitor LocalNotifications
    if (this._platformService.isNative) {
      return this._notificationService.cancel(notificationId);
    }

    return false;
  }

  /**
   * Cancel multiple scheduled reminders
   */
  async cancelMultipleReminders(notificationIds: number[]): Promise<boolean> {
    if (!this.isAvailable || notificationIds.length === 0) {
      return false;
    }

    // On Android, cancel each individually
    if (IS_ANDROID_WEB_VIEW && androidInterface.cancelNativeReminder) {
      try {
        for (const id of notificationIds) {
          androidInterface.cancelNativeReminder(id);
        }
        Log.log('CapacitorReminderService: Android reminders cancelled', {
          count: notificationIds.length,
        });
        return true;
      } catch (error) {
        Log.err('CapacitorReminderService: Failed to cancel Android reminders', error);
        return false;
      }
    }

    // On iOS (and Android as fallback), use batch cancellation
    if (this._platformService.isNative) {
      return this._notificationService.cancelMultiple(notificationIds);
    }

    return false;
  }

  /**
   * Ensure notification permissions are granted.
   * Also handles Android 12+ exact alarm permissions.
   */
  async ensurePermissions(): Promise<boolean> {
    if (!this.isAvailable) {
      return false;
    }

    const hasPermission = await this._notificationService.ensurePermissions();
    if (!hasPermission) {
      return false;
    }

    // On Android 12+, also check exact alarm permission
    if (IS_ANDROID_WEB_VIEW) {
      try {
        const exactAlarmStatus = await LocalNotifications.checkExactNotificationSetting();
        if (exactAlarmStatus?.exact_alarm !== 'granted') {
          await LocalNotifications.changeExactNotificationSetting();
        }
      } catch (error) {
        // Non-fatal - exact alarms may not be available on all devices
        Log.warn('CapacitorReminderService: Exact alarm check failed', error);
      }
    }

    return true;
  }
}
