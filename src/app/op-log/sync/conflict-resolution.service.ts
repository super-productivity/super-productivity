import { inject, Injectable, Injector } from '@angular/core';
import { partitionLwwResolutions } from '@sp/sync-core';
import {
  ActionType,
  EntityConflict,
  EntityType,
  Operation,
  isLwwUpdatePayload,
  OpType,
  VectorClock,
} from '../core/operation.types';
import { collectDeletedTaskIds } from './collect-deleted-ids.util';
import { OperationApplierService } from '../apply/operation-applier.service';
import { HydrationStateService } from '../apply/hydration-state.service';
import {
  type MixedSourceWrittenOperation,
  OperationLogStoreService,
} from '../persistence/operation-log-store.service';
import { OpLog } from '../../core/log';
import { toEntityKey } from '../util/entity-key.util';
import { getOpEntityIds } from '../util/get-op-entity-ids.util';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { ValidateStateService } from '../validation/validate-state.service';
import { SyncSessionValidationService } from './sync-session-validation.service';
import { processDeferredActionsAfterRemoteApply } from './process-deferred-actions-flush.util';
import { IncompleteRemoteOperationsError } from '../core/errors/sync-errors';
import {
  buildTimeAwareResolutionBatches,
  remoteWinsInServerOrder,
} from './fold-sync-time-spent.util';
import {
  keptLocalTimeDeltas,
  rebaseKeptTimeDeltas,
  timeDeltasSurvivingLww,
  timeDeltasSurvivingRemoteWins,
} from './conflict-field-patch.util';
import { keptCommutingReorders, rebaseKeptReorders } from './reorder-conflict.util';
import {
  collectMultiEntityRemoteOpWinners,
  selectTaskReplacementCompensations,
} from './lww-compensation-selection.util';
import { ConflictResolutionPlannerService } from './conflict-resolution-planner.service';
import { ConflictBulkPreservationService } from './conflict-bulk-preservation.service';
import { ConflictEntityStateService } from './conflict-entity-state.service';
import { ConflictRecreationOpsService } from './conflict-recreation-ops.service';
import { ConflictLocalWinOpsService } from './conflict-local-win-ops.service';
import { ConflictResolutionNotifierService } from './conflict-resolution-notifier.service';
import { ConflictDetectionService } from './conflict-detection.service';
import { createLWWUpdateOp, mergeAndIncrementClocks } from './lww-update-op.util';
import {
  MergedResolution,
  markLwwDeleteRecreation,
  isResolvableTodayListAction,
} from './conflict-resolution.util';

interface AutoResolveConflictsLwwOptions {
  rebaseKeptTimeDeltas?: boolean;
  assertFence?: (context: string) => void;
  callerHoldsOperationLogLock?: boolean;
  disableDisjointMerge?: boolean;
  remoteApplyLifecycleOwnedByCaller?: boolean;
}

/**
 * Handles sync conflicts using Last-Write-Wins (LWW) automatic resolution.
 *
 * ## Overview
 * When syncing detects that both local and remote clients modified the same entity,
 * this service automatically resolves conflicts using LWW timestamp comparison.
 * No user interaction required - conflicts are resolved silently with a notification.
 *
 * ## LWW Resolution Flow
 * 1. Compare timestamps of conflicting operations
 * 2. The side with the newer timestamp wins
 * 3. When timestamps are equal, remote wins (server-authoritative)
 * 4. If local wins, create a new update op to sync local state to server
 * 5. Apply all chosen ops in a single batch (for dependency sorting)
 * 6. Validate and repair state (Checkpoint D)
 *
 * ## Safety Features
 * - **Duplicate detection**: Skips ops already in the store
 * - **Crash safety**: Persists pending replacements before applying and rejects
 *   originals only after the chosen reducer/archive work succeeds
 * - **Superseded op rejection**: When remote wins, rejects ALL pending ops for affected entities
 *   (prevents uploading ops with outdated vector clocks)
 * - **Batch application**: All ops applied together for correct dependency sorting
 * - **Post-resolution validation**: Runs state validation and repair after resolution
 */
@Injectable({
  providedIn: 'root',
})
export class ConflictResolutionService {
  private operationApplier = inject(OperationApplierService);
  private hydrationState = inject(HydrationStateService);
  private opLogStore = inject(OperationLogStoreService);
  private snackService = inject(SnackService);
  private validateStateService = inject(ValidateStateService);
  private sessionValidation = inject(SyncSessionValidationService);
  private injector = inject(Injector);
  private entityState = inject(ConflictEntityStateService);
  private conflictDetection = inject(ConflictDetectionService);
  private recreationOps = inject(ConflictRecreationOpsService);
  private localWinOps = inject(ConflictLocalWinOpsService);
  private bulkPreservation = inject(ConflictBulkPreservationService);
  private resolutionPlanner = inject(ConflictResolutionPlannerService);
  private resolutionNotifier = inject(ConflictResolutionNotifierService);

  /** Creates a synthetic LWW Update op. @see createLWWUpdateOp in lww-update-op.util */
  createLWWUpdateOp(
    ...args: Parameters<typeof createLWWUpdateOp>
  ): ReturnType<typeof createLWWUpdateOp> {
    return createLWWUpdateOp(...args);
  }

  /** @see mergeAndIncrementClocks in lww-update-op.util */
  mergeAndIncrementClocks(clocks: VectorClock[], clientId: string): VectorClock {
    return mergeAndIncrementClocks(clocks, clientId);
  }

  /** @see ConflictRecreationOpsService.createTaskRecreationFollowUpOps */
  createTaskRecreationFollowUpOps(
    ...args: Parameters<ConflictRecreationOpsService['createTaskRecreationFollowUpOps']>
  ): Promise<Operation[]> {
    return this.recreationOps.createTaskRecreationFollowUpOps(...args);
  }

  /** @see ConflictEntityStateService.getCurrentEntityState */
  getCurrentEntityState(entityType: EntityType, entityId: string): Promise<unknown> {
    return this.entityState.getCurrentEntityState(entityType, entityId);
  }

  /** @see ConflictDetectionService.checkOpForConflicts */
  checkOpForConflicts(
    ...args: Parameters<ConflictDetectionService['checkOpForConflicts']>
  ): ReturnType<ConflictDetectionService['checkOpForConflicts']> {
    return this.conflictDetection.checkOpForConflicts(...args);
  }

