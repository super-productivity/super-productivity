import { inject, Injectable } from '@angular/core';
import {
  adjustForClockCorruption as adjustForClockCorruptionCore,
  buildEntityFrontier,
  isIdenticalConflict as isIdenticalConflictCore,
  suggestConflictResolution,
} from '@sp/sync-core';
import {
  ActionType,
  EntityConflict,
  Operation,
  OpType,
  VectorClock,
} from '../core/operation.types';
import { OpLog } from '../../core/log';
import { toEntityKey } from '../util/entity-key.util';
import { getOpEntityIds } from '../util/get-op-entity-ids.util';
import { compareVectorClocks, VectorClockComparison } from '../../core/util/vector-clock';
import { devError } from '../../util/dev-error';
import { SYNC_LOGGER } from '../core/sync-logger.adapter';
import {
  isCommutingTimeDeltaCrossing,
  isDisjointMergeEligible,
  isNoiseOnlySide,
} from './conflict-disjoint-merge.util';
import { nonCommutingPendingOps } from './reorder-conflict.util';
import { ConflictEntityStateService } from './conflict-entity-state.service';

/**
 * Detects conflicts between remote ops and local pending ops via vector clocks.
 * Split out of `ConflictResolutionService`, which orchestrates the resolution.
 */
@Injectable({
  providedIn: 'root',
})
export class ConflictDetectionService {
  private syncLogger = inject(SYNC_LOGGER);
  private entityState = inject(ConflictEntityStateService);

  /**
   * Check if a conflict has identical effects on both sides.
   *
   * Identical conflicts occur when both local and remote operations would result
   * in the same final state. These can be auto-resolved without user intervention.
   *
   * ## Identical Conflict Scenarios:
   * 1. **Both DELETE**: Both sides deleted the same entity
   * 2. **Same UPDATE payloads**: Both sides made identical changes
   *
   * @param conflict - The conflict to check
   * @returns true if the conflict has identical effects and can be auto-resolved
   */
  isIdenticalConflict(conflict: EntityConflict): boolean {
    return isIdenticalConflictCore(conflict, this.syncLogger);
  }

  /**
   * Checks a remote operation for conflicts with local pending operations.
   *
   * @param remoteOp - The remote operation to check
   * @param ctx - Context containing local state for conflict detection
   * @returns Object indicating if op is superseded/duplicate and every detected conflict
   */
  async checkOpForConflicts(
    remoteOp: Operation,
    ctx: {
      localPendingOpsByEntity: Map<string, Operation[]>;
      appliedFrontierByEntity: Map<string, VectorClock>;
      retainedOpsByEntity: Map<string, Operation[]>;
      snapshotVectorClock: VectorClock | undefined;
      snapshotEntityKeys: Set<string> | undefined;
      hasNoSnapshotClock: boolean;
    },
  ): Promise<{ isSupersededOrDuplicate: boolean; conflicts: EntityConflict[] }> {
    const entityIdsToCheck = getOpEntityIds(remoteOp);
    const conflicts: EntityConflict[] = [];

    for (const entityId of entityIdsToCheck) {
      const entityKey = toEntityKey(remoteOp.entityType, entityId);
      const localOpsForEntity = ctx.localPendingOpsByEntity.get(entityKey) || [];

      const result = await this._checkEntityForConflict(remoteOp, entityId, entityKey, {
        localOpsForEntity,
        appliedFrontier: ctx.appliedFrontierByEntity.get(entityKey),
        retainedOpsForEntity: ctx.retainedOpsByEntity.get(entityKey) ?? [],
        snapshotVectorClock: ctx.snapshotVectorClock,
        snapshotEntityKeys: ctx.snapshotEntityKeys,
        hasNoSnapshotClock: ctx.hasNoSnapshotClock,
      });

      if (result.isSupersededOrDuplicate) {
        // Operations are atomic. If any affected entity already supersedes this
        // operation, do not partially apply it or resolve a subset of its scope.
        return { isSupersededOrDuplicate: true, conflicts: [] };
      }
      if (result.conflict) {
        conflicts.push(result.conflict);
      }
    }

    return { isSupersededOrDuplicate: false, conflicts };
  }

