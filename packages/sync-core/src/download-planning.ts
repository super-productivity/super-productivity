import { compareVectorClocks } from './vector-clock';
import type { VectorClock, VectorClockComparison } from './vector-clock';

export interface PlanDownloadGapResetOptions {
  gapDetected?: boolean;
  hasResetForGap: boolean;
}

export interface DownloadGapResetPlan {
  shouldReset: boolean;
}

/**
 * Plans whether a download loop should reset to sequence 0 after a server gap.
 * A single reset is allowed per download session to avoid infinite loops when a
 * provider keeps reporting a gap after reset.
 */
export const planDownloadGapReset = ({
  gapDetected,
  hasResetForGap,
}: PlanDownloadGapResetOptions): DownloadGapResetPlan => ({
  shouldReset: !!gapDetected && !hasResetForGap,
});

export type DownloadFullStateUploadReason =
  | 'gap-empty-server'
  | 'empty-server-with-synced-ops'
  | 'none';

export interface PlanDownloadFullStateUploadOptions {
  currentNeedsFullStateUpload: boolean;
  hasResetForGap: boolean;
  downloadedOpCount: number;
  finalLatestSeq: number;
  hasSnapshotState: boolean;
  hasSyncedOps?: boolean;
}

export interface DownloadFullStateUploadPlan {
  needsFullStateUpload: boolean;
  reason: DownloadFullStateUploadReason;
  shouldCheckHasSyncedOps: boolean;
}

/**
 * Plans whether an empty remote should be seeded with a full-state upload.
 *
 * The host supplies `hasSyncedOps` only when this helper asks for it, so app
 * code can avoid unnecessary IndexedDB reads on normal non-empty downloads and
 * when gap-based migration detection already decided the result.
 */
export const planDownloadFullStateUpload = ({
  currentNeedsFullStateUpload,
  hasResetForGap,
  downloadedOpCount,
  finalLatestSeq,
  hasSnapshotState,
  hasSyncedOps,
}: PlanDownloadFullStateUploadOptions): DownloadFullStateUploadPlan => {
  if (currentNeedsFullStateUpload) {
    return {
      needsFullStateUpload: true,
      reason: 'none',
      shouldCheckHasSyncedOps: false,
    };
  }

  const isEmptyServer =
    downloadedOpCount === 0 && finalLatestSeq === 0 && !hasSnapshotState;

  if (hasResetForGap && isEmptyServer) {
    return {
      needsFullStateUpload: true,
      reason: 'gap-empty-server',
      shouldCheckHasSyncedOps: false,
    };
  }

  if (!isEmptyServer) {
    return {
      needsFullStateUpload: false,
      reason: 'none',
      shouldCheckHasSyncedOps: false,
    };
  }

  if (hasSyncedOps === undefined) {
    return {
      needsFullStateUpload: false,
      reason: 'none',
      shouldCheckHasSyncedOps: true,
    };
  }

  return {
    needsFullStateUpload: hasSyncedOps,
    reason: hasSyncedOps ? 'empty-server-with-synced-ops' : 'none',
    shouldCheckHasSyncedOps: false,
  };
};

export interface PlanDownloadedDataEncryptionStateOptions {
  sawAnyOps: boolean;
  sawEncryptedOp: boolean;
}

/**
 * Detects whether all observed remote data was unencrypted. Hosts use this to
 * notice when another client disabled encryption.
 */
export const planDownloadedDataEncryptionState = ({
  sawAnyOps,
  sawEncryptedOp,
}: PlanDownloadedDataEncryptionStateOptions): {
  serverHasOnlyUnencryptedData: boolean;
} => ({
  serverHasOnlyUnencryptedData: sawAnyOps && !sawEncryptedOp,
});

export type SnapshotHydrationPlanReason =
  | 'local-dominates-snapshot'
  | 'same-clock-as-snapshot'
  | 'missing-snapshot-clock'
  | 'empty-snapshot-clock'
  | 'missing-local-clock'
  | 'empty-local-clock'
  | 'remote-has-newer-data'
  | 'concurrent-with-snapshot';

export interface PlanSnapshotHydrationOptions {
  localVectorClock?: VectorClock | null;
  snapshotVectorClock?: VectorClock | null;
}

export interface SnapshotHydrationPlan {
  shouldSkipHydration: boolean;
  reason: SnapshotHydrationPlanReason;
  comparison?: VectorClockComparison;
}

/**
 * Plans whether a snapshot state can be ignored because local history already
 * contains everything represented by the remote snapshot.
 *
 * Empty clocks deliberately do not skip hydration: legacy snapshots may carry
 * real state without a populated vector clock.
 */
export const planSnapshotHydration = ({
  localVectorClock,
  snapshotVectorClock,
}: PlanSnapshotHydrationOptions): SnapshotHydrationPlan => {
  if (!snapshotVectorClock) {
    return { shouldSkipHydration: false, reason: 'missing-snapshot-clock' };
  }

  if (isVectorClockEmpty(snapshotVectorClock)) {
    return { shouldSkipHydration: false, reason: 'empty-snapshot-clock' };
  }

  if (!localVectorClock) {
    return { shouldSkipHydration: false, reason: 'missing-local-clock' };
  }

  if (isVectorClockEmpty(localVectorClock)) {
    return { shouldSkipHydration: false, reason: 'empty-local-clock' };
  }

  const comparison = compareVectorClocks(localVectorClock, snapshotVectorClock);
  switch (comparison) {
    case 'EQUAL':
      return {
        shouldSkipHydration: true,
        reason: 'same-clock-as-snapshot',
        comparison,
      };
    case 'GREATER_THAN':
      return {
        shouldSkipHydration: true,
        reason: 'local-dominates-snapshot',
        comparison,
      };
    case 'LESS_THAN':
      return {
        shouldSkipHydration: false,
        reason: 'remote-has-newer-data',
        comparison,
      };
    case 'CONCURRENT':
      return {
        shouldSkipHydration: false,
        reason: 'concurrent-with-snapshot',
        comparison,
      };
  }
};

const isVectorClockEmpty = (clock: VectorClock): boolean =>
  Object.keys(clock).length === 0;
