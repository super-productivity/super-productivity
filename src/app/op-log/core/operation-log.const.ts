import { InjectionToken } from '@angular/core';

/**
 * Configuration constants for the Operation Log system.
 * Centralizes all tunable parameters for easier maintenance and documentation.
 *
 * ## System Limits Summary
 *
 * | Limit | Value | Constant | Notes |
 * |-------|-------|----------|-------|
 * | Vector clock clients | 8 | MAX_VECTOR_CLOCK_SIZE | Pruning keeps most active clients |
 * | Client ID length | ≥5 chars | (vector-clock.ts) | Throws error if shorter |
 * | Vector clock counter | MAX_SAFE_INTEGER-1000 | (vector-clock.ts) | Requires SYNC_IMPORT on overflow |
 * | Ops per upload batch | 25 | MAX_OPS_PER_UPLOAD_REQUEST | Reduced from 100 to avoid 413 errors |
 * | Download page size | 500 | DOWNLOAD_PAGE_SIZE | Operations per download request |
 * | Max download iterations | 1000 | MAX_DOWNLOAD_ITERATIONS | Server bug protection (500K ops max) |
 * | Max ops in memory | 50,000 | MAX_DOWNLOAD_OPS_IN_MEMORY | Prevents OOM during sync |
 * | Compaction threshold | 500 | COMPACTION_THRESHOLD | Triggers automatic compaction |
 * | Compaction timeout | 25s | COMPACTION_TIMEOUT_MS | Aborts to prevent lock expiration |
 * | Retention window | 7 days | COMPACTION_RETENTION_MS | Normal compaction |
 * | Emergency retention | 1 day | EMERGENCY_COMPACTION_RETENTION_MS | When quota exceeded |
 * | Clock drift warning | 5 min | CLOCK_DRIFT_THRESHOLD_MS | Warns user once per session |
 * | Max conflict retries | 5 | MAX_CONFLICT_RETRY_ATTEMPTS | Then marked as rejected |
 * | Post-sync cooldown | 2s | POST_SYNC_COOLDOWN_MS | Suppresses selector effects |
 *
 * ## Known Scalability Notes
 *
 * - Bulk hydration (bulk-hydration.meta-reducer.ts): Synchronous loop not tested at 10K+ scale
 * - Compaction deleteOpsWhere: O(N) cursor scan, could be slow with large logs
 *
 * ## Related Timing Constants in Other Files
 *
 * **Sync Configuration** (`src/app/imex/sync/sync.const.ts`):
 * - SYNC_MIN_INTERVAL (5s) - Minimum interval between sync operations
 * - SYNC_WAIT_TIMEOUT_MS (40s) - Max wait for ongoing sync to complete
 * - INITIAL_SYNC_DELAY_MS (500ms) - Delay before triggering initial sync
 *
 * **Meta Sync Lock** (`src/app/sync/providers/webdav/webdav.ts`):
 * - LOCK_TTL_MS (5 min) - Lock TTL for distributed lock on remote metadata (WebDAV)
 */

/**
 * Lock names for cross-tab synchronization via LockService.
 *
 * These locks prevent race conditions when multiple tabs or operations
 * try to access shared resources (IndexedDB, sync endpoints) simultaneously.
 *
 * IMPORTANT: These names are also used in tests - update tests if renaming.
 */
export const LOCK_NAMES = {
  /**
   * Main operation log lock. Used for:
   * - Writing operations to IndexedDB
   * - Compaction (snapshot + cleanup)
   * - Conflict resolution and state application
   * - Repair operations
   * - Flush pending writes before sync
   */
  OPERATION_LOG: 'sp_op_log',

  /**
   * Upload-specific lock. Used to prevent concurrent uploads.
   * Separate from main lock to allow reads during upload.
   */
  UPLOAD: 'sp_op_log_upload',

  /**
   * Download-specific lock. Used to prevent concurrent downloads.
   * Separate from main lock to allow reads during download.
   */
  DOWNLOAD: 'sp_op_log_download',
} as const;

/**
 * Number of operations before triggering automatic compaction.
 * Compaction reduces storage size by snapshotting state and removing old operations.
 */
export const COMPACTION_THRESHOLD = 500;

/**
 * Maximum consecutive compaction failures before notifying the user.
 * After this many failures, a warning is shown to prompt user action.
 */
export const MAX_COMPACTION_FAILURES = 3;

/**
 * Retention window for synced operations during compaction (milliseconds).
 * Operations older than this that have been synced will be deleted.
 * Default: 7 days
 */
export const COMPACTION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Retention window for emergency compaction when storage quota is exceeded.
 * Uses a shorter window (1 day) to free up more space.
 */
export const EMERGENCY_COMPACTION_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Maximum time allowed for compaction before aborting.
 * If compaction exceeds this, it aborts to prevent data corruption.
 */
