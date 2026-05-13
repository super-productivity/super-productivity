import { inject, Injectable } from '@angular/core';
import {
  adjustForClockCorruption as adjustForClockCorruptionCore,
  buildEntityFrontier,
  convertLocalDeleteRemoteUpdatesToLww,
  deepEqual,
  extractEntityFromPayload as extractEntityFromPayloadCore,
  extractUpdateChanges as extractUpdateChangesCore,
  getEntityConfig as getEntityConfigFromRegistry,
  getPayloadKey as getPayloadKeyFromRegistry,
  isAdapterEntity,
  isIdenticalConflict as isIdenticalConflictCore,
  isArrayEntity,
  isMapEntity,
  isSingletonEntity,
  partitionLwwResolutions,
  planLwwConflictResolutions,
  suggestConflictResolution,
  type LwwResolvedConflict,
} from '@sp/sync-core';
import type { SelectByIdFactory } from '../core/entity-registry-host.types';
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
import { SyncSessionValidationService } from './sync-session-validation.service';
import { MAX_CONFLICT_RETRY_ATTEMPTS } from '../core/operation-log.const';
import {
  compareVectorClocks,
  incrementVectorClock,
  mergeVectorClocks,
  VectorClockComparison,
} from '../../core/util/vector-clock';
import { devError } from '../../util/dev-error';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import { ENTITY_REGISTRY, isSingletonEntityId } from '../core/entity-registry';
import { uuidv7 } from '../../util/uuid-v7';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';
import { SYNC_LOGGER } from '../core/sync-logger.adapter';

/**
 * Represents the result of LWW (Last-Write-Wins) conflict resolution.
 */
