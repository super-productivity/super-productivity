/**
 * Suggested default base URL for hosts that target the
 * Super-Productivity-hosted SuperSync server. This is a hint for the
 * host application — the package itself never falls back to this URL
 * implicitly. Hosts that point at a different server simply ignore
 * this constant and supply their own `defaultBaseUrl` via
 * `SuperSyncDeps`.
 */
export const SUPER_SYNC_DEFAULT_BASE_URL = 'https://sync.super-productivity.com';

/**
 * Stable runtime identifier for the SuperSync provider. The string
 * literal (not an enum) keeps the package free of app-level enums
 * while remaining structurally compatible with `SyncProviderId.SuperSync`
 * on the app side.
 */
export const PROVIDER_ID_SUPER_SYNC = 'SuperSync' as const;

export interface SuperSyncPrivateCfg {
  /** Encryption key (length-only redacted at storage; never logged). */
  encryptKey?: string;
  /**
   * Base URL of the SuperSync server. When empty/undefined, the
   * provider falls back to the host-supplied `defaultBaseUrl` from
   * `SuperSyncDeps` — not to any package-level constant.
   */
  baseUrl?: string;
  /** JWT access token for authentication. */
  accessToken: string;
  /** Optional refresh token for token renewal. */
  refreshToken?: string;
  /** Token expiration timestamp (Unix ms). */
  expiresAt?: number;
  /** Whether E2E encryption is enabled for operation payloads. */
  isEncryptionEnabled?: boolean;
}

/**
 * Structural typing surface for callers that need WebSocket connection
 * parameters from a SuperSync provider. The bundled `SuperSyncProvider`
 * implements this interface, but callers should type against the
 * interface (or use `isSuperSyncWebSocketAccess`) rather than the
 * concrete class — that lets alternate providers expose the same
 * capability without an `instanceof` coupling on the host.
 *
 * @invariant Callers MUST NOT log the returned `accessToken`.
 */
export interface SuperSyncWebSocketAccess {
  getWebSocketParams(): Promise<{
    baseUrl: string;
    accessToken: string;
  } | null>;
}

/**
 * Structural type guard for `SuperSyncWebSocketAccess`. Use this on the
 * host side instead of `instanceof SuperSyncProvider` so the bundled
 * concrete class is not a load-bearing import in WebSocket plumbing.
 */
export const isSuperSyncWebSocketAccess = (
  value: unknown,
): value is SuperSyncWebSocketAccess => {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { getWebSocketParams?: unknown }).getWebSocketParams === 'function'
  );
};
