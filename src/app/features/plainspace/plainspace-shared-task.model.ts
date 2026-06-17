/**
 * Plainspace shared-task models.
 *
 * NOTE (prototype): these shapes are an *assumed* contract for the Plainspace
 * (plainspace.org / `Johannesjo/spaces`) API. They are intentionally isolated so
 * that, once the real API is known, only this file and the API service need to
 * change. See docs/plainspace-integration-plan.md.
 */

export interface PlainspaceMember {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

/**
 * A task that lives in a Plainspace "space" and is owned by another member.
 *
 * These are deliberately NOT Super Productivity `Task`s: tasks assigned to other
 * people are shown read-only and never enter the SP task store / op-log sync.
 */
export interface PlainspaceSharedTask {
  id: string;
  title: string;
  isDone: boolean;
  assignee: PlainspaceMember | null; // null = unassigned
  /** Absolute link to open the task in the Plainspace web UI. */
  url?: string | null;
  /** Repeats in Plainspace — flagged in the pool so claiming a recurring
   * commitment is visible up front. The cadence stays Plainspace-side. */
  isRecurring: boolean;
}
