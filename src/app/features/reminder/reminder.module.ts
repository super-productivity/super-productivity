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
import { LayoutService } from '../../core-ui/layout/layout.service';
import { merge, of, timer, interval } from 'rxjs';
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

const IOS_SNOOZE_MINUTES = 10;
const MINUTES_TO_MILLISECONDS = 60 * 1000;

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

  constructor() {
    // Initialize reminder service (runs migration in background)
    this._reminderService.init();

    // Initialize iOS notification actions
    this._initIOSNotificationActions();

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
        // This is because android.effects.ts only schedules future reminders.
        // TODO: Native Android reminder notification actions (snooze/done buttons) currently
        // work entirely in the background without notifying TypeScript. This means:
        // 1. Snooze: Works correctly (native code reschedules the alarm)
        // 2. Done: Works for dismissing the notification, but the reminder isn't removed from
        //    app state. The reminder will be cancelled when the task is marked done in the app.
        // To fully fix: Add onReminderDone$ subject to android-interface.ts and wire it up
        // in the Kotlin ReminderBroadcastReceiver to call dismissReminderOnly action.
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
            ico: 'alarm',
          });
          // Dismiss the reminder for the current task
          this._store.dispatch(
            TaskSharedActions.dismissReminderOnly({
              id: taskId,
            }),
          );
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
   * Handle iOS notification action (Snooze or Done).
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

    if (event.actionId === NOTIFICATION_ACTION.SNOOZE) {
      // Snooze: Reschedule the reminder for 10 minutes later
      const task = await this._taskService.getByIdOnce$(taskId).toPromise();
      if (task) {
        const snoozeMs = IOS_SNOOZE_MINUTES * MINUTES_TO_MILLISECONDS;
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
          newRemindAt: new Date(newRemindAt).toISOString(),
        });
      }
    } else if (event.actionId === NOTIFICATION_ACTION.DONE) {
      // Done: Dismiss the reminder only (don't mark task as done)
      this._store.dispatch(
        TaskSharedActions.dismissReminderOnly({
          id: taskId,
        }),
      );
      Log.log('ReminderModule: Reminder dismissed via iOS notification', { taskId });
    }
  }
}
