import { inject, Injectable } from '@angular/core';
import {
  planLwwConflictResolutions,
  type LwwConflictResolutionPlan,
} from '@sp/sync-core';
import { Store } from '@ngrx/store';
import {
  ActionType,
  EntityConflict,
  extractActionPayload,
  Operation,
  isLwwUpdatePayload,
  OpType,
} from '../core/operation.types';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { OpLog } from '../../core/log';
import { toEntityKey } from '../util/entity-key.util';
import { getOpEntityIds } from '../util/get-op-entity-ids.util';
import { firstValueFrom } from 'rxjs';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import { uuidv7 } from '../../util/uuid-v7';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';
import {
  aggregateEntityConflict,
  fieldPatchGroups,
  buildSurvivingFieldPatches,
} from './conflict-field-patch.util';
import { RECREATE_FALLBACK } from '../core/recreate-fallback.const';
import { asPatchSnapshotIfTypeShadowed } from './lww-snapshot-patch-mode.util';
import { type MultiEntityRemoteOpWinners } from './lww-compensation-selection.util';
import { selectPlannerState } from '../../features/planner/store/planner.selectors';
import { ConflictEntityStateService } from './conflict-entity-state.service';
import { createLWWUpdateOp, mergeAndIncrementClocks } from './lww-update-op.util';
import {
  LWWResolution,
  MergedResolution,
  latestProjectMoveEntityIds,
  markLwwDeleteRecreation,
  LWW_PLANNING_OPTIONS,
} from './conflict-resolution.util';

/**
 * Builds the ops that carry a local LWW win (full snapshot, field patch, re-emit) to other clients.
 * Split out of `ConflictResolutionService`, which orchestrates the resolution.
 */
@Injectable({
  providedIn: 'root',
})
export class ConflictLocalWinOpsService {
  private clientIdProvider = inject(CLIENT_ID_PROVIDER);
  private opLogStore = inject(OperationLogStoreService);
  private store = inject(Store);
  private entityState = inject(ConflictEntityStateService);

  /**
   * SPAP-14: whether this plan must win the WHOLE entity and so is excluded from
   * disjoint-field merge. Both archive and project-delete-wins have this
   * property — the winner replaces the entity outright, never partially merged
   * with a concurrent edit.
   */
  private _isWholeEntityWinPlan(
    plan: LwwConflictResolutionPlan<EntityConflict>,
  ): boolean {
    return (
      plan.reason === 'remote-archive' ||
      plan.reason === 'local-archive' ||
      plan.reason === 'local-archive-sibling' ||
      plan.reason === 'remote-delete-wins' ||
      plan.reason === 'local-delete-wins' ||
      plan.localWinOperationKind === 'archive-win'
    );
  }

