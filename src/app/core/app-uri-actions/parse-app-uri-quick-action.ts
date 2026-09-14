/**
 * Every action host this parser recognizes, as one exported list so the iOS
 * side can be checked against it: `tools/verify-ios-quick-actions.test.js`
 * reads this array out of the source and asserts every
 * `UIApplicationShortcutItems` entry in `ios/App/App/Info.plist` points at one
 * of these. A Karma spec cannot read files, so that contract has no other place
 * to live — which only holds if this array is what the parser actually branches
 * on, hence the types below being derived from it rather than repeated.
 */
export const QUICK_ACTION_HOSTS = ['add-task', 'today', 'inbox'] as const;

type QuickActionHost = (typeof QUICK_ACTION_HOSTS)[number];

/**
 * Everything except `add-task`, which opens UI instead of navigating. Only the
 * two never-gated work contexts are here on purpose — see NAVIGATE_ROUTES in
 * `app-uri-quick-actions.service.ts`.
 */
export type AppUriQuickActionTarget = Exclude<QuickActionHost, 'add-task'>;

export interface AppUriAddTaskBarAction {
  type: 'add-task';
}

export interface AppUriNavigateAction {
  type: 'navigate';
  target: AppUriQuickActionTarget;
}

export type AppUriQuickAction = AppUriAddTaskBarAction | AppUriNavigateAction;

const isQuickActionHost = (host: string): host is QuickActionHost =>
  (QUICK_ACTION_HOSTS as readonly string[]).includes(host);

/**
 * Parses the UI-only actions on the `com.super-productivity.app://` custom URL
 * scheme: `add-task` (opens the quick-add-task input bar) and the two
 * navigation actions `today` / `inbox`. These are what the iOS home
 * screen quick actions (long-press the app icon) resolve to — each
 * `UIApplicationShortcutItem` carries one of these URLs in its user info and
 * the native side just opens it, so the whole mapping lives here.
 *
 * iOS-only in practice, despite this parser being platform-neutral: Android
 * routes custom-scheme URLs per declared host and `AndroidManifest.xml` lists
 * only `create-task`/`complete-task` (plus the OAuth callbacks), so none of
 * these hosts ever reach the app there. Adding them would mean adding intent
 * filters, deliberately out of scope here. Desktop recognizes `add-task` only,
 * via its own Electron protocol handler. Documented in wiki 3.01 §4.
 *
 * Unlike `create-task`/`complete-task` (see `parse-app-uri-task-action.ts`)
 * these never write anything: they only open UI the user could have reached by
 * tapping. That is why they take no parameters and need no validation, length
 * caps, or snack feedback — the navigation itself is the feedback.
 *
 * `add-task` (not `create-task`) matches the desktop Electron protocol action
 * of the same name, which already means "open the quick-add bar"
 * (`IPC.SHOW_ADD_TASK_BAR`); `create-task` is deliberately the *other* thing.
 *
 * Returns `null` for any other or unrecognized URL, including the task actions
 * and the OAuth callbacks handled elsewhere.
 */
export const parseAppUriQuickAction = (url: string): AppUriQuickAction | null => {
  let urlObj: URL;
  try {
    urlObj = new URL(url);
  } catch {
    return null;
  }

  // Custom URL schemes are non-special per the WHATWG URL spec, so the host
  // component is not auto-lowercased (unlike http/https) — normalize
  // explicitly, matching `parseAppUriTaskAction` and the desktop handler.
  const host = urlObj.hostname.toLowerCase();
  if (!isQuickActionHost(host)) {
    return null;
  }

  return host === 'add-task' ? { type: 'add-task' } : { type: 'navigate', target: host };
};
