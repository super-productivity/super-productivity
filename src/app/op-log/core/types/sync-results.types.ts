import { Operation, OperationLogEntry, VectorClock } from '../operation.types';
import { OperationSyncProviderMode } from '../../sync-providers/provider.interface';

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
export interface DownloadResultBase {
  /**
   * Distinguishes pure SuperSync operation results from file-based snapshot adapter results.
   */
  providerMode: OperationSyncProviderMode;
  /** New operations that need to be processed */
  newOps: Operation[];
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
   * Only set when snapshot optimization is used.
   * Clients need this to create merged updates that dominate all known clocks.
   */
  snapshotVectorClock?: VectorClock;
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

export interface DownloadUnavailableResult extends Omit<
  DownloadResultBase,
  'providerMode'
> {
  /** Whether download completed successfully (vs partial/failed) */
  success: false;
  providerMode?: never;
  snapshotState?: never;
}

export interface SuperSyncDownloadResult extends DownloadResultBase {
  /** Whether download completed successfully (vs partial/failed) */
  success: true;
  providerMode: 'superSyncOps';
  snapshotState?: never;
}

export interface FileSnapshotDownloadResult extends DownloadResultBase {
  /** Whether download completed successfully (vs partial/failed) */
  success: true;
  providerMode: 'fileSnapshotOps';
  /**
   * Full state snapshot from file-based sync providers.
   * Only set when downloading from seq 0 (fresh download) from a file-based provider.
   * Contains the complete application state for bootstrapping a new client.
   */
  snapshotState?: unknown;
}

export type DownloadResult =
  | DownloadUnavailableResult
  | SuperSyncDownloadResult
  | FileSnapshotDownloadResult;

/**
 * Result of an upload operation. May contain piggybacked operations
 * from other clients when using API-based sync.
 */
export interface UploadResult {
  uploadedCount: number;
  piggybackedOps: Operation[];
  rejectedCount: number;
  rejectedOps: RejectedOpInfo[];
  /** Exact in-lock pending set considered by this upload round. */
  selectedPendingOps?: OperationLogEntry[];
  /**
   * Accepted/local-only operation sequences whose acknowledgement was deliberately
   * deferred until the caller has resolved and applied piggybacked operations.
   */
  pendingAcknowledgementSeqs?: number[];
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
  /**
   * True when upload was cancelled due to piggybacked SYNC_IMPORT conflict dialog.
   * Callers should skip post-upload logic (LWW re-upload, IN_SYNC status).
   */
  cancelled?: boolean;
  /**
   * The lastServerSeq value the caller must persist via setLastServerSeq AFTER it has
   * applied the piggybacked ops (processRemoteOps). Only set when piggybacked ops were
   * collected for the caller to apply; undefined otherwise (the upload service persisted
   * the seq itself, since advancing past our own uploaded ops carries no loss risk).
   *
   * Deferring the persist mirrors the download path's invariant ("persist lastServerSeq
   * AFTER ops are stored"): if a crash or a cancelled SYNC_IMPORT dialog occurs between
   * upload return and processRemoteOps, the seq must NOT have advanced past those ops,
   * or the next download skips them forever. (#8304)
   */
  lastServerSeqToPersist?: number;
  /**
   * True when the provider mandates E2E encryption (SuperSync) but no key is configured
   * yet, so the GHSA-9v8x guard skipped the upload while pending ops remain unsynced.
   * Lets the caller report an honest "not in sync — encryption required" status instead
   * of claiming IN_SYNC after what looks like a zero-op upload. Only set when there were
   * pending ops to upload (the guard fires after the empty-ops check).
   */
  encryptionRequiredKeyMissing?: boolean;
  /**
   * True when pending incremental operations were kept local because the newest
   * explicit import/restore boundary was permanently rejected by the server.
   * A newer successful full-state operation clears the barrier.
   */
  blockedByRejectedFullState?: boolean;
}

/**
 * Options for uploadPendingOps.
 */
export interface UploadOptions {
  /**
   * Optional preparation callback executed inside upload serialization and
   * before capturing pending operations. The callback owns any narrower
   * operation-log transaction needed for its local mutation.
   */
  preUploadCallback?: () => Promise<void>;

