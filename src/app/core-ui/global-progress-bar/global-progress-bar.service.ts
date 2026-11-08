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
import { Log } from '../../core/log';

const DELAY = 100;
const MAX_SHOW_DURATION = 60 * 1000;

@Injectable({ providedIn: 'root' })
export class GlobalProgressBarService {
  private _destroyRef = inject(DestroyRef);

  private _nrOfRequests = signal(0);

  isShowGlobalProgressBar$: Observable<boolean> = toObservable(this._nrOfRequests).pipe(
    map((nr) => nr > 0),
    distinctUntilChanged(),
    switchMap((isShow) => (isShow ? of(true) : of(false).pipe(delay(DELAY)))),
    startWith(false),
    // @see https://blog.angular-university.io/angular-debugging/
    delay(0),
  );

  // We don't want the bar to show forever; after 60 seconds we assume something
  // was not counted down correctly
  private _dirtyCountdown$ = this.isShowGlobalProgressBar$.pipe(
    switchMap((isShow) => {
      return isShow
        ? timer(MAX_SHOW_DURATION).pipe(
            tap(() => {
              Log.err('Global progress bar was shown forever (60s). Forcing countDown!');
              this.countDown();
            }),
          )
        : EMPTY;
    }),
  );

  constructor() {
    this._dirtyCountdown$.pipe(takeUntilDestroyed(this._destroyRef)).subscribe();
  }

  countUp(): void {
    this._nrOfRequests.update((nr) => nr + 1);
  }

  countDown(): void {
    this._nrOfRequests.update((nr) => Math.max(nr - 1, 0));
  }
}