  /**
   * Resolves an entity's conflicts per field (conflict-field-patch.util.ts,
   * #10422), or returns undefined for the whole-entity LWW path. The remote
   * ops apply as themselves; the re-sends are the local fields whose latest
   * local write is newer than every remote write of the same field
   * (`localWinningFieldGroups`), one `'patch'` row per local op that wrote
   * them, each at that op's own timestamp. Each row's clock dominates both
   * sides and the one before it. Rows never re-merge (#10393 decision 5).
   * Types without a RECREATE_FALLBACK (NOTE, decision 4) are refused: a
   * receiver that applied a concurrent delete recreates the entity from the
   * partial patch (accepted residual, decision 2).
   */
  async _tryCreateFieldPatch(
    entityPlans: LwwConflictResolutionPlan<EntityConflict>[],
    nonConflictingOps: Operation[],
  ): Promise<MergedResolution | undefined> {
    const conflict =
      entityPlans.length === 1
        ? entityPlans[0].conflict
        : aggregateEntityConflict(entityPlans.map((plan) => plan.conflict));
    const [plan] =
      entityPlans.length === 1
        ? entityPlans
        : planLwwConflictResolutions([conflict], LWW_PLANNING_OPTIONS);
    const { entityType, entityId, localOps, remoteOps } = conflict;
    const sides = {
      localOps,
      remoteOps,
      entityId,
      payloadKey: this.entityState._resolvePayloadKey(entityType),
    };
    // NOTE (#9426): `isFieldPatchEligible` refuses multi-entity ops, which is
    // load-bearing: a patched conflict bypasses `resolutions` and would starve
    // `_preservePartiallyRejectedLocalBulkPlanOps` while rejecting the bulk row.
    const groups = fieldPatchGroups(sides);
    if (
      !RECREATE_FALLBACK[entityType] ||
      [...entityPlans, plan].some((p) => this._isWholeEntityWinPlan(p)) ||
      !groups ||
      // A no-pending crossing (#9073) the remote side won: the local fields
      // already uploaded and the winner's device patches; a patch would echo.
      (plan.winner === 'remote' &&
        (await this._withoutSyncedOps(localOps.map((op) => op.id))).length === 0)
    ) {
      return undefined;
    }
    const clientId = await this.clientIdProvider.loadClientId();
    if (
      !clientId ||
      !(await this.entityState.getCurrentEntityState(entityType, entityId))
    ) {
      OpLog.warn(`ConflictResolutionService: Cannot patch ${entityType}:${entityId}.`);
      return undefined;
    }
    const allOps = [...localOps, ...remoteOps];
    // The clock also dominates the batch's commuting single-entity ops on this
    // entity (e.g. a third client's time delta), applied before it, or the
    // server rejects it as concurrent. It carries none of their fields.
    const dominated = nonConflictingOps.filter(
      (op) => op.entityId === entityId && getOpEntityIds(op).length === 1,
    );
    let clock = mergeAndIncrementClocks(
      [...allOps, ...dominated].map((op) => op.vectorClock),
      clientId,
    );
    const moves = latestProjectMoveEntityIds(entityId, allOps);
    // Each re-send dominates the one before; it re-declares its clears (#9776).
    const mergedOps = groups.map(({ timestamp, changes }, index) => {
      if (index > 0) clock = mergeAndIncrementClocks([clock], clientId);
      return createLWWUpdateOp(
        entityType,
        entityId,
        changes,
        clientId,
        clock,
        timestamp,
        'patch',
        moves,
        true,
      );
    });
    return { conflict, mergedOps, winner: plan.winner };
  }

  /** `survivingLocalFields` patches, built from post-apply state (no apply). */
  async _reemitSurvivingLocalFields(
    resolutions: LWWResolution[],
    pendingOpIds: Set<string>,
  ): Promise<Operation[]> {
    const clientId = await this.clientIdProvider.loadClientId();
    if (!clientId) return [];
    return buildSurvivingFieldPatches(resolutions, pendingOpIds, {
      getState: (type, id) => this.entityState.getCurrentEntityState(type, id),
      payloadKeyFor: (type) => this.entityState._resolvePayloadKey(type),
      createPatch: ({ entityType, entityId, localOps, remoteOps }, fields) =>
        createLWWUpdateOp(
          entityType,
          entityId,
          fields,
          clientId,
          mergeAndIncrementClocks(
            [...localOps, ...remoteOps].map((op) => op.vectorClock),
            clientId,
          ),
          Math.max(...localOps.map((op) => op.timestamp)),
          'patch',
          latestProjectMoveEntityIds(entityId, localOps),
          true,
        ),
    });
  }

