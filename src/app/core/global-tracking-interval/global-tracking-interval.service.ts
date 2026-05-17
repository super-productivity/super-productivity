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
  tap,
} from 'rxjs/operators';
import { Tick } from './tick.model';
import { DateService } from 'src/app/core/date/date.service';
import { Log } from '../log';

@Injectable({
  providedIn: 'root',
})
export class GlobalTrackingIntervalService {
  private _dateService = inject(DateService);

  globalInterval$: Observable<number> = interval(TRACKING_INTERVAL).pipe(share());
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
    return merge(timerBased$, focusBased$, visibilityBased$, systemResumeBased$).pipe(
      startWith(this._dateService.todayStr()),
      distinctUntilChanged(),
      tap((v) => Log.log('DAY_CHANGE ' + v)),
      // needs to be shareReplay otherwise some instances will never receive an update until a change occurs
      shareReplay(1),
    );
  }
}
