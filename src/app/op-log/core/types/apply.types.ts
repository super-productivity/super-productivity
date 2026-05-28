// App-narrowed apply types. The lib's @sp/sync-core ships generic versions; the
// app uses its own Operation type so callers see the SP-narrowed entityType /
// actionType unions and the syncImportReason field.

import type { Operation } from '../operation.types';

export interface ApplyOperationsResult {
  /** Operations that were successfully applied. */
  appliedOps: Operation[];
  failedOp?: {
    op: Operation;
    error: Error;
  };
}

export interface ApplyOperationsOptions {
  /**
   * When true, skip side effects that would normally fire on first application
   * (e.g. writing to archive storage) — used when replaying already-persisted
   * local operations during hydration.
   */
  isLocalHydration?: boolean;

  /**
   * When true, the caller will flush deferred local actions after finishing its
   * own crash-safety bookkeeping, such as marking remote ops applied and merging
   * their vector clocks.
   */
  skipDeferredLocalActions?: boolean;
}