export const COMPACTION_TIMEOUT_MS = 25000;

/**
 * Maximum retry attempts for downloading operation files.
 * Transient network errors are retried with exponential backoff.
 */
export const MAX_DOWNLOAD_RETRIES = 3;

/**
 * Base delay for download retry exponential backoff (milliseconds).
 * Delays: 1s, 2s, 4s for retries 1, 2, 3.
 */
export const DOWNLOAD_RETRY_BASE_DELAY_MS = 1000;

/**
 * Maximum operations to accumulate in memory during API download.
 * Prevents out-of-memory errors when syncing with users who have
 * millions of unsynced operations.
 */
export const MAX_DOWNLOAD_OPS_IN_MEMORY = 50000;

/**
 * Maximum iterations for the download loop.
 * Prevents infinite loops if server has a bug and always returns hasMore=true.
 * At 500 ops per page, this allows downloading up to 500,000 operations.
 */
export const MAX_DOWNLOAD_ITERATIONS = 1000;

/**
 * Maximum retry attempts for operations that fail during conflict resolution.
 * After this many retries across restarts, the operation is marked as rejected.
 */
export const MAX_CONFLICT_RETRY_ATTEMPTS = 5;

/**
 * Maximum number of operations to be rejected before showing user warning.
 * Once this threshold is reached, user is notified about permanently failed ops.
 */
export const MAX_REJECTED_OPS_BEFORE_WARNING = 10;

/**
 * Maximum number of operations in a single batchUpdateForProject call.
 * Large batch operations are automatically chunked into smaller batches
 * to prevent oversized operation payloads.
 * Default: 50 operations per batch
 */
export const MAX_BATCH_OPERATIONS_SIZE = 50;

/**
 * Maximum age for pending operations before they expire and are rejected (milliseconds).
 * If an operation has been pending for longer than this (e.g., due to data corruption
 * or repeated crashes), it's marked as rejected instead of being replayed.
 * Default: 24 hours - enough time for legitimate recovery scenarios
 */
export const PENDING_OPERATION_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Threshold for warning about clock drift between client and server (milliseconds).
 * If the client's clock differs from the server by more than this amount,
 * a warning is shown to the user as clock drift can affect conflict resolution.
 * Default: 5 minutes
 */
export const CLOCK_DRIFT_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Threshold for logging slow compaction operations (milliseconds).
 * Compaction metrics are only logged when duration exceeds this threshold
 * to avoid flooding logs during normal operation.
 * Default: 3 seconds
 */
export const SLOW_COMPACTION_THRESHOLD_MS = 3000;

/**
 * Threshold for warning about large state size during compaction (megabytes).
 * Large states may cause compaction to be slow or timeout.
 * Default: 20MB
 */
export const STATE_SIZE_WARNING_THRESHOLD_MB = 20;

/**
 * Injection token for retry delay base value (milliseconds).
 * Use this token to inject a different delay value in tests (e.g., 0 for instant retries).
 * Defaults to DOWNLOAD_RETRY_BASE_DELAY_MS if not provided.
 */
export const RETRY_DELAY_BASE_MS = new InjectionToken<number>('RETRY_DELAY_BASE_MS', {
  providedIn: 'root',
  factory: () => DOWNLOAD_RETRY_BASE_DELAY_MS,
});

/**
 * Maximum number of operations per upload request to the sync server.
 * Reduced from 100 to avoid 413 (Payload Too Large) errors with encrypted payloads.
 */
export const MAX_OPS_PER_UPLOAD_REQUEST = 25;

/**
 * Number of operations to request per download page from the sync server.
 * Server returns up to this many operations per request with hasMore indicator.
 */
export const DOWNLOAD_PAGE_SIZE = 500;

/**
 * Maximum number of clients to track in a vector clock.
 * When exceeded, pruning keeps the most active clients (highest counter values).
 * The current client is always preserved regardless of activity level.
 */
export const MAX_VECTOR_CLOCK_SIZE = 8;

/**
 * Minimum length for client IDs in vector clocks.
 * Short IDs are rejected to prevent accidental collisions.
 */
export const MIN_CLIENT_ID_LENGTH = 5;

/**
 * Duration in milliseconds to suppress selector-based effects after sync completes.
 * This prevents "repair" effects from creating redundant operations based on
 * freshly-synced state that looks like it needs repair.
 *
 * The timing gap problem:
 * 1. Tab gains focus → sync triggers
 * 2. Remote ops applied (isApplyingRemoteOps = true)
 * 3. Sync finishes, isApplyingRemoteOps = false
 * 4. Selectors re-evaluate with new state
 * 5. Effects fire and create operations that conflict with just-synced state
 *
 * This cooldown extends the suppression window to prevent step 5.
 * Default: 2 seconds
 */
export const POST_SYNC_COOLDOWN_MS = 2000;
