import { inject, Injectable, Injector } from '@angular/core';
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
  type LwwConflictResolutionPlan,
  type LwwResolvedConflict,
} from '@sp/sync-core';
import {
  findLwwContentConflicts,
  type LwwContentConflict,
} from './lww-conflict-summary.util';
import type { SelectByIdFactory } from '../core/entity-registry-host.types';
import { Store } from '@ngrx/store';
import {
  ActionType,
  EntityConflict,
  EntityType,
  extractActionPayload,
  Operation,
  LwwUpdateMode,
  LwwUpdatePayload,
  isLwwUpdatePayload,
  isMultiEntityPayload,
  OpType,
  VectorClock,
} from '../core/operation.types';
import { toLwwUpdateActionType } from '../core/lww-update-action-types';
import { OperationApplierService } from '../apply/operation-applier.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { OpLog } from '../../core/log';
import { toEntityKey } from '../util/entity-key.util';
import { getOpEntityIds } from '../util/get-op-entity-ids.util';
import { firstValueFrom } from 'rxjs';
import { SnackService } from '../../core/snack/snack.service';
import { BannerService } from '../../core/banner/banner.service';
import { BannerId } from '../../core/banner/banner.model';
import { escapeHtml } from '../../util/escape-html';
import { TranslateService } from '@ngx-translate/core';
import { T } from '../../t.const';
import { ValidateStateService } from '../validation/validate-state.service';
import { SyncSessionValidationService } from './sync-session-validation.service';
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
import { processDeferredActionsAfterRemoteApply } from './process-deferred-actions-flush.util';
import { IncompleteRemoteOperationsError } from '../core/errors/sync-errors';
import { ConflictJournalService } from './conflict-journal.service';
import { SyncConflictBannerService } from './sync-conflict-banner.service';
import { buildConflictJournalEntry } from './conflict-journal-emission.util';
import {
  isDisjointMergeEligible,
  mergeChangedFields,
  synthesizeMergedChanges,
} from './conflict-disjoint-merge.util';
import { RECREATE_FALLBACK } from '../core/recreate-fallback.const';

/**
 * Represents the result of LWW (Last-Write-Wins) conflict resolution.
 */
type LWWResolution = LwwResolvedConflict<Operation, EntityConflict>;

/**
 * SPAP-14: one conflict resolved by a disjoint-field auto-merge. `mergedOp` is a
 * synthetic LWW Update carrying the UNION of both sides' changes; it is applied
 * locally AND uploaded, and both original sides are rejected (superseded).
 */
interface MergedResolution {
  conflict: EntityConflict;
  mergedOp: Operation;
  /** Kept so STEP 3b can journal the merge AFTER the merged op is durably appended. */
  plan: LwwConflictResolutionPlan<EntityConflict>;
}

/** Result of `_resolveConflictsWithLWW`: LWW winners plus disjoint merges. */
interface ResolvedConflicts {
  lwwResolutions: LWWResolution[];
  mergedResolutions: MergedResolution[];
}

interface AutoResolveConflictsLwwOptions {
  callerHoldsOperationLogLock?: boolean;
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
  private bannerService = inject(BannerService);
  // Optional: production always has it (TranslateModule.forRoot); optional keeps
  // the many specs that construct this service from needing to provide it.
  private translateService = inject(TranslateService, { optional: true });
  private validateStateService = inject(ValidateStateService);
  private sessionValidation = inject(SyncSessionValidationService);
  private clientIdProvider = inject(CLIENT_ID_PROVIDER);
  private syncLogger = inject(SYNC_LOGGER);
  private entityRegistry = inject(ENTITY_REGISTRY);
  private injector = inject(Injector);
  private conflictJournal = inject(ConflictJournalService);
  private syncConflictBanner = inject(SyncConflictBannerService);

  /**
   * SPAP-13 (observe-only): conflicts whose CONCURRENT status was FORCED by
   * `_adjustForClockCorruption` escalation. Tagged here at detection time and
   * read at resolution time so the journal can attribute those resolutions to
   * `clock-corruption-suspected`. Keyed by the live EntityConflict object (the
   * same reference flows detection → autoResolveConflictsLWW), so a WeakSet
   * both avoids mutating the shared type and cannot leak across sync cycles.
   * Purely a side-channel: it never changes which op resolution picks.
   *
   * FRAGILE: attribution depends on the SAME EntityConflict reference surviving
   * from detection (`.add`) to resolution (`.has`). A future refactor that
   * clones or rebuilds the conflict object between those points would silently
   * drop the `clock-corruption-suspected` classification (no error, just wrong
   * journal reason). Keep the reference stable or switch to an explicit flag.
   */
  private readonly _corruptionSuspectedConflicts = new WeakSet<EntityConflict>();

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
    lwwUpdateMode: LwwUpdateMode = 'replace',
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
    const actionPayload = isSingletonEntityId(entityId)
      ? basePayload
      : { ...basePayload, id: entityId };
    const payload: LwwUpdatePayload = {
      actionPayload,
      entityChanges: [],
      lwwUpdateMode,
    };
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
    const { lwwResolutions: resolutions, mergedResolutions } =
      await this._resolveConflictsWithLWW(conflicts);
    const additionalLocalIntentOps =
      await this._preservePartiallyRejectedLocalBulkDeletes(resolutions);

    const allOpsToApply: Operation[] = [];
    const allStoredOps: Array<{ id: string; seq: number }> = [];
    // Synthetic local ops (disjoint merges) ride in the apply batch but are NOT
    // pending remote rows — the reducer-commit checkpoint must never see them.
    const checkpointExemptOpIds = new Set<string>();

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

