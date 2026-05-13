import { toSyncLogError, type SyncLogMeta } from '@sp/sync-core';

/**
 * Strip URL query and fragment, keep host and pathname only.
 *
 * Used at logging and error-construction sites to avoid leaking
 * query-string secrets (auth tokens, signed-url params) into log
 * history. If the input is not a valid URL, it is returned unchanged
 * — callers should scrub other path-like inputs upstream.
 */
export const urlPathOnly = (url: string): string => {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return url;
  }
};

/**
 * Build privacy-aware `SyncLogMeta` from an unknown error plus an
 * optional bag of extra fields.
 *
 * The error is narrowed via `toSyncLogError` so only safe primitives
 * (`errorName`, `errorCode`) leave the catch-site — the raw error
 * object and any payload-bearing fields are never logged.
 */
export const errorMeta = (e: unknown, extra: SyncLogMeta = {}): SyncLogMeta => {
  const { name, code } = toSyncLogError(e);
  return {
    errorName: name,
    ...(code !== undefined ? { errorCode: code } : {}),
    ...extra,
  };
};
