/**
 * A promise-chain serializer for a single shared resource.
 *
 * One SQLite connection has exactly ONE transaction context, so when two
 * services share one connection (the native op-log backend) their
 * `transaction()`s — and any stray standalone statement — MUST NOT interleave,
 * or a second `BEGIN` throws "transaction within a transaction". This builds a
 * tail-chained queue: each submitted `fn` runs only after every previously
 * submitted one has settled. The tail advances to a never-rejecting settle, so
 * one failed task can neither wedge the queue nor leak its rejection to the next
 * caller.
 *
 * Shared by {@link CapacitorSqliteDb} (production) and the spec test doubles, so
 * the tests exercise the exact serialization the device uses rather than a
 * hand-copied twin.
 */

/** Runs `fn` exclusively against the serialized resource. */
export type RunExclusive = <T>(fn: () => Promise<T>) => Promise<T>;

export const createConnectionSerializer = (): RunExclusive => {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    // Run `fn` after whatever is queued (regardless of its outcome), and advance
    // the tail to a never-rejecting settle.
    const result = tail.then(fn, fn);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
};
