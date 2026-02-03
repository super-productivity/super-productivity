import {
  ActionType,
  Operation,
  OperationLogEntry,
  OpType,
} from '../../../core/operation.types';
import { OperationLogStoreService } from '../../../persistence/operation-log-store.service';
import {
  SyncOperation,
  ServerSyncOperation,
} from '../../../sync-providers/provider.interface';
import { MockSyncServer } from './mock-sync-server.helper';
import { TestClient } from './test-client.helper';

/**
 * Simulates a full client with its own operation log store and sync capabilities.
 *
 * Wraps TestClient (for vector clocks) and OperationLogStoreService (for persistence)
 * to provide a complete client simulation for integration tests.
 *
 * ## Test Isolation Strategy
 *
 * All SimulatedClient instances share the same IndexedDB database ('SUP_OPS').
 * This is intentional - it simplifies test setup and avoids complex database management.
 *
 * **Logical isolation is achieved through:**
 * - **clientId filtering**: Each client only sees its own operations via `getUnsyncedOps()`
 * - **source tracking**: Operations are marked 'local' or 'remote' to distinguish origin
 * - **markSynced**: Tracks which operations have been uploaded to avoid re-upload
 * - **MockSyncServer**: Provides true isolation at the "server" level - each test creates
 *   a fresh MockSyncServer instance that acts as the coordination point
 *
 * **What this tests:**
 * - The sync protocol logic (upload/download/conflict detection)
 * - Vector clock progression and merging
 * - Operation ordering and dependency handling
 *
 * **What this does NOT test:**
 * - True multi-process/multi-tab IndexedDB isolation (use E2E tests for this)
 * - Browser storage quota handling per-client
 *
 * For true client isolation (separate databases), use the E2E tests in `e2e/tests/sync/`
 * which create separate browser contexts with isolated IndexedDB instances.
 */
export class SimulatedClient {
  readonly clientId: string;
  downloadLimit = 500;
  private testClient: TestClient;
  private lastKnownServerSeq: number = 0;

  constructor(
    clientId: string,
    private store: OperationLogStoreService,
  ) {
    this.clientId = clientId;
    this.testClient = new TestClient(clientId);
  }

  /**
   * Create and store a local operation.
   */
  async createLocalOp(
    entityType: string,
    entityId: string,
    opType: OpType,
    actionType: string,
    payload: Record<string, unknown>,
  ): Promise<Operation> {
    const op = this.testClient.createOperation({
      actionType,
      opType,
      entityType: entityType as any,
      entityId,
      payload,
    });

    await this.store.append(op, 'local');
    return op;
  }

  /**
   * Create and store a batch of local operations.
   * Uses testClient.createOperation() per op for correct vector clock increments,
   * then stores all at once via appendBatch().
   */
  async createLocalOpsBatch(
    items: Array<{
      entityType: string;
      entityId: string;
      opType: OpType;
      actionType: string;
      payload: Record<string, unknown>;
    }>,
  ): Promise<Operation[]> {
    const ops = items.map((item) =>
      this.testClient.createOperation({
        actionType: item.actionType,
        opType: item.opType,
        entityType: item.entityType as any,
        entityId: item.entityId,
        payload: item.payload,
      }),
    );
    await this.store.appendBatch(ops, 'local');
    return ops;
  }

  /**
   * Get unsynced local operations.
   */
  async getUnsyncedOps(): Promise<OperationLogEntry[]> {
    const unsynced = await this.store.getUnsynced();
    // Filter to only this client's operations
    return unsynced.filter((entry) => entry.op.clientId === this.clientId);
  }