  /**
   * Return accepted sequence numbers to the caller instead of marking them synced
   * immediately. Required when piggybacked full-state operations may need user
   * resolution before the upload round is considered committed locally.
   */
  deferAcknowledgement?: boolean;

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
 *
 * Validation failure (if any during a nested download) is surfaced via the
 * SyncSessionValidationService latch — the wrapper reads it once before
 * deciding IN_SYNC vs ERROR. (#7330)
 */
export type DownloadResultForRejection =
  | {
      kind: 'completed';
      newOpsCount: number;
      allOpClocks?: VectorClock[];
      snapshotVectorClock?: VectorClock;
      /** Server cursor after the downloaded operations were durably applied. */
      latestServerSeq?: number;
    }
  | {
      /** User declined the nested SYNC_IMPORT conflict resolution. */
      kind: 'cancelled';
    };

/**
 * Callback type for triggering downloads during concurrent modification resolution.
 */
export type DownloadCallback = (options?: {
  forceFromSeq0?: boolean;
  /** Local full-state boundaries to ignore while processing this recovery download. */
  ignoredLocalFullStateOpIds?: string[];
}) => Promise<DownloadResultForRejection>;

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator-level result types (discriminated unions)
//
// These replace the ad-hoc return types from OperationLogSyncService methods.
// Transport-level types (DownloadResult, UploadResult) remain unchanged.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Outcome of OperationLogSyncService.downloadRemoteOps().
 *
 * Each variant represents a distinct terminal state — callers switch on `kind`
 * instead of checking boolean flag combinations.
 */
export type DownloadOutcome =
  | {
      /** Server was empty/reset — a SYNC_IMPORT was created. Caller must upload. */
      kind: 'server_migration_handled';
    }
  | {
      /** No new operations on server. */
      kind: 'no_new_ops';
      allOpClocks?: VectorClock[];
      snapshotVectorClock?: VectorClock;
    }
  | {
      /** Incremental ops were downloaded and processed. */
      kind: 'ops_processed';
      newOpsCount: number;
      localWinOpsCreated: number;
      allOpClocks?: VectorClock[];
      snapshotVectorClock?: VectorClock;
    }
  | {
      /** File-based snapshot was hydrated (fresh download from file provider). */
      kind: 'snapshot_hydrated';
      allOpClocks?: VectorClock[];
      snapshotVectorClock?: VectorClock;
    }
  | {
      /** User cancelled a SYNC_IMPORT conflict dialog. */
      kind: 'cancelled';
    }
  | {
      /** Processing stopped at an op this app version cannot interpret safely. */
      kind: 'blocked_incompatible';
    };

/**
 * Outcome of OperationLogSyncService.uploadPendingOps().
 *
 * Each variant represents a distinct terminal state.
 */
export type UploadOutcome =
  | {
      /** Upload was blocked because this is a fresh client with no history. */
      kind: 'blocked_fresh_client';
    }
  | {
      /** Upload completed (ops may have been accepted, rejected, or piggybacked). */
      kind: 'completed';
      uploadedCount: number;
      piggybackedOpsCount: number;
      localWinOpsCreated: number;
      permanentRejectionCount: number;
      hasMorePiggyback: boolean;
      rejectedOps: RejectedOpInfo[];
      /**
       * True when the upload was skipped because the provider mandates encryption but no
       * key is configured, leaving pending ops unsynced. The wrapper must not claim IN_SYNC.
       */
      encryptionRequiredKeyMissing?: boolean;
      /** Pending ops depend on an explicit full-state baseline the server rejected. */
      blockedByRejectedFullState?: boolean;
    }
  | {
      /** User cancelled a piggybacked SYNC_IMPORT conflict dialog. */
      kind: 'cancelled';
    }
  | {
      /** Piggyback processing stopped at an incompatible operation. */
      kind: 'blocked_incompatible';
    };
