/**
 * The view-model for an unclaimed Plainspace task shown in the claim pool.
 *
 * These are deliberately NOT Super Productivity `Task`s: unclaimed tasks are
 * shown read-only and never enter the SP task store / op-log sync until claimed.
 * Mapped from `PlainspaceIssue` (the API shape) in `PlainspaceClaimPoolService`.
 */
export interface PlainspaceSharedTask {
  id: string;
  title: string;
  isDone: boolean;
  /** Absolute link to open the task in the Plainspace web UI. */
  url?: string | null;
  /** Repeats in Plainspace — flagged in the pool so claiming a recurring
   * commitment is visible up front. The cadence stays Plainspace-side. */
  isRecurring: boolean;
}
