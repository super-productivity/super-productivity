import { merge, Observable } from 'rxjs';
import { debounceTime, filter, map, skip, withLatestFrom } from 'rxjs/operators';

/**
 * Merges poll `triggers`, drops ticks that fire while offline, and adds one
 * tick when the connection comes back (after `backOnlineDelayMs`; reconnects
 * within that delay collapse into one tick), so a poll missed while offline is
 * caught up right away instead of on the next interval.
 *
 * Offline requests would only fail and surface an error snack per tick.
 */
export const pollWhileOnline = (
  isOnline$: Observable<boolean>,
  triggers: Observable<unknown>[],
  backOnlineDelayMs = 0,
): Observable<void> => {
  // isOnline$ replays the current state on subscribe; every later emission is a change.
  const backOnline$ = isOnline$.pipe(skip(1), filter(Boolean));
  return merge(
    ...triggers,
    backOnlineDelayMs > 0
      ? backOnline$.pipe(debounceTime(backOnlineDelayMs))
      : backOnline$,
  ).pipe(
    withLatestFrom(isOnline$),
    filter(([, isOnline]) => isOnline),
    map(() => undefined),
  );
};
