import { inject, Injectable } from '@angular/core';
import {
  planLwwConflictResolutions,
  type LwwConflictResolutionPlan,
} from '@sp/sync-core';
import {
  ActionType,
  EntityConflict,
  EntityType,
  Operation,
  isMultiEntityPayload,
  OpType,
  VectorClock,
} from '../core/operation.types';
import {
  buildArchiveWinOp,
  getBulkArchiveIntentKey,
  groupArchiveWinConflicts,
} from './bulk-archive-intent.util';
import { OpLog } from '../../core/log';
import { toEntityKey } from '../util/entity-key.util';
import { getOpEntityIds, isMultiEntityOperation } from '../util/get-op-entity-ids.util';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import { UnsupportedMultiEntityConflictError } from '../core/errors/sync-errors';
import { foldSyncTimeSpentDeltas, isSyncTimeSpentOp } from './fold-sync-time-spent.util';
import type { Task } from '../../features/tasks/task.model';
import { hasOpaqueChanges, mergeChangedFields } from './conflict-disjoint-merge.util';
import { preserveTaskSnapshotTimes } from './time-preserving-task-snapshot.util';
import { ConflictLocalWinOpsService } from './conflict-local-win-ops.service';
import { ConflictEntityStateService } from './conflict-entity-state.service';
import { createLWWUpdateOp, mergeAndIncrementClocks } from './lww-update-op.util';
import {
  LWWResolution,
  MergedResolution,
  ResolvedConflicts,
  mergeMarkedProjectDeleteOps,
  DECOMPOSABLE_MULTI_ACTION_FIELDS,
  isRoundTimePayloadValidForStaticFields,
  doesRoundTimeOpWriteTask,
  INDEPENDENT_MULTI_DELETE_ACTIONS,
  LWW_PLANNING_OPTIONS,
  isResolvableTodayListAction,
} from './conflict-resolution.util';

/**
 * Plans LWW winners per conflict and builds the local-win, field-patch and reconciliation ops.
 * Split out of `ConflictResolutionService`, which orchestrates the resolution.
 */
@Injectable({
  providedIn: 'root',
})
export class ConflictResolutionPlannerService {
  private clientIdProvider = inject(CLIENT_ID_PROVIDER);
  private localWinOps = inject(ConflictLocalWinOpsService);
  private entityState = inject(ConflictEntityStateService);