type LWWResolution = LwwResolvedConflict<Operation, EntityConflict>;

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
  private sessionValidation = inject(SyncSessionValidationService);
  private clientIdProvider = inject(CLIENT_ID_PROVIDER);
  private syncLogger = inject(SYNC_LOGGER);
  private entityRegistry = inject(ENTITY_REGISTRY);

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

    // Force payload.id to the canonical entityId for adapter entities.
    // lwwUpdateMetaReducer bails with "Entity data has no id" when an adapter
    // payload lacks a top-level id; a malformed/partial entityState (e.g. an
    // NgRx selector returning a stripped shape) would silently lose the LWW
    // write on remote clients. Singletons use the '*' sentinel for entityId
    // and have no `id` field — injecting `id: '*'` would pollute the singleton
    // feature state when the consumer reducer spreads entityData. (#7330)
    const basePayload =
      entityState && typeof entityState === 'object'
        ? (entityState as Record<string, unknown>)
        : {};
    const payload = isSingletonEntityId(entityId)
      ? basePayload
      : { ...basePayload, id: entityId };
    return {
      id: uuidv7(),
      actionType: toLwwUpdateActionType(entityType),
      opType: OpType.Update,
      entityType,
      entityId,
      payload,
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
  private async _validateAndRepairAfterResolution(): Promise<boolean> {
    return this.validateStateService.validateAndRepairCurrentState(
      'conflict-resolution',
      {
        callerHoldsLock: true,
      },
    );
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
    return isIdenticalConflictCore(conflict, this.syncLogger);
  }

  /**
   * Deep equality check for payloads.
   * Handles nested objects, arrays, and primitives.
   * Includes protection against circular references and deep nesting.
   *
   * @param a First value to compare
   * @param b Second value to compare
   */
  private _deepEqual(a: unknown, b: unknown): boolean {
    return deepEqual(a, b, { logger: this.syncLogger });
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

    const allOpsToApply: Operation[] = [];
    const allStoredOps: Array<{ id: string; seq: number }> = [];

    const lwwPartitions = partitionLwwResolutions<Operation, EntityConflict>(
      resolutions,
      {
        // Convert remote UPDATE operations to LWW Update format when entity was deleted locally.
        // This ensures lwwUpdateMetaReducer can recreate deleted entities (fixes DELETE vs UPDATE race).
        processRemoteWinnerOps: (conflict) => this._convertToLWWUpdatesIfNeeded(conflict),
        toEntityKey: (entityType, entityId) =>
          toEntityKey(entityType as EntityType, entityId),
      },
    );

    const {
      localWinsCount,
      remoteWinsCount,
      remoteWinsOps,
      localWinsRemoteOps,
      remoteOpsToReject,
      newLocalWinOps,
      remoteWinnerAffectedEntityKeys,
    } = lwwPartitions;
    const localOpsToReject = [...lwwPartitions.localOpsToReject];

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
      const pendingByEntity = await this.opLogStore.getUnsyncedByEntity();
      for (const entityKey of remoteWinnerAffectedEntityKeys) {
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

        // FIX #6571: Throw on apply failure (parity with applyNonConflictingOps).
        // Previously, apply failures during LWW resolution were logged but not
        // thrown, causing sync to report IN_SYNC despite lost operations.
        throw applyResult.failedOp.error;
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
    // Validation failure flips the SyncSessionValidationService latch — the
    // wrapper reads it before deciding IN_SYNC vs ERROR. (#7330)
    // ─────────────────────────────────────────────────────────────────────────
    const isValid = await this._validateAndRepairAfterResolution();
    if (!isValid) this.sessionValidation.setFailed();

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

    const plans = planLwwConflictResolutions(conflicts, {
      isArchiveAction: (op) => op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
      toEntityKey: (entityType, entityId) =>
        toEntityKey(entityType as EntityType, entityId),
    });

    for (const plan of plans) {
      let localWinOp: Operation | undefined;

      if (plan.localWinOperationKind === 'archive-win') {
        localWinOp = await this._createArchiveWinOp(plan.conflict);
      } else if (plan.localWinOperationKind === 'update') {
        localWinOp = await this._createLocalWinUpdateOp(plan.conflict);
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
    const entityKey = this._resolvePayloadKey(conflict.entityType);

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

    for (const remoteOp of conflict.remoteOps) {
      if (remoteOp.opType === OpType.Update) {
        OpLog.log(
          `ConflictResolutionService: Converting remote UPDATE to LWW Update for ` +
            `${remoteOp.entityType}:${remoteOp.entityId} (local DELETE lost)`,
        );
      }
    }

    return convertLocalDeleteRemoteUpdatesToLww<Operation>(conflict, {
      payloadKey: (entityType) => this._resolvePayloadKey(entityType as EntityType),
      toLwwUpdateActionType: (entityType) =>
        toLwwUpdateActionType(entityType as EntityType),
      isSingletonEntityId,
      onMissingBaseEntity: ({ localDeletePayloadKeys, remoteOp }) => {
        // Fallback: no full base entity available. Returning the op unchanged
        // is equivalent to rewriting actionType to LWW Update — both no-op at
        // the consumer because the payload lacks a top-level id (the LWW path
        // would bail at lwwUpdateMetaReducer's missing-id guard). The locally
        // deleted entity stays deleted; remote UPDATE changes are dropped.
        // Logged so the consumer's RECREATE_FALLBACK warn (which fires only
        // from the happy-path partial-baseEntity case above) is not the only
        // signal a partial-payload producer ran.
        OpLog.warn(
          `ConflictResolutionService: Cannot extract base entity from local DELETE for ` +
            `${remoteOp.entityType}:${remoteOp.entityId}. Falling back: entity stays deleted. ` +
            `Local DELETE payload keys: ${localDeletePayloadKeys ? JSON.stringify(localDeletePayloadKeys) : 'N/A'}`,
        );
      },
    });
  }

  private _resolvePayloadKey(entityType: EntityType): string {
    return (
      getPayloadKeyFromRegistry(this.entityRegistry, entityType) ||
      entityType.toLowerCase()
    );
  }

  /**
   * Extracts entity state from an operation payload.
   * Handles both MultiEntityPayload format and flat payloads.
   */
  private _extractEntityFromPayload(
    payload: unknown,
    entityType: EntityType,
  ): Record<string, unknown> | undefined {
    return extractEntityFromPayloadCore(payload, this._resolvePayloadKey(entityType));
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
    return extractUpdateChangesCore(payload, this._resolvePayloadKey(entityType));
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
    const config = getEntityConfigFromRegistry(this.entityRegistry, entityType);
    if (!config) {
      OpLog.warn(
        `ConflictResolutionService: No config for entity type ${entityType}, falling back to remote`,
      );
      return undefined;
    }

    try {
      // Adapter entities - use selectById
      if (isAdapterEntity(config) && config.selectById) {
        // ISSUE_PROVIDER uses the registry's factory selector shape: (id, key) => selector.
        if (entityType === 'ISSUE_PROVIDER') {
          const selectById = config.selectById as SelectByIdFactory<null>;
          return await firstValueFrom(this.store.select(selectById(entityId, null)));
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
    return suggestConflictResolution(localOps, remoteOps);
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
