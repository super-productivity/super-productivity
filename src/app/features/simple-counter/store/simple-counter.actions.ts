import { createAction, props } from '@ngrx/store';
import { Update } from '@ngrx/entity';
import { SimpleCounter } from '../simple-counter.model';
import { PersistentActionMeta } from '../../../op-log/core/persistent-action.interface';
import { OpType } from '../../../op-log/core/operation.types';

export const addSimpleCounter = createAction(
  '[SimpleCounter] Add SimpleCounter',
  (counterProps: { simpleCounter: SimpleCounter }) => ({
    ...counterProps,
    meta: {
      isPersistent: true,
      entityType: 'SIMPLE_COUNTER',
      entityId: counterProps.simpleCounter.id,
      opType: OpType.Create,
    } satisfies PersistentActionMeta,
  }),
);

export const updateSimpleCounter = createAction(
  '[SimpleCounter] Update SimpleCounter',
  (counterProps: { simpleCounter: Update<SimpleCounter> }) => ({
    ...counterProps,
    meta: {
      isPersistent: true,
      entityType: 'SIMPLE_COUNTER',
      entityId: counterProps.simpleCounter.id as string,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);

// Upsert is typically used for sync/import, so no persistence metadata
export const upsertSimpleCounter = createAction(
  '[SimpleCounter] Upsert SimpleCounter',
  props<{ simpleCounter: SimpleCounter }>(),
);

export const deleteSimpleCounter = createAction(
  '[SimpleCounter] Delete SimpleCounter',
  (counterProps: { id: string }) => ({
    ...counterProps,
    meta: {
      isPersistent: true,
      entityType: 'SIMPLE_COUNTER',
      entityId: counterProps.id,
      opType: OpType.Delete,
    } satisfies PersistentActionMeta,
  }),
);

export const deleteSimpleCounters = createAction(
  '[SimpleCounter] Delete multiple SimpleCounters',
  (counterProps: { ids: string[] }) => ({
    ...counterProps,
    meta: {
      isPersistent: true,
      entityType: 'SIMPLE_COUNTER',
      entityIds: counterProps.ids,
      opType: OpType.Delete,
      isBulk: true,
    } satisfies PersistentActionMeta,
  }),
);

export const updateAllSimpleCounters = createAction(
  '[SimpleCounter] Update all SimpleCounters',
  (counterProps: { items: SimpleCounter[] }) => ({
    ...counterProps,
    meta: {
      isPersistent: true,
      entityType: 'SIMPLE_COUNTER',
      entityIds: counterProps.items.map((item) => item.id),
      opType: OpType.Update,
      isBulk: true,
    } satisfies PersistentActionMeta,
  }),
);

export const setSimpleCounterCounterToday = createAction(
  '[SimpleCounter] Set SimpleCounter Counter Today',
  (counterProps: { id: string; newVal: number; today: string }) => ({
    ...counterProps,
    meta: {
      isPersistent: true,
      entityType: 'SIMPLE_COUNTER',
      entityId: counterProps.id,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);

export const setSimpleCounterCounterForDate = createAction(
  '[Simple Counter] Set SimpleCounter Counter For Date',
  (counterProps: { id: string; date: string; newVal: number }) => ({
    ...counterProps,
    meta: {
      isPersistent: true,
      entityType: 'SIMPLE_COUNTER',
      entityId: counterProps.id,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);

// Non-persistent - local UI update only
// Sync happens via setSimpleCounterCounterToday with absolute value
export const increaseSimpleCounterCounterToday = createAction(
  '[SimpleCounter] Increase SimpleCounter Counter Today',
  props<{ id: string; increaseBy: number; today: string }>(),
);

// Non-persistent - local UI update only
// Sync happens via setSimpleCounterCounterToday with absolute value
export const decreaseSimpleCounterCounterToday = createAction(
  '[SimpleCounter] Decrease SimpleCounter Counter Today',
  props<{ id: string; decreaseBy: number; today: string }>(),
);

// Non-persistent - isOn state is local only (shouldn't sync across devices)
export const toggleSimpleCounterCounter = createAction(
  '[SimpleCounter] Toggle SimpleCounter Counter',
  props<{ id: string }>(),
);

// Internal cleanup action - typically triggered automatically, no persistence
export const turnOffAllSimpleCounterCounters = createAction(
  '[SimpleCounter] Turn off all simple counters',
);

// Non-persistent - isOn state is local only (shouldn't sync across devices)
export const setSimpleCounterCounterOff = createAction(
  '[SimpleCounter] Set SimpleCounter Counter Off',
  props<{ id: string }>(),
);

// Non-persistent - isOn state is local only (shouldn't sync across devices)
export const setSimpleCounterCounterOn = createAction(
  '[SimpleCounter] Set SimpleCounter Counter On',
  props<{ id: string }>(),
);

// Non-persistent local tick for immediate UI updates (StopWatch only)
// Accumulated and synced periodically via syncSimpleCounterTime
export const tickSimpleCounterLocal = createAction(
  '[SimpleCounter] Tick Local',
  props<{ id: string; increaseBy: number; today: string }>(),
);

// Persistent sync action for batched StopWatch time updates
// Dispatched every 5 minutes and when counter stops
// Local dispatch: no-op (state already updated by tickSimpleCounterLocal)
// Remote dispatch: applies accumulated duration
export const syncSimpleCounterTime = createAction(
  '[SimpleCounter] Sync counter time',
  (actionProps: { id: string; date: string; duration: number }) => ({
    ...actionProps,
    meta: {
      isPersistent: true,
      entityType: 'SIMPLE_COUNTER',
      entityId: actionProps.id,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);
