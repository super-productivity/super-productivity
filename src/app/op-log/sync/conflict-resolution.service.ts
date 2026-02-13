import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import {
  ActionType,
  EntityConflict,
  EntityType,
  extractActionPayload,
  Operation,
  OpType,
  VectorClock,
} from '../core/operation.types';
import { toLwwUpdateActionType } from '../core/lww-update-action-types';
import { OperationApplierService } from '../apply/operation-applier.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { OpLog } from '../../core/log';
import { toEntityKey } from '../util/entity-key.util';
import { firstValueFrom } from 'rxjs';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { ValidateStateService } from '../validation/validate-state.service';
import { MAX_CONFLICT_RETRY_ATTEMPTS } from '../core/operation-log.const';
import {
  compareVectorClocks,
  incrementVectorClock,
  mergeVectorClocks,
  VectorClockComparison,
} from '../../core/util/vector-clock';
import { devError } from '../../util/dev-error';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import {
  getEntityConfig,
  getPayloadKey,
  isAdapterEntity,
  isSingletonEntity,
  isMapEntity,
  isArrayEntity,
} from '../core/entity-registry';
import { selectIssueProviderById } from '../../features/issue/store/issue-provider.selectors';
import { uuidv7 } from '../../util/uuid-v7';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';

/**
 * Represents the result of LWW (Last-Write-Wins) conflict resolution.
 */
interface LWWResolution {
  /** The conflict that was resolved */
  conflict: EntityConflict;
  /** Which side won: 'local' or 'remote' */
  winner: 'local' | 'remote';
  /** If local wins, this is the new UPDATE operation to sync local state */
  localWinOp?: Operation;
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
 * - **Crash safety**: Marks ops as rejected BEFORE applying
 * - **Superseded op rejection**: When remote wins, rejects ALL pending ops for affected entities
 *   (prevents uploading ops with outdated vector clocks)
 * - **Batch application**: All ops applied together for correct dependency sorting
 * - **Post-resolution validation**: Runs state validation and repair after resolution
 */
@Injectable({
  providedIn: 'root',
})
export class ConflictResolutionService {
  private store = inject(Store);
  private operationApplier = inject(OperationApplierService);
  private opLogStore = inject(OperationLogStoreService);
  private snackService = inject(SnackService);
  private validateStateService = inject(ValidateStateService);
  private clientIdProvider = inject(CLIENT_ID_PROVIDER);

