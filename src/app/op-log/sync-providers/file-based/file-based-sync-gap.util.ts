import { OperationLogEntry, VectorClock } from '../../core/operation.types';
import { compareVectorClocks } from '../../../core/util/vector-clock';
import { FILE_BASED_SYNC_CONSTANTS } from './file-based-sync.types';

/** The fields of a downloaded sync/ops file that gap detection reads. */
export interface GapDetectionRemote {
  syncVersion: number;
  vectorClock: VectorClock;
  snapshotBaseClock?: VectorClock;
  clientId: string;
  recentOps: readonly unknown[];
  oldestOpSyncVersion?: number;
  /**
   * #10973: the writer certifies that recentOps holds every op of batch
   * oldestOpSyncVersion. Written only by clients that trim at batch boundaries;
   * older writers drop it, so absence proves nothing.
   */
  oldestBatchComplete?: boolean;
}

export interface GapDetectionInput {
  remote: GapDetectionRemote;
  sinceSeq: number;
  excludeClient: string | undefined;
  /** Committed expected syncVersion for this provider (0 = none). */
  previousExpectedVersion: number;
  lastSeenClock: VectorClock | undefined;
  /**
   * The device's op-log clock. Judges the snapshot base only while no
   * last-seen clock is recorded (first sync after upgrading, #10258): every
   * snapshot this device hydrated or wrote is merged into it, so an uncovered
   * base is one it never loaded.
   */
  localClock?: VectorClock;
  /**
   * Whether the file carries a snapshot an empty buffer could stand for. The
   * single-file format requires `state`; a split ops file always references one.
   */
  hasSnapshot: boolean;
  /**
   * #10973: whether recentOps may have been trimmed, so an uncertified oldest
   * batch can be missing its head. See {@link isSingleFileBufferPossiblyTrimmed}
   * and {@link isSplitBufferPossiblyTrimmed}.
   */
  isPossiblyTrimmed: boolean;
}

export interface GapDetectionResult {
  needsGapDetection: boolean;
  /** Log-only description of the first check that fired. */
  reason?: string;
  /** The syncVersion regressed, but the causal state provably did not. */
  isCosmeticReset: boolean;
  /** A seq-0 snapshot download lost this client's uploads (#10916). */
  ownUploadsMissing: boolean;
  /** See {@link doesRemoteExtendLastSeen} (#10972). */
  snapshotExtendsLastSeen: boolean;
}

/** The op-log reads {@link getOpLogBaselineClock} needs. */
export interface OpLogClockSource {
  getVectorClock(): Promise<VectorClock | null>;
  getLatestFullStateOpEntry(): Promise<OperationLogEntry | undefined>;
}

/**
 * The op-log clock as the snapshot-base baseline while no file clock is recorded
 * (first sync after upgrading, #10258); none on a seq-0 download or once one is.
 * Also none while a local full-state op is unsynced: a backup restore or clean
 * slate resets the clock to a fresh client id, so it no longer covers bases the
 * device has loaded, and that op's upload replaces the remote anyway.
 */
export const getOpLogBaselineClock = async (
  store: OpLogClockSource,
  sinceSeq: number,
  lastSeenClock: VectorClock | undefined,
): Promise<VectorClock | undefined> => {
  if (sinceSeq === 0 || lastSeenClock) return undefined;
  const latestFullStateOp = await store.getLatestFullStateOpEntry();
  if (latestFullStateOp?.source === 'local' && !latestFullStateOp.syncedAt) {
    return undefined;
  }
  return (await store.getVectorClock()) ?? undefined;
};

/**
 * Whether a remote replacement's base clock is not covered by the last file
 * clock this client committed, i.e. it has not hydrated that snapshot (#9170).
 * Without any baseline it returns false: flagging every base would force a
 * seq-0 download and, with pending local ops, a conflict dialog.
 */
export const isSnapshotBaseUnseen = (
  snapshotBaseClock: VectorClock | undefined,
  lastSeenClock: VectorClock | undefined,
): boolean => {
  if (!snapshotBaseClock || !lastSeenClock) {
    return false;
  }
  const comparison = compareVectorClocks(snapshotBaseClock, lastSeenClock);
  return comparison === 'GREATER_THAN' || comparison === 'CONCURRENT';
};

/**
 * Whether the remote file lost uploads this client already saw there (#10916):
 * its own clock entry went backwards while the snapshot base is one this client
 * has seen. A writer on a stale copy (a folder-sync tool or a server ignoring
 * If-Match) causes this; a full-state replacement (import, repair, USE_LOCAL)
 * writes a new base and is excluded, so it still wins silently. A file without
 * a base (written by v19.1.0 or older) cannot tell the two apart and counts as
 * missing: a dialog is recoverable, a silent hydration is not.
 */
