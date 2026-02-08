import { SyncProviderId } from './provider.const';
import { SyncCredentialStore } from './credential-store.service';
import { PrivateCfgByProviderId } from '../core/types/sync.types';

/**
 * Authentication helper interface for OAuth flows
 */
export interface SyncProviderAuthHelper {
  /** URL to redirect user for authentication */
  authUrl?: string;
  /** Code verifier for PKCE authentication flow */
  codeVerifier?: string;

  /**
   * Verifies the code challenge and returns authentication tokens
   * @param codeChallenge The code challenge from the OAuth redirect
   * @returns Authentication tokens and expiration
   */
  verifyCodeChallenge?(codeChallenge: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  }>;
}

/**
 * Core sync provider service interface
 */
export interface SyncProviderServiceInterface<PID extends SyncProviderId> {
  /** Unique identifier for this sync provider */
  id: PID;

  /** Whether this provider supports force upload (overwriting conflicts) */
  isUploadForcePossible?: boolean;

  /** Whether this provider is limited to syncing a single file */
  isLimitedToSingleFileSync?: boolean;

  /** Maximum number of concurrent requests allowed */
  maxConcurrentRequests: number;

  /** Store for provider-specific private configuration */
  privateCfg: SyncCredentialStore<PID>;

  /**
   * Gets the current revision for a file
   * @param targetPath Path to the file
   * @param localRev Current local revision; can be used to check if download is necessary
   * @returns The current revision information
   * @throws Error if the operation fails
   */
  getFileRev(targetPath: string, localRev: string | null): Promise<FileRevResponse>;

  /**
   * Downloads file data from the sync provider
   * @param targetPath Path to the file
   * @returns The file data and revision information
   * @throws Error if the download fails
   */
  downloadFile(targetPath: string): Promise<FileDownloadResponse>;

  /**
   * Uploads file data to the sync provider
   * @param targetPath Path to the file
   * @param dataStr Serialized file data
   * @param revToMatch If revision does not match, the upload will fail
   * @param isForceOverwrite Whether to force overwrite existing file
   * @returns The new revision information after successful upload
   * @throws Error if the upload fails or revision conflict occurs
   */
  uploadFile(
    targetPath: string,
    dataStr: string,
    revToMatch: string | null,
    isForceOverwrite?: boolean,
  ): Promise<FileRevResponse>;

  /**
   * Removes a file from the sync provider
   * @param targetPath Path to the file to remove
   * @throws Error if the removal fails
   */
  removeFile(targetPath: string): Promise<void>;

  /**
   * Lists files in a directory
   * @param targetPath Path to the directory to list
   * @returns List of file names/paths
   */
  listFiles?(targetPath: string): Promise<string[]>;

  /**
   * Checks if the provider is ready to perform sync operations
   * @returns True if the provider is authenticated and ready
   */
  isReady(): Promise<boolean>;

  /**
   * Gets authentication helper for initiating auth flows
   * @returns Auth helper object or undefined if not supported
   */
  getAuthHelper?(): Promise<SyncProviderAuthHelper>;

  /**
   * Updates the provider's private configuration
   * @param privateCfg New configuration to store
   */
  setPrivateCfg(privateCfg: PrivateCfgByProviderId<PID>): Promise<void>;

  /**
   * Clears authentication credentials while preserving non-auth config (e.g., encryptKey).
   * Called when auth errors occur to ensure re-auth flow can proceed.
   */
  clearAuthCredentials?(): Promise<void>;
}

/**
 * Response for file revision operations
 */
export interface FileRevResponse {
  /** The current revision identifier for the file */
  rev: string;
  legacyRev?: string;
}

/**
 * Response for file download operations
 */
export interface FileDownloadResponse extends FileRevResponse {
  /** The file content as a string */
  dataStr: string;
}

// ===== Operation Sync Types =====

/**
 * Operation structure for server sync
 */
export interface SyncOperation {
  id: string;
  clientId: string;
  actionType: string;
  opType: string;
  entityType: string;
  entityId?: string;
  entityIds?: string[]; // For batch operations
  payload: unknown;
  vectorClock: Record<string, number>;
  timestamp: number;
  schemaVersion: number;
  /** True if payload is an encrypted string (E2E encryption enabled) */
  isPayloadEncrypted?: boolean;
}

/**
 * Server operation with server-assigned sequence
 */
export interface ServerSyncOperation {
  serverSeq: number;
  op: SyncOperation;
  receivedAt: number;
}

/**
 * Result of uploading a single operation
 */
export interface OpUploadResult {
  opId: string;
  accepted: boolean;
  serverSeq?: number;
  error?: string;
  /** Structured error code for programmatic handling */
  errorCode?: string;
  /**
   * The existing entity's vector clock when rejecting due to conflict.
   * Allows clients to create LWW updates that dominate the server's state.
   */
  existingClock?: Record<string, number>;
}

/**
 * Response from uploading operations
 */
export interface OpUploadResponse {
  results: OpUploadResult[];
  newOps?: ServerSyncOperation[];
  latestSeq: number;
  /**
   * True when piggybacked ops were limited (more ops exist on server).
   * Client should trigger a download to get the remaining operations.
   */
  hasMorePiggyback?: boolean;
}

/**
 * Response from downloading operations
 */
