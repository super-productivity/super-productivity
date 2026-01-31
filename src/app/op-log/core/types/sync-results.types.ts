import { Operation, VectorClock } from '../operation.types';

/**
 * Information about an operation rejected by the server during upload.
 */
export interface RejectedOpInfo {
  opId: string;
  error?: string;
  errorCode?: string;
  /**
   * The existing entity's vector clock when rejecting due to conflict.
   * Allows clients to create LWW updates that dominate the server's state.
   */
  existingClock?: VectorClock;
}

/**
 * Result of a download operation.
 */
export interface DownloadResult {
  /** New operations that need to be processed */
  newOps: Operation[];
  /** Whether download completed successfully (vs partial/failed) */
  success: boolean;
  /** Number of files that failed to download (file-based sync only) */
  failedFileCount: number;
  /**
   * True when gap detected on empty server - indicates server migration scenario.
   * When true, the client should upload a full state snapshot before regular ops
   * to ensure all data is transferred to the new server.
   */
  needsFullStateUpload?: boolean;
  /**
   * The server's latest sequence number after download.
   * IMPORTANT: Caller must persist this to lastServerSeq AFTER storing ops to IndexedDB.
   * This ensures localStorage and IndexedDB stay in sync even if the app crashes.
   */
  latestServerSeq?: number;
  /**
   * All operation clocks seen during download, INCLUDING duplicates that were filtered out.
   * This is populated when forceFromSeq0 is true, allowing callers to rebuild their
   * vector clock state from all known ops on the server.
   */
  allOpClocks?: VectorClock[];
  /**
   * Aggregated vector clock from all ops before and including the snapshot.
   * Only set when snapshot optimization is used (sinceSeq < latestSnapshotSeq).
   * Clients need this to create merged updates that dominate all known clocks.
   */
  snapshotVectorClock?: VectorClock;
  /**
   * Full state snapshot from file-based sync providers.
   * Only set when downloading from seq 0 (fresh download) from a file-based provider.
   * Contains the complete application state for bootstrapping a new client.
   */
  snapshotState?: unknown;
  /**
   * True when operations were downloaded AND ALL of them have isPayloadEncrypted: false.
   * This indicates another client disabled encryption. The receiving client should
   * update its local config to match (isEncryptionEnabled: false, encryptKey: undefined).
   *
   * False/undefined when:
   * - No operations were downloaded (cannot determine encryption state)
   * - Any operation has isPayloadEncrypted: true (server still has encrypted data)
   */
  serverHasOnlyUnencryptedData?: boolean;
}

/**
 * Result of an upload operation. May contain piggybacked operations
 * from other clients when using API-based sync.
 */
export interface UploadResult {
  uploadedCount: number;
  piggybackedOps: Operation[];
  rejectedCount: number;
  rejectedOps: RejectedOpInfo[];
  /**
   * Number of local-win update ops created during LWW conflict resolution.
   * These ops need to be uploaded to propagate local state to other clients.
   * Set by OperationLogSyncService.uploadPendingOps after processing piggybacked ops.
   */
  localWinOpsCreated?: number;
  /**
   * Number of operations that were permanently rejected (validation errors, etc.).
   * Transient errors (INTERNAL_ERROR) and resolved conflicts (CONFLICT_CONCURRENT)
   * are NOT counted here. Only operations that will never sync successfully.
   * Set by OperationLogSyncService.uploadPendingOps from RejectedOpsHandlerService.
   */
  permanentRejectionCount?: number;
  /**
   * True when piggybacked ops were limited (more ops exist on server).
   * Caller should trigger a download to get the remaining operations.
   */
  hasMorePiggyback?: boolean;
  /**
   * True when piggybacked operations were received AND ALL of them have isPayloadEncrypted: false.
   * This indicates another client disabled encryption. The receiving client should
   * update its local config to match (isEncryptionEnabled: false, encryptKey: undefined).
   *
   * False/undefined when:
   * - No piggybacked operations were received (cannot determine encryption state)
   * - Any piggybacked operation has isPayloadEncrypted: true (server still has encrypted data)
   */
  piggybackHasOnlyUnencryptedData?: boolean;
}

/**
 * Options for uploadPendingOps.
 */
export interface UploadOptions {
  /**
   * Optional callback executed INSIDE the upload lock, BEFORE checking for pending ops.
   * Use this for operations that must be atomic with the upload, such as server migration checks.
   */
  preUploadCallback?: () => Promise<void>;

  /**
   * If true, instructs server to delete all existing user data before accepting uploaded operations.
   * Used for clean slate operations like encryption password changes or full imports.
   */
  isCleanSlate?: boolean;

  /**
   * If true, skip processing of piggybacked operations returned by the server.
   * Used for force upload scenarios (like password changes) where piggybacked ops
   * may be encrypted with a different key and would cause DecryptError.
   * When SYNC_IMPORT is uploaded, piggybacked ops are irrelevant anyway as they'll be superseded.
   */
  skipPiggybackProcessing?: boolean;

  /**
   * If true, skip the server migration check (which downloads ops to verify server state).
   * Used for force upload scenarios where we're intentionally overwriting remote data.
   * Without this, the download would fail with DecryptError when password has changed.
   */
  skipServerMigrationCheck?: boolean;
}

/**
 * Result from a download operation, used for concurrent modification resolution.
 */
export interface DownloadResultForRejection {
  newOpsCount: number;
  allOpClocks?: VectorClock[];
  snapshotVectorClock?: VectorClock;
}

/**
 * Callback type for triggering downloads during concurrent modification resolution.
 */
export type DownloadCallback = (options?: {
  forceFromSeq0?: boolean;
}) => Promise<DownloadResultForRejection>;
