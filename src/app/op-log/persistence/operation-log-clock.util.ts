import { VectorClock } from '../core/operation.types';

/**
 * Derive a local counter from the durable clock in the append transaction, so
 * a stale per-tab cache cannot reuse a counter (#8939). This does not prune
 * outgoing operations; callers bound storage clocks separately when needed.
 */
export const rebaseLocalClockOnDurable = (
  durableClock: VectorClock,
  proposedClock: VectorClock,
  clientId: string,
): VectorClock => {
  const merged: VectorClock = { ...durableClock };
  for (const [id, counter] of Object.entries(proposedClock)) {
    merged[id] = Math.max(merged[id] ?? 0, counter);
  }
  merged[clientId] = Math.max(
    (durableClock[clientId] ?? 0) + 1,
    proposedClock[clientId] ?? 0,
  );
  return merged;
};
