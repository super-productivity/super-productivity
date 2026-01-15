import { TimeTrackingState, TTWorkContextSessionMap } from './time-tracking.model';

/**
 * Merges time tracking data from three sources: current state, archiveYoung, and archiveOld.
 *
 * This function is used during data import/sync to reconstruct complete time tracking
 * history by combining data from the active state and both archive tiers.
 *
 * ## Merge Priority (highest to lowest):
 * 1. **current** - Active time tracking state (most recent data)
 * 2. **archiveYoung** - Recently archived data (< 21 days old)
 * 3. **archiveOld** - Older archived data (>= 21 days old)
 *
 * ## Deep Merge Behavior:
 * - Merges at the field level within each context/date entry
 * - If current has `{s: 100}` and archiveOld has `{e: 200}`, result is `{s: 100, e: 200}`
 * - When same field exists in multiple sources, higher priority source wins
 *
 * ## Performance:
 * - O(n*m) where n = number of contexts, m = average dates per context
 * - Use sparingly for large datasets
 *
 * @param current - Active TimeTrackingState from NgRx store
 * @param archiveYoung - TimeTrackingState from archiveYoung (recently archived)
 * @param archiveOld - TimeTrackingState from archiveOld (older archived)
 * @returns Merged TimeTrackingState with data from all three sources
 *
 * @example
 * ```typescript
 * const merged = mergeTimeTrackingStates({
 *   current: { project: { 'p1': { '2024-01-15': { s: 100 } } }, tag: {} },
 *   archiveYoung: { project: { 'p1': { '2024-01-14': { s: 50 } } }, tag: {} },
 *   archiveOld: { project: {}, tag: {} },
 * });
 * // Result: { project: { 'p1': { '2024-01-14': { s: 50 }, '2024-01-15': { s: 100 } } }, tag: {} }
 * ```
 */
export const mergeTimeTrackingStates = ({
  current,
  archiveYoung,
  archiveOld,
}: {
  current: TimeTrackingState;
  archiveYoung: TimeTrackingState;
  archiveOld: TimeTrackingState;
}): TimeTrackingState => {
  return {
    project: mergeTimeTrackingStatesForWorkContext({
      current: current.project,
      archiveYoung: archiveYoung.project,
      archiveOld: archiveOld.project,
    }),
    tag: mergeTimeTrackingStatesForWorkContext({
      current: current.tag,
      archiveYoung: archiveYoung.tag,
      archiveOld: archiveOld.tag,
    }),
    // lastFlush: current.lastFlush,
    // task: current.task,
  };
};

/**
 * Merges time tracking data for a single work context category (project or tag).
 *
 * This is the core merge algorithm that combines data from three archive tiers.
 * Called by `mergeTimeTrackingStates()` for both project and tag categories.
 *
 * ## Algorithm:
 * 1. Collect all unique context IDs from all three sources
 * 2. For each context, collect all unique dates
 * 3. For each date, spread-merge data with priority order
 *
 * ## Merge Priority (applied via spread operator):
 * ```typescript
 * const merged = { ...archiveOld, ...archiveYoung, ...current };
 * ```
 * Later spreads override earlier ones, so current > archiveYoung > archiveOld.
 *
 * ## Null/Undefined Safety:
 * - Handles null/undefined sources gracefully via `|| {}` fallbacks
 * - Empty contexts and dates are filtered out (not added to result)
 *
 * ## Performance Complexity:
 * - O(c * d * f) where:
 *   - c = total unique context IDs across all sources
 *   - d = average unique dates per context
 *   - f = fields per date entry (typically 4: s, e, b, bt)
 *
 * @param current - Map of contextId -> dateStr -> TTWorkContextData from active state
 * @param archiveYoung - Map from archiveYoung (recently archived)
 * @param archiveOld - Map from archiveOld (older archived)
 * @returns Merged TTWorkContextSessionMap with all context/date combinations
 *
 * @example
 * ```typescript
 * const merged = mergeTimeTrackingStatesForWorkContext({
 *   current: { 'proj-1': { '2024-01-15': { s: 100 } } },
 *   archiveYoung: { 'proj-1': { '2024-01-15': { e: 200 } } }, // Same date, different field
 *   archiveOld: { 'proj-2': { '2024-01-10': { s: 50, e: 100 } } }, // Different context
 * });
 * // Result: {
 * //   'proj-1': { '2024-01-15': { s: 100, e: 200 } }, // Fields merged
 * //   'proj-2': { '2024-01-10': { s: 50, e: 100 } },  // From archiveOld
 * // }
 * ```
 */
export const mergeTimeTrackingStatesForWorkContext = ({
  current,
  archiveYoung,
  archiveOld,
}: {
  current: TTWorkContextSessionMap;
  archiveYoung: TTWorkContextSessionMap;
  archiveOld: TTWorkContextSessionMap;
}): TTWorkContextSessionMap => {
  const result: TTWorkContextSessionMap = {};

  // Get all unique work context IDs from all three sources
  const allContextIds = new Set([
    ...Object.keys(archiveOld || {}),
    ...Object.keys(archiveYoung || {}),
    ...Object.keys(current || {}),
  ]);

  // For each work context ID
  for (const contextId of allContextIds) {
    const archiveOldDates = archiveOld?.[contextId] || {};
    const archiveYoungDates = archiveYoung?.[contextId] || {};
    const currentDates = current?.[contextId] || {};

    // Get all unique dates for this context
    const allDates = Array.from(
      new Set([
        ...Object.keys(archiveOldDates),
        ...Object.keys(archiveYoungDates),
        ...Object.keys(currentDates),
      ]),
    );

    if (allDates.length === 0) {
      continue;
    }

    for (const date of allDates) {
      const newData = {
        // Merge in order of priority: current > archiveYoung > archiveOld
        ...archiveOldDates[date],
        ...archiveYoungDates[date],
        ...currentDates[date],
      };
      if (Object.keys(newData).length > 0) {
        if (!result[contextId]) {
          result[contextId] = {};
        }
        result[contextId][date] = newData;
      }
    }
  }
  return result;
};
