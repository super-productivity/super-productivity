import { InjectionToken } from '@angular/core';
import { Observable, Subject } from 'rxjs';

/**
 * Bridges a Capacitor `appUrlOpen` URL that is not a task action from the
 * single native listener in `main.ts` to `OAuthCallbackHandlerService`.
 *
 * There can only be one native listener for this event. `@capacitor/app`
 * emits a cold-start URL with `retainUntilConsumed: true`, and Capacitor
 * drains *and clears* the retained arguments when the **first** listener for
 * an event is added (`CAPPlugin.m`, `addEventListener` →
 * `sendRetainedArgumentsForEvent`). Any listener registered after that never
 * sees the cold-start URL, so a second consumer silently lost every URL
 * delivered by a launch. Routing one native listener to both consumers is
 * what keeps the task actions working and gives the OAuth consumer a URL at
 * all on Android, where the redirect arrives as a VIEW intent.
 *
 * Deliberately a plain `Subject`, not a `ReplaySubject`: a cold-start OAuth
 * callback cannot be completed by this app no matter how it is delivered.
 * `PluginOAuthService._pendingRedirect` is in-memory and null after a
 * relaunch, and the only consumer of `authCodeReceived$` (the auth-code
 * dialog) subscribes solely on Electron. Replaying a URL that nothing can act
 * on would only keep an auth code in memory for the rest of the process.
 * The task sink keeps its replay because task actions *do* work cold.
 */
export const pendingCapacitorOAuthUrl$ = new Subject<string>();

/**
 * Injected by OAuthCallbackHandlerService instead of importing the singleton
 * above directly, so tests can provide a fresh stream per test (the real
 * singleton persists for the app's lifetime and would otherwise replay a
 * previous test's URL into every subsequent test).
 */
export const PENDING_CAPACITOR_OAUTH_URL = new InjectionToken<Observable<string>>(
  'PENDING_CAPACITOR_OAUTH_URL',
  {
    providedIn: 'root',
    factory: () => pendingCapacitorOAuthUrl$,
  },
);
