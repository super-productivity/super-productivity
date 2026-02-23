import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { switchMap, tap } from 'rxjs/operators';
import { timer } from 'rxjs';
import { SnackService } from '../../../core/snack/snack.service';
import { IS_ANDROID_WEB_VIEW } from '../../../util/is-android-web-view';
import { DroidLog } from '../../../core/log';
import { generateNotificationId } from '../android-notification-id.util';
import { androidInterface } from '../android-interface';
import { TaskService } from '../../tasks/task.service';
import { TaskAttachmentService } from '../../tasks/task-attachment/task-attachment.service';
import { Store } from '@ngrx/store';
import { selectAllTasksWithReminder } from '../../tasks/store/task.selectors';
import { CapacitorReminderService } from '../../../core/platform/capacitor-reminder.service';
import { CapacitorPlatformService } from '../../../core/platform/capacitor-platform.service';

// TODO send message to electron when current task changes here

const DELAY_PERMISSIONS = 2000;
const DELAY_SCHEDULE = 5000;

@Injectable()
export class AndroidEffects {
  private _snackService = inject(SnackService);
  private _taskService = inject(TaskService);
  private _taskAttachmentService = inject(TaskAttachmentService);
  private _store = inject(Store);
  private _reminderService = inject(CapacitorReminderService);
  private _platformService = inject(CapacitorPlatformService);
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
              DroidLog.log('MobileEffects: initial permission check', { hasPermission });
              if (!hasPermission) {
                this._notifyPermissionIssue();
              }
            } catch (error) {
              DroidLog.err(error);
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
                  DroidLog.log('MobileEffects: cancelling removed reminder', {
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

              DroidLog.log('MobileEffects: scheduling reminders', {
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

              DroidLog.log('MobileEffects: scheduled reminders', {
                reminderCount: tasksWithReminders.length,
                platform: this._platformService.platform,
              });
            } catch (error) {
              DroidLog.err(error);
              this._notifyPermissionIssue(error?.toString());
            }
          }),
        ),
      {
        dispatch: false,
      },
    );

  handleShare$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        androidInterface.onShareWithAttachment$.pipe(
          tap((shareData) => {
            const truncatedTitle =
              shareData.title.length > 150
                ? shareData.title.substring(0, 147) + '...'
                : shareData.title;
            const taskTitle = `Check: ${truncatedTitle}`;
            const taskId = this._taskService.add(taskTitle);
            const icon = shareData.type === 'LINK' ? 'link' : 'file_present';
            this._taskAttachmentService.addAttachment(taskId, {
              title: shareData.title,
              type: shareData.type,
              path: shareData.path,
              icon,
              id: null,
            });
            this._snackService.open({
              type: 'SUCCESS',
              msg: 'Task created from share',
            });
          }),
        ),
      { dispatch: false },
    );

  // Process tasks queued from the home screen widget
  processWidgetTasks$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        androidInterface.onResume$.pipe(
          tap(() => {
            const queueJson = androidInterface.getWidgetTaskQueue?.();
            if (!queueJson) {
              return;
            }

            try {
              const queue = JSON.parse(queueJson);
              const tasks = queue.tasks || [];

              for (const widgetTask of tasks) {
                this._taskService.add(widgetTask.title);
              }

              if (tasks.length > 0) {
                this._snackService.open({
                  type: 'SUCCESS',
                  msg:
                    tasks.length === 1
                      ? 'Task added from widget'
                      : `${tasks.length} tasks added from widget`,
                });
              }
            } catch (e) {
              DroidLog.err('Failed to process widget tasks', e);
            }
          }),
        ),
      { dispatch: false },
    );

  // Check for pending share data on resume (catches app killed after receiving share)
  checkPendingShareOnResume$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        androidInterface.onResume$.pipe(
          tap(() => {
            try {
              const pendingShare = androidInterface.getPendingShareData?.();
              if (pendingShare) {
                const parsed = JSON.parse(pendingShare);
                DroidLog.log('Resume: found pending share data', parsed);
                androidInterface.onShareWithAttachment$.next(parsed);
              }
            } catch (e) {
              DroidLog.err('Failed to process pending share on resume', e);
            }
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
