/**
 * The connected Plainspace account: the personal API token (PAT) plus the host
 * it was validated against, and the email it belongs to. Stored local-only (per
 * device), never synced. Used by the share-on-create flow to provision a space
 * before any provider exists, and to avoid re-entering the token.
 */
export interface PlainspaceAccount {
  host: string;
  /** Personal API token (`pat_…`). */
  token: string;
  email: string;
}