  /**
   * Re-emits a local LWW winner with a fresh ID, merged clock and original
   * winning timestamp. Qualifying TASK snapshots leave additive time alone.
   * The exact restore-vs-delete case retains its semantic action instead.
   */
  async _createLocalWinUpdateOp(
    conflict: EntityConflict,
  ): Promise<Operation | undefined> {
    const [semanticRestoreOp] = conflict.localOps;
    const [remoteDeleteOp] = conflict.remoteOps;
    const remoteDeleteIds = remoteDeleteOp ? getOpEntityIds(remoteDeleteOp) : [];
    // Only re-emit the semantic restore for the exact 1-restore-vs-1-single-entity-
    // delete shape. Mixed histories need the generic snapshot path so a stale restore
    // payload cannot overwrite a later local edit or compensate for unrelated deletes.
    //
    // Consequence, scoped to #9290: for a bulk `deleteTasks` (multi-`entityIds`) or any
    // multi-op history the guard fails, and the generic path below emits a `[TASK] LWW
    // Update` rather than a `restoreTask` action. That still recreates the active entity,
    // but receivers won't run archive cleanup (dispatched only by the semantic restore
    // action, see ArchiveOperationHandler), so a stale archived copy can survive next to
    // the active task. This matches the pre-existing behavior for those shapes — this fix
    // deliberately covers only the common single-op path; broadening it (and the
    // dependency that `deleteTask` stays single-entity) is tracked in #9290.
    if (
      conflict.entityType === 'TASK' &&
      conflict.localOps.length === 1 &&
      conflict.remoteOps.length === 1 &&
      semanticRestoreOp?.actionType === ActionType.TASK_SHARED_RESTORE &&
      semanticRestoreOp.opType === OpType.Update &&
      semanticRestoreOp.entityType === 'TASK' &&
      semanticRestoreOp.entityId === conflict.entityId &&
      remoteDeleteOp?.opType === OpType.Delete &&
      remoteDeleteOp.entityType === 'TASK' &&
      remoteDeleteIds.length === 1 &&
      remoteDeleteIds[0] === conflict.entityId
    ) {
      const clientId = await this.clientIdProvider.loadClientId();
      if (!clientId) {
        OpLog.err(
          'ConflictResolutionService: Cannot create restore-win op - no client ID',
        );
        return undefined;
      }

      return {
        id: uuidv7(),
        actionType: semanticRestoreOp.actionType,
        opType: semanticRestoreOp.opType,
        entityType: semanticRestoreOp.entityType,
        entityId: semanticRestoreOp.entityId,
        entityIds: semanticRestoreOp.entityIds,
        payload: semanticRestoreOp.payload,
        clientId,
        vectorClock: mergeAndIncrementClocks(
          [
            ...conflict.localOps.map((op) => op.vectorClock),
            ...conflict.remoteOps.map((op) => op.vectorClock),
          ],
          clientId,
        ),
        timestamp: semanticRestoreOp.timestamp,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      };
    }

    // Get current entity state from store
    let entityState = await this.entityState.getCurrentEntityState(
      conflict.entityType,
      conflict.entityId,
    );

    if (entityState === undefined) {
      const localMaxTimestamp = Math.max(...conflict.localOps.map((op) => op.timestamp));
      const winningDeleteOp = conflict.localOps.find(
        (op) => op.opType === OpType.Delete && op.timestamp === localMaxTimestamp,
      );
      if (winningDeleteOp) {
        return this._createReplacementDeleteOp(conflict, winningDeleteOp);
      }

      // Try to extract entity from remote DELETE operation
      // This handles the case where a remote DELETE was applied before LWW resolution,
      // and the local UPDATE wins. We need to recreate the entity from the DELETE payload.
      entityState = this.entityState._extractEntityFromDeleteOperation(conflict);

      if (entityState !== undefined) {
        OpLog.warn(
          `ConflictResolutionService: Extracted entity from DELETE op for LWW update: ` +
            `${conflict.entityType}:${conflict.entityId}`,
        );
      } else {
        OpLog.warn(
          `ConflictResolutionService: Cannot create local-win op - entity not found: ` +
            `${conflict.entityType}:${conflict.entityId}`,
        );
        return undefined;
      }
    }

    // Get client ID
    const clientId = await this.clientIdProvider.loadClientId();
    if (!clientId) {
      OpLog.err('ConflictResolutionService: Cannot create local-win op - no client ID');
      return undefined;
    }

    // Merge all vector clocks (local ops + remote ops) and increment
    const allClocks = [
      ...conflict.localOps.map((op) => op.vectorClock),
      ...conflict.remoteOps.map((op) => op.vectorClock),
    ];
    // No client-side pruning — server prunes AFTER conflict detection, BEFORE storage.
    // Client-side pruning can drop entity clock IDs, causing the comparison to return
    // CONCURRENT instead of GREATER_THAN (infinite rejection loop).
    const newClock = mergeAndIncrementClocks(allClocks, clientId);

    // Preserve the maximum timestamp from local ops.
    // This is critical for LWW semantics: we're creating a new op to carry the
    // local-winning state, so it should retain the original timestamp that caused
    // it to win. Using Date.now() would give it an unfair advantage in future conflicts.
    const preservedTimestamp = Math.max(...conflict.localOps.map((op) => op.timestamp));

    const localWinOp = createLWWUpdateOp(
      conflict.entityType,
      conflict.entityId,
      entityState,
      clientId,
      newClock,
      preservedTimestamp,
      'replace',
      latestProjectMoveEntityIds(conflict.entityId, conflict.localOps),
    );
    const isRecreation =
      conflict.remoteOps.some((op) => op.opType === OpType.Delete) ||
      conflict.localOps.some(
        (op) =>
          isLwwUpdatePayload(op.payload) &&
          op.payload.recreatesEntityAfterDelete === true,
      );
    return asPatchSnapshotIfTypeShadowed(
      isRecreation ? markLwwDeleteRecreation(localWinOp) : localWinOp,
    );
  }

