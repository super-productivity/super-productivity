import { VectorClock } from '../../core/operation.types';
import { compareVectorClocks } from '../../../core/util/vector-clock';

/**
 * #9170: detects a snapshot replacement (USE_LOCAL) that a subsequent tail
 * op has masked from the syncVersion/recentOps-based heuristics in
 * `_downloadOps`/`_downloadOpsSplit`.
 *
 * A normal incremental upload always downloads first and merges, so the
 * remote vector clock only ever progresses forward relative to what this
 * client last saw: it stays EQUAL (no-op re-read) or becomes GREATER_THAN
 * (the writer's clock now dominates ours). USE_LOCAL instead REPLACES the
 * remote clock outright, so once a tail op re-advances syncVersion back to
 * (or past) the reader's expected value and repopulates recentOps, the
 * three syncVersion/recentOps-only checks can all read as "in sync" even
 * though the remote lineage no longer contains this client's history. A
 * remote clock that is CONCURRENT with or LESS_THAN the last-seen clock is
 * exactly that discontinuity, so treat it as a gap requiring a seq-0
 * resync to rehydrate the replacement snapshot.
 *
 * Skipped when `syncClientId` is this client's own excluded id: a self
 * up/download always carries forward the exact clock this client just
 * wrote, so it can never regress causally and is not a replacement.
 */
export const isLineageBroken = (
  sinceSeq: number,
  remoteVectorClock: VectorClock,
  lastSeenClock: VectorClock | undefined,
  syncClientId: string,
  excludeClient: string | undefined,
): boolean => {
  if (sinceSeq <= 0 || !lastSeenClock) return false;
  if (excludeClient !== undefined && syncClientId === excludeClient) return false;
  const comparison = compareVectorClocks(remoteVectorClock, lastSeenClock);
  return comparison !== 'GREATER_THAN' && comparison !== 'EQUAL';
};
