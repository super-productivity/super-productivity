import { EntityType, isLwwUpdatePayload, Operation } from '../core/operation.types';
import type { SimpleCounterCopy } from '../../features/simple-counter/simple-counter.model';

type OptionalKeys<T> = {
  [K in keyof T]-?: Partial<Pick<T, K>> extends Pick<T, K> ? K : never;
}[keyof T];

/**
 * Every optional SimpleCounter field (typed: a new optional field fails
 * compilation until it is listed here).
 */
const SIMPLE_COUNTER_OPTIONAL_FIELDS: readonly string[] = Object.keys({
  isHideButton: true,
  isTrackStreaks: true,
  streakMinValue: true,
  streakMode: true,
  streakWeekDays: true,
  streakWeeklyFrequency: true,
  countdownDuration: true,
} satisfies Record<OptionalKeys<SimpleCounterCopy>, true>);

/**
 * Entity types with a REQUIRED field named like an action-envelope key
 * (SimpleCounter.type), mapped to their optional fields.
 */
const PATCH_SNAPSHOT_OPTIONAL_FIELDS: Partial<Record<EntityType, readonly string[]>> = {
  SIMPLE_COUNTER: SIMPLE_COUNTER_OPTIONAL_FIELDS,
};

/**
 * Sends a whole-entity LWW snapshot of such a type as a 'patch'.
 *
 * Released receivers (v18.15.0-v19.1.0) apply a 'replace' snapshot with
 * `setOne` and cannot carry the envelope-shadowed field, so the entity fails
 * validation and repair resets it (a Stopwatch habit became a click counter)
 * and broadcasts a full-state REPAIR op. A 'patch' applies with `updateOne` on
 * every release, keeping their own value. The snapshot still carries every
 * field it has; the optional fields it lacks are listed as `clearedFields`, so
 * v18.22.0+ receivers clear them exactly like a replace would. Older ones keep
 * such a stale optional value (the #9776 no-op clear).
 *
 * Recreate-after-delete snapshots stay 'replace': receivers ignore a marked
 * patch for an absent entity, and a recreate runs `addOne` anyway.
 *
 * SUNSET: drop once v18.15.0-v19.1.0 are out of the active fleet.
 */
export const asPatchSnapshotIfTypeShadowed = (op: Operation): Operation => {
  const optionalFields = PATCH_SNAPSHOT_OPTIONAL_FIELDS[op.entityType];
  const payload = op.payload;
  if (
    !optionalFields ||
    !isLwwUpdatePayload(payload) ||
    payload.lwwUpdateMode !== 'replace' ||
    payload.recreatesEntityAfterDelete === true
  ) {
    return op;
  }
  const clearedFields = optionalFields.filter(
    (field) => payload.actionPayload[field] === undefined,
  );
  return {
    ...op,
    payload: {
      ...payload,
      lwwUpdateMode: 'patch',
      ...(clearedFields.length > 0 ? { clearedFields } : {}),
    },
  };
};