  /**
   * A mixed remote `planTasksForToday` must replay atomically so its remote
   * winners keep their scheduling change. That same reducer removes every
   * target from every planner day, including tasks whose newer local edit won.
   * Re-emit one task-scoped transfer per final local winner after the TASK
   * snapshots. A whole-day snapshot is unsafe here: it can overwrite an
   * unrelated placement that reached the server before this compensation.
   *
   * Each transfer must be a pure ordering restore — its replay force-writes
   * `dueDay` and clears `dueWithTime` — so a placement whose day disagrees
   * with the winning snapshot is skipped rather than re-imposed.
   *
   * `Transfer Task` is an existing wire action understood by released clients,
   * so this needs neither a schema bump nor a new payload contract.
   */
  async _createMixedRemoteTodayPlannerCompensationOps(
    winnerGroups: MultiEntityRemoteOpWinners[],
    localWinOpsById: ReadonlyMap<string, Operation>,
  ): Promise<Operation[]> {
    const appliedPlanGroups = winnerGroups.filter(
      ({ op, hasRemoteWinner }) =>
        op.actionType === ActionType.TASK_SHARED_PLAN_FOR_TODAY && hasRemoteWinner,
    );
    if (appliedPlanGroups.length === 0) return [];

    const finalLocalWinners = new Map<
      string,
      { localWinOp: Operation; remotePlanOp: Operation }
    >();
    for (const group of appliedPlanGroups) {
      for (const taskId of getOpEntityIds(group.op)) {
        const taskKey = toEntityKey('TASK', taskId);
        if (!group.localWinnerKeys.has(taskKey)) {
          finalLocalWinners.delete(taskId);
          continue;
        }
        const localWinOp = [...group.localWinOpIds]
          .map((opId) => localWinOpsById.get(opId))
          .find(
            (op): op is Operation =>
              op?.entityType === 'TASK' &&
              op.entityId === taskId &&
              op.opType !== OpType.Delete,
          );
        if (localWinOp) {
          finalLocalWinners.set(taskId, { localWinOp, remotePlanOp: group.op });
        } else {
          finalLocalWinners.delete(taskId);
        }
      }
    }
    if (finalLocalWinners.size === 0) return [];

    const plannerState = await firstValueFrom(this.store.select(selectPlannerState));
    if (!plannerState?.days) return [];

    const remoteTargetIds = new Set(
      appliedPlanGroups.flatMap(({ op }) => getOpEntityIds(op)),
    );
    const placements = Object.entries(plannerState.days)
      .sort(([dayA], [dayB]) => dayA.localeCompare(dayB))
      .flatMap(([day, taskIds]) => {
        const postRemoteTaskIds = taskIds.filter(
          (taskId) => !remoteTargetIds.has(taskId) || finalLocalWinners.has(taskId),
        );
        return postRemoteTaskIds.flatMap((taskId, targetIndex) => {
          const winner = finalLocalWinners.get(taskId);
          if (!winner) return [];
          const today = extractActionPayload(winner.remotePlanOp.payload)['today'];
          const task = extractActionPayload(winner.localWinOp.payload);
          if (typeof today !== 'string' || task['id'] !== taskId) return [];
          // Ordering-only restore: the transfer replay force-writes dueDay and
          // clears dueWithTime, so a stale planner.days entry that disagrees
          // with the winning snapshot (e.g. left by an earlier LWW snapshot
          // that moved scheduling without touching planner state) must not be
          // re-imposed — it would revert the winner's schedule on every
          // client. Skip it; that winner keeps the pre-existing bounded gap.
          if (
            task['dueDay'] !== day ||
            (task['dueWithTime'] !== undefined && task['dueWithTime'] !== null)
          ) {
            return [];
          }
          return [{ day, targetIndex, taskId, task, today, ...winner }];
        });
      });
    if (placements.length === 0) return [];

    const clientId = await this.clientIdProvider.loadClientId();
    if (!clientId) {
      throw new Error(
        'ConflictResolutionService: Cannot preserve planner placement - no client ID',
      );
    }

    let nextClock = mergeAndIncrementClocks(
      [
        (await this.opLogStore.getVectorClock()) ?? {},
        ...appliedPlanGroups.map(({ op }) => op.vectorClock),
        ...placements.map(({ localWinOp }) => localWinOp.vectorClock),
      ],
      clientId,
    );
    return placements.map(({ day, targetIndex, taskId, task, today, localWinOp }) => {
      const op: Operation = {
        id: uuidv7(),
        actionType: ActionType.PLANNER_TRANSFER_TASK,
        opType: OpType.Move,
        entityType: 'PLANNER',
        entityId: taskId,
        payload: {
          actionPayload: {
            task,
            prevDay: today,
            newDay: day,
            targetIndex,
            today,
          },
          entityChanges: [],
        },
        clientId,
        vectorClock: nextClock,
        timestamp: localWinOp.timestamp,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      };
      nextClock = mergeAndIncrementClocks([nextClock], clientId);
      return op;
    });
  }