  /**
   * Plans each conflict by LWW, retaining ordinary field merges and local winners.
   */
  async _resolveConflictsWithLWW(
    conflicts: EntityConflict[],
    disableDisjointMerge: boolean = false,
    nonConflictingOps: Operation[] = [],
  ): Promise<ResolvedConflicts> {
    const resolutions: LWWResolution[] = [];
    const mergedResolutions: MergedResolution[] = [];

    const plans = planLwwConflictResolutions(conflicts, LWW_PLANNING_OPTIONS);
    this._assertMultiEntityPlansAreSafe(plans);
    await this._forceLocalWinForUnwritableRoundTimeTargets(plans);

    // A rejected local bulk op was already applied optimistically. If the
    // remote winner changes only part of one entity, rejecting the whole row
    // would strand its other entity/field changes locally with no uploadable op.
    const localMultiReconciliationOps =
      await this._createLocalMultiReconciliationOps(plans);

    // One field patch per entity, built from ALL of its conflicts (detection
    // emits one per remote op): per-conflict patches would dominate one
    // another and a superseded sibling would drop its fields.
    const plansByEntity = new Map<string, LwwConflictResolutionPlan<EntityConflict>[]>();
    for (const plan of plans) {
      const key = toEntityKey(
        plan.conflict.entityType as EntityType,
        plan.conflict.entityId,
      );
      plansByEntity.set(key, [...(plansByEntity.get(key) ?? []), plan]);
    }
    const patchedEntityKeys = new Map<string, boolean>();

    // #10102: ONE recreation per archive intent, shared by every row it won.
    const archiveWinOpByConflict = new Map<EntityConflict, Operation | undefined>();
    for (const group of groupArchiveWinConflicts(plans)) {
      const clientId = await this.clientIdProvider.loadClientId();
      if (!clientId) {
        OpLog.err(
          'ConflictResolutionService: Cannot create archive-win op - no client ID',
        );
      }
      const archiveWinOp = clientId ? buildArchiveWinOp(group, clientId) : undefined;
      group.conflicts.forEach((c) => archiveWinOpByConflict.set(c, archiveWinOp));
    }

    for (const plan of plans) {
      // BEFORE the whole-entity LWW plan, try a field patch that keeps both
      // sides' fields. Delete/archive, opaque and multi-entity conflicts fall
      // through to the whole-entity LWW path below.
      const entityKey = toEntityKey(
        plan.conflict.entityType as EntityType,
        plan.conflict.entityId,
      );
      if (patchedEntityKeys.get(entityKey)) continue;
      const merged =
        disableDisjointMerge || patchedEntityKeys.has(entityKey)
          ? undefined
          : await this.localWinOps._tryCreateFieldPatch(
              plansByEntity.get(entityKey) ?? [plan],
              nonConflictingOps,
            );
      patchedEntityKeys.set(entityKey, !!merged);
      if (merged) {
        mergedResolutions.push(merged);
        OpLog.normal(
          `ConflictResolutionService: Field patch for ` +
            `${plan.conflict.entityType}:${plan.conflict.entityId} (kept both sides)`,
        );
        continue;
      }

      let localWinOp: Operation | undefined;

      if (plan.localWinOperationKind === 'archive-win') {
        localWinOp = archiveWinOpByConflict.get(plan.conflict);
      } else if (plan.localWinOperationKind === 'delete-win') {
        const deleteOp = mergeMarkedProjectDeleteOps(plan.conflict.localOps);
        if (!deleteOp) {
          throw new Error(
            `ConflictResolutionService: Missing delete-wins operation for ` +
              `${plan.conflict.entityType}:${plan.conflict.entityId}`,
          );
        }
        localWinOp = await this.localWinOps._createReplacementDeleteOp(
          plan.conflict,
          deleteOp,
        );
      } else if (plan.localWinOperationKind === 'update') {
        localWinOp = await this.localWinOps._createLocalWinUpdateOp(plan.conflict);
      }

      resolutions.push({
        conflict: plan.conflict,
        winner: plan.winner,
        localWinOp,
      });

      if (
        plan.reason === 'remote-archive' ||
        plan.reason === 'local-archive' ||
        plan.reason === 'local-archive-sibling'
      ) {
        OpLog.normal(
          `ConflictResolutionService: Archive wins over concurrent operation ` +
            `(${plan.reason === 'remote-archive' ? 'remote' : 'local'} archive) for ` +
            `${plan.conflict.entityType}:${plan.conflict.entityId}`,
        );
      } else if (
        plan.reason === 'remote-delete-wins' ||
        plan.reason === 'local-delete-wins'
      ) {
        OpLog.normal(
          `ConflictResolutionService: Project deletion wins over concurrent update ` +
            `(${plan.winner} delete) for ` +
            `${plan.conflict.entityType}:${plan.conflict.entityId}`,
        );
      } else if (plan.winner === 'local') {
        OpLog.normal(
          `ConflictResolutionService: LWW resolved ${plan.conflict.entityType}:${plan.conflict.entityId} as LOCAL ` +
            `(local: ${plan.localMaxTimestamp}, remote: ${plan.remoteMaxTimestamp})`,
        );
      } else {
        OpLog.normal(
          `ConflictResolutionService: LWW resolved ${plan.conflict.entityType}:${plan.conflict.entityId} as REMOTE ` +
            `(local: ${plan.localMaxTimestamp}, remote: ${plan.remoteMaxTimestamp})`,
        );
      }
    }

    return {
      lwwResolutions: preserveTaskSnapshotTimes(resolutions, nonConflictingOps),
      mergedResolutions,
      localMultiReconciliationOps,
    };
  }

