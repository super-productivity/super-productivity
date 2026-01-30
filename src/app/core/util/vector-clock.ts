import { PFLog } from '../log';
import {
  VectorClock as SharedVectorClock,
  compareVectorClocks as sharedCompareVectorClocks,
  mergeVectorClocks as sharedMergeVectorClocks,
} from '@sp/shared-schema';
import {
  MAX_VECTOR_CLOCK_SIZE,
  MIN_CLIENT_ID_LENGTH,
} from '../../op-log/core/operation-log.const';

/**
 * Vector Clock implementation for distributed synchronization
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
 * IMPORTANT: Core comparison logic is shared with the server via @sp/shared-schema.
 * This file wraps the shared logic with null handling for client-side use.
 */

/**
 * Vector clock data structure
 * Maps client IDs to their respective clock values
 */
export type VectorClock = SharedVectorClock;

/**
 * Result of comparing two vector clocks.
 * Uses enum for client-side ergonomics, values match shared string literals.
 */
export enum VectorClockComparison {
  EQUAL = 'EQUAL',
  LESS_THAN = 'LESS_THAN',
  GREATER_THAN = 'GREATER_THAN',
  CONCURRENT = 'CONCURRENT',
}

/**
 * Initialize a new vector clock for a client
 * @param clientId The client's unique identifier
 * @param initialValue Optional initial value (defaults to 0)
 * @returns A new vector clock
 */
export const initializeVectorClock = (
  clientId: string,
  initialValue: number = 0,
): VectorClock => {
  return { [clientId]: initialValue };
};

/**
 * Check if a vector clock is empty or uninitialized
 * @param clock The vector clock to check
 * @returns True if the clock is null, undefined, or has no entries
 */
export const isVectorClockEmpty = (clock: VectorClock | null | undefined): boolean => {
  return !clock || Object.keys(clock).length === 0;
};

/**
 * Validates that a value is a valid VectorClock
 * @param clock The value to validate
 * @returns True if valid vector clock structure
 */
export const isValidVectorClock = (clock: any): clock is VectorClock => {
  if (!clock || typeof clock !== 'object') return false;

  // Check it's not an array or other non-plain object
  if (Array.isArray(clock) || clock.constructor !== Object) return false;

  // Validate all entries
  return Object.entries(clock).every(([key, value]) => {
    // Client ID must be non-empty string
    if (typeof key !== 'string' || key.length === 0) return false;

    // Value must be valid number
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;

    // Value must be non-negative and within safe range
    if (value < 0 || value > Number.MAX_SAFE_INTEGER) return false;

    return true;
  });
};

/**
 * Sanitizes a vector clock, removing invalid entries
 * @param clock The vector clock to sanitize
 * @returns A valid vector clock with invalid entries removed
 */
export const sanitizeVectorClock = (clock: any): VectorClock => {
  if (!clock || typeof clock !== 'object' || Array.isArray(clock)) return {};

  const sanitized: VectorClock = {};

  try {
    for (const [key, value] of Object.entries(clock)) {
      if (
        typeof key === 'string' &&
        key.length > 0 &&
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= Number.MAX_SAFE_INTEGER
      ) {
        sanitized[key] = value;
      }
    }
  } catch (e) {
    PFLog.error('Error sanitizing vector clock', e);
    return {};
  }

  return sanitized;
};

/**
 * Compare two vector clocks to determine their relationship.
 *
 * Uses the shared implementation from @sp/shared-schema to ensure
 * client and server produce identical results. This wrapper adds
 * null/undefined handling for client-side convenience.
 *
 * @param a First vector clock
 * @param b Second vector clock
 * @returns The comparison result
 */
export const compareVectorClocks = (
  a: VectorClock | null | undefined,
  b: VectorClock | null | undefined,
): VectorClockComparison => {
  // Handle null/undefined cases (shared implementation requires non-null)
  if (isVectorClockEmpty(a) && isVectorClockEmpty(b)) {
    return VectorClockComparison.EQUAL;
  }
  if (isVectorClockEmpty(a)) {
    return VectorClockComparison.LESS_THAN;
  }
  if (isVectorClockEmpty(b)) {
    return VectorClockComparison.GREATER_THAN;
  }

  // Delegate to shared implementation and convert string result to enum
  const result = sharedCompareVectorClocks(a!, b!);
  return VectorClockComparison[result];
};

/**
 * Increment a client's component in the vector clock
 * Creates a new vector clock with the incremented value
 *
 * @param clock The current vector clock
 * @param clientId The client ID to increment
 * @returns A new vector clock with the incremented value
 */
export const incrementVectorClock = (
  clock: VectorClock | null | undefined,
  clientId: string,
): VectorClock => {
  if (
    !clientId ||
    typeof clientId !== 'string' ||
    clientId.length < MIN_CLIENT_ID_LENGTH
  ) {
    PFLog.critical('incrementVectorClock: Invalid clientId', {
      clientId,
      type: typeof clientId,
      length: clientId?.length,
      stackTrace: new Error().stack,
    });
    throw new Error(`Invalid clientId for vector clock increment: ${clientId}`);
  }

  const newClock = { ...(clock || {}) };
  const currentValue = newClock[clientId] || 0;

  // Log for debugging
  PFLog.verbose('incrementVectorClock', {
    clientId,
    currentValue,
    allClients: Object.keys(newClock),
  });

  // Handle overflow - throw error instead of silently resetting
  // Resetting to 1 would break causality (new ops appear older than previous ops)
  // User must do a SYNC_IMPORT to properly reset clocks across all clients
  if (currentValue >= Number.MAX_SAFE_INTEGER - 1000) {
    PFLog.critical('Vector clock component overflow detected', {
      clientId,
      currentValue,
    });
    throw new Error(
      'Vector clock overflow detected. A full sync reset (SYNC_IMPORT) is required. ' +
        'This is extremely rare and indicates very long-term usage.',
    );
  }

  newClock[clientId] = currentValue + 1;

  return newClock;
};

