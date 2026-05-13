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
  /** Base URL of the SuperSync server. Defaults to `SUPER_SYNC_DEFAULT_BASE_URL`. */
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
