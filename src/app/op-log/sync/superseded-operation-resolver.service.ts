import { inject, Injectable } from '@angular/core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import {
  ActionType,
  isFullStateOpType,
  isLwwUpdatePayload,
  Operation,
  OperationLogEntry,
  OpType,
  VectorClock,
} from '../core/operation.types';
import {
  compareVectorClocks,
  mergeVectorClocks,
  VectorClockComparison,
} from '../../core/util/vector-clock';
import { OpLog } from '../../core/log';
import {
  ConflictResolutionService,
  getLatestTaskProjectMoveEntityIds,
} from './conflict-resolution.service';
import { VectorClockService } from './vector-clock.service';
import { LockService } from './lock.service';
import { toEntityKey } from '../util/entity-key.util';
import { LOCK_NAMES } from '../core/operation-log.const';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import { uuidv7 } from '../../util/uuid-v7';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';
import {
  areCommutingSectionOperations,
  projectSectionReplayAgainstState,
  SectionReplayOrder,
  SectionReplayStateCompensation,
} from './section-conflict-commutativity.util';
import { getOpEntityIds } from '../util/get-op-entity-ids.util';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { OperationCaptureService } from '../capture/operation-capture.service';
import { getPhantomChangeRisk } from '../capture/phantom-change-guard.util';
import { SectionState } from '../../features/section/section.model';
import { ProjectState } from '../../features/project/project.model';
import { TagState } from '../../features/tag/tag.model';
import { Task } from '../../features/tasks/task.model';
import {
  areCommutingReorderAndContentOperations,
  isContentReorderOperation,
  isReissuableReorder,
  isReissuedReorderCrossing,
  isReorderConflictOperation,
  projectReorderConflictAgainstState,
  ReorderReplaySnapshot,
  selectCrossedPendingReorders,
} from './reorder-conflict.util';
import { UnsupportedMultiEntityConflictError } from '../core/errors/sync-errors';
import {
  isCommutingTimeDeltaCrossing,
  isDisjointMergeEligible,
  touchesCrossEntityTaskFields,
} from './conflict-disjoint-merge.util';
import { getPayloadKey } from '../core/entity-registry';
import { asPatchSnapshotIfTypeShadowed } from './lww-snapshot-patch-mode.util';
import { supersededPatchFields } from './conflict-field-patch.util';

type SupersededOperation = {
  opId: string;
  op: Operation;
  existingClock?: VectorClock;
};

type SectionCausalReplayDecision = 'replay' | 'fallback';
type WorkContextStateProjection = SectionReplayStateCompensation;
interface OrderedSectionReplacement {
  operation: Operation;
  order: SectionReplayOrder;
  originalIndex: number;
}

interface SectionCausalReplayContext {
  retainedByEntityClock: Map<string, OperationLogEntry[]>;
}

const CAUSALLY_REPLAYABLE_SECTION_ACTIONS = new Set<ActionType>([
  ActionType.SECTION_UPDATE_ORDER,
  ActionType.SECTION_ADD_TASK,
  ActionType.SECTION_REMOVE_TASK,
]);

const getEntityClockIndexKey = (
  entityType: Operation['entityType'],
  entityId: string,
  vectorClock: VectorClock,
): string =>
  JSON.stringify([
    entityType,
    entityId,
    Object.entries(vectorClock).sort(([first], [second]) => first.localeCompare(second)),
  ]);

const addToIndex = (
  index: Map<string, OperationLogEntry[]>,
  key: string,
  entry: OperationLogEntry,
): void => {
  const entries = index.get(key);
  if (entries) {
    entries.push(entry);
  } else {
    index.set(key, [entry]);
  }
};

const buildSectionCausalReplayContext = (
  retainedEntries: OperationLogEntry[],
): SectionCausalReplayContext => {
  const retainedByEntityClock = new Map<string, OperationLogEntry[]>();

  for (const entry of retainedEntries) {
    for (const entityId of getOpEntityIds(entry.op)) {
      addToIndex(
        retainedByEntityClock,
        getEntityClockIndexKey(entry.op.entityType, entityId, entry.op.vectorClock),
        entry,
      );
    }
  }

  return { retainedByEntityClock };
};

/**
 * Resolves superseded local operations that were rejected due to concurrent modification.
 *
 * ## When Superseded Operations Occur
 * During sync, the server may reject local operations if their vector clocks
 * are dominated by operations from other clients. This means our local changes
 * are based on outdated state.
 *
 * ## Resolution Strategy
 * Instead of losing local changes, we:
 * 1. Mark the old pending ops as rejected (their clocks are superseded)
 * 2. Create NEW ops with the current entity state and merged vector clocks
 * 3. The new ops will be uploaded on next sync cycle
 *
 * This preserves local changes while ensuring vector clocks properly dominate
 * all known operations.
 */
