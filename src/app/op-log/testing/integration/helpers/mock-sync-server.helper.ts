import {
  SyncOperation,
  ServerSyncOperation,
  OpUploadResponse,
  OpDownloadResponse,
  OpUploadResult,
} from '../../../sync-providers/provider.interface';

/**
 * Simulates a sync server for integration testing.
 *
 * Stores operations in memory and provides upload/download APIs
 * matching the OperationSyncCapable interface.
 */
export class MockSyncServer {
  private ops: ServerSyncOperation[] = [];
  private nextSeq = 1;

  /**
   * If true, the next downloadOps call will return gapDetected: true.
   * Used to simulate server migration scenarios where a client connects
   * to a new/reset server with stale lastServerSeq.
   */
  private forceGapDetected = false;

  /**
   * Upload operations to the mock server.
   * Mimics the behavior of the real sync server.
   */
  uploadOps(
    ops: SyncOperation[],
    clientId: string,
    lastKnownServerSeq?: number,
  ): OpUploadResponse {
    const results: OpUploadResult[] = [];

    for (const op of ops) {
      // Check for duplicates
      const isDuplicate = this.ops.some((stored) => stored.op.id === op.id);
      if (isDuplicate) {
        results.push({
          opId: op.id,
          accepted: false,
          error: 'Duplicate operation',
        });
        continue;
      }

      // Accept the operation
      const serverSeq = this.nextSeq++;
      this.ops.push({
        serverSeq,
        op,
        receivedAt: Date.now(),
      });

      results.push({
        opId: op.id,
        accepted: true,
        serverSeq,
      });
    }

    // Piggyback new ops if requested
    let newOps: ServerSyncOperation[] | undefined;
    if (lastKnownServerSeq !== undefined) {
      newOps = this.ops.filter(
        (stored) =>
          stored.serverSeq > lastKnownServerSeq && stored.op.clientId !== clientId,
      );
    }

    return {
      results,
      newOps: newOps && newOps.length > 0 ? newOps : undefined,
      latestSeq: this.getLatestSeq(),
    };
  }

  /**
   * Download operations from the mock server.
   * Implements gap detection logic matching the real server.
   */
  downloadOps(
    sinceSeq: number,
    excludeClient?: string,
    limit: number = 500,
  ): OpDownloadResponse {
    let filtered = this.ops.filter((stored) => stored.serverSeq > sinceSeq);

    if (excludeClient) {
      filtered = filtered.filter((stored) => stored.op.clientId !== excludeClient);
    }

    const hasMore = filtered.length > limit;
    const ops = filtered.slice(0, limit);
    const latestSeq = this.getLatestSeq();

    // Gap detection logic (matching real server behavior)
    let gapDetected = false;

    // Check if forced (for testing server migration)
    if (this.forceGapDetected) {
      gapDetected = true;
      this.forceGapDetected = false; // Reset after use
    } else {
      // Case 1: Client has history but server is empty
      if (sinceSeq > 0 && latestSeq === 0) {
        gapDetected = true;
      }
      // Case 2: Client is ahead of server
      if (sinceSeq > latestSeq && latestSeq > 0) {
        gapDetected = true;
      }
    }

    return {
      ops,
      hasMore,
      latestSeq,
      gapDetected,
    };
  }

  /**
   * Get the latest server sequence number.
   */
  getLatestSeq(): number {
    if (this.ops.length === 0) return 0;
    return Math.max(...this.ops.map((o) => o.serverSeq));
  }

  /**
   * Get all stored operations (for assertions).
   */
  getAllOps(): ServerSyncOperation[] {
    return [...this.ops];
  }

  /**
   * Get operations for a specific entity (for assertions).
   */
  getOpsForEntity(entityType: string, entityId: string): ServerSyncOperation[] {
    return this.ops.filter(
      (stored) => stored.op.entityType === entityType && stored.op.entityId === entityId,
    );
  }

  /**
   * Clear all stored data (for test isolation).
   */
  clear(): void {
    this.ops = [];
    this.nextSeq = 1;
    this.forceGapDetected = false;
  }

  /**
   * Simulate a server migration/reset by:
   * 1. Clearing all operations
   * 2. Setting forceGapDetected so the next download will trigger gap detection
   *
   * This mimics what happens when a client connects to a new/empty server
   * with a stale lastServerSeq from the old server.
   */
  simulateServerReset(): void {
    this.ops = [];
    this.nextSeq = 1;
    this.forceGapDetected = true;
  }

  /**
   * Force the next downloadOps call to return gapDetected: true.
   * Useful for testing gap handling without actually clearing data.
   */
  setForceGapDetected(value: boolean): void {
    this.forceGapDetected = value;
  }

  /**
   * Convenience method to receive uploaded operations.
   * Simulates a client uploading ops without needing clientId/lastKnownServerSeq.
   */
  receiveUpload(ops: SyncOperation[]): void {
    for (const op of ops) {
      const isDuplicate = this.ops.some((stored) => stored.op.id === op.id);
      if (!isDuplicate) {
        const serverSeq = this.nextSeq++;
        this.ops.push({
          serverSeq,
          op,
          receivedAt: Date.now(),
        });
      }
    }
  }

  /**
   * Get operations since a given sequence number.
   * Convenience alias for test assertions.
   */
  getOpsSince(sinceSeq: number): ServerSyncOperation[] {
    return this.ops.filter((stored) => stored.serverSeq > sinceSeq);
  }
}
