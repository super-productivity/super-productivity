/**
 * Returns the fetch implementation to use for a given call. Factory
 * shape (not a single resolved value) because hosts may need to look
 * the fetch up at call time — e.g. Capacitor's `native-bridge.js`
 * patches `window.fetch` asynchronously during boot, and a captured
 * reference to `fetch` at module-load time can be stale.
 */
export type WebFetchFactory = () => typeof fetch;
