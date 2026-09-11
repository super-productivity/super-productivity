import { inject, Injectable } from '@angular/core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import {
  ActionType,
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
import { SyncConflictBannerService } from './sync-conflict-banner.service';
import { T } from '../../t.const';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import { uuidv7 } from '../../util/uuid-v7';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';
import {
  areCommutingSectionOperations,
  projectSectionReplayAgainstState,
  SectionReplayOrder,
  SectionReplaySnapshot,
  SectionReplayStateCompensation,
} from './section-conflict-commutativity.util';
import { getOpEntityIds } from '../util/get-op-entity-ids.util';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { OperationCaptureService } from '../capture/operation-capture.service';
import { getPhantomChangeRisk } from '../capture/phantom-change-guard.util';
import { SectionState } from '../../features/section/section.model';
import { ProjectState } from '../../features/project/project.model';
import { TagState } from '../../features/tag/tag.model';

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
  private syncConflictBanner = inject(SyncConflictBannerService);
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

  private _getSectionCausalReplayDecision(
    item: SupersededOperation,
    context: SectionCausalReplayContext,
  ): SectionCausalReplayDecision {
    const existingClock = item.existingClock;
    if (
      !CAUSALLY_REPLAYABLE_SECTION_ACTIONS.has(item.op.actionType) ||
      !existingClock ||
      compareVectorClocks(item.op.vectorClock, existingClock) !==
        VectorClockComparison.CONCURRENT
    ) {
      return 'fallback';
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
    if (matchingRetainedEntries.length !== 1) {
      return 'fallback';
    }
    const retainedConflictEntry = matchingRetainedEntries[0];
    if (
      retainedConflictEntry.source !== 'remote' ||
      retainedConflictEntry.syncedAt === undefined ||
      retainedConflictEntry.applicationStatus !== 'applied' ||
      retainedConflictEntry.rejectedAt !== undefined ||
      retainedConflictEntry.reducerRejectedAt !== undefined ||
      !areCommutingSectionOperations(item.op, retainedConflictEntry.op)
    ) {
      return 'fallback';
    }

    return 'replay';
  }

  /**
   * Reads a reducer-state frontier that is fully represented by durable ops.
   * This check and the synchronous snapshot read deliberately have no await
   * between them. Later user actions wait behind the operation-log lock for
   * persistence and therefore follow the compensation in durable order.
   */
  private _getStableSectionReplaySnapshot(): SectionReplaySnapshot {
    const phantomRisk = getPhantomChangeRisk(this.operationCapture);
    if (phantomRisk) {
      throw new Error(`Cannot project SECTION conflict recovery while ${phantomRisk}.`);
    }
    const snapshot = this.stateSnapshotService.getStateSnapshotForOperationLog();
    return {
      section: snapshot.section as SectionState,
      project: snapshot.project as ProjectState,
      tag: snapshot.tag as TagState,
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
  ): Promise<number> {
    // Acquire lock to prevent race conditions with operation capture and other sync operations.
    // Without this lock, user actions during conflict resolution could write ops with
    // superseded vector clocks, leading to data corruption.
    let result = 0;
    await this.lockService.request(LOCK_NAMES.OPERATION_LOG, async () => {
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
      // successor are represented without an action-family allowlist. Malformed
      // or unrepresentable crossings retain the generic LWW fallback.
      const regularSupersededOps: SupersededOperation[] = [];
      let sectionReplayContext: SectionCausalReplayContext | undefined;
      let sectionReplaySnapshot: SectionReplaySnapshot | undefined;
      for (const [itemIndex, item] of supersededOps.entries()) {
        let projectedSectionOp: Operation | undefined;
        let projectedWorkContextState: WorkContextStateProjection | undefined;
        let projectedOrder: SectionReplayOrder | undefined;
        if (
          CAUSALLY_REPLAYABLE_SECTION_ACTIONS.has(item.op.actionType) &&
          item.existingClock
        ) {
          if (!sectionReplayContext) {
            const retainedEntries = await this.opLogStore.getOpsAfterSeq(0);
            sectionReplayContext = buildSectionCausalReplayContext(retainedEntries);
          }
          const replayDecision = this._getSectionCausalReplayDecision(
            item,
            sectionReplayContext,
          );
          if (replayDecision === 'replay') {
            sectionReplaySnapshot ??= this._getStableSectionReplaySnapshot();
            const projection = projectSectionReplayAgainstState(
              item.op,
              sectionReplaySnapshot,
            );
            if (projection.kind === 'superseded') {
              opsToReject.push(item.opId);
              OpLog.normal(
                `SupersededOperationResolverService: SECTION intent ${item.opId} ` +
                  'was superseded by the current durable state.',
              );
              continue;
            }
            if (projection.kind === 'blocked') {
              OpLog.warn(
                `SupersededOperationResolverService: Cannot safely project SECTION ` +
                  `intent ${item.opId}: ${projection.reason}. Falling back to LWW.`,
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

        // Create new UPDATE op with current state and merged clock
        let newOp = this.conflictResolutionService.createLWWUpdateOp(
          entityType,
          entityId,
          entityState,
          clientId,
          mergedClock,
          preservedTimestamp,
          'replace',
          declaredEntityIds,
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

      if (newOpsCreated.length > 0) {
        // SPAP-15: surface via the journal-driven summary banner (with REVIEW)
        // instead of a bare snack.
        await this.syncConflictBanner.maybeShowSummaryBanner();
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
    });
    return result;
  }
}