  /**
   * Checks a single entity for conflict with a remote operation.
   */
  private async _checkEntityForConflict(
    remoteOp: Operation,
    entityId: string,
    entityKey: string,
    ctx: {
      localOpsForEntity: Operation[];
      appliedFrontier: VectorClock | undefined;
      retainedOpsForEntity: Operation[];
      snapshotVectorClock: VectorClock | undefined;
      snapshotEntityKeys: Set<string> | undefined;
      hasNoSnapshotClock: boolean;
    },
  ): Promise<{ isSupersededOrDuplicate: boolean; conflict: EntityConflict | null }> {
    const localFrontier = this._buildEntityFrontier(entityKey, ctx);
    const localFrontierIsEmpty = Object.keys(localFrontier).length === 0;

    // FAST PATH: No local state means remote is newer by default
    if (ctx.localOpsForEntity.length === 0 && localFrontierIsEmpty) {
      return { isSupersededOrDuplicate: false, conflict: null };
    }

    const rawComparison = compareVectorClocks(localFrontier, remoteOp.vectorClock);

    // Handle potential per-entity clock corruption
    const vcComparison = this._adjustForClockCorruption(rawComparison, entityKey, {
      localOpsForEntity: ctx.localOpsForEntity,
      hasNoSnapshotClock: ctx.hasNoSnapshotClock,
      localFrontierIsEmpty,
    });

    // Skip superseded operations (local already has newer state)
    if (vcComparison === VectorClockComparison.GREATER_THAN) {
      OpLog.verbose(
        `ConflictResolutionService: Skipping superseded remote op (local dominates): ${remoteOp.id}`,
      );
      return { isSupersededOrDuplicate: true, conflict: null };
    }

    // Skip duplicate operations (already applied)
    if (vcComparison === VectorClockComparison.EQUAL) {
      OpLog.verbose(
        `ConflictResolutionService: Skipping duplicate remote op: ${remoteOp.id}`,
      );
      return { isSupersededOrDuplicate: true, conflict: null };
    }

    // No pending local ops
    if (ctx.localOpsForEntity.length === 0) {
      if (vcComparison === VectorClockComparison.CONCURRENT) {
        // CONCURRENT + no pending ops = entity may have been archived/deleted
        // by an already-synced operation. Check current state.
        const entityState = await this.entityState.getCurrentEntityState(
          remoteOp.entityType,
          entityId,
        );
        if (entityState === undefined || entityState === null) {
          OpLog.normal(
            `ConflictResolutionService: Skipping CONCURRENT remote op ${remoteOp.id} ` +
              `for ${remoteOp.entityType}:${entityId} - entity no longer in state ` +
              `(archive/delete wins over concurrent update)`,
          );
          return { isSupersededOrDuplicate: true, conflict: null };
        }
        // #9073: the entity still exists, so a blind apply would let ARRIVAL
        // ORDER decide the winner — two clients that each already synced one
        // side of the crossing would keep the other's value and permanently
        // diverge. Reconstruct the local side from the retained (already
        // applied) concurrent ops and route it through the normal LWW
        // pipeline, which resolves the same unordered op pair identically on
        // every client. Crossings that commute (identical, disjoint real
        // fields, noise-only, task-time deltas) keep today's lossless apply.
        const crossingConflict = this._buildNoPendingConcurrentConflict(
          remoteOp,
          entityId,
          ctx.retainedOpsForEntity,
        );
        if (crossingConflict) {
          return { isSupersededOrDuplicate: false, conflict: crossingConflict };
        }
      }
      return { isSupersededOrDuplicate: false, conflict: null };
    }

    if (vcComparison === VectorClockComparison.CONCURRENT) {
      // Preserve commuting intents. A pending reorder is then reissued from
      // current state (#10377); it stays out of a conflict over the entity's
      // other pending ops and keeps its list write (#10420).
      const localOps = nonCommutingPendingOps(remoteOp, ctx.localOpsForEntity);
      if (localOps.length === 0) {
        return { isSupersededOrDuplicate: false, conflict: null };
      }

      // Task-time sync operations are positive deltas: they commute with each
      // other and with edits of other fields, but cannot be merged into a patch,
      // so entity-level LWW would discard one side's time or edit (#10214).
      const payloadKey = this.entityState._resolvePayloadKey(remoteOp.entityType);
      const sides = { localOps, remoteOps: [remoteOp] };
      if (isCommutingTimeDeltaCrossing({ ...sides, payloadKey, entityId })) {
        return { isSupersededOrDuplicate: false, conflict: null };
      }

      const conflict: EntityConflict = {
        entityType: remoteOp.entityType,
        entityId,
        ...sides,
        suggestedResolution: this._suggestResolution(localOps, [remoteOp]),
      };
      return { isSupersededOrDuplicate: false, conflict };
    }

    return { isSupersededOrDuplicate: false, conflict: null };
  }

