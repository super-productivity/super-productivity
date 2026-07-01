/**
 * Generates a deterministic task ID from a Plainspace provider ID and issue ID.
 *
 * Plainspace auto-imports assigned tasks in the background on every device
 * (default `pollingMode: 'always'`), so two clients can import the same issue
 * within a single sync round-trip. Local dedup can't see the other client's
 * not-yet-synced task, so without a shared ID each would create its own task
 * with a random `nanoid()` and the op-log would keep both. A deterministic
 * natural-key ID makes those concurrent `addTask` ops collide on one entity id
 * and converge to a single task. Mirrors `generateCalendarTaskId`.
 *
 * Uses the raw inputs as a natural key — zero collision risk.
 */
export const generatePlainspaceTaskId = (
  issueProviderId: string,
  issueId: string,
): string => {
  return `ps_${issueProviderId}_${issueId}`;
};
