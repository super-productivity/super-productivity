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
 */
export const MAX_VECTOR_CLOCK_SIZE = 10;

/**
 * Compare two vector clocks to determine their relationship.
 *
 * CRITICAL: This algorithm must produce identical results on client and server.
 * Both implementations import from this shared module to ensure consistency.
 *
 * Pruning-aware mode: When both clocks are at MAX_VECTOR_CLOCK_SIZE, they may
 * have been pruned by different clients (each preserving its own clientId).
 * Missing keys could mean "pruned away" rather than "genuinely zero". Comparing
 * only shared keys avoids false CONCURRENT from cross-client pruning asymmetry.
 * To avoid false dominance, if the side that appears behind on shared keys has
 * any non-shared keys, we conservatively return CONCURRENT.
 *
 * Known limitation: A clock that naturally grew to exactly MAX_VECTOR_CLOCK_SIZE
 * entries (without pruning) is indistinguishable from a pruned clock. In that case,
 * missing keys genuinely mean "never seen" but are treated as "possibly pruned".
 * This could produce LESS_THAN/GREATER_THAN instead of CONCURRENT when one clock
 * was pruned and the other naturally reached MAX size. This is accepted as a pragmatic
 * tradeoff — it requires exactly MAX_VECTOR_CLOCK_SIZE active clients, which is
 * unlikely for a personal productivity app.
 *
 * @param a First vector clock
 * @param b Second vector clock
 * @returns The comparison result
 */
export const compareVectorClocks = (
  a: VectorClock,
  b: VectorClock,
): VectorClockComparison => {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);

  // When both clocks are at MAX_VECTOR_CLOCK_SIZE, they may have been pruned
  // by different clients (each preserving its own clientId). Missing keys could
  // mean "pruned away" rather than "genuinely zero". Comparing only shared keys
  // avoids false CONCURRENT from cross-client pruning asymmetry.
  const bothPossiblyPruned =
    aKeys.length >= MAX_VECTOR_CLOCK_SIZE && bKeys.length >= MAX_VECTOR_CLOCK_SIZE;

  let keysToCompare: Set<string>;
  let aOnlyCount = 0;
  let bOnlyCount = 0;
  if (bothPossiblyPruned) {
    const bKeySet = new Set(bKeys);
    keysToCompare = new Set(aKeys.filter((k) => bKeySet.has(k)));
    // If no shared keys at all, clocks are from independent client populations → CONCURRENT
    if (keysToCompare.size === 0) return 'CONCURRENT';
    aOnlyCount = aKeys.length - keysToCompare.size;
    bOnlyCount = bKeys.length - keysToCompare.size;
  } else {
    keysToCompare = new Set([...aKeys, ...bKeys]);
  }

  let aGreater = false;
  let bGreater = false;

  for (const key of keysToCompare) {
    const aVal = a[key] ?? 0;
    const bVal = b[key] ?? 0;

    if (aVal > bVal) aGreater = true;
    if (bVal > aVal) bGreater = true;
  }

  if (aGreater && bGreater) return 'CONCURRENT';
  if (bothPossiblyPruned && aGreater && bOnlyCount > 0) return 'CONCURRENT';
  if (bothPossiblyPruned && bGreater && aOnlyCount > 0) return 'CONCURRENT';
  if (aGreater) return 'GREATER_THAN';
  if (bGreater) return 'LESS_THAN';

  // In pruning-aware mode, if shared keys are equal but either side has
  // non-shared keys, the clocks may have genuinely different causal histories.
  // Returning EQUAL would cause silent data loss (skip as duplicate).
  // Returning CONCURRENT triggers LWW conflict resolution (safe direction).
  if (bothPossiblyPruned && (aOnlyCount > 0 || bOnlyCount > 0)) return 'CONCURRENT';
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
 * Used by both client (when creating ops) and server (when storing ops).
 *
 * @param clock The vector clock to limit
 * @param preserveClientIds Client IDs to always keep (e.g., current client, protected IDs)
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

  // Sort by value descending to keep most active clients
  entries.sort(([, a], [, b]) => b - a);

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
