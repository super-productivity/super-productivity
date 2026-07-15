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
import { PROJECT_DELETE_WINS_SCHEMA_VERSION } from '@sp/shared-schema';
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
import { PROJECT_DELETE_WINS_MARKER } from '../../root-store/meta/task-shared.actions';
import { WorkContextType } from '../../features/work-context/work-context.model';
import { OperationApplierService } from '../apply/operation-applier.service';
import { HydrationStateService } from '../apply/hydration-state.service';
import {
  type MixedSourceOperationBatch,
  type MixedSourceWrittenOperation,
  OperationLogStoreService,
} from '../persistence/operation-log-store.service';
import { OpLog } from '../../core/log';
import { toEntityKey } from '../util/entity-key.util';
import { getOpEntityIds, isMultiEntityOperation } from '../util/get-op-entity-ids.util';
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
  hasOpaqueChanges,
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
  /** Kept so the merge is journaled only after its reducer work succeeds. */
  plan: LwwConflictResolutionPlan<EntityConflict>;
}

const taskRelationshipPatch = (
  taskId: string,
  taskState: Record<string, unknown>,
): Record<string, unknown> => ({
  id: taskId,
  projectId: taskState['projectId'],
  parentId: taskState['parentId'],
  subTaskIds: taskState['subTaskIds'],
});

/** Result of `_resolveConflictsWithLWW`: LWW winners plus disjoint merges. */
interface ResolvedConflicts {
  lwwResolutions: LWWResolution[];
  mergedResolutions: MergedResolution[];
  localMultiReconciliationOps: Operation[];
  lwwPlans: LwwConflictResolutionPlan<EntityConflict>[];
}

interface AutoResolveConflictsLwwOptions {
  callerHoldsOperationLogLock?: boolean;
  disableDisjointMerge?: boolean;
  remoteApplyLifecycleOwnedByCaller?: boolean;
}

const isProjectDeleteWinsOperation = (operation: Operation): boolean => {
  // `!(x >= n)` (not `x < n`) so a malformed op with an undefined schemaVersion
  // is treated as pre-v4 rather than slipping through. The `!operation.payload`
  // guard prevents a null/undefined-payload DEL op (the server permits one) from
  // throwing inside `extractActionPayload` and wedging the whole conflict pass.
  if (
    !(operation.schemaVersion >= PROJECT_DELETE_WINS_SCHEMA_VERSION) ||
    operation.actionType !== ActionType.TASK_SHARED_DELETE_PROJECT ||
    operation.opType !== OpType.Delete ||
    !operation.payload
  ) {
    return false;
  }
  const actionPayload = extractActionPayload(operation.payload);
  // Gate on the AUTHENTICATED `projectId` (inside the E2EE GCM auth tag), and
  // require it to match the plaintext `entityId` used to group the conflict.
  // A tampered/replayed marked delete retargeted onto a live entity therefore
  // fails to win delete-wins, so it cannot silently drop the victim's concurrent
  // edit — it falls back to timestamp LWW. (GHSA-8pxh metadata-tampering class.)
  return (
    actionPayload[PROJECT_DELETE_WINS_MARKER] === true &&
    operation.entityId === actionPayload['projectId']
  );
};

/**
 * Concurrent tabs can capture more than one marked `deleteProject` for the same
 * project before syncing, and the local store has applied EVERY one's cascade
 * (the task reducer removes entities by explicit `allTaskIds`, not by
 * `projectId`). The single winning replacement must therefore carry the UNION of
 * all their cascaded `allTaskIds`/`noteIds`, or a client that only receives that
 * replacement keeps entities a later local delete already removed. Only the id
 * arrays are widened — `projectId` and every other field are identical across
 * same-project deletes, so the first op is a safe base.
 */
const mergeMarkedProjectDeleteOps = (localOps: Operation[]): Operation | undefined => {
  const deletes = localOps.filter(isProjectDeleteWinsOperation);
  if (deletes.length <= 1) {
    return deletes[0];
  }
  const unionIds = (key: string): string[] => {
    const merged = new Set<string>();
    for (const op of deletes) {
      const value = extractActionPayload(op.payload)[key];
      if (Array.isArray(value)) {
        value.forEach((id) => merged.add(id as string));
      }
    }
    return [...merged];
  };
  const base = deletes[0];
  const mergedActionPayload: Record<string, unknown> = {
    ...extractActionPayload(base.payload),
    allTaskIds: unionIds('allTaskIds'),
    noteIds: unionIds('noteIds'),
  };
  const mergedPayload = isMultiEntityPayload(base.payload)
    ? { ...base.payload, actionPayload: mergedActionPayload }
    : mergedActionPayload;
  return { ...base, payload: mergedPayload };
};

const getTaskProjectMoveEntityIds = (operation: Operation): string[] | undefined => {
  // Reuse a prior synthetic LWW op's footprint ONLY from the AUTHENTICATED
  // payload (projectMoveFootprint), never the plaintext op.entityIds envelope.
  // A compromised server can tamper a remote op's envelope; reading it here
  // would launder those ids into a freshly-authenticated merged op that every
  // client then trusts — the same GHSA-8pxh-mgc7-gp3g vector, one merge removed.
  // Legacy LWW ops carry no authenticated footprint → no reusable set (the
  // merged op then falls back to receiving-state repair, mirroring the reducers).
  if (operation.actionType === toLwwUpdateActionType('TASK') && operation.entityId) {
    const footprint = isLwwUpdatePayload(operation.payload)
      ? operation.payload.projectMoveFootprint
      : undefined;
    if (!Array.isArray(footprint)) return undefined;
    return Array.from(
      new Set([
        operation.entityId,
        ...footprint.filter((id): id is string => typeof id === 'string'),
      ]),
    );
  }

  if (
    operation.actionType !== ActionType.TASK_SHARED_UPDATE ||
    !operation.entityId ||
    !operation.payload ||
    typeof operation.payload !== 'object'
  ) {
    return undefined;
  }

  const payload = operation.payload as Record<string, unknown>;
  const actionPayload =
    payload['actionPayload'] && typeof payload['actionPayload'] === 'object'
      ? (payload['actionPayload'] as Record<string, unknown>)
      : payload;
  const subTaskIds = actionPayload['projectMoveSubTaskIds'];
  if (!Array.isArray(subTaskIds)) return undefined;

  // SECURITY: the footprint ROOT must come from the AUTHENTICATED payload
  // (actionPayload.task.id), NOT the plaintext op.entityId envelope. Unlike LWW
  // ops — whose entityId is bound to payload.id by assertDecryptedOpMetadataIntegrity
  // — a raw TASK_SHARED_UPDATE op's entityId is unauthenticated, so reading it here
  // would let a compromised server launder a victim id into the authenticated
  // projectMoveFootprint of the synthesized merged op. GHSA-8pxh-mgc7-gp3g.
  const task = actionPayload['task'];
  const rootId =
    task && typeof task === 'object'
      ? (task as Record<string, unknown>)['id']
      : undefined;
  if (typeof rootId !== 'string') return undefined;

  return Array.from(
    new Set([rootId, ...subTaskIds.filter((id): id is string => typeof id === 'string')]),
  );
};

export const getLatestTaskProjectMoveEntityIds = (
  operations: Operation[],
): string[] | undefined => {
  let latest: { operation: Operation; entityIds: string[] } | undefined;
  for (const operation of operations) {
    const entityIds = getTaskProjectMoveEntityIds(operation);
    if (!entityIds) continue;
    if (
      !latest ||
      operation.timestamp > latest.operation.timestamp ||
      (operation.timestamp === latest.operation.timestamp &&
        operation.id > latest.operation.id)
    ) {
      latest = { operation, entityIds };
    }
  }

  return latest?.entityIds;
};

const latestProjectMoveEntityIds = (
  entityId: string,
  operations: Operation[],
): string[] | undefined => {
  const projectMoveEntityIds = getLatestTaskProjectMoveEntityIds(operations);
  if (!projectMoveEntityIds) return undefined;

  return Array.from(new Set([entityId, ...projectMoveEntityIds]));
};

const markLwwDeleteRecreation = (op: Operation): Operation =>
  isLwwUpdatePayload(op.payload)
    ? {
        ...op,
        payload: {
          ...op.payload,
          recreatesEntityAfterDelete: true,
        },
      }
    : op;

// The only legacy bulk operation whose captured per-task deltas are known to be
// independently replayable. Do not generalize this from payload shape alone:
// other multi-entity UPDATE actions encode relationship/list invariants that
// must stay atomic.
const DECOMPOSABLE_MULTI_ACTION_FIELDS = new Map<ActionType, ReadonlySet<string>>([
  [ActionType.TASK_ROUND_TIME_SPENT, new Set(['timeSpent', 'timeSpentOnDay'])],
]);

