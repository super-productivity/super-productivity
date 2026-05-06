import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { distinctUntilChanged, map, switchMap, tap } from 'rxjs/operators';
import { combineLatest, Observable, timer } from 'rxjs';
import { SnackService } from '../../../core/snack/snack.service';
import { Log } from '../../../core/log';
import { T } from '../../../t.const';
import { generateNotificationId } from '../../android/android-notification-id.util';
import { Store } from '@ngrx/store';
import {
  selectAllTasksWithReminder,
  selectAllTasksWithDeadlineReminder,
  selectUndoneTasksWithDueDayNoReminder,
} from '../../tasks/store/task.selectors';
import { CapacitorReminderService } from '../../../core/platform/capacitor-reminder.service';
import { CapacitorPlatformService } from '../../../core/platform/capacitor-platform.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { ReminderConfig } from '../../config/global-config.model';

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
  // Track scheduled deadline reminder IDs separately
  private _scheduledDeadlineIds = new Set<string>();

  // Narrowed cfg slice so the scheduling effects only re-run on reminder-config
  // changes, not on every unrelated global-config edit (theme, sync, etc.).
  // Reference equality is sufficient: NgRx reducers preserve slice references
  // when that slice is untouched.
  private _reminderCfg$: Observable<ReminderConfig | undefined> =
    this._globalConfigService.cfg$.pipe(
      map((c) => c?.reminder),
      distinctUntilChanged(),
    );

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
   * - Reacts to reminder-config changes (disableReminders) so the master toggle
   *   takes effect immediately; unrelated cfg changes are filtered via _reminderCfg$
   */
  scheduleNotifications$ =
    this._platformService.isNative &&
    createEffect(
      () =>
        timer(DELAY_SCHEDULE).pipe(
          switchMap(() =>
            combineLatest([
              this._store.select(selectAllTasksWithReminder),
              this._reminderCfg$,
            ]),
          ),
          tap(async ([tasksWithReminders, reminderCfg]) => {
            try {
              // Without this, alarms scheduled on prior ticks keep firing on Android
              // via AlarmManager even after the user disables reminders.
              if (reminderCfg?.disableReminders) {
                for (const previousId of this._scheduledReminderIds) {
                  const notificationId = generateNotificationId(previousId);
                  await this._reminderService.cancelReminder(notificationId);
                }
                this._scheduledReminderIds.clear();
                return;
              }

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
              this._reminderCfg$,
            ]),
          ),
          tap(async ([tasks, reminderCfg]) => {
            try {
              const notifyOnDueDate = reminderCfg?.notifyOnDueDate ?? true;
              const disableReminders = reminderCfg?.disableReminders ?? false;
              const dueDateHour = Math.floor(
                Math.max(0, Math.min(23, reminderCfg?.dueDateNotificationHour ?? 9)),
              );

              // If disabled (by master switch or per-category), cancel previously
              // scheduled due-date notifications and short-circuit.
              if (disableReminders || !notifyOnDueDate) {
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

  /**
   * Schedule explicit deadline reminders on iOS.
   *
   * SYNC-SAFE: Same rationale as scheduleNotifications$ above — dispatch:false
   * (no store mutations), idempotent native scheduling, and we deliberately want
   * deadline reminders scheduled for synced tasks. Cancellations are driven by
   * the selector diff against `_scheduledDeadlineIds`.
   */
  scheduleDeadlineNotifications$ =
    this._platformService.isNative &&
    this._platformService.isIOS() &&
    createEffect(
      () =>
        timer(DELAY_SCHEDULE).pipe(
          switchMap(() =>
            combineLatest([
              this._store.select(selectAllTasksWithDeadlineReminder),
              this._reminderCfg$,
            ]),
          ),
          tap(async ([tasks, reminderCfg]) => {
            try {
              if (reminderCfg?.disableReminders) {
                for (const previousId of this._scheduledDeadlineIds) {
                  const notificationId = generateNotificationId(previousId + '_deadline');
                  await this._reminderService.cancelReminder(notificationId);
                }
                this._scheduledDeadlineIds.clear();
                return;
              }

              const currentDeadlineIds = new Set((tasks || []).map((t) => t.id));

              for (const previousId of this._scheduledDeadlineIds) {
                if (!currentDeadlineIds.has(previousId)) {
                  const notificationId = generateNotificationId(previousId + '_deadline');
                  await this._reminderService.cancelReminder(notificationId);
                }
              }

              if (!tasks || tasks.length === 0) {
                this._scheduledDeadlineIds.clear();
                return;
              }

              const hasPermission = await this._reminderService.ensurePermissions();
              if (!hasPermission) {
                return;
              }

              const now = Date.now();
              for (const task of tasks) {
                if (!task.deadlineRemindAt || task.deadlineRemindAt <= now) {
                  if (this._scheduledDeadlineIds.has(task.id)) {
                    await this._reminderService.cancelReminder(
                      generateNotificationId(task.id + '_deadline'),
                    );
                  }
                  continue;
                }

                const id = generateNotificationId(task.id + '_deadline');
                await this._reminderService.scheduleReminder({
                  notificationId: id,
                  reminderId: task.id + '_deadline',
                  relatedId: task.id,
                  title: task.title,
                  reminderType: 'DEADLINE',
                  triggerAtMs: task.deadlineRemindAt,
                });
              }

              this._scheduledDeadlineIds = currentDeadlineIds;

              Log.log('MobileEffects: scheduled deadline reminders', {
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
