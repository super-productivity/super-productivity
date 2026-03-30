import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { tap } from 'rxjs/operators';
import { SnackService } from '../../../core/snack/snack.service';
import { IS_ANDROID_WEB_VIEW } from '../../../util/is-android-web-view';
import { DroidLog } from '../../../core/log';
import { androidInterface } from '../android-interface';
import { TaskService } from '../../tasks/task.service';
import { TaskAttachmentService } from '../../tasks/task-attachment/task-attachment.service';

// TODO send message to electron when current task changes here

@Injectable()
export class AndroidEffects {
  private _snackService = inject(SnackService);
  private _taskService = inject(TaskService);
  private _taskAttachmentService = inject(TaskAttachmentService);

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

  // Drain reminder done/snooze/tap queues on resume (warm start)
  checkReminderQueuesOnResume$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        androidInterface.onResume$.pipe(
          tap(() => {
            try {
              const doneQueue = androidInterface.getReminderDoneQueue?.();
              if (doneQueue) {
                const taskIds: string[] = JSON.parse(doneQueue);
                DroidLog.log('Resume: found reminder done queue', taskIds);
                for (const id of taskIds) {
                  androidInterface.onReminderDone$.next(id);
                }
              }
            } catch (e) {
              DroidLog.err('Failed to process reminder done queue on resume', e);
            }

            try {
              const snoozeQueue = androidInterface.getReminderSnoozeQueue?.();
              if (snoozeQueue) {
                const events: { taskId: string; newRemindAt: number }[] =
                  JSON.parse(snoozeQueue);
                DroidLog.log('Resume: found reminder snooze queue', events);
                for (const event of events) {
                  androidInterface.onReminderSnooze$.next(event);
                }
              }
            } catch (e) {
              DroidLog.err('Failed to process reminder snooze queue on resume', e);
            }

            try {
              const tapTaskId = androidInterface.getReminderTapQueue?.();
              if (tapTaskId) {
                DroidLog.log('Resume: found reminder tap queue', tapTaskId);
                androidInterface.onReminderTap$.next(tapTaskId);
              }
            } catch (e) {
              DroidLog.err('Failed to process reminder tap queue on resume', e);
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
                DroidLog.log('Resume: found pending share data');
                androidInterface.onShareWithAttachment$.next(parsed);
              }
            } catch (e) {
              DroidLog.err('Failed to process pending share on resume', e);
            }
          }),
        ),
      { dispatch: false },
    );
}
