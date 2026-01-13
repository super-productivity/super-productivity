/**
 * Vector Clock types and comparison functions for distributed synchronization.
 *
 * A vector clock is a data structure used to determine the partial ordering of events
 * in a distributed system and detect causality violations.
 *
 * Each process/device maintains its own component in the vector, incrementing it
 * on local updates. This allows us to determine if two states are:
 * - EQUAL: Same vector values
 * - LESS_THAN: A happened before B
 * - GREATER_THAN: B happened before A
 * - CONCURRENT: Neither happened before the other (true conflict)
 *
 * IMPORTANT: This module is shared between client and server.
 * Any changes must be compatible with both environments.
 */

/**
 * Vector clock data structure.
 * Maps client IDs to their respective clock values.
 */
export interface VectorClock {
  [clientId: string]: number;
}

/**
 * Result of comparing two vector clocks.
 */
export type VectorClockComparison = 'EQUAL' | 'LESS_THAN' | 'GREATER_THAN' | 'CONCURRENT';

/**
 * Compare two vector clocks to determine their relationship.
 *
 * CRITICAL: This algorithm must produce identical results on client and server.
 * Both implementations import from this shared module to ensure consistency.
 *
 * @param a First vector clock
 * @param b Second vector clock
 * @returns The comparison result
 */
export const compareVectorClocks = (
  a: VectorClock,
  b: VectorClock,
): VectorClockComparison => {
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);

  let aGreater = false;
  let bGreater = false;

  for (const key of allKeys) {
    const aVal = a[key] ?? 0;
    const bVal = b[key] ?? 0;

    if (aVal > bVal) aGreater = true;
    if (bVal > aVal) bGreater = true;
  }

  if (aGreater && bGreater) return 'CONCURRENT';
  if (aGreater) return 'GREATER_THAN';
  if (bGreater) return 'LESS_THAN';
  return 'EQUAL';
};

/**
 * Merge two vector clocks, taking the maximum value for each client.
 * Creates a new clock that dominates both inputs.
 *
 * @param a First vector clock
 * @param b Second vector clock
 * @returns A new merged vector clock
 */
export const mergeVectorClocks = (a: VectorClock, b: VectorClock): VectorClock => {
  const merged: VectorClock = { ...a };

  for (const [key, value] of Object.entries(b)) {
    merged[key] = Math.max(merged[key] ?? 0, value);
  }

  return merged;
};
