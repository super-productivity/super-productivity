import { EntityState } from '@ngrx/entity';
import { Action } from '@ngrx/store';
import { EntityType, Operation } from '../core/operation.types';
import { convertOpToAction } from '../apply/operation-converter.util';
import { simpleCounterReducer } from '../../features/simple-counter/store/simple-counter.reducer';
import { SimpleCounterState } from '../../features/simple-counter/simple-counter.model';

type EntityReducer = (
  state: EntityState<unknown>,
  action: Action,
) => EntityState<unknown>;

/**
 * Feature reducers that replay a winning remote UPDATE onto an entity being
 * recreated after its local delete lost (`_convertToLWWUpdatesIfNeeded`).
 *
 * The recreate folds each remote update onto the deleted entity. A field
 * write (`{ <payloadKey>: { id, changes } }`) folds as fields, but a semantic
 * update does not: `setSimpleCounterCounterToday({ id, newVal, today })`
 * (likewise `setSimpleCounterCounterForDate`, `syncSimpleCounterTime`) has no
 * field payload, so the field read finds no changes and leaves `countOnDay`
 * stale: the recreating device diverges from the device that made the update
 * (#11465). Replaying the op through its own reducer gives the exact state
 * every other device reached. Field writes (`updateSimpleCounter`, a
 * single-counter `updateAllSimpleCounters`) replay to the same result as the
 * field read. `convertOpToAction` marks the action remote, which
 * `syncSimpleCounterTime` requires to apply.
 *
 * List a type here when its persisted single-entity updates include semantic
 * actions and its feature reducer applies them from the entity alone (no
 * other slice, no meta-reducer). TASK is not listed: its updates go through
 * meta-reducers, and its one semantic update (`syncTimeSpent`) is folded by
 * `foldSyncTimeSpentDeltas`.
 */
const RECREATE_REPLAY_REDUCERS: Partial<Record<EntityType, EntityReducer>> = {
  SIMPLE_COUNTER: (state, action) =>
    simpleCounterReducer(state as SimpleCounterState, action),
};

/**
 * Applies `op` to `entity` with the entity type's own reducer and returns the
 * resulting entity, or `undefined` when the type has no replay reducer or the
 * reducer does not handle the op (it returns the state it was given). The
 * caller then reads the payload as field values, so an update the reducer
 * does not know (an action added later, or a legacy LWW Update) keeps the
 * field read instead of being silently dropped.
 */
export const replayUpdateOnRecreatedEntity = (
  entity: Record<string, unknown>,
  op: Operation,
): Record<string, unknown> | undefined => {
  const reducer = RECREATE_REPLAY_REDUCERS[op.entityType];
  if (!reducer || !op.entityId) return undefined;
  const id = op.entityId;
  const state: EntityState<unknown> = {
    ids: [id],
    entities: { [id]: { ...entity, id } },
  };
  const projected = reducer(state, convertOpToAction(op));
  if (projected === state) return undefined;
  return (projected.entities[id] as Record<string, unknown> | undefined) ?? entity;
};
