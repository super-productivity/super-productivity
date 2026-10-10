import { inject, Injectable, InjectionToken } from '@angular/core';
import { EMPTY, from, merge, Observable, of } from 'rxjs';
import { distinctUntilChanged, map, switchMap } from 'rxjs/operators';
import { CapacitorReminderService } from '../../core/platform/capacitor-reminder.service';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { androidInterface } from '../android/android-interface';

/**
 * Emits when the app returns to the foreground. A token so tests can drive it;
 * only the Android WebView has a resume signal, and only Android has exact
 * alarms to re-check.
 */
export const EXACT_ALARM_RECHECK_ON_RESUME = new InjectionToken<Observable<unknown>>(
  'EXACT_ALARM_RECHECK_ON_RESUME',
  {
    providedIn: 'root',
    factory: () => (IS_ANDROID_WEB_VIEW ? androidInterface.onResume$ : EMPTY),
  },
);

/**
 * Tracks whether Android denies exact alarms ("Alarms & reminders"), in which
 * case reminders are scheduled inexact and may fire late (issue #10684).
 *
 * Checked when a subscriber attaches and again on every app resume, so a grant
 * made in system settings is picked up when the user comes back — not
 * immediately after the settings page was opened. Re-registering the pending
 * alarms as exact is done natively by ExactAlarmPermissionReceiver.
 */
@Injectable({ providedIn: 'root' })
export class ExactAlarmStatusService {
  private _reminderService = inject(CapacitorReminderService);
  private _resume$ = inject(EXACT_ALARM_RECHECK_ON_RESUME);

  readonly isDenied$: Observable<boolean> = merge(of(undefined), this._resume$).pipe(
    switchMap(() => from(this._reminderService.isExactAlarmGranted())),
    map((isGranted) => !isGranted),
    distinctUntilChanged(),
  );

  // Returning from the settings page resumes the activity, so the resume
  // re-check above picks up the new state; no extra check needed here.
  async openSettings(): Promise<void> {
    await this._reminderService.openExactAlarmSettings();
  }
}
