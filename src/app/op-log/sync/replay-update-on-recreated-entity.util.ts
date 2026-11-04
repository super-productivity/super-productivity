import { EntityState } from '@ngrx/entity';
import { Action } from '@ngrx/store';
import { ActionType, Operation } from '../core/operation.types';
import { convertOpToAction } from '../apply/operation-converter.util';
import { simpleCounterReducer } from '../../features/simple-counter/store/simple-counter.reducer';
import { SimpleCounterState } from '../../features/simple-counter/simple-counter.model';

type EntityReducer = (
  state: EntityState<unknown>,
  action: Action,
) => EntityState<unknown>;

const simpleCounterReplay: EntityReducer = (state, action) =>
  simpleCounterReducer(state as SimpleCounterState, action);

/**
 * Semantic updates replayed onto an entity being recreated after its local
 * delete lost (`_convertToLWWUpdatesIfNeeded`), with the reducer that applies
 * them.
 *
 * The recreate folds each remote update onto the deleted entity. A field
 * write (`{ <payloadKey>: { id, changes } }`) folds as fields, but a semantic
 * update does not: `setSimpleCounterCounterToday({ id, newVal, today })`
 * (likewise `setSimpleCounterCounterForDate`, `syncSimpleCounterTime`) has no
 * field payload, so the field read finds no changes and leaves `countOnDay`
 * stale: the recreating device diverges from the device that made the update
 * (#11465). Replaying the op through its own reducer gives the exact state
 * every other device reached. `convertOpToAction` marks the action remote,
 * which `syncSimpleCounterTime` requires to apply.
 *
 * Keyed by action type, not entity type: every other update (field writes,
 * and LWW Updates of clients that predate `lwwUpdateMode`, which the feature
 * reducer does not handle) keeps the field read. List an action here only
 * when its feature reducer applies it from the entity alone (no other slice,
 * no meta-reducer). TASK's one semantic update (`syncTimeSpent`) is folded by
 * `foldSyncTimeSpentDeltas` instead.
 */
const RECREATE_REPLAY_REDUCERS: Partial<Record<string, EntityReducer>> = {
  [ActionType.COUNTER_SET_TODAY]: simpleCounterReplay,
  [ActionType.COUNTER_SET_FOR_DATE]: simpleCounterReplay,
  [ActionType.COUNTER_SYNC_TIME]: simpleCounterReplay,
};

/**
 * Applies `op` to `entity` with its action's reducer and returns the
 * resulting entity, or `undefined` when the action is not a listed semantic
 * update (the caller then reads the payload as field values).
 */
export const replayUpdateOnRecreatedEntity = (
  entity: Record<string, unknown>,
  op: Operation,
): Record<string, unknown> | undefined => {
  const reducer = Object.hasOwn(RECREATE_REPLAY_REDUCERS, op.actionType)
    ? RECREATE_REPLAY_REDUCERS[op.actionType]
    : undefined;
  if (!reducer || !op.entityId) return undefined;
  const id = op.entityId;
  const projected = reducer(
    { ids: [id], entities: { [id]: { ...entity, id } } },
    convertOpToAction(op),
  );
  return (projected.entities[id] as Record<string, unknown> | undefined) ?? entity;
};