  /**
   * #9073: builds a synthetic conflict for a CONCURRENT remote op on an entity
   * that still exists and has NO pending local ops. The local side is every
   * retained op still concurrent with the incoming clock — the whole crossing,
   * not just the frontier op, so a newer disjoint edit cannot mask an older
   * overlapping one. Both clients reconstruct the same unordered pair, so the
   * LWW plan (timestamps, then clientId) picks the same winner everywhere; a
   * local win emits the usual dominating LWW Update op that heals clients
   * whose frontier could not see the crossing (e.g. snapshot-clock frontiers).
   *
   * Returns null for crossings where applying the op as-is stays correct:
   *  - commuting pairs (identical content, disjoint real fields, noise-only
   *    sides, concurrent task-time deltas) — apply-both is lossless AND
   *    convergent, whole-entity LWW would discard one side;
   *  - cases with no deterministic local side (retained ops compacted away)
   *    or that would need the pending path's rejection/compensation machinery
   *    (multi-entity ops, local Delete/archive against a live entity) — these
   *    keep today's arrival-order behavior as a documented residual.
   */
  private _buildNoPendingConcurrentConflict(
    remoteOp: Operation,
    entityId: string,
    retainedOpsForEntity: Operation[],
  ): EntityConflict | null {
    // Resolving one entity of an atomic multi-entity op would drop its
    // sibling changes without the pending path's compensation machinery.
    if (getOpEntityIds(remoteOp).length > 1) {
      return null;
    }

    const localOps = retainedOpsForEntity.filter(
      (op) =>
        compareVectorClocks(op.vectorClock, remoteOp.vectorClock) ===
        VectorClockComparison.CONCURRENT,
    );
    // Empty = the CONCURRENT verdict came from the snapshot clock alone (the
    // concurrent local history was compacted away) — no local side to compare.
    if (localOps.length === 0) {
      return null;
    }

    // A local Delete/archive op with the entity still in state is a
    // contradictory edge (also covers the plan's delete-win/archive-win
    // kinds); multi-entity local ops would mint per-entity against an atomic
    // op. Both keep the status quo.
    if (
      localOps.some(
        (op) =>
          op.opType === OpType.Delete ||
          op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE ||
          getOpEntityIds(op).length > 1,
      )
    ) {
      return null;
    }

    const conflict: EntityConflict = {
      entityType: remoteOp.entityType,
      entityId,
      localOps,
      remoteOps: [remoteOp],
      suggestedResolution: this._suggestResolution(localOps, [remoteOp]),
    };

    // Same content on both sides: applying is equivalent either way. This also
    // damps echo rounds when several holders of the winner mint
    // identical-content resolution ops that later cross each other.
    if (this.isIdenticalConflict(conflict)) {
      return null;
    }

    const payloadKey = this.entityState._resolvePayloadKey(remoteOp.entityType);
    // A side that changed nothing real: apply-both already converges on every
    // real field; only noise-field arrival divergence remains (status quo,
    // cosmetic). Whole-entity LWW could instead clobber the real side.
    if (
      isNoiseOnlySide(localOps, payloadKey, entityId) ||
      isNoiseOnlySide([remoteOp], payloadKey, entityId)
    ) {
      return null;
    }

    // Disjoint real-field updates commute — apply-both is lossless and
    // convergent, while a whole-entity LWW winner would discard the loser's
    // fields fleet-wide. An overlapping crossing is forwarded: the device
    // whose side wins resolves it with a field patch (`_tryCreateFieldPatch`).
    // Time deltas commute as on the pending path, also beside the auto-plan
    // that tracking an unscheduled task emits: a local win here would emit a
    // snapshot whose clock claims the remote delta without its time.
    const sides = { localOps, remoteOps: [remoteOp], payloadKey, entityId };
    if (isDisjointMergeEligible(sides) || isCommutingTimeDeltaCrossing(sides)) {
      return null;
    }

    OpLog.normal(
      `ConflictResolutionService: No-pending CONCURRENT crossing for ` +
        `${remoteOp.entityType}:${entityId} (${localOps.length} retained local op(s) ` +
        `vs remote op ${remoteOp.id}) — routing through LWW (#9073)`,
    );
    return conflict;
  }

