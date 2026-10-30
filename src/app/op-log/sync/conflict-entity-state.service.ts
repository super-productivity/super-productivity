import { inject, Injectable } from '@angular/core';
import {
  convertLocalDeleteRemoteUpdatesToLww,
  getEntityConfig as getEntityConfigFromRegistry,
  getPayloadKey as getPayloadKeyFromRegistry,
  isAdapterEntity,
  isArrayEntity,
  isMapEntity,
  isSingletonEntity,
} from '@sp/sync-core';
import type { SelectByIdFactory } from '../core/entity-registry-host.types';
import { Store } from '@ngrx/store';
import {
  ActionType,
  EntityConflict,
  EntityType,
  extractActionPayload,
  Operation,
  isLwwUpdatePayload,
  OpType,
} from '../core/operation.types';
import { toLwwUpdateActionType } from '../core/lww-update-action-types';
import { OpLog } from '../../core/log';
import { getOpEntityIds } from '../util/get-op-entity-ids.util';
import { toEntityKey } from '../util/entity-key.util';
import { firstValueFrom } from 'rxjs';
import { ENTITY_REGISTRY, isSingletonEntityId } from '../core/entity-registry';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';
import { foldSyncTimeSpentDeltas, isSyncTimeSpentOp } from './fold-sync-time-spent.util';

/**
 * Reads current entity state and entity-shaped payloads for conflict resolution.
 * Split out of `ConflictResolutionService`, which orchestrates the resolution.
 */
@Injectable({
  providedIn: 'root',
})
export class ConflictEntityStateService {
  private entityRegistry = inject(ENTITY_REGISTRY);
  private store = inject(Store);

  /**
   * Extracts entity state from a remote DELETE operation payload.
   *
   * When a remote DELETE wins the conflict but we need the entity state for LWW resolution,
   * we can extract it from the DELETE operation's payload (which contains the deleted entity).
   *
   * @param conflict - The conflict containing remote DELETE operation
   * @returns Entity state from DELETE payload, or undefined if not found
   */
  _extractEntityFromDeleteOperation(conflict: EntityConflict): unknown | undefined {
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
   * Reads the full current entity dictionary for an adapter entity type from the
   * store. Used to enumerate a deleted project's still-present sections and repeat
   * configs at resolution time (they are not carried in the `deleteProject`
   * payload). Returns `{}` for non-adapter types or when no selector is
   * registered. Unlike `getCurrentEntityState`, this never routes through the
   * per-id selectors, some of which THROW on a missing id (`selectNoteById`,
   * `selectTaskRepeatCfgById`) — enumerating a stale id set would spam errors.
   */
  async _getCurrentEntitiesOfType(
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
   * `_convertToLWWUpdatesIfNeeded` for the remote winners of `resolutions`.
   * Detection makes one conflict per remote op, so each entity's winners are
   * converted as one conflict: every converted op must carry all of them, or
   * the one applied last erases the others (#10380).
   */
  _remoteWinnerConverter(
    resolutions: { winner: 'local' | 'remote'; conflict: EntityConflict }[],
  ): (conflict: EntityConflict) => Operation[] {
    const byEntity = new Map<string, EntityConflict>();
    for (const { winner, conflict } of resolutions) {
      if (winner !== 'remote') continue;
      const key = toEntityKey(conflict.entityType, conflict.entityId);
      const prev = byEntity.get(key);
      byEntity.set(
        key,
        prev
          ? {
              ...prev,
              localOps: [...prev.localOps, ...conflict.localOps],
              remoteOps: [...prev.remoteOps, ...conflict.remoteOps],
            }
          : conflict,
      );
    }
    const converted = new Map(
      [...byEntity.values()]
        .flatMap((merged) => this._convertToLWWUpdatesIfNeeded(merged))
        .map((op) => [op.id, op]),
    );
    return (conflict) => conflict.remoteOps.map((op) => converted.get(op.id) ?? op);
  }

  /**
   * Makes winning remote updates recreate entities deleted locally.
   *
   * Generic updates become LWW snapshots. Archive/restore actions already recreate
   * state and retain their type so archive side effects receive the semantic payload.
   */
  _convertToLWWUpdatesIfNeeded(conflict: EntityConflict): Operation[] {
    // Check if local side has a DELETE operation
    const hasLocalDelete = conflict.localOps.some((op) => op.opType === OpType.Delete);

    if (!hasLocalDelete) {
      // No DELETE conflict - return remote ops as-is
      return conflict.remoteOps;
    }

    // A winning archive or restore applies by its own payload, and a restore
    // returns the task to state: only the winners before the first of them
    // apply to the deleted task. Later ones apply to the restored task as they
    // are; folding them in would overwrite what the restore set.
    const barrier = conflict.remoteOps.findIndex(
      (op) =>
        op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE ||
        op.actionType === ActionType.TASK_SHARED_RESTORE,
    );
    const convertibleRemoteOps = (
      barrier < 0 ? conflict.remoteOps : conflict.remoteOps.slice(0, barrier)
    ).filter(
      (op) =>
        // A multi-entity row must never be rewritten into a single-entity LWW
        // replace: it would drop the row's effect on every other entity, and
        // the converted copy shares the original's op id across several
        // conflicts. Today that mangling is MASKED downstream by accident (the
        // recreate path re-routes the original op and the same-id copy dies in
        // the append duplicate check) — this guard makes the invariant
        // explicit instead. Consequence for multi-entity delete-vs-update:
        // recreation finds no converted op, so the locally deleted entity
        // stays deleted (the same logged degrade as the legacy bulk-delete
        // case) while the bulk row still applies to its other entities.
        getOpEntityIds(op).length <= 1,
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
        // A task delete carries `TaskWithSubTasks`; `subTasks` is no task field.
        toBaseEntity: (entity, entityType) => {
          if (entityType !== 'TASK' || !('subTasks' in entity)) return entity;
          const task = { ...entity };
          delete task['subTasks'];
          return task;
        },
        // A winning syncTimeSpent delta adds to the recreated task's time, as
        // its reducer does everywhere else; its arguments are no fields (#10380).
        applyAdditiveUpdate: (entity, op) =>
          isSyncTimeSpentOp(op)
            ? foldSyncTimeSpentDeltas(conflict.entityId, entity, [op])
            : undefined,
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

  _resolvePayloadKey(entityType: EntityType): string {
    return (
      getPayloadKeyFromRegistry(this.entityRegistry, entityType) ||
      entityType.toLowerCase()
    );
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
}
