import { Subject } from 'rxjs';
import { pendingCapacitorAppUriAction$ } from '../features/tasks/app-uri-actions/pending-capacitor-app-uri-action';
import { pendingCapacitorQuickAction$ } from './app-uri-actions/pending-capacitor-quick-action';
import { pendingCapacitorOAuthUrl$ } from '../imex/sync/pending-capacitor-oauth-url';
import {
  AppUriTaskAction,
  parseAppUriTaskAction,
} from '../features/tasks/util/parse-app-uri-task-action';
import {
  AppUriQuickAction,
  parseAppUriQuickAction,
} from './app-uri-actions/parse-app-uri-quick-action';

/**
 * Which route family consumed a URL. Returned instead of the raw URL so
 * callers can log *how* a launch was handled without ever logging the URL
 * itself — it carries the task title/notes for task actions and an auth code
 * for OAuth callbacks, and log history is exportable (rule #9).
 */
export type AppUrlRoute = 'task' | 'quick-action' | 'other';

/**
 * Routes a single Capacitor `appUrlOpen` URL to whichever consumer owns it.
 *
 * There must be exactly one native `appUrlOpen` listener in the app.
 * `@capacitor/app` emits a cold-start URL with `retainUntilConsumed: true`,
 * and Capacitor drains *and clears* the retained arguments when the **first**
 * listener for an event is added (`CAPPlugin.m`, `addEventListener` →
 * `sendRetainedArgumentsForEvent`). A listener registered after that never
 * receives the launch URL. With one listener per consumer, whichever
 * registered second silently lost every cold-start URL in its own route
 * family, so a launch either delivered a task action or an OAuth callback but
 * never could have delivered both.
 *
 * The sinks are parameters (defaulting to the app-wide singletons) purely so
 * tests can supply fresh streams; the singletons live for the app's lifetime
 * and would replay one test's URL into the next.
 */
export const routeCapacitorAppUrl = (
  url: string,
  taskSink: Subject<AppUriTaskAction> = pendingCapacitorAppUriAction$,
  oAuthSink: Subject<string> = pendingCapacitorOAuthUrl$,
  quickActionSink: Subject<AppUriQuickAction> = pendingCapacitorQuickAction$,
): AppUrlRoute => {
  const action = parseAppUriTaskAction(url);
  if (action) {
    taskSink.next(action);
    return 'task';
  }

  // Checked before the OAuth fallthrough for the same reason task actions are:
  // the OAuth consumer takes whatever is left over, so every family that owns
  // specific hosts has to claim them first.
  const quickAction = parseAppUriQuickAction(url);
  if (quickAction) {
    quickActionSink.next(quickAction);
    return 'quick-action';
  }

  // Anything else goes to the OAuth consumer, which owns its own route
  // matching (plugin + provider callbacks) and ignores what it does not
  // recognize. Routing the unrecognized remainder there rather than
  // duplicating those patterns here keeps one owner per route family.
  oAuthSink.next(url);
  return 'other';
};
