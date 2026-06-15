/**
 * The signed-in Plainspace identity. Defines "me" — which space tasks are mine
 * (imported as SP tasks) vs unclaimed (the claim pool). Stored local-only (per
 * device), never synced. See docs/plainspace-integration-plan.md §3.3.
 */
export interface PlainspaceAccount {
  host: string;
  userId: string;
  displayName: string;
  /** Bearer token (mock value in the prototype). */
  token: string;
}