  /**
   * Upload pending operations to the server.
   * Returns the upload results.
   */
  async uploadToServer(server: MockSyncServer): Promise<{
    uploaded: number;
    newOpsReceived: number;
  }> {
    const unsynced = await this.getUnsyncedOps();

    if (unsynced.length === 0) {
      return { uploaded: 0, newOpsReceived: 0 };
    }

    // Convert to SyncOperation format
    const syncOps: SyncOperation[] = unsynced.map((entry) => ({
      id: entry.op.id,
      clientId: entry.op.clientId,
      actionType: entry.op.actionType,
      opType: entry.op.opType,
      entityType: entry.op.entityType,
      entityId: entry.op.entityId,
      entityIds: entry.op.entityIds,
      payload: entry.op.payload,
      vectorClock: entry.op.vectorClock,
      timestamp: entry.op.timestamp,
      schemaVersion: entry.op.schemaVersion,
    }));

    // Upload to server
    const response = server.uploadOps(syncOps, this.clientId, this.lastKnownServerSeq);

    // Mark accepted ops as synced
    const acceptedOpIds = response.results
      .filter((r) => r.accepted || r.error?.includes('Duplicate'))
      .map((r) => r.opId);

    const seqsToMark = unsynced
      .filter((entry) => acceptedOpIds.includes(entry.op.id))
      .map((entry) => entry.seq);

    if (seqsToMark.length > 0) {
      await this.store.markSynced(seqsToMark);
    }

    // Process piggybacked ops
    let newOpsReceived = 0;
    if (response.newOps && response.newOps.length > 0) {
      await this._applyRemoteOps(response.newOps);
      newOpsReceived = response.newOps.length;
    }

    // Update last known seq
    this.lastKnownServerSeq = response.latestSeq;

    return { uploaded: acceptedOpIds.length, newOpsReceived };
  }

  /**
   * Download new operations from the server.
   */
  async downloadFromServer(server: MockSyncServer): Promise<{
    downloaded: number;
  }> {
    const response = server.downloadOps(
      this.lastKnownServerSeq,
      this.clientId, // Exclude own ops
      this.downloadLimit,
    );

    // Update last known seq based on received ops to ensure pagination works
    if (response.ops.length > 0) {
      this.lastKnownServerSeq = Math.max(
        this.lastKnownServerSeq,
        response.ops[response.ops.length - 1].serverSeq,
      );
    } else {
      this.lastKnownServerSeq = response.latestSeq;
    }

    return { downloaded: response.ops.length };
  }

  /**
   * Perform a full sync (upload then download).
   */
  async sync(server: MockSyncServer): Promise<{
    uploaded: number;
    downloaded: number;
  }> {
    const uploadResult = await this.uploadToServer(server);
    const downloadResult = await this.downloadFromServer(server);

    return {
      uploaded: uploadResult.uploaded,
      downloaded: downloadResult.downloaded + uploadResult.newOpsReceived,
    };
  }

  /**
   * Get all operations in this client's log.
   */
  async getAllOps(): Promise<OperationLogEntry[]> {
    return this.store.getOpsAfterSeq(0);
  }

  /**
   * Get operations filtered by source and client.
   */
  async getOpsBySource(source: 'local' | 'remote'): Promise<OperationLogEntry[]> {
    const all = await this.getAllOps();
    return all.filter((entry) => entry.source === source);
  }

  /**
   * Check if an operation exists in the local log.
   */
  async hasOp(opId: string): Promise<boolean> {
    return this.store.hasOp(opId);
  }

  /**
   * Get the current vector clock for this client.
   */
  getCurrentClock(): Record<string, number> {
    return this.testClient.getCurrentClock();
  }

  /**
   * Apply remote operations to the local store.
   */
  private async _applyRemoteOps(serverOps: ServerSyncOperation[]): Promise<void> {
    for (const serverOp of serverOps) {
      // Skip if already have this op
      if (await this.store.hasOp(serverOp.op.id)) {
        continue;
      }

      // Convert back to Operation format
      const op: Operation = {
        id: serverOp.op.id,
        clientId: serverOp.op.clientId,
        actionType: serverOp.op.actionType as ActionType,
        opType: serverOp.op.opType as OpType,
        entityType: serverOp.op.entityType as any,
        entityId: serverOp.op.entityId,
        entityIds: serverOp.op.entityIds,
        payload: serverOp.op.payload,
        vectorClock: serverOp.op.vectorClock,
        timestamp: serverOp.op.timestamp,
        schemaVersion: serverOp.op.schemaVersion,
      };

      await this.store.append(op, 'remote');

      // Merge the remote clock into our local knowledge
      this.testClient.mergeRemoteClock(op.vectorClock);
    }
  }
}
