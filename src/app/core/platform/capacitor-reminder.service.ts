import { inject, Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Log } from '../log';
import { CapacitorPlatformService } from './capacitor-platform.service';
import {
  CapacitorNotificationService,
  NotificationActionEvent,
  REMINDER_ACTION_TYPE_ID,
} from './capacitor-notification.service';
import {
  IS_ANDROID_WEB_VIEW,
  IS_ANDROID_WEB_VIEW_TOKEN,
} from '../../util/is-android-web-view';
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
  // Injected (vs reading IS_ANDROID_WEB_VIEW directly) so tests can override
  // it via DI — matches the pattern in `task-reminder.effects.ts`.
  private _isAndroidWebView = inject(IS_ANDROID_WEB_VIEW_TOKEN);

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
      reminderId: options.reminderId,
      triggerAt: new Date(triggerAt).toISOString(),
      triggerInMs: triggerAt - now,
      triggerInMinutes: Math.round((triggerAt - now) / 1000 / 60),
      isAndroidWebView: IS_ANDROID_WEB_VIEW,
      hasNativeScheduler: !!androidInterface?.scheduleNativeReminder,
    });

    // On Android, use native AlarmManager for precision
    if (IS_ANDROID_WEB_VIEW && androidInterface.scheduleNativeReminder) {
      try {
        // Due-date notifications fire at an arbitrary hour (e.g. 9 AM) that the
        // user did not explicitly choose, so they should never be alarm-style.
        const useAlarmStyle =
          options.reminderType !== 'DUE_DATE' &&
          (this._globalConfigService.cfg()?.reminder?.useAlarmStyleReminders ?? false);
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
          useAlarmStyle, // isOngoing: persistent notifications when alarm-style is enabled
        );

        Log.log('✅ CapacitorReminderService: Android reminder scheduled successfully', {
          notificationId: options.notificationId,
          reminderId: options.reminderId,
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
              // Play the default system notification sound.
              // Without this, iOS delivers notifications silently (content.sound = nil).
              // The string 'default' triggers iOS's file-not-found fallback to the system sound.
              sound: 'default',
              // Include action type for iOS notification actions (Done/Snooze buttons)
              actionTypeId:
                this._platformService.isIOS() && options.reminderType !== 'DUE_DATE'
                  ? REMINDER_ACTION_TYPE_ID
                  : undefined,
              // Group notifications on iOS via thread identifier
              threadIdentifier: this._platformService.isIOS()
                ? 'sp_reminders'
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
          reminderId: options.reminderId,
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

    if (this._isLegacyAndroidWebView()) {
      // No Capacitor bridge → `LocalNotifications.checkPermissions()` would
      // fall back to `Notification.permission`, which Android WebView leaves
      // at 'default' regardless of OS POST_NOTIFICATIONS state (issue #7408).
      // Reminders here go through AlarmManager via the SUPAndroid bridge; the
      // OS enforces permission at fire time, so we trust it and skip the
      // upfront check.
      return true;
    }

    const hasPermission = await this._notificationService.ensurePermissions();
    if (!hasPermission) {
      return false;
    }

    // Note: exact alarm permission is checked once at startup via
    // askPermissionsIfNotGiven$ in mobile-notification.effects.ts.
    // We intentionally do NOT check it here to avoid repeatedly
    // opening the Android settings page on every scheduling cycle.

    return true;
  }

  /**
   * Check if exact alarm permission is granted (Android 12+).
   * Returns true on non-Android platforms or if permission is granted.
   */
  async ensureExactAlarmPermission(): Promise<boolean> {
    if (!IS_ANDROID_WEB_VIEW) {
      return true;
    }

    if (this._isLegacyAndroidWebView()) {
      // Same reasoning as ensurePermissions(): no Capacitor bridge in the
      // legacy WebView, so the LocalNotifications exact-alarm helpers throw
      // or return stale data. AlarmManager will fall back to inexact
      // delivery if SCHEDULE_EXACT_ALARM is denied — acceptable for
      // reminder UX. Skip the check.
      return true;
    }

    try {
      const exactAlarmStatus = await LocalNotifications.checkExactNotificationSetting();
      if (exactAlarmStatus?.exact_alarm !== 'granted') {
        await LocalNotifications.changeExactNotificationSetting();
        // Re-check after prompting
        const recheck = await LocalNotifications.checkExactNotificationSetting();
        return recheck?.exact_alarm === 'granted';
      }
      return true;
    } catch (error) {
      Log.warn('CapacitorReminderService: Exact alarm check failed', error);
      return false;
    }
  }

  /**
   * True on the legacy `FullscreenActivity`, which exposes the SUPAndroid
   * bridge but does NOT host a Capacitor bridge. Capacitor plugin calls fall
   * back to their web implementations there, and the Web Notifications API
   * is unimplemented in Android WebView — making any LocalNotifications
   * permission/exact-alarm check unreliable. Reminder scheduling on this
   * path goes through AlarmManager via `androidInterface.scheduleNativeReminder`,
   * which the OS gates with POST_NOTIFICATIONS at fire time. See issue #7408.
   */
  private _isLegacyAndroidWebView(): boolean {
    return this._isAndroidWebView && !Capacitor.isNativePlatform();
  }
}
