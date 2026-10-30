import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { concatMap, startWith, tap } from 'rxjs/operators';
import { SnackService } from '../../../core/snack/snack.service';
import { IS_ANDROID_WEB_VIEW } from '../../../util/is-android-web-view';
import { DroidLog } from '../../../core/log';
import {
  androidInterface,
  AndroidReminderSnoozeEvent,
  parseReminderTapQueue,
} from '../android-interface';
import { T } from '../../../t.const';
import { AndroidCaptureImportService } from '../android-capture-import.service';
import { getCaptureImportErrorReason } from '../../tasks/native-capture/native-capture-importer.service';

// TODO send message to electron when current task changes here

@Injectable()
export class AndroidEffects {
  private _snackService = inject(SnackService);
  private _captureImport = inject(AndroidCaptureImportService);

  showForegroundServiceFailure$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        androidInterface.onForegroundServiceStartFailed$.pipe(
          tap((failure) => {
            // eslint-disable-next-line local-rules/no-user-content-in-logs -- grandfathered log baseline (2026-09), not yet triaged
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

  // Import the native capture inbox (Android shares and widget quick adds) on
  // cold start
  // and every resume (a retry if the first import failed). concatMap keeps
  // imports serial; startWith covers cold start.
  importNativeCaptures$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        androidInterface.onResume$.pipe(
          startWith(undefined),
          concatMap(async () => {
            try {
              const count = await this._captureImport.importPending();
              if (count > 0) {
                this._snackService.open({
                  type: 'SUCCESS',
                  msg: T.F.ANDROID.CAPTURES_IMPORTED,
                  translateParams: { count },
                });
              }
            } catch (e) {
              DroidLog.err('Native capture import failed; captures retained', {
                reason: getCaptureImportErrorReason(e),
              });
              this._snackService.open({
                type: 'ERROR',
                msg: T.F.ANDROID.CAPTURE_IMPORT_ERROR,
              });
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
                const events: AndroidReminderSnoozeEvent[] = JSON.parse(snoozeQueue);
                // eslint-disable-next-line local-rules/no-user-content-in-logs -- grandfathered log baseline (2026-09), not yet triaged
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
                androidInterface.onReminderTap$.next(parseReminderTapQueue(tapTaskId));
              }
            } catch (e) {
              DroidLog.err('Failed to process reminder tap queue on resume', e);
            }
          }),
        ),
      { dispatch: false },
    );
}
