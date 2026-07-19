// App-narrowed apply types. The lib's @sp/sync-core ships generic versions; the
// app uses its own Operation type so callers see the SP-narrowed entityType /
// actionType unions and the syncImportReason field.

import type { Operation } from '../operation.types';

export interface ApplyOperationsResult {
  /** Operations that were successfully applied. */
  appliedOps: Operation[];
  /** Operations skipped because conversion or reducer application threw. */
  reducerFailures?: Array<{
    op: Operation;
    error: Error;
  }>;
  /**
   * First op whose archive side effect threw. Its reducer effect (and that of
   * every reducer-successful op after it) DID commit before archive handling,
   * so retry paths must pass `skipReducerDispatch`.
   */
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

  /**
   * The caller already owns the remote-apply window and will close it after a
   * larger multi-pass replay. The applier must not create a gap between passes.
   */
  remoteApplyWindowAlreadyOpen?: boolean;

  /**
   * When true, skip the bulk reducer dispatch and run only the archive side
   * effects. Used to retry ops marked `failed`, whose reducer effects already
   * committed (see `ApplyOperationsResult.failedOp`): re-dispatching would
   * double-apply additive reducers such as syncTimeSpent or
   * increaseSimpleCounterCounterToday.
   */
  skipReducerDispatch?: boolean;

  /**
   * Called after the bulk reducer dispatch commits and before archive side effects.
   * Remote apply uses this to persist its reducer/archive checkpoint and merge the
   * causal frontier before deferred local actions can be written.
   */
  onReducersCommitted?: (
    ops: Operation[],
    failures?: NonNullable<ApplyOperationsResult['reducerFailures']>,
  ) => Promise<void>;
}
