import { VectorClock } from '../../core/operation.types';
import { compareVectorClocks } from '../../../core/util/vector-clock';

/** The fields of a downloaded sync/ops file that gap detection reads. */
export interface GapDetectionRemote {
  syncVersion: number;
  vectorClock: VectorClock;
  snapshotBaseClock?: VectorClock;
  clientId: string;
  recentOps: readonly unknown[];
  oldestOpSyncVersion?: number;
}

export interface GapDetectionInput {
  remote: GapDetectionRemote;
  sinceSeq: number;
  excludeClient: string | undefined;
  /** Committed expected syncVersion for this provider (0 = none). */
  previousExpectedVersion: number;
  lastSeenClock: VectorClock | undefined;
  /**
   * Whether the file carries a snapshot an empty buffer could stand for. The
   * single-file format requires `state`; a split ops file always references one.
   */
  hasSnapshot: boolean;
}

export interface GapDetectionResult {
  needsGapDetection: boolean;
  /** Log-only description of the first check that fired. */
  reason?: string;
  /** The syncVersion regressed, but the causal state provably did not. */
  isCosmeticReset: boolean;
}

/**
 * Whether a remote replacement's base clock is not covered by the last file
 * clock this client committed, i.e. it has not hydrated that snapshot (#9170).
 * Without a recorded clock (first sync after upgrading) there is no baseline to
 * judge by: flagging would force a seq-0 download and, with pending local ops, a
 * conflict dialog. The resulting blind spot is tracked in #10258.
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
  hasSnapshot,
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
  const unseenSnapshotBase =
    sinceSeq > 0 && isSnapshotBaseUnseen(remote.snapshotBaseClock, lastSeenClock);

  const reason = versionWasReset
    ? `sync version reset (${previousExpectedVersion} → ${remote.syncVersion})`
    : snapshotReplacement
      ? `snapshot replacement (expected ops from seq ${sinceSeq}, but recentOps is empty)`
      : partialTrimGap
        ? `partial trimming (oldestOpSyncVersion=${remote.oldestOpSyncVersion}, ` +
          `sinceSeq=${sinceSeq}, recentOps=${remote.recentOps.length})`
        : lineageBroken
          ? `lineage break (remote vector clock ${clockVsLastSeen} last-seen)`
          : unseenSnapshotBase
            ? 'snapshot replacement with an unseen causal base'
            : undefined;

  return { needsGapDetection: reason !== undefined, reason, isCosmeticReset };
};
