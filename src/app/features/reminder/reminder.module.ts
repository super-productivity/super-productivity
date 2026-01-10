import { inject, NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReminderService } from './reminder.service';
import { MatDialog } from '@angular/material/dialog';
import { IS_ELECTRON } from '../../app.constants';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
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
import { Reminder } from './reminder.model';
import { UiHelperService } from '../ui-helper/ui-helper.service';
import { NotifyService } from '../../core/notify/notify.service';
import { DialogViewTaskRemindersComponent } from '../tasks/dialog-view-task-reminders/dialog-view-task-reminders.component';
import { throttle } from '../../util/decorators';
import { SyncTriggerService } from '../../imex/sync/sync-trigger.service';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { from, merge, of, timer, interval } from 'rxjs';
import { TaskService } from '../tasks/task.service';
import { SnackService } from '../../core/snack/snack.service';
import { T } from 'src/app/t.const';
import { GlobalConfigService } from '../config/global-config.service';

@NgModule({
  declarations: [],
  imports: [CommonModule],
})
// TODO move to effect
export class ReminderModule {
  private readonly _reminderService = inject(ReminderService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _snackService = inject(SnackService);
  private readonly _uiHelperService = inject(UiHelperService);
  private readonly _notifyService = inject(NotifyService);
  private readonly _layoutService = inject(LayoutService);
  private readonly _taskService = inject(TaskService);
  private readonly _syncTriggerService = inject(SyncTriggerService);
  private readonly _globalConfigService = inject(GlobalConfigService);

  constructor() {
    from(this._reminderService.init())
      .pipe(
        // we do this to wait for syncing and the like
        concatMap(
          () => this._syncTriggerService.afterInitialSyncDoneAndDataLoadedInitially$,
        ),
        first(),
        delay(1000),
        concatMap(() =>
          this._reminderService.onRemindersActive$.pipe(
            // NOTE: we simply filter for open dialogs, as reminders are re-queried quite often
            filter(
              (reminder) =>
                this._matDialog.openDialogs.length === 0 &&
                !!reminder &&
                reminder.length > 0,
            ),
            // don't show reminders while add task bar is open
            switchMap((reminders: Reminder[]) => {
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
      .subscribe((reminders: Reminder[]) => {
        if (IS_ELECTRON && this._globalConfigService.cfg()?.reminder?.isFocusWindow) {
          this._uiHelperService.focusApp();
        }

        this._showNotification(reminders);

        // Skip dialog on Android - native notifications handle reminders
        if (IS_ANDROID_WEB_VIEW) {
          return;
        }

        const oldest = reminders[0];
        if (oldest.type === 'TASK') {
          if (this._taskService.currentTaskId() === oldest.relatedId) {
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
            this._reminderService.removeReminder(oldest.id);
            this._taskService.update(oldest.relatedId, {
              reminderId: undefined,
              dueWithTime: undefined,
            });
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
        }
      });
  }

  @throttle(60000)
  private _showNotification(reminders: Reminder[]): void {
    // Skip on Android - we use native notifications with snooze button instead
    if (IS_ANDROID_WEB_VIEW) {
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
}
