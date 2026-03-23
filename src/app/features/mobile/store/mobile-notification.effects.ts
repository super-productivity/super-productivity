import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { switchMap, tap } from 'rxjs/operators';
import { combineLatest, timer } from 'rxjs';
import { SnackService } from '../../../core/snack/snack.service';
import { Log } from '../../../core/log';
import { T } from '../../../t.const';
import { generateNotificationId } from '../../android/android-notification-id.util';
import { Store } from '@ngrx/store';
import {
  selectAllTasksWithReminder,
  selectUndoneTasksWithDueDayNoReminder,
} from '../../tasks/store/task.selectors';
import { CapacitorReminderService } from '../../../core/platform/capacitor-reminder.service';
import { CapacitorPlatformService } from '../../../core/platform/capacitor-platform.service';
import { GlobalConfigService } from '../../config/global-config.service';

const DELAY_PERMISSIONS = 2000;
const DELAY_SCHEDULE = 5000;

@Injectable()
export class MobileNotificationEffects {
  private _snackService = inject(SnackService);
  private _store = inject(Store);
  private _reminderService = inject(CapacitorReminderService);
  private _platformService = inject(CapacitorPlatformService);
  private _globalConfigService = inject(GlobalConfigService);
  // Single-shot guard so we don't spam the user with duplicate warnings.
  private _hasShownNotificationWarning = false;
  // Track scheduled reminder IDs to cancel removed ones
  private _scheduledReminderIds = new Set<string>();
  // Track scheduled due-date notification IDs separately
  private _scheduledDueDateIds = new Set<string>();

  /**
   * Check notification permissions on startup for mobile platforms.
   * Shows a warning if permissions are not granted.
   */
  askPermissionsIfNotGiven$ =
    this._platformService.isNative &&
    createEffect(
      () =>
        timer(DELAY_PERMISSIONS).pipe(
          tap(async () => {
            try {
              const hasPermission = await this._reminderService.ensurePermissions();
              Log.log('MobileEffects: initial permission check', { hasPermission });
              if (!hasPermission) {
                this._notifyPermissionIssue();
                return;
              }
              // Check exact alarm permission separately (Android 12+)
              const hasExactAlarm =
                await this._reminderService.ensureExactAlarmPermission();
              if (!hasExactAlarm) {
                this._snackService.open({
                  type: 'ERROR',
                  msg: T.NOTIFICATION.EXACT_ALARM_DENIED,
                });
              }
            } catch (error) {
              Log.err(error);
              this._notifyPermissionIssue(error?.toString());
            }
          }),
        ),
      {
        dispatch: false,
      },
    );

  /**
   * Schedule reminders for tasks with remindAt set.
   * Works on both iOS and Android.
   *
   * SYNC-SAFE: This effect is intentionally safe during sync/hydration because:
   * - dispatch: false - no store mutations, only native API calls
   * - We WANT notifications scheduled for synced tasks (user-facing functionality)
   * - Native scheduling calls are idempotent - rescheduling the same reminder is harmless
   * - Cancellation of removed reminders correctly handles tasks deleted via sync
   */
  scheduleNotifications$ =
    this._platformService.isNative &&
    createEffect(
      () =>
        timer(DELAY_SCHEDULE).pipe(
          switchMap(() => this._store.select(selectAllTasksWithReminder)),
          tap(async (tasksWithReminders) => {
            try {
              const currentReminderIds = new Set(
                (tasksWithReminders || []).map((t) => t.id),
              );

              // Cancel reminders that are no longer in the list
              for (const previousId of this._scheduledReminderIds) {
                if (!currentReminderIds.has(previousId)) {
                  const notificationId = generateNotificationId(previousId);
                  Log.log('MobileEffects: cancelling removed reminder', {
                    relatedId: previousId,
                    notificationId,
                  });
                  await this._reminderService.cancelReminder(notificationId);
                }
              }

              if (!tasksWithReminders || tasksWithReminders.length === 0) {
                this._scheduledReminderIds.clear();
                return;
              }

              Log.log('MobileEffects: scheduling reminders', {
                reminderCount: tasksWithReminders.length,
                platform: this._platformService.platform,
              });

              // Ensure permissions are granted
              const hasPermission = await this._reminderService.ensurePermissions();
              if (!hasPermission) {
                this._notifyPermissionIssue();
                return;
              }

              // Schedule each reminder using the platform-appropriate method
              for (const task of tasksWithReminders) {
                // Skip reminders that are already in the past (already fired)
                // These will be handled by the dialog when the user opens the app
                if (task.remindAt! < Date.now()) {
                  continue;
                }

                const id = generateNotificationId(task.id);
                await this._reminderService.scheduleReminder({
                  notificationId: id,
                  reminderId: task.id,
                  relatedId: task.id,
                  title: task.title,
                  reminderType: 'TASK',
                  triggerAtMs: task.remindAt!,
                });
              }

              // Update tracked IDs
              this._scheduledReminderIds = currentReminderIds;

              Log.log('MobileEffects: scheduled reminders', {
                reminderCount: tasksWithReminders.length,
                platform: this._platformService.platform,
              });
            } catch (error) {
              Log.err(error);
              this._notifyPermissionIssue(error?.toString());
            }
          }),
        ),
      {
        dispatch: false,
      },
    );