    const uniqueOpsById = (ops: Operation[]): Operation[] => [
      ...new Map(ops.map((op) => [op.id, op])).values(),
    ];
    let remoteWinsOps = uniqueOpsById(lwwPartitions.remoteWinsOps);
    let localWinsRemoteOps = uniqueOpsById(lwwPartitions.localWinsRemoteOps);
    let remoteOpsToReject = [...new Set(lwwPartitions.remoteOpsToReject)];
    const newLocalWinOps = uniqueOpsById([
      ...lwwPartitions.newLocalWinOps,
      ...additionalLocalIntentOps,
    ]);
    const { remoteWinnerAffectedEntityKeys } = lwwPartitions;
    const localOpsToReject = [...new Set(lwwPartitions.localOpsToReject)];
    const localOpsToRejectSet = new Set(localOpsToReject);
    let writtenLocalWinOps: Operation[] = [];

    // A multi-entity action cannot be split when different entities pick
    // different winners. Persist/apply the original remote op once, then replay
    // local-win snapshots after it as compensations. The remote row is stored as
    // a rejected loser before those local rows, so status-blind hydration replays
    // the same deterministic sequence after a crash.
    const multiEntityRemoteOpWinners = new Map<
      string,
      {
        op: Operation;
        hasLocalWinner: boolean;
        hasRemoteWinner: boolean;
        localWinnerKeys: Set<string>;
        resolvedEntityKeys: Set<string>;
        localWinOpIds: Set<string>;
        remoteWinCompensationIds: Set<string>;
      }
    >();
    const compensatedRemoteOps = new Map<string, Operation>();
    const compensationOpIdsToApply = new Set<string>();
    for (const resolution of resolutions) {
      for (const remoteOp of resolution.conflict.remoteOps) {
        if (getOpEntityIds(remoteOp).length <= 1) {
          continue;
        }
        const winners = multiEntityRemoteOpWinners.get(remoteOp.id) ?? {
          op: remoteOp,
          hasLocalWinner: false,
          hasRemoteWinner: false,
          localWinnerKeys: new Set<string>(),
          resolvedEntityKeys: new Set<string>(),
          localWinOpIds: new Set<string>(),
          remoteWinCompensationIds: new Set<string>(),
        };
        winners.resolvedEntityKeys.add(
          toEntityKey(resolution.conflict.entityType, resolution.conflict.entityId),
        );
        if (resolution.winner === 'local') {
          winners.hasLocalWinner = true;
          winners.localWinnerKeys.add(
            toEntityKey(resolution.conflict.entityType, resolution.conflict.entityId),
          );
          if (resolution.localWinOp) {
            winners.localWinOpIds.add(resolution.localWinOp.id);
          }
        } else {
          winners.hasRemoteWinner = true;
        }
        multiEntityRemoteOpWinners.set(remoteOp.id, winners);
      }
    }

