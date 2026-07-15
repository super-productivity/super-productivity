import { BrowserWindowConstructorOptions } from 'electron';

type WebPreferences = BrowserWindowConstructorOptions['webPreferences'];

/**
 * Fail-closed guard for a renderer's security-critical webPreferences.
 *
 * Every IPC trust boundary in the app — the Jira one-shot capability, plugin
 * node-execution consent, the `window.ea` preload bridge — ultimately rests on
 * the renderer main world NOT having `require` / `ipcRenderer`. That property is
 * guaranteed solely by `contextIsolation: true` + `nodeIntegration: false`, plus
 * sub-frames (where untrusted plugin iframes run) not getting node integration.
 * If any of those silently regressed — a refactor spreading a shared options
 * object, a bad merge, a copy-paste into a new window — every one of those gates
 * would collapse at once while still looking correct in a diff.
 *
 * This asserts the invariant at window creation and throws BEFORE the window
 * loads, so an accidental regression fails the app at startup / in CI instead of
 * shipping a renderer that plugin code can fully own. It is a tripwire against
 * accidental drift, not a defense against a developer who deliberately flips a
 * flag (they would delete this call too).
 *
 * Two kinds of check:
 * - The three core boundary flags — `contextIsolation`, `nodeIntegration`,
 *   `nodeIntegrationInSubFrames` — are **fail-closed**: an omitted/`undefined`
 *   value is rejected too, so the guard never depends on the Electron default
 *   staying safe across upgrades. (Sub-frames are included because that flag
 *   governs whether the preload bridge reaches plugin iframes.)
 * - The additional insecure overrides — `sandbox`, `nodeIntegrationInWorker`,
 *   `webviewTag`, `webSecurity` — are checked **directionally**: only an explicit
 *   insecure value is rejected; an omitted key keeps Electron's secure default so
 *   no call site is forced to enumerate them. These stay default-dependent by choice.
 *
 * Scope notes:
 * - Electron exposes no getter for a webContents' *effective* webPreferences, so
 *   this can only validate the options object we pass to the constructor.
 * - The wiring-guard test requires this call for `new BrowserWindow`,
 *   `new BrowserView`, and `new WebContentsView`. A `<webview>` guest has no such
 *   constructor and would still need its own validation (e.g. a
 *   `will-attach-webview` handler) — none of these exist today.
 */
export const assertSecureWebPreferences = (
  webPreferences: WebPreferences,
  windowLabel: string,
): void => {
  // Returns an Error (callers `throw fail(...)`) so the shared message prefix/suffix
  // is defined once — mirroring the `throw fail(...)` shape of the sibling guard
  // `file-path-guard.ts` (that one also hardens the error for the renderer; here the
  // error only ever surfaces in the main process, so it needs no such hardening).
  const fail = (detail: string): Error =>
    new Error(
      `Insecure webPreferences for the "${windowLabel}" window: ${detail}. ` +
        'This would collapse the renderer IPC trust boundary — refusing to create the window.',
    );

  if (!webPreferences) {
    throw fail('no webPreferences set (relying on Electron defaults)');
  }
  // Core boundary flags — fail-closed (reject omitted/undefined too).
  if (webPreferences.contextIsolation !== true) {
    throw fail(
      `contextIsolation must be true (got ${String(webPreferences.contextIsolation)})`,
    );
  }
  if (webPreferences.nodeIntegration !== false) {
    throw fail(
      `nodeIntegration must be false (got ${String(webPreferences.nodeIntegration)})`,
    );
  }
  if (webPreferences.nodeIntegrationInSubFrames !== false) {
    throw fail(
      `nodeIntegrationInSubFrames must be false (got ${String(webPreferences.nodeIntegrationInSubFrames)})`,
    );
  }
  // Additional node-capability surfaces — directional (reject explicit insecure
  // value only). Disabling the sandbox re-enables full Node in the preload; a
  // Node-enabled worker or a <webview> guest would each open a path around the
  // IPC/consent boundary.
  if (webPreferences.sandbox === false) {
    throw fail('sandbox must not be explicitly false');
  }
  if (webPreferences.nodeIntegrationInWorker === true) {
    throw fail('nodeIntegrationInWorker must not be true');
  }
  if (webPreferences.webviewTag === true) {
    throw fail(
      'webviewTag must not be true (a <webview> guest needs its own validation)',
    );
  }
  // webSecurity is the same-origin policy rather than a node capability, but with the
  // app's blanket Access-Control-Allow-Origin: * an explicit `false` here would widen
  // a node-bridged renderer's cross-origin reach — reject it (directional, like above).
  if (webPreferences.webSecurity === false) {
    throw fail('webSecurity must not be explicitly false');
  }
};
