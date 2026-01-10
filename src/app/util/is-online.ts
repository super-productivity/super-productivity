import { fromEvent, merge } from 'rxjs';
import {
  debounceTime,
  distinctUntilChanged,
  mapTo,
  shareReplay,
  startWith,
} from 'rxjs/operators';

export const isOnline = (): boolean => navigator.onLine !== false;

export const isOnline$ = merge(
  fromEvent(window, 'offline').pipe(mapTo(false)),
  fromEvent(window, 'online').pipe(mapTo(true)),
).pipe(
  // Debounce to prevent rapid oscillations from triggering repeated banner changes
  // This is especially important on Linux/Electron where navigator.onLine can be unreliable
  debounceTime(1000),
  // startWith provides an immediate initial value, ensuring withLatestFrom(isOnline$)
  // in sync.effects.ts doesn't hang waiting for the debounce to complete (fixes #5868, #5877)
  startWith(navigator.onLine),
  distinctUntilChanged(),
  shareReplay(1),
);
