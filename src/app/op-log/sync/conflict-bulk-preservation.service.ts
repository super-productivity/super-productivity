import { inject, Injectable } from '@angular/core';
import {
  ActionType,
  extractActionPayload,
  Operation,
  isMultiEntityPayload,
  OpType,
} from '../core/operation.types';
import {
  buildScopedArchiveReplacementOp,
  getBulkArchiveIntentKey,
  groupArchiveResolutionsByIntent,
} from './bulk-archive-intent.util';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { toEntityKey } from '../util/entity-key.util';
import {
  getBulkArchiveTopLevelIds,
  getOpEntityIds,
  isMultiEntityOperation,
} from '../util/get-op-entity-ids.util';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import { uuidv7 } from '../../util/uuid-v7';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';
import {
  buildScopedBulkPlanReplacements,
  SCOPED_PLAN_MULTI_ACTIONS,
} from './preserve-partial-bulk-plan.util';
import type { Task } from '../../features/tasks/task.model';
import { ConflictEntityStateService } from './conflict-entity-state.service';
import { ConflictLocalWinOpsService } from './conflict-local-win-ops.service';
import { mergeAndIncrementClocks } from './lww-update-op.util';
import {
  LWWResolution,
  INDEPENDENT_MULTI_DELETE_ACTIONS,
} from './conflict-resolution.util';

/**
 * Preserves the still-valid part of local bulk ops (delete, archive, plan) that a conflict partially rejected.
 * Split out of `ConflictResolutionService`, which orchestrates the resolution.
 */
@Injectable({
  providedIn: 'root',
})
export class ConflictBulkPreservationService {
  private clientIdProvider = inject(CLIENT_ID_PROVIDER);
  private opLogStore = inject(OperationLogStoreService);
  private entityState = inject(ConflictEntityStateService);
  private localWinOps = inject(ConflictLocalWinOpsService);

  /**
   * A local bulk delete can conflict for only one entity while also deleting
   * unaffected siblings. Rejecting the original atomic row is necessary for
   * the remote winner, but would otherwise prevent those sibling deletions
   * from ever reaching another client.
   *
   * Replace each affected bulk row with one narrowed delete operation that
   * excludes explicit remote winners, retains uncontested/local-winning
   * siblings, and dominates every conflict clock involving the original row.
   */
  async _preservePartiallyRejectedLocalBulkDeletes(
    resolutions: LWWResolution[],
  ): Promise<Operation[]> {
    interface BulkDeleteResolutionGroup {
      deleteOp: Operation;
      resolutions: LWWResolution[];
      remoteWinnerIds: Set<string>;
    }

    const groups = new Map<string, BulkDeleteResolutionGroup>();
    for (const resolution of resolutions) {
      for (const localOp of resolution.conflict.localOps) {
        if (
          !INDEPENDENT_MULTI_DELETE_ACTIONS.has(localOp.actionType) ||
          getOpEntityIds(localOp).length <= 1
        ) {
          continue;
        }
        const group = groups.get(localOp.id) ?? {
          deleteOp: localOp,
          resolutions: [],
          remoteWinnerIds: new Set<string>(),
        };
        group.resolutions.push(resolution);
        if (resolution.winner === 'remote') {
          group.remoteWinnerIds.add(resolution.conflict.entityId);
        }
        groups.set(localOp.id, group);
      }
    }

    const additionalOps: Operation[] = [];
    for (const group of groups.values()) {
      const retainedEntityIds = getOpEntityIds(group.deleteOp).filter(
        (entityId) => !group.remoteWinnerIds.has(entityId),
      );
      if (retainedEntityIds.length === 0) {
        continue;
      }

      const replacementOp = await this._createScopedBulkDeleteReplacement(
        group,
        retainedEntityIds,
      );
      let assignedToLocalWinner = false;
      for (const resolution of group.resolutions) {
        if (
          resolution.winner === 'local' &&
          resolution.localWinOp?.opType === OpType.Delete
        ) {
          resolution.localWinOp = replacementOp;
          assignedToLocalWinner = true;
        }
      }
      if (!assignedToLocalWinner) {
        additionalOps.push(replacementOp);
      }
    }
    return additionalOps;
  }

