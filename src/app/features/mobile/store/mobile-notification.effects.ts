import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { switchMap, tap } from 'rxjs/operators';
import { combineLatest, timer } from 'rxjs';
import { SnackService } from '../../../core/snack/snack.service';
import { Log } from '../../../core/log';
import { generateNotificationId } from '../../android/android-notification-id.util';
import { Store } from '@ngrx/store';
import {
  selectAllTasksWithReminder,
  selectAllUndoneTasksWithDueDay,
} from '../../tasks/store/task.selectors';
import { getTodayStr } from '../../tasks/util/get-today-str';
import { GlobalConfigService } from '../../config/global-config.service';
import { CapacitorReminderService } from '../../../core/platform/capacitor-reminder.service';
import { CapacitorPlatformService } from '../../../core/platform/capacitor-platform.service';
import { IS_ANDROID_WEB_VIEW } from '../../../util/is-android-web-view';
import { androidInterface } from '../../android/android-interface';
import { TaskService } from '../../tasks/task.service';

const DELAY_PERMISSIONS = 2000;
const DELAY_SCHEDULE = 5000;

@Injectable()
export class MobileNotificationEffects {
  private _snackService = inject(SnackService);
  private _store = inject(Store);
  private _taskService = inject(TaskService);
  private _reminderService = inject(CapacitorReminderService);
  private _platformService = inject(CapacitorPlatformService);
  private _globalConfigService = inject(GlobalConfigService);
  // Single-shot guard so we don't spam the user with duplicate warnings.
  private _hasShownNotificationWarning = false;
  // Track scheduled reminder IDs to cancel removed ones
  private _scheduledReminderIds = new Set<string>();

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
          switchMap(() =>
            combineLatest([
              this._store.select(selectAllTasksWithReminder),
              this._store.select(selectAllUndoneTasksWithDueDay),
            ]),
          ),
          tap(async ([tasksWithReminders, tasksWithDueDay]) => {
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

              // --- Due-date notifications (no explicit reminder time) ---
              const reminderConfig = this._globalConfigService.cfg()?.reminder;
              if (reminderConfig?.notifyOnDueDate) {
                const todayStr = getTodayStr();
                const hour = reminderConfig.dueDateNotificationHour ?? 9;
                const todayAtHour = new Date();
                todayAtHour.setHours(hour, 0, 0, 0);
                const triggerAtMs = todayAtHour.getTime();

                for (const task of tasksWithDueDay || []) {
                  // Only tasks due today, without an explicit remindAt
                  if (task.dueDay !== todayStr || task.remindAt) {
                    continue;
                  }
                  // Skip if already past the notification hour
                  if (triggerAtMs < Date.now()) {
                    continue;
                  }
                  const id = generateNotificationId('due-' + task.id);
                  await this._reminderService.scheduleReminder({
                    notificationId: id,
                    reminderId: task.id,
                    relatedId: task.id,
                    title: task.title,
                    reminderType: 'TASK',
                    triggerAtMs,
                  });
                  currentReminderIds.add(task.id);
                }
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
   * Handle "Done" action from reminder notification.
   * Marks the task as done.
   */
  handleReminderDoneAction$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        androidInterface.onReminderMarkDone$.pipe(
          tap((taskId) => {
            Log.log('MobileEffects: Done action from reminder notification', { taskId });
            this._taskService.setDone(taskId);
          }),
        ),
      { dispatch: false },
    );

  /**
   * Handle "Open" action from reminder notification.
   * Navigates to the task.
   */
  handleReminderOpenAction$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        androidInterface.onReminderOpenTask$.pipe(
          tap((taskId) => {
            Log.log('MobileEffects: Open action from reminder notification', { taskId });
            this._taskService.focusTask(taskId);
          }),
        ),
      { dispatch: false },
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
