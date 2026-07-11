import { Capacitor } from '@capacitor/core';

/**
 * Platform gate for the native SQLite op-log backend.
 *
 * Deliberately kept in this tiny module — it imports only `@capacitor/core`
 * (already in every bundle) — so the DI token ({@link OP_LOG_DB_ADAPTER_FACTORY})
 * can call it synchronously WITHOUT statically importing the heavy native backend.
 * That graph (the `@capacitor-community/sqlite` plugin, the SQLite adapter, the
 * value codec, the migration) is dynamically imported only when this returns
 * true, so web/PWA/Electron never bundle it.
 */

/**
 * True only inside a real Capacitor Android native container.
 *
 * Deliberately NOT `IS_ANDROID_NATIVE`: that folds in `IS_ANDROID_WEB_VIEW`
 * (`!!window.SUPAndroid`), which the legacy online-mode `FullscreenActivity` —
 * a plain WebView with no Capacitor bridge, loading the app from the remote URL —
 * also injects. There `getPlatform()` is `'web'`, so this stays `false` and the
 * op-log keeps IndexedDB. `getPlatform()` is `'android'` only in the Capacitor
 * `CapacitorMainActivity`. Plugin availability is deliberately NOT part of this
 * synchronous gate: after SQLite becomes authoritative, selecting the retained
 * IndexedDB copy because a later build lost plugin registration would silently
 * discard every post-migration op. The native resolver must run and fail loudly
 * in that broken-build case.
 */
const isNativeSqliteAvailable = (): boolean => Capacitor.getPlatform() === 'android';

/**
 * Whether to bind the op-log persistence backend to SQLite. Requires a real
 * Capacitor Android native container ({@link isNativeSqliteAvailable}):
 * - iOS keeps IndexedDB — its WKWebView storage has different eviction semantics
 *   and the SQLite path is not validated there yet.
 * - The legacy online-mode WebView (`FullscreenActivity`) and web/PWA/Electron
 *   never qualify: there is no native SQLite bridge there, and the plugin's web
 *   build is WASM persisted into IndexedDB, reintroducing the eviction risk this
 *   escapes.
 *
 * Default-on for qualifying Android (no opt-in flag); the rollout is ramped at the
 * store level (Play Console staged rollout), and the native backend falls back to
 * IndexedDB in-session if SQLite bootstrap fails recoverably.
 *
 * @param isAvailable test seam — defaults to the real platform check. Karma runs
 * in a browser (`getPlatform() === 'web'`), so the native branch is only
 * reachable in tests by passing `true`.
 */
export const shouldUseNativeSqliteOpLogBackend = (
  isAvailable: boolean = isNativeSqliteAvailable(),
): boolean => isAvailable;