export interface OpDownloadResponse {
  ops: ServerSyncOperation[];
  hasMore: boolean;
  latestSeq: number;
  /**
   * Whether a gap was detected in the operation sequence.
   * This can happen when:
   * - The server was reset and client has stale lastServerSeq
   * - Operations were purged from the server
   * - Client is ahead of server (shouldn't happen normally)
   *
   * When true, the client should reset lastServerSeq to 0 and re-download.
   */
  gapDetected?: boolean;
  /**
   * Aggregated vector clock from all ops before and including the snapshot.
   * Only set when snapshot optimization is used (sinceSeq < latestSnapshotSeq).
   * Clients need this to create merged updates that dominate all known clocks.
   */
  snapshotVectorClock?: Record<string, number>;
  /**
   * Server's current time when the response was generated (Unix timestamp).
   * Used to detect clock drift between client and server.
   *
   * Note: This differs from `receivedAt` on individual ops, which is the time
   * when each operation was originally uploaded to the server (could be hours ago).
   * For clock drift detection, we need the server's CURRENT time, not old timestamps.
   */
  serverTime?: number;
  /**
   * Full state snapshot from file-based sync providers.
   * Only set when downloading from seq 0 (fresh download) from a file-based provider.
   * Contains the complete application state for bootstrapping a new client.
   */
  snapshotState?: unknown;
}

/**
 * Extended sync provider interface with operation sync support
 */
export interface OperationSyncCapable {
  /**
   * Whether this provider supports direct operation sync (vs file-based)
   */
  supportsOperationSync: boolean;

  /**
   * Upload operations to the server
   * @param ops Operations to upload
   * @param clientId Client identifier
   * @param lastKnownServerSeq Last known server sequence (for piggyback download)
   * @param isCleanSlate If true, server deletes all user data before accepting ops
   */
  uploadOps(
    ops: SyncOperation[],
    clientId: string,
    lastKnownServerSeq?: number,
    isCleanSlate?: boolean,
  ): Promise<OpUploadResponse>;

  /**
   * Download operations from the server
   * @param sinceSeq Download ops with serverSeq > sinceSeq
   * @param excludeClient Exclude ops from this client
   * @param limit Maximum number of ops to return
   */
  downloadOps(
    sinceSeq: number,
    excludeClient?: string,
    limit?: number,
  ): Promise<OpDownloadResponse>;

  /**
   * Get the last known server sequence for this user
   */
  getLastServerSeq(): Promise<number>;

  /**
   * Update the last known server sequence
   */
  setLastServerSeq(seq: number): Promise<void>;

  /**
   * Upload a full state snapshot (for backup imports, repairs, initial sync)
   * This is more efficient than sending large payloads through the ops endpoint.
   * @param state The complete application state
   * @param clientId Client identifier
   * @param reason Why the snapshot is being uploaded
   * @param vectorClock Current vector clock state
   * @param schemaVersion Schema version of the state
   * @param isPayloadEncrypted Whether the state payload is E2E encrypted
   * @param opId Client's operation ID - server MUST use this ID to prevent ID mismatch bugs
   * @param isCleanSlate If true, server deletes all user data before accepting the snapshot
   */
  uploadSnapshot(
    state: unknown,
    clientId: string,
    reason: 'initial' | 'recovery' | 'migration',
    vectorClock: Record<string, number>,
    schemaVersion: number,
    isPayloadEncrypted: boolean | undefined,
    opId: string,
    isCleanSlate?: boolean,
    snapshotOpType?: RestorePointType,
  ): Promise<SnapshotUploadResponse>;

  /**
   * Delete all sync data for this user on the server.
   * Used for encryption password changes - deletes all operations,
   * tombstones, devices, and resets sync state.
   */
  deleteAllData(): Promise<{ success: boolean }>;

  /**
   * Get the encryption key for E2E encryption (optional).
   * For API-based providers (SuperSync), returns the key from privateCfg.
   * For file-based providers, encryption is handled internally so this returns undefined.
   */
  getEncryptKey?(): Promise<string | undefined>;
}

/**
 * Response from uploading a snapshot
 */
export interface SnapshotUploadResponse {
  accepted: boolean;
  serverSeq?: number;
  error?: string;
}

// ===== Restore Point Types =====

/**
 * Type of restore point
 */
export type RestorePointType = 'SYNC_IMPORT' | 'BACKUP_IMPORT' | 'REPAIR';

/**
 * A point in time that can be restored to
 */
export interface RestorePoint {
  serverSeq: number;
  timestamp: number;
  type: RestorePointType;
  clientId: string;
  description?: string;
}

/**
 * Response from getting restore points
 */
export interface RestorePointsResponse {
  restorePoints: RestorePoint[];
}

/**
 * Response from getting a restore snapshot
 */
export interface RestoreSnapshotResponse {
  state: unknown;
  serverSeq: number;
  generatedAt: number;
}

/**
 * Extended sync provider interface with restore point support
 */
export interface RestoreCapable {
  /**
   * Get available restore points
   * @param limit Maximum number of restore points to return
   */
  getRestorePoints(limit?: number): Promise<RestorePoint[]>;

  /**
   * Get state snapshot at a specific server sequence
   * @param serverSeq The server sequence to restore to
   */
  getStateAtSeq(serverSeq: number): Promise<RestoreSnapshotResponse>;
}
