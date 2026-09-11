import { InjectionToken } from '@angular/core';
import { Observable, ReplaySubject } from 'rxjs';
import { AppUriTaskAction } from '../util/parse-app-uri-task-action';

/**
 * Bridges a cold-launch (or already-running) Capacitor `appUrlOpen` action
 * from `main.ts` — which runs before Angular's dependency injection exists —
 * to `AppUriTaskActionsService`, which is only created once Angular
 * bootstraps. A plain `Subject` would drop an event emitted before the
 * service subscribes (the common case for a cold launch); `ReplaySubject(1)`
 * keeps the most recent action around for that first, possibly-late,
 * subscriber.
 */
export const pendingCapacitorAppUriAction$ = new ReplaySubject<AppUriTaskAction>(1);

/**
 * Injected by AppUriTaskActionsService instead of importing the singleton
 * above directly, so tests can provide a fresh stream per test (the real
 * singleton persists for the app's lifetime and would otherwise replay a
 * previous test's action into every subsequent test).
 */
export const PENDING_CAPACITOR_APP_URI_ACTION = new InjectionToken<
  Observable<AppUriTaskAction>
>('PENDING_CAPACITOR_APP_URI_ACTION', {
  providedIn: 'root',
  factory: () => pendingCapacitorAppUriAction$,
});
