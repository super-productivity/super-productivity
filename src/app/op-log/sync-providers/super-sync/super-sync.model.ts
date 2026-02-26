import { SyncProviderPrivateCfgBase } from '../../core/types/sync.types';

export const SUPER_SYNC_DEFAULT_BASE_URL = 'https://sync.super-productivity.com';

export interface SuperSyncPrivateCfg extends SyncProviderPrivateCfgBase {
  /** Base URL of the SuperSync server. Defaults to SUPER_SYNC_DEFAULT_BASE_URL if not set. */
  baseUrl?: string;
  /** JWT access token for authentication */
  accessToken: string;
  /** Optional refresh token for token renewal */
  refreshToken?: string;
  /** Token expiration timestamp (Unix ms) */
  expiresAt?: number;
  /** Whether E2E encryption is enabled for operation payloads */
  isEncryptionEnabled?: boolean;
  // Note: encryptKey is inherited from SyncProviderPrivateCfgBase
}