    // Conflict detection reports only entities that actually conflict. Every
    // other entity touched by the same remote atomic action is therefore an
    // uncontested remote winner and must keep the original op eligible for
    // apply. Without this, one local-winning sibling suppresses the remote
    // change for every unaffected sibling.
    for (const winners of multiEntityRemoteOpWinners.values()) {
      winners.hasRemoteWinner ||= getOpEntityIds(winners.op).some(
        (entityId) =>
          !winners.resolvedEntityKeys.has(toEntityKey(winners.op.entityType, entityId)),
      );
    }

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
        const recreationOp = await this._createRemoteWinRecreationOp(
          resolution.conflict,
          remoteOp,
        );
        if (recreationOp === undefined) {
          // The local DELETE carries no reconstructable base entity (e.g. a bulk
          // deleteTasks op stores only taskIds), so we cannot recreate the
          // remote-winning entity. Degrade like the single-entity path
          // (_convertToLWWUpdatesIfNeeded / onMissingBaseEntity) instead of
          // throwing: throwing here aborts autoResolveConflictsLWW without
          // advancing the cursor, so the same op re-downloads and wedges sync
          // forever. The entity stays locally deleted (a bounded divergence for
          // this one entity, logged below) while the rest of the batch resolves.
          OpLog.err(
            `ConflictResolutionService: Cannot recreate remote winner ${remoteOp.id} for ` +
              `${resolution.conflict.entityType}:${resolution.conflict.entityId} — local delete ` +
              `carried no base entity. Entity stays deleted on this client; skipping recreation.`,
          );
          continue;
        }
        if (recreationOp === null) {
          continue;
        }
        newLocalWinOps.push(recreationOp);
        multiEntityRemoteOpWinners
          .get(remoteOp.id)
          ?.remoteWinCompensationIds.add(recreationOp.id);
      }
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
      if (
        hasMixedWinners &&
        [...winners.localWinnerKeys].some(
          (entityKey) => !compensatedEntityKeys.has(entityKey),
        )
      ) {
        throw new Error(
          `ConflictResolutionService: Cannot safely compensate mixed multi-entity winners for ${remoteOp.id}`,
        );
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
          const markedCompensation: Operation = {
            ...localWinOp,
            payload: {
              ...localWinOp.payload,
              recreatesEntityAfterDelete: true,
            },
          };
          newLocalWinOps[localWinOpIndex] = markedCompensation;
          newLocalWinOpsById.set(localWinOpId, markedCompensation);
          compensationOpIdsToApply.add(localWinOpId);

          // The applied remote bulk delete cascade-deletes the winning parent's
          // subtasks (handleDeleteTasks expands parent → subTaskIds), but only
          // the parent has a compensation op. Without recreating the subtasks
          // the parent resurfaces with its subtree silently lost on every
          // device (#8956). Emit recreate-after-delete snapshots for them too.
          const subtaskRecreationOps =
            await this._createSubtaskRecreationOpsForWinningParent(
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
      remoteOpsToReject = [...new Set([...remoteOpsToReject, remoteOp.id])];

      for (const entityId of getOpEntityIds(remoteOp)) {
        remoteWinnerAffectedEntityKeys.add(toEntityKey(remoteOp.entityType, entityId));
      }
      if (hasMixedWinners) {
        for (const localWinnerKey of winners.localWinnerKeys) {
          remoteWinnerAffectedEntityKeys.delete(localWinnerKey);
        }
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
    // Atomically persist remote losers followed by their local-win
    // compensations. Hydration is status-blind, so exposing a durable loser
    // without its later compensation would let the loser overwrite local state
    // after a crash.
    // ─────────────────────────────────────────────────────────────────────────
    if (localWinsRemoteOps.length > 0 || newLocalWinOps.length > 0) {
      const result = await this.opLogStore.appendMixedSourceBatchSkipDuplicates([
        { ops: localWinsRemoteOps, source: 'remote' },
        { ops: newLocalWinOps, source: 'local' },
      ]);
      writtenLocalWinOps = result.written
        .filter((entry) => entry.source === 'local')
        .map((entry) => entry.op);
      if (result.skippedCount > 0) {
        OpLog.verbose(
          `ConflictResolutionService: Skipped ${result.skippedCount} duplicate mixed-resolution op(s)`,
        );
      }
      for (const op of writtenLocalWinOps) {
        OpLog.normal(
          `ConflictResolutionService: Appended local-win update op ${op.id} for ${op.entityType}:${op.entityId}`,
        );
      }

      if (compensatedRemoteOps.size > 0) {
        allOpsToApply.push(...compensatedRemoteOps.values());
        for (const remoteOp of compensatedRemoteOps.values()) {
          checkpointExemptOpIds.add(remoteOp.id);
        }
        const writtenCompensations = writtenLocalWinOps.filter((op) =>
          compensationOpIdsToApply.has(op.id),
        );
        allOpsToApply.push(...writtenCompensations);
        for (const compensation of writtenCompensations) {
          checkpointExemptOpIds.add(compensation.id);
        }
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
          if (!localOpsToRejectSet.has(op.id)) {
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
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 3b (SPAP-14): Process disjoint-field merges.
    //
    // For each merge we: (1) reject BOTH original sides (the merged op
    // supersedes them); (2) persist the original remote ops as rejected so they
    // are recorded-as-seen but not applied (mirrors the local-wins remote-op
    // bookkeeping); (3) append the synthesized merged op as a PENDING LOCAL op
    // (so it uploads on next sync) AND queue it into the apply batch (so THIS
    // client's state picks up the remote side's fields — local's are already
    // optimistically applied). The op stays unsynced+not-rejected → it uploads.
    // ─────────────────────────────────────────────────────────────────────────
    if (mergedResolutions.length > 0) {
      for (const merged of mergedResolutions) {
        for (const op of merged.conflict.localOps) {
          if (!localOpsToRejectSet.has(op.id)) {
            localOpsToReject.push(op.id);
            localOpsToRejectSet.add(op.id);
          }
        }
        remoteOpsToReject.push(...merged.conflict.remoteOps.map((op) => op.id));
      }

      // ONE atomic mixed-source batch for all merge writes: an original remote
      // loser must never be durable without its superseding merged op (crash
      // safety), and the batch rebases each merged op on the durable clock so a
      // synthetic op cannot reuse or regress this client's counter. The rebased
      // clock still dominates both original sides.
      const mergeBatch = await this.opLogStore.appendMixedSourceBatchSkipDuplicates([
        {
          ops: mergedResolutions.flatMap((merged) => merged.conflict.remoteOps),
          source: 'remote',
        },
        {
          ops: mergedResolutions.map((merged) => merged.mergedOp),
          source: 'local',
        },
      ]);
      if (mergeBatch.skippedCount > 0) {
        OpLog.verbose(
          `ConflictResolutionService: Skipped ${mergeBatch.skippedCount} duplicate merge-resolution op(s)`,
        );
      }

      const writtenMergedOpIds = new Set<string>();
      for (const entry of mergeBatch.written) {
        if (entry.source !== 'local') {
          continue;
        }
        // Apply/upload the WRITTEN op — it carries the rebased vector clock.
        allStoredOps.push({ id: entry.op.id, seq: entry.seq });
        allOpsToApply.push(entry.op);
        checkpointExemptOpIds.add(entry.op.id);
        writtenMergedOpIds.add(entry.op.id);
        OpLog.normal(
          `ConflictResolutionService: Appended disjoint-merge op ${entry.op.id} for ` +
            `${entry.op.entityType}:${entry.op.entityId}`,
        );
      }

      // Journal ONLY after the append: once persisted as a pending local op the
      // merge is durable (it applies/uploads even across a crash), so a `merged`
      // ("kept both") entry can never describe a merge that didn't happen. The
      // inverse window is accepted: batch committed but crash before this loop
      // means a durable merge without a journal entry (observe-only log; the
      // remote originals are recorded-as-seen, so it never re-enters
      // resolution and the entry stays absent).
      for (const merged of mergedResolutions) {
        if (writtenMergedOpIds.has(merged.mergedOp.id)) {
          await this._journalMergedResolution(merged.plan);
        }
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
    // STEP 5: Apply remote ops in a single batch.
    // Merge their clocks before entering the reducer/deferred-action window.
    // Pending rows make this durable frontier crash-safe, and any subsequent
    // dispatch/checkpoint/bookkeeping failure can drain buffered local actions.
    // (#7700)
    // ─────────────────────────────────────────────────────────────────────────
    let canDrainDeferredActions = false;
    let hasPrimaryError = false;
    try {
      if (allOpsToApply.length > 0) {
        OpLog.normal(
          `ConflictResolutionService: Applying ${allOpsToApply.length} ops in single batch`,
        );
        await this.opLogStore.mergeRemoteOpClocks(allOpsToApply);
        canDrainDeferredActions = true;

        const opIdToSeq = new Map(allStoredOps.map((o) => [o.id, o.seq]));
        const applyResult = await this.operationApplier.applyOperations(allOpsToApply, {
          skipDeferredLocalActions: true,
          onReducersCommitted: async (reducerCommittedOps) => {
            // Disjoint-merge ops are synthetic LOCAL rows in the apply batch;
            // their durability contract is the mixed-source append + upload
            // path. The checkpoint's pending-only assertion must only see rows
            // appended with pendingApply.
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
            await this.opLogStore.markReducersCommittedAndMergeClocks(
              reducerCommittedSeqs,
              checkpointOps,
            );
          },
        });

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
      }
    } catch (error) {
      hasPrimaryError = true;
      throw error;
    } finally {
      if (canDrainDeferredActions) {
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

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 6: Show non-blocking notification
    //
    // Distinguish "routine" self-healing (reschedule/repeat/archive/done churn
    // that resolves correctly on its own) from resolutions that discarded a real
    // user content edit (title/notes/subtasks). Routine stays quiet with the
    // existing transient count; genuine content loss gets a dismissible banner
    // naming the affected task(s) so the user can double-check. (#8694)
    // ─────────────────────────────────────────────────────────────────────────
    if (resolutions.length > 0) {
      await this._notifyResolutionOutcome(resolutions);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 7: Validate and repair state after resolution
    // Validation failure flips the SyncSessionValidationService latch — the
    // wrapper reads it before deciding IN_SYNC vs ERROR. (#7330)
    // ─────────────────────────────────────────────────────────────────────────
    const isValid = await this._validateAndRepairAfterResolution();
    if (!isValid) this.sessionValidation.setFailed();

    // Count both LWW local-win ops AND disjoint-merge ops (STEP 3b): each merge
    // appended a synthesized pending-local op that still needs uploading. The
    // caller uses this count to trigger the immediate re-upload
    // (immediate-upload.service.ts) — omitting merges lets a merge-only sync
    // report IN_SYNC while its merged op sits unsynced until a later cycle.
    // Mirrors the rejection-handler accumulation in operation-log-sync.service.
    // writtenLocalWinOps (not newLocalWinOps) is the post-dedupe set the atomic
    // mixed-source batch actually persisted.
    return {
      localWinOpsCreated: writtenLocalWinOps.length + mergedResolutions.length,
    };
  }

  /**
   * Surfaces the outcome of auto-resolution to the user (#8694).
   *
   * Routine self-healing (rescheduling, repeat/archive/done churn) keeps the
   * existing quiet transient snack. When a resolution discarded a real user
   * content edit (title/notes/subtasks), a dismissible banner names the affected
   * task(s) so the user knows data may differ and can double-check.
   *
   * Purely a read of the already-decided resolutions — it never influences which
   * ops were applied or rejected.
   */
  private async _notifyResolutionOutcome(resolutions: LWWResolution[]): Promise<void> {
    const contentConflicts = findLwwContentConflicts(resolutions, (entityType) =>
      this._resolvePayloadKey(entityType as EntityType),
    );

    if (contentConflicts.length === 0) {
      // SPAP-15: no named content loss to surface here. If the sync journaled
      // any (non-content) unreviewed conflicts, the summary banner names the
      // count + REVIEW link; otherwise it stays silent (replaces the old snack).
      await this.syncConflictBanner.maybeShowSummaryBanner();
      return;
    }

    await this._showContentConflictBanner(contentConflicts);
  }

  /**
   * Shows a dismissible banner naming the tasks whose edits diverged and were
   * auto-resolved by keeping the most recent version. Uses the banner's built-in
   * dismiss button — no custom action needed.
   *
   * Titles are user content escaped before display: the banner renders via
   * `[innerHTML]` and titles come from synced remote data, so Angular's own
   * sanitizer is the primary XSS control and this escaping is defense-in-depth
   * plus correct literal rendering (a `<b>`-looking title shows as text). Titles
   * MUST NOT be logged — the log history is exportable (sync rule #9).
   */
  private async _showContentConflictBanner(
    contentConflicts: LwwContentConflict[],
  ): Promise<void> {
    const MAX_NAMED = 3;
    const labels = await Promise.all(
      contentConflicts
        .slice(0, MAX_NAMED)
        .map((conflict) => this._buildContentConflictLabel(conflict)),
    );
    const named = labels.join(', ');
    const taskList = contentConflicts.length > MAX_NAMED ? `${named} …` : named;

    this.bannerService.open({
      id: BannerId.SyncConflictContentResolved,
      ico: 'sync_problem',
      msg: T.F.SYNC.B.CONTENT_CONFLICT_RESOLVED,
      translateParams: { taskList },
      // SPAP-15: REVIEW opens the conflicts page; DISMISS auto-renders (no action2).
      action: {
        label: T.F.SYNC.CONFLICT_REVIEW.BANNER_REVIEW,
        fn: () => this.syncConflictBanner.navigateToReview(),
      },
    });
  }

  /**
   * Builds the display label for one conflicted task inside the banner's task
   * list. Normally just the (escaped, quoted) current title. When the discarded
   * edit changed the title, the current title is the *kept* value — useless for
   * double-checking on its own — so we also name the discarded title: `"kept"
   * (discarded: "dropped")`. Both values are escaped (rendered via `[innerHTML]`,
   * see `_showContentConflictBanner`).
   */
  private async _buildContentConflictLabel(
    conflict: LwwContentConflict,
  ): Promise<string> {
    const keptTitle = await this._getContentConflictTitle(conflict.entityId);
    const kept = `"${escapeHtml(keptTitle)}"`;
    const discardedTitle = conflict.discardedTitle?.trim();
    // Skip the annotation when nothing meaningful to add: no title was
    // discarded, or the discarded title equals the current one. The equality
    // case covers two situations, both correctly silenced: (a) both devices set
    // the same title; (b) a title edit lost to a concurrent *other-field* remote
    // win — the winner didn't touch the title, so the current state still shows
    // the (now-rejected) local title, which equals the discarded value. In both
    // an annotation would read `"X" (discarded: "X")` — pure noise, no divergence
    // to point at — so we render just the current title. (For the common
    // title-vs-title case the current title IS the winning value and differs
    // from the discarded one, so the annotation shows.)
    if (!discardedTitle || discardedTitle === keptTitle.trim()) {
      return kept;
    }
    const discarded = `"${escapeHtml(discardedTitle)}"`;
    return (
      this.translateService?.instant(T.F.SYNC.B.CONTENT_CONFLICT_TITLE_CHANGE, {
        kept,
        discarded,
      }) ?? `${kept} (discarded: ${discarded})`
    );
  }

  private async _getContentConflictTitle(entityId: string): Promise<string> {
    const entity = await this.getCurrentEntityState('TASK' as EntityType, entityId);
    const title = (entity as { title?: string } | undefined)?.title;
    // Guard against a corrupt/non-string title from remote state before .trim().
    if (typeof title === 'string' && title.trim().length) {
      return title;
    }
    return (
      this.translateService?.instant(T.F.SYNC.B.CONTENT_CONFLICT_UNTITLED) ??
      'Untitled task'
    );
  }

  /**
   * Resolves conflicts using LWW timestamp comparison.
   *
   * @param conflicts - The conflicts to resolve
   * @returns Array of resolutions with winner and optional new update op
   */
  private async _resolveConflictsWithLWW(
    conflicts: EntityConflict[],
  ): Promise<ResolvedConflicts> {
    const resolutions: LWWResolution[] = [];
    const mergedResolutions: MergedResolution[] = [];

    const plans = planLwwConflictResolutions(conflicts, {
      isArchiveAction: (op) => op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
      toEntityKey: (entityType, entityId) =>
        toEntityKey(entityType as EntityType, entityId),
    });

    // SPAP-14 hardening: disjoint-merge is only safe for a SINGLE remote op per
    // entity per batch. detectConflicts emits one conflict per remote op with no
    // per-entity aggregation, so an entity with ≥2 concurrent remote ops (e.g.
    // one device edited title then notes offline) would synthesize multiple
    // merged ops for the same entity; their clocks dominate one another, so a
    // dominated sibling can be superseded and its field silently dropped —
    // falsely journaled as a successful "kept both" merge. Refuse the merge for
    // any entity with >1 conflict this batch and fall back to whole-entity LWW
    // (baseline behaviour, no false merge). Per-entity aggregation into one op is
    // a possible future improvement; refusal is the safe floor.
    const conflictCountByEntity = new Map<string, number>();
    for (const plan of plans) {
      const key = toEntityKey(
        plan.conflict.entityType as EntityType,
        plan.conflict.entityId,
      );
      conflictCountByEntity.set(key, (conflictCountByEntity.get(key) ?? 0) + 1);
    }

    for (const plan of plans) {
      // SPAP-14: BEFORE the whole-entity LWW plan, try a disjoint-field merge —
      // when both sides edited the same entity but DIFFERENT real fields, keep
      // BOTH instead of discarding the loser. Delete/archive, same-field
      // (overlapping), and multi-remote-op-per-entity conflicts are NOT eligible
      // and fall through to the exact LWW + SPAP-13 path below, byte-unchanged.
      const entityKey = toEntityKey(
        plan.conflict.entityType as EntityType,
        plan.conflict.entityId,
      );
      const mergedOp =
        (conflictCountByEntity.get(entityKey) ?? 0) > 1
          ? undefined
          : await this._tryCreateDisjointMergeOp(plan);
      if (mergedOp) {
        // NOT journaled here: a `merged` entry claims "both sides kept", which
        // is only true once the merged op is durably appended — STEP 3b journals
        // it right after the append, so a failure in between cannot leave a
        // phantom "kept both" entry. (LWW entries below journal at plan time:
        // they describe a pick, not a new op, so there is nothing to wait for.)
        mergedResolutions.push({ conflict: plan.conflict, mergedOp, plan });
        OpLog.normal(
          `ConflictResolutionService: Disjoint-field merge for ` +
            `${plan.conflict.entityType}:${plan.conflict.entityId} (kept both sides)`,
        );
        continue;
      }

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

      // SPAP-13 (observe-only): journal this auto-resolution so the discarded
      // side is preserved and reviewable. Reads `plan`/`conflict` only — never
      // mutates the resolution. Journal failures are swallowed inside
      // `_journalResolution`, so they cannot affect what LWW picked.
      await this._journalResolution(plan);

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

    return { lwwResolutions: resolutions, mergedResolutions };
  }

  /**
   * SPAP-13 (observe-only): builds and records one conflict-journal entry for an
   * already-decided LWW plan. Classification is pure (see
   * `buildConflictJournalEntry`); `conflictJournal.record` swallows its own
   * errors. This method therefore cannot alter which op resolution picks — it
   * only logs the outcome (and preserves the discarded side's field values).
   */
  private async _journalResolution(
    plan: LwwConflictResolutionPlan<EntityConflict>,
  ): Promise<void> {
    // Belt-and-suspenders observe-only guard: neither classification nor the
    // DB write may ever throw back into resolution and change what LWW picked.
    try {
      const entry = buildConflictJournalEntry({
        entityType: plan.conflict.entityType,
        entityId: plan.conflict.entityId,
        winner: plan.winner,
        planReason: plan.reason,
        localOps: plan.conflict.localOps,
        remoteOps: plan.conflict.remoteOps,
        isCorruptionSuspected: this._corruptionSuspectedConflicts.has(plan.conflict),
        resolvePayloadKey: (entityType) => this._resolvePayloadKey(entityType),
      });
      await this.conflictJournal.record(entry);
    } catch (err) {
      OpLog.err('ConflictResolutionService: conflict-journal hook failed (ignored)', err);
    }
  }

  /**
   * SPAP-14: whether this plan is an archive plan. Archive/delete-wins semantics
   * are left 100% untouched by disjoint-merge — the archive must win the whole
   * entity, never be partially merged with a concurrent edit.
   */
  private _isArchivePlan(plan: LwwConflictResolutionPlan<EntityConflict>): boolean {
    return (
      plan.reason === 'remote-archive' ||
      plan.reason === 'local-archive' ||
      plan.reason === 'local-archive-sibling' ||
      plan.localWinOperationKind === 'archive-win'
    );
  }

  /**
   * SPAP-14: if this conflict is a disjoint-field merge, synthesize the merged
   * UPDATE op; otherwise return undefined so the caller uses the whole-entity LWW
   * path unchanged.
   *
   * The merged op is deterministic and CONVERGENT: both clients synthesize the
   * byte-identical merged CHANGES DELTA (union of both sides' disjoint real
   * fields, with noise fields resolved by a deterministic `(timestamp, clientId)`
   * tiebreak — see `synthesizeMergedChanges`) and a vector clock that DOMINATES
   * both sides (via `mergeAndIncrementClocks`, mirroring `_createLocalWinUpdateOp`).
   * The op carries a PARTIAL delta (not a full-entity snapshot), so untouched
   * fields that momentarily differ between the two clients can't ride along and
   * diverge; `lwwUpdateMetaReducer` applies it via `updateOne` (a shallow merge).
   * It uses the standard LWW Update action type and the max timestamp across both
   * sides, so when two independently-synthesized merged ops meet they carry
   * identical payloads and resolve by ordinary LWW — never re-merging.
   *
   * Returns undefined (→ fall back to LWW) if the conflict is not merge-eligible,
   * the current entity state is unavailable, or there is no client id.
   */
  private async _tryCreateDisjointMergeOp(
    plan: LwwConflictResolutionPlan<EntityConflict>,
  ): Promise<Operation | undefined> {
    if (this._isArchivePlan(plan)) {
      return undefined;
    }

    const { conflict } = plan;
    if (conflict.remoteOps.some((op) => getOpEntityIds(op).length > 1)) {
      return undefined;
    }
    const payloadKey = this._resolvePayloadKey(conflict.entityType);

    // The merged op carries a PARTIAL delta. If it later has to RECREATE a
    // concurrently-deleted entity (lwwUpdateMetaReducer's addOne branch — reached
    // by a passive observer that applied a remote delete before this op, which
    // does NOT pass through the full-entity reconstruction in
    // `_convertToLWWUpdatesIfNeeded`), the entity must be backfillable to a
    // schema-valid shape. Only types with a RECREATE_FALLBACK are; for others a
    // bare partial `addOne` yields a Typia-invalid entity ("Repair failed"
    // dead-end). Refuse the merge for fallback-less types and fall back to
    // whole-entity LWW, whose local-win op carries a full snapshot that recreates
    // losslessly. See recreate-fallback.const.ts.
    if (!RECREATE_FALLBACK[conflict.entityType]) {
      return undefined;
    }

    if (
      !isDisjointMergeEligible({
        localOps: conflict.localOps,
        remoteOps: conflict.remoteOps,
        payloadKey,
      })
    ) {
      return undefined;
    }

    // The merged entity is built on THIS client's current state (= base + local
    // changes). If it is unavailable, we cannot merge safely → fall back to LWW.
    const currentEntityState = await this.getCurrentEntityState(
      conflict.entityType,
      conflict.entityId,
    );
    if (currentEntityState === undefined || currentEntityState === null) {
      OpLog.warn(
        `ConflictResolutionService: Cannot disjoint-merge - entity state unavailable: ` +
          `${conflict.entityType}:${conflict.entityId}. Falling back to LWW.`,
      );
      return undefined;
    }

    const clientId = await this.clientIdProvider.loadClientId();
    if (!clientId) {
      OpLog.err('ConflictResolutionService: Cannot disjoint-merge - no client ID');
      return undefined;
    }

    const localChanges = mergeChangedFields(conflict.localOps, payloadKey);
    const remoteChanges = mergeChangedFields(conflict.remoteOps, payloadKey);
    const localTs = Math.max(...conflict.localOps.map((op) => op.timestamp));
    const remoteTs = Math.max(...conflict.remoteOps.map((op) => op.timestamp));

    // The merged op carries ONLY the union of both sides' changed fields (a
    // partial delta), NOT a full-entity snapshot of `currentEntityState`. The
    // delta is derived purely from the two sides' ops, so both clients compute
    // the byte-identical map — a full snapshot would drag along untouched fields
    // that can differ between clients under staggered sync and diverge forever.
    // The lwwUpdateMetaReducer applies it via `updateOne` (a shallow merge), so
    // fields outside the delta keep their own values. See `synthesizeMergedChanges`.
    const mergedChanges = synthesizeMergedChanges(
      localChanges,
      remoteChanges,
      { timestamp: localTs, clientId: conflict.localOps[0]?.clientId ?? clientId },
      { timestamp: remoteTs, clientId: conflict.remoteOps[0]?.clientId ?? '' },
    );

    // Clock dominates BOTH sides so the merged op supersedes them and propagates
    // through normal sync. No client-side pruning (mirrors _createLocalWinUpdateOp).
    const allClocks = [
      ...conflict.localOps.map((op) => op.vectorClock),
      ...conflict.remoteOps.map((op) => op.vectorClock),
    ];
    const newClock = this.mergeAndIncrementClocks(allClocks, clientId);

    // Deterministic timestamp both clients agree on (max across both sides), so
    // two independently-synthesized merged ops tie under LWW and converge.
    const mergedTimestamp = Math.max(localTs, remoteTs);

    return this.createLWWUpdateOp(
      conflict.entityType,
      conflict.entityId,
      mergedChanges,
      clientId,
      newClock,
      mergedTimestamp,
      'patch',
    );
  }

  /**
   * SPAP-14 (observe-only): journal a disjoint-field merge as `merged` /
   * `disjoint-merge` / `info`. Nothing was discarded, so it must NOT count toward
   * the unreviewed count. Like `_journalResolution`, any failure is swallowed and
   * can never affect resolution. Called from STEP 3b AFTER the merged op is
   * appended — not at plan time — so the entry never describes a merge that was
   * never persisted.
   */
  private async _journalMergedResolution(
    plan: LwwConflictResolutionPlan<EntityConflict>,
  ): Promise<void> {
    try {
      const entry = buildConflictJournalEntry({
        entityType: plan.conflict.entityType,
        entityId: plan.conflict.entityId,
        winner: 'merged',
        planReason: plan.reason,
        localOps: plan.conflict.localOps,
        remoteOps: plan.conflict.remoteOps,
        isCorruptionSuspected: this._corruptionSuspectedConflicts.has(plan.conflict),
        resolvePayloadKey: (entityType) => this._resolvePayloadKey(entityType),
      });
      await this.conflictJournal.record(entry);
    } catch (err) {
      OpLog.err(
        'ConflictResolutionService: disjoint-merge journal hook failed (ignored)',
        err,
      );
    }
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
   * Replaces a locally winning DELETE whose original row is rejected during
   * resolution. Keeping the original payload/scope preserves the atomic user
   * intent, while the merged clock prevents the remote loser from resurfacing.
   */
  private async _createReplacementDeleteOp(
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
    const newClock = this.mergeAndIncrementClocks(allClocks, clientId);

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
   * A local deleteTasks action can conflict for only one task while also
   * deleting unaffected siblings. Rejecting the original atomic row is
   * necessary for the remote-winning task, but would otherwise prevent those
   * sibling deletions from ever reaching another client.
   *
   * Replace each affected bulk row with one narrowed delete operation that
   * excludes explicit remote winners, retains uncontested/local-winning
   * siblings, and dominates every conflict clock involving the original row.
   */
  private async _preservePartiallyRejectedLocalBulkDeletes(
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
          localOp.actionType !== ActionType.TASK_SHARED_DELETE_MULTIPLE ||
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
          resolution.localWinOp?.actionType === ActionType.TASK_SHARED_DELETE_MULTIPLE
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
    const scopedActionPayload = {
      ...extractActionPayload(originalPayload),
      taskIds: retainedEntityIds,
    };
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
      vectorClock: this.mergeAndIncrementClocks(allClocks, clientId),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
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
   * Creates a durable, single-entity recreate snapshot when one entity in a
   * winning remote multi-entity UPDATE was deleted locally. `null` means the
   * original operation already has recreate semantics; `undefined` means the
   * remote result cannot be reconstructed safely from the available payloads.
   */
  private async _createRemoteWinRecreationOp(
    conflict: EntityConflict,
    remoteOp: Operation,
  ): Promise<Operation | null | undefined> {
    if (remoteOp.actionType === toLwwUpdateActionType(remoteOp.entityType)) {
      return null;
    }

    const convertedOp = this._convertToLWWUpdatesIfNeeded(conflict).find(
      (op) => op.id === remoteOp.id,
    );
    if (
      !convertedOp ||
      convertedOp.actionType !== toLwwUpdateActionType(remoteOp.entityType)
    ) {
      return undefined;
    }

    const clientId = await this.clientIdProvider.loadClientId();
    if (!clientId) {
      OpLog.err(
        'ConflictResolutionService: Cannot create remote-win recreation op - no client ID',
      );
      return undefined;
    }

    const allClocks = [
      ...conflict.localOps.map((op) => op.vectorClock),
      ...conflict.remoteOps.map((op) => op.vectorClock),
    ];
    return this.createLWWUpdateOp(
      conflict.entityType,
      conflict.entityId,
      extractActionPayload(convertedOp.payload),
      clientId,
      this.mergeAndIncrementClocks(allClocks, clientId),
      remoteOp.timestamp,
    );
  }

  /**
   * When a remote bulk delete wins for some tasks but a parent task wins
   * locally (mixed multi-entity winner), the whole remote delete is applied and
   * `handleDeleteTasks` cascade-deletes that parent's subtasks. Only the parent
   * gets an LWW recreate compensation, so the subtasks — pure collateral of the
   * cascade, carrying no local op and not in the delete's entityIds — would be
   * silently and permanently lost across every device (#8956).
   *
   * Emit a recreate-after-delete snapshot for each still-present subtask so the
   * whole surviving subtree propagates. Only TASK entities cascade; subtasks
   * explicitly targeted by the remote op (already resolved on their own) and
   * subtasks deleted on THIS device are left untouched.
   */
  private async _createSubtaskRecreationOpsForWinningParent(
    parentCompensationOp: Operation,
    remoteDeleteOp: Operation,
  ): Promise<Operation[]> {
    if (parentCompensationOp.entityType !== 'TASK' || !parentCompensationOp.entityId) {
      return [];
    }
    const parentState = await this.getCurrentEntityState(
      'TASK' as EntityType,
      parentCompensationOp.entityId,
    );
    const subTaskIds =
      parentState && typeof parentState === 'object'
        ? ((parentState as Record<string, unknown>)['subTaskIds'] as string[] | undefined)
        : undefined;
    if (!Array.isArray(subTaskIds) || subTaskIds.length === 0) {
      return [];
    }
    const clientId = await this.clientIdProvider.loadClientId();
    if (!clientId) {
      OpLog.err(
        'ConflictResolutionService: Cannot recreate winning parent subtasks - no client ID',
      );
      return [];
    }
    // Subtasks the remote op names explicitly were resolved on their own; do not
    // second-guess them via the parent path.
    const explicitlyTargetedIds = new Set(getOpEntityIds(remoteDeleteOp));
    const recreationOps: Operation[] = [];
    for (const subTaskId of subTaskIds) {
      if (explicitlyTargetedIds.has(subTaskId)) {
        continue;
      }
      // Only resurrect subtasks still present locally: one this device deleted
      // itself (getCurrentEntityState === undefined) must stay deleted.
      const subTaskState = await this.getCurrentEntityState(
        'TASK' as EntityType,
        subTaskId,
      );
      if (subTaskState === undefined) {
        continue;
      }
      // Dominate the remote delete so the recreation also wins on every client
      // that cascade-deleted this subtask. This clock is a proxy: the subtask
      // carries no local op of its own here (it is pure cascade collateral), so
      // we merge the delete and the parent's compensation clock rather than the
      // subtask's own history. A concurrent individual edit/delete of this
      // subtask on a third device therefore resolves against this proxy clock
      // (and the parent's timestamp) by LWW — the same bounded tradeoff the
      // parent's own recreate-after-delete already makes, and strictly better
      // than the silent total-subtree loss it replaces.
      const newClock = this.mergeAndIncrementClocks(
        [remoteDeleteOp.vectorClock, parentCompensationOp.vectorClock],
        clientId,
      );
      const recreationOp = this.createLWWUpdateOp(
        'TASK' as EntityType,
        subTaskId,
        subTaskState,
        clientId,
        newClock,
        parentCompensationOp.timestamp,
      );
      if (!isLwwUpdatePayload(recreationOp.payload)) {
        continue;
      }
      recreationOps.push({
        ...recreationOp,
        payload: {
          ...recreationOp.payload,
          recreatesEntityAfterDelete: true,
        },
      });
    }
    return recreationOps;
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
   * @returns Object indicating if op is superseded/duplicate and every detected conflict
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
  ): Promise<{ isSupersededOrDuplicate: boolean; conflicts: EntityConflict[] }> {
    const entityIdsToCheck = getOpEntityIds(remoteOp);
    const conflicts: EntityConflict[] = [];

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
        // Operations are atomic. If any affected entity already supersedes this
        // operation, do not partially apply it or resolve a subset of its scope.
        return { isSupersededOrDuplicate: true, conflicts: [] };
      }
      if (result.conflict) {
        conflicts.push(result.conflict);
      }
    }

    return { isSupersededOrDuplicate: false, conflicts };
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

    const rawComparison = compareVectorClocks(localFrontier, remoteOp.vectorClock);

    // Handle potential per-entity clock corruption
    const vcComparison = this._adjustForClockCorruption(rawComparison, entityKey, {
      localOpsForEntity: ctx.localOpsForEntity,
      hasNoSnapshotClock: ctx.hasNoSnapshotClock,
      localFrontierIsEmpty,
    });

    // SPAP-13 (observe-only): remember when the ONLY reason this became a
    // conflict is that clock-corruption escalation flipped a non-CONCURRENT
    // comparison to CONCURRENT. Does not affect the returned comparison.
    const corruptionEscalated =
      rawComparison !== VectorClockComparison.CONCURRENT &&
      vcComparison === VectorClockComparison.CONCURRENT;

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
      const conflict: EntityConflict = {
        entityType: remoteOp.entityType,
        entityId,
        localOps: ctx.localOpsForEntity,
        remoteOps: [remoteOp],
        suggestedResolution: this._suggestResolution(ctx.localOpsForEntity, [remoteOp]),
      };
      if (corruptionEscalated) {
        this._corruptionSuspectedConflicts.add(conflict);
      }
      return { isSupersededOrDuplicate: false, conflict };
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