  /**
   * Builds the local frontier vector clock for an entity.
   * Merges applied frontier + pending ops clocks.
   */
  private _buildEntityFrontier(
    entityKey: string,
    ctx: {
      localOpsForEntity: Operation[];
      appliedFrontier: VectorClock | undefined;
      snapshotVectorClock: VectorClock | undefined;
      snapshotEntityKeys: Set<string> | undefined;
    },
  ): VectorClock {
    return buildEntityFrontier(entityKey, ctx);
  }

  /**
   * Adjusts comparison result for potential per-entity clock corruption.
   * Converts LESS_THAN or GREATER_THAN to CONCURRENT if corruption is suspected.
   *
   * ## Corruption Detection
   * Potential corruption is detected when:
   * - Entity has pending local ops (we made changes)
   * - But has no snapshot clock AND empty local frontier
   * - This suggests the clock data was lost/corrupted
   *
   * ## Safety Behavior
   * When corruption is suspected:
   * - LESS_THAN → CONCURRENT: Prevents incorrectly skipping local ops
   * - GREATER_THAN → CONCURRENT: Prevents incorrectly skipping remote ops
   *
   * Converting to CONCURRENT forces conflict resolution, which is safer than
   * silently skipping either local or remote operations.
   */
  private _adjustForClockCorruption(
    comparison: VectorClockComparison,
    entityKey: string,
    ctx: {
      localOpsForEntity: Operation[];
      hasNoSnapshotClock: boolean;
      localFrontierIsEmpty: boolean;
    },
  ): VectorClockComparison {
    return adjustForClockCorruptionCore({
      comparison,
      entityKey,
      pendingOpsCount: ctx.localOpsForEntity.length,
      hasNoSnapshotClock: ctx.hasNoSnapshotClock,
      localFrontierIsEmpty: ctx.localFrontierIsEmpty,
      logger: this.syncLogger,
      onPotentialCorruption: devError,
    }) as VectorClockComparison;
  }

  /**
   * Suggests a conflict resolution based on heuristics.
   *
   * ## Heuristics (in priority order)
   * 1. **Large time gap (>1 hour)**: Newer wins - user likely made sequential changes
   * 2. **Delete vs Update**: Update wins - preserve data over deletion
   * 3. **Create vs other**: Create wins - entity creation is more significant
   * 4. **Default**: Manual - let user decide
   *
   * @returns 'local' | 'remote' | 'manual' suggestion for the conflict dialog
   */
  private _suggestResolution(
    localOps: Operation[],
    remoteOps: Operation[],
  ): 'local' | 'remote' | 'manual' {
    return suggestConflictResolution(localOps, remoteOps);
  }
}
