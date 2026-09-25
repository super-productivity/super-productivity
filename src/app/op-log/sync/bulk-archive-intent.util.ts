import type { LwwConflictResolutionPlan } from '@sp/sync-core';
import {
  ActionType,
  EntityConflict,
  Operation,
  VectorClock,
} from '../core/operation.types';
import { getOpEntityIds } from '../util/get-op-entity-ids.util';
import { incrementVectorClock, mergeVectorClocks } from '../../core/util/vector-clock';
import { uuidv7 } from '../../util/uuid-v7';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';

/**
 * Identity of a `moveToArchive` INTENT, independent of op id, clock and client
 * (#10102). Archive-win recreations copy the source op's timestamp, footprint
 * and payload verbatim, so every copy of one intent shares this key. Clients
 * before #10102 emitted one identical recreation per local-win row; those
 * pending copies are one intent, not the archive → restore → re-archive
 * history the multi-archive fail-closed stop exists for — a re-archive is
 * captured later (different timestamp) and so keys differently.
 *
 * Strict by design: any payload difference, even key order, keeps two ops
 * distinct, which errs toward the existing fail-closed stop.
 */
export const getBulkArchiveIntentKey = (op: Operation): string =>
  JSON.stringify([
    op.actionType,
    op.timestamp,
    [...getOpEntityIds(op)].sort(),
    op.payload,
  ]);

export interface ArchiveWinGroup {
  /** The archive op the recreation copies (first seen for this intent). */
  archiveOp: Operation;
  /** Every conflict row this archive intent won; all feed the merged clock. */
  conflicts: EntityConflict[];
}

/**
 * Groups `archive-win` plans by archive intent so the host emits ONE
 * recreation per intent instead of one per row (#10102). A bulk archive that
 * beats concurrent edits on several of its tasks yields one conflict row per
 * task; per-row recreations left identical pending archive ops that wedged the
 * next conflicting sync on the multi-archive fail-closed stop. Keying by
 * intent (not op id) also folds such pre-fix copies back into one group.
 */
export const groupArchiveWinConflicts = (
  plans: readonly LwwConflictResolutionPlan<EntityConflict>[],
): ArchiveWinGroup[] => {
  const groups = new Map<string, ArchiveWinGroup>();
  for (const { conflict, localWinOperationKind } of plans) {
    if (localWinOperationKind !== 'archive-win') {
      continue;
    }
    // The planner only marks archive-win when the row has a local archive op.
    const archiveOp = conflict.localOps.find(
      (op) => op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
    )!;
    const key = getBulkArchiveIntentKey(archiveOp);
    const group = groups.get(key) ?? { archiveOp, conflicts: [] };
    group.conflicts.push(conflict);
    groups.set(key, group);
  }
  return [...groups.values()];
};

/**
 * Builds the replacement archive op for one archive-win group. Every original
 * row is rejected, so the clock merges every local and remote op of EVERY row
 * the intent won, plus this client's increment — it then dominates all of
 * them, including any pre-#10102 duplicate copies sitting in `localOps`.
 * No client-side pruning — server prunes AFTER conflict detection, BEFORE storage.
 */
export const buildArchiveWinOp = (
  { archiveOp, conflicts }: ArchiveWinGroup,
  clientId: string,
): Operation => {
  const mergedClock = conflicts
    .flatMap(({ localOps, remoteOps }) => [...localOps, ...remoteOps])
    .reduce<VectorClock>((clock, op) => mergeVectorClocks(clock, op.vectorClock), {});

  return {
    id: uuidv7(),
    actionType: archiveOp.actionType,
    opType: archiveOp.opType,
    entityType: archiveOp.entityType,
    entityId: archiveOp.entityId,
    entityIds: archiveOp.entityIds,
    payload: archiveOp.payload,
    clientId,
    vectorClock: incrementVectorClock(mergedClock, clientId),
    timestamp: archiveOp.timestamp,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
};
