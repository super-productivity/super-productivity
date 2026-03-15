import { inject, NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReminderService } from './reminder.service';
import { MatDialog } from '@angular/material/dialog';
import { IS_ELECTRON } from '../../app.constants';
import {
  IS_NATIVE_PLATFORM,
  IS_IOS_NATIVE,
  IS_ANDROID_NATIVE,
} from '../../util/is-native-platform';
import {
  concatMap,
  delay,
  filter,
  first,
  mapTo,
  switchMap,
  map,
  take,
} from 'rxjs/operators';
import { UiHelperService } from '../ui-helper/ui-helper.service';
import { NotifyService } from '../../core/notify/notify.service';
import { DialogViewTaskRemindersComponent } from '../tasks/dialog-view-task-reminders/dialog-view-task-reminders.component';
import { throttle } from '../../util/decorators';
import { SyncTriggerService } from '../../imex/sync/sync-trigger.service';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { merge, of, timer, interval, firstValueFrom } from 'rxjs';
import { TaskService } from '../tasks/task.service';
import { SnackService } from '../../core/snack/snack.service';
import { T } from 'src/app/t.const';
import { TaskWithReminderData } from '../tasks/task.model';
import { Store } from '@ngrx/store';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { GlobalConfigService } from '../config/global-config.service';
import { CapacitorReminderService } from '../../core/platform/capacitor-reminder.service';
import {
  NOTIFICATION_ACTION,
  NotificationActionEvent,
} from '../../core/platform/capacitor-notification.service';
import { Log } from '../../core/log';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { androidInterface } from '../android/android-interface';

const SNOOZE_10M_MS = 10 * 60 * 1000;
const SNOOZE_1H_MS = 60 * 60 * 1000;