export const areOwnUploadsMissing = (
  remote: Pick<GapDetectionRemote, 'vectorClock' | 'snapshotBaseClock'>,
  clientId: string | undefined,
  lastSeenClock: VectorClock | undefined,
): boolean => {
  if (!clientId || !lastSeenClock) {
    return false;
  }
  const lastSeenOwn = lastSeenClock[clientId] ?? 0;
  return (
    (remote.vectorClock[clientId] ?? 0) < lastSeenOwn &&
    !isSnapshotBaseUnseen(remote.snapshotBaseClock, lastSeenClock)
  );
};

/**
 * Decides whether a file-based download must fall back to a seq-0 re-download
 * so the caller re-hydrates the remote snapshot. Shared by the single-file and
 * split ("surgical sync") download paths.
 */
export const detectDownloadGap = ({
  remote,
  sinceSeq,
  excludeClient,
  previousExpectedVersion,
  lastSeenClock,
  localClock,
  hasSnapshot,
  isPossiblyTrimmed,
}: GapDetectionInput): GapDetectionResult => {
  // Detect syncVersion reset (e.g., another client uploaded a snapshot).
  // When syncVersion resets to a lower value, we need to signal this to trigger
  // a re-download from seq 0 so the caller can get the snapshotState.
  const syncVersionRegressed =
    previousExpectedVersion > 0 && remote.syncVersion < previousExpectedVersion;

  // SPAP-9: a syncVersion regression only implies data loss if the causal state
  // also regressed. Compare the file's vector clock against the one we last saw
  // for this provider. Only an EQUAL clock proves this client already holds the
  // exact same causal state, so the reset is purely cosmetic (a counter reset
  // that composed with a snapshot rewrite of identical content) and we can keep
  // syncing incrementally at the expected version instead of forcing a full
  // seq-0 resync.
  //
  // GREATER_THAN is deliberately NOT treated as cosmetic (review follow-up): it
  // only proves the writer did strictly more work, not that this client received
  // the intervening ops. A snapshot can compact ops this client never downloaded
  // and the writer then make one more op — dominating our last-seen clock — so
  // suppressing the reset there would silently drop the compacted ops. Anything
  // that is not EQUAL (GREATER_THAN, behind, or concurrent) is treated as a
  // genuine reset and triggers a seq-0 resync so the caller re-hydrates the
  // snapshot. Implemented generally via the last-seen clock — no dependency on
  // any provider-specific recovery mechanism.
  const clockVsLastSeen = lastSeenClock
    ? compareVectorClocks(remote.vectorClock, lastSeenClock)
    : undefined;
  const isCosmeticReset = syncVersionRegressed && clockVsLastSeen === 'EQUAL';
  const versionWasReset = syncVersionRegressed && !isCosmeticReset;

  // Also detect snapshot replacement: if client expected ops (sinceSeq > 0) but file has
  // no recent ops AND has a snapshot state, another client uploaded a fresh snapshot.
  // This happens when "Use Local" is chosen in conflict resolution - the snapshot replaces
  // all previous ops but syncVersion may not decrease (could stay at 1).
  //
  // Detection strategy depends on whether we know the downloading client's ID:
  // - If excludeClient is provided: use clientId comparison (more accurate)
  // - If excludeClient is undefined: fall back to syncVersion comparison
  //
  // The clientId check prevents false positives when we just uploaded a snapshot ourselves.
  // The syncVersion check works when sinceSeq doesn't match syncVersion (another client changed it).
  const snapshotReplacement =
    sinceSeq > 0 &&
    remote.recentOps.length === 0 &&
    hasSnapshot &&
    (excludeClient !== undefined
      ? remote.clientId !== excludeClient
      : sinceSeq !== remote.syncVersion);

  // Detect a trimming gap. The client already holds every op up to and including
  // sinceSeq, so the first op it still needs is sinceSeq+1. syncVersion is
  // contiguous and every bump carries at least one op, so if the oldest op still
  // retained has syncVersion > sinceSeq+1, the op at sinceSeq+1 provably existed
  // and has since been trimmed away — a genuine gap that requires the snapshot.
  // The boundary oldestOpSyncVersion === sinceSeq + 1 is contiguous (SPAP-9
  // off-by-one fix) and must NOT be treated as a gap.
  //
  // SPAP-33: `oldestOpSyncVersion > sinceSeq + 1` is sufficient on its own and
  // never false-positives, so the previous `recentOps.length >= MAX_RECENT_OPS`
  // clause was redundant AND harmful — it silently SUPPRESSED a real gap whenever
  // the buffer was trimmed at a smaller floor than the current cap: a legacy
  // buffer written by an old client with a lower MAX_RECENT_OPS, or (in the split
  // format) a buffer trimmed to SPLIT_COMPACTION_THRESHOLD. Dropping it lets a
  // behind client correctly fall back to the snapshot instead of silently
  // diverging.
  const partialTrimGap =
    sinceSeq > 0 &&
    remote.oldestOpSyncVersion !== undefined &&
    remote.oldestOpSyncVersion > sinceSeq + 1;

  // #10973: one upload is one batch under one syncVersion, but writers before
  // #10973 trimmed per op, so a cut could land INSIDE batch sinceSeq+1. Its
  // tail then still reads as contiguous (oldestOpSyncVersion === sinceSeq + 1)
  // while the head this client needs is gone, and the client's clock still
  // advances past it, so nothing repairs it later. Writers since #10973 cut only
  // at batch boundaries and certify that with `oldestBatchComplete`; without
  // that marker, a buffer that may have been trimmed cannot prove the batch is
  // whole, so fall back to the snapshot. Unlike the clause SPAP-33 removed, this
  // only ADDS a gap at the one boundary version and never suppresses one.
  const uncertifiedBoundaryBatch =
    sinceSeq > 0 &&
    remote.oldestOpSyncVersion !== undefined &&
    remote.oldestOpSyncVersion === sinceSeq + 1 &&
    remote.oldestBatchComplete !== true &&
    isPossiblyTrimmed;

  // #9170: a tail op uploaded after a USE_LOCAL replacement can walk syncVersion
  // back up to (or past) our expected value and repopulate recentOps, masking
  // all three checks above. Every normal writer merges the file's clock before
  // uploading, so the remote clock only ever stays EQUAL to or dominates the one
  // we last saw. A replacement writes its own clock instead, so CONCURRENT or
  // LESS_THAN proves the remote no longer descends from our history. Our own
  // file is exempt, matching the snapshotReplacement check.
  const lineageBroken =
    sinceSeq > 0 &&
    clockVsLastSeen !== undefined &&
    clockVsLastSeen !== 'EQUAL' &&
    clockVsLastSeen !== 'GREATER_THAN' &&
    !(excludeClient !== undefined && remote.clientId === excludeClient);

  // A replacement can dominate our history too. Its base clock records the
  // full-state operation that cleared recentOps, so later tail uploads cannot
  // hide that unseen baseline, even after their reused versions are trimmed.
  // Normal appends preserve this clock; once applied, lastSeenClock covers it.
  // Before one is recorded, the local clock stands in (#10258).
  const unseenSnapshotBase =
    sinceSeq > 0 &&
    isSnapshotBaseUnseen(remote.snapshotBaseClock, lastSeenClock ?? localClock);

  const reason = versionWasReset
    ? `sync version reset (${previousExpectedVersion} → ${remote.syncVersion})`
    : snapshotReplacement
      ? `snapshot replacement (expected ops from seq ${sinceSeq}, but recentOps is empty)`
      : partialTrimGap
        ? `partial trimming (oldestOpSyncVersion=${remote.oldestOpSyncVersion}, ` +
          `sinceSeq=${sinceSeq}, recentOps=${remote.recentOps.length})`
        : uncertifiedBoundaryBatch
          ? `possibly partial oldest batch (oldestOpSyncVersion=${remote.oldestOpSyncVersion}, ` +
            `sinceSeq=${sinceSeq}, recentOps=${remote.recentOps.length}, uncertified)`
          : lineageBroken
            ? `lineage break (remote vector clock ${clockVsLastSeen} last-seen)`
            : unseenSnapshotBase
              ? 'snapshot replacement with an unseen causal base'
              : undefined;

  const ownUploadsMissing =
    sinceSeq === 0 &&
    hasSnapshot &&
    areOwnUploadsMissing(remote, excludeClient, lastSeenClock);

  return {
    needsGapDetection: reason !== undefined,
    reason,
    isCosmeticReset,
    ownUploadsMissing,
    snapshotExtendsLastSeen: doesRemoteExtendLastSeen(
      remote,
      lastSeenClock,
      previousExpectedVersion,
    ),
  };
};