  /**
   * Re-emits safely decomposable fields from a local bulk or rounding op.
   *
   * The original bulk row is rejected as a unit regardless of which side wins.
   * Its disjoint target fields and sibling mutations are still present in the
   * local store, so explicitly decomposable fields need new uploadable ops.
   * Values are projected from CURRENT entity state, not copied from the old
   * captured delta: a later local edit may have superseded the bulk value.
   */
  private async _createLocalMultiReconciliationOps(
    resolutions: LwwConflictResolutionPlan<EntityConflict>[],
  ): Promise<Operation[]> {
    const candidates = new Map<
      string,
      {
        entityType: EntityType;
        entityId: string;
        clocks: VectorClock[];
        fields: Set<string>;
        isSafe: boolean;
        timestamp: number;
      }
    >();
    const remoteWholeRemovalKeys = new Set<string>();
    const localWinTargetKeys = new Set<string>();
    const remoteWinnerDiscardedTargetKeys = new Set<string>();
    const winnerTimeDeltas: Operation[] = [];

    for (const resolution of resolutions) {
      const conflictTargetKey = toEntityKey(
        resolution.conflict.entityType,
        resolution.conflict.entityId,
      );
      if (resolution.winner === 'local') {
        localWinTargetKeys.add(conflictTargetKey);
      }

      const remoteRemovalOps =
        resolution.winner === 'remote'
          ? resolution.conflict.remoteOps.filter(
              (op) =>
                op.opType === OpType.Delete ||
                op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
            )
          : [];
      for (const remoteOp of remoteRemovalOps) {
        for (const entityId of getOpEntityIds(remoteOp)) {
          remoteWholeRemovalKeys.add(toEntityKey(remoteOp.entityType, entityId));
        }
      }

      const conflictPayloadKey = this.entityState._resolvePayloadKey(
        resolution.conflict.entityType,
      );
      const remoteWinnerOps =
        resolution.winner === 'remote' && remoteRemovalOps.length === 0
          ? resolution.conflict.remoteOps
          : [];
      // A winning syncTimeSpent delta is folded in below, not read as fields (#10215).
      winnerTimeDeltas.push(...remoteWinnerOps.filter(isSyncTimeSpentOp));
      const remoteFieldOps = remoteWinnerOps.filter((op) => !isSyncTimeSpentOp(op));
      const fieldArgs = [conflictPayloadKey, resolution.conflict.entityId] as const;
      const remoteWinnerChanges = mergeChangedFields(remoteFieldOps, ...fieldArgs);
      const remoteWinnerIsOpaque = hasOpaqueChanges(remoteFieldOps, ...fieldArgs);

      const clocks = [
        ...resolution.conflict.localOps.map((op) => op.vectorClock),
        ...resolution.conflict.remoteOps.map((op) => op.vectorClock),
      ];
      for (const localOp of resolution.conflict.localOps) {
        const allowedFields = DECOMPOSABLE_MULTI_ACTION_FIELDS.get(localOp.actionType);
        // Lone rounding: pure-delta winners stack on it (#10215); else plain LWW.
        const single = !isMultiEntityOperation(localOp);
        if (!allowedFields || (single && remoteFieldOps.length > 0)) continue;
        for (const entityId of getOpEntityIds(localOp)) {
          if (
            resolution.winner === 'local' &&
            entityId === resolution.conflict.entityId
          ) {
            // The ordinary local-win full-state op already replaces this target.
            continue;
          }
          const key = toEntityKey(localOp.entityType, entityId);
          const existing = candidates.get(key);
          const changes = mergeChangedFields(
            [localOp],
            this.entityState._resolvePayloadKey(localOp.entityType),
            entityId,
          );
          const capturedFields = Object.keys(changes);
          const canUseStaticFields =
            capturedFields.length === 0 &&
            isMultiEntityPayload(localOp.payload) &&
            localOp.payload.entityChanges.length === 0 &&
            isRoundTimePayloadValidForStaticFields(localOp);
          const fields = canUseStaticFields ? [...allowedFields] : capturedFields;
          const isRemoteWinTarget =
            resolution.winner === 'remote' && entityId === resolution.conflict.entityId;
          if (isRemoteWinTarget && remoteWinnerIsOpaque) {
            throw new Error(
              `ConflictResolutionService: Cannot safely reconcile local bulk fields against ` +
                `opaque remote winner for ${resolution.conflict.entityType}:` +
                `${resolution.conflict.entityId}`,
            );
          }
          const remoteOverlappingFields = isRemoteWinTarget
            ? fields.filter((field) => field in remoteWinnerChanges)
            : [];
          if (
            isRemoteWinTarget &&
            remoteOverlappingFields.length > 0 &&
            remoteOverlappingFields.length < fields.length
          ) {
            throw new Error(
              `ConflictResolutionService: Cannot safely split coupled local bulk fields against ` +
                `partially overlapping remote winner for ${resolution.conflict.entityType}:` +
                `${resolution.conflict.entityId}`,
            );
          }
          if (
            isRemoteWinTarget &&
            remoteOverlappingFields.length === fields.length &&
            fields.length > 0
          ) {
            // LWW stays authoritative when the remote winner overlaps all
            // captured fields. A partial overlap cannot split coupled time fields.
            remoteWinnerDiscardedTargetKeys.add(key);
            continue;
          }
          const isSafe =
            fields.length > 0 && fields.every((field) => allowedFields.has(field));
          candidates.set(key, {
            entityType: localOp.entityType,
            entityId,
            clocks: [...(existing?.clocks ?? []), ...clocks],
            fields: new Set([...(existing?.fields ?? []), ...fields]),
            isSafe: (existing?.isSafe ?? true) && isSafe,
            timestamp: Math.max(existing?.timestamp ?? 0, localOp.timestamp),
          });
        }
      }
    }

    for (const key of remoteWholeRemovalKeys) {
      candidates.delete(key);
    }
    for (const key of remoteWinnerDiscardedTargetKeys) {
      candidates.delete(key);
    }
    // A local-win conflict target is handled by its ordinary full-state
    // replacement. Excluding all such targets globally matters when one bulk
    // op participates in more than one conflict: a target skipped in its own
    // plan can otherwise be re-added as a "sibling" by another plan.
    for (const key of localWinTargetKeys) {
      candidates.delete(key);
    }
    if (candidates.size === 0) {
      return [];
    }

    const clientId = await this.clientIdProvider.loadClientId();
    if (!clientId) {
      throw new Error(
        'ConflictResolutionService: Cannot preserve local bulk siblings - no client ID',
      );
    }

    const reconciliationOps: Operation[] = [];
    for (const candidate of candidates.values()) {
      if (!candidate.isSafe || candidate.fields.size === 0) {
        throw new Error(
          `ConflictResolutionService: Cannot safely split local multi-entity operation for ` +
            `${candidate.entityType}:${candidate.entityId}`,
        );
      }
      const entityState = await this.entityState.getCurrentEntityState(
        candidate.entityType,
        candidate.entityId,
      );
      if (entityState === undefined || entityState === null) {
        // A later local delete already superseded the old bulk mutation. Its
        // own pending delete op is the authoritative representation; never
        // recreate the entity from the stale captured bulk delta.
        continue;
      }
      if (typeof entityState !== 'object' || Array.isArray(entityState)) {
        throw new Error(
          `ConflictResolutionService: Cannot preserve local bulk sibling - entity state unavailable: ` +
            `${candidate.entityType}:${candidate.entityId}`,
        );
      }
      const stateRecord = entityState as Record<string, unknown>;
      if ([...candidate.fields].some((field) => !(field in stateRecord))) {
        throw new Error(
          `ConflictResolutionService: Cannot preserve local bulk sibling - current fields unavailable: ` +
            `${candidate.entityType}:${candidate.entityId}`,
        );
      }
      const fieldValues = Object.fromEntries(
        [...candidate.fields].map((field) => [field, stateRecord[field]]),
      );
      const { entityId } = candidate;
      reconciliationOps.push(
        createLWWUpdateOp(
          candidate.entityType,
          entityId,
          foldSyncTimeSpentDeltas(
            entityId,
            fieldValues,
            winnerTimeDeltas,
            (stateRecord as Partial<Task>).subTaskIds,
          ),
          clientId,
          mergeAndIncrementClocks(candidate.clocks, clientId),
          candidate.timestamp,
          'patch',
        ),
      );
    }
    return reconciliationOps;
  }