  /**
   * Replaces a locally winning DELETE whose original row is rejected during
   * resolution. Keeping the original payload/scope preserves the atomic user
   * intent, while the merged clock prevents the remote loser from resurfacing.
   */
  async _createReplacementDeleteOp(
    conflict: EntityConflict,
    deleteOp: Operation,
  ): Promise<Operation | undefined> {
    const clientId = await this.clientIdProvider.loadClientId();
    if (!clientId) {
      OpLog.err('ConflictResolutionService: Cannot create delete-win op - no client ID');
      return undefined;
    }

    const allClocks = [
      ...conflict.localOps.map((op) => op.vectorClock),
      ...conflict.remoteOps.map((op) => op.vectorClock),
    ];
    const newClock = mergeAndIncrementClocks(allClocks, clientId);

    return {
      id: uuidv7(),
      actionType: deleteOp.actionType,
      opType: OpType.Delete,
      entityType: deleteOp.entityType,
      entityId: deleteOp.entityId,
      entityIds: deleteOp.entityIds,
      payload: deleteOp.payload,
      clientId,
      vectorClock: newClock,
      timestamp: deleteOp.timestamp,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
  }

  /**
   * Invariant guard: NEVER reject an already-synced op. A synced row is on the
   * server and in other clients' histories; rejecting it here would erase it
   * from this client's frontier scans (they skip `rejectedAt`) while the rest
   * of the fleet keeps it — corrupting later conflict detection. Pending-path
   * conflicts only ever queue unsynced ids (they come from getUnsyncedByEntity
   * by construction), so this filter is a no-op for them; the synthetic
   * no-pending crossings (#9073) queue their already-synced localOps, which
   * are dropped here — the winning LWW op supersedes them by clock domination
   * instead. Fails open when a row cannot be loaded.
   */
  async _withoutSyncedOps(opIds: string[]): Promise<string[]> {
    const result: string[] = [];
    for (const opId of opIds) {
      const entry = await this.opLogStore.getOpById(opId);
      if (entry?.syncedAt !== undefined) {
        OpLog.verbose(
          `ConflictResolutionService: Not rejecting already-synced op ${opId} ` +
            `(superseded by resolution op's clock instead)`,
        );
        continue;
      }
      result.push(opId);
    }
    return result;
  }
}
