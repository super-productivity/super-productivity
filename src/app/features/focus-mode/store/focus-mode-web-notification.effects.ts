import { DOCUMENT, inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { distinctUntilChanged, filter, map, tap, withLatestFrom } from 'rxjs/operators';
import * as selectors from './focus-mode.selectors';
import { FocusModeMode, TimerState } from '../focus-mode.model';
import { FocusModeLocalSettingsService } from '../../config/focus-mode-local-settings.service';
import { NotifyService } from '../../../core/notify/notify.service';
import { isBrowserNotificationGranted } from '../../../core/notify/browser-notification-permission';
import { CapacitorPlatformService } from '../../../core/platform/capacitor-platform.service';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { waitForSyncWindow } from '../../../util/wait-for-sync-window.operator';
import { T } from '../../../t.const';

type TimeUpPurpose = 'work' | 'break';

// Null until the running timer reaches its duration. Keyed by purpose only, so
// pausing/resuming in overtime (which rewrites startedAt) does not re-notify;
// every new timer starts at elapsed 0 and resets the key to null first.
const getTimeUpPurpose = (timer: TimerState): TimeUpPurpose | null =>
  timer.purpose !== null &&
  timer.startedAt !== null &&
  timer.duration > 0 &&
  timer.elapsed >= timer.duration
    ? timer.purpose
    : null;

/**
 * Opt-in browser notifications when a Pomodoro focus session or a break ends
 * (#7550). Web only: desktop flashes the window frame, and Android's foreground
 * service posts its own completion notification. Countdown sessions are left
 * out because FocusModeEffects.surfaceSessionDoneOnCompletion$ already notifies.
 */
@Injectable()
export class FocusModeWebNotificationEffects {
  private _store = inject(Store);
  private _document = inject(DOCUMENT);
  private _notifyService = inject(NotifyService);
  private _platformService = inject(CapacitorPlatformService);
  private _localSettingsService = inject(FocusModeLocalSettingsService);
  private _hydrationState = inject(HydrationStateService);

  notifyOnTimeUp$ = createEffect(
    () =>
      this._store.select(selectors.selectTimer).pipe(
        map(getTimeUpPurpose),
        distinctUntilChanged(),
        filter((purpose): purpose is TimeUpPurpose => purpose !== null),
        // The time-up edge fires once and the timer then stops ticking, so a
        // dropped emission would never come back — defer instead (#9348)
        waitForSyncWindow(this._hydrationState, 'FocusModeWebNotificationEffects'),
        withLatestFrom(this._store.select(selectors.selectMode)),
        filter(
          ([purpose, mode]) => purpose === 'break' || mode === FocusModeMode.Pomodoro,
        ),
        filter(() => this._isNotificationWanted()),
        tap(([purpose]) => {
          void this._notifyService.notify({
            title:
              purpose === 'work'
                ? T.F.FOCUS_MODE.POMODORO_SESSION_COMPLETED
                : T.F.POMODORO.BREAK_IS_DONE,
          });
        }),
      ),
    { dispatch: false },
  );

  private _isNotificationWanted(): boolean {
    return (
      this._platformService.isWeb() &&
      this._localSettingsService.settings().isNotifyOnSessionEnd &&
      // The open app already shows the session/break screen and plays the sound
      !this._document.hasFocus() &&
      // Never prompt here: no user gesture, so browsers would ignore or block it
      isBrowserNotificationGranted()
    );
  }
}
