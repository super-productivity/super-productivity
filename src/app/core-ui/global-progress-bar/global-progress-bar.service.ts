import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { EMPTY, Observable, of, timer } from 'rxjs';
import {
  delay,
  distinctUntilChanged,
  map,
  startWith,
  switchMap,
  tap,
} from 'rxjs/operators';
import { PROGRESS_BAR_LABEL_MAP } from './global-progress-bar.const';
import { T } from '../../t.const';
import { Log } from '../../core/log';

const DELAY = 100;

export interface GlobalProgressBarLabel {
  key: string;
  params?: Record<string, unknown>;
}

interface CountUpOptions {
  labelParams?: Record<string, unknown>;
}

@Injectable({ providedIn: 'root' })
export class GlobalProgressBarService {
  private _destroyRef = inject(DestroyRef);

  // Use signals internally
  private _nrOfRequests = signal(0);
  private _label = signal<GlobalProgressBarLabel | null>(null);

  // Expose as observables for backward compatibility
  nrOfRequests$ = toObservable(this._nrOfRequests);
  isShowGlobalProgressBar$: Observable<boolean> = this.nrOfRequests$.pipe(
    map((nr) => nr > 0),
    distinctUntilChanged(),
    switchMap((isShow) => (isShow ? of(true) : of(false).pipe(delay(DELAY)))),
    startWith(false),
    // @see https://blog.angular-university.io/angular-debugging/
    delay(0),
  );

  // We don't want the spinner to appear forever, after 60 seconds we just assume something
  // was not counted down correctly
  private _dirtyCountdown$ = this.isShowGlobalProgressBar$.pipe(
    switchMap((isShow) => {
      return isShow
        ? timer(60 * 1000).pipe(
            tap(() => {
              Log.err('Global spinner was shown forever (60s). Forcing countDown!');
              this.countDown();
            }),
          )
        : EMPTY;
    }),
  );

  label$: Observable<GlobalProgressBarLabel | null> = toObservable(this._label).pipe(
    distinctUntilChanged((prev, curr) => this._areLabelsEqual(prev, curr)),
    switchMap((label: GlobalProgressBarLabel | null) =>
      label ? of(label) : of(null).pipe(delay(DELAY)),
    ),
    // @see https://blog.angular-university.io/angular-debugging/
    delay(0),
  );

  constructor() {
    this._dirtyCountdown$.pipe(takeUntilDestroyed(this._destroyRef)).subscribe();
  }

  countUp(url: string, options?: CountUpOptions): void {
    this._nrOfRequests.update((nr) => nr + 1);
    this._label.set(this._urlToLabel(url, options?.labelParams));
  }

  countDown(): void {
    this._nrOfRequests.update((nr) => Math.max(nr - 1, 0));
    if (this._nrOfRequests() <= 0) {
      this._label.set(null);
    }
  }

  private _urlToLabel(
    url: string,
    labelParams?: Record<string, unknown>,
  ): GlobalProgressBarLabel {
    const [urlWithoutParams]: string[] = url.split('?');

    if (PROGRESS_BAR_LABEL_MAP[url]) {
      return {
        key: PROGRESS_BAR_LABEL_MAP[url],
        params: labelParams,
      };
    } else {
      const key = Object.keys(PROGRESS_BAR_LABEL_MAP).find((keyIn) =>
        urlWithoutParams.includes(keyIn),
      );
      return {
        key: key ? PROGRESS_BAR_LABEL_MAP[key] : T.GPB.UNKNOWN,
        params: labelParams,
      };
    }
  }

  private _areLabelsEqual(
    prev: GlobalProgressBarLabel | null,
    curr: GlobalProgressBarLabel | null,
  ): boolean {
    if (prev === curr) {
      return true;
    }
    if (!prev || !curr) {
      return !prev && !curr;
    }
    return prev.key === curr.key && this._areParamsEqual(prev.params, curr.params);
  }

  private _areParamsEqual(
    prev?: Record<string, unknown>,
    curr?: Record<string, unknown>,
  ): boolean {
    if (prev === curr) {
      return true;
    }
    if (!prev || !curr) {
      return !prev && !curr;
    }
    const prevKeys = Object.keys(prev);
    const currKeys = Object.keys(curr);
    if (prevKeys.length !== currKeys.length) {
      return false;
    }
    return prevKeys.every((key) => prev[key] === curr[key]);
  }
}
