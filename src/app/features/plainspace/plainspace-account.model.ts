/**
 * The signed-in Plainspace identity. Defines "me" for the assigned-to-me /
 * assigned-to-others split. Stored local-only (per device), never synced.
 * See docs/plainspace-integration-plan.md §3.3.
 */
export interface PlainspaceAccount {
  host: string;
  userId: string;
  displayName: string;
  /** Bearer token (mock value in the prototype). */
  token: string;
}
