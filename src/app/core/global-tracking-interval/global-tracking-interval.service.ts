import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { IS_ELECTRON, TRACKING_INTERVAL } from '../../app.constants';
import { EMPTY, fromEvent, interval, merge, Observable, Subject } from 'rxjs';
import { ipcResume$ } from '../ipc-events';
import {
  debounceTime,
  distinctUntilChanged,
  filter,
  map,
  share,
  shareReplay,
  startWith,
  switchMap,
  tap,
} from 'rxjs/operators';
import { Tick } from './tick.model';
import { DateService } from 'src/app/core/date/date.service';
import { Log } from '../log';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { androidInterface } from '../../features/android/android-interface';

/**
 * Builds the shared 1s tick source. When a background-state stream is given
 * (Android WebView), the interval is unsubscribed while the app is
 * backgrounded: the tracking/focus foreground services keep the process alive
 * there, so a free-running interval would run store dispatches + change
 * detection once per second around the clock — the web-layer half of the
 * #8243 battery drain. Consumers lose no time: ticks are wall-clock deltas,
 * and on resume AndroidForegroundTrackingEffects emits one capped wake-up
 * tick covering the gap (mirroring the iOS resume path), while current-task
 * time is reconciled from the native counter anyway.
 *
 * Desktop/Electron intentionally keeps the free-running interval — tracking
 * while the window is hidden/minimized is a feature there.
 *
 * Exported so unit tests can drive the background gating without the
 * IS_ANDROID_WEB_VIEW const.
 */
export const createGlobalInterval$ = (
  isInBackground$?: Observable<boolean>,
): Observable<number> =>
  isInBackground$
    ? isInBackground$.pipe(
        startWith(false),
        distinctUntilChanged(),
        switchMap((isInBackground) =>
          isInBackground ? EMPTY : interval(TRACKING_INTERVAL),
        ),
      )
    : interval(TRACKING_INTERVAL);

@Injectable({
  providedIn: 'root',
})
export class GlobalTrackingIntervalService {
  private _dateService = inject(DateService);

  globalInterval$: Observable<number> = createGlobalInterval$(
    IS_ANDROID_WEB_VIEW ? androidInterface.isInBackground$ : undefined,
  ).pipe(share());
  private _currentTrackingStart: number;
  private _wakeUpTick$ = new Subject<Tick>();

  tick$: Observable<Tick> = merge(
    this.globalInterval$.pipe(map(() => this.consumeCurrentTick())),
    this._wakeUpTick$,
  ).pipe(share());

  todayDateStr$: Observable<string> = this._createTodayDateStrObservable();

  // Shared signal to avoid creating 200+ subscriptions in task components
  todayDateStr = toSignal(this.todayDateStr$, {
    initialValue: this._dateService.todayStr(),
  });

  constructor() {
    this._currentTrackingStart = Date.now();
  }

  /**
   * Reset the tracking start time to now.
   * This is used after syncing time from external sources (like Android foreground service)
   * to prevent double-counting the time that was already synced.
   */
  resetTrackingStart(): void {
    this._currentTrackingStart = Date.now();
  }

  consumeCurrentTick(): Tick {
    const now = Date.now();
    const delta = now - this._currentTrackingStart;
    this._currentTrackingStart = now;
    return {
      duration: delta,
      date: this._dateService.todayStr(),
      timestamp: now,
    };
  }

  triggerWakeUpTick(maxDurationMs?: number): Tick {
    const now = Date.now();
    const rawDelta = now - this._currentTrackingStart;
    const clampedDelta =
      typeof maxDurationMs === 'number'
        ? Math.max(0, Math.min(rawDelta, maxDurationMs))
        : Math.max(0, rawDelta);
    this._currentTrackingStart = this._currentTrackingStart + clampedDelta;
    const tick: Tick = {
      duration: clampedDelta,
      date: this._dateService.todayStr(),
      timestamp: now,
    };
    this._wakeUpTick$.next(tick);
    return tick;
  }

  private _createTodayDateStrObservable(): Observable<string> {
    const timerBased$ = this.globalInterval$.pipe(
      map(() => this._dateService.todayStr()),
    );

    const focusBased$ =
      typeof window !== 'undefined'
        ? fromEvent(window, 'focus').pipe(
            debounceTime(100),
            map(() => this._dateService.todayStr()),
          )
        : EMPTY;

    const visibilityBased$ =
      typeof document !== 'undefined'
        ? fromEvent(document, 'visibilitychange').pipe(
            filter(() => !document.hidden),
            debounceTime(100),
            map(() => this._dateService.todayStr()),
          )
        : EMPTY;

    const systemResumeBased$ = IS_ELECTRON
      ? ipcResume$.pipe(map(() => this._dateService.todayStr()))
      : EMPTY;

    // NOTE:
    // Chromium/Electron aggressively throttles `setInterval` for hidden tabs and fully pauses it while a
    // laptop sleeps. When that happens around midnight the timerBased$ stream simply stops emitting,
    // so consumers never receive the day change (see #5464). We therefore merge in visibility/focus/resume
    // events – all of which fire as soon as the app becomes interactive again – to force an immediate
    // re-sampling of todayStr() even if the regular 1s interval is still suspended.
    const startOfNextDayDiffChange$ = (
      this._dateService as {
        startOfNextDayDiffChange$?: Observable<unknown>;
      }
    ).startOfNextDayDiffChange$;
    const startOfNextDayChangeBased$ = (startOfNextDayDiffChange$ ?? EMPTY).pipe(
      map(() => this._dateService.todayStr()),
    );

    return merge(
      timerBased$,
      focusBased$,
      visibilityBased$,
      systemResumeBased$,
      startOfNextDayChangeBased$,
    ).pipe(
      startWith(this._dateService.todayStr()),
      distinctUntilChanged(),
      tap((v) => Log.log('DAY_CHANGE ' + v)),
      // needs to be shareReplay otherwise some instances will never receive an update until a change occurs
      shareReplay(1),
    );
  }
}
