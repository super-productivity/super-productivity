import { InjectionToken } from '@angular/core';
import { Observable, ReplaySubject } from 'rxjs';
import { AppUriQuickAction } from './parse-app-uri-quick-action';

/**
 * Bridges a cold-launch (or already-running) Capacitor `appUrlOpen` quick
 * action from `main.ts` — which runs before Angular's dependency injection
 * exists — to `AppUriQuickActionsService`, which is only created once Angular
 * bootstraps. Same reasoning as `pendingCapacitorAppUriAction$`: a plain
 * `Subject` would drop an event emitted before the service subscribes, which
 * is the common case when a home screen quick action cold-launches the app.
 */
export const pendingCapacitorQuickAction$ = new ReplaySubject<AppUriQuickAction>(1);

/**
 * Injected by AppUriQuickActionsService instead of importing the singleton
 * above directly, so tests can provide a fresh stream per test (the real
 * singleton persists for the app's lifetime and would otherwise replay a
 * previous test's action into every subsequent test).
 */
export const PENDING_CAPACITOR_QUICK_ACTION = new InjectionToken<
  Observable<AppUriQuickAction>
>('PENDING_CAPACITOR_QUICK_ACTION', {
  providedIn: 'root',
  factory: () => pendingCapacitorQuickAction$,
});