@Injectable({
  providedIn: 'root',
})
export class SupersededOperationResolverService {
  private opLogStore = inject(OperationLogStoreService);
  private vectorClockService = inject(VectorClockService);
  private conflictResolutionService = inject(ConflictResolutionService);
  private lockService = inject(LockService);
  private snackService = inject(SnackService);
  private clientIdProvider = inject(CLIENT_ID_PROVIDER);
  private stateSnapshotService = inject(StateSnapshotService);
  private operationCapture = inject(OperationCaptureService);

  /**
   * Re-creates an operation with a merged vector clock, preserving its original payload.
   * Used for operations whose entities are no longer in the NgRx store (DELETE, moveToArchive).
   */
  private _recreateOpWithMergedClock(
    sourceOp: Operation,
    vectorClock: VectorClock,
    clientId: string,
    timestamp: number,
  ): Operation {
    return {
      id: uuidv7(),
      actionType: sourceOp.actionType,
      opType: sourceOp.opType,
      entityType: sourceOp.entityType,
      entityId: sourceOp.entityId,
      entityIds: sourceOp.entityIds,
      payload: sourceOp.payload,
      clientId,
      vectorClock,
      timestamp,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
  }

  /**
   * Re-creates a superseded `restoreTask` as a `restoreTask` projected from live
   * state (the task and its current subtasks), so remote edits applied since
   * the restore ride along. An LWW Update would recreate the task on receivers
   * without the archive cleanup only the semantic restore triggers, leaving a
   * stale archived copy next to the active task (#10196).
   */
  private async _createLiveRestoreOp(
    sourceOp: Operation,
    liveTask: Task,
    vectorClock: VectorClock,
    clientId: string,
  ): Promise<Operation> {
    const subTasks: Task[] = [];
    for (const subTaskId of liveTask.subTaskIds ?? []) {
      const subTask = await this.conflictResolutionService.getCurrentEntityState(
        'TASK',
        subTaskId,
      );
      if (subTask) {
        subTasks.push(subTask as Task);
      }
    }
    // Scheduling is already materialized in liveTask. Replaying the original
    // restoreToToday would undo later Planner moves, whose PLANNER ops do not
    // share this restore's TASK conflict group.
    const actionPayload = { task: liveTask, subTasks };
    return this._recreateOpWithMergedClock(
      { ...sourceOp, payload: { actionPayload, entityChanges: [] } },
      vectorClock,
      clientId,
      sourceOp.timestamp,
    );
  }

  private _getSectionCausalReplayDecision(
    item: SupersededOperation,
    context: SectionCausalReplayContext,
  ): SectionCausalReplayDecision {
    if (
      !CAUSALLY_REPLAYABLE_SECTION_ACTIONS.has(item.op.actionType) &&
      !isReorderConflictOperation(item.op)
    ) {
      return 'fallback';
    }
    const row = this._findAppliedConflictRow(item, context);
    return row &&
      (areCommutingSectionOperations(item.op, row.op) ||
        areCommutingReorderAndContentOperations(item.op, row.op) ||
        (isContentReorderOperation(item.op) &&
          isReissuedReorderCrossing(item.op, row.op)))
      ? 'replay'
      : 'fallback';
  }

  /**
   * The causal proof for a rejection: the one retained row whose clock is the
   * `existingClock` the server compared against, when it is an applied, synced
   * remote op concurrent with the rejected one. Delta-only recovery also
   * admits a timeless successor patch, including this client's own patch.
   */
  private _findAppliedConflictRow(
    item: SupersededOperation,
    context: SectionCausalReplayContext,
    allowTimelessSuccessor = false,
  ): OperationLogEntry | undefined {
    const existingClock = item.existingClock;
    if (
      !existingClock ||
      (compareVectorClocks(item.op.vectorClock, existingClock) !==
        VectorClockComparison.CONCURRENT &&
        !(
          allowTimelessSuccessor &&
          compareVectorClocks(item.op.vectorClock, existingClock) ===
            VectorClockComparison.LESS_THAN
        ))
    ) {
      return undefined;
    }

    const itemEntityIds = getOpEntityIds(item.op);
    const matchingRetainedEntriesById = new Map<string, OperationLogEntry>();
    for (const entityId of itemEntityIds) {
      const indexKey = getEntityClockIndexKey(
        item.op.entityType,
        entityId,
        existingClock,
      );
      for (const entry of context.retainedByEntityClock.get(indexKey) ?? []) {
        if (entry.op.id !== item.op.id) {
          matchingRetainedEntriesById.set(entry.op.id, entry);
        }
      }
    }
    const matchingRetainedEntries = Array.from(matchingRetainedEntriesById.values());
    const row = matchingRetainedEntries[0];
    // A later patch may have been accepted while this delta was rejected.
    // Its merged clock can cover the delta without carrying any of its time.
    // Read only patch keys through the existing commuting predicate (D5a).
    const isTimelessSuccessor =
      allowTimelessSuccessor &&
      row &&
      isLwwUpdatePayload(row.op.payload) &&
      isCommutingTimeDeltaCrossing({
        localOps: [item.op],
        remoteOps: [row.op],
        payloadKey: 'task',
        entityId: item.op.entityId!,
      });
    return matchingRetainedEntries.length === 1 &&
      row.syncedAt !== undefined &&
      ((row.source === 'remote' && row.applicationStatus === 'applied') ||
        (isTimelessSuccessor &&
          row.source === 'local' &&
          row.op.clientId === item.op.clientId)) &&
      (compareVectorClocks(item.op.vectorClock, row.op.vectorClock) ===
        VectorClockComparison.CONCURRENT ||
        isTimelessSuccessor) &&
      row.rejectedAt === undefined &&
      row.reducerRejectedAt === undefined
      ? row
      : undefined;
  }

  /**
   * #10214 follow-up. Conflict detection applies a remote row that commutes
   * with a task's pending time work (`isCommutingTimeDeltaCrossing`) and keeps
   * the pending ops as they are, so their clocks miss the row and the server
   * rejects them. Rebase every pending op of such a task past the row IN PLACE
   * (`rebasePendingLocalOps`): a `syncTimeSpent` delta stays additive instead
   * of becoming an LWW snapshot that overwrites other devices' concurrent time,
   * and it still replays exactly once. The proof is the applied row whose clock
   * the server compared against, so no full re-download is needed. A timeless
   * successor patch is also admissible when every intervening task op commutes.
   *
   * SuperSync checks duplicate IDs before conflicts: a conflict rejection
   * proves this ID was absent at that decision. An ambiguous/lost response
   * proves nothing and must retry the original identity, also on file providers.
   * Only ops this upload got rejected move, and no other tab uploads meanwhile
   * (UPLOAD lock). Any other pending op may be one another tab uploaded and has
   * not marked synced yet; moving it would turn its re-upload into an
   * INVALID_OP_ID.
   *
   * @param assertFence re-asserts the sync cycle's epoch before the write (#9074)
   * @returns ids of the rebased ops; they stay pending and need an upload
   */
  async rebaseCommutingTimeDeltaRejections(
    rejectedOps: SupersededOperation[],
    assertFence?: (context: string) => void,
  ): Promise<Set<string>> {
    const rebasedOpIds = new Set<string>();
    const rejectedOpIds = new Set(rejectedOps.map(({ opId }) => opId));
    const rejectedByTask = new Map<string, SupersededOperation[]>();
    for (const item of rejectedOps) {
      const { op, existingClock } = item;
      if (
        existingClock &&
        compareVectorClocks(op.vectorClock, existingClock) ===
          VectorClockComparison.GREATER_THAN
      ) {
        // Rebased already (e.g. by another tab) and this tab sent a stale cached
        // copy: the stored op is accepted once the cache is dropped.
        rebasedOpIds.add(item.opId);
      } else if (
        op.entityType === 'TASK' &&
        op.entityId &&
        getOpEntityIds(op).length === 1
      ) {
        rejectedByTask.set(op.entityId, [
          ...(rejectedByTask.get(op.entityId) ?? []),
          item,
        ]);
      }
    }
    if (rebasedOpIds.size > 0) {
      this.opLogStore.invalidateUnsyncedCache();
    }
    if (rejectedByTask.size === 0) {
      return rebasedOpIds;
    }

    // UPLOAD before OPERATION_LOG, the order the upload service takes them in.
    const underLocks = (work: () => Promise<void>): Promise<void> =>
      this.lockService.request(LOCK_NAMES.UPLOAD, () =>
        this.lockService.request(LOCK_NAMES.OPERATION_LOG, work),
      );
    await underLocks(async () => {
      const clientId = await this.clientIdProvider.loadClientId();
      const pendingEntries = (await this.opLogStore.getUnsynced()).filter(
        ({ op }) =>
          op.entityType === 'TASK' &&
          getOpEntityIds(op).some((id) => rejectedByTask.has(id)),
      );
      if (pendingEntries.length === 0) {
        return;
      }
      // A pending op concurrent with an applied row was captured before that
      // row was appended, so only the tail after the oldest one can hold it.
      const tail = await this.opLogStore.getOpsAfterSeq(pendingEntries[0].seq);
      const context = buildSectionCausalReplayContext(tail);
      const payloadKey = getPayloadKey('TASK') ?? 'task';
      for (const [taskId, items] of rejectedByTask) {
        // Seq order; every pending op of the task moves so their clocks keep it.
        const taskEntries = pendingEntries.filter(({ op }) =>
          getOpEntityIds(op).includes(taskId),
        );
        if (taskEntries.length === 0) {
          continue;
        }
        const pendingOps = taskEntries.map(({ op }) => op);
        const onlyDeltas = pendingOps.every(
          (op) => op.actionType === ActionType.TIME_TRACKING_SYNC_TIME_SPENT,
        );
        // The server may already hold later ops of the task from this client:
        // against a crossing delta it accepts this client's own delta and each
        // op dominating it. Receivers apply the moved ops after those, so they
        // must commute, or a second rename would lose to the first everywhere.
        // Any entity type counts: a planner move declares the task it moves.
        const acceptedLaterOps = tail
          .filter(
            ({ seq, op, source, syncedAt }) =>
              source === 'local' &&
              syncedAt !== undefined &&
              seq > (taskEntries[0]?.seq ?? Infinity) &&
              getOpEntityIds(op).includes(taskId),
          )
          .map(({ op }) => op);
        let clockToDominate: VectorClock = {};
        const isProven =
          pendingOps.every(
            (op) =>
              rejectedOpIds.has(op.id) &&
              op.clientId === clientId &&
              getOpEntityIds(op).length === 1,
          ) &&
          // Ops of other entity types write these task fields too, where no
          // check here sees them (deleting a tag rewrites every task's tagIds).
          // A moved op touching one could land on the wrong side of such a write.
          (onlyDeltas ||
            !touchesCrossEntityTaskFields(
              [...pendingOps, ...acceptedLaterOps],
              payloadKey,
              taskId,
            )) &&
          // A delta moved past its successor must commute with the entire
          // intervening task history, not just the last patch. A replace or
          // absolute time write could already include its contribution.
          (!onlyDeltas ||
            tail.every(
              ({ seq, op }) =>
                seq <= taskEntries[0].seq ||
                (!isFullStateOpType(op.opType) &&
                  (!getOpEntityIds(op).includes(taskId) ||
                    isCommutingTimeDeltaCrossing({
                      localOps: pendingOps,
                      remoteOps: [op],
                      payloadKey,
                      entityId: taskId,
                    }))),
            )) &&
          (acceptedLaterOps.length === 0 ||
            onlyDeltas ||
            isDisjointMergeEligible({
              localOps: pendingOps,
              remoteOps: acceptedLaterOps,
              payloadKey,
              entityId: taskId,
            })) &&
          items.every((item) => {
            const row = this._findAppliedConflictRow(item, context, onlyDeltas);
            if (!row) return false;
            const crossing = pendingOps.filter(
              (op) =>
                onlyDeltas ||
                compareVectorClocks(op.vectorClock, row.op.vectorClock) ===
                  VectorClockComparison.CONCURRENT,
            );
            clockToDominate = mergeVectorClocks(clockToDominate, row.op.vectorClock);
            return (
              crossing.some((op) => op.id === item.opId) &&
              isCommutingTimeDeltaCrossing({
                localOps: crossing,
                remoteOps: [row.op],
                payloadKey,
                entityId: taskId,
              })
            );
          });
        if (!isProven) {
          continue;
        }
        assertFence?.('time-delta rejection rebase');
        const rebased = await this.opLogStore.rebasePendingLocalOps(
          pendingOps.map((op) => op.id),
          clockToDominate,
        );
        rebased.forEach((op) => rebasedOpIds.add(op.id));
        OpLog.normal(
          `SupersededOperationResolverService: Rebased ${rebased.length} pending op(s) ` +
            `of TASK:${taskId} past a commuting remote edit`,
        );
      }
    });
    return rebasedOpIds;
  }

  /**
   * Reads a reducer-state frontier that is fully represented by durable ops.
   * This check and the synchronous snapshot read deliberately have no await
   * between them. Later user actions wait behind the operation-log lock for
   * persistence and therefore follow the compensation in durable order.
   */
  private _getStableSectionReplaySnapshot(): ReorderReplaySnapshot {
    const phantomRisk = getPhantomChangeRisk(this.operationCapture);
    if (phantomRisk) {
      throw new Error(`Cannot project SECTION conflict recovery while ${phantomRisk}.`);
    }
    const snapshot = this.stateSnapshotService.getStateSnapshotForOperationLog();
    return {
      section: snapshot.section as SectionState,
      project: snapshot.project as ProjectState,
      tag: snapshot.tag as TagState,
      note: snapshot.note as ReorderReplaySnapshot['note'],
      simpleCounter: snapshot.simpleCounter as ReorderReplaySnapshot['simpleCounter'],
      boards: snapshot.boards as ReorderReplaySnapshot['boards'],
      issueProvider: snapshot.issueProvider as ReorderReplaySnapshot['issueProvider'],
    };
  }

  /**
   * Resolves superseded local operations by creating new LWW Update operations.
   *
   * @param supersededOps - Operations that were rejected due to concurrent modification
   * @param extraClocks - Additional clocks to merge (from force download)
   * @param snapshotVectorClock - Aggregated clock from snapshot optimization (if available)
   * @returns Number of merged ops created
   */
  async resolveSupersededLocalOps(
    supersededOps: SupersededOperation[],
    extraClocks?: VectorClock[],
    snapshotVectorClock?: VectorClock,
    callerHoldsLock = false,
  ): Promise<number> {
    // Acquire lock to prevent race conditions with operation capture and other sync operations.
    // Without this lock, user actions during conflict resolution could write ops with
    // superseded vector clocks, leading to data corruption.
    let result = 0;
    const resolve = async (): Promise<void> => {
      const clientId = await this.clientIdProvider.loadClientId();
      if (!clientId) {
        OpLog.err(
          'SupersededOperationResolverService: Cannot resolve superseded ops - no client ID',
        );
        return;
      }

      // Get the GLOBAL vector clock which includes snapshot + all ops after
      // This ensures we have all known clocks, not just entity-specific ones
      let globalClock = await this.vectorClockService.getCurrentVectorClock();

      // Merge snapshot vector clock if available (from server's snapshot optimization)
      // This ensures we have the clocks from ops that were skipped during download
      if (snapshotVectorClock && Object.keys(snapshotVectorClock).length > 0) {
        OpLog.normal(
          `SupersededOperationResolverService: Merging snapshotVectorClock with ${Object.keys(snapshotVectorClock).length} entries`,
        );
        globalClock = mergeVectorClocks(globalClock, snapshotVectorClock);
      }

      // If extra clocks were provided (from force download), merge them all
      // This helps recover from situations where our local clock is missing entries
      if (extraClocks && extraClocks.length > 0) {
        OpLog.normal(
          `SupersededOperationResolverService: Merging ${extraClocks.length} clocks from force download`,
        );
        for (const clock of extraClocks) {
          globalClock = mergeVectorClocks(globalClock, clock);
        }
      }

      const opsToReject: string[] = [];
      const newOpsCreated: Operation[] = [];
      const auxiliaryOpIds = new Set<string>();
      const orderedSectionReplacements: OrderedSectionReplacement[] = [];

      // Handle irreducible semantic operations BEFORE entity-by-entity grouping.
      // moveToArchive uses OpType.Update but its reducer removes entities from the NgRx store
      // (via deleteTaskHelper). This is the ONLY action with this pattern — all other entity
      // removals use OpType.Delete (handled below). The normal resolution path would call
      // getCurrentEntityState() → undefined → discard, permanently losing the archive.
      // Instead, re-create the operation with a merged clock preserving the original payload.
      //
      // SECTION order/placement operations also carry reducer semantics that an
      // entity snapshot cannot represent. Re-create one only when the exact
      // applied server row proves a commuting crossing. Project its payload
      // against one stable live-state frontier so anchors and every later local
      // successor are represented without an action-family allowlist. A recognized
      // reorder without this proof must stay pending: entity LWW cannot carry it.
      // Absolute habit counts are projected without the proof (see below).
      const regularSupersededOps: SupersededOperation[] = [];
      let sectionReplayContext: SectionCausalReplayContext | undefined;
      let sectionReplaySnapshot: ReorderReplaySnapshot | undefined;
      for (const [itemIndex, item] of supersededOps.entries()) {
        let projectedSectionOp: Operation | undefined;
        let projectedWorkContextState: WorkContextStateProjection | undefined;
        let projectedOrder: SectionReplayOrder | undefined;
        // An absolute dated count needs no causal proof: reissuing its
        // current value is a local no-op and, unlike a whole-habit LWW snapshot,
        // leaves every other field (and released receivers' SimpleCounter.type)
        // alone. Stopping sync for it would block habit clicks.
        const isCounterSet =
          item.op.actionType === ActionType.COUNTER_SET_TODAY ||
          item.op.actionType === ActionType.COUNTER_SET_FOR_DATE;
        if (
          isCounterSet ||
          ((CAUSALLY_REPLAYABLE_SECTION_ACTIONS.has(item.op.actionType) ||
            isReorderConflictOperation(item.op)) &&
            item.existingClock)
        ) {
          let replayDecision: SectionCausalReplayDecision = 'replay';
          if (!isCounterSet) {
            sectionReplayContext ??= buildSectionCausalReplayContext(
              await this.opLogStore.getOpsAfterSeq(0),
            );
            replayDecision = this._getSectionCausalReplayDecision(
              item,
              sectionReplayContext,
            );
          }
          if (replayDecision === 'replay') {
            sectionReplaySnapshot ??= this._getStableSectionReplaySnapshot();
            const projection = isReorderConflictOperation(item.op)
              ? projectReorderConflictAgainstState(item.op, sectionReplaySnapshot)
              : projectSectionReplayAgainstState(item.op, sectionReplaySnapshot);
            if (projection.kind === 'superseded') {
              opsToReject.push(item.opId);
              OpLog.normal(
                `SupersededOperationResolverService: Replayable intent ${item.opId} ` +
                  'was superseded by the current durable state.',
              );
              continue;
            }
            if (projection.kind === 'blocked') {
              OpLog.warn(
                `SupersededOperationResolverService: Cannot safely project SECTION ` +
                  `intent ${item.opId}: ${projection.reason}.`,
              );
            } else if (projection.kind === 'work-context-state') {
              projectedWorkContextState = projection;
            } else {
              projectedSectionOp = projection.operation;
              projectedOrder = projection.order;
              projectedWorkContextState = projection.stateCompensation;
            }
          }
        }

        // Compaction can remove the applied conflict row while retaining the
        // unsynced reorder. Entity LWW cannot carry that list write: keep it pending.
        if (
          isContentReorderOperation(item.op) &&
          !projectedSectionOp &&
          !projectedWorkContextState
        ) {
          throw new UnsupportedMultiEntityConflictError(
            'local',
            item.op.actionType,
            getOpEntityIds(item.op).length,
          );
        }

        if (
          item.op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE ||
          projectedSectionOp ||
          projectedWorkContextState
        ) {
          const clocksToMerge = [globalClock, item.op.vectorClock];
          if ((projectedSectionOp || projectedWorkContextState) && item.existingClock) {
            clocksToMerge.push(item.existingClock);
          }
          const mergedClock = this.conflictResolutionService.mergeAndIncrementClocks(
            clocksToMerge,
            clientId,
          );
          // Don't prune here — the server prunes AFTER conflict detection (before storage).
          // Client-side pruning would drop entity clock IDs when the merged clock exceeds
          // MAX_VECTOR_CLOCK_SIZE, causing the comparison to return CONCURRENT instead of
          // GREATER_THAN → infinite rejection loop.
          const replacements: Array<{
            operation: Operation;
            order: SectionReplayOrder | undefined;
          }> = [];
          if (projectedSectionOp) {
            replacements.push({
              operation: this._recreateOpWithMergedClock(
                projectedSectionOp,
                mergedClock,
                clientId,
                item.op.timestamp,
              ),
              order: projectedOrder,
            });
          }
          if (projectedWorkContextState) {
            replacements.push({
              operation: this.conflictResolutionService.createLWWUpdateOp(
                projectedWorkContextState.entityType,
                projectedWorkContextState.entityId,
                projectedWorkContextState.entityState,
                clientId,
                mergedClock,
                item.op.timestamp,
                'replace',
              ),
              order: projectedWorkContextState.order,
            });
          }
          if (replacements.length === 0) {
            replacements.push({
              operation: this._recreateOpWithMergedClock(
                item.op,
                mergedClock,
                clientId,
                item.op.timestamp,
              ),
              order: undefined,
            });
          }
          for (const { operation, order } of replacements) {
            if (order) {
              orderedSectionReplacements.push({
                operation,
                order,
                originalIndex: itemIndex,
              });
            } else {
              newOpsCreated.push(operation);
            }
            OpLog.normal(
              `SupersededOperationResolverService: Created causal replacement ` +
                `${operation.actionType} op ${operation.id}, replacing superseded op ${item.opId}`,
            );
          }
          opsToReject.push(item.opId);
        } else {
          regularSupersededOps.push(item);
        }
      }
      orderedSectionReplacements.sort(
        (first, second) =>
          first.order.scope.localeCompare(second.order.scope) ||
          first.order.position - second.order.position ||
          first.originalIndex - second.originalIndex,
      );
      newOpsCreated.push(...orderedSectionReplacements.map(({ operation }) => operation));

      // Group remaining ops by entity to handle multiple ops for the same entity
      const opsByEntity = new Map<string, SupersededOperation[]>();
      for (const item of regularSupersededOps) {
        // Skip ops without entityId (shouldn't happen for entity-level ops)
        if (!item.op.entityId) {
          OpLog.normal(
            `SupersededOperationResolverService: Skipping superseded op ${item.opId} - no entityId`,
          );
          continue;
        }
        const entityKey = toEntityKey(item.op.entityType, item.op.entityId);
        if (!opsByEntity.has(entityKey)) {
          opsByEntity.set(entityKey, []);
        }
        opsByEntity.get(entityKey)!.push(item);
      }
      let discardedChangesCount = 0;

      for (const [entityKey, entityOps] of opsByEntity) {
        // Get the first op to determine entity type and ID
        const firstOp = entityOps[0].op;
        const entityType = firstOp.entityType;
        const entityId = firstOp.entityId!; // Non-null - we filtered out ops without entityId above

        // Start with the global clock, merge in local pending ops' clocks, and increment
        const allClocks = [globalClock, ...entityOps.map(({ op }) => op.vectorClock)];
        const mergedClock = this.conflictResolutionService.mergeAndIncrementClocks(
          allClocks,
          clientId,
        );
        // Don't prune here — the server prunes AFTER conflict detection (before storage).
        // See moveToArchive comment above for full explanation.

        // Check if all superseded ops for this entity are DELETE operations
        const allOpsAreDeletes = entityOps.every((e) => e.op.opType === OpType.Delete);

        if (allOpsAreDeletes) {
          // For DELETE operations, we can't get current state (entity is deleted).
          // Create a new DELETE operation with merged clock instead of UPDATE.
          // Use the first op's actionType and payload since they're self-contained.
          const preservedTimestamp = Math.max(...entityOps.map((e) => e.op.timestamp));
          const newDeleteOp = this._recreateOpWithMergedClock(
            entityOps[0].op,
            mergedClock,
            clientId,
            preservedTimestamp,
          );

          newOpsCreated.push(newDeleteOp);
          opsToReject.push(...entityOps.map((e) => e.opId));

          OpLog.normal(
            `SupersededOperationResolverService: Created replacement DELETE op for ${entityKey}, ` +
              `replacing ${entityOps.length} superseded DELETE op(s). New clock: ${JSON.stringify(mergedClock)}`,
          );
          continue;
        }

        // Get current entity state from NgRx store
        const entityState = await this.conflictResolutionService.getCurrentEntityState(
          entityType,
          entityId,
        );
        if (entityState === undefined) {
          OpLog.normal(
            `SupersededOperationResolverService: Cannot create update op - entity not found: ${entityKey}`,
          );
          // Still mark the ops as rejected, but track that changes were discarded
          opsToReject.push(...entityOps.map((e) => e.opId));
          discardedChangesCount += entityOps.length;
          continue;
        }

        // Only a SOLE restore keeps its semantic type: a restore is a no-op on
        // receivers where the task is already active, so it could not carry
        // later edits of the same task there — those keep the LWW snapshot.
        if (
          entityOps.length === 1 &&
          firstOp.actionType === ActionType.TASK_SHARED_RESTORE &&
          entityType === 'TASK'
        ) {
          const restoreOp = await this._createLiveRestoreOp(
            firstOp,
            entityState as Task,
            mergedClock,
            clientId,
          );
          newOpsCreated.push(restoreOp);
          opsToReject.push(entityOps[0].opId);
          OpLog.normal(
            `SupersededOperationResolverService: Created replacement restoreTask op ` +
              `${restoreOp.id} for ${entityKey}, replacing superseded op ${entityOps[0].opId}`,
          );
          continue;
        }

        // Preserve the maximum timestamp from the superseded ops being replaced.
        // This is critical for LWW conflict resolution: if we use Date.now(), the new op
        // would have a later timestamp than the original user action, causing it to
        // incorrectly win against concurrent ops that were actually made earlier.
        const preservedTimestamp = Math.max(...entityOps.map((e) => e.op.timestamp));
        const projectMoveEntityIds = getLatestTaskProjectMoveEntityIds(
          entityOps.map(({ op }) => op),
        );
        const declaredEntityIds = projectMoveEntityIds
          ? Array.from(new Set([entityId, ...projectMoveEntityIds]))
          : undefined;

        // Re-emit only the fields the rejected ops wrote, read from current
        // state, when a patch can carry them all; otherwise the whole entity.
        const patchFields = supersededPatchFields(
          entityOps.map(({ op }) => op),
          entityType,
          getPayloadKey(entityType) ?? entityType.toLowerCase(),
          entityId,
        );
        const liveEntity = entityState as Record<string, unknown>;
        let newOp = this.conflictResolutionService.createLWWUpdateOp(
          entityType,
          entityId,
          patchFields
            ? Object.fromEntries(patchFields.map((field) => [field, liveEntity[field]]))
            : entityState,
          clientId,
          mergedClock,
          preservedTimestamp,
          patchFields ? 'patch' : 'replace',
          declaredEntityIds,
          // A written field that is absent now is a clear the ops declared.
          !!patchFields,
        );

        if (
          entityOps.some(
            ({ op }) =>
              isLwwUpdatePayload(op.payload) &&
              op.payload.recreatesEntityAfterDelete === true,
          ) &&
          isLwwUpdatePayload(newOp.payload)
        ) {
          newOp = {
            ...newOp,
            payload: {
              ...newOp.payload,
              recreatesEntityAfterDelete: true,
            },
          };
        }
        newOp = asPatchSnapshotIfTypeShadowed(newOp);

        newOpsCreated.push(newOp);
        const followUpOps =
          await this.conflictResolutionService.createTaskRecreationFollowUpOps(newOp);
        for (const followUpOp of followUpOps) {
          newOpsCreated.push(followUpOp);
          auxiliaryOpIds.add(followUpOp.id);
        }
        opsToReject.push(...entityOps.map((e) => e.opId));

        OpLog.normal(
          `SupersededOperationResolverService: Created LWW update op for ${entityKey}, ` +
            `replacing ${entityOps.length} superseded op(s). New clock: ${JSON.stringify(mergedClock)}`,
        );
      }

      // Persist replacements, rebase their clocks, and retire their stale
      // predecessors in one transaction. A crash can therefore expose neither
      // half of the recovery on its own.
      if (newOpsCreated.length > 0 || opsToReject.length > 0) {
        const { written } = await this.opLogStore.appendMixedSourceBatchSkipDuplicates(
          [{ ops: newOpsCreated, source: 'local' }],
          { rejectOpIds: opsToReject },
        );
        for (const { op } of written) {
          OpLog.normal(
            `SupersededOperationResolverService: Appended LWW update op ${op.id} for ${op.entityType}:${op.entityId}`,
          );
        }
        OpLog.normal(
          `SupersededOperationResolverService: Marked ${opsToReject.length} superseded ops as rejected`,
        );
      }

      // Notify user if local changes were discarded because entities no longer exist
      if (discardedChangesCount > 0) {
        this.snackService.open({
          msg: T.F.SYNC.S.LOCAL_CHANGES_DISCARDED,
          translateParams: {
            count: discardedChangesCount,
          },
        });
      }

      result = newOpsCreated.length - auxiliaryOpIds.size;
    };
    if (callerHoldsLock) await resolve();
    else await this.lockService.request(LOCK_NAMES.OPERATION_LOG, resolve);
    return result;
  }

  /**
   * #10377: reissues each pending reorder that crossed an applied remote
   * reorder or note delete (`isReissuedReorderCrossing`), as the rejection path
   * above does once the server refuses it. File-based providers never refuse an
   * upload: a stale original would reach receivers that apply it over the
   * remote op and diverge. So this runs after every download and before every
   * upload (the caller holds the OPERATION_LOG lock), scanning every retained
   * applied remote row. While live state may hold an unpersisted change the
   * reissue is deferred: `deferredOpIds` must stay out of the upload. Without
   * the causal proof (compaction removed the remote row) it keeps the safety
   * stop, as the rejection path does.
   */
  async reissueCrossedPendingReorders(): Promise<{
    created: number;
    deferredOpIds: string[];
  }> {
    const none = { created: 0, deferredOpIds: [] };
    const pending = (await this.opLogStore.getUnsynced()).map(({ op }) => op);
    if (!pending.some(isReissuableReorder)) return none;
    const entries = await this.opLogStore.getOpsAfterSeq(0);
    const applied = entries
      .filter(
        (entry) =>
          entry.source === 'remote' &&
          entry.applicationStatus === 'applied' &&
          entry.rejectedAt === undefined &&
          entry.reducerRejectedAt === undefined,
      )
      .map(({ op }) => op);
    const crossed = selectCrossedPendingReorders(pending, applied);
    if (crossed.length === 0) return none;
    const context = buildSectionCausalReplayContext(entries);
    const unproven = crossed.find(
      (item) => this._getSectionCausalReplayDecision(item, context) !== 'replay',
    );
    if (unproven) {
      throw new UnsupportedMultiEntityConflictError(
        'local',
        unproven.op.actionType,
        getOpEntityIds(unproven.op).length,
      );
    }
    const deferred = {
      created: 0,
      deferredOpIds: crossed.map(({ opId }) => opId),
    };
    if (getPhantomChangeRisk(this.operationCapture)) return deferred;
    try {
      const created = await this.resolveSupersededLocalOps(
        crossed,
        undefined,
        undefined,
        true,
      );
      return { created, deferredOpIds: [] };
    } catch (e) {
      // Projection throws before writing anything when a change arrives meanwhile.
      if (!getPhantomChangeRisk(this.operationCapture)) throw e;
      OpLog.normal(
        'SupersededOperationResolverService: Deferred crossed reorder reissue ' +
          'while a local change awaits persistence.',
      );
      return deferred;
    }
  }
}
