import { uuidv7 } from '../../util/uuid-v7';
import {
  incrementVectorClock,
  mergeVectorClocks,
  VectorClock,
} from '../../core/util/vector-clock';
import { OpLog } from '../../core/log';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';
import {
  ActionType,
  EntityConflict,
  extractActionPayload,
  isMultiEntityPayload,
  Operation,
} from '../core/operation.types';
import type { LwwResolvedConflict } from '@sp/sync-core';
import { getOpEntityIds } from '../util/get-op-entity-ids.util';

/**
 * The multi-entity UPDATE actions whose atomic local rows are preserved by a
 * scoped replacement when a conflict rejects them (#9426, #9405). Both are
 * dispatched by the automatic day-rollover with every matching task id
 * (`TaskDueEffects`), their reducers' per-task effect is a scheduling fold over
 * `taskIds`, and a narrowed row is a payload shape every released client
 * replays natively — single-task `planTasksForToday` dispatchers ship in
 * production (`TaskService.addToToday`, TaskComponent's add-to-my-day).
 *
 * Known bounded coupling, accepted: a task's plan/skip decision is evaluated
 * against RECEIVER state at replay time (e.g. the deadline fold skips a child
 * whose parent is due today), so a narrowed row can plan a task the original
 * atomic fold skipped, and vice versa. That state-dependence is inherent to
 * action-replay ops — the un-narrowed row replayed on a peer has it too — and
 * each client's own daily rollover re-derives the outcome.
 *
 * MEMBERSHIP CONTRACT: every action added here must carry its ids in
 * `actionPayload.taskIds`; the builder below skips (and logs) rows that do
 * not, so a mismatched future addition degrades to plain rejection instead of
 * silently replaying the un-narrowed id set.
 */
export const SCOPED_PLAN_MULTI_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>([
  ActionType.TASK_SHARED_PLAN_FOR_TODAY,
  ActionType.TASK_SHARED_PLAN_DEADLINE_FOR_TODAY,
]);

type ResolutionLike = LwwResolvedConflict<Operation, EntityConflict>;

interface BulkPlanResolutionGroup {
  planOp: Operation;
  resolutions: ResolutionLike[];
  coveredTargetIds: Set<string>;
  uncoveredTargetIds: Set<string>;
}

const mergeAndIncrementClocks = (
  clocks: VectorClock[],
  clientId: string,
): VectorClock => {
  let merged: VectorClock = {};
  for (const clock of clocks) {
    merged = mergeVectorClocks(merged, clock);
  }
  return incrementVectorClock(merged, clientId);
};

/**
 * #9426: a `planTasksForToday` bulk row is atomic, so any conflict rejects the
 * whole row even though the surviving siblings' plan intent (dueDay set to the
 * plan day, reminders cleared) is already applied locally and would otherwise
 * never upload. Mirror of the bulk-delete preserve
 * (`ConflictResolutionService._preservePartiallyRejectedLocalBulkDeletes`):
 * replace each affected row with ONE narrowed copy that
 *
 * - drops every COVERED conflict target id — remote winners are owned by the
 *   newer remote op, and local winners are carried by their whole-state
 *   `localWinOp` snapshot (a second op would ride an equal clock). A local win
 *   WITHOUT a covering snapshot (`localWinOp` undefined: the entity is absent
 *   from the live store, e.g. archive-sibling shapes) keeps its id instead —
 *   the reducers skip unknown task ids, so retaining it is at worst a replay
 *   no-op and can never silently drop the target's plan intent,
 * - keeps every other id with the original action payload and timestamp, and
 * - dominates every conflict clock involving the original row.
 *
 * When several plan rows are grouped in one batch (the multi-day compounding
 * case: a wedged client mints a new day-rollover op every day), replacements
 * are emitted in ascending original-timestamp order (op id as a deterministic
 * tie-break; the timestamp IS the LWW ordering the rest of resolution uses,
 * so it is the consistent choice even though wall clocks can regress). Their
 * proposed clocks may be identical (same merge base), which would be
 * CONCURRENT on the shared task ids — but every local append is rebased onto
 * the durable running clock in `appendMixedSourceBatchSkipDuplicates` (#8939),
 * so the WRITTEN rows are strictly ordered. Pinned by the multi-day case in
 * `today-plan-conflict-resolution.integration.spec.ts`, which fails if that
 * rebase is ever bypassed.
 *
 * Crash window (same as the bulk-delete preserve): the replacement becomes
 * durable in the atomic resolution batch, while the original row is only
 * markRejected after the apply phase. A crash in between leaves both pending;
 * the leaked original then re-plans its full id set on other clients — benign
 * for scheduling ops, and superseded by the replacement's dominating clock.
 */
