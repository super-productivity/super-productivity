import { Operation } from '../operation.types';

/**
 * Result of applying operations to the NgRx store.
 *
 * This allows callers to handle partial success scenarios where some operations
 * were applied before an error occurred.
 */
export interface ApplyOperationsResult {
  /**
   * Operations that were successfully applied to the NgRx store.
   * These ops have already been dispatched and should be marked as applied.
   */
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

/**
 * Options for applying operations to the NgRx store.
 */
export interface ApplyOperationsOptions {
  /**
   * When true, skip archive handling (already persisted from original execution).
   * Use ONLY for local hydration where operations are replaying
   * previously validated local operations from SUP_OPS.
   */
  isLocalHydration?: boolean;
}
