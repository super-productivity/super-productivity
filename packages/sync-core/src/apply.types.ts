import { Operation } from './operation.types';

/**
 * Result of applying a batch of operations.
 *
 * Allows callers to handle partial success scenarios where some operations
 * were applied before an error occurred.
 */
export interface ApplyOperationsResult {
  /** Operations that were successfully applied. */
  appliedOps: Operation[];

  /**
   * If an error occurred, this contains the failed operation and the error.
   * Operations after this one in the batch were NOT applied.
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
}