  /** @see ConflictDetectionService.isIdenticalConflict */
  isIdenticalConflict(conflict: EntityConflict): boolean {
    return this.conflictDetection.isIdenticalConflict(conflict);
  }

  /**
   * Validates the current state after conflict resolution and repairs if necessary.
   *
   * This is **Checkpoint D** in the validation architecture. It catches issues like:
   * - Tasks referencing deleted projects/tags
   * - Orphaned sub-tasks after parent deletion
   * - Inconsistent taskIds arrays in projects/tags
   *
   * Note: This is called from within the sp_op_log lock (via autoResolveConflictsLWW),
   * so we pass callerHoldsLock: true to prevent deadlock when creating repair operations.
   *
   * @see ValidateStateService for the full validation and repair logic
   */
  private async _validateAndRepairAfterResolution(): Promise<boolean> {
    return this.validateStateService.validateAndRepairCurrentState(
      'conflict-resolution',
      {
        callerHoldsLock: true,
      },
    );
  }

  /**
   * Automatically resolves conflicts using Last-Write-Wins (LWW) strategy.
   *
   * Local winners reject the obsolete sides and emit a merged-clock update.
   * Remote winners apply in the same batch as dependent non-conflicting ops.
   *
   * @param conflicts - Entity conflicts to auto-resolve
   * @param nonConflictingOps - Remote ops that don't conflict (batched for dependency sorting)
   * @param options - Lock context for deferred local actions flushed after
   *                  remote clocks and local-win ops are recorded.
   * @returns Promise resolving when all resolutions are applied
   */
  async autoResolveConflictsLWW(
    conflicts: EntityConflict[],
    nonConflictingOps: Operation[] = [],
    options: AutoResolveConflictsLwwOptions = {},
  ): Promise<{ localWinOpsCreated: number }> {
    if (conflicts.length === 0 && nonConflictingOps.length === 0) {
      return { localWinOpsCreated: 0 };
    }

    OpLog.normal(
      `ConflictResolutionService: Auto-resolving ${conflicts.length} conflict(s) using LWW`,
    );

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 1: Resolve each conflict using LWW
    // ─────────────────────────────────────────────────────────────────────────
    const {
      lwwResolutions: resolutions,
      mergedResolutions,
      localMultiReconciliationOps = [],
    } = await this.resolutionPlanner._resolveConflictsWithLWW(
      conflicts,
      options.disableDisjointMerge ?? false,
      nonConflictingOps,
    );
    const additionalLocalIntentOps = [
      ...(await this.bulkPreservation._preservePartiallyRejectedLocalBulkDeletes(
        resolutions,
      )),
      ...(await this.bulkPreservation._preservePartiallyRejectedLocalBulkPlanOps(
        resolutions,
      )),
      ...(await this.bulkPreservation._preservePartiallyRejectedLocalBulkArchives(
        resolutions,
      )),
    ];

    const allOpsToApply: Operation[] = [];
    const allStoredOps: Array<{ id: string; seq: number }> = [];
    // Durable seq of every op queued for live apply. Live apply order must
    // equal seq order — status-blind hydration replays by seq, and later steps
    // can reuse pending rows from a prior failed attempt whose seqs predate
    // rows appended fresh in this call.
    const applySeqByOpId = new Map<string, number>();
    // Synthetic local ops (disjoint merges) ride in the apply batch but are NOT
    // pending remote rows. Successful ones are excluded from the remote reducer
    // checkpoint; failed ones are quarantined before falling back to plain LWW.
    const checkpointExemptOpIds = new Set<string>();

    const lwwPartitions = partitionLwwResolutions<Operation, EntityConflict>(
      resolutions,
      {
        // Convert remote UPDATE operations to LWW Update format when entity was deleted locally.
        // This ensures lwwUpdateMetaReducer can recreate deleted entities (fixes DELETE vs UPDATE race).
        processRemoteWinnerOps: (conflict) =>
          this.entityState._convertToLWWUpdatesIfNeeded(conflict),
        toEntityKey: (entityType, entityId) =>
          toEntityKey(entityType as EntityType, entityId),
      },
    );

    const uniqueOpsById = (ops: Operation[]): Operation[] => [
      ...new Map(ops.map((op) => [op.id, op])).values(),
    ];
    // A field patch's remote side applies as itself, like a remote winner,
    // so it takes the same server order (#10423); its re-sends go last in the
    // same atomic batch (buildTimeAwareResolutionBatches).
    let remoteWinsOps = uniqueOpsById([
      ...lwwPartitions.remoteWinsOps,
      ...mergedResolutions.flatMap((merged) => merged.conflict.remoteOps),
    ]);
    let localWinsRemoteOps = uniqueOpsById(lwwPartitions.localWinsRemoteOps);
    let remoteOpsToReject = [...new Set(lwwPartitions.remoteOpsToReject)];
    const newLocalWinOps = uniqueOpsById([
      ...lwwPartitions.newLocalWinOps,
      ...additionalLocalIntentOps,
    ]);
    const { remoteWinnerAffectedEntityKeys } = lwwPartitions;
    // Keep deltas pending beside patched and time-preserving winners (#10378).
    const keptDeltas = keptLocalTimeDeltas([
      ...mergedResolutions.map((m) => m.conflict),
      ...timeDeltasSurvivingLww(resolutions, 'task', nonConflictingOps),
    ]);
    const localOpsToReject = [...new Set(lwwPartitions.localOpsToReject)].filter(
      (opId) => !keptDeltas.opIds.has(opId),
    );
    const localOpsToRejectSet = new Set(localOpsToReject);
    const protectedLocalResolutionOpIds = new Set<string>(keptDeltas.opIds);
    const pending = await this.opLogStore.getUnsyncedByEntity();
    const keptReorders = keptCommutingReorders(conflicts, pending, nonConflictingOps);
    let writtenLocalWinOps: Operation[] = [];
    const writtenMergedOpIds = new Set<string>();

    // A multi-entity action cannot be split when different entities pick
    // different winners. Persist/apply the original remote op once, then replay
    // local-win snapshots after it as compensations. The remote row stays pending
    // until reducer and archive application complete; status-blind hydration then
    // replays the same deterministic sequence after a crash.
    const multiEntityRemoteOpWinners = collectMultiEntityRemoteOpWinners(resolutions);
    const compensatedRemoteOps = new Map<string, Operation>();
    const compensationOpIdsToApply = new Set<string>();

    // A remote UPDATE that wins over a local DELETE needs a durable recreate
    // snapshot because the original update reducer cannot recreate a missing
    // entity. For multi-entity operations this snapshot must be applied after
    // the original atomic action, alongside any local-winner compensations.
    for (const resolution of resolutions) {
      if (
        resolution.winner !== 'remote' ||
        !resolution.conflict.localOps.some((op) => op.opType === OpType.Delete)
      ) {
        continue;
      }
      for (const remoteOp of resolution.conflict.remoteOps) {
        if (getOpEntityIds(remoteOp).length <= 1 || remoteOp.opType !== OpType.Update) {
          continue;
        }
        const recreationOp = await this.recreationOps._createRemoteWinRecreationOp(
          resolution.conflict,
          remoteOp,
        );
        if (recreationOp === undefined) {
          // No recreation available: the local DELETE carries no
          // reconstructable base entity (e.g. a legacy bulk deleteTasks op
          // stores only taskIds), or the winner is a multi-entity row that
          // `_convertToLWWUpdatesIfNeeded` refuses to rewrite (#9426). Degrade
          // like the single-entity path (onMissingBaseEntity) instead of
          // throwing: throwing here aborts autoResolveConflictsLWW without
          // advancing the cursor, so the same op re-downloads and wedges sync
          // forever. The entity stays locally deleted (a bounded divergence for
          // this one entity, logged below) while the rest of the batch resolves.
          OpLog.err(
            `ConflictResolutionService: Cannot recreate remote winner ${remoteOp.id} for ` +
              `${resolution.conflict.entityType}:${resolution.conflict.entityId} — no base ` +
              `entity or multi-entity conversion refused. Entity stays deleted on this client.`,
          );
          continue;
        }
        if (recreationOp === null) {
          continue;
        }
        newLocalWinOps.push(recreationOp);
        const winners = multiEntityRemoteOpWinners.get(remoteOp.id);
        winners?.remoteWinCompensationIds.add(recreationOp.id);
        const subtaskOps =
          await this.recreationOps._createSubtaskRecreationOpsFromLocalDelete(
            resolution.conflict,
            recreationOp,
          );
        for (const subtaskOp of subtaskOps) {
          newLocalWinOps.push(subtaskOp);
          winners?.remoteWinCompensationIds.add(subtaskOp.id);
        }
      }
    }

    // A single-entity winning update is converted directly into a remote LWW
    // recreate op. If the losing local bulk delete cascaded to children, replay
    // that remote op first and then recreate the snapshotted subtree.
    for (const resolution of resolutions) {
      if (
        resolution.winner !== 'remote' ||
        !resolution.conflict.localOps.some((op) => op.opType === OpType.Delete)
      ) {
        continue;
      }
      for (const remoteOp of resolution.conflict.remoteOps) {
        if (getOpEntityIds(remoteOp).length !== 1) {
          continue;
        }
        const convertedRemoteOp = remoteWinsOps.find((op) => op.id === remoteOp.id);
        if (
          !convertedRemoteOp ||
          !isLwwUpdatePayload(convertedRemoteOp.payload) ||
          convertedRemoteOp.payload.recreatesEntityAfterDelete !== true
        ) {
          continue;
        }
        const subtaskOps =
          await this.recreationOps._createSubtaskRecreationOpsFromLocalDelete(
            resolution.conflict,
            convertedRemoteOp,
          );
        if (subtaskOps.length === 0) {
          continue;
        }
        newLocalWinOps.push(...subtaskOps);
        subtaskOps.forEach((op) => compensationOpIdsToApply.add(op.id));
        compensatedRemoteOps.set(convertedRemoteOp.id, convertedRemoteOp);
        remoteWinsOps = remoteWinsOps.filter((op) => op.id !== convertedRemoteOp.id);
        localWinsRemoteOps = uniqueOpsById([...localWinsRemoteOps, convertedRemoteOp]);
      }
    }

    // A semantic remote TASK winner may not recreate an entity that the
    // earlier project-delete loser removes on a fresh replay. Re-emit the
    // remote result as a full local snapshot, then restore its dependents and
    // relationships. Persist/apply the original remote row first so live and
    // restart order match.
    for (const resolution of resolutions) {
      if (
        resolution.winner !== 'remote' ||
        !resolution.conflict.localOps.some(
          (op) =>
            isLwwUpdatePayload(op.payload) &&
            op.payload.recreatesEntityAfterDelete === true,
        )
      ) {
        continue;
      }
      for (const remoteOp of resolution.conflict.remoteOps) {
        const compensationOp =
          await this.recreationOps._createRemoteWinCompensationForRejectedTaskRecreation(
            resolution.conflict,
            remoteOp,
          );
        if (!compensationOp) continue;
        newLocalWinOps.push(compensationOp);
        compensationOpIdsToApply.add(compensationOp.id);
        const followUpOps = await this.recreationOps.createTaskRecreationFollowUpOps(
          compensationOp,
          {
            ensureRegularProjectMembership:
              remoteOp.actionType === ActionType.TASK_SHARED_MOVE_TO_PROJECT,
          },
        );
        for (const followUpOp of followUpOps) {
          newLocalWinOps.push(followUpOp);
          compensationOpIdsToApply.add(followUpOp.id);
        }
        compensatedRemoteOps.set(remoteOp.id, remoteOp);
        remoteWinsOps = remoteWinsOps.filter((op) => op.id !== remoteOp.id);
      }
    }

    for (const { remoteOp, localWinOpId } of selectTaskReplacementCompensations(
      resolutions,
    )) {
      compensatedRemoteOps.set(remoteOp.id, remoteOp);
      compensationOpIdsToApply.add(localWinOpId);
    }

    const newLocalWinOpsById = new Map(newLocalWinOps.map((op) => [op.id, op]));

    for (const winners of multiEntityRemoteOpWinners.values()) {
      const hasMixedWinners = winners.hasLocalWinner && winners.hasRemoteWinner;
      const needsRemoteRecreation = winners.remoteWinCompensationIds.size > 0;
      if (!hasMixedWinners && !needsRemoteRecreation) {
        continue;
      }
      const { op: remoteOp } = winners;
      const compensatedEntityKeys = new Set<string>();
      for (const localWinOpId of winners.localWinOpIds) {
        const localWinOp = newLocalWinOpsById.get(localWinOpId);
        if (!localWinOp) {
          continue;
        }
        for (const entityId of getOpEntityIds(localWinOp)) {
          compensatedEntityKeys.add(toEntityKey(localWinOp.entityType, entityId));
        }
      }
      const uncoveredLocalWinnerKeys = hasMixedWinners
        ? [...winners.localWinnerKeys].filter(
            (entityKey) => !compensatedEntityKeys.has(entityKey),
          )
        : [];
      if (uncoveredLocalWinnerKeys.length > 0) {
        if (!isResolvableTodayListAction(winners.op.actionType)) {
          throw new Error(
            `ConflictResolutionService: Cannot safely compensate mixed multi-entity winners for ${remoteOp.id}`,
          );
        }
        // #9426: for the resolvable Today-list bulk types, a local winner
        // without a covering snapshot means `_createLocalWinUpdateOp` found no
        // live entity (e.g. archived meanwhile) — and the Today-list replays
        // skip unknown task ids, so treating that entity as a plain remote win
        // cannot overwrite live local state. Degrade (log, drop the winner
        // key) instead of wedging the whole batch on the pre-#9426 throw, and
        // fall through: the compensated-remote-op flow below re-classifies the
        // row (partition booked it as a rejected loser) so its remote-win and
        // uncontested sibling entities still get it applied.
        OpLog.err(
          `ConflictResolutionService: ${uncoveredLocalWinnerKeys.length} local winner(s) of ` +
            `Today-list op ${remoteOp.id} have no compensation snapshot; applying as remote win.`,
        );
        for (const entityKey of uncoveredLocalWinnerKeys) {
          winners.localWinnerKeys.delete(entityKey);
        }
      }
      if (remoteOp.opType === OpType.Delete) {
        for (const localWinOpId of winners.localWinOpIds) {
          const localWinOpIndex = newLocalWinOps.findIndex(
            (op) => op.id === localWinOpId,
          );
          if (localWinOpIndex < 0) {
            continue;
          }
          const localWinOp = newLocalWinOps[localWinOpIndex];
          if (!isLwwUpdatePayload(localWinOp.payload)) {
            continue;
          }
          const markedCompensation = markLwwDeleteRecreation(localWinOp);
          newLocalWinOps[localWinOpIndex] = markedCompensation;
          newLocalWinOpsById.set(localWinOpId, markedCompensation);
          compensationOpIdsToApply.add(localWinOpId);

          // The applied remote bulk delete cascade-deletes the winning parent's
          // subtasks (handleDeleteTasks expands parent → subTaskIds), but only
          // the parent has a compensation op. Without recreating the subtasks
          // the parent resurfaces with its subtree silently lost on every
          // device (#8956). Emit recreate-after-delete snapshots for them too.
          const subtaskRecreationOps =
            await this.recreationOps._createSubtaskRecreationOpsForWinningParent(
              markedCompensation,
              remoteOp,
            );
          for (const subtaskOp of subtaskRecreationOps) {
            newLocalWinOps.push(subtaskOp);
            newLocalWinOpsById.set(subtaskOp.id, subtaskOp);
            compensationOpIdsToApply.add(subtaskOp.id);
          }
        }
      } else {
        for (const localWinOpId of winners.localWinOpIds) {
          compensationOpIdsToApply.add(localWinOpId);
        }
      }
      compensatedRemoteOps.set(remoteOp.id, remoteOp);
      for (const remoteWinCompensationId of winners.remoteWinCompensationIds) {
        compensationOpIdsToApply.add(remoteWinCompensationId);
      }
      remoteWinsOps = remoteWinsOps.filter((op) => op.id !== remoteOp.id);
      localWinsRemoteOps = uniqueOpsById([...localWinsRemoteOps, remoteOp]);

      for (const entityId of getOpEntityIds(remoteOp)) {
        remoteWinnerAffectedEntityKeys.add(toEntityKey(remoteOp.entityType, entityId));
      }
      if (hasMixedWinners) {
        for (const localWinnerKey of winners.localWinnerKeys) {
          remoteWinnerAffectedEntityKeys.delete(localWinnerKey);
        }
      }
    }

    const plannerCompensationOps =
      await this.localWinOps._createMixedRemoteTodayPlannerCompensationOps(
        [...multiEntityRemoteOpWinners.values()],
        newLocalWinOpsById,
      );
    for (const plannerCompensationOp of plannerCompensationOps) {
      newLocalWinOps.push(plannerCompensationOp);
      newLocalWinOpsById.set(plannerCompensationOp.id, plannerCompensationOp);
      compensationOpIdsToApply.add(plannerCompensationOp.id);
    }

    // A remote DELETE that loses outright — single-entity, or a bulk delete
    // whose conflicting entities all win locally with no uncontested sibling —
    // never enters the mixed-winner block above, yet its reducer cascade still
    // removes the winning entity's dependents wherever the delete IS applied:
    // on every client that already synced it, and on this client's own
    // status-blind hydration replay of the durable loser row. Only the winner
    // carries a compensation op, so emit recreate-after-delete snapshots for
    // its still-present cascade victims too: a TASK parent's subtasks (#8956)
    // and a PROJECT's active tasks (#8997). Archive ops are OpType.Update, so
    // archive precedence is untouched.
    //
    // Recovery reads task presence from the pre-batch store, so it is blind to
    // deletes applied elsewhere in this same batch. Exclude those task ids so
    // recovery does not resurrect a task another device is concurrently
    // deleting (#8997 review). Two sources apply here in the same batch:
    //   1. deletes piggybacked as non-conflicting ops, and
    //   2. deletes that won their own LWW conflict (a competing local edit
    //      lost) — invisible to the nonConflictingOps scan, but just as
    //      applied, so recovery must not fight a deletion that already won.
    const remoteDeleteWinnerOps = resolutions
      .filter((resolution) => resolution.winner === 'remote')
      .flatMap((resolution) => resolution.conflict.remoteOps)
      .filter((op) => op.opType === OpType.Delete);
    const concurrentlyDeletedTaskIds = collectDeletedTaskIds([
      ...nonConflictingOps,
      ...remoteDeleteWinnerOps,
    ]);
    for (const resolution of resolutions) {
      if (resolution.winner !== 'local' || !resolution.localWinOp) {
        continue;
      }
      const parentCompensationOp = newLocalWinOpsById.get(resolution.localWinOp.id);
      if (
        !parentCompensationOp ||
        !isLwwUpdatePayload(parentCompensationOp.payload) ||
        parentCompensationOp.payload.recreatesEntityAfterDelete !== true
      ) {
        continue;
      }
      for (const remoteOp of resolution.conflict.remoteOps) {
        if (remoteOp.opType !== OpType.Delete || compensatedRemoteOps.has(remoteOp.id)) {
          continue;
        }
        const cascadeRecreationOps = [
          ...(await this.recreationOps._createSubtaskRecreationOpsForWinningParent(
            parentCompensationOp,
            remoteOp,
          )),
          ...(await this.recreationOps._createTaskRecreationOpsForWinningProject(
            parentCompensationOp,
            remoteOp,
            concurrentlyDeletedTaskIds,
          )),
          // Emitted after the task recreations so sections referencing recreated
          // tasks land in seq order after them (#9037).
          ...(await this.recreationOps._createCascadeRecreationOpsForWinningProject(
            parentCompensationOp,
            remoteOp,
            {
              concurrentlyDeletedTaskIds,
              batchOps: [...nonConflictingOps, ...remoteDeleteWinnerOps],
            },
          )),
        ];
        // Not queued for live apply: the pure loser is never applied live, so
        // this client's state already holds the cascade victims. The rows
        // exist for upload and for seq-ordered replay after the durable loser.
        for (const recreationOp of cascadeRecreationOps) {
          newLocalWinOps.push(recreationOp);
          newLocalWinOpsById.set(recreationOp.id, recreationOp);
        }
      }
    }

    // A recovery TASK row can itself be rejected by a later per-task conflict.
    // Its replacement must re-emit any skipped subtasks and finish with the
    // current PROJECT membership, otherwise independent server acceptance can
    // lose parent/child links or append a backlog task to the regular list.
    for (const resolution of resolutions) {
      if (
        resolution.winner !== 'local' ||
        !resolution.localWinOp ||
        !resolution.conflict.localOps.some(
          (op) =>
            isLwwUpdatePayload(op.payload) &&
            op.payload.recreatesEntityAfterDelete === true,
        )
      ) {
        continue;
      }
      const replacementOp = newLocalWinOpsById.get(resolution.localWinOp.id);
      if (!replacementOp) continue;
      const followUpOps =
        await this.recreationOps.createTaskRecreationFollowUpOps(replacementOp);
      const shouldApply = compensationOpIdsToApply.has(replacementOp.id);
      for (const followUpOp of followUpOps) {
        newLocalWinOps.push(followUpOp);
        newLocalWinOpsById.set(followUpOp.id, followUpOp);
        if (shouldApply) compensationOpIdsToApply.add(followUpOp.id);
      }
    }

    for (const resolution of resolutions) {
      // Note: localWinOp is undefined for archive-wins sibling conflicts
      // (non-archive conflicts for an entity being archived). These resolve
      // as local-wins to prevent remote ops from resurrecting the entity,
      // but no new op is needed — the archive-win op from the sibling
      // conflict already covers the entity.
      if (resolution.winner === 'local' && resolution.localWinOp) {
        OpLog.warn(
          `ConflictResolutionService: LWW local wins - creating update op for ` +
            `${resolution.conflict.entityType}:${resolution.conflict.entityId}`,
        );
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Atomically persist remote losers, local-win compensations, and final
    // remote winners in live-apply order. Hydration is status-blind, so both
    // durable ordering and the absence of crash gaps are required here.
    // ─────────────────────────────────────────────────────────────────────────
    const resendOps = mergedResolutions.flatMap((merged) => merged.mergedOps);
    const resendIds = new Set(resendOps.map((op) => op.id));
    const hasLocalResolutionOps =
      newLocalWinOps.length > 0 ||
      localMultiReconciliationOps.length > 0 ||
      resendOps.length > 0;
    if (localWinsRemoteOps.length > 0 || hasLocalResolutionOps) {
      const compensatedRemoteOpIds = new Set(compensatedRemoteOps.keys());
      const unappliedRemoteLosers = localWinsRemoteOps.filter(
        (op) => !compensatedRemoteOpIds.has(op.id),
      );
      remoteOpsToReject = remoteOpsToReject.filter(
        (opId) => !compensatedRemoteOpIds.has(opId),
      );
      const { batches, precedingOps } = await buildTimeAwareResolutionBatches({
        unappliedRemoteLosers,
        compensatedRemoteOps: [...compensatedRemoteOps.values()],
        newLocalWinOps,
        remoteWinsOps,
        localMultiReconciliationOps,
        nonConflictingOps,
        resendOps,
        getTask: (id) => this.entityState.getCurrentEntityState('TASK', id),
      });
      const result = await this.opLogStore.appendMixedSourceBatchSkipDuplicates(batches);
      nonConflictingOps = nonConflictingOps.filter((op) => !precedingOps.includes(op));
      const writtenResends = result.written.filter(
        (entry) => entry.source === 'local' && resendIds.has(entry.op.id),
      );
      writtenLocalWinOps = result.written
        .filter((entry) => entry.source === 'local' && !resendIds.has(entry.op.id))
        .map((entry) => entry.op);
      writtenLocalWinOps.forEach((op) => protectedLocalResolutionOpIds.add(op.id));
      resendIds.forEach((id) => protectedLocalResolutionOpIds.add(id));
      if (result.skippedCount > 0) {
        OpLog.verbose(
          `ConflictResolutionService: Skipped ${result.skippedCount} duplicate resolution op(s)`,
        );
      }
      for (const op of writtenLocalWinOps) {
        OpLog.normal(
          `ConflictResolutionService: Appended local-win update op ${op.id} for ${op.entityType}:${op.entityId}`,
        );
      }

      const replayableRemoteEntries = await this._resolveReplayableOperations(
        [...compensatedRemoteOps.values(), ...precedingOps, ...remoteWinsOps],
        'remote',
        result.written,
      );
      const pendingCompensatedRemoteEntries = replayableRemoteEntries.filter((entry) =>
        compensatedRemoteOpIds.has(entry.op.id),
      );
      const pendingRemoteWinnerEntries = replayableRemoteEntries.filter(
        (entry) => !compensatedRemoteOpIds.has(entry.op.id),
      );
      const writtenCompensationEntries = result.written.filter(
        (entry) => entry.source === 'local' && compensationOpIdsToApply.has(entry.op.id),
      );
      for (const entry of writtenCompensationEntries) {
        checkpointExemptOpIds.add(entry.op.id);
      }

      // A skipped remote row may predate a newly written compensation. Replay
      // the combined set in durable sequence order so live state matches the
      // status-blind hydration order after a crash/restart.
      const resolutionApplyEntries: MixedSourceWrittenOperation[] = [
        ...pendingCompensatedRemoteEntries.map((entry) => ({
          ...entry,
          source: 'remote' as const,
        })),
        ...writtenCompensationEntries,
        ...pendingRemoteWinnerEntries.map((entry) => ({
          ...entry,
          source: 'remote' as const,
        })),
        ...writtenResends,
      ].sort((a, b) => a.seq - b.seq);
      for (const entry of resolutionApplyEntries) {
        allOpsToApply.push(entry.op);
        applySeqByOpId.set(entry.op.id, entry.seq);
        if (entry.source === 'remote' || resendIds.has(entry.op.id)) {
          allStoredOps.push({
            id: entry.op.id,
            seq: entry.seq,
          });
        }
      }
      // Apply/upload the WRITTEN re-sends: they carry the rebased clocks.
      for (const { op } of writtenResends) {
        checkpointExemptOpIds.add(op.id);
        writtenMergedOpIds.add(op.id);
        OpLog.normal(
          `ConflictResolutionService: Appended disjoint-merge op ${op.id} for ${op.entityType}:${op.entityId}`,
        );
      }
    } else if (remoteWinsOps.length > 0) {
      const ops = remoteWinsInServerOrder(nonConflictingOps, remoteWinsOps);
      const hoisted = new Set(ops);
      nonConflictingOps = nonConflictingOps.filter((op) => !hoisted.has(op));
      const result = await this._filterAndAppendOpsWithRetry(ops, 'remote', {
        pendingApply: true,
      });
      const skippedCount = ops.length - result.ops.length;
      if (skippedCount > 0) {
        OpLog.verbose(
          `ConflictResolutionService: Skipping ${skippedCount} duplicate ops (LWW remote)`,
        );
      }
      for (let i = 0; i < result.ops.length; i++) {
        allStoredOps.push({ id: result.ops[i].id, seq: result.seqs[i] });
        allOpsToApply.push(result.ops[i]);
        applySeqByOpId.set(result.ops[i].id, result.seqs[i]);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 2: Reject ALL pending ops for entities where remote won
    // ─────────────────────────────────────────────────────────────────────────
    if (localOpsToReject.length > 0) {
      const pendingByEntity = await this.opLogStore.getUnsyncedByEntity();
      for (const entityKey of remoteWinnerAffectedEntityKeys) {
        const pendingOps = pendingByEntity.get(entityKey) || [];
        for (const op of pendingOps) {
          if (
            !localOpsToRejectSet.has(op.id) &&
            !protectedLocalResolutionOpIds.has(op.id) &&
            !keptReorders.opIds.has(op.id)
          ) {
            localOpsToReject.push(op.id);
            localOpsToRejectSet.add(op.id);
            OpLog.normal(
              `ConflictResolutionService: Also rejecting superseded op ${op.id} for entity ${entityKey}`,
            );
          }
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 3: Add non-conflicting remote ops to the batch
    // Uses retry to handle race condition (issue #6213)
    // ─────────────────────────────────────────────────────────────────────────
    if (nonConflictingOps.length > 0) {
      const result = await this._filterAndAppendOpsWithRetry(
        nonConflictingOps,
        'remote',
        { pendingApply: true },
      );
      for (let i = 0; i < result.ops.length; i++) {
        allStoredOps.push({ id: result.ops[i].id, seq: result.seqs[i] });
        allOpsToApply.push(result.ops[i]);
        applySeqByOpId.set(result.ops[i].id, result.seqs[i]);
      }
    }

    // STEP 3b: durable field patches supersede the original local ops (#10422).
    for (const merged of mergedResolutions) {
      for (const op of merged.conflict.localOps) {
        if (!localOpsToRejectSet.has(op.id) && !keptDeltas.opIds.has(op.id)) {
          localOpsToReject.push(op.id);
          localOpsToRejectSet.add(op.id);
        }
      }
    }

    if (options.rebaseKeptTimeDeltas && keptDeltas.opIds.size > 0) {
      const rebased = new Map(
        (
          await rebaseKeptTimeDeltas(
            this.opLogStore,
            keptLocalTimeDeltas([
              ...mergedResolutions.map((m) => m.conflict),
              ...timeDeltasSurvivingRemoteWins(resolutions, 'task'),
            ]),
            [...writtenMergedOpIds],
            options.assertFence,
          )
        ).map((op) => [op.id, op]),
      );
      for (let i = 0; i < allOpsToApply.length; i++) {
        allOpsToApply[i] = rebased.get(allOpsToApply[i].id) ?? allOpsToApply[i];
      }
    }
    await rebaseKeptReorders(this.opLogStore, keptReorders, new Set(remoteOpsToReject));

    // Match status-blind hydration order, including reused pending remote rows.
    allOpsToApply.sort(
      (a, b) =>
        (applySeqByOpId.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (applySeqByOpId.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 4: Apply remote ops in a single batch.
    // Merge their clocks before entering the reducer/deferred-action window.
    // Pending rows make this durable frontier crash-safe, and any subsequent
    // dispatch/checkpoint/bookkeeping failure can drain buffered local actions.
    // (#7700)
    // ─────────────────────────────────────────────────────────────────────────
    let canDrainDeferredActions = false;
    let hasPrimaryError = false;
    let failedMergedResolutions: MergedResolution[] = [];
    let fallbackLocalWinOpsCreated = 0;
    let remoteApplyWindowStarted = false;
    const ownsRemoteApplyLifecycle = !(
      options.remoteApplyLifecycleOwnedByCaller ?? false
    );
    try {
      if (allOpsToApply.length > 0) {
        OpLog.normal(
          `ConflictResolutionService: Applying ${allOpsToApply.length} ops in single batch`,
        );
        await this.opLogStore.mergeRemoteOpClocks(allOpsToApply);
        canDrainDeferredActions = true;
        if (ownsRemoteApplyLifecycle) {
          this.hydrationState.startApplyingRemoteOps();
          remoteApplyWindowStarted = true;
        }

        const opIdToSeq = new Map(allStoredOps.map((o) => [o.id, o.seq]));
        const applyResult = await this.operationApplier.applyOperations(allOpsToApply, {
          skipDeferredLocalActions: true,
          remoteApplyWindowAlreadyOpen: true,
          onReducersCommitted: async (reducerCommittedOps, reducerFailures = []) => {
            // Disjoint-merge ops are synthetic LOCAL rows in the apply batch.
            // Exclude successful ones from the checkpoint's pending-only seq
            // assertion. Failed ones are quarantined; their remote sides are
            // already applied (#10422) when the LWW fallback below re-resolves.
            const checkpointOps = reducerCommittedOps.filter(
              (op) => !checkpointExemptOpIds.has(op.id),
            );
            const reducerCommittedSeqs = checkpointOps
              .map((op) => opIdToSeq.get(op.id))
              .filter((seq): seq is number => seq !== undefined);
            if (reducerCommittedSeqs.length !== checkpointOps.length) {
              throw new Error(
                'ConflictResolutionService: reducer commit contained an unknown operation.',
              );
            }
            const failedCheckpointExemptOpIds = reducerFailures
              .filter((failure) => checkpointExemptOpIds.has(failure.op.id))
              .map((failure) => failure.op.id);
            if (failedCheckpointExemptOpIds.length > 0) {
              await this.opLogStore.markReducersCommittedAndMergeClocks(
                reducerCommittedSeqs,
                checkpointOps,
                failedCheckpointExemptOpIds,
              );
            } else if (checkpointOps.length > 0) {
              await this.opLogStore.markReducersCommittedAndMergeClocks(
                reducerCommittedSeqs,
                checkpointOps,
              );
            }
          },
        });

        if (applyResult.reducerFailures?.length) {
          OpLog.err(
            `ConflictResolutionService: ${applyResult.reducerFailures.length} resolution operation(s) failed reducer replay.`,
          );
        }

        const appliedSeqs = applyResult.appliedOps
          .map((op) => opIdToSeq.get(op.id))
          .filter((seq): seq is number => seq !== undefined);

        if (appliedSeqs.length > 0) {
          await this.opLogStore.markApplied(appliedSeqs);

          OpLog.normal(
            `ConflictResolutionService: Successfully applied ${appliedSeqs.length} ops`,
          );
        }

        if (applyResult.failedOp) {
          const failedOpIds = [applyResult.failedOp.op.id];

          OpLog.err(
            `ConflictResolutionService: ${applyResult.appliedOps.length} ops applied before failure. ` +
              'Marking the attempted archive operation as failed.',
            applyResult.failedOp.error,
          );
          await this.opLogStore.markFailed(failedOpIds);

          // Never replace a visible persistent recovery action (e.g. the
          // USE_REMOTE Undo — the only entry point to the pre-replace backup).
          // The IncompleteRemoteOperationsError thrown below still flips the
          // sync status to ERROR via the wrapper's (equally guarded) handler.
          if (!this.snackService.hasPendingPersistentAction()) {
            this.snackService.open({
              type: 'ERROR',
              msg: T.F.SYNC.S.CONFLICT_RESOLUTION_FAILED,
              actionStr: T.PS.RELOAD,
              actionFn: (): void => {
                window.location.reload();
              },
            });
          }

          // FIX #6571: Throw on apply failure (parity with applyNonConflictingOps).
          // Previously, apply failures during LWW resolution were logged but not
          // thrown, causing sync to report IN_SYNC despite lost operations.
          // Deferred-actions flush runs in the finally below before the throw
          // propagates.
          throw new IncompleteRemoteOperationsError(applyResult.failedOp.error);
        }

        if (applyResult.reducerFailures?.length) {
          const failedSyntheticOpIds = new Set(
            applyResult.reducerFailures
              .filter((failure) => writtenMergedOpIds.has(failure.op.id))
              .map((failure) => failure.op.id),
          );
          failedMergedResolutions = mergedResolutions.filter((merged) =>
            merged.mergedOps.some((op) => failedSyntheticOpIds.has(op.id)),
          );
          const nonSyntheticFailure = applyResult.reducerFailures.find(
            (failure) => !failedSyntheticOpIds.has(failure.op.id),
          );
          if (nonSyntheticFailure) {
            throw new IncompleteRemoteOperationsError(nonSyntheticFailure.error);
          }
        }
      }

      if (failedMergedResolutions.length > 0) {
        OpLog.warn(
          `ConflictResolutionService: Falling back to LWW for ${failedMergedResolutions.length} failed disjoint merge(s).`,
        );
        const fallbackResult = await this.autoResolveConflictsLWW(
          failedMergedResolutions.map((merged) => merged.conflict),
          [],
          {
            ...options,
            disableDisjointMerge: true,
            remoteApplyLifecycleOwnedByCaller: true,
          },
        );
        fallbackLocalWinOpsCreated = fallbackResult.localWinOpsCreated;
      }
    } catch (error) {
      hasPrimaryError = true;
      throw error;
    } finally {
      if (remoteApplyWindowStarted) {
        try {
          this.hydrationState.startPostSyncCooldown();
        } catch (error) {
          OpLog.err(
            'ConflictResolutionService: Failed to start post-sync cooldown',
            error,
          );
        }
        this.hydrationState.endApplyingRemoteOps();
      }
      if (canDrainDeferredActions && ownsRemoteApplyLifecycle) {
        try {
          await processDeferredActionsAfterRemoteApply(
            this.injector,
            options.callerHoldsOperationLogLock ?? false,
          );
        } catch (deferredError) {
          if (!hasPrimaryError) {
            throw deferredError;
          }
          OpLog.err(
            'ConflictResolutionService: Deferred-action drain also failed after the primary remote-apply error',
            { name: (deferredError as Error | undefined)?.name },
          );
        }
      }
    }

    const fallbackOriginalOpIds = new Set(
      failedMergedResolutions.flatMap((merged) => [
        ...merged.conflict.localOps.map((op) => op.id),
        ...merged.conflict.remoteOps.map((op) => op.id),
      ]),
    );
    const remainingLocalOpsToReject = await this.localWinOps._withoutSyncedOps(
      localOpsToReject.filter((opId) => !fallbackOriginalOpIds.has(opId)),
    );
    const remainingRemoteOpsToReject = remoteOpsToReject.filter(
      (opId) => !fallbackOriginalOpIds.has(opId),
    );
    const successfulMergedResolutions = mergedResolutions.filter(
      (merged) => !failedMergedResolutions.includes(merged),
    );

    // Finalize only after every chosen resolution entered state. If reducer or
    // archive work fails, the originals stay eligible for a clean retry. Local
    // fields that survived a remote resolution row are re-emitted in the same
    // transaction as their originals' rejection.
    const reemittedOps = await this.localWinOps._reemitSurvivingLocalFields(
      resolutions,
      new Set(remainingLocalOpsToReject),
    );
    if (reemittedOps.length > 0) {
      await this.opLogStore.appendMixedSourceBatchSkipDuplicates(
        [{ ops: reemittedOps, source: 'local' }],
        { rejectOpIds: remainingLocalOpsToReject },
      );
      OpLog.normal(
        `ConflictResolutionService: Re-emitted ${reemittedOps.length} losing local edit(s) ` +
          `and rejected ${remainingLocalOpsToReject.length} local ops`,
      );
    } else if (remainingLocalOpsToReject.length > 0) {
      await this.opLogStore.markRejected(remainingLocalOpsToReject);
      OpLog.normal(
        `ConflictResolutionService: Marked ${remainingLocalOpsToReject.length} local ops as rejected`,
      );
    }
    if (remainingRemoteOpsToReject.length > 0) {
      await this.opLogStore.markRejected(remainingRemoteOpsToReject);
      OpLog.normal(
        `ConflictResolutionService: Marked ${remainingRemoteOpsToReject.length} remote ops as rejected`,
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 5: Show non-blocking notification
    //
    // Distinguish "routine" self-healing (reschedule/repeat/archive/done churn
    // that resolves correctly on its own) from resolutions that discarded a real
    // user content edit (title/notes/subtasks). Routine stays quiet with the
    // existing transient count; genuine content loss gets a dismissible banner
    // naming the affected task(s) so the user can double-check. (#8694)
    // ─────────────────────────────────────────────────────────────────────────
    if (resolutions.length > 0 || successfulMergedResolutions.length > 0) {
      await this.resolutionNotifier._notifyResolutionOutcome(
        resolutions,
        successfulMergedResolutions,
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 6: Validate and repair state after resolution
    // Validation failure flips the SyncSessionValidationService latch — the
    // wrapper reads it before deciding IN_SYNC vs ERROR. (#7330)
    // ─────────────────────────────────────────────────────────────────────────
    const isValid = await this._validateAndRepairAfterResolution();
    if (!isValid) this.sessionValidation.setFailed();

    // Count both LWW local-win ops AND disjoint-merge re-sends: each merge
    // appended a synthesized pending-local op that still needs uploading. The
    // caller uses this count to trigger the immediate re-upload
    // (immediate-upload.service.ts) — omitting merges lets a merge-only sync
    // report IN_SYNC while its merged op sits unsynced until a later cycle.
    // Mirrors the rejection-handler accumulation in operation-log-sync.service.
    // writtenLocalWinOps (not newLocalWinOps) is the post-dedupe set the atomic
    // mixed-source batch actually persisted.
    return {
      localWinOpsCreated:
        writtenLocalWinOps.length +
        successfulMergedResolutions.length +
        reemittedOps.length +
        fallbackLocalWinOpsCreated,
    };
  }

  /**
   * Atomically filters out already-applied ops and appends new ones to the store.
   * Uses appendBatchSkipDuplicates() to check and insert within a single IndexedDB
   * transaction, eliminating the TOCTOU race condition (issue #6343).
   *
   * @param ops - Operations to filter and potentially append
   * @param source - Source of operations ('local' or 'remote')
   * @param options - Options for appendBatchSkipDuplicates (e.g., pendingApply)
   * @returns Object containing the written ops and their sequence numbers
   */
  private async _filterAndAppendOpsWithRetry(
    ops: Operation[],
    source: 'local' | 'remote',
    options?: { pendingApply?: boolean },
  ): Promise<{ ops: Operation[]; seqs: number[] }> {
    const result = await this.opLogStore.appendBatchSkipDuplicates(ops, source, options);
    const written: MixedSourceWrittenOperation[] = result.writtenOps.map((op, index) => ({
      op,
      seq: result.seqs[index],
      source,
    }));
    const replayable = await this._resolveReplayableOperations(ops, source, written);
    return {
      ops: replayable.map((entry) => entry.op),
      seqs: replayable.map((entry) => entry.seq),
    };
  }

  private async _resolveReplayableOperations(
    ops: readonly Operation[],
    source: 'local' | 'remote',
    written: readonly MixedSourceWrittenOperation[],
  ): Promise<Array<{ op: Operation; seq: number }>> {
    const writtenByOpId = new Map(
      written
        .filter((entry) => entry.source === source)
        .map((entry) => [entry.op.id, entry]),
    );
    const replayable = await Promise.all(
      ops.map(async (op) => {
        const writtenEntry = writtenByOpId.get(op.id);
        if (writtenEntry) {
          return { op: writtenEntry.op, seq: writtenEntry.seq };
        }

        // A reducer failure deliberately leaves the durable remote row pending.
        // On the next sync, deduplication finds that row instead of inserting it;
        // reuse its sequence so the recovered reducer can be retried and
        // checkpointed. Applied, archive-pending, failed, or rejected rows must
        // not be reducer-dispatched again.
        const existing = await this.opLogStore.getOpById(op.id);
        return existing?.source === source &&
          existing.applicationStatus === 'pending' &&
          existing.rejectedAt === undefined &&
          existing.reducerRejectedAt === undefined
          ? { op: existing.op, seq: existing.seq }
          : undefined;
      }),
    );
    const pendingOps = replayable.filter(
      (entry): entry is { op: Operation; seq: number } => entry !== undefined,
    );
    return pendingOps;
  }
}
