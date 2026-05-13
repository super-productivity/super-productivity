import type { WebFetchFactory } from '@sp/sync-providers';

/**
 * Factory shape (rather than a stored reference) so the lookup happens
 * at call time: Capacitor's `native-bridge.js` patches `window.fetch`
 * asynchronously during boot, and `CapacitorWebFetch` holds the original
 * unpatched fetch needed on iOS to bypass URLSession.shared.
 */
export const APP_WEB_FETCH: WebFetchFactory = () =>
  ((globalThis as Record<string, unknown>).CapacitorWebFetch as typeof fetch) ?? fetch;
