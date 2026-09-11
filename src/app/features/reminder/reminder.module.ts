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
import { merge, of, timer, interval, firstValueFrom, Observable } from 'rxjs';
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
            // Drop reminders the user dismissed without acting on (backdrop /
            // Escape / Android back): they are in a short UI cooldown so the
            // worker (~10s tick) cannot immediately re-open the modal and freeze
            // the app. The cooldown is in-memory only — a cold start re-nudges.
            map((reminders) =>
              (reminders || []).filter((r) => {
                const remindAt = r.reminderData?.remindAt;
                return (
                  remindAt == null ||
                  !this._reminderService.isReminderUiSuppressed(r.id, remindAt)
                );
              }),
            ),
            // NOTE: we simply filter for open dialogs, as reminders are re-queried quite often
            filter(
              (reminders) =>
                this._matDialog.openDialogs.length === 0 && reminders.length > 0,
            ),
            // don't show reminders while add task bar is open
            switchMap((reminders: TaskWithReminderData[]) => {
              const isShowAddTaskBar = this._layoutService.isShowAddTaskBar();
              return isShowAddTaskBar
                ? merge(
                    // Wait for add task bar to close
                    interval(100).pipe(
                      map(() => this._layoutService.isShowAddTaskBar()),
                      filter((isShowAddTaskBarLive) => !isShowAddTaskBarLive),
                      take(1),
                    ),
                    // in case someone just forgot to close it
                    timer(10000),
                  ).pipe(first(), mapTo(reminders), delay(1000))
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
            this._store.dispatch(TaskSharedActions.clearDeadlineReminder({ taskId }));
          } else {
            this._store.dispatch(
              TaskSharedActions.dismissReminderOnly({
                id: taskId,
              }),
            );
          }
        } else {
          this._matDialog.open(DialogViewTaskRemindersComponent, {
            restoreFocus: true,
            // Backdrop click / Escape closes the dialog. Deadline reminders are
            // cleared on destroy; scheduled reminders stay active and the worker
            // re-shows them until the user acts on them.
            data: {
              reminders,
            },
          });
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

    // Handle notification action events (gated on the initial data load — see
    // _handleAfterDataLoaded / #8551).
    this._handleAfterDataLoaded(
      this._capacitorReminderService.action$,
      (event: NotificationActionEvent) => this._handleIOSNotificationAction(event),
    );
  }

  /**
   * Subscribe to a notification-action stream, but defer handling of each event
   * until the initial data load (and initial sync, mirroring the reminder dialog
   * gate) has completed.
   *
   * On cold start these events are delivered before the NgRx store is hydrated
   * from persistence. Reading the task that early makes getByIdOnce$() return
   * undefined, which the done/tap handlers treat as "task already done" and
   * silently drop the action — so a task marked done from the notification
   * reappears as not-done on open (#8551).
   *
   * We subscribe immediately (rather than gating the subscription itself) so no
   * event from a non-buffering Subject — e.g. the iOS action$ — is missed while
   * we wait. concatMap preserves event order and, once data is loaded, lets each
   * event through without further delay.
   */
  private _handleAfterDataLoaded<T>(
    stream$: Observable<T>,
    handler: (val: T) => void,
  ): void {
    stream$
      .pipe(
        concatMap((val) =>
          this._syncTriggerService.afterInitialSyncDoneAndDataLoadedInitially$.pipe(
            first(),
            map(() => val),
          ),
        ),
      )
      .subscribe(handler);
  }

  /**
   * Handle iOS notification action (Done, Snooze 10m, Snooze 1h).
   */
  private async _handleIOSNotificationAction(
    event: NotificationActionEvent,
  ): Promise<void> {
    const taskId = event.extra?.['relatedId'] as string | undefined;
    const reminderType = event.extra?.['reminderType'] as string | undefined;
    if (!taskId) {
      Log.warn('ReminderModule: No task ID in notification action', {
        actionId: event.actionId,
        notificationId: event.notificationId,
        extraKeys: Object.keys(event.extra ?? {}),
      });
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
        if (reminderType === 'DEADLINE') {
          // setDeadline enforces mutual exclusivity between deadlineDay and
          // deadlineWithTime — passing both would null the day. Forward only the
          // more specific field (deadlineWithTime) when present.
          this._store.dispatch(
            TaskSharedActions.setDeadline({
              taskId,
              ...(typeof task.deadlineWithTime === 'number'
                ? { deadlineWithTime: task.deadlineWithTime }
                : task.deadlineDay
                  ? { deadlineDay: task.deadlineDay }
                  : {}),
              deadlineRemindAt: newRemindAt,
            }),
          );
        } else {
          this._store.dispatch(
            TaskSharedActions.reScheduleTaskWithTime({
              task,
              remindAt: newRemindAt,
              dueWithTime: task.dueWithTime ?? newRemindAt,
              isMoveToBacklog: false,
            }),
          );
        }
        Log.log('ReminderModule: Task snoozed via iOS notification', {
          taskId,
          snoozeMs,
        });
      }
    } else if (event.actionId === NOTIFICATION_ACTION.DONE) {
      await this._handleDoneAction(taskId);
    } else {
      // Tap on notification body (actionId is 'tap' in Capacitor)
      await this._handleTapAction(taskId, reminderType);
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

    // Defer handling until the store is hydrated — see _handleAfterDataLoaded /
    // #8551. On cold start these queued actions are replayed from ReplaySubjects
    // the moment we subscribe, which is before persistence has loaded.
    this._handleAfterDataLoaded(androidInterface.onReminderTap$, (taskId: string) => {
      this._handleTapAction(taskId);
    });

    this._handleAfterDataLoaded(androidInterface.onReminderDone$, (taskId: string) => {
      this._handleDoneAction(taskId);
    });

    this._handleAfterDataLoaded(
      androidInterface.onReminderSnooze$,
      (event: { taskId: string; newRemindAt: number }) => {
        this._handleSnoozeAction(event.taskId, event.newRemindAt);
      },
    );
  }

  /**
   * Handle notification tap: sync, then navigate to task or show "already done".
   */
  private async _handleTapAction(taskId: string, reminderType?: string): Promise<void> {
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

    if (reminderType === 'DEADLINE') {
      this._store.dispatch(TaskSharedActions.clearDeadlineReminder({ taskId }));
    } else if (reminderType !== 'DUE_DATE') {
      this._store.dispatch(TaskSharedActions.dismissReminderOnly({ id: taskId }));
    }
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