  // ═══════════════════════════════════════════════════════════════════════════
  // LWW OPERATION FACTORY METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Creates a new LWW Update operation for syncing local state.
   *
   * LWW Update operations are synthetic operations created during conflict resolution
   * to carry the winning local state to remote clients. They are created when:
   * 1. Local state wins LWW conflict resolution
   * 2. Superseded local operations need to be re-uploaded with merged clocks
   *
   * These operations use dynamically constructed action types (e.g., '[TASK] LWW Update')
   * that are matched by regex in lwwUpdateMetaReducer.
   *
   * @param entityType - Type of the entity being updated
   * @param entityId - ID of the entity being updated
   * @param entityState - Current state of the entity to sync
   * @param clientId - Client creating this operation
   * @param vectorClock - Merged vector clock (should dominate all conflicting ops)
   * @param timestamp - Preserved timestamp for correct LWW semantics
   * @returns New UPDATE operation ready for upload
   */
  createLWWUpdateOp(
    entityType: EntityType,
    entityId: string,
    entityState: unknown,
    clientId: string,
    vectorClock: VectorClock,
    timestamp: number,
  ): Operation {
    // NOTE: LWW Update action types (e.g., '[TASK] LWW Update') are intentionally
    // NOT in the ActionType enum. They are dynamically constructed here and matched
    // by regex in lwwUpdateMetaReducer. This is by design - LWW ops are synthetic,
    // created during conflict resolution to carry the winning local state to remote clients.
    return {
      id: uuidv7(),
      actionType: toLwwUpdateActionType(entityType),
      opType: OpType.Update,
      entityType,
      entityId,
      payload: entityState,
      clientId,
      vectorClock,
      timestamp,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
  }

  /**
   * Merges multiple vector clocks and increments for the given client.
   * Used when creating LWW Update operations that need to dominate
   * all previously known clocks.
   *
   * @param clocks - Array of vector clocks to merge
   * @param clientId - Client ID to increment in the final clock
   * @returns Merged and incremented vector clock
   */
  mergeAndIncrementClocks(clocks: VectorClock[], clientId: string): VectorClock {
    let mergedClock: VectorClock = {};
    for (const clock of clocks) {
      mergedClock = mergeVectorClocks(mergedClock, clock);
    }
    return incrementVectorClock(mergedClock, clientId);
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
  private async _validateAndRepairAfterResolution(): Promise<void> {
    await this.validateStateService.validateAndRepairCurrentState('conflict-resolution', {
      callerHoldsLock: true,
    });
  }

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
    const { localOps, remoteOps } = conflict;

    // Empty ops can't be identical conflicts
    if (localOps.length === 0 || remoteOps.length === 0) {
      return false;
    }

    // Case 1: Both sides DELETE the same entity
    // This is the most common "identical" conflict
    const allLocalDelete = localOps.every((op) => op.opType === OpType.Delete);
    const allRemoteDelete = remoteOps.every((op) => op.opType === OpType.Delete);
    if (allLocalDelete && allRemoteDelete) {
      OpLog.verbose(
        `ConflictResolutionService: Identical conflict (both DELETE) for ${conflict.entityType}:${conflict.entityId}`,
      );
      return true;
    }

    // Case 2: Single ops with same opType and identical payloads
    // Only check single-op conflicts for payload comparison (multi-op is too complex)
    if (localOps.length === 1 && remoteOps.length === 1) {
      const localOp = localOps[0];
      const remoteOp = remoteOps[0];

      // Must be same operation type
      if (localOp.opType !== remoteOp.opType) {
        return false;
      }

      // Compare payloads using deep equality
      if (this._deepEqual(localOp.payload, remoteOp.payload)) {
        OpLog.verbose(
          `ConflictResolutionService: Identical conflict (same ${localOp.opType} payload) for ${conflict.entityType}:${conflict.entityId}`,
        );
        return true;
      }
    }

    return false;
  }

  /**
   * Maximum depth for deep equality check to prevent stack overflow
   * from deeply nested or circular structures.
   */
  private readonly MAX_DEEP_EQUAL_DEPTH = 50;

  /**
   * Deep equality check for payloads.
   * Handles nested objects, arrays, and primitives.
   * Includes protection against circular references and deep nesting.
   *
   * @param a First value to compare
   * @param b Second value to compare
   * @param seen WeakSet to track visited objects (circular reference protection)
   * @param depth Current recursion depth (deep nesting protection)
   */
  private _deepEqual(
    a: unknown,
    b: unknown,
    seen: WeakSet<object> = new WeakSet(),
    depth: number = 0,
  ): boolean {
    // Depth limit protection
    if (depth > this.MAX_DEEP_EQUAL_DEPTH) {
      OpLog.warn(
        'ConflictResolutionService: _deepEqual exceeded max depth, returning false',
      );
      return false;
    }

    if (a === b) return true;
    if (a === null || b === null) return a === b;
    if (typeof a !== typeof b) return false;

    if (typeof a === 'object') {
      // Circular reference protection: if we've seen this object before, return false
      // (comparing circular structures for equality is complex and likely indicates corrupted data)
      if (seen.has(a as object) || seen.has(b as object)) {
        OpLog.warn(
          'ConflictResolutionService: _deepEqual detected circular reference, returning false',
        );
        return false;
      }
      seen.add(a as object);
      seen.add(b as object);

      if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        return a.every((val, i) => this._deepEqual(val, b[i], seen, depth + 1));
      }

      if (Array.isArray(a) !== Array.isArray(b)) return false;

      const aKeys = Object.keys(a as object);
      const bKeys = Object.keys(b as object);
      if (aKeys.length !== bKeys.length) return false;

      return aKeys.every((key) =>
        this._deepEqual(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
          seen,
          depth + 1,
        ),
      );
    }

    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LAST-WRITE-WINS (LWW) AUTO-RESOLUTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Automatically resolves conflicts using Last-Write-Wins (LWW) strategy.
   *
   * ## How LWW Works
   * 1. Compare timestamps of conflicting operations
   * 2. The side with the newer timestamp wins
   * 3. When timestamps are equal, remote wins (server-authoritative)
   *
   * ## When Local Wins
   * When local state is newer, we can't just reject the remote ops - that would
   * cause the local state to never sync to the server. Instead, we:
   * 1. Reject BOTH local AND remote ops (they're now obsolete)
   * 2. Create a NEW update operation with:
   *    - Current entity state from NgRx store
   *    - Merged vector clock (local + remote) + increment
   *    - New timestamp
   * 3. This new op will be uploaded on next sync, propagating local state
   *
   * @param conflicts - Entity conflicts to auto-resolve
   * @param nonConflictingOps - Remote ops that don't conflict (batched for dependency sorting)
   * @returns Promise resolving when all resolutions are applied
   */
  async autoResolveConflictsLWW(
    conflicts: EntityConflict[],
    nonConflictingOps: Operation[] = [],
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
    const resolutions = await this._resolveConflictsWithLWW(conflicts);

    // Count results for notification
    let localWinsCount = 0;
    let remoteWinsCount = 0;

    const allOpsToApply: Operation[] = [];
    const allStoredOps: Array<{ id: string; seq: number }> = [];
    const localOpsToReject: string[] = [];
    const remoteOpsToReject: string[] = [];
    const newLocalWinOps: Operation[] = [];

    // ─────────────────────────────────────────────────────────────────────────
    // Collect all remote ops and categorize by resolution type
    // ─────────────────────────────────────────────────────────────────────────
    const remoteWinsOps: Operation[] = [];
    const localWinsRemoteOps: Operation[] = [];

    for (const resolution of resolutions) {
      if (resolution.winner === 'remote') {
        remoteWinsCount++;

        // Convert remote UPDATE operations to LWW Update format when entity was deleted locally.
        // This ensures lwwUpdateMetaReducer can recreate deleted entities (fixes DELETE vs UPDATE race).
        const processedRemoteOps = this._convertToLWWUpdatesIfNeeded(resolution.conflict);
        remoteWinsOps.push(...processedRemoteOps);

        localOpsToReject.push(...resolution.conflict.localOps.map((op) => op.id));
      } else {
        localWinsCount++;
        localOpsToReject.push(...resolution.conflict.localOps.map((op) => op.id));
        localWinsRemoteOps.push(...resolution.conflict.remoteOps);
        remoteOpsToReject.push(...resolution.conflict.remoteOps.map((op) => op.id));

        // Store the new update op (will be uploaded on next sync).
        // Note: localWinOp is undefined for archive-wins sibling conflicts
        // (non-archive conflicts for an entity being archived). These resolve
        // as local-wins to prevent remote ops from resurrecting the entity,
        // but no new op is needed — the archive-win op from the sibling
        // conflict already covers the entity.
        if (resolution.localWinOp) {
          newLocalWinOps.push(resolution.localWinOp);
          OpLog.warn(
            `ConflictResolutionService: LWW local wins - creating update op for ` +
              `${resolution.conflict.entityType}:${resolution.conflict.entityId}`,
          );
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Batch process remote-wins ops: filter duplicates and append in batch
    // Uses retry to handle race condition (issue #6213)
    // ─────────────────────────────────────────────────────────────────────────
    if (remoteWinsOps.length > 0) {
      const result = await this._filterAndAppendOpsWithRetry(remoteWinsOps, 'remote', {
        pendingApply: true,
      });
      const skippedCount = remoteWinsOps.length - result.ops.length;
      if (skippedCount > 0) {
        OpLog.verbose(
          `ConflictResolutionService: Skipping ${skippedCount} duplicate ops (LWW remote)`,
        );
      }
      for (let i = 0; i < result.ops.length; i++) {
        allStoredOps.push({ id: result.ops[i].id, seq: result.seqs[i] });
        allOpsToApply.push(result.ops[i]);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Batch process local-wins remote ops: filter duplicates and append in batch
    // Uses retry to handle race condition (issue #6213)
    // ─────────────────────────────────────────────────────────────────────────
    if (localWinsRemoteOps.length > 0) {
      await this._filterAndAppendOpsWithRetry(localWinsRemoteOps, 'remote');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 2: Reject ALL pending ops for entities where remote won
    // ─────────────────────────────────────────────────────────────────────────
    if (localOpsToReject.length > 0) {
      const affectedEntityKeys = new Set<string>();
      for (const resolution of resolutions) {
        if (resolution.winner === 'remote') {
          for (const op of resolution.conflict.remoteOps) {
            const ids = op.entityIds?.length
              ? op.entityIds
              : op.entityId
                ? [op.entityId]
                : [];
            for (const id of ids) {
              affectedEntityKeys.add(toEntityKey(op.entityType, id));
            }
          }
        }
      }

      const pendingByEntity = await this.opLogStore.getUnsyncedByEntity();
      for (const entityKey of affectedEntityKeys) {
        const pendingOps = pendingByEntity.get(entityKey) || [];
        for (const op of pendingOps) {
          if (!localOpsToReject.includes(op.id)) {
            localOpsToReject.push(op.id);
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
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 4: Mark rejected operations BEFORE applying (crash safety)
    // ─────────────────────────────────────────────────────────────────────────
    if (localOpsToReject.length > 0) {
      await this.opLogStore.markRejected(localOpsToReject);
      OpLog.normal(
        `ConflictResolutionService: Marked ${localOpsToReject.length} local ops as rejected`,
      );
    }
    if (remoteOpsToReject.length > 0) {
      await this.opLogStore.markRejected(remoteOpsToReject);
      OpLog.normal(
        `ConflictResolutionService: Marked ${remoteOpsToReject.length} remote ops as rejected`,
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 5: Apply ALL remote operations in a single batch
    // ─────────────────────────────────────────────────────────────────────────
    if (allOpsToApply.length > 0) {
      OpLog.normal(
        `ConflictResolutionService: Applying ${allOpsToApply.length} ops in single batch`,
      );

      const opIdToSeq = new Map(allStoredOps.map((o) => [o.id, o.seq]));
      const applyResult = await this.operationApplier.applyOperations(allOpsToApply);

      const appliedSeqs = applyResult.appliedOps
        .map((op) => opIdToSeq.get(op.id))
        .filter((seq): seq is number => seq !== undefined);

      if (appliedSeqs.length > 0) {
        await this.opLogStore.markApplied(appliedSeqs);

        // CRITICAL: Merge remote ops' vector clocks into local clock.
        // This ensures subsequent local operations have clocks that "dominate"
        // the applied remote ops (GREATER_THAN instead of CONCURRENT).
        // Without this, ops created after conflict resolution would have clocks
        // that are CONCURRENT with the applied ops, causing them to be incorrectly
        // filtered by SyncImportFilterService or rejected as conflicts on next sync.
        await this.opLogStore.mergeRemoteOpClocks(applyResult.appliedOps);

        OpLog.normal(
          `ConflictResolutionService: Successfully applied ${appliedSeqs.length} ops`,
        );
      }

      if (applyResult.failedOp) {
        const failedOpIndex = allOpsToApply.findIndex(
          (op) => op.id === applyResult.failedOp!.op.id,
        );
        const failedOps = allOpsToApply.slice(failedOpIndex);
        const failedOpIds = failedOps.map((op) => op.id);

        OpLog.err(
          `ConflictResolutionService: ${applyResult.appliedOps.length} ops applied before failure. ` +
            `Marking ${failedOpIds.length} ops as failed.`,
          applyResult.failedOp.error,
        );
        await this.opLogStore.markFailed(failedOpIds, MAX_CONFLICT_RETRY_ATTEMPTS);

        this.snackService.open({
          type: 'ERROR',
          msg: T.F.SYNC.S.CONFLICT_RESOLUTION_FAILED,
          actionStr: T.PS.RELOAD,
          actionFn: (): void => {
            window.location.reload();
          },
        });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 6: Append new update ops for local wins (will sync on next cycle)
    // Uses appendWithVectorClockUpdate to ensure vector clock store stays in sync
    // ─────────────────────────────────────────────────────────────────────────
    for (const op of newLocalWinOps) {
      await this.opLogStore.appendWithVectorClockUpdate(op, 'local');
      OpLog.normal(
        `ConflictResolutionService: Appended local-win update op ${op.id} for ${op.entityType}:${op.entityId}`,
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 7: Show non-blocking notification
    // ─────────────────────────────────────────────────────────────────────────
    if (localWinsCount > 0 || remoteWinsCount > 0) {
      this.snackService.open({
        msg: T.F.SYNC.S.LWW_CONFLICTS_AUTO_RESOLVED,
        translateParams: {
          localWins: localWinsCount,
          remoteWins: remoteWinsCount,
        },
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 8: Validate and repair state after resolution
    // ─────────────────────────────────────────────────────────────────────────
    await this._validateAndRepairAfterResolution();

    return { localWinOpsCreated: newLocalWinOps.length };
  }

  /**
   * Resolves conflicts using LWW timestamp comparison.
   *
   * @param conflicts - The conflicts to resolve
   * @returns Array of resolutions with winner and optional new update op
   */
  private async _resolveConflictsWithLWW(
    conflicts: EntityConflict[],
  ): Promise<LWWResolution[]> {
    const resolutions: LWWResolution[] = [];

    // ── Pre-scan: find entities with archive ops in ANY conflict ──
    // Multiple conflicts can exist for the same entity (e.g., field updates + archive).
    // When any conflict for an entity involves an archive op, ALL conflicts for that
    // entity must resolve as archive-wins. Otherwise, non-archive conflicts would
    // resolve via normal LWW, potentially creating local-win update ops that
    // resurrect the archived entity via lwwUpdateMetaReducer.addOne().
    const entitiesWithLocalArchive = new Set<string>();
    const entitiesWithRemoteArchive = new Set<string>();
    for (const conflict of conflicts) {
      const entityKey = toEntityKey(conflict.entityType, conflict.entityId);
      if (
        conflict.localOps.some(
          (op) => op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        )
      ) {
        entitiesWithLocalArchive.add(entityKey);
      }
      if (
        conflict.remoteOps.some(
          (op) => op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        )
      ) {
        entitiesWithRemoteArchive.add(entityKey);
      }
    }

    for (const conflict of conflicts) {
      // ── moveToArchive always wins over other operations ──
      // Archive is an explicit user intent ("I'm done with these tasks").
      // Allowing other operations (field-level updates, deletes) to win via LWW
      // would either resurrect archived entities via lwwUpdateMetaReducer.addOne()
      // (Bug B) or lose archived data.
      const entityKey = toEntityKey(conflict.entityType, conflict.entityId);
      const localHasArchive = entitiesWithLocalArchive.has(entityKey);
      const remoteHasArchive = entitiesWithRemoteArchive.has(entityKey);

      if (localHasArchive || remoteHasArchive) {
        if (remoteHasArchive) {
          // Remote archive wins — will be applied normally
          resolutions.push({ conflict, winner: 'remote' });
        } else {
          // Local archive wins. Only create the archive-win op for the conflict
          // that actually contains the archive action. For other conflicts affecting
          // the same entity, resolve as remote to reject local ops (the entity is
          // being archived, so these local updates are irrelevant).
          const thisConflictHasArchive = conflict.localOps.some(
            (op) => op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
          );
          if (thisConflictHasArchive) {
            const localWinOp = await this._createArchiveWinOp(conflict);
            resolutions.push({ conflict, winner: 'local', localWinOp });
          } else {
            // Entity is being archived locally — don't apply remote ops for
            // non-archive conflicts to avoid transient entity resurrection via
            // lwwUpdateMetaReducer.addOne(). Resolve as local-wins without a
            // localWinOp: local ops get rejected (superseded by the archive-win
            // op from the sibling conflict), remote ops get stored but not applied.
            resolutions.push({ conflict, winner: 'local' });
          }
        }
        OpLog.normal(
          `ConflictResolutionService: Archive wins over concurrent operation ` +
            `(${remoteHasArchive ? 'remote' : 'local'} archive) for ` +
            `${conflict.entityType}:${conflict.entityId}`,
        );
        continue;
      }

      // ── Normal LWW timestamp comparison ──
      // Get max timestamp from each side
      const localMaxTimestamp = Math.max(...conflict.localOps.map((op) => op.timestamp));
      const remoteMaxTimestamp = Math.max(
        ...conflict.remoteOps.map((op) => op.timestamp),
      );

      // LWW comparison: newer wins, tie goes to remote (server-authoritative)
      if (localMaxTimestamp > remoteMaxTimestamp) {
        // Local wins - create update op with current state
        const localWinOp = await this._createLocalWinUpdateOp(conflict);
        resolutions.push({
          conflict,
          winner: 'local',
          localWinOp,
        });
        OpLog.normal(
          `ConflictResolutionService: LWW resolved ${conflict.entityType}:${conflict.entityId} as LOCAL ` +
            `(local: ${localMaxTimestamp}, remote: ${remoteMaxTimestamp})`,
        );
      } else {
        // Remote wins (includes tie)
        resolutions.push({
          conflict,
          winner: 'remote',
        });
        OpLog.normal(
          `ConflictResolutionService: LWW resolved ${conflict.entityType}:${conflict.entityId} as REMOTE ` +
            `(local: ${localMaxTimestamp}, remote: ${remoteMaxTimestamp})`,
        );
      }
    }

    return resolutions;
  }

  /**
   * Creates a new UPDATE operation to sync local state when local wins LWW.
   *
   * The new operation has:
   * - Fresh UUIDv7 ID
   * - Current entity state from NgRx store
   * - Merged vector clock (local + remote) + increment
   * - Preserved maximum timestamp from local ops (for correct LWW semantics)
   *
   * @param conflict - The conflict where local won
   * @returns New UPDATE operation, or undefined if entity not found
   */
  private async _createLocalWinUpdateOp(
    conflict: EntityConflict,
  ): Promise<Operation | undefined> {
    // Get current entity state from store
    let entityState = await this.getCurrentEntityState(
      conflict.entityType,
      conflict.entityId,
    );

    if (entityState === undefined) {
      // Try to extract entity from remote DELETE operation
      // This handles the case where a remote DELETE was applied before LWW resolution,
      // and the local UPDATE wins. We need to recreate the entity from the DELETE payload.
      entityState = this._extractEntityFromDeleteOperation(conflict);

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
    const newClock = this.mergeAndIncrementClocks(allClocks, clientId);

    // Preserve the maximum timestamp from local ops.
    // This is critical for LWW semantics: we're creating a new op to carry the
    // local-winning state, so it should retain the original timestamp that caused
    // it to win. Using Date.now() would give it an unfair advantage in future conflicts.
    const preservedTimestamp = Math.max(...conflict.localOps.map((op) => op.timestamp));

    return this.createLWWUpdateOp(
      conflict.entityType,
      conflict.entityId,
      entityState,
      clientId,
      newClock,
      preservedTimestamp,
    );
  }

  /**
   * Creates a replacement archive operation with merged vector clock.
   * Used when local moveToArchive wins a conflict — the original op will be
   * rejected, so we create a new one with a clock that dominates all parties.
   */
  private async _createArchiveWinOp(
    conflict: EntityConflict,
  ): Promise<Operation | undefined> {
    const clientId = await this.clientIdProvider.loadClientId();
    if (!clientId) {
      OpLog.err('ConflictResolutionService: Cannot create archive-win op - no client ID');
      return undefined;
    }

    const archiveOp = conflict.localOps.find(
      (op) => op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
    )!;

    const allClocks = [
      ...conflict.localOps.map((op) => op.vectorClock),
      ...conflict.remoteOps.map((op) => op.vectorClock),
    ];
    // No client-side pruning — server prunes AFTER conflict detection, BEFORE storage.
    const newClock = this.mergeAndIncrementClocks(allClocks, clientId);

    return {
      id: uuidv7(),
      actionType: archiveOp.actionType,
      opType: archiveOp.opType,
      entityType: archiveOp.entityType,
      entityId: archiveOp.entityId,
      entityIds: archiveOp.entityIds,
      payload: archiveOp.payload,
      clientId,
      vectorClock: newClock,
      timestamp: archiveOp.timestamp,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
  }

  /**
   * Extracts entity state from a remote DELETE operation payload.
   *
   * When a remote DELETE wins the conflict but we need the entity state for LWW resolution,
   * we can extract it from the DELETE operation's payload (which contains the deleted entity).
   *
   * @param conflict - The conflict containing remote DELETE operation
   * @returns Entity state from DELETE payload, or undefined if not found
   */
  private _extractEntityFromDeleteOperation(
    conflict: EntityConflict,
  ): unknown | undefined {
    // Find the DELETE operation in remote ops
    const deleteOp = conflict.remoteOps.find((op) => op.opType === OpType.Delete);
    if (!deleteOp) {
      return undefined;
    }

    // Extract entity from payload based on entity type.
    // Uses extractActionPayload to handle both MultiEntityPayload format
    // (where actionPayload is nested) and legacy flat payloads.
    const actionPayload = extractActionPayload(deleteOp.payload);
    const entityKey =
      getPayloadKey(conflict.entityType) || conflict.entityType.toLowerCase();

    return actionPayload[entityKey];
  }

  /**
   * Converts remote UPDATE operations to LWW Update format when entity was deleted locally.
   *
   * When a local DELETE loses to a remote UPDATE via LWW, the entity is already deleted
   * from the local store. Regular UPDATE operations can't recreate deleted entities -
   * only LWW Update operations can (via lwwUpdateMetaReducer).
   *
   * This method detects DELETE vs UPDATE conflicts and converts the winning remote UPDATE
   * to LWW Update format by changing its actionType to '[ENTITY_TYPE] LWW Update'.
   *
   * @param conflict - The entity conflict being resolved
   * @returns Remote operations, with UPDATEs converted to LWW Updates if needed
   */
  private _convertToLWWUpdatesIfNeeded(conflict: EntityConflict): Operation[] {
    // Check if local side has a DELETE operation
    const hasLocalDelete = conflict.localOps.some((op) => op.opType === OpType.Delete);

    if (!hasLocalDelete) {
      // No DELETE conflict - return remote ops as-is
      return conflict.remoteOps;
    }

    // Extract full entity from local DELETE operation's payload.
    // The DELETE op carries the complete entity state at time of deletion,
    // which we need as the base for merging remote UPDATE changes.
    const localDeleteOp = conflict.localOps.find((op) => op.opType === OpType.Delete);
    const baseEntity = localDeleteOp
      ? this._extractEntityFromPayload(localDeleteOp.payload, conflict.entityType)
      : undefined;

    // Convert remote UPDATE operations to LWW Update format
    return conflict.remoteOps.map((remoteOp) => {
      if (remoteOp.opType === OpType.Update) {
        OpLog.log(
          `ConflictResolutionService: Converting remote UPDATE to LWW Update for ` +
            `${remoteOp.entityType}:${remoteOp.entityId} (local DELETE lost)`,
        );

        if (baseEntity) {
          // Merge remote UPDATE changes on top of base entity from DELETE.
          // This produces a flat entity payload that lwwUpdateMetaReducer can use
          // to recreate the entity with all fields intact (not just the delta).
          const updateChanges = this._extractUpdateChanges(
            remoteOp.payload,
            conflict.entityType,
          );
          const mergedEntity = { ...baseEntity, ...updateChanges };
          return {
            ...remoteOp,
            actionType: toLwwUpdateActionType(remoteOp.entityType),
            payload: mergedEntity,
          };
        }

        // Fallback: can't get base entity — the LWW Update keeps the original
        // UPDATE payload which may lack a top-level `id`, causing lwwUpdateMetaReducer
        // to skip the update. This is the pre-existing behavior; the merged-entity
        // path above is the fix. Log with payload shape for diagnostics.
        OpLog.error(
          `ConflictResolutionService: Cannot extract base entity from local DELETE for ` +
            `${remoteOp.entityType}:${remoteOp.entityId}. LWW Update may have incomplete data. ` +
            `Local DELETE payload keys: ${localDeleteOp ? JSON.stringify(Object.keys(extractActionPayload(localDeleteOp.payload))) : 'N/A'}`,
        );
        return {
          ...remoteOp,
          actionType: toLwwUpdateActionType(remoteOp.entityType),
        };
      }
      return remoteOp;
    });
  }

  /**
   * Extracts entity state from an operation payload.
   * Handles both MultiEntityPayload format and flat payloads.
   */
  private _extractEntityFromPayload(
    payload: unknown,
    entityType: EntityType,
  ): Record<string, unknown> | undefined {
    const actionPayload = extractActionPayload(payload);
    const entityKey = getPayloadKey(entityType) || entityType.toLowerCase();
    const entity = actionPayload[entityKey];
    if (entity && typeof entity === 'object') {
      return entity as Record<string, unknown>;
    }
    // Fallback: payload might be the entity itself (LWW Update format)
    if (actionPayload && typeof actionPayload === 'object' && 'id' in actionPayload) {
      return actionPayload as Record<string, unknown>;
    }
    return undefined;
  }

  /**
   * Extracts the changed fields from an UPDATE operation payload.
   * Handles NgRx entity adapter format: { task: { id, changes: {...} } }
   * and flat format: { task: { id, field: value } }
   */
  private _extractUpdateChanges(
    payload: unknown,
    entityType: EntityType,
  ): Record<string, unknown> {
    const actionPayload = extractActionPayload(payload);
    const entityKey = getPayloadKey(entityType) || entityType.toLowerCase();
    const entityPayload = actionPayload[entityKey] as Record<string, unknown> | undefined;
    if (!entityPayload) return {};
    // NgRx adapter format: { id, changes: {...} }
    if ('changes' in entityPayload && typeof entityPayload['changes'] === 'object') {
      return entityPayload['changes'] as Record<string, unknown>;
    }
    // Flat format: entire object is the changes (exclude 'id')
    const changes = { ...entityPayload };
    delete changes['id'];
    return changes;
  }

  /**
   * Gets the current state of an entity from the NgRx store.
   * Uses the entity registry to look up the appropriate selector.
   *
   * @param entityType - The type of entity
   * @param entityId - The ID of the entity
   * @returns The entity state, or undefined if not found
   */
  async getCurrentEntityState(
    entityType: EntityType,
    entityId: string,
  ): Promise<unknown> {
    const config = getEntityConfig(entityType);
    if (!config) {
      OpLog.warn(
        `ConflictResolutionService: No config for entity type ${entityType}, falling back to remote`,
      );
      return undefined;
    }

    try {
      // Adapter entities - use selectById
      if (isAdapterEntity(config) && config.selectById) {
        // Special case: ISSUE_PROVIDER has a factory selector (id, key) => selector
        if (entityType === 'ISSUE_PROVIDER') {
          return await firstValueFrom(
            this.store.select(selectIssueProviderById(entityId, null)),
          );
        }
        // Standard props-based selector
        // TYPE ASSERTION: NgRx's MemoizedSelectorWithProps requires exact generic
        // parameter matching. EntityConfig.selectById is a union type covering
        // adapter, map, array, and singleton patterns - TypeScript cannot narrow
        // this to MemoizedSelectorWithProps<State, {id: string}, T>. This is a
        // known NgRx typing limitation. Runtime behavior is correct.
        return await firstValueFrom(
          this.store.select(config.selectById as any, { id: entityId }),
        );
      }

      // Singleton entities - return entire feature state
      if (isSingletonEntity(config) && config.selectState) {
        return await firstValueFrom(this.store.select(config.selectState));
      }

      // Map entities - get state and extract by key
      if (isMapEntity(config) && config.selectState && config.mapKey) {
        const state = await firstValueFrom(this.store.select(config.selectState));
        return (state as Record<string, unknown>)?.[config.mapKey]?.[entityId];
      }

      // Array entities - get state and find by id
      if (isArrayEntity(config) && config.selectState) {
        const state = await firstValueFrom(this.store.select(config.selectState));
        if (config.arrayKey === null) {
          // State IS the array (e.g., REMINDER)
          return (state as Array<{ id: string }>)?.find((item) => item.id === entityId);
        }
        // State has array at arrayKey (e.g., BOARD.boardCfgs)
        if (config.arrayKey) {
          const arr = (state as Record<string, unknown>)?.[config.arrayKey];
          return (arr as Array<{ id: string }>)?.find((item) => item.id === entityId);
        }
        return undefined;
      }

      OpLog.warn(
        `ConflictResolutionService: Cannot get state for entity type ${entityType}`,
      );
      return undefined;
    } catch (err) {
      OpLog.err(
        `ConflictResolutionService: Error getting entity state for ${entityType}:${entityId}`,
        err,
      );
      return undefined;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFLICT DETECTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Checks a remote operation for conflicts with local pending operations.
   *
   * @param remoteOp - The remote operation to check
   * @param ctx - Context containing local state for conflict detection
   * @returns Object indicating if op is superseded/duplicate and any detected conflict
   */
  async checkOpForConflicts(
    remoteOp: Operation,
    ctx: {
      localPendingOpsByEntity: Map<string, Operation[]>;
      appliedFrontierByEntity: Map<string, VectorClock>;
      snapshotVectorClock: VectorClock | undefined;
      snapshotEntityKeys: Set<string> | undefined;
      hasNoSnapshotClock: boolean;
    },
  ): Promise<{ isSupersededOrDuplicate: boolean; conflict: EntityConflict | null }> {
    const entityIdsToCheck = remoteOp.entityIds?.length
      ? remoteOp.entityIds
      : remoteOp.entityId
        ? [remoteOp.entityId]
        : [];

    for (const entityId of entityIdsToCheck) {
      const entityKey = toEntityKey(remoteOp.entityType, entityId);
      const localOpsForEntity = ctx.localPendingOpsByEntity.get(entityKey) || [];

      const result = await this._checkEntityForConflict(remoteOp, entityId, entityKey, {
        localOpsForEntity,
        appliedFrontier: ctx.appliedFrontierByEntity.get(entityKey),
        snapshotVectorClock: ctx.snapshotVectorClock,
        snapshotEntityKeys: ctx.snapshotEntityKeys,
        hasNoSnapshotClock: ctx.hasNoSnapshotClock,
      });

      if (result.isSupersededOrDuplicate) {
        return { isSupersededOrDuplicate: true, conflict: null };
      }
      if (result.conflict) {
        return { isSupersededOrDuplicate: false, conflict: result.conflict };
      }
    }

    return { isSupersededOrDuplicate: false, conflict: null };
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

    let vcComparison = compareVectorClocks(localFrontier, remoteOp.vectorClock);

    // Handle potential per-entity clock corruption
    vcComparison = this._adjustForClockCorruption(vcComparison, entityKey, {
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
        const entityState = await this.getCurrentEntityState(
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
      }
      return { isSupersededOrDuplicate: false, conflict: null };
    }

    // CONCURRENT = true conflict
    if (vcComparison === VectorClockComparison.CONCURRENT) {
      return {
        isSupersededOrDuplicate: false,
        conflict: {
          entityType: remoteOp.entityType,
          entityId,
          localOps: ctx.localOpsForEntity,
          remoteOps: [remoteOp],
          suggestedResolution: this._suggestResolution(ctx.localOpsForEntity, [remoteOp]),
        },
      };
    }

    return { isSupersededOrDuplicate: false, conflict: null };
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
    // Use snapshot clock only for entities that existed at snapshot time.
    // When snapshotEntityKeys is undefined (old format), only use the snapshot
    // clock if we have an applied frontier for this entity. Without both
    // snapshotEntityKeys AND appliedFrontier, using the snapshot clock would
    // inflate the frontier for genuinely NEW entities (never seen locally),
    // causing their remote ops to be incorrectly discarded as superseded/concurrent.
    const entityExistedAtSnapshot = ctx.snapshotEntityKeys
      ? ctx.snapshotEntityKeys.has(entityKey)
      : ctx.appliedFrontier !== undefined;
    const fallbackClock = entityExistedAtSnapshot ? ctx.snapshotVectorClock : {};
    const baselineClock = ctx.appliedFrontier || fallbackClock || {};

    const allClocks = [
      baselineClock,
      ...ctx.localOpsForEntity.map((op) => op.vectorClock),
    ];
    return allClocks.reduce((acc, clock) => mergeVectorClocks(acc, clock), {});
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
    const entityHasPendingOps = ctx.localOpsForEntity.length > 0;
    const potentialCorruption =
      entityHasPendingOps && ctx.hasNoSnapshotClock && ctx.localFrontierIsEmpty;

    if (potentialCorruption) {
      devError(
        `Clock corruption detected for entity ${entityKey}: ` +
          `has ${ctx.localOpsForEntity.length} pending ops but no snapshot clock and empty local frontier`,
      );
    }

    if (potentialCorruption && comparison === VectorClockComparison.LESS_THAN) {
      OpLog.warn(
        `ConflictResolutionService: Converting LESS_THAN to CONCURRENT for entity ${entityKey} due to potential clock corruption`,
      );
      return VectorClockComparison.CONCURRENT;
    }

    if (potentialCorruption && comparison === VectorClockComparison.GREATER_THAN) {
      OpLog.warn(
        `ConflictResolutionService: Converting GREATER_THAN to CONCURRENT for entity ${entityKey} due to potential clock corruption. ` +
          `Remote op will be processed via conflict resolution instead of being skipped.`,
      );
      return VectorClockComparison.CONCURRENT;
    }

    return comparison;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFLICT RESOLUTION HEURISTICS
  // ═══════════════════════════════════════════════════════════════════════════

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
    // Edge case: no ops on one side = clear winner
    if (localOps.length === 0) return 'remote';
    if (remoteOps.length === 0) return 'local';

    const latestLocal = Math.max(...localOps.map((op) => op.timestamp));
    const latestRemote = Math.max(...remoteOps.map((op) => op.timestamp));
    const timeDiffMs = Math.abs(latestLocal - latestRemote);

    // Heuristic 1: Large time gap (>1 hour) = newer wins
    // Rationale: User likely made changes in sequence, not concurrently
    const ONE_HOUR_MS = 60 * 60 * 1000;
    if (timeDiffMs > ONE_HOUR_MS) {
      return latestLocal > latestRemote ? 'local' : 'remote';
    }

    // Heuristic 2: Delete conflicts
    const hasLocalDelete = localOps.some((op) => op.opType === OpType.Delete);
    const hasRemoteDelete = remoteOps.some((op) => op.opType === OpType.Delete);

    // Heuristic 2a: Both delete - auto-resolve (outcome is identical either way)
    // Rationale: Both clients want the entity deleted, no conflict to resolve
    if (hasLocalDelete && hasRemoteDelete) return 'local';

    // Heuristic 2b: Delete vs Update - prefer Update (preserve data)
    // Rationale: Users generally prefer not to lose work
    if (hasLocalDelete && !hasRemoteDelete) return 'remote';
    if (hasRemoteDelete && !hasLocalDelete) return 'local';

    // Heuristic 3: Create vs anything else - Create wins
    // Rationale: If one side created entity, that's more significant
    const hasLocalCreate = localOps.some((op) => op.opType === OpType.Create);
    const hasRemoteCreate = remoteOps.some((op) => op.opType === OpType.Create);
    if (hasLocalCreate && !hasRemoteCreate) return 'local';
    if (hasRemoteCreate && !hasLocalCreate) return 'remote';

    // Default: manual - let user decide
    return 'manual';
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
    return { ops: result.writtenOps, seqs: result.seqs };
  }
}