  /**
   * A rounding op declares EVERY task id of the day, but its reducer writes
   * only tasks passing the payload's project limit that are not
   * parents-with-subtasks (`doesRoundTimeOpWriteTask`). Letting such a row
   * resolve as a remote win would reject the local pending ops while the
   * replay writes nothing to the entity — the local edit would stay visible
   * on this client but silently never upload. Force those rows to LOCAL wins:
   * the compensation snapshot re-asserts and re-uploads the local state, and
   * the mixed-winner machinery still applies the atomic row once for its
   * writable targets. This is not a compromise — the sender's own dispatch
   * filtered the same ids, so the entity was never rounded anywhere.
   *
   * Rows whose entity is absent from the live store are left untouched:
   * delete/archive precedence already classifies them, and no snapshot could
   * be built for an entity that is gone.
   */
  private async _forceLocalWinForUnwritableRoundTimeTargets(
    plans: LwwConflictResolutionPlan<EntityConflict>[],
  ): Promise<void> {
    for (const plan of plans) {
      if (plan.winner !== 'remote' || plan.conflict.entityType !== 'TASK') {
        continue;
      }
      const isRoundTimeOnlyRow =
        plan.conflict.remoteOps.length > 0 &&
        plan.conflict.remoteOps.every(
          (op) =>
            isMultiEntityOperation(op) && isRoundTimePayloadValidForStaticFields(op),
        );
      if (!isRoundTimeOnlyRow) {
        continue;
      }
      const task = await this.entityState.getCurrentEntityState(
        'TASK',
        plan.conflict.entityId,
      );
      if (task === null || typeof task !== 'object') {
        continue;
      }
      const taskRecord = task as Record<string, unknown>;
      if (
        plan.conflict.remoteOps.some((op) => doesRoundTimeOpWriteTask(op, taskRecord))
      ) {
        continue;
      }
      plan.winner = 'local';
      plan.reason = 'local-timestamp';
      plan.localWinOperationKind = 'update';
    }
  }

