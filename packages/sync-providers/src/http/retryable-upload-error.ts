/**
 * Regex patterns that identify retryable upload errors.
 *
 * These match the broad textual surface (network, timeout, transient
 * HTTP status, server-busy phrases) used to decide whether a sync
 * upload should be retried. Distinct from
 * `isTransientNetworkError` (in `./native-http-retry`), which checks
 * structured native-platform error codes for the CapacitorHttp retry
 * path. The two coexist because they answer different questions:
 *
 * - `isTransientNetworkError` — should `executeNativeRequestWithRetry`
 *   retry this native HTTP failure?
 * - `isRetryableUploadError` — should the operation-log upload service
 *   retry this server-returned error string?
 *
 * Promoted from `src/app/op-log/sync/sync-error-utils.ts` so the
 * SuperSync provider can call it without an app-side import.
 */
const RETRYABLE_UPLOAD_ERROR_PATTERNS: RegExp[] = [
  /\bfailed to fetch\b/,
  /\bnetwork\s*(error|request|failure)?\b/,
  /\bunable to connect\b/,
  // Android UnknownHostException: "Unable to resolve host \"…\": No address
  // associated with hostname". Routes the error through NetworkUnavailableSPError
  // so the user sees the friendly translated warning instead of the raw message.
  // Anchored to "host" to avoid matching op-graph rejection strings like
  // "Unable to resolve parent revision" that the SuperSync server may surface.
  /\bunable to resolve host\b/,
  /\btimeout\b/,
  /\beconnrefused\b/,
  /\benotfound\b/,
  /\bdns\b/,
  /\bcors\b/,
  /\bnet::/,
  /\boffline\b/,
  /\baborted\b/,
  /\bconnection\s*(refused|reset|closed)\b/,
  /\bsocket\s*(hang up|closed)\b/,
  /\bserver\s*busy\b/,
  /\bplease\s*retry\b/,
  /\bretry in\s+\d+\s*(second|minute|hour)s?\b/,
  /\btransaction\s*rolled\s*back\b/,
  /\binternal\s*server\s*error\b/,
  /\btoo many requests\b/,
  /\brate[-\s]*limit(?:ed| exceeded)?\b/,
  /\b429\b/,
  /\b500\b/,
  /\b502\b/,
  /\b503\b/,
  /\b504\b/,
  /\bservice\s*unavailable\b/,
  /\bgateway\s*timeout\b/,
];

/**
 * Checks if an error message indicates a transient failure worth
 * retrying for a sync upload. Operates on strings or `Error` objects;
 * also returns `true` for `AbortError` (fetch timeout).
 *
 * @param error - Error message string or Error object to check
 * @returns true if the error is retryable, false otherwise
 */
export const isRetryableUploadError = (error: string | Error | undefined): boolean => {
  if (!error) return false;

  const message = typeof error === 'string' ? error : error.message;
  const lowerMessage = message.toLowerCase();

  if (typeof error !== 'string' && error.name === 'AbortError') {
    return true;
  }

  return RETRYABLE_UPLOAD_ERROR_PATTERNS.some((pattern) => pattern.test(lowerMessage));
};
