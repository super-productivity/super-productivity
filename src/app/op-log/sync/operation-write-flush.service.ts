import { inject, Injectable } from '@angular/core';
import { LockService } from './lock.service';
import { OperationCaptureService } from '../capture/operation-capture.service';
import { OpLog } from '../../core/log';
import { LOCK_NAMES } from '../core/operation-log.const';

/**
 * Service to ensure all pending operation writes have completed.
 *
 * Used by sync to guarantee conflict detection sees all local operations.
 * This prevents race conditions where an action is dispatched but the
 * corresponding operation hasn't been written to IndexedDB yet.
 *
 * ## How it works
 *
 * ### Two-Phase Wait Strategy
 *
 * **Phase 1: Wait for the pending counter to reach 0**
 * The NgRx effect uses `concatMap` for sequential processing. The meta-reducer
 * increments OperationCaptureService's pending counter synchronously when it
 * captures an action; the effect decrements it (in a `finally`) after each write
 * attempt completes. We poll the counter until it reaches 0, meaning all
 * dispatched actions have been processed by the effect.
 *
 * **Phase 2: Acquire Write Lock**
 * Once the counter is drained, we acquire the same lock used by `writeOperation()`.
 * This ensures the final write has completed its IndexedDB transaction.
 *
 * This two-phase approach handles the case where many actions are dispatched rapidly
 * and the RxJS concatMap pipeline is still processing them.
 */
@Injectable({ providedIn: 'root' })
export class OperationWriteFlushService {
  private lockService = inject(LockService);
  private captureService = inject(OperationCaptureService);

  /**
   * Maximum time to wait for the queue to drain (ms).
   */
  private readonly MAX_WAIT_TIME = 30000;

  /**
   * Polling interval to check queue size (ms).
   */
  private readonly POLL_INTERVAL = 10;

  /**
   * Waits for all pending operation writes to complete.
   *
   * This is a two-phase wait:
   * 1. Poll the capture service pending counter until it's 0 (all actions
   *    processed by the effect)
   * 2. Acquire the write lock to ensure the final IndexedDB transaction is complete
   *
   * @returns Promise that resolves when all pending writes are complete
   * @throws Error if timeout is reached while waiting for the counter to drain
   */
  async flushPendingWrites(): Promise<void> {
    // Phase 1: Wait for the capture service pending counter to drain
    // This ensures all dispatched actions have been processed by the effect
    const startTime = Date.now();
    let lastLoggedCount = -1;
    const initialPendingCount = this.captureService.getPendingCount();
    OpLog.normal(
      `OperationWriteFlushService: Starting flush. Initial pending count: ${initialPendingCount}`,
    );

    while (this.captureService.getPendingCount() > 0) {
      const pendingCount = this.captureService.getPendingCount();

      // Log progress periodically (when pending count changes significantly)
      if (pendingCount !== lastLoggedCount && pendingCount % 10 === 0) {
        OpLog.verbose(
          `OperationWriteFlushService: Waiting for writes to drain, pending: ${pendingCount}`,
        );
        lastLoggedCount = pendingCount;
      }

      // Check for timeout
      if (Date.now() - startTime > this.MAX_WAIT_TIME) {
        OpLog.err(
          `OperationWriteFlushService: Timeout waiting for writes to drain. ` +
            `${pendingCount} operation(s) still pending after ${this.MAX_WAIT_TIME}ms.`,
          { pendingCount },
        );
        throw new Error(
          `Operation write flush timeout: ${pendingCount} pending operation(s). ` +
            `This may indicate a stuck effect. Try reloading the app.`,
        );
      }

      // Wait a bit before checking again
      await new Promise((resolve) => setTimeout(resolve, this.POLL_INTERVAL));
    }

    // Phase 2: Acquire the write lock to ensure the final write is complete
    // The effect uses this lock when writing to IndexedDB, so acquiring it
    // guarantees all prior writes have finished their IndexedDB transactions.
    await this.lockService.request(LOCK_NAMES.OPERATION_LOG, async () => {
      // No-op - acquiring the lock ensures the final write has completed
    });

    const totalWait = Date.now() - startTime;
    const finalPendingCount = this.captureService.getPendingCount();
    OpLog.normal(
      `OperationWriteFlushService: Flush complete in ${totalWait}ms. ` +
        `Initial pending: ${initialPendingCount}, Final pending: ${finalPendingCount}`,
    );
  }
}