export const buildScopedBulkPlanReplacements = (
  resolutions: ResolutionLike[],
  clientId: string,
): Operation[] => {
  const groups = new Map<string, BulkPlanResolutionGroup>();
  for (const resolution of resolutions) {
    for (const localOp of resolution.conflict.localOps) {
      if (
        !SCOPED_PLAN_MULTI_ACTIONS.has(localOp.actionType) ||
        getOpEntityIds(localOp).length <= 1
      ) {
        continue;
      }
      const group = groups.get(localOp.id) ?? {
        planOp: localOp,
        resolutions: [],
        coveredTargetIds: new Set<string>(),
        uncoveredTargetIds: new Set<string>(),
      };
      group.resolutions.push(resolution);
      const targetIsCovered =
        resolution.winner === 'remote' || resolution.localWinOp !== undefined;
      if (targetIsCovered) {
        group.coveredTargetIds.add(resolution.conflict.entityId);
      } else {
        group.uncoveredTargetIds.add(resolution.conflict.entityId);
      }
      groups.set(localOp.id, group);
    }
  }

  const orderedGroups = [...groups.values()].sort(
    (a, b) =>
      a.planOp.timestamp - b.planOp.timestamp || a.planOp.id.localeCompare(b.planOp.id),
  );
  const replacements: Operation[] = [];
  for (const group of orderedGroups) {
    const retainedEntityIds = getOpEntityIds(group.planOp).filter(
      (entityId) => !group.coveredTargetIds.has(entityId),
    );
    if (retainedEntityIds.length === 0) {
      continue;
    }
    const originalActionPayload = extractActionPayload(group.planOp.payload);
    if (
      typeof originalActionPayload !== 'object' ||
      originalActionPayload === null ||
      !Array.isArray(originalActionPayload['taskIds'])
    ) {
      // Membership-contract violation (see SCOPED_PLAN_MULTI_ACTIONS doc) or a
      // corrupt local row: emitting a replacement would replay the un-narrowed
      // id set on every client. Degrade to plain rejection instead — bounded
      // sibling-intent loss, never a wedge and never a resurrected winner.
      OpLog.err(
        `buildScopedBulkPlanReplacements: cannot scope ${group.planOp.actionType} ` +
          `row ${group.planOp.id} (payload carries no taskIds array); ` +
          `dropping its ${retainedEntityIds.length} surviving sibling(s).`,
      );
      continue;
    }
    if (group.uncoveredTargetIds.size > 0) {
      // Deliberate cross-client effect from a snapshot-less local win (entity
      // absent from the live store): the retained ids re-assert plan intent on
      // receivers while this client's replay skips them. Logged because it is
      // the one branch here whose effect is invisible locally.
      OpLog.warn(
        `buildScopedBulkPlanReplacements: retaining ${group.uncoveredTargetIds.size} ` +
          `uncovered local-win target(s) of row ${group.planOp.id} in the replacement.`,
      );
    }

    const allClocks = group.resolutions.flatMap(({ conflict }) => [
      ...conflict.localOps.map((op) => op.vectorClock),
      ...conflict.remoteOps.map((op) => op.vectorClock),
    ]);
    const newClock = mergeAndIncrementClocks(allClocks, clientId);

    const retainedSet = new Set(retainedEntityIds);
    const scopedActionPayload: Record<string, unknown> = {
      ...originalActionPayload,
      taskIds: retainedEntityIds,
    };
    const parentTaskMap = originalActionPayload['parentTaskMap'];
    if (parentTaskMap && typeof parentTaskMap === 'object') {
      scopedActionPayload['parentTaskMap'] = Object.fromEntries(
        Object.entries(parentTaskMap as Record<string, unknown>).filter(([taskId]) =>
          retainedSet.has(taskId),
        ),
      );
    }
    const scopedPayload = isMultiEntityPayload(group.planOp.payload)
      ? {
          ...group.planOp.payload,
          actionPayload: scopedActionPayload,
          entityChanges: group.planOp.payload.entityChanges.filter((change) =>
            retainedSet.has(change.entityId),
          ),
        }
      : scopedActionPayload;

    replacements.push({
      ...group.planOp,
      id: uuidv7(),
      entityId: retainedEntityIds[0],
      entityIds: retainedEntityIds,
      payload: scopedPayload,
      clientId,
      vectorClock: newClock,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });
  }
  return replacements;
};
