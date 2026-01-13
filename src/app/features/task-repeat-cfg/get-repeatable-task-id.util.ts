import { isDBDateStr } from '../../util/get-db-date-str';

/**
 * Generates a deterministic task ID for repeatable tasks.
 *
 * This ensures that if two clients create a task for the same repeat config
 * and due day simultaneously, they both generate the same task ID.
 * Conflict resolution then works correctly instead of creating duplicates.
 *
 * Note: The dueDay is in LOCAL timezone (YYYY-MM-DD format). This is intentional
 * because repeat tasks are scheduled based on the user's local day (e.g., "every Monday"
 * means Monday in the user's timezone). Clients in the same timezone will generate
 * the same ID; clients in different timezones may generate different IDs for the
 * same UTC moment, which is correct behavior.
 *
 * @param repeatCfgId - The ID of the task repeat configuration (must be non-empty)
 * @param dueDay - The due day in YYYY-MM-DD format (local timezone)
 * @returns A deterministic task ID (e.g., "rpt_abc123xyz_2025-01-15")
 * @throws Error if inputs are invalid
 */
export const getRepeatableTaskId = (repeatCfgId: string, dueDay: string): string => {
  if (!repeatCfgId || typeof repeatCfgId !== 'string') {
    throw new Error(
      `getRepeatableTaskId: repeatCfgId must be a non-empty string, got: ${repeatCfgId}`,
    );
  }
  if (!dueDay || !isDBDateStr(dueDay)) {
    throw new Error(
      `getRepeatableTaskId: dueDay must be in YYYY-MM-DD format, got: "${dueDay}"`,
    );
  }
  return `rpt_${repeatCfgId}_${dueDay}`;
};