@NgModule({
  declarations: [],
  imports: [CommonModule],
})
export class ReminderModule {
  private readonly _reminderService = inject(ReminderService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _snackService = inject(SnackService);
  private readonly _uiHelperService = inject(UiHelperService);
  private readonly _notifyService = inject(NotifyService);
  private readonly _layoutService = inject(LayoutService);
  private readonly _taskService = inject(TaskService);
  private readonly _syncTriggerService = inject(SyncTriggerService);
  private readonly _store = inject(Store);
  private readonly _globalConfigService = inject(GlobalConfigService);
  private readonly _capacitorReminderService = inject(CapacitorReminderService);
  private readonly _syncWrapperService = inject(SyncWrapperService);

  constructor() {
    // Initialize reminder service (runs migration in background)
    this._reminderService.init();

    // Initialize platform-specific notification actions
    this._initIOSNotificationActions();
    this._initAndroidNotificationActions();

    this._syncTriggerService.afterInitialSyncDoneAndDataLoadedInitially$
      .pipe(
        first(),
        delay(1000),
        concatMap(() =>
          this._reminderService.onRemindersActive$.pipe(
            // NOTE: we simply filter for open dialogs, as reminders are re-queried quite often
            filter(
              (reminders) =>
                this._matDialog.openDialogs.length === 0 &&
                !!reminders &&
                reminders.length > 0,
            ),
            // don't show reminders while add task bar is open
            switchMap((reminders: TaskWithReminderData[]) => {
              const isShowAddTaskBar = this._layoutService.isShowAddTaskBar();
              return isShowAddTaskBar
                ? merge([
                    // Wait for add task bar to close
                    interval(100).pipe(
                      map(() => this._layoutService.isShowAddTaskBar()),
                      filter((isShowAddTaskBarLive) => !isShowAddTaskBarLive),
                      take(1),
                    ),
                    // in case someone just forgot to close it
                    timer(10000),
                  ]).pipe(first(), mapTo(reminders), delay(1000))
                : of(reminders);
            }),
          ),
        ),
      )
      .subscribe((reminders: TaskWithReminderData[]) => {
        const now = Date.now();
        const overdueReminders = reminders.filter(
          (r) => r.reminderData?.remindAt && r.reminderData.remindAt < now,
        );
        const futureReminders = reminders.filter(
          (r) => r.reminderData?.remindAt && r.reminderData.remindAt >= now,
        );

        Log.log('=== REMINDER DIALOG TRIGGER ===', {
          platform: IS_ANDROID_NATIVE ? 'Android' : IS_ELECTRON ? 'Electron' : 'Web',
          reminderCount: reminders.length,
          overdueCount: overdueReminders.length,
          futureCount: futureReminders.length,
          reminders: reminders.map((r) => ({
            id: r.id.substring(0, 8),
            title: r.title.substring(0, 30),
            remindAt: r.reminderData?.remindAt
              ? new Date(r.reminderData.remindAt).toISOString()
              : 'unknown',
            isOverdue: r.reminderData?.remindAt ? r.reminderData.remindAt < now : false,
          })),
          willShowNotification: !IS_NATIVE_PLATFORM,
          willShowDialog: !IS_ANDROID_NATIVE || overdueReminders.length > 0,
        });

        if (IS_ELECTRON && this._globalConfigService.cfg()?.reminder?.isFocusWindow) {
          this._uiHelperService.focusApp();
        }

        this._showNotification(reminders);

        // On Android:
        // - Future reminders: Native AlarmManager handles them (skip dialog)
        // - Overdue reminders: No native notification exists (show dialog)
        if (
          IS_ANDROID_NATIVE &&
          futureReminders.length > 0 &&
          overdueReminders.length === 0
        ) {
          Log.log(
            '⏭️  SKIPPING dialog on Android - all reminders are future, native notifications will handle them',
          );
          return;
        }

        if (IS_ANDROID_NATIVE && overdueReminders.length > 0) {
          Log.log(
            '📱 SHOWING dialog on Android for overdue reminders (no native notification exists)',
            {
              overdueCount: overdueReminders.length,
              futureCount: futureReminders.length,
            },
          );
        }

        const oldest = reminders[0];
        const taskId = oldest.id;

        if (this._taskService.currentTaskId() === taskId) {
          this._snackService.open({
            type: 'CUSTOM',
            msg: T.F.REMINDER.S_ACTIVE_TASK_DUE,
            translateParams: {
              title: oldest.title,
            },
            config: {
              // show for longer
              duration: 20000,
            },
            ico: oldest.isDeadlineReminder ? 'flag' : 'alarm',
          });
          // Dismiss the reminder for the current task
          if (oldest.isDeadlineReminder) {
            // Clear deadlineRemindAt but keep the deadline date
            firstValueFrom(this._taskService.getByIdOnce$(taskId)).then((task) => {
              if (task) {
                this._store.dispatch(
                  TaskSharedActions.setDeadline({
                    taskId,
                    ...(task.deadlineDay ? { deadlineDay: task.deadlineDay } : {}),
                    ...(task.deadlineWithTime
                      ? { deadlineWithTime: task.deadlineWithTime }
                      : {}),
                  }),
                );
              }
            });
          } else {
            this._store.dispatch(
              TaskSharedActions.dismissReminderOnly({
                id: taskId,
              }),
            );
          }
        } else {
          this._matDialog
            .open(DialogViewTaskRemindersComponent, {
              autoFocus: false,
              restoreFocus: true,
              data: {
                reminders,
              },
            })
            .afterClosed();
        }
      });
  }

  @throttle(60000)
  private _showNotification(reminders: TaskWithReminderData[]): void {
    // Skip on native platforms (iOS/Android) - native scheduled notifications handle this
    if (IS_NATIVE_PLATFORM) {
      return;
    }

    const isMultiple = reminders.length > 1;
    const title = isMultiple
      ? '"' +
        reminders[0].title +
        '" and ' +
        (reminders.length - 1) +
        ' other tasks are due.'
      : reminders[0].title;
    const tag = reminders.reduce((acc, reminder) => acc + '_' + reminder.id, '');

    this._notifyService
      .notify({
        title,
        // prevents multiple notifications on mobile
        tag,
        requireInteraction: true,
      })
      .then();
  }

  /**
   * Initialize iOS notification action handling.
   * Registers action types and subscribes to action events.
   */
  private _initIOSNotificationActions(): void {
    if (!IS_IOS_NATIVE) {
      return;
    }

    // Initialize the Capacitor reminder service (registers action types)
    this._capacitorReminderService.initialize().then(() => {
      Log.log('ReminderModule: iOS notification actions initialized');
    });

    // Handle notification action events
    this._capacitorReminderService.action$.subscribe((event: NotificationActionEvent) => {
      this._handleIOSNotificationAction(event);
    });
  }

  /**
   * Handle iOS notification action (Done, Snooze 10m, Snooze 1h).
   */
  private async _handleIOSNotificationAction(
    event: NotificationActionEvent,
  ): Promise<void> {
    const taskId = event.extra?.['relatedId'] as string | undefined;
    if (!taskId) {
      Log.warn('ReminderModule: No task ID in notification action', event);
      return;
    }

    Log.log('ReminderModule: Handling iOS notification action', {
      actionId: event.actionId,
      taskId,
    });

    if (
      event.actionId === NOTIFICATION_ACTION.SNOOZE_10M ||
      event.actionId === NOTIFICATION_ACTION.SNOOZE_1H
    ) {
      const task = await firstValueFrom(this._taskService.getByIdOnce$(taskId));
      if (task) {
        const snoozeMs =
          event.actionId === NOTIFICATION_ACTION.SNOOZE_10M
            ? SNOOZE_10M_MS
            : SNOOZE_1H_MS;
        const newRemindAt = Date.now() + snoozeMs;
        this._store.dispatch(
          TaskSharedActions.reScheduleTaskWithTime({
            task,
            remindAt: newRemindAt,
            dueWithTime: task.dueWithTime ?? newRemindAt,
            isMoveToBacklog: false,
          }),
        );
        Log.log('ReminderModule: Task snoozed via iOS notification', {
          taskId,
          snoozeMs,
        });
      }
    } else if (event.actionId === NOTIFICATION_ACTION.DONE) {
      await this._handleDoneAction(taskId);
    } else {
      // Tap on notification body (actionId is 'tap' in Capacitor)
      await this._handleTapAction(taskId);
    }
  }

  /**
   * Initialize Android notification action handling.
   * Subscribes to reminder tap and done events from the native bridge.
   */
  private _initAndroidNotificationActions(): void {
    if (!IS_ANDROID_WEB_VIEW) {
      return;
    }

    androidInterface.onReminderTap$.subscribe((taskId: string) => {
      this._handleTapAction(taskId);
    });

    androidInterface.onReminderDone$.subscribe((taskId: string) => {
      this._handleDoneAction(taskId);
    });

    androidInterface.onReminderSnooze$.subscribe(
      (event: { taskId: string; newRemindAt: number }) => {
        this._handleSnoozeAction(event.taskId, event.newRemindAt);
      },
    );
  }

  /**
   * Handle notification tap: sync, then navigate to task or show "already done".
   */
  private async _handleTapAction(taskId: string): Promise<void> {
    Log.log('ReminderModule: Handling notification tap', { taskId });
    try {
      await this._syncWrapperService.sync();
    } catch {
      // Continue even if sync fails
    }

    const task = await firstValueFrom(this._taskService.getByIdOnce$(taskId));
    if (!task || task.isDone) {
      this._snackService.open({
        type: 'SUCCESS',
        msg: T.NOTIFICATION.TASK_ALREADY_COMPLETED,
      });
      return;
    }

    this._store.dispatch(TaskSharedActions.dismissReminderOnly({ id: taskId }));
    try {
      this._taskService.focusTask(taskId);
    } catch (e) {
      Log.warn('ReminderModule: Could not focus task after notification tap', e);
    }
  }

  /**
   * Handle "Done" action: sync, then mark task done or show "already done".
   */
  private async _handleDoneAction(taskId: string): Promise<void> {
    Log.log('ReminderModule: Handling done action', { taskId });
    try {
      await this._syncWrapperService.sync();
    } catch {
      // Continue even if sync fails
    }

    const task = await firstValueFrom(this._taskService.getByIdOnce$(taskId));
    if (!task || task.isDone) {
      this._snackService.open({
        type: 'SUCCESS',
        msg: T.NOTIFICATION.TASK_ALREADY_COMPLETED,
      });
      return;
    }

    this._taskService.setDone(taskId);
    this._snackService.open({
      type: 'SUCCESS',
      msg: T.NOTIFICATION.TASK_MARKED_DONE,
    });
  }

  /**
   * Handle snooze from Android notification: update NgRx state to match native alarm.
   */
  private async _handleSnoozeAction(taskId: string, newRemindAt: number): Promise<void> {
    Log.log('ReminderModule: Handling snooze action from Android', {
      taskId,
      newRemindAt,
    });
    try {
      await this._syncWrapperService.sync();
    } catch {
      // Continue even if sync fails
    }

    const task = await firstValueFrom(this._taskService.getByIdOnce$(taskId));
    if (!task || task.isDone) {
      return;
    }
    this._store.dispatch(
      TaskSharedActions.reScheduleTaskWithTime({
        task,
        remindAt: newRemindAt,
        dueWithTime: task.dueWithTime ?? newRemindAt,
        isMoveToBacklog: false,
      }),
    );
  }
}
