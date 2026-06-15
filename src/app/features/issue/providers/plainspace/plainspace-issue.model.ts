/**
 * Plainspace API issue shapes (assumed contract — see
 * docs/plainspace-integration-plan.md §3.2). Kept isolated so the real API can
 * be wired in by changing only this file + `PlainspaceApiService`.
 */

export interface PlainspaceIssueAssignee {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

export type PlainspaceIssue = Readonly<{
  id: string;
  title: string;
  isDone: boolean;
  /** null = unassigned. */
  assigneeId: string | null;
  assignee: PlainspaceIssueAssignee | null;
  /** ISO timestamp; used for poll-based update detection. */
  updatedAt: string;
  url: string | null;
}>;
