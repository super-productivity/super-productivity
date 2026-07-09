import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { tap } from 'rxjs/operators';
import { SnackService } from '../../../core/snack/snack.service';
import { IS_ANDROID_WEB_VIEW } from '../../../util/is-android-web-view';
import { DroidLog } from '../../../core/log';
import { androidInterface, AndroidShareData } from '../android-interface';
import { TaskService } from '../../tasks/task.service';
import { TaskAttachmentService } from '../../tasks/task-attachment/task-attachment.service';
import { T } from '../../../t.const';
import { readableUrl } from '../../../util/readable-url';

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
            // Guard against empty payloads (e.g. stale share data persisted by an
            // older app version) so we never create a blank, attachment-less task.
            if (!shareData?.path?.trim()) {
              DroidLog.warn('Ignoring share intent with empty content');
              return;
            }
            const taskTitle = buildTaskTitle(shareData);
            const taskId = this._taskService.add(taskTitle);
            const icon = shareData.type === 'LINK' ? 'link' : 'file_present';
            this._taskAttachmentService.addAttachment(taskId, {
              title:
                shareData.subject?.trim() || shareData.title?.trim() || shareData.path,
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

  showForegroundServiceFailure$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        androidInterface.onForegroundServiceStartFailed$.pipe(
          tap((failure) => {
            DroidLog.warn('Foreground service notification failed', failure);
            this._snackService.open({
              type: 'WARNING',
              msg:
                failure.service === 'focusMode'
                  ? T.F.ANDROID.FOREGROUND_SERVICE_START_FAILED_FOCUS
                  : T.F.ANDROID.FOREGROUND_SERVICE_START_FAILED_TRACKING,
              actionStr: T.F.ANDROID.OPEN_NOTIFICATION_SETTINGS,
              actionFn: () => androidInterface.openAppNotificationSettings?.(),
              config: { duration: 10000 },
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

/**
 * Build a meaningful task title from Android share intent data.
 * Prefers the page subject (EXTRA_SUBJECT, sent by browsers), then an explicit
 * title (EXTRA_TITLE), then a type-specific fallback derived from the shared
 * content itself. Never returns the unhelpful literal "Shared Content".
 */
export const buildTaskTitle = (shareData: Partial<AndroidShareData>): string => {
  const subject = shareData.subject?.trim() || '';
  const title = shareData.title?.trim() || '';
  const path = shareData.path?.trim() || '';

  let taskTitle: string;

  if (subject) {
    taskTitle = subject;
  } else if (title) {
    taskTitle = title;
  } else if (shareData.type === 'LINK') {
    taskTitle = readableUrl(path);
  } else {
    const firstLine = path.split('\n')[0].trim();
    taskTitle = firstLine || 'Shared note';
  }

  return taskTitle.length > 150 ? taskTitle.substring(0, 147) + '...' : taskTitle;
};
