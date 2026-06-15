import { BaseIssueProviderCfg } from '../../issue.model';

/**
 * Per-instance config for the Plainspace (plainspace.org / `Johannesjo/spaces`)
 * issue provider. One instance is bound to one SP project (via the provider's
 * `defaultProjectId`) and one remote Plainspace space (`spaceId`).
 *
 * The auth token is NOT stored here — in the full design it lives with the
 * Plainspace account (see docs/plainspace-integration-plan.md §3.3) so a single
 * login covers every space. For the mock-backed prototype no token is needed.
 */
export interface PlainspaceCfg extends BaseIssueProviderCfg {
  host: string | null;
  spaceId: string | null;
  isAutoPoll?: boolean;
  isAutoAddToBacklog?: boolean;
}
