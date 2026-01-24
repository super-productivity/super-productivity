import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import {
  ActionType,
  EntityConflict,
  EntityType,
  Operation,
  OpType,
  VectorClock,
} from '../core/operation.types';
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
  mergeVectorClocks,
  VectorClockComparison,
} from '../../core/util/vector-clock';
import { devError } from '../../util/dev-error';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import {
  getEntityConfig,
  isAdapterEntity,
  isSingletonEntity,
  isMapEntity,
  isArrayEntity,
} from '../core/entity-registry';
import { selectIssueProviderById } from '../../features/issue/store/issue-provider.selectors';
import { LWWOperationFactory } from './lww-operation-factory.service';

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
 * - **Stale op rejection**: When remote wins, rejects ALL pending ops for affected entities
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
  private lwwOperationFactory = inject(LWWOperationFactory);

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

        // Store the new update op (will be uploaded on next sync)
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
    // ─────────────────────────────────────────────────────────────────────────
    if (remoteWinsOps.length > 0) {
      const newRemoteWinsOps = await this.opLogStore.filterNewOps(remoteWinsOps);
      const skippedCount = remoteWinsOps.length - newRemoteWinsOps.length;
      if (skippedCount > 0) {
        OpLog.verbose(
          `ConflictResolutionService: Skipping ${skippedCount} duplicate ops (LWW remote)`,
        );
      }
      if (newRemoteWinsOps.length > 0) {
        const seqs = await this.opLogStore.appendBatch(newRemoteWinsOps, 'remote', {
          pendingApply: true,
        });
        for (let i = 0; i < newRemoteWinsOps.length; i++) {
          allStoredOps.push({ id: newRemoteWinsOps[i].id, seq: seqs[i] });
          allOpsToApply.push(newRemoteWinsOps[i]);
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Batch process local-wins remote ops: filter duplicates and append in batch
    // ─────────────────────────────────────────────────────────────────────────
    if (localWinsRemoteOps.length > 0) {
      const newLocalWinsRemoteOps =
        await this.opLogStore.filterNewOps(localWinsRemoteOps);
      if (newLocalWinsRemoteOps.length > 0) {
        await this.opLogStore.appendBatch(newLocalWinsRemoteOps, 'remote');
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 2: Reject ALL pending ops for entities where remote won
    // ─────────────────────────────────────────────────────────────────────────
    if (localOpsToReject.length > 0) {
      const affectedEntityKeys = new Set<string>();
      for (const resolution of resolutions) {
        if (resolution.winner === 'remote') {
          for (const op of resolution.conflict.remoteOps) {
            const ids = op.entityIds || (op.entityId ? [op.entityId] : []);
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
              `ConflictResolutionService: Also rejecting stale op ${op.id} for entity ${entityKey}`,
            );
          }
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 3: Add non-conflicting remote ops to the batch
    // ─────────────────────────────────────────────────────────────────────────
    const newNonConflictingOps = await this.opLogStore.filterNewOps(nonConflictingOps);
    if (newNonConflictingOps.length > 0) {
      const seqs = await this.opLogStore.appendBatch(newNonConflictingOps, 'remote', {
        pendingApply: true,
      });
      for (let i = 0; i < newNonConflictingOps.length; i++) {
        allStoredOps.push({ id: newNonConflictingOps[i].id, seq: seqs[i] });
        allOpsToApply.push(newNonConflictingOps[i]);
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

    for (const conflict of conflicts) {
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
    const newClock = this.lwwOperationFactory.mergeAndIncrementClocks(
      allClocks,
      clientId,
    );

    // Preserve the maximum timestamp from local ops.
    // This is critical for LWW semantics: we're creating a new op to carry the
    // local-winning state, so it should retain the original timestamp that caused
    // it to win. Using Date.now() would give it an unfair advantage in future conflicts.
    const preservedTimestamp = Math.max(...conflict.localOps.map((op) => op.timestamp));

    return this.lwwOperationFactory.createLWWUpdateOp(
      conflict.entityType,
      conflict.entityId,
      entityState,
      clientId,
      newClock,
      preservedTimestamp,
    );
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

    // Extract entity from payload based on entity type
    // For TASK: payload.task
    // For PROJECT: payload.project
    // For TAG: payload.tag
    // etc.
    const payload = deleteOp.payload as Record<string, unknown>;
    const entityKey = conflict.entityType.toLowerCase();

    return payload[entityKey];
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

    // Convert remote UPDATE operations to LWW Update format
    return conflict.remoteOps.map((remoteOp) => {
      if (remoteOp.opType === OpType.Update) {
        OpLog.log(
          `ConflictResolutionService: Converting remote UPDATE to LWW Update for ` +
            `${remoteOp.entityType}:${remoteOp.entityId} (local DELETE lost)`,
        );
        return {
          ...remoteOp,
          // Convert to LWW Update action type so lwwUpdateMetaReducer can recreate the entity
          actionType: `[${remoteOp.entityType}] LWW Update` as ActionType,
        };
      }
      return remoteOp;
    });
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
   * @returns Object indicating if op is stale/duplicate and any detected conflict
   */
  checkOpForConflicts(
    remoteOp: Operation,
    ctx: {
      localPendingOpsByEntity: Map<string, Operation[]>;
      appliedFrontierByEntity: Map<string, VectorClock>;
      snapshotVectorClock: VectorClock | undefined;
      snapshotEntityKeys: Set<string> | undefined;
      hasNoSnapshotClock: boolean;
    },
  ): { isStaleOrDuplicate: boolean; conflict: EntityConflict | null } {
    const entityIdsToCheck =
      remoteOp.entityIds || (remoteOp.entityId ? [remoteOp.entityId] : []);

    for (const entityId of entityIdsToCheck) {
      const entityKey = toEntityKey(remoteOp.entityType, entityId);
      const localOpsForEntity = ctx.localPendingOpsByEntity.get(entityKey) || [];

      const result = this._checkEntityForConflict(remoteOp, entityId, entityKey, {
        localOpsForEntity,
        appliedFrontier: ctx.appliedFrontierByEntity.get(entityKey),
        snapshotVectorClock: ctx.snapshotVectorClock,
        snapshotEntityKeys: ctx.snapshotEntityKeys,
        hasNoSnapshotClock: ctx.hasNoSnapshotClock,
      });

      if (result.isStaleOrDuplicate) {
        return { isStaleOrDuplicate: true, conflict: null };
      }
      if (result.conflict) {
        return { isStaleOrDuplicate: false, conflict: result.conflict };
      }
    }

    return { isStaleOrDuplicate: false, conflict: null };
  }

  /**
   * Checks a single entity for conflict with a remote operation.
   */
  private _checkEntityForConflict(
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
  ): { isStaleOrDuplicate: boolean; conflict: EntityConflict | null } {
    const localFrontier = this._buildEntityFrontier(entityKey, ctx);
    const localFrontierIsEmpty = Object.keys(localFrontier).length === 0;

    // FAST PATH: No local state means remote is newer by default
    if (ctx.localOpsForEntity.length === 0 && localFrontierIsEmpty) {
      return { isStaleOrDuplicate: false, conflict: null };
    }

    let vcComparison = compareVectorClocks(localFrontier, remoteOp.vectorClock);

    // Handle potential per-entity clock corruption
    vcComparison = this._adjustForClockCorruption(vcComparison, entityKey, {
      localOpsForEntity: ctx.localOpsForEntity,
      hasNoSnapshotClock: ctx.hasNoSnapshotClock,
      localFrontierIsEmpty,
    });

    // Skip stale operations (local already has newer state)
    if (vcComparison === VectorClockComparison.GREATER_THAN) {
      OpLog.verbose(
        `ConflictResolutionService: Skipping stale remote op (local dominates): ${remoteOp.id}`,
      );
      return { isStaleOrDuplicate: true, conflict: null };
    }

    // Skip duplicate operations (already applied)
    if (vcComparison === VectorClockComparison.EQUAL) {
      OpLog.verbose(
        `ConflictResolutionService: Skipping duplicate remote op: ${remoteOp.id}`,
      );
      return { isStaleOrDuplicate: true, conflict: null };
    }

    // No pending ops = no conflict possible
    if (ctx.localOpsForEntity.length === 0) {
      return { isStaleOrDuplicate: false, conflict: null };
    }

    // CONCURRENT = true conflict
    if (vcComparison === VectorClockComparison.CONCURRENT) {
      return {
        isStaleOrDuplicate: false,
        conflict: {
          entityType: remoteOp.entityType,
          entityId,
          localOps: ctx.localOpsForEntity,
          remoteOps: [remoteOp],
          suggestedResolution: this._suggestResolution(ctx.localOpsForEntity, [remoteOp]),
        },
      };
    }

    return { isStaleOrDuplicate: false, conflict: null };
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
    // Use snapshot clock only for entities that existed at snapshot time
    const entityExistedAtSnapshot =
      ctx.snapshotEntityKeys === undefined || ctx.snapshotEntityKeys.has(entityKey);
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
}
