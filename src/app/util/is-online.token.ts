import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { isOnline$ } from './is-online';

/**
 * Injectable form of {@link isOnline$}, for code that must be testable.
 *
 * The module-level `isOnline$` cannot be substituted in a unit test: it is a
 * `shareReplay(1)` whose `startWith(navigator.onLine)` captures the value when
 * the module is first evaluated, so by the time a spec runs, its initial value
 * is already fixed to whatever the test browser reported at import time — and
 * headless Chrome commonly reports `navigator.onLine === false`. Any consumer
 * that gates on it is then permanently offline under test, with no seam to
 * override.
 *
 * The default factory returns that same observable, so injecting this token
 * changes nothing at runtime; it only gives specs a place to provide a fake.
 */
export const IS_ONLINE$ = new InjectionToken<Observable<boolean>>('IS_ONLINE$', {
  providedIn: 'root',
  factory: () => isOnline$,
});