/**
 * #10972: whether the remote only appended to the file this client last
 * committed, with no full-state replacement since. A seq-0 snapshot of such a
 * file is a catch-up past trimmed ops, so pending local ops can be kept on top
 * of it instead of asking the user to pick a side.
 *
 * Every normal writer merges the file clock and keeps syncVersion and the
 * snapshot base. A replacement writes a new base (v19.2.0+); older ones leave
 * none but reset syncVersion to 1. A legacy replacement whose tail uploads
 * climbed back past our expected version still passes: a documented residual.
 */
export const doesRemoteExtendLastSeen = (
  remote: Pick<GapDetectionRemote, 'syncVersion' | 'vectorClock' | 'snapshotBaseClock'>,
  lastSeenClock: VectorClock | undefined,
  previousExpectedVersion: number,
): boolean => {
  if (!lastSeenClock || previousExpectedVersion <= 0) return false;
  if (remote.syncVersion < previousExpectedVersion) return false;
  if (!remote.snapshotBaseClock && remote.syncVersion === 1) return false;
  if (isSnapshotBaseUnseen(remote.snapshotBaseClock, lastSeenClock)) return false;
  const comparison = compareVectorClocks(remote.vectorClock, lastSeenClock);
  return comparison === 'GREATER_THAN' || comparison === 'EQUAL';
};

