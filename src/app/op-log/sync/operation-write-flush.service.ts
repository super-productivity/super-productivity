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
 * **Phase 1: Wait for RxJS Queue to Drain**
 * The NgRx effect uses `concatMap` for sequential processing. Actions are enqueued
 * in the OperationCaptureService synchronously (in meta-reducer), then dequeued by
 * the effect. We poll the queue size until it reaches 0, meaning all dispatched
 * actions have been processed by the effect.
 *
 * **Phase 2: Acquire Write Lock**
 * Once the RxJS queue is drained, we acquire the same lock used by `writeOperation()`.
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
   * 1. Poll the capture service queue until it's empty (all actions processed by effect)
   * 2. Acquire the write lock to ensure the final IndexedDB transaction is complete
   *
   * @returns Promise that resolves when all pending writes are complete
   * @throws Error if timeout is reached while waiting for queue to drain
   */
  async flushPendingWrites(): Promise<void> {
    // Phase 1: Wait for the capture service queue to drain
    // This ensures all dispatched actions have been dequeued by the effect
    const startTime = Date.now();
    let lastLoggedSize = -1;
    const initialQueueSize = this.captureService.getQueueSize();
    OpLog.normal(
      `OperationWriteFlushService: Starting flush. Initial queue size: ${initialQueueSize}`,
    );

    while (this.captureService.getQueueSize() > 0) {
      const queueSize = this.captureService.getQueueSize();

      // Log progress periodically (when queue size changes significantly)
      if (queueSize !== lastLoggedSize && queueSize % 10 === 0) {
        OpLog.verbose(
          `OperationWriteFlushService: Waiting for queue to drain, current size: ${queueSize}`,
        );
        lastLoggedSize = queueSize;
      }

      // Check for timeout
      if (Date.now() - startTime > this.MAX_WAIT_TIME) {
        // Get diagnostic info about stuck operations
        const pendingOps = this.captureService.peekPendingOperations();
        const sampleOps = pendingOps.slice(0, 5).map((op) => ({
          opType: op.opType,
          entityType: op.entityType,
          entityId: op.entityId,
        }));
        OpLog.err(
          `OperationWriteFlushService: Timeout waiting for queue to drain. ` +
            `Queue still has ${queueSize} items after ${this.MAX_WAIT_TIME}ms.`,
          { queueSize, sampleOps },
        );
        throw new Error(
          `Operation write flush timeout: queue still has ${queueSize} pending items. ` +
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
    const finalQueueSize = this.captureService.getQueueSize();
    OpLog.normal(
      `OperationWriteFlushService: Flush complete in ${totalWait}ms. ` +
        `Initial queue: ${initialQueueSize}, Final queue: ${finalQueueSize}`,
    );
  }
}