  /**
   * Schedule due-date notifications for tasks with dueDay but no remindAt.
   * Fires at the configured hour (default 9 AM).
   */
  scheduleDueDateNotifications$ =
    this._platformService.isNative &&
    createEffect(
      () =>
        timer(DELAY_SCHEDULE).pipe(
          switchMap(() =>
            combineLatest([
              this._store.select(selectUndoneTasksWithDueDayNoReminder),
              this._globalConfigService.cfg$,
            ]),
          ),
          tap(async ([tasks, cfg]) => {
            try {
              const notifyOnDueDate = cfg?.reminder?.notifyOnDueDate ?? true;
              const dueDateHour = Math.floor(
                Math.max(0, Math.min(23, cfg?.reminder?.dueDateNotificationHour ?? 9)),
              );

              // If disabled, cancel all previously scheduled due-date notifications
              if (!notifyOnDueDate) {
                for (const previousId of this._scheduledDueDateIds) {
                  const notificationId = generateNotificationId(previousId + '_dueday');
                  await this._reminderService.cancelReminder(notificationId);
                }
                this._scheduledDueDateIds.clear();
                return;
              }

              const currentDueDateIds = new Set((tasks || []).map((t) => t.id));

              // Cancel due-date notifications for tasks no longer in the list
              for (const previousId of this._scheduledDueDateIds) {
                if (!currentDueDateIds.has(previousId)) {
                  const notificationId = generateNotificationId(previousId + '_dueday');
                  await this._reminderService.cancelReminder(notificationId);
                }
              }

              if (!tasks || tasks.length === 0) {
                this._scheduledDueDateIds.clear();
                return;
              }

              const hasPermission = await this._reminderService.ensurePermissions();
              if (!hasPermission) {
                return;
              }

              const now = Date.now();
              for (const task of tasks) {
                // Build trigger time: dueDay at configured hour, local timezone
                const triggerDate = new Date(
                  task.dueDay + 'T' + String(dueDateHour).padStart(2, '0') + ':00:00',
                );
                const triggerAtMs = triggerDate.getTime();

                // Skip if in the past
                if (triggerAtMs <= now) {
                  continue;
                }

                const id = generateNotificationId(task.id + '_dueday');
                await this._reminderService.scheduleReminder({
                  notificationId: id,
                  reminderId: task.id,
                  relatedId: task.id,
                  title: task.title,
                  reminderType: 'DUE_DATE',
                  triggerAtMs,
                });
              }

              this._scheduledDueDateIds = currentDueDateIds;

              Log.log('MobileEffects: scheduled due-date notifications', {
                count: tasks.length,
              });
            } catch (error) {
              Log.err(error);
            }
          }),
        ),
      {
        dispatch: false,
      },
    );

  private _notifyPermissionIssue(message?: string): void {
    if (this._hasShownNotificationWarning) {
      return;
    }
    this._hasShownNotificationWarning = true;
    // Fallback snackbar so the user gets feedback even when the native APIs throw.
    this._snackService.open({
      type: 'ERROR',
      msg:
        message ||
        'Notification permission not granted. Please enable notifications in your device settings for reminders to work.',
    });
  }
}