/** The gap verdicts a file download response forwards to the caller. */
export const toSnapshotGapFlags = (
  gap: GapDetectionResult,
): Pick<GapDetectionResult, 'ownUploadsMissing' | 'snapshotExtendsLastSeen'> => ({
  ownUploadsMissing: gap.ownUploadsMissing,
  snapshotExtendsLastSeen: gap.snapshotExtendsLastSeen,
});

/**
 * #10973: single-file writers trim to exactly MAX_RECENT_OPS, so a shorter
 * buffer was never trimmed by a writer at the current cap.
 */
export const isSingleFileBufferPossiblyTrimmed = (remote: {
  recentOps: readonly unknown[];
}): boolean => remote.recentOps.length >= FILE_BASED_SYNC_CONSTANTS.MAX_RECENT_OPS;

/**
 * #10973: split writers trim only while compacting, and the snapshot written by
 * that compaction carries its syncVersion. Batches newer than the snapshot were
 * appended afterwards and never cut, so only an oldest batch at or below the
 * snapshot can be partial.
 */
export const isSplitBufferPossiblyTrimmed = (remote: {
  oldestOpSyncVersion?: number;
  snapshotRef: { syncVersion: number };
}): boolean =>
  remote.oldestOpSyncVersion !== undefined &&
  remote.oldestOpSyncVersion <= remote.snapshotRef.syncVersion;

/** The retained-ops fields of a sync/ops file envelope. */
export interface RecentOpsFields<T extends { sv?: number }> {
  recentOps: T[];
  /** Ops without sv (old sync files) yield undefined: gap checks stay off. */
  oldestOpSyncVersion?: number;
  oldestBatchComplete?: true;
}

/**
 * #10973: appends a batch to the previous file's retained ops and trims the
 * buffer to at most `maxOps`, cutting only at a batch (`sv`) boundary. A cut
 * inside a batch would leave its tail looking contiguous to a client whose
 * cursor sits right before it (see detectDownloadGap). Dropping the rest of
 * that batch instead makes such a client see
 * `oldestOpSyncVersion > sinceSeq + 1`, which every released reader already
 * treats as a gap. A newest batch larger than `maxOps` is kept whole (the buffer
 * then exceeds the cap until the next upload drops it): an empty buffer would
 * read as a snapshot replacement on every later download, and released readers
 * already return an over-cap buffer whole.
 *
 * `oldestBatchComplete` is set when the result provably starts at the start of
 * its oldest batch: this write cut at a boundary, the buffer was empty before,
 * or the previous writer already certified it.
 */
export const appendRecentOpsAtBatchBoundary = <T extends { sv?: number }>(
  previous:
    | { recentOps?: readonly T[]; oldestBatchComplete?: boolean }
    | null
    | undefined,
  newOps: readonly T[],
  maxOps: number,
): { fields: RecentOpsFields<T>; trimmedCount: number } => {
  const existingOps = previous?.recentOps ?? [];
  const combinedOps = [...existingOps, ...newOps];
  let start = Math.max(0, combinedOps.length - maxOps);
  if (start > 0) {
    const cutSyncVersion = combinedOps[start - 1].sv;
    while (start < combinedOps.length && combinedOps[start].sv === cutSyncVersion) {
      start++;
    }
    // The cut fell inside the newest batch: keep that batch whole instead.
    if (start === combinedOps.length) {
      start--;
      while (start > 0 && combinedOps[start - 1].sv === combinedOps[start].sv) {
        start--;
      }
    }
  }
  const recentOps = combinedOps.slice(start);
  const isComplete =
    start > 0 || existingOps.length === 0 || previous?.oldestBatchComplete === true;
  return {
    fields: {
      recentOps,
      oldestOpSyncVersion: recentOps[0]?.sv,
      ...(isComplete ? { oldestBatchComplete: true as const } : {}),
    },
    trimmedCount: start,
  };
};
