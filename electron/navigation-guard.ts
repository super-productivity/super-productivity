/**
 * Returns true if `targetUrl` is the same origin as the app's loaded URL.
 *
 * Security boundary: the main window has Node integration / preload bridge.
 * A navigation to ANY other origin in-window would expose `window.ea` to
 * untrusted content (e.g. http://127.0.0.1:<any> hosting a malicious page).
 * `will-navigate` MUST reject anything this returns false for and hand it
 * to the (scheme-guarded) external-open path instead.
 *
 * Comparison rules:
 * - Protocols must match exactly.
 * - http/https: exact host (incl. port) match. Subdomains differ → different
 *   origin. This is what blocks `localhost.evil.com` and `http://127.0.0.1:1`.
 * - file: pathname equality with the app's loaded html file. Hash-only changes
 *   do not fire `will-navigate`, so a same-document hash route never reaches
 *   this check; a real cross-document file:// nav must point to the same html.
 * - Anything else (data:, blob:, javascript:, ftp:, …): rejected.
 */
export const isAppOriginUrl = (targetUrl: string, appUrl: string): boolean => {
  let target: URL;
  let expected: URL;
  try {
    target = new URL(targetUrl);
    expected = new URL(appUrl);
  } catch {
    return false;
  }
  if (target.protocol !== expected.protocol) return false;
  if (target.protocol === 'http:' || target.protocol === 'https:') {
    return target.host === expected.host;
  }
  if (target.protocol === 'file:') {
    return target.pathname === expected.pathname;
  }
  return false;
};
