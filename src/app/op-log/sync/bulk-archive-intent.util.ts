import type { LwwConflictResolutionPlan, LwwResolvedConflict } from '@sp/sync-core';
import {
  ActionType,
  EntityConflict,
  Operation,
  VectorClock,
} from '../core/operation.types';
import {
  getBulkArchiveTopLevelIds,
  getOpEntityIds,
} from '../util/get-op-entity-ids.util';
import { incrementVectorClock, mergeVectorClocks } from '../../core/util/vector-clock';
import { uuidv7 } from '../../util/uuid-v7';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';
import { scopeBulkArchivePayload } from './scope-bulk-archive-payload.util';

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

export interface ArchiveResolutionGroup {
  archiveOp: Operation;
  resolutions: LwwResolvedConflict<Operation, EntityConflict>[];
  /** Entities whose row a remote archive won. */
  remoteWinnerIds: Set<string>;
}

/**
 * Groups resolved rows by the `moveToArchive` intents among their local ops,
 * for the partial-archive preserve step (#9537). Single-task archives join
 * too, so a restore after a one-task Finish Day is kept (#10220) — except
 * when a remote archive won ANY of their rows (the task or one of its
 * subtasks): such groups keep their pre-#10220 per-row handling. A remote
 * archive of the task covers its subtasks, leaving nothing to narrow; one of
 * a subtask alone has no observed instance, so it is not special-cased.
 */
export const groupArchiveResolutionsByIntent = (
  resolutions: readonly LwwResolvedConflict<Operation, EntityConflict>[],
): Map<string, ArchiveResolutionGroup> => {
  const groups = new Map<string, ArchiveResolutionGroup>();
  for (const resolution of resolutions) {
    for (const localOp of resolution.conflict.localOps) {
      if (
        localOp.actionType !== ActionType.TASK_SHARED_MOVE_TO_ARCHIVE ||
        getBulkArchiveTopLevelIds(localOp).length === 0
      ) {
        continue;
      }
      const intentKey = getBulkArchiveIntentKey(localOp);
      const group = groups.get(intentKey) ?? {
        archiveOp: localOp,
        resolutions: [],
        remoteWinnerIds: new Set<string>(),
      };
      // A row holding several copies of one intent joins its group once.
      if (group.resolutions.at(-1) !== resolution) {
        group.resolutions.push(resolution);
      }
      if (resolution.winner === 'remote') {
        group.remoteWinnerIds.add(resolution.conflict.entityId);
      }
      groups.set(intentKey, group);
    }
  }
  for (const [intentKey, { archiveOp, remoteWinnerIds }] of groups) {
    if (remoteWinnerIds.size > 0 && getBulkArchiveTopLevelIds(archiveOp).length === 1) {
      groups.delete(intentKey);
    }
  }
  return groups;
};

/**
 * Every original row of a group is rejected, so a replacement's clock merges
 * every local and remote op of EVERY row, plus this client's increment — it
 * then dominates all of them, including any pre-#10102 duplicate copies
 * sitting in `localOps`.
 * No client-side pruning — server prunes AFTER conflict detection, BEFORE storage.
 */
const dominatingClock = (
  conflicts: readonly EntityConflict[],
  clientId: string,
): VectorClock =>
  incrementVectorClock(
    conflicts
      .flatMap(({ localOps, remoteOps }) => [...localOps, ...remoteOps])
      .reduce<VectorClock>((clock, op) => mergeVectorClocks(clock, op.vectorClock), {}),
    clientId,
  );

/** Builds the full-set replacement archive op for one archive-win group. */
export const buildArchiveWinOp = (
  { archiveOp, conflicts }: ArchiveWinGroup,
  clientId: string,
): Operation => {
  return {
    id: uuidv7(),
    actionType: archiveOp.actionType,
    opType: archiveOp.opType,
    entityType: archiveOp.entityType,
    entityId: archiveOp.entityId,
    entityIds: archiveOp.entityIds,
    payload: archiveOp.payload,
    clientId,
    vectorClock: dominatingClock(conflicts, clientId),
    timestamp: archiveOp.timestamp,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
};

/**
 * Builds the replacement for a bulk archive narrowed to `retainedEntityIds`
 * — the tasks no remote archive covered and no later local restore brought
 * back (#9537, #10220). Keeps the source op's timestamp and envelope fields.
 * `conflicts` holds every row of the intent, including remote-won ones.
 */
export const buildScopedArchiveReplacementOp = (
  { archiveOp, conflicts }: ArchiveWinGroup,
  retainedEntityIds: string[],
  clientId: string,
): Operation => {
  const { payload, entityIds } = scopeBulkArchivePayload(archiveOp, retainedEntityIds);
  return {
    ...archiveOp,
    id: uuidv7(),
    entityId: entityIds[0],
    entityIds,
    payload,
    clientId,
    vectorClock: dominatingClock(conflicts, clientId),
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
};
