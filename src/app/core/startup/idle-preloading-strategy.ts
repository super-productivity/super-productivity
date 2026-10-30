import { Injectable } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { Observable, of } from 'rxjs';
import { catchError, shareReplay, switchMap } from 'rxjs/operators';

/** Lets the first route render and settle before preloading starts. */
export const PRELOAD_DELAY_MS = 2000;
/** Upper bound for waiting on an idle period after the delay. */
export const PRELOAD_IDLE_TIMEOUT_MS = 5000;

/**
 * Preloads all lazy routes like `PreloadAllModules`, but only once the app is
 * idle after startup.
 *
 * The router starts preloading at the first NavigationEnd, which waits for the
 * initial data load (app.guard.ts) — so `PreloadAllModules` fetches and parses
 * every lazy chunk right when the task list appears and the user first
 * interacts. On slow phones that competes with the first taps. Lazy routes
 * still load on demand if the user navigates before the preload ran.
 */
@Injectable({ providedIn: 'root' })
export class IdlePreloadingStrategy implements PreloadingStrategy {
  private readonly _whenIdle$ = new Observable<void>((subscriber) => {
    let idleHandle: number | undefined;
    const done = (): void => {
      subscriber.next();
      subscriber.complete();
    };
    const timeoutHandle = setTimeout(() => {
      if (typeof requestIdleCallback === 'function') {
        idleHandle = requestIdleCallback(done, { timeout: PRELOAD_IDLE_TIMEOUT_MS });
      } else {
        done();
      }
    }, PRELOAD_DELAY_MS);
    return () => {
      clearTimeout(timeoutHandle);
      if (idleHandle !== undefined && typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(idleHandle);
      }
    };
  }).pipe(
    // One shared wait: once the app has been idle, later preload passes
    // (the router re-runs them on every NavigationEnd) start right away.
    shareReplay(1),
  );

  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    // Like PreloadAllModules, swallow load failures (offline, stale chunk after
    // a deploy): an error here would end the router's preload subscription and
    // surface as an unhandled error. The route still loads on demand.
    return this._whenIdle$.pipe(switchMap(() => load().pipe(catchError(() => of(null)))));
  }
}