const isRoundTimePayloadValidForStaticFields = (op: Operation): boolean => {
  if (op.actionType !== ActionType.TASK_ROUND_TIME_SPENT) {
    return false;
  }
  const actionPayload = extractActionPayload(op.payload);
  const taskIds = actionPayload['taskIds'];
  if (
    !Array.isArray(taskIds) ||
    taskIds.some((id) => typeof id !== 'string') ||
    typeof actionPayload['day'] !== 'string' ||
    typeof actionPayload['isRoundUp'] !== 'boolean'
  ) {
    return false;
  }

  const roundTo = actionPayload['roundTo'];
  const isKnownRoundOption =
    roundTo === undefined ||
    roundTo === null ||
    roundTo === '5M' ||
    roundTo === 'QUARTER' ||
    roundTo === 'HALF' ||
    roundTo === 'HOUR' ||
    // Older payloads represented the interval numerically.
    typeof roundTo === 'number';
  if (!isKnownRoundOption) {
    return false;
  }

  const declaredIds = new Set(taskIds as string[]);
  const operationIds = getOpEntityIds(op);
  return (
    declaredIds.size === operationIds.length &&
    operationIds.every((id) => declaredIds.has(id))
  );
};

const INDEPENDENT_MULTI_DELETE_ACTIONS = new Set<ActionType>([
  ActionType.TASK_SHARED_DELETE_MULTIPLE,
  ActionType.TAG_DELETE_MULTIPLE,
  ActionType.REPEAT_CFG_DELETE_MULTIPLE,
  ActionType.COUNTER_DELETE_MULTIPLE,
]);

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
 * - **Crash safety**: Persists pending replacements before applying and rejects
 *   originals only after the chosen reducer/archive work succeeds
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
  private hydrationState = inject(HydrationStateService);
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
   * @param entityIds - Captured task-project-move footprint, when applicable
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
    entityIds?: string[],
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
    // Compute the move footprint once and carry it BOTH in the plaintext
    // envelope (op.entityIds — the server needs it for its indexed conflict
    // detection and cannot read the encrypted payload) AND inside the
    // authenticated payload (projectMoveFootprint). Remote clients trust only
    // the authenticated copy, closing the envelope-injection vector
    // (GHSA-8pxh-mgc7-gp3g).
    const moveFootprint =
      entityIds !== undefined ? Array.from(new Set([entityId, ...entityIds])) : undefined;
    const payload: LwwUpdatePayload = {
      actionPayload,
      entityChanges: [],
      lwwUpdateMode,
      ...(moveFootprint !== undefined && { projectMoveFootprint: moveFootprint }),
    };
    return {
      id: uuidv7(),
      actionType: toLwwUpdateActionType(entityType),
      opType: OpType.Update,
      entityType,
      entityId,
      ...(moveFootprint !== undefined && { entityIds: moveFootprint }),
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
   * Re-emits the relationships that a rewritten recreate-after-delete TASK op
   * cannot carry by itself. This is used only when an earlier recovery row was
   * rejected and replaced: the parent TASK goes first, any still-present
   * subtasks follow, and a parent TASK snapshot or PROJECT membership patch
   * restores exact relationship ordering last.
   */
  async createTaskRecreationFollowUpOps(
    taskOp: Operation,
    options: { ensureRegularProjectMembership?: boolean } = {},
  ): Promise<Operation[]> {
    if (
      taskOp.entityType !== 'TASK' ||
      !taskOp.entityId ||
      !isLwwUpdatePayload(taskOp.payload) ||
      taskOp.payload.recreatesEntityAfterDelete !== true
    ) {
      return [];
    }
    const taskState = extractActionPayload(taskOp.payload);
    const projectId = taskState['projectId'];
    const parentId = taskState['parentId'];
    if (typeof projectId !== 'string') return [];

    const clientId = await this.clientIdProvider.loadClientId();
    if (!clientId) {
      OpLog.err(
        'ConflictResolutionService: Cannot create TASK recovery follow-ups - no client ID',
      );
      return [];
    }
    let nextClock = this.mergeAndIncrementClocks(
      [(await this.opLogStore.getVectorClock()) ?? {}, taskOp.vectorClock],
      clientId,
    );
    const followUpOps: Operation[] = [];
    const subTaskIds = taskState['subTaskIds'];
    if (Array.isArray(subTaskIds)) {
      for (const subTaskId of new Set(
        subTaskIds.filter((id): id is string => typeof id === 'string'),
      )) {
        const subTaskState = await this.getCurrentEntityState(
          'TASK' as EntityType,
          subTaskId,
        );
        if (subTaskState === undefined) continue;
        const subTaskOp = markLwwDeleteRecreation(
          this.createLWWUpdateOp(
            'TASK' as EntityType,
            subTaskId,
            typeof subTaskState === 'object' && subTaskState !== null
              ? { ...subTaskState, projectId }
              : subTaskState,
            clientId,
            nextClock,
            taskOp.timestamp,
          ),
        );
        followUpOps.push(subTaskOp);
        nextClock = this.mergeAndIncrementClocks(
          [nextClock, subTaskOp.vectorClock],
          clientId,
        );
      }
      if (subTaskIds.length > 0) {
        const taskRelationshipOp = markLwwDeleteRecreation(
          this.createLWWUpdateOp(
            'TASK' as EntityType,
            taskOp.entityId,
            taskRelationshipPatch(taskOp.entityId, taskState),
            clientId,
            nextClock,
            taskOp.timestamp,
            'patch',
          ),
        );
        followUpOps.push(taskRelationshipOp);
        nextClock = this.mergeAndIncrementClocks(
          [nextClock, taskRelationshipOp.vectorClock],
          clientId,
        );
      }
    }

    if (typeof parentId === 'string') {
      const parentTaskState = await this.getCurrentEntityState(
        'TASK' as EntityType,
        parentId,
      );
      if (parentTaskState === undefined) {
        return followUpOps;
      }
      followUpOps.push(
        markLwwDeleteRecreation(
          this.createLWWUpdateOp(
            'TASK' as EntityType,
            parentId,
            taskRelationshipPatch(parentId, parentTaskState as Record<string, unknown>),
            clientId,
            this.mergeAndIncrementClocks([nextClock], clientId),
            taskOp.timestamp,
            'patch',
          ),
        ),
      );
      return followUpOps;
    }

    const projectState = await this.getCurrentEntityState(
      'PROJECT' as EntityType,
      projectId,
    );
    if (typeof projectState !== 'object' || projectState === null) {
      return followUpOps;
    }
    const project = projectState as Record<string, unknown>;
    if (!Array.isArray(project['taskIds']) || !Array.isArray(project['backlogTaskIds'])) {
      return followUpOps;
    }
    const taskIds = [...project['taskIds']];
    const backlogTaskIds = [...project['backlogTaskIds']];
    if (
      options.ensureRegularProjectMembership === true &&
      !taskIds.includes(taskOp.entityId) &&
      !backlogTaskIds.includes(taskOp.entityId)
    ) {
      taskIds.push(taskOp.entityId);
    }
    followUpOps.push(
      markLwwDeleteRecreation(
        this.createLWWUpdateOp(
          'PROJECT' as EntityType,
          projectId,
          {
            id: projectId,
            taskIds,
            backlogTaskIds,
          },
          clientId,
          this.mergeAndIncrementClocks([nextClock], clientId),
          taskOp.timestamp,
          'patch',
        ),
      ),
    );
    return followUpOps;
  }

  private async _createRemoteWinCompensationForRejectedTaskRecreation(
    conflict: EntityConflict,
    remoteOp: Operation,
  ): Promise<Operation | undefined> {
    if (conflict.entityType !== 'TASK' || remoteOp.opType !== OpType.Update) {
      return undefined;
    }
    const localRecreation = conflict.localOps.find(
      (op) =>
        isLwwUpdatePayload(op.payload) && op.payload.recreatesEntityAfterDelete === true,
    );
    if (!localRecreation) return undefined;

    const isMoveToProject =
      remoteOp.actionType === ActionType.TASK_SHARED_MOVE_TO_PROJECT;
    const isTaskLwwUpdate =
      remoteOp.actionType === toLwwUpdateActionType('TASK') &&
      isLwwUpdatePayload(remoteOp.payload);
    const isAdapterTaskUpdate = [
      ActionType.TASK_SHARED_UPDATE,
      ActionType.TASK_UPDATE_UI,
      ActionType.TASK_SHARED_UPDATE_MULTIPLE,
      ActionType.TASK_UPDATE_MULTIPLE_SIMPLE,
    ].includes(remoteOp.actionType);
    if (!isMoveToProject && !isTaskLwwUpdate && !isAdapterTaskUpdate) {
      return undefined;
    }

    const localTaskState = { ...extractActionPayload(localRecreation.payload) };
    delete localTaskState['subTasks'];
    const remoteActionPayload = extractActionPayload(remoteOp.payload);
    const targetProjectId = remoteActionPayload['targetProjectId'];
    let taskState: Record<string, unknown>;
    if (isMoveToProject) {
      if (typeof targetProjectId !== 'string') return undefined;
      // moveToOtherProject carries a full pre-move task snapshot, but only its
      // target project is an intended task-field change.
      taskState = { ...localTaskState, projectId: targetProjectId };
    } else {
      const payloadKey = this._resolvePayloadKey('TASK' as EntityType);
      const syntheticDelete: Operation = {
        ...localRecreation,
        opType: OpType.Delete,
        payload: {
          actionPayload: {
            [payloadKey]: extractActionPayload(localRecreation.payload),
          },
          entityChanges: [],
        },
      };
      const [convertedRemoteOp] = convertLocalDeleteRemoteUpdatesToLww<Operation>(
        { ...conflict, localOps: [syntheticDelete], remoteOps: [remoteOp] },
        {
          payloadKey,
          toLwwUpdateActionType: (entityType) =>
            toLwwUpdateActionType(entityType as EntityType),
          isSingletonEntityId,
        },
      );
      if (!isLwwUpdatePayload(convertedRemoteOp.payload)) return undefined;
      taskState = { ...extractActionPayload(convertedRemoteOp.payload) };
      delete taskState['subTasks'];

      // Generic adapter/LWW reconstruction is field-safe only. Relationship
      // changes require action-specific parent/project ordering support.
      if (
        !deepEqual(taskState['projectId'], localTaskState['projectId']) ||
        !deepEqual(taskState['parentId'], localTaskState['parentId']) ||
        !deepEqual(taskState['subTaskIds'], localTaskState['subTaskIds'])
      ) {
        return undefined;
      }
    }

    const clientId = await this.clientIdProvider.loadClientId();
    if (!clientId) {
      OpLog.err(
        'ConflictResolutionService: Cannot compensate remote TASK winner - no client ID',
      );
      return undefined;
    }
    return markLwwDeleteRecreation(
      this.createLWWUpdateOp(
        'TASK' as EntityType,
        conflict.entityId,
        taskState,
        clientId,
        this.mergeAndIncrementClocks(
          [
            ...conflict.localOps.map((op) => op.vectorClock),
            ...conflict.remoteOps.map((op) => op.vectorClock),
          ],
          clientId,
        ),
        remoteOp.timestamp,
      ),
    );
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
    const {
      lwwResolutions: resolutions,
      mergedResolutions,
      localMultiReconciliationOps = [],
      lwwPlans,
    } = await this._resolveConflictsWithLWW(
      conflicts,
      options.disableDisjointMerge ?? false,
    );
    const additionalLocalIntentOps =
      await this._preservePartiallyRejectedLocalBulkDeletes(resolutions);

    const allOpsToApply: Operation[] = [];
    const allStoredOps: Array<{ id: string; seq: number }> = [];
    // Durable seq of every op queued for live apply. Live apply order must
    // equal seq order — status-blind hydration replays by seq, and later steps
    // can reuse pending rows from a prior failed attempt whose seqs predate
    // rows appended fresh in this call.
    const applySeqByOpId = new Map<string, number>();
    // Synthetic local ops (disjoint merges) ride in the apply batch but are NOT
    // pending remote rows. Successful ones are excluded from the remote reducer
    // checkpoint; failed ones are quarantined before falling back to plain LWW.
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
      ...localMultiReconciliationOps,
      ...additionalLocalIntentOps,
    ]);
    const { remoteWinnerAffectedEntityKeys } = lwwPartitions;
    const localOpsToReject = [...new Set(lwwPartitions.localOpsToReject)];
    const localOpsToRejectSet = new Set(localOpsToReject);
    const protectedLocalResolutionOpIds = new Set<string>();
    let writtenLocalWinOps: Operation[] = [];
    const writtenMergedOpIds = new Set<string>();

    // A multi-entity action cannot be split when different entities pick
    // different winners. Persist/apply the original remote op once, then replay
    // local-win snapshots after it as compensations. The remote row stays pending
    // until reducer and archive application complete; status-blind hydration then
    // replays the same deterministic sequence after a crash.
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
          // The local DELETE carries no reconstructable base entity (e.g. a
          // legacy bulk deleteTasks op stores only taskIds), so we cannot recreate
          // the remote-winning entity. Degrade like the single-entity path
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
        const winners = multiEntityRemoteOpWinners.get(remoteOp.id);
        winners?.remoteWinCompensationIds.add(recreationOp.id);
        const subtaskOps = await this._createSubtaskRecreationOpsFromLocalDelete(
          resolution.conflict,
          recreationOp,
        );
        for (const subtaskOp of subtaskOps) {
          newLocalWinOps.push(subtaskOp);
          winners?.remoteWinCompensationIds.add(subtaskOp.id);
        }
      }
    }

    // A single-entity winning update is converted directly into a remote LWW
    // recreate op. If the losing local bulk delete cascaded to children, replay
    // that remote op first and then recreate the snapshotted subtree.
    for (const resolution of resolutions) {
      if (
        resolution.winner !== 'remote' ||
        !resolution.conflict.localOps.some((op) => op.opType === OpType.Delete)
      ) {
        continue;
      }
      for (const remoteOp of resolution.conflict.remoteOps) {
        if (getOpEntityIds(remoteOp).length !== 1) {
          continue;
        }
        const convertedRemoteOp = remoteWinsOps.find((op) => op.id === remoteOp.id);
        if (
          !convertedRemoteOp ||
          !isLwwUpdatePayload(convertedRemoteOp.payload) ||
          convertedRemoteOp.payload.recreatesEntityAfterDelete !== true
        ) {
          continue;
        }
        const subtaskOps = await this._createSubtaskRecreationOpsFromLocalDelete(
          resolution.conflict,
          convertedRemoteOp,
        );
        if (subtaskOps.length === 0) {
          continue;
        }
        newLocalWinOps.push(...subtaskOps);
        subtaskOps.forEach((op) => compensationOpIdsToApply.add(op.id));
        compensatedRemoteOps.set(convertedRemoteOp.id, convertedRemoteOp);
        remoteWinsOps = remoteWinsOps.filter((op) => op.id !== convertedRemoteOp.id);
        localWinsRemoteOps = uniqueOpsById([...localWinsRemoteOps, convertedRemoteOp]);
      }
    }

    // A semantic remote TASK winner may not recreate an entity that the
    // earlier project-delete loser removes on a fresh replay. Re-emit the
    // remote result as a full local snapshot, then restore its dependents and
    // relationships. Persist/apply the original remote row first so live and
    // restart order match.
    for (const resolution of resolutions) {
      if (
        resolution.winner !== 'remote' ||
        !resolution.conflict.localOps.some(
          (op) =>
            isLwwUpdatePayload(op.payload) &&
            op.payload.recreatesEntityAfterDelete === true,
        )
      ) {
        continue;
      }
      for (const remoteOp of resolution.conflict.remoteOps) {
        const compensationOp =
          await this._createRemoteWinCompensationForRejectedTaskRecreation(
            resolution.conflict,
            remoteOp,
          );
        if (!compensationOp) continue;
        newLocalWinOps.push(compensationOp);
        compensationOpIdsToApply.add(compensationOp.id);
        const followUpOps = await this.createTaskRecreationFollowUpOps(compensationOp, {
          ensureRegularProjectMembership:
            remoteOp.actionType === ActionType.TASK_SHARED_MOVE_TO_PROJECT,
        });
        for (const followUpOp of followUpOps) {
          newLocalWinOps.push(followUpOp);
          compensationOpIdsToApply.add(followUpOp.id);
        }
        compensatedRemoteOps.set(remoteOp.id, remoteOp);
        remoteWinsOps = remoteWinsOps.filter((op) => op.id !== remoteOp.id);
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
          const markedCompensation = markLwwDeleteRecreation(localWinOp);
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

      for (const entityId of getOpEntityIds(remoteOp)) {
        remoteWinnerAffectedEntityKeys.add(toEntityKey(remoteOp.entityType, entityId));
      }
      if (hasMixedWinners) {
        for (const localWinnerKey of winners.localWinnerKeys) {
          remoteWinnerAffectedEntityKeys.delete(localWinnerKey);
        }
      }
    }

    // A remote DELETE that loses outright — single-entity, or a bulk delete
    // whose conflicting entities all win locally with no uncontested sibling —
    // never enters the mixed-winner block above, yet its reducer cascade still
    // removes the winning entity's dependents wherever the delete IS applied:
    // on every client that already synced it, and on this client's own
    // status-blind hydration replay of the durable loser row. Only the winner
    // carries a compensation op, so emit recreate-after-delete snapshots for
    // its still-present cascade victims too: a TASK parent's subtasks (#8956)
    // and a PROJECT's active tasks (#8997). Archive ops are OpType.Update, so
    // archive precedence is untouched.
    //
    // Recovery reads task presence from the pre-batch store, so it is blind to
    // deletes applied elsewhere in this same batch. Exclude those task ids so
    // recovery does not resurrect a task another device is concurrently
    // deleting (#8997 review). Two sources apply here in the same batch:
    //   1. deletes piggybacked as non-conflicting ops, and
    //   2. deletes that won their own LWW conflict (a competing local edit
    //      lost) — invisible to the nonConflictingOps scan, but just as
    //      applied, so recovery must not fight a deletion that already won.
    const remoteDeleteWinnerOps = resolutions
      .filter((resolution) => resolution.winner === 'remote')
      .flatMap((resolution) => resolution.conflict.remoteOps)
      .filter((op) => op.opType === OpType.Delete);
    const concurrentlyDeletedTaskIds = this._collectDeletedTaskIds([
      ...nonConflictingOps,
      ...remoteDeleteWinnerOps,
    ]);
    for (const resolution of resolutions) {
      if (resolution.winner !== 'local' || !resolution.localWinOp) {
        continue;
      }
      const parentCompensationOp = newLocalWinOpsById.get(resolution.localWinOp.id);
      if (
        !parentCompensationOp ||
        !isLwwUpdatePayload(parentCompensationOp.payload) ||
        parentCompensationOp.payload.recreatesEntityAfterDelete !== true
      ) {
        continue;
      }
      for (const remoteOp of resolution.conflict.remoteOps) {
        if (remoteOp.opType !== OpType.Delete || compensatedRemoteOps.has(remoteOp.id)) {
          continue;
        }
        const cascadeRecreationOps = [
          ...(await this._createSubtaskRecreationOpsForWinningParent(
            parentCompensationOp,
            remoteOp,
          )),
          ...(await this._createTaskRecreationOpsForWinningProject(
            parentCompensationOp,
            remoteOp,
            concurrentlyDeletedTaskIds,
          )),
          // Emitted after the task recreations so sections referencing recreated
          // tasks land in seq order after them (#9037).
          ...(await this._createCascadeRecreationOpsForWinningProject(
            parentCompensationOp,
            remoteOp,
            {
              concurrentlyDeletedTaskIds,
              batchOps: [...nonConflictingOps, ...remoteDeleteWinnerOps],
            },
          )),
        ];
        // Not queued for live apply: the pure loser is never applied live, so
        // this client's state already holds the cascade victims. The rows
        // exist for upload and for seq-ordered replay after the durable loser.
        for (const recreationOp of cascadeRecreationOps) {
          newLocalWinOps.push(recreationOp);
          newLocalWinOpsById.set(recreationOp.id, recreationOp);
        }
      }
    }

    // A recovery TASK row can itself be rejected by a later per-task conflict.
    // Its replacement must re-emit any skipped subtasks and finish with the
    // current PROJECT membership, otherwise independent server acceptance can
    // lose parent/child links or append a backlog task to the regular list.
    for (const resolution of resolutions) {
      if (
        resolution.winner !== 'local' ||
        !resolution.localWinOp ||
        !resolution.conflict.localOps.some(
          (op) =>
            isLwwUpdatePayload(op.payload) &&
            op.payload.recreatesEntityAfterDelete === true,
        )
      ) {
        continue;
      }
      const replacementOp = newLocalWinOpsById.get(resolution.localWinOp.id);
      if (!replacementOp) continue;
      const followUpOps = await this.createTaskRecreationFollowUpOps(replacementOp);
      const shouldApply = compensationOpIdsToApply.has(replacementOp.id);
      for (const followUpOp of followUpOps) {
        newLocalWinOps.push(followUpOp);
        newLocalWinOpsById.set(followUpOp.id, followUpOp);
        if (shouldApply) compensationOpIdsToApply.add(followUpOp.id);
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
    // Atomically persist remote losers, local-win compensations, and final
    // remote winners in live-apply order. Hydration is status-blind, so both
    // durable ordering and the absence of crash gaps are required here.
    // ─────────────────────────────────────────────────────────────────────────
    if (localWinsRemoteOps.length > 0 || newLocalWinOps.length > 0) {
      const compensatedRemoteOpIds = new Set(compensatedRemoteOps.keys());
      const unappliedRemoteLosers = localWinsRemoteOps.filter(
        (op) => !compensatedRemoteOpIds.has(op.id),
      );
      remoteOpsToReject = remoteOpsToReject.filter(
        (opId) => !compensatedRemoteOpIds.has(opId),
      );
      const resolutionBatches: MixedSourceOperationBatch[] = [];
      if (unappliedRemoteLosers.length > 0) {
        resolutionBatches.push({ ops: unappliedRemoteLosers, source: 'remote' });
      }
      if (compensatedRemoteOps.size > 0) {
        resolutionBatches.push({
          ops: [...compensatedRemoteOps.values()],
          source: 'remote',
          options: { pendingApply: true },
        });
      }
      resolutionBatches.push({ ops: newLocalWinOps, source: 'local' });
      if (remoteWinsOps.length > 0) {
        resolutionBatches.push({
          ops: remoteWinsOps,
          source: 'remote',
          options: { pendingApply: true },
        });
      }
      const result =
        await this.opLogStore.appendMixedSourceBatchSkipDuplicates(resolutionBatches);
      writtenLocalWinOps = result.written
        .filter((entry) => entry.source === 'local')
        .map((entry) => entry.op);
      writtenLocalWinOps.forEach((op) => protectedLocalResolutionOpIds.add(op.id));
      if (result.skippedCount > 0) {
        OpLog.verbose(
          `ConflictResolutionService: Skipped ${result.skippedCount} duplicate resolution op(s)`,
        );
      }
      for (const op of writtenLocalWinOps) {
        OpLog.normal(
          `ConflictResolutionService: Appended local-win update op ${op.id} for ${op.entityType}:${op.entityId}`,
        );
      }

      const replayableRemoteEntries = await this._resolveReplayableOperations(
        [...compensatedRemoteOps.values(), ...remoteWinsOps],
        'remote',
        result.written,
      );
      const pendingCompensatedRemoteEntries = replayableRemoteEntries.filter((entry) =>
        compensatedRemoteOpIds.has(entry.op.id),
      );
      const pendingRemoteWinnerEntries = replayableRemoteEntries.filter(
        (entry) => !compensatedRemoteOpIds.has(entry.op.id),
      );
      const writtenCompensationEntries = result.written.filter(
        (entry) => entry.source === 'local' && compensationOpIdsToApply.has(entry.op.id),
      );
      for (const entry of writtenCompensationEntries) {
        checkpointExemptOpIds.add(entry.op.id);
      }

      // A skipped remote row may predate a newly written compensation. Replay
      // the combined set in durable sequence order so live state matches the
      // status-blind hydration order after a crash/restart.
      const resolutionApplyEntries: MixedSourceWrittenOperation[] = [
        ...pendingCompensatedRemoteEntries.map((entry) => ({
          ...entry,
          source: 'remote' as const,
        })),
        ...writtenCompensationEntries,
        ...pendingRemoteWinnerEntries.map((entry) => ({
          ...entry,
          source: 'remote' as const,
        })),
      ].sort((a, b) => a.seq - b.seq);
      for (const entry of resolutionApplyEntries) {
        allOpsToApply.push(entry.op);
        applySeqByOpId.set(entry.op.id, entry.seq);
        if (entry.source === 'remote') {
          allStoredOps.push({
            id: entry.op.id,
            seq: entry.seq,
          });
        }
      }
    } else if (remoteWinsOps.length > 0) {
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
        applySeqByOpId.set(result.ops[i].id, result.seqs[i]);
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
          if (
            !localOpsToRejectSet.has(op.id) &&
            !protectedLocalResolutionOpIds.has(op.id)
          ) {
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
        applySeqByOpId.set(result.ops[i].id, result.seqs[i]);
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
          options: { pendingApply: true },
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

      for (const entry of mergeBatch.written) {
        if (entry.source !== 'local') {
          continue;
        }
        // Apply/upload the WRITTEN op — it carries the rebased vector clock.
        allStoredOps.push({ id: entry.op.id, seq: entry.seq });
        allOpsToApply.push(entry.op);
        applySeqByOpId.set(entry.op.id, entry.seq);
        checkpointExemptOpIds.add(entry.op.id);
        writtenMergedOpIds.add(entry.op.id);
        OpLog.normal(
          `ConflictResolutionService: Appended disjoint-merge op ${entry.op.id} for ` +
            `${entry.op.entityType}:${entry.op.entityId}`,
        );
      }
    }

    // Re-sort the combined batch by durable seq: with fresh appends this is a
    // no-op (append order = seq order), but a pending row reused from a prior
    // failed attempt carries an older seq than rows appended fresh above, and
    // status-blind hydration will replay it FIRST. Live apply must match that
    // order or a crash replays a different history (e.g. a reused CREATE
    // applied live after a fresh full snapshot of its container, but before it
    // on replay). Ops without a recorded seq cannot exist here; sort them last
    // deterministically rather than throwing mid-resolution.
    allOpsToApply.sort(
      (a, b) =>
        (applySeqByOpId.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (applySeqByOpId.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 4: Apply remote ops in a single batch.
    // Merge their clocks before entering the reducer/deferred-action window.
    // Pending rows make this durable frontier crash-safe, and any subsequent
    // dispatch/checkpoint/bookkeeping failure can drain buffered local actions.
    // (#7700)
    // ─────────────────────────────────────────────────────────────────────────
    let canDrainDeferredActions = false;
    let hasPrimaryError = false;
    let failedMergedResolutions: MergedResolution[] = [];
    let fallbackLocalWinOpsCreated = 0;
    let remoteApplyWindowStarted = false;
    const ownsRemoteApplyLifecycle = !(
      options.remoteApplyLifecycleOwnedByCaller ?? false
    );
    try {
      if (allOpsToApply.length > 0) {
        OpLog.normal(
          `ConflictResolutionService: Applying ${allOpsToApply.length} ops in single batch`,
        );
        await this.opLogStore.mergeRemoteOpClocks(allOpsToApply);
        canDrainDeferredActions = true;
        if (ownsRemoteApplyLifecycle) {
          this.hydrationState.startApplyingRemoteOps();
          remoteApplyWindowStarted = true;
        }

        const opIdToSeq = new Map(allStoredOps.map((o) => [o.id, o.seq]));
        const applyResult = await this.operationApplier.applyOperations(allOpsToApply, {
          skipDeferredLocalActions: true,
          remoteApplyWindowAlreadyOpen: true,
          onReducersCommitted: async (reducerCommittedOps, reducerFailures = []) => {
            // Disjoint-merge ops are synthetic LOCAL rows in the apply batch.
            // Exclude successful ones from the checkpoint's pending-only seq
            // assertion. Failed synthetic rows are quarantined; their remote
            // originals stay pending for the LWW fallback below.
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
            const failedCheckpointExemptOpIds = reducerFailures
              .filter((failure) => checkpointExemptOpIds.has(failure.op.id))
              .map((failure) => failure.op.id);
            if (failedCheckpointExemptOpIds.length > 0) {
              await this.opLogStore.markReducersCommittedAndMergeClocks(
                reducerCommittedSeqs,
                checkpointOps,
                failedCheckpointExemptOpIds,
              );
            } else if (checkpointOps.length > 0) {
              await this.opLogStore.markReducersCommittedAndMergeClocks(
                reducerCommittedSeqs,
                checkpointOps,
              );
            }
          },
        });

        if (applyResult.reducerFailures?.length) {
          OpLog.err(
            `ConflictResolutionService: ${applyResult.reducerFailures.length} resolution operation(s) failed reducer replay.`,
          );
        }

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

        if (applyResult.reducerFailures?.length) {
          const failedSyntheticOpIds = new Set(
            applyResult.reducerFailures
              .filter((failure) => writtenMergedOpIds.has(failure.op.id))
              .map((failure) => failure.op.id),
          );
          failedMergedResolutions = mergedResolutions.filter((merged) =>
            failedSyntheticOpIds.has(merged.mergedOp.id),
          );
          const nonSyntheticFailure = applyResult.reducerFailures.find(
            (failure) => !failedSyntheticOpIds.has(failure.op.id),
          );
          if (nonSyntheticFailure) {
            throw new IncompleteRemoteOperationsError(nonSyntheticFailure.error);
          }
        }
      }

      if (failedMergedResolutions.length > 0) {
        OpLog.warn(
          `ConflictResolutionService: Falling back to LWW for ${failedMergedResolutions.length} failed disjoint merge(s).`,
        );
        const fallbackResult = await this.autoResolveConflictsLWW(
          failedMergedResolutions.map((merged) => merged.conflict),
          [],
          {
            ...options,
            disableDisjointMerge: true,
            remoteApplyLifecycleOwnedByCaller: true,
          },
        );
        fallbackLocalWinOpsCreated = fallbackResult.localWinOpsCreated;
      }
    } catch (error) {
      hasPrimaryError = true;
      throw error;
    } finally {
      if (remoteApplyWindowStarted) {
        try {
          this.hydrationState.startPostSyncCooldown();
        } catch (error) {
          OpLog.err(
            'ConflictResolutionService: Failed to start post-sync cooldown',
            error,
          );
        }
        this.hydrationState.endApplyingRemoteOps();
      }
      if (canDrainDeferredActions && ownsRemoteApplyLifecycle) {
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

    const fallbackOriginalOpIds = new Set(
      failedMergedResolutions.flatMap((merged) => [
        ...merged.conflict.localOps.map((op) => op.id),
        ...merged.conflict.remoteOps.map((op) => op.id),
      ]),
    );
    const remainingLocalOpsToReject = localOpsToReject.filter(
      (opId) => !fallbackOriginalOpIds.has(opId),
    );
    const remainingRemoteOpsToReject = remoteOpsToReject.filter(
      (opId) => !fallbackOriginalOpIds.has(opId),
    );
    const successfulMergedResolutions = mergedResolutions.filter(
      (merged) => !failedMergedResolutions.includes(merged),
    );

    // Finalize only after every chosen resolution entered state. If reducer or
    // archive work fails, the originals stay eligible for a clean retry.
    if (remainingLocalOpsToReject.length > 0) {
      await this.opLogStore.markRejected(remainingLocalOpsToReject);
      OpLog.normal(
        `ConflictResolutionService: Marked ${remainingLocalOpsToReject.length} local ops as rejected`,
      );
    }
    if (remainingRemoteOpsToReject.length > 0) {
      await this.opLogStore.markRejected(remainingRemoteOpsToReject);
      OpLog.normal(
        `ConflictResolutionService: Marked ${remainingRemoteOpsToReject.length} remote ops as rejected`,
      );
    }

    for (const plan of lwwPlans) {
      await this._journalResolution(plan);
    }
    for (const merged of successfulMergedResolutions) {
      if (writtenMergedOpIds.has(merged.mergedOp.id)) {
        await this._journalMergedResolution(merged.plan);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 5: Show non-blocking notification
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
    // STEP 6: Validate and repair state after resolution
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
      localWinOpsCreated:
        writtenLocalWinOps.length +
        successfulMergedResolutions.length +
        fallbackLocalWinOpsCreated,
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
    disableDisjointMerge: boolean = false,
  ): Promise<ResolvedConflicts> {
    const resolutions: LWWResolution[] = [];
    const mergedResolutions: MergedResolution[] = [];
    const lwwPlans: LwwConflictResolutionPlan<EntityConflict>[] = [];

    const plans = planLwwConflictResolutions(conflicts, {
      isArchiveAction: (op) => op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
      isDeleteWinsAction: isProjectDeleteWinsOperation,
      toEntityKey: (entityType, entityId) =>
        toEntityKey(entityType as EntityType, entityId),
    });
    this._assertMultiEntityPlansAreSafe(plans);

    // A rejected local bulk op was already applied optimistically. If the
    // remote winner changes only part of one entity, rejecting the whole row
    // would strand its other entity/field changes locally with no uploadable op.
    // Build safe replacements BEFORE journaling any plan, so a failed safety
    // preflight cannot leave a phantom "resolved" journal entry.
    const localMultiReconciliationOps =
      await this._createLocalMultiReconciliationOps(plans);

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
        disableDisjointMerge || (conflictCountByEntity.get(entityKey) ?? 0) > 1
          ? undefined
          : await this._tryCreateDisjointMergeOp(plan);
      if (mergedOp) {
        // NOT journaled here: a `merged` entry claims "both sides kept", which
        // is only true once the merged op enters state. All journal entries are
        // emitted after the chosen reducer work succeeds.
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
      } else if (plan.localWinOperationKind === 'delete-win') {
        const deleteOp = mergeMarkedProjectDeleteOps(plan.conflict.localOps);
        if (!deleteOp) {
          throw new Error(
            `ConflictResolutionService: Missing delete-wins operation for ` +
              `${plan.conflict.entityType}:${plan.conflict.entityId}`,
          );
        }
        localWinOp = await this._createReplacementDeleteOp(plan.conflict, deleteOp);
      } else if (plan.localWinOperationKind === 'update') {
        localWinOp = await this._createLocalWinUpdateOp(plan.conflict);
      }

      resolutions.push({
        conflict: plan.conflict,
        winner: plan.winner,
        localWinOp,
      });
      lwwPlans.push(plan);

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
      lwwResolutions: resolutions,
      mergedResolutions,
      localMultiReconciliationOps,
      lwwPlans,
    };
  }

  /**
   * Re-emits safely decomposable fields from a local multi-entity op.
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

      const conflictPayloadKey = this._resolvePayloadKey(resolution.conflict.entityType);
      const remoteWinnerChanges =
        resolution.winner === 'remote' && remoteRemovalOps.length === 0
          ? mergeChangedFields(
              resolution.conflict.remoteOps,
              conflictPayloadKey,
              resolution.conflict.entityId,
            )
          : {};
      const remoteWinnerIsOpaque =
        resolution.winner === 'remote' &&
        remoteRemovalOps.length === 0 &&
        hasOpaqueChanges(
          resolution.conflict.remoteOps,
          conflictPayloadKey,
          resolution.conflict.entityId,
        );

      const clocks = [
        ...resolution.conflict.localOps.map((op) => op.vectorClock),
        ...resolution.conflict.remoteOps.map((op) => op.vectorClock),
      ];
      for (const localOp of resolution.conflict.localOps) {
        const allowedFields = DECOMPOSABLE_MULTI_ACTION_FIELDS.get(localOp.actionType);
        if (!isMultiEntityOperation(localOp) || !allowedFields) {
          continue;
        }
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
            this._resolvePayloadKey(localOp.entityType),
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
      const entityState = await this.getCurrentEntityState(
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
      const currentChanges = Object.fromEntries(
        [...candidate.fields].map((field) => [field, stateRecord[field]]),
      );
      reconciliationOps.push(
        this.createLWWUpdateOp(
          candidate.entityType,
          candidate.entityId,
          currentChanges,
          clientId,
          this.mergeAndIncrementClocks(candidate.clocks, clientId),
          candidate.timestamp,
          'patch',
        ),
      );
    }
    return reconciliationOps;
  }

  /**
   * Generic multi-entity operations cannot be partially compensated safely.
   * Fail before op-log mutation unless the winner removes the whole remote set,
   * a local archive is re-created as the same atomic action, or the local legacy
   * rounding action has an explicit per-entity reconciliation path above.
   */
  private _assertMultiEntityPlansAreSafe(
    plans: LwwConflictResolutionPlan<EntityConflict>[],
  ): void {
    for (const plan of plans) {
      const remoteMultiOps = plan.conflict.remoteOps.filter(isMultiEntityOperation);
      const remoteWholeRemovalIsSafe = remoteMultiOps.every(
        (op) =>
          op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE ||
          INDEPENDENT_MULTI_DELETE_ACTIONS.has(op.actionType),
      );
      if (remoteMultiOps.length > 0 && !remoteWholeRemovalIsSafe) {
        throw new Error(
          `ConflictResolutionService: Cannot safely auto-resolve remote multi-entity operation ` +
            `for ${plan.conflict.entityType}:${plan.conflict.entityId}`,
        );
      }

      const localMultiOps = plan.conflict.localOps.filter(isMultiEntityOperation);
      const localArchiveIsRecreated =
        plan.winner === 'local' &&
        plan.localWinOperationKind === 'archive-win' &&
        localMultiOps.every(
          (op) => op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        );
      const localOpsAreDecomposable = localMultiOps.every(
        (op) =>
          INDEPENDENT_MULTI_DELETE_ACTIONS.has(op.actionType) ||
          DECOMPOSABLE_MULTI_ACTION_FIELDS.has(op.actionType),
      );
      if (
        localMultiOps.length > 0 &&
        !localArchiveIsRecreated &&
        !localOpsAreDecomposable
      ) {
        throw new Error(
          `ConflictResolutionService: Cannot safely auto-resolve local multi-entity operation ` +
            `for ${plan.conflict.entityType}:${plan.conflict.entityId}`,
        );
      }
    }
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
    if (this._isWholeEntityWinPlan(plan)) {
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
        entityId: conflict.entityId,
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

    const localChanges = mergeChangedFields(
      conflict.localOps,
      payloadKey,
      conflict.entityId,
    );
    const remoteChanges = mergeChangedFields(
      conflict.remoteOps,
      payloadKey,
      conflict.entityId,
    );
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
      latestProjectMoveEntityIds(conflict.entityId, [
        ...conflict.localOps,
        ...conflict.remoteOps,
      ]),
    );
  }

  /**
   * SPAP-14 (observe-only): journal a disjoint-field merge as `merged` /
   * `disjoint-merge` / `info`. Nothing was discarded, so it must NOT count toward
   * the unreviewed count. Like `_journalResolution`, any failure is swallowed and
   * can never affect resolution. It is called only after the merged op's reducer
   * work succeeds, so the entry never describes a failed merge.
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

    let localWinOp = this.createLWWUpdateOp(
      conflict.entityType,
      conflict.entityId,
      entityState,
      clientId,
      newClock,
      preservedTimestamp,
      'replace',
      latestProjectMoveEntityIds(conflict.entityId, conflict.localOps),
    );
    if (
      conflict.remoteOps.some((op) => op.opType === OpType.Delete) ||
      conflict.localOps.some(
        (op) =>
          isLwwUpdatePayload(op.payload) &&
          op.payload.recreatesEntityAfterDelete === true,
      )
    ) {
      localWinOp = markLwwDeleteRecreation(localWinOp);
    }
    return localWinOp;
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
   * A local bulk delete can conflict for only one entity while also deleting
   * unaffected siblings. Rejecting the original atomic row is necessary for
   * the remote winner, but would otherwise prevent those sibling deletions
   * from ever reaching another client.
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
    return markLwwDeleteRecreation(
      this.createLWWUpdateOp(
        conflict.entityType,
        conflict.entityId,
        extractActionPayload(convertedOp.payload),
        clientId,
        this.mergeAndIncrementClocks(allClocks, clientId),
        remoteOp.timestamp,
      ),
    );
  }

  private async _createSubtaskRecreationOpsFromLocalDelete(
    conflict: EntityConflict,
    parentRecreationOp: Operation,
  ): Promise<Operation[]> {
    if (conflict.entityType !== 'TASK' || !parentRecreationOp.entityId) {
      return [];
    }
    const localDeleteOp = conflict.localOps.find((op) => op.opType === OpType.Delete);
    if (!localDeleteOp) {
      return [];
    }
    const parentSnapshot = extractEntityFromPayloadCore(
      localDeleteOp.payload,
      this._resolvePayloadKey(conflict.entityType),
      conflict.entityId,
    );
    const subTaskIds = extractActionPayload(parentRecreationOp.payload)['subTaskIds'];
    if (!Array.isArray(subTaskIds) || subTaskIds.length === 0) {
      return [];
    }

    const actionPayload = extractActionPayload(localDeleteOp.payload);
    const snapshotCandidates = [
      ...(Array.isArray(actionPayload['tasks']) ? actionPayload['tasks'] : []),
      ...(Array.isArray(parentSnapshot?.['subTasks']) ? parentSnapshot['subTasks'] : []),
    ];
    const snapshotsById = new Map<string, Record<string, unknown>>();
    for (const candidate of snapshotCandidates) {
      if (typeof candidate !== 'object' || candidate === null) {
        continue;
      }
      const snapshot = candidate as Record<string, unknown>;
      if (typeof snapshot['id'] === 'string') {
        snapshotsById.set(snapshot['id'], snapshot);
      }
    }
    const explicitlyDeletedIds = new Set(getOpEntityIds(localDeleteOp));

    const clientId = await this.clientIdProvider.loadClientId();
    if (!clientId) {
      OpLog.err(
        'ConflictResolutionService: Cannot recreate locally deleted subtasks - no client ID',
      );
      return [];
    }
    const recreationClock = this.mergeAndIncrementClocks(
      [
        ...conflict.localOps.map((op) => op.vectorClock),
        ...conflict.remoteOps.map((op) => op.vectorClock),
        parentRecreationOp.vectorClock,
      ],
      clientId,
    );
    const recreationOps: Operation[] = [];
    for (const subTaskId of subTaskIds) {
      if (typeof subTaskId !== 'string' || explicitlyDeletedIds.has(subTaskId)) {
        continue;
      }
      const snapshot = snapshotsById.get(subTaskId);
      if (!snapshot) {
        OpLog.err(
          `ConflictResolutionService: Missing local delete snapshot for TASK:${subTaskId}`,
        );
        continue;
      }
      recreationOps.push(
        markLwwDeleteRecreation(
          this.createLWWUpdateOp(
            'TASK' as EntityType,
            subTaskId,
            snapshot,
            clientId,
            recreationClock,
            parentRecreationOp.timestamp,
          ),
        ),
      );
    }
    return recreationOps;
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
      recreationOps.push(markLwwDeleteRecreation(recreationOp));
    }
    return recreationOps;
  }

  /**
   * Collects the TASK ids removed by DELETE ops in the same resolution batch.
   * A bulk `deleteTasks` op carries every id in `entityIds` and mirrors only
   * the first to `entityId`, with an empty `entityChanges`, so union both via
   * `getOpEntityIds` — reading `entityId` alone would miss every trailing id
   * and let recovery resurrect it. A mixed-entity payload can additionally
   * carry task deletes in `entityChanges`. Used to keep project/parent recovery
   * from recreating a task another device is concurrently deleting. Archive ops
   * are `OpType.Update` and are intentionally excluded.
   */
  private _collectDeletedTaskIds(ops: readonly Operation[]): Set<string> {
    const deletedTaskIds = new Set<string>();
    for (const op of ops) {
      if (op.entityType === 'TASK' && op.opType === OpType.Delete) {
        for (const id of getOpEntityIds(op)) deletedTaskIds.add(id);
      }
      if (isMultiEntityPayload(op.payload)) {
        for (const change of op.payload.entityChanges) {
          if (
            change.entityType === 'TASK' &&
            change.opType === OpType.Delete &&
            change.entityId
          ) {
            deletedTaskIds.add(change.entityId);
          }
        }
      }
    }
    return deletedTaskIds;
  }

  /**
   * Collects the ids removed by single/bulk DELETE ops of one entity type in the
   * same resolution batch. Unlike `_collectDeletedTaskIds` this does not scan
   * multi-entity `entityChanges`: `deleteNote`/`deleteSection`/`deleteTaskRepeatCfg(s)`
   * are all single- or bulk-entity deletes, so `getOpEntityIds` covers them. Used
   * to keep the project cascade recovery from resurrecting a note/section/repeat-cfg
   * another device is concurrently deleting (same divergence guard as tasks, #8997).
   */
  private _collectDeletedEntityIds(
    ops: readonly Operation[],
    entityType: EntityType,
  ): Set<string> {
    const deletedIds = new Set<string>();
    for (const op of ops) {
      if (op.entityType === entityType && op.opType === OpType.Delete) {
        for (const id of getOpEntityIds(op)) deletedIds.add(id);
      }
    }
    return deletedIds;
  }

  /**
   * Reads the full current entity dictionary for an adapter entity type from the
   * store. Used to enumerate a deleted project's still-present sections and repeat
   * configs at resolution time (they are not carried in the `deleteProject`
   * payload). Returns `{}` for non-adapter types or when no selector is
   * registered. Unlike `getCurrentEntityState`, this never routes through the
   * per-id selectors, some of which THROW on a missing id (`selectNoteById`,
   * `selectTaskRepeatCfgById`) — enumerating a stale id set would spam errors.
   */
  private async _getCurrentEntitiesOfType(
    entityType: EntityType,
  ): Promise<Record<string, unknown>> {
    const config = getEntityConfigFromRegistry(this.entityRegistry, entityType);
    if (!config || !isAdapterEntity(config) || !config.selectEntities) {
      return {};
    }
    const dict = await firstValueFrom(this.store.select(config.selectEntities));
    return (dict as Record<string, unknown>) ?? {};
  }

  /**
   * Recreates the non-task main-state cascade victims of a losing remote
   * `deleteProject` that the task-recovery path leaves deleted: notes, sections,
   * and task-repeat-cfgs. Runs alongside `_createTaskRecreationOpsForWinningProject`
   * on the winner, which still holds every victim at resolution time (the losing
   * delete is never applied live). Without this, the durable loser row replays on
   * every client's status-blind hydration and strips these entities, so the whole
   * fleet converges to a lossy shape (#9037) even though the winning UPDATE meant
   * "keep the project".
   *
   * All three are adapter entities recreated by `lwwUpdateMetaReducer`'s generic
   * `addOne` path (TASK-only logic is gated there). One shared `recreationClock`
   * dominates the delete; every op targets a distinct id, so they never conflict
   * with each other.
   *
   * KNOWN LIMITATIONS (all converge — no split-brain — and are strictly better
   * than losing the entity outright):
   * - Sections and repeat-cfgs have no `modified` field, so their LWW timestamp
   *   falls back to the project timestamp; a CONCURRENT content edit on another
   *   device can be clobbered by the replace snapshot. Notes carry `modified`,
   *   which keeps a concurrent note edit winning.
   * - A note's `NoteState.todayOrder` slot is not restored (the adapter recreate
   *   only touches `entities`/`ids`); a today-pinned note reappears but loses its
   *   today-list ordering. Project-level note membership IS restored via the
   *   project compensation snapshot's `noteIds`.
   * - A section/cfg concurrently ADDED on a third device (not yet applied, so not
   *   enumerable here) is still removed by the loser's dynamic-filter replay.
   * - Like the task path, the merged delete clock can over-resurrect an entity a
   *   third device had already durably deleted before the losing delete synced.
   *
   * Archived tasks, archive time-tracking, current time-tracking, and menu-tree
   * stay outside this path (separate persistence / singleton state) — their own
   * snapshot design is deferred (#9037).
   */
  private async _createCascadeRecreationOpsForWinningProject(
    projectCompensationOp: Operation,
    remoteDeleteOp: Operation,
    guard: {
      concurrentlyDeletedTaskIds: ReadonlySet<string>;
      batchOps: readonly Operation[];
    },
  ): Promise<Operation[]> {
    if (
      projectCompensationOp.entityType !== 'PROJECT' ||
      remoteDeleteOp.entityType !== 'PROJECT' ||
      remoteDeleteOp.actionType !== ActionType.TASK_SHARED_DELETE_PROJECT ||
      !projectCompensationOp.entityId
    ) {
      return [];
    }
    const projectId = projectCompensationOp.entityId;

    const clientId = await this.clientIdProvider.loadClientId();
    if (!clientId) {
      OpLog.err(
        'ConflictResolutionService: Cannot recreate winning project cascade - no client ID',
      );
      return [];
    }
    const recreationClock = this.mergeAndIncrementClocks(
      [remoteDeleteOp.vectorClock, projectCompensationOp.vectorClock],
      clientId,
    );

    const buildRecreationOp = (
      entityType: EntityType,
      entityId: string,
      entityState: Record<string, unknown>,
    ): Operation => {
      const modified = entityState['modified'];
      return markLwwDeleteRecreation(
        this.createLWWUpdateOp(
          entityType,
          entityId,
          entityState,
          clientId,
          recreationClock,
          typeof modified === 'number' ? modified : projectCompensationOp.timestamp,
        ),
      );
    };

    const recreationOps: Operation[] = [];

    // Notes: enumerable from the delete payload's `noteIds`. Guard the array for
    // legacy pre-`noteIds` deleteProject ops (the #9037 rollout window is exactly
    // legacy deletes losing).
    const deletePayload = extractActionPayload(remoteDeleteOp.payload);
    const noteIds = deletePayload['noteIds'];
    if (Array.isArray(noteIds) && noteIds.length > 0) {
      const noteEntities = await this._getCurrentEntitiesOfType('NOTE' as EntityType);
      const deletedNoteIds = this._collectDeletedEntityIds(
        guard.batchOps,
        'NOTE' as EntityType,
      );
      for (const noteId of noteIds) {
        if (typeof noteId !== 'string' || deletedNoteIds.has(noteId)) continue;
        const note = noteEntities[noteId] as Record<string, unknown> | undefined;
        if (!note || note['id'] !== noteId) continue;
        recreationOps.push(buildRecreationOp('NOTE' as EntityType, noteId, note));
      }
    }

    // Sections: not in the payload — scan the store for project-owned sections
    // (same predicate as `removeProjectSections`). Strip taskIds pointing at a
    // concurrently-deleted task so the recreated section carries no dangling ref.
    const sectionEntities = await this._getCurrentEntitiesOfType('SECTION' as EntityType);
    const deletedSectionIds = this._collectDeletedEntityIds(
      guard.batchOps,
      'SECTION' as EntityType,
    );
    for (const [sectionId, sectionRaw] of Object.entries(sectionEntities)) {
      const section = sectionRaw as Record<string, unknown>;
      if (
        section['id'] !== sectionId ||
        section['contextType'] !== WorkContextType.PROJECT ||
        section['contextId'] !== projectId ||
        deletedSectionIds.has(sectionId)
      ) {
        continue;
      }
      const taskIds = section['taskIds'];
      const cleanedSection = Array.isArray(taskIds)
        ? {
            ...section,
            taskIds: taskIds.filter(
              (id) => typeof id === 'string' && !guard.concurrentlyDeletedTaskIds.has(id),
            ),
          }
        : section;
      recreationOps.push(
        buildRecreationOp('SECTION' as EntityType, sectionId, cleanedSection),
      );
    }

    // Task-repeat-cfgs: not in the payload — scan the store by projectId.
    const repeatCfgEntities = await this._getCurrentEntitiesOfType(
      'TASK_REPEAT_CFG' as EntityType,
    );
    const deletedRepeatCfgIds = this._collectDeletedEntityIds(
      guard.batchOps,
      'TASK_REPEAT_CFG' as EntityType,
    );
    for (const [cfgId, cfgRaw] of Object.entries(repeatCfgEntities)) {
      const cfg = cfgRaw as Record<string, unknown>;
      if (
        cfg['id'] !== cfgId ||
        cfg['projectId'] !== projectId ||
        deletedRepeatCfgIds.has(cfgId)
      ) {
        continue;
      }
      recreationOps.push(buildRecreationOp('TASK_REPEAT_CFG' as EntityType, cfgId, cfg));
    }

    return recreationOps;
  }

  /**
   * Recreates the active tasks removed by a losing remote `deleteProject`.
   *
   * The first PROJECT compensation makes the parent available before any TASK
   * recreation is delivered. TASK snapshots then restore every cascade target
   * that still exists locally; a task deleted on this device stays deleted.
   * Finally, a second PROJECT snapshot restores the exact regular/backlog lists
   * after the task entities exist. That last row is required because the LWW
   * reducer filters missing task IDs from a project snapshot, and TASK entities
   * do not encode whether they belong to the regular list or the backlog.
   * Keeping this durable order also works when upload/download pagination puts
   * every compensation in a separate batch.
   *
   * Notes, archived tasks, and other deleteProject cascades are intentionally
   * outside this task-recovery path; they need their own snapshot design.
   */
  private async _createTaskRecreationOpsForWinningProject(
    projectCompensationOp: Operation,
    remoteDeleteOp: Operation,
    concurrentlyDeletedTaskIds: ReadonlySet<string> = new Set(),
  ): Promise<Operation[]> {
    if (
      projectCompensationOp.entityType !== 'PROJECT' ||
      remoteDeleteOp.entityType !== 'PROJECT' ||
      remoteDeleteOp.actionType !== ActionType.TASK_SHARED_DELETE_PROJECT ||
      !projectCompensationOp.entityId
    ) {
      return [];
    }
    const allTaskIds = extractActionPayload(remoteDeleteOp.payload)['allTaskIds'];
    const winningProjectState = extractActionPayload(projectCompensationOp.payload);
    const regularTaskIds = winningProjectState['taskIds'];
    const backlogTaskIds = winningProjectState['backlogTaskIds'];
    const projectRootTaskIds = [
      ...(Array.isArray(regularTaskIds) ? regularTaskIds : []),
      ...(Array.isArray(backlogTaskIds) ? backlogTaskIds : []),
    ].filter((taskId): taskId is string => typeof taskId === 'string');
    const uniqueTaskIds = new Set(
      (Array.isArray(allTaskIds) ? allTaskIds : []).filter(
        (taskId): taskId is string => typeof taskId === 'string',
      ),
    );
    for (const taskId of projectRootTaskIds) uniqueTaskIds.add(taskId);

    const taskStateCache = new Map<string, unknown>();
    const childTaskIds: string[] = [];
    for (const rootTaskId of new Set(projectRootTaskIds)) {
      const rootTaskState = await this.getCurrentEntityState(
        'TASK' as EntityType,
        rootTaskId,
      );
      taskStateCache.set(rootTaskId, rootTaskState);
      // A root deleted concurrently in this batch takes its subtree with it;
      // don't gather its children only to recreate them as orphans.
      if (concurrentlyDeletedTaskIds.has(rootTaskId)) continue;
      const subTaskIds =
        typeof rootTaskState === 'object' && rootTaskState !== null
          ? (rootTaskState as Record<string, unknown>)['subTaskIds']
          : undefined;
      if (!Array.isArray(subTaskIds)) continue;
      childTaskIds.push(
        ...subTaskIds.filter(
          (subTaskId): subTaskId is string => typeof subTaskId === 'string',
        ),
      );
    }
    for (const taskId of childTaskIds) uniqueTaskIds.add(taskId);
    // Recovery decides "still present" from the pre-batch store, so it cannot
    // see a delete piggybacked as a non-conflicting op in the same batch.
    // Recreating such a task would resurrect it (with a borrowed newer
    // timestamp) on every client that applied the delete, while this client's
    // own delete wins locally — a silent divergence (#8997 review).
    for (const deletedTaskId of concurrentlyDeletedTaskIds) {
      uniqueTaskIds.delete(deletedTaskId);
    }
    if (uniqueTaskIds.size === 0) return [];

    const clientId = await this.clientIdProvider.loadClientId();
    if (!clientId) {
      OpLog.err(
        'ConflictResolutionService: Cannot recreate winning project tasks - no client ID',
      );
      return [];
    }

    const recreationClock = this.mergeAndIncrementClocks(
      [remoteDeleteOp.vectorClock, projectCompensationOp.vectorClock],
      clientId,
    );
    const recreationOps: Operation[] = [];
    const recreationTaskStates = new Map<string, unknown>();
    for (const taskId of uniqueTaskIds) {
      const taskState = taskStateCache.has(taskId)
        ? taskStateCache.get(taskId)
        : await this.getCurrentEntityState('TASK' as EntityType, taskId);
      if (taskState === undefined) {
        continue;
      }
      recreationTaskStates.set(taskId, taskState);
      // Prefer the task's own last-modified time as the LWW timestamp. The
      // project timestamp is unrelated to task content, so borrowing it lets
      // the snapshot clobber a CONCURRENT content edit made on another device;
      // the task's `modified` keeps that edit winning. Clock domination over
      // the delete is independent of this (it comes from recreationClock).
      const taskModified =
        typeof taskState === 'object' && taskState !== null
          ? (taskState as Record<string, unknown>)['modified']
          : undefined;
      recreationOps.push(
        markLwwDeleteRecreation(
          this.createLWWUpdateOp(
            'TASK' as EntityType,
            taskId,
            taskState,
            clientId,
            recreationClock,
            typeof taskModified === 'number'
              ? taskModified
              : projectCompensationOp.timestamp,
          ),
        ),
      );
    }
    if (recreationOps.length === 0) {
      return [];
    }

    let relationshipClock = this.mergeAndIncrementClocks(
      [projectCompensationOp.vectorClock, ...recreationOps.map((op) => op.vectorClock)],
      clientId,
    );
    const relationshipOps: Operation[] = [];
    for (const [taskId, taskState] of recreationTaskStates) {
      const subTaskIds =
        typeof taskState === 'object' && taskState !== null
          ? (taskState as Record<string, unknown>)['subTaskIds']
          : undefined;
      if (!Array.isArray(subTaskIds) || subTaskIds.length === 0) continue;
      const relationshipOp = markLwwDeleteRecreation(
        this.createLWWUpdateOp(
          'TASK' as EntityType,
          taskId,
          taskRelationshipPatch(taskId, taskState as Record<string, unknown>),
          clientId,
          relationshipClock,
          projectCompensationOp.timestamp,
          'patch',
        ),
      );
      relationshipOps.push(relationshipOp);
      relationshipClock = this.mergeAndIncrementClocks(
        [relationshipClock, relationshipOp.vectorClock],
        clientId,
      );
    }
    const projectMembershipOp = markLwwDeleteRecreation(
      this.createLWWUpdateOp(
        'PROJECT' as EntityType,
        projectCompensationOp.entityId,
        {
          id: projectCompensationOp.entityId,
          taskIds: winningProjectState['taskIds'],
          backlogTaskIds: winningProjectState['backlogTaskIds'],
        },
        clientId,
        relationshipClock,
        projectCompensationOp.timestamp,
        'patch',
      ),
    );
    return [...recreationOps, ...relationshipOps, projectMembershipOp];
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

    const convertibleRemoteOps = conflict.remoteOps.filter(
      (op) => op.actionType !== ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
    );
    if (convertibleRemoteOps.length === 0) {
      return conflict.remoteOps;
    }

    for (const remoteOp of convertibleRemoteOps) {
      if (remoteOp.opType === OpType.Update) {
        OpLog.log(
          `ConflictResolutionService: Converting remote UPDATE to LWW Update for ` +
            `${remoteOp.entityType}:${remoteOp.entityId} (local DELETE lost)`,
        );
      }
    }

    const convertedOps = convertLocalDeleteRemoteUpdatesToLww<Operation>(
      { ...conflict, remoteOps: convertibleRemoteOps },
      {
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
      },
    );
    // Conversion may wrap an older-schema op in the v3-only replacement
    // envelope; restamp it so the stored row's version matches its semantics.
    // Ops returned unchanged keep their original (honest) stamp.
    const convertedById = new Map(
      convertedOps.map((op) => [
        op.id,
        isLwwUpdatePayload(op.payload) &&
        op.payload.lwwUpdateMode === 'replace' &&
        (op.schemaVersion ?? 1) < CURRENT_SCHEMA_VERSION
          ? { ...op, schemaVersion: CURRENT_SCHEMA_VERSION }
          : op,
      ]),
    );
    return conflict.remoteOps.map((op) => convertedById.get(op.id) ?? op);
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
      // Task-time sync operations are positive deltas, so two concurrent timer
      // batches commute. Sending them through entity-level LWW would discard one
      // user's tracked time even though both can be applied safely.
      if (
        remoteOp.actionType === ActionType.TIME_TRACKING_SYNC_TIME_SPENT &&
        ctx.localOpsForEntity.every(
          (op) => op.actionType === ActionType.TIME_TRACKING_SYNC_TIME_SPENT,
        )
      ) {
        return { isSupersededOrDuplicate: false, conflict: null };
      }

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
    const written: MixedSourceWrittenOperation[] = result.writtenOps.map((op, index) => ({
      op,
      seq: result.seqs[index],
      source,
    }));
    const replayable = await this._resolveReplayableOperations(ops, source, written);
    return {
      ops: replayable.map((entry) => entry.op),
      seqs: replayable.map((entry) => entry.seq),
    };
  }

  private async _resolveReplayableOperations(
    ops: readonly Operation[],
    source: 'local' | 'remote',
    written: readonly MixedSourceWrittenOperation[],
  ): Promise<Array<{ op: Operation; seq: number }>> {
    const writtenByOpId = new Map(
      written
        .filter((entry) => entry.source === source)
        .map((entry) => [entry.op.id, entry]),
    );
    const replayable = await Promise.all(
      ops.map(async (op) => {
        const writtenEntry = writtenByOpId.get(op.id);
        if (writtenEntry) {
          return { op: writtenEntry.op, seq: writtenEntry.seq };
        }

        // A reducer failure deliberately leaves the durable remote row pending.
        // On the next sync, deduplication finds that row instead of inserting it;
        // reuse its sequence so the recovered reducer can be retried and
        // checkpointed. Applied, archive-pending, failed, or rejected rows must
        // not be reducer-dispatched again.
        const existing = await this.opLogStore.getOpById(op.id);
        return existing?.source === source &&
          existing.applicationStatus === 'pending' &&
          existing.rejectedAt === undefined &&
          existing.reducerRejectedAt === undefined
          ? { op: existing.op, seq: existing.seq }
          : undefined;
      }),
    );
    const pendingOps = replayable.filter(
      (entry): entry is { op: Operation; seq: number } => entry !== undefined,
    );
    return pendingOps;
  }
}
