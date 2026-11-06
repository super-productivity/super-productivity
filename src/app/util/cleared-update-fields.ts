/**
 * Clearing an entity field via an NgRx update dispatches
 * `changes: { someField: undefined }`. That works locally (and in the
 * IndexedDB op-log, which structured-clones the payload), but every JSON
 * serialization of the op — SuperSync HTTP/E2EE, file-based sync providers,
 * the SQLite op-log — drops undefined-valued keys entirely, so the clear
 * replays as a no-op on other devices (issue #9776).
 *
 * Fix pattern: the action creator lists the cleared keys out-of-band via
 * {@link clearedFieldsProps} (a plain string[] survives JSON), and the reducer
 * restores them with {@link applyClearedFields} before handing the changes to
 * the entity adapter. Older clients simply ignore the extra `clearedFields`
 * action prop, so the clear degrades to today's no-op instead of corrupting
 * their state (see sync rule 10 — no schema bump needed).
 */

/**
 * Returns the optional `clearedFields` action prop for an update's changes:
 * the keys whose value is `undefined`, or no prop at all when there are none.
 */
export const clearedFieldsProps = <T extends object>(
  changes: Partial<T>,
): { clearedFields?: (keyof T & string)[] } => {
  const cleared = (Object.keys(changes) as (keyof T & string)[]).filter(
    (key) => changes[key] === undefined,
  );
  return cleared.length ? { clearedFields: cleared } : {};
};

/**
 * Every real cleared field is a model property name; anything else in a wire
 * `clearedFields` is junk or hostile. Without this gate a corrupt list from a
 * plaintext file-based provider injects arbitrary undefined-valued own keys
 * onto the entity — typia tolerates excess props, so they persist, re-upload,
 * and get re-listed by `clearedFieldsProps`, amplifying forever.
 */
const CLEARED_FIELD_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const MAX_CLEARED_FIELDS = 32;

/**
 * Restores `undefined` for the keys listed in `clearedFields` (idempotent for
 * local dispatches, where the keys are still present in `changes`).
 * `clearedFields` may come off the wire, so tolerate junk: non-arrays and
 * non-identifier keys are ignored, the list is capped, and `id` is skipped
 * because clearing it would re-key the entity in the adapter — entity ids are
 * never cleared through updates.
 */
export const applyClearedFields = <T extends object>(
  changes: Partial<T>,
  clearedFields?: readonly (keyof T & string)[],
): Partial<T> => {
  if (!Array.isArray(clearedFields) || clearedFields.length === 0) {
    return changes;
  }
  const restored: Partial<T> = { ...changes };
  for (const key of clearedFields.slice(0, MAX_CLEARED_FIELDS)) {
    if (typeof key !== 'string' || key === 'id' || !CLEARED_FIELD_KEY_PATTERN.test(key)) {
      continue;
    }
    restored[key] = undefined;
  }
  return restored;
};
