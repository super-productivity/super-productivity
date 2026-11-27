import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { combineLatest, firstValueFrom } from 'rxjs';
import {
  concatMap,
  distinctUntilChanged,
  map,
  pairwise,
  startWith,
} from 'rxjs/operators';
import * as selectors from './focus-mode.selectors';
import { FocusModeMode, TimerState } from '../focus-mode.model';
import { selectSoundConfig } from '../../config/store/global-config.reducer';
import { CapacitorNotificationService } from '../../../core/platform/capacitor-notification.service';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { waitForSyncWindow } from '../../../util/wait-for-sync-window.operator';
import { msToString } from '../../../ui/duration/ms-to-string.pipe';
import { T } from '../../../t.const';

// One above the largest id generateNotificationId() can return, so it can never
// collide with a reminder. A single fixed id takes one of iOS's 64 pending
// slots and makes every re-schedule replace the previous request.
export const FOCUS_SESSION_END_NOTIFICATION_ID = 2147483647;

interface SessionEndAlert {
  endAt: number;
  title: string;
  /** Set for Countdown only, whose notification reports the session length. */
  durationMs: number | null;
  isSoundOn: boolean;
}

const getTitle = (purpose: 'work' | 'break', mode: FocusModeMode): string =>
  purpose === 'break'
    ? T.F.POMODORO.BREAK_IS_DONE
    : mode === FocusModeMode.Pomodoro
      ? T.F.FOCUS_MODE.POMODORO_SESSION_COMPLETED
      : T.F.FOCUS_MODE.SESSION_COMPLETED;

// Null whenever no end is ahead: idle, paused, time already up (overtime), or
// a Flowtime work session, which has no duration and never ends on its own.
const getSessionEndAlert = (
  timer: TimerState,
  mode: FocusModeMode,
  isSoundOn: boolean,
): SessionEndAlert | null => {
  const { purpose, startedAt, duration } = timer;
  if (
    !timer.isRunning ||
    purpose === null ||
    startedAt === null ||
    duration <= 0 ||
    timer.elapsed >= duration ||
    (purpose === 'work' && mode === FocusModeMode.Flowtime)
  ) {
    return null;
  }
  return {
    endAt: startedAt + duration,
    title: getTitle(purpose, mode),
    durationMs: purpose === 'work' && mode === FocusModeMode.Countdown ? duration : null,
    isSoundOn,
  };
};

const isSameAlert = (a: SessionEndAlert | null, b: SessionEndAlert | null): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    a.endAt === b.endAt &&
    a.title === b.title &&
    a.durationMs === b.durationMs &&
    a.isSoundOn === b.isSoundOn);

/**
 * iOS suspends the WebView in the background, so nothing in JS can announce
 * that a Countdown, Pomodoro session or break ended (#8398). Hand the alert to
 * the OS up front instead: one local notification, scheduled for the expected
 * end and re-synced whenever that end moves (start, pause, resume, skip, stop,
 * completion, duration change, restore after a WebView kill).
 *
 * Registered on iOS only (main.ts): Android's foreground service posts its own
 * completion notification, desktop flashes the window and web has
 * FocusModeWebNotificationEffects. Timer state is local-only, so nothing here
 * touches synced state.
 *
 * shortcut: one alert per background stretch — a Pomodoro break only starts
 * once JS runs again, so its end is not announced while the app stays in the
 * background. Chaining would need the whole cycle scheduled up front.
 */
@Injectable()
export class FocusModeIosNotificationEffects {
  private _store = inject(Store);
  private _translateService = inject(TranslateService);
  private _notificationService = inject(CapacitorNotificationService);
  private _hydrationState = inject(HydrationStateService);

  syncSessionEndNotification$ = createEffect(
    () =>
      combineLatest([
        this._store.select(selectors.selectTimer),
        this._store.select(selectors.selectMode),
        this._store.select(selectSoundConfig),
      ]).pipe(
        map(([timer, mode, sound]): SessionEndAlert | null =>
          getSessionEndAlert(timer, mode, (sound?.volume || 0) > 0),
        ),
        // `elapsed` changes every tick while the end time stays put
        distinctUntilChanged(isSameAlert),
        // Start/pause are one-off edges, so a dropped emission would leave a
        // stale or missing notification — defer instead of skipping
        waitForSyncWindow(this._hydrationState, 'FocusModeIosNotificationEffects'),
        startWith(null),
        pairwise(),
        // Serialized so a slow schedule can't land after a later cancel
        concatMap(([prev, alert]) => this._sync(prev, alert)),
      ),
    { dispatch: false },
  );

  private _sync(
    prev: SessionEndAlert | null,
    alert: SessionEndAlert | null,
  ): Promise<boolean> {
    const now = Date.now();
    // iOS delivers a notification scheduled in the past right away, e.g. for a
    // restored session that ended while the app was gone
    if (!alert || alert.endAt <= now) {
      // Cancel only what this run scheduled and is still ahead. At the timer's
      // own end the request is due: the last tick before iOS suspends JS must
      // not remove it. And on startup a request left by a killed WebView stays
      // until the session restore re-adopts (and re-schedules) its session.
      // shortcut: a leftover whose session is not restored (away longer than
      // MOBILE_BACKGROUND_IDLE_CAP_MS with more than that left) still fires,
      // in the foreground too (the plugin keeps that flag in memory only).
      return prev && prev.endAt > now
        ? this._notificationService.cancel(FOCUS_SESSION_END_NOTIFICATION_ID)
        : Promise.resolve(false);
    }
    return this._schedule(alert);
  }

  private async _schedule(alert: SessionEndAlert): Promise<boolean> {
    // get() rather than instant(): a session restored on a cold start can be
    // scheduled while the language file is still loading
    const [title, body] = await Promise.all([
      firstValueFrom(this._translateService.get(alert.title)),
      alert.durationMs === null
        ? ''
        : firstValueFrom(
            this._translateService.get(
              T.F.FOCUS_MODE.SESSION_COMPLETED_NOTIFICATION_BODY,
              { duration: msToString(alert.durationMs, true) },
            ),
          ),
    ]);
    return this._notificationService.schedule({
      id: FOCUS_SESSION_END_NOTIFICATION_ID,
      title,
      body,
      scheduleAt: new Date(alert.endAt),
      // Mirrors the in-app session-done sound, which is silent at volume 0
      sound: alert.isSoundOn ? 'default' : null,
      // The open app already shows the session/break screen and plays the sound
      isShownInForeground: false,
    });
  }
}
