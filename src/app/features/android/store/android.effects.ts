import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { switchMap, tap } from 'rxjs/operators';
import { timer } from 'rxjs';
import { ReminderService } from '../../reminder/reminder.service';
import { LocalNotifications } from '@capacitor/local-notifications';
import { SnackService } from '../../../core/snack/snack.service';
import { IS_ANDROID_WEB_VIEW } from '../../../util/is-android-web-view';
import { DroidLog } from '../../../core/log';
import { generateNotificationId } from '../android-notification-id.util';
import { androidInterface } from '../android-interface';
import { TaskService } from '../../tasks/task.service';
import { TaskAttachmentService } from '../../tasks/task-attachment/task-attachment.service';

// TODO send message to electron when current task changes here

const DELAY_PERMISSIONS = 2000;
const DELAY_SCHEDULE = 5000;

@Injectable()
export class AndroidEffects {
  private _reminderService = inject(ReminderService);
  private _snackService = inject(SnackService);
  private _taskService = inject(TaskService);
  private _taskAttachmentService = inject(TaskAttachmentService);
  // Single-shot guard so we don't spam the user with duplicate warnings.
  private _hasShownNotificationWarning = false;
  private _hasCheckedExactAlarm = false;
  // Track scheduled reminder IDs to cancel removed ones
  private _scheduledReminderIds = new Set<string>();

  askPermissionsIfNotGiven$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        timer(DELAY_PERMISSIONS).pipe(
          tap(async (v) => {
            try {
              const checkResult = await LocalNotifications.checkPermissions();
              DroidLog.log('AndroidEffects: initial permission check', checkResult);
              const displayPermissionGranted = checkResult.display === 'granted';
              if (displayPermissionGranted) {
                await this._ensureExactAlarmAccess();
                return;
              }
              // Surface a gentle warning early, but defer the actual permission prompt until we truly need it.
              this._notifyPermissionIssue();
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

  // Use native reminder scheduling with BroadcastReceiver for actions
  // This allows snooze/done to work without opening the app
  scheduleNotifications$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        timer(DELAY_SCHEDULE).pipe(
          switchMap(() => this._reminderService.reminders$),
          tap(async (reminders) => {
            try {
              const currentReminderIds = new Set(
                (reminders || []).map((r) => r.relatedId),
              );

              // Cancel reminders that are no longer in the list
              for (const previousId of this._scheduledReminderIds) {
                if (!currentReminderIds.has(previousId)) {
                  const notificationId = generateNotificationId(previousId);
                  DroidLog.log('AndroidEffects: cancelling removed reminder', {
                    relatedId: previousId,
                    notificationId,
                  });
                  androidInterface.cancelNativeReminder?.(notificationId);
                }
              }

              if (!reminders || reminders.length === 0) {
                this._scheduledReminderIds.clear();
                return;
              }
              DroidLog.log('AndroidEffects: scheduling reminders natively', {
                reminderCount: reminders.length,
              });

              // Check permissions first
              const checkResult = await LocalNotifications.checkPermissions();
              let displayPermissionGranted = checkResult.display === 'granted';
              if (!displayPermissionGranted) {
                const requestResult = await LocalNotifications.requestPermissions();
                displayPermissionGranted = requestResult.display === 'granted';
                if (!displayPermissionGranted) {
                  this._notifyPermissionIssue();
                  return;
                }
              }
              await this._ensureExactAlarmAccess();

              // Schedule each reminder using native Android AlarmManager
              for (const reminder of reminders) {
                const id = generateNotificationId(reminder.relatedId);
                const now = Date.now();
                const scheduleAt =
                  reminder.remindAt <= now ? now + 1000 : reminder.remindAt;

                androidInterface.scheduleNativeReminder?.(
                  id,
                  reminder.id,
                  reminder.relatedId,
                  reminder.title,
                  reminder.type,
                  scheduleAt,
                );
              }

              // Update tracked IDs
              this._scheduledReminderIds = currentReminderIds;

              DroidLog.log('AndroidEffects: scheduled native reminders', {
                reminderCount: reminders.length,
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

  // markTaskAsDone$ = createEffect(() =>
  //   androidInterface.onMarkCurrentTaskAsDone$.pipe(
  //     withLatestFrom(this._store$.select(selectCurrentTask)),
  //     filter(([, currentTask]) => !!currentTask),
  //     map(([, currentTask]) =>
  //       updateTask({
  //         task: { id: (currentTask as TaskCopy).id, changes: { isDone: true } },
  //       }),
  //     ),
  //   ),
  // );
  //
  // pauseTracking$ = createEffect(() =>
  //   androidInterface.onPauseCurrentTask$.pipe(
  //     withLatestFrom(this._store$.select(selectCurrentTask)),
  //     filter(([, currentTask]) => !!currentTask),
  //     map(([, currentTask]) => setCurrentTask({ id: null })),
  //   ),
  // );
  // showAddTaskBar$ = createEffect(() =>
  //   androidInterface.onAddNewTask$.pipe(map(() => showAddTaskBar())),
  // );

  private async _ensureExactAlarmAccess(): Promise<void> {
    try {
      if (this._hasCheckedExactAlarm) {
        return;
      }
      // Android 12+ gates exact alarms behind a separate toggle; surface the settings screen if needed.
      const exactAlarmStatus = await LocalNotifications.checkExactNotificationSetting();
      if (exactAlarmStatus?.exact_alarm !== 'granted') {
        DroidLog.log(await LocalNotifications.changeExactNotificationSetting());
      } else {
        this._hasCheckedExactAlarm = true;
      }
    } catch (error) {
      DroidLog.warn(error);
    }
  }

  private _notifyPermissionIssue(message?: string): void {
    if (this._hasShownNotificationWarning) {
      return;
    }
    this._hasShownNotificationWarning = true;
    // Fallback snackbar so the user gets feedback even when the native APIs throw.
    this._snackService.open({
      type: 'ERROR',
      msg: message || 'Notifications not supported',
    });
  }
}
