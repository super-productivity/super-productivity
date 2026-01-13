import { inject, Injectable } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { concatMap, filter, tap } from 'rxjs/operators';
import { truncate } from '../../../util/truncate';
import { T } from '../../../t.const';
import { SnackService } from '../../../core/snack/snack.service';
import { TaskService } from '../task.service';
import { Store } from '@ngrx/store';
import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { IS_ANDROID_WEB_VIEW } from '../../../util/is-android-web-view';
import { androidInterface } from '../../android/android-interface';
import { generateNotificationId } from '../../android/android-notification-id.util';

@Injectable()
export class TaskReminderEffects {
  private _localActions$ = inject(LOCAL_ACTIONS);
  private _snackService = inject(SnackService);
  private _taskService = inject(TaskService);
  private _store = inject(Store);
  private _datePipe = inject(LocaleDatePipe);

  snack$ = createEffect(
    () =>
      this._localActions$.pipe(
        ofType(TaskSharedActions.scheduleTaskWithTime),
        tap(({ task, remindAt, dueWithTime }) => {
          const formattedDate = this._datePipe.transform(dueWithTime, 'short');
          this._snackService.open({
            type: 'SUCCESS',
            translateParams: {
              title: truncate(task.title),
              date: formattedDate || '',
            },
            msg: T.F.TASK.S.REMINDER_ADDED,
            ico: remindAt ? 'alarm' : 'schedule',
          });
        }),
      ),
    { dispatch: false },
  );

  // NOTE: autoMoveToBacklog is now handled atomically in the meta-reducer
  // (task-shared-scheduling.reducer.ts) to ensure atomic consistency.
  // The isMoveToBacklog flag in scheduleTaskWithTime action is processed
  // directly in handleScheduleTaskWithTime().

  updateTaskReminderSnack$ = createEffect(
    () =>
      this._localActions$.pipe(
        ofType(TaskSharedActions.reScheduleTaskWithTime),
        filter(({ remindAt }) => typeof remindAt === 'number'),
        tap(({ task }) =>
          this._snackService.open({
            type: 'SUCCESS',
            translateParams: {
              title: truncate(task.title),
            },
            msg: T.F.TASK.S.REMINDER_UPDATED,
            ico: 'schedule',
          }),
        ),
      ),
    { dispatch: false },
  );

  // NOTE: autoMoveToBacklogOnReschedule is now handled atomically in the meta-reducer
  // (task-shared-scheduling.reducer.ts) to ensure atomic consistency.
  // The isMoveToBacklog flag in reScheduleTaskWithTime action is processed
  // directly in handleScheduleTaskWithTime().

  unscheduleDoneTask$ = createEffect(
    () =>
      this._localActions$.pipe(
        ofType(TaskSharedActions.updateTask),
        filter(({ task }) => !!task.changes.isDone),
        concatMap(({ task }) => this._taskService.getByIdOnce$(task.id as string)),
        tap((task) => {
          if (task?.remindAt) {
            // On Android, immediately cancel native reminder to prevent notifications
            // for done tasks. This is necessary because the reactive cancellation
            // via reminders$ observable can have a delay.
            if (IS_ANDROID_WEB_VIEW) {
              try {
                const notificationId = generateNotificationId(task.id);
                androidInterface.cancelNativeReminder?.(notificationId);
              } catch (e) {
                console.error('Failed to cancel native reminder:', e);
              }
            }

            this._store.dispatch(
              TaskSharedActions.unscheduleTask({
                id: task.id,
              }),
            );
          }
        }),
      ),
    { dispatch: false },
  );

  unscheduleSnack$ = createEffect(
    () =>
      this._localActions$.pipe(
        ofType(TaskSharedActions.unscheduleTask),
        filter(({ isSkipToast }) => !isSkipToast),
        tap(() => {
          this._snackService.open({
            type: 'SUCCESS',
            msg: T.F.TASK.S.REMINDER_DELETED,
            ico: 'schedule',
          });
        }),
      ),
    { dispatch: false },
  );

  dismissReminderSnack$ = createEffect(
    () =>
      this._localActions$.pipe(
        ofType(TaskSharedActions.dismissReminderOnly),
        tap(() => {
          this._snackService.open({
            type: 'SUCCESS',
            msg: T.F.TASK.S.REMINDER_DELETED,
            ico: 'schedule',
          });
        }),
      ),
    { dispatch: false },
  );

  // Cancel native Android reminders when tasks are deleted
  cancelNativeRemindersOnDelete$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        this._localActions$.pipe(
          ofType(TaskSharedActions.deleteTask),
          tap(({ task }) => {
            const deletedTaskIds = [task.id, ...task.subTaskIds];
            deletedTaskIds.forEach((id) => {
              try {
                const notificationId = generateNotificationId(id);
                androidInterface.cancelNativeReminder?.(notificationId);
              } catch (e) {
                console.error('Failed to cancel native reminder:', e);
              }
            });
          }),
        ),
      { dispatch: false },
    );

  // Cancel native Android reminders when multiple tasks are deleted
  cancelNativeRemindersOnBulkDelete$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        this._localActions$.pipe(
          ofType(TaskSharedActions.deleteTasks),
          tap(({ taskIds }) => {
            taskIds.forEach((id) => {
              try {
                const notificationId = generateNotificationId(id);
                androidInterface.cancelNativeReminder?.(notificationId);
              } catch (e) {
                console.error('Failed to cancel native reminder:', e);
              }
            });
          }),
        ),
      { dispatch: false },
    );

  // Cancel native Android reminders when tasks are archived
  cancelNativeRemindersOnArchive$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        this._localActions$.pipe(
          ofType(TaskSharedActions.moveToArchive),
          tap(({ tasks }) => {
            tasks.forEach((task) => {
              try {
                const notificationId = generateNotificationId(task.id);
                androidInterface.cancelNativeReminder?.(notificationId);
              } catch (e) {
                console.error('Failed to cancel native reminder:', e);
              }
              // Also cancel for subtasks
              task.subTaskIds?.forEach((subId) => {
                try {
                  const notificationId = generateNotificationId(subId);
                  androidInterface.cancelNativeReminder?.(notificationId);
                } catch (e) {
                  console.error('Failed to cancel native reminder:', e);
                }
              });
            });
          }),
        ),
      { dispatch: false },
    );
}
