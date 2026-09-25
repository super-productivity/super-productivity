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

/**
 * Generates a deterministic ID for a subtask of a repeatable task instance.
 *
 * Same reasoning as getRepeatableTaskId, applied one level down: instance
 * creation must be idempotent for the WHOLE instance, not just its parent.
 * With random IDs, any second run for the same (cfg, day) — a local race
 * between the day-change and wait-for-completion creation paths, or two
 * devices creating the instance before syncing — appends a second full set of
 * subtasks to the one deduped parent (#9728). Subtask Creates carry disjoint
 * entity IDs, so conflict resolution cannot collapse them after the fact.
 *
 * The index is the template's position in `taskRepeatCfg.subTaskTemplates`,
 * which both devices read from the same synced config. Concurrent edits to the
 * template list can briefly make the orders disagree; that is a far narrower
 * window than the unconditional duplication it replaces.
 *
 * @param parentTaskId - The instance's parent task ID (from getRepeatableTaskId)
 * @param index - The subtask template's index in subTaskTemplates
 */
export const getRepeatableSubTaskId = (parentTaskId: string, index: number): string =>
  `${parentTaskId}_sub_${index}`;
