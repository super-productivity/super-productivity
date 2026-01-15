import { Injectable } from '@angular/core';
import {
  ActionType,
  EntityType,
  Operation,
  OpType,
  VectorClock,
} from '../core/operation.types';
import { uuidv7 } from '../../util/uuid-v7';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';
import { incrementVectorClock, mergeVectorClocks } from '../../core/util/vector-clock';

/**
 * Factory for creating LWW (Last-Write-Wins) Update operations.
 *
 * LWW Update operations are synthetic operations created during conflict resolution
 * to carry the winning local state to remote clients. They are created when:
 * 1. Local state wins LWW conflict resolution (ConflictResolutionService)
 * 2. Stale local operations need to be re-uploaded with merged clocks (StaleOperationResolverService)
 *
 * These operations use dynamically constructed action types (e.g., '[TASK] LWW Update')
 * that are matched by regex in lwwUpdateMetaReducer.
 */
@Injectable({
  providedIn: 'root',
})
export class LWWOperationFactory {
  /**
   * Creates a new LWW Update operation for syncing local state.
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
      actionType: `[${entityType}] LWW Update` as ActionType,
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
}
