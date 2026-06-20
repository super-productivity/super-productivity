/**
 * Internal Plainspace issue shape used across the SP provider.
 *
 * The real Plainspace integration API returns an `SPTask`
 * (`GET {host}/api/integration/tasks`, see docs/plainspace-api-extension-plan.md).
 * `PlainspaceApiService` maps that DTO to this shape, so the rest of the
 * provider depends on one stable interface and the wire format stays isolated to
 * the API service.
 */
export type PlainspaceIssue = Readonly<{
  id: string;
  title: string;
  isDone: boolean;
  /** ISO timestamp; used for poll-based update detection. */
  updatedAt: string;
  /** Absolute link to open the task in the Plainspace web UI. */
  url: string | null;
  /** Remote Plainspace project/space id — used to scope tasks to a provider. */
  projectId: string;
  /**
   * ISO instant the task is scheduled for (Plainspace `scheduledAt`), or null
   * when unscheduled. Maps to SP's `task.dueWithTime`. For recurring Plainspace
   * items this is the *next* occurrence — the server advances it, SP just tracks
   * it.
   */
  scheduledAt: string | null;
  /**
   * Whether the task repeats in Plainspace. The cadence stays Plainspace-side;
   * SP only carries the yes/no to flag recurrence.
   */
  isRecurring: boolean;
}>;
