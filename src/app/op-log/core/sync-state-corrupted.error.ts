/**
 * Error thrown when the sync state is corrupted and a full re-sync is required.
 *
 * ## Design Philosophy: Fail Fast, Re-sync Clean
 *
 * When an operation cannot be applied due to missing dependencies, rather than
 * attempting complex retry logic with queues, we fail immediately and signal
 * that a full re-sync is needed.
 *
 * ### Why This Approach?
 *
 * 1. **Simplicity**: No retry queues, no failed operation tracking, no pruning logic
 * 2. **Correctness**: A full re-sync guarantees consistent state
 * 3. **Debuggability**: Clear error with context about what went wrong
 * 4. **User Experience**: Better to re-sync cleanly than live with subtle inconsistencies
 *
 * ### When Is This Thrown?
 *
 * - When applying remote operations and a hard dependency is missing
 * - This indicates either:
 *   - Operations arrived out of order (protocol issue)
 *   - Local state is corrupted
 *   - A bug in dependency tracking
 *
 * ### How Should Callers Handle This?
 *
 * The caller (OperationLogSyncService) catches this error, marks the operations
 * as failed, and should trigger a full re-sync to restore consistent state.
 */
export class SyncStateCorruptedError extends Error {
  constructor(
    message: string,
    public readonly context: {
      opId: string;
      actionType: string;
      missingDependencies: string[];
    },
  ) {
    super(message);
    this.name = 'SyncStateCorruptedError';

    // Maintains proper stack trace for where error was thrown (V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SyncStateCorruptedError);
    }
  }
}