  /**
   * Generic multi-entity operations cannot be partially compensated safely.
   * Fail before op-log mutation unless every multi-entity op in the plan has an
   * explicit resolution path: bulk archives are re-created when they win
   * (`buildArchiveWinOp`) or re-scoped to the tasks no remote archive covered
   * when they lose (`_preservePartiallyRejectedLocalBulkArchives`, #9537),
   * independent bulk deletes are re-scoped, and the local legacy rounding
   * action has an explicit per-entity reconciliation path above.
   *
   * A REMOTE `roundTimeSpentForDay` (#9601 — "Finish day" on device A races
   * next-morning edits on device B) resolves via the generic mixed-winner
   * machinery: the atomic row replays once, then local-win compensation
   * snapshots re-assert and re-upload each local winner after it. Targets the
   * replay cannot write on this client are forced to local wins first
   * (`_forceLocalWinForUnwritableRoundTimeTargets`). The gate's set-equality
   * check guarantees every DIRECT write target is conflict-checked (an id in
   * `taskIds` but not `entityIds` would be an unchecked write, so that shape
   * stays blocked); the reducer additionally recalculates parents of listed
   * subtasks — undeclared, but derived-fields-only.
   *
   * Accepted bounded divergence, both confined to `timeSpent`/
   * `timeSpentOnDay[day]` and chosen over the permanent sync wedge: a
   * remote-win target keeps rounded(local value) rather than the sender's
   * rounded value, and pre-rounding time deltas piggybacking in the SAME
   * download batch replay after the rounding (resolution rows are appended
   * before non-conflicting ops), yielding round(base)+delta vs the sender's
   * round(base+delta). Degenerate histories where a local winner has no
   * creatable compensation snapshot still fail closed via the mixed-winner
   * "Cannot safely compensate" throw.
   *
   * The Today-list ops that used to make this reachable from ordinary use —
   * `planTasksForToday` (dispatched with every due task id by the automatic
   * day-rollover) and the ordering-only Today ops — now resolve via
   * `isResolvableTodayListAction` (#9426): scoped replacement for plan rows,
   * plain rejection for ordering rows, atomic replay for remote rows. The
   * remaining blocked set (updateTasks, legacy addTagToTask, …) is pinned in
   * `testing/integration/unsupported-multi-entity-conflict.integration.spec.ts`.
   */
  private _assertMultiEntityPlansAreSafe(
    plans: LwwConflictResolutionPlan<EntityConflict>[],
  ): void {
    for (const plan of plans) {
      const unsafeRemoteOp = plan.conflict.remoteOps.find(
        (op) =>
          isMultiEntityOperation(op) &&
          op.actionType !== ActionType.TASK_SHARED_MOVE_TO_ARCHIVE &&
          !INDEPENDENT_MULTI_DELETE_ACTIONS.has(op.actionType) &&
          !isResolvableTodayListAction(op.actionType) &&
          !isRoundTimePayloadValidForStaticFields(op),
      );
      if (unsafeRemoteOp) {
        throw new UnsupportedMultiEntityConflictError(
          'remote',
          unsafeRemoteOp.actionType,
          getOpEntityIds(unsafeRemoteOp).length,
        );
      }

      const unsafeLocalOp = plan.conflict.localOps.find(
        (op) =>
          isMultiEntityOperation(op) &&
          op.actionType !== ActionType.TASK_SHARED_MOVE_TO_ARCHIVE &&
          !INDEPENDENT_MULTI_DELETE_ACTIONS.has(op.actionType) &&
          !DECOMPOSABLE_MULTI_ACTION_FIELDS.has(op.actionType) &&
          !isResolvableTodayListAction(op.actionType),
      );
      if (unsafeLocalOp) {
        throw new UnsupportedMultiEntityConflictError(
          'local',
          unsafeLocalOp.actionType,
          getOpEntityIds(unsafeLocalOp).length,
        );
      }

      // The bulk-archive excusal above assumes at most ONE whole-entity local
      // intent per row. Two pending bulk archives sharing a task (archive →
      // restore → re-archive with no sync between), or a bulk archive
      // overlapping a bulk delete, would make the per-op scoped replacements
      // re-assert contradictory or superseded intents with no cross-op
      // ordering — one op's uniquely-retained tasks could silently never
      // upload. Keep the safe stop for those degenerate histories. (Scope
      // caveat: this sees only ops sharing THIS row's conflicted task — an
      // overlap confined to non-conflicted siblings passes and resolves
      // per-op, which can re-assert the older op's stale sibling snapshot.)
      // Exact copies of ONE intent (pre-#10102 per-row archive-win
      // recreations) count once: they resolve as a group, every copy rejected.
      const localBulkArchiveOps = plan.conflict.localOps.filter(
        (op) =>
          isMultiEntityOperation(op) &&
          op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
      );
      const distinctBulkArchiveIntents = new Set(
        localBulkArchiveOps.map(getBulkArchiveIntentKey),
      );
      const hasBulkDeleteOverlap =
        distinctBulkArchiveIntents.size > 0 &&
        plan.conflict.localOps.some(
          (op) =>
            isMultiEntityOperation(op) &&
            INDEPENDENT_MULTI_DELETE_ACTIONS.has(op.actionType),
        );
      if (distinctBulkArchiveIntents.size > 1 || hasBulkDeleteOverlap) {
        throw new UnsupportedMultiEntityConflictError(
          'local',
          ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
          getOpEntityIds(localBulkArchiveOps[0]).length,
        );
      }
    }
  }
}