  private async _createScopedBulkDeleteReplacement(
    group: {
      deleteOp: Operation;
      resolutions: LWWResolution[];
    },
    retainedEntityIds: string[],
  ): Promise<Operation> {
    const clientId = await this.clientIdProvider.loadClientId();
    if (!clientId) {
      throw new Error(
        'ConflictResolutionService: Cannot preserve partial bulk delete - no client ID',
      );
    }

    const allClocks = group.resolutions.flatMap(({ conflict }) => [
      ...conflict.localOps.map((op) => op.vectorClock),
      ...conflict.remoteOps.map((op) => op.vectorClock),
    ]);
    const originalPayload = group.deleteOp.payload;
    const retainedEntityIdSet = new Set(retainedEntityIds);
    const originalActionPayload = extractActionPayload(originalPayload);
    const entityIdsPayloadKey = Array.isArray(originalActionPayload['taskIds'])
      ? 'taskIds'
      : Array.isArray(originalActionPayload['ids'])
        ? 'ids'
        : undefined;
    if (!entityIdsPayloadKey) {
      throw new Error(
        `ConflictResolutionService: Cannot scope bulk delete ${group.deleteOp.actionType} - unsupported payload`,
      );
    }
    const scopedActionPayload: Record<string, unknown> = {
      ...originalActionPayload,
      [entityIdsPayloadKey]: retainedEntityIds,
    };
    if (Array.isArray(originalActionPayload['tasks'])) {
      scopedActionPayload['tasks'] = originalActionPayload['tasks'].filter((task) => {
        if (typeof task !== 'object' || task === null) {
          return false;
        }
        const snapshot = task as Record<string, unknown>;
        return (
          (typeof snapshot['id'] === 'string' &&
            retainedEntityIdSet.has(snapshot['id'])) ||
          (typeof snapshot['parentId'] === 'string' &&
            retainedEntityIdSet.has(snapshot['parentId']))
        );
      });
    }
    const scopedPayload = isMultiEntityPayload(originalPayload)
      ? {
          ...originalPayload,
          actionPayload: scopedActionPayload,
          entityChanges: originalPayload.entityChanges.filter((change) =>
            retainedEntityIdSet.has(change.entityId),
          ),
        }
      : scopedActionPayload;

    return {
      ...group.deleteOp,
      id: uuidv7(),
      entityId: retainedEntityIds[0],
      entityIds: retainedEntityIds,
      payload: scopedPayload,
      clientId,
      vectorClock: mergeAndIncrementClocks(allClocks, clientId),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
  }

  /**
   * #9537: preserves the surviving tasks of a bulk `moveToArchive` row that
   * lost one or more of its entities to a concurrent REMOTE archive — the
   * finish-day-on-two-devices race, where both clients archive overlapping
   * done tasks in one atomic op each.
   *
   * The losing bulk row is rejected as a unit. Without a replacement its
   * non-overlapping tasks would stay archived locally but never upload, so
   * every other device would keep them active forever. Mirroring
   * `_preservePartiallyRejectedLocalBulkDeletes`, this emits ONE scoped
   * replacement per bulk row — narrowed to the tasks no remote archive in the
   * batch covered, with a vector clock dominating every involved row. Tasks
   * the remote archive DID cover stay with the remote winner: both sides
   * agree those are archived, only the discarded local snapshot differs
   * (standard remote-archive-wins precedence).
   *
   * Groups whose every row won locally keep `buildArchiveWinOp`'s ONE full-set
   * recreation (#10102) unless one of their tasks was restored (below).
   * Groups key on the archive intent, so pre-#10102 duplicate copies of one
   * bulk archive form one group. When a group mixes winners (some tasks
   * remote-archived, others winning against plain remote edits), the
   * archive-win rows' full-set recreation is swapped for the scoped op so the
   * replacement cannot re-assert the remote-archived tasks' stale local
   * snapshots.
   *
   * Retained tasks that are back in the ACTIVE store (restored after the bulk
   * archive was captured) are dropped from the replacement — in all-local-win
   * groups and single-task archives too (#10220). Each such task gets a
   * current-state LWW Update re-asserting the restore: its own local-win row
   * rejects the raw restoreTask op (and, like any local LWW win, the update
   * overrides the concurrent remote edit); without a row, the kept
   * restoreTask alone is a no-op on devices that never saw the archive.
   * Degenerate multi-bulk histories (two pending bulk archives, or a bulk
   * archive plus a bulk delete, sharing a CONFLICTED task) never reach this
   * method: `_assertMultiEntityPlansAreSafe` keeps the fail-closed stop for
   * them. Overlaps confined to non-conflicted siblings still flow through
   * per-op and can re-assert a stale snapshot — a pre-existing hazard of the
   * whole preserve/recreate family, shared with `buildArchiveWinOp`.
   */
  async _preservePartiallyRejectedLocalBulkArchives(
    resolutions: LWWResolution[],
  ): Promise<Operation[]> {
    const additionalOps: Operation[] = [];
    // Rows of this batch resolve their own entity; re-assert the rest once.
    const handledKeys = new Set(
      resolutions.map(({ conflict: c }) => toEntityKey(c.entityType, c.entityId)),
    );
    for (const [intentKey, group] of groupArchiveResolutionsByIntent(resolutions)) {
      const retainedEntityIds = getBulkArchiveTopLevelIds(group.archiveOp).filter(
        (entityId) => !group.remoteWinnerIds.has(entityId),
      );

      // A retained task that is back in the ACTIVE store was restored (or
      // re-created) by a LATER local op — that op's own pending row is the
      // authoritative representation. Re-asserting the stale archive snapshot
      // with a dominating clock would silently override the restore on every
      // other device (and on this one after a status-blind replay). Mirrors
      // the later-local-delete guard in `_createLocalMultiReconciliationOps`.
      const stillArchivedEntityIds: string[] = [];
      for (const entityId of retainedEntityIds) {
        const activeEntity = await this.entityState.getCurrentEntityState(
          group.archiveOp.entityType,
          entityId,
        );
        if (activeEntity === undefined || activeEntity === null) {
          stillArchivedEntityIds.push(entityId);
        }
      }
      // Nothing to narrow: the full-set recreation stays correct (#10220).
      if (
        group.remoteWinnerIds.size === 0 &&
        stillArchivedEntityIds.length === retainedEntityIds.length
      ) {
        continue;
      }

      // With nothing left to re-assert, the replacement is skipped entirely —
      // any archive-win row still holding the FULL-SET recreation is handled
      // per-row below.
      const replacementOp =
        stillArchivedEntityIds.length > 0
          ? await this._createScopedBulkArchiveReplacement(group, stillArchivedEntityIds)
          : undefined;
      // Assign by the replacement's FULL footprint (parents + cascaded
      // subtasks): a child row of a retained parent left without a local-win
      // op wedges the batch on the mixed-winner throw. Remote-won families are
      // absent from the scoped payload and stay remote-won.
      const replacementFootprint = new Set(
        replacementOp ? getOpEntityIds(replacementOp) : [],
      );
      let assignedToLocalWinner = false;
      for (const resolution of group.resolutions) {
        if (
          resolution.winner !== 'local' ||
          resolution.localWinOp?.actionType !== ActionType.TASK_SHARED_MOVE_TO_ARCHIVE ||
          // Provenance binding: only swap a recreation built from THIS
          // group's intent (`buildArchiveWinOp` copies the intent verbatim).
          // A recreation derived from a different pending archive op must
          // stay untouched, or its group's replacement would be lost.
          getBulkArchiveIntentKey(resolution.localWinOp) !== intentKey
        ) {
          continue;
        }
        if (replacementOp && replacementFootprint.has(resolution.conflict.entityId)) {
          resolution.localWinOp = replacementOp;
          assignedToLocalWinner = true;
          continue;
        }
        // The row's own task was restored after the bulk archive: its archive
        // intent is obsolete, but the row still resolves winner=local and ALL
        // its raw local ops — including the pending restoreTask op — are
        // rejected with it. A bare undefined localWinOp would lose the
        // restore fleet-wide (nothing re-asserts the entity) and wedge the
        // mixed-winner compensation when the row's remote loser is a
        // multi-entity op, so re-assert the CURRENT active state — the
        // restore's outcome — as the row's local-win op instead.
        resolution.localWinOp = await this.localWinOps._createLocalWinUpdateOp(
          resolution.conflict,
        );
      }
      if (replacementOp && !assignedToLocalWinner) {
        additionalOps.push(replacementOp);
      }
      const restoredIds = retainedEntityIds.filter(
        (id) => !stillArchivedEntityIds.includes(id),
      );
      additionalOps.push(
        ...(await this._reassertRestoredTasks(group.archiveOp, restoredIds, handledKeys)),
      );
    }
    return additionalOps;
  }

  /**
   * #10220: a restored task's raw `restoreTask` is dropped with its own row,
   * and without a row it is a no-op wherever the rejected bulk archive never
   * landed (the task is still active there, still done). Re-assert its current
   * (restored) state and its subtasks' (`restoreToToday` clears their schedule)
   * with a clock over the root's pending ops, so each replays after the
   * restore. Entities with a row in the batch are skipped (the row resolves
   * them) and every entity is re-asserted once: `handledKeys` is updated.
   */
  private async _reassertRestoredTasks(
    archiveOp: Operation,
    rootIds: string[],
    handledKeys: Set<string>,
  ): Promise<Operation[]> {
    if (rootIds.length === 0) return [];
    const pendingByEntity = await this.opLogStore.getUnsyncedByEntity();
    const pendingFor = (id: string): Operation[] =>
      pendingByEntity.get(toEntityKey('TASK', id)) ?? [];
    const ops: Operation[] = [];
    for (const rootId of rootIds) {
      const root = (await this.entityState.getCurrentEntityState(
        'TASK',
        rootId,
      )) as Partial<Task>;
      const ids = [rootId, ...(root?.subTaskIds ?? [])];
      for (const entityId of ids) {
        const entityKey = toEntityKey('TASK', entityId);
        if (handledKeys.has(entityKey)) continue;
        handledKeys.add(entityKey);
        const ownOps = entityId === rootId ? [] : pendingFor(entityId);
        const op = await this.localWinOps._createLocalWinUpdateOp({
          entityType: 'TASK',
          entityId,
          localOps: [archiveOp, ...pendingFor(rootId), ...ownOps],
          remoteOps: [],
          suggestedResolution: 'local',
        });
        if (op) ops.push(op);
      }
    }
    return ops;
  }

  private async _createScopedBulkArchiveReplacement(
    { archiveOp, resolutions }: { archiveOp: Operation; resolutions: LWWResolution[] },
    retainedEntityIds: string[],
  ): Promise<Operation> {
    const clientId = await this.clientIdProvider.loadClientId();
    if (!clientId) {
      throw new Error(
        'ConflictResolutionService: Cannot preserve partial bulk archive - no client ID',
      );
    }
    const conflicts = resolutions.map(({ conflict }) => conflict);
    return buildScopedArchiveReplacementOp(
      { archiveOp, conflicts },
      retainedEntityIds,
      clientId,
    );
  }

  /**
   * #9426: preserves the surviving siblings of rejected `planTasksForToday`
   * bulk rows as ONE scoped replacement per row. The mechanism lives in
   * `preserve-partial-bulk-plan.util.ts` (pure); this wrapper only supplies
   * the client id.
   */
  async _preservePartiallyRejectedLocalBulkPlanOps(
    resolutions: LWWResolution[],
  ): Promise<Operation[]> {
    if (
      !resolutions.some((resolution) =>
        resolution.conflict.localOps.some(
          (op) =>
            SCOPED_PLAN_MULTI_ACTIONS.has(op.actionType) && isMultiEntityOperation(op),
        ),
      )
    ) {
      return [];
    }
    const clientId = await this.clientIdProvider.loadClientId();
    if (!clientId) {
      throw new Error(
        'ConflictResolutionService: Cannot preserve partial bulk plan - no client ID',
      );
    }
    return buildScopedBulkPlanReplacements(resolutions, clientId);
  }
}