/**
 * Merge two vector clocks by taking the maximum value for each component.
 *
 * Uses the shared implementation from @sp/shared-schema to ensure
 * client and server produce identical results. This wrapper adds
 * null/undefined handling for client-side convenience.
 *
 * @param a First vector clock
 * @param b Second vector clock
 * @returns A new merged vector clock
 */
export const mergeVectorClocks = (
  a: VectorClock | null | undefined,
  b: VectorClock | null | undefined,
): VectorClock => {
  // Handle null/undefined cases (shared implementation requires non-null)
  if (isVectorClockEmpty(a)) return { ...(b || {}) };
  if (isVectorClockEmpty(b)) return { ...(a || {}) };

  // Delegate to shared implementation
  return sharedMergeVectorClocks(a!, b!);
};

/**
 * Get a human-readable string representation of a vector clock
 * Useful for debugging and logging
 *
 * @param clock The vector clock
 * @returns A string representation
 */
export const vectorClockToString = (clock: VectorClock | null | undefined): string => {
  if (isVectorClockEmpty(clock)) {
    return '{}';
  }

  const entries = Object.entries(clock!)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, val]) => `${id}:${val}`);

  return `{${entries.join(', ')}}`;
};

/**
 * Check if a vector clock has changes compared to a reference clock
 * Used to determine if local changes exist
 *
 * @param current The current vector clock
 * @param reference The reference vector clock (e.g., last synced)
 * @returns True if current has any components greater than reference OR if reference has clients missing from current
 */
export const hasVectorClockChanges = (
  current: VectorClock | null | undefined,
  reference: VectorClock | null | undefined,
): boolean => {
  if (isVectorClockEmpty(current)) {
    // If current is empty but reference has values, that's a change (reset/corruption)
    return !isVectorClockEmpty(reference);
  }
  if (isVectorClockEmpty(reference)) {
    return !isVectorClockEmpty(current);
  }

  // Check if any component in current is greater than in reference
  for (const [clientId, currentVal] of Object.entries(current!)) {
    const refVal = reference![clientId] || 0;
    if (currentVal > refVal) {
      return true;
    }
  }

  // CRITICAL FIX: Check if reference has any clients missing from current
  // This detects when a client's entry has been removed/corrupted
  for (const [clientId, refVal] of Object.entries(reference!)) {
    if (refVal > 0 && !(clientId in current!)) {
      PFLog.error('Vector clock change detected: client missing from current', {
        clientId,
        refValue: refVal,
        currentClock: vectorClockToString(current),
        referenceClock: vectorClockToString(reference),
      });
      return true;
    }
  }

  return false;
};

// MAX_VECTOR_CLOCK_SIZE imported from operation-log.const.ts

/**
 * Metrics for vector clock operations
 */
export interface VectorClockMetrics {
  size: number;
  comparisonTime: number;
  pruningOccurred: boolean;
}

/**
 * Limits the size of a vector clock by keeping only the most active clients
 * @param clock The vector clock to limit
 * @param currentClientId The current client's ID (always preserved)
 * @param protectedClientIds Additional client IDs to always preserve (e.g., from latest SYNC_IMPORT).
 *        These are kept even if they have low counter values, to ensure correct
 *        comparison with full-state operations.
 * @returns A vector clock with at most MAX_VECTOR_CLOCK_SIZE entries
 */
export const limitVectorClockSize = (
  clock: VectorClock,
  currentClientId: string,
  protectedClientIds: string[] = [],
): VectorClock => {
  const entries = Object.entries(clock);

  if (entries.length <= MAX_VECTOR_CLOCK_SIZE) {
    return clock;
  }

  // Build set of clients to always preserve
  const alwaysPreserve = new Set([currentClientId, ...protectedClientIds]);

  PFLog.warn('Vector clock pruning triggered', {
    originalSize: entries.length,
    maxSize: MAX_VECTOR_CLOCK_SIZE,
    currentClientId,
    protectedClientIds,
    pruned: entries.length - MAX_VECTOR_CLOCK_SIZE,
  });

  // Sort by value (descending) to keep most active clients
  entries.sort(([, a], [, b]) => b - a);

  // Always keep preserved clients first
  const limited: VectorClock = {};
  for (const id of alwaysPreserve) {
    if (clock[id] !== undefined) {
      limited[id] = clock[id];
    }
  }

  // Add top active non-preserved clients up to limit
  let count = Object.keys(limited).length;
  for (const [clientId, value] of entries) {
    if (!alwaysPreserve.has(clientId) && count < MAX_VECTOR_CLOCK_SIZE) {
      limited[clientId] = value;
      count++;
    }
  }

  return limited;
};

/**
 * Measures vector clock metrics for monitoring
 * @param clock The vector clock to measure
 * @returns Metrics about the vector clock
 */
export const measureVectorClock = (
  clock: VectorClock | null | undefined,
): VectorClockMetrics => {
  if (!clock) {
    return {
      size: 0,
      comparisonTime: 0,
      pruningOccurred: false,
    };
  }

  return {
    size: Object.keys(clock).length,
    comparisonTime: 0, // Will be set during comparison
    pruningOccurred: false,
  };
};
