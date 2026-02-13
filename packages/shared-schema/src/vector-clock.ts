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
 * Maximum number of entries in a vector clock.
 * Shared between client and server to ensure consistent pruning.
 *
 * At 6-char client IDs, a 20-entry clock is ~333 bytes — negligible bandwidth.
 * A user needs 21+ unique client IDs (reinstalls/new browsers) before pruning
 * triggers, which is extremely unlikely for a personal productivity app.
 */
export const MAX_VECTOR_CLOCK_SIZE = 20;

/**
 * Compare two vector clocks to determine their relationship.
 *
 * CRITICAL: This algorithm must produce identical results on client and server.
 * Both implementations import from this shared module to ensure consistency.
 *
 * Standard vector clock comparison: missing keys mean "genuinely zero".
 * With MAX_VECTOR_CLOCK_SIZE=20, pruning is extremely rare (needs 21+ unique
 * client IDs), so pruning-aware comparison is unnecessary.
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
    if (aGreater && bGreater) return 'CONCURRENT';
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

/**
 * Limits vector clock size by keeping only the most active clients.
 * Used by the server (when storing ops after comparison) and the client.
 *
 * @param clock The vector clock to limit
 * @param preserveClientIds Client IDs to always keep (e.g., current client)
 * @returns A clock with at most MAX_VECTOR_CLOCK_SIZE entries
 */
export const limitVectorClockSize = (
  clock: VectorClock,
  preserveClientIds: string[] = [],
): VectorClock => {
  const entries = Object.entries(clock);
  if (entries.length <= MAX_VECTOR_CLOCK_SIZE) {
    return clock;
  }

  const alwaysPreserve = new Set(preserveClientIds);

  // Sort by value descending to keep most active clients.
  // Secondary sort by client ID for deterministic tie-breaking when values are equal.
  entries.sort(
    ([keyA, a], [keyB, b]) => b - a || (keyA < keyB ? -1 : keyA > keyB ? 1 : 0),
  );

  const limited: VectorClock = {};

  // Add preserved IDs first, but cap at MAX_VECTOR_CLOCK_SIZE.
  // If preserveClientIds itself exceeds MAX, only the first MAX are kept.
  let count = 0;
  for (const id of alwaysPreserve) {
    if (clock[id] !== undefined && count < MAX_VECTOR_CLOCK_SIZE) {
      limited[id] = clock[id];
      count++;
    }
  }

  // Fill remaining slots with most active non-preserved clients
  for (const [clientId, value] of entries) {
    if (count >= MAX_VECTOR_CLOCK_SIZE) break;
    if (!alwaysPreserve.has(clientId)) {
      limited[clientId] = value;
      count++;
    }
  }

  return limited;
};
