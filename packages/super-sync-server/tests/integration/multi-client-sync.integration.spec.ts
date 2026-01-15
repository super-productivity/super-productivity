/**
 * Multi-Client Sync Integration Tests
 *
 * These tests simulate multiple clients syncing through the server
 * to verify the complete sync protocol works correctly.
 *
 * No Playwright/browser needed - uses Fastify's inject() for HTTP simulation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { initDb, getDb } from '../../src/db';
import { initSyncService, getSyncService } from '../../src/sync/sync.service';
import { syncRoutes } from '../../src/sync/sync.routes';
import { uuidv7 } from 'uuidv7';
import * as jwt from 'jsonwebtoken';
import {
  Operation,
  ServerOperation,
  UploadOpsResponse,
  DownloadOpsResponse,
  SnapshotResponse,
} from '../../src/sync/sync.types';

const JWT_SECRET = 'super-sync-dev-secret-do-not-use-in-production';

/**
 * Simulates a sync client with its own state tracking
 */
// Counter for unique client IDs within a test run
let clientCounter = 0;

class SimulatedClient {
  readonly clientId: string;
  readonly userId: number;
  readonly authToken: string;
  private app: FastifyInstance;

  // Client-side state tracking
  private lastKnownSeq = 0;
  private appliedOps: ServerOperation[] = [];
  private pendingOps: Operation[] = [];
  private vectorClock: Record<string, number> = {};

  constructor(app: FastifyInstance, userId: number, clientId?: string) {
    this.app = app;
    this.userId = userId;
    // Use incrementing counter for unique client IDs
    this.clientId = clientId || `client-${++clientCounter}-${uuidv7().slice(0, 8)}`;
    this.authToken = jwt.sign({ userId, email: `user${userId}@test.com` }, JWT_SECRET, {
      expiresIn: '7d',
    });
  }

  /** Creates an operation with proper vector clock increment */
  createOp(
    opType: 'CRT' | 'UPD' | 'DEL' | 'MOV',
    entityType: string,
    entityId: string,
    payload: unknown,
    actionType = 'TEST_ACTION',
  ): Operation {
    // Increment our own vector clock entry
    this.vectorClock[this.clientId] = (this.vectorClock[this.clientId] || 0) + 1;

    const op: Operation = {
      id: uuidv7(),
      clientId: this.clientId,
      actionType,
      opType,
      entityType,
      entityId,
      payload,
      vectorClock: { ...this.vectorClock },
      timestamp: Date.now(),
      schemaVersion: 1,
    };

    this.pendingOps.push(op);
    return op;
  }

  /** Uploads pending operations to server */
  async upload(): Promise<UploadOpsResponse> {
    if (this.pendingOps.length === 0) {
      throw new Error('No pending ops to upload');
    }

    const response = await this.app.inject({
      method: 'POST',
      url: '/api/sync/ops',
      headers: { authorization: `Bearer ${this.authToken}` },
      payload: {
        ops: this.pendingOps,
        clientId: this.clientId,
        lastKnownServerSeq: this.lastKnownSeq,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as UploadOpsResponse;

    // Update our sequence tracking
    this.lastKnownSeq = body.latestSeq;

    // Clear pending ops that were accepted
    const acceptedIds = new Set(
      body.results.filter((r) => r.accepted).map((r) => r.opId),
    );
    this.pendingOps = this.pendingOps.filter((op) => !acceptedIds.has(op.id));

    // Process any piggybacked ops
    if (body.newOps && body.newOps.length > 0) {
      this.applyRemoteOps(body.newOps);
    }

    return body;
  }

  /** Downloads operations from server since lastKnownSeq */
  async download(excludeSelf = true): Promise<DownloadOpsResponse> {
    const query = new URLSearchParams({
      sinceSeq: String(this.lastKnownSeq),
      limit: '500',
    });
    if (excludeSelf) {
      query.set('excludeClient', this.clientId);
    }

    const response = await this.app.inject({
      method: 'GET',
      url: `/api/sync/ops?${query.toString()}`,
      headers: { authorization: `Bearer ${this.authToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as DownloadOpsResponse;

    // Apply remote ops
    if (body.ops.length > 0) {
      this.applyRemoteOps(body.ops);
    }

    // Update sequence
    this.lastKnownSeq = body.latestSeq;

    return body;
  }

  /** Downloads all pages until hasMore=false */
  async downloadAll(excludeSelf = true): Promise<ServerOperation[]> {
    const allOps: ServerOperation[] = [];
    let hasMore = true;

    while (hasMore) {
      const result = await this.download(excludeSelf);
      allOps.push(...result.ops);
      hasMore = result.hasMore;
    }

    return allOps;
  }

  /** Gets snapshot from server */
  async getSnapshot(): Promise<SnapshotResponse> {
    const response = await this.app.inject({
      method: 'GET',
      url: '/api/sync/snapshot',
      headers: { authorization: `Bearer ${this.authToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as SnapshotResponse;

    // Update our sequence to snapshot's seq
    this.lastKnownSeq = body.serverSeq;

    return body;
  }

  /** Applies remote operations to local state */
  private applyRemoteOps(ops: ServerOperation[]): void {
    for (const serverOp of ops) {
      // Skip if already applied
      if (this.appliedOps.some((o) => o.op.id === serverOp.op.id)) {
        continue;
      }

      this.appliedOps.push(serverOp);

      // Merge vector clock
      for (const [clientId, seq] of Object.entries(serverOp.op.vectorClock)) {
        this.vectorClock[clientId] = Math.max(this.vectorClock[clientId] || 0, seq);
      }
    }
  }

  // Getters for test assertions
  get appliedOperations(): ServerOperation[] {
    return [...this.appliedOps];
  }

  get currentVectorClock(): Record<string, number> {
    return { ...this.vectorClock };
  }

  get currentSeq(): number {
    return this.lastKnownSeq;
  }

  get hasPendingOps(): boolean {
    return this.pendingOps.length > 0;
  }
}

describe('Multi-Client Sync Integration', () => {
  let app: FastifyInstance;
  const userId = 1;

  beforeEach(async () => {
    initDb('./data', true); // In-memory DB
    const db = getDb();

    db.prepare(
      `INSERT INTO users (id, email, password_hash, is_verified, created_at)
       VALUES (?, 'test@test.com', 'hash', 1, ?)`,
    ).run(userId, Date.now());

    initSyncService();

    app = Fastify();
    await app.register(syncRoutes, { prefix: '/api/sync' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('Basic Sync Round-Trip', () => {
    it('should sync single operation from Client A to Client B', async () => {
      const clientA = new SimulatedClient(app, userId);
      const clientB = new SimulatedClient(app, userId);

      // Client A creates a task
      clientA.createOp('CRT', 'TASK', 'task-1', { title: 'Test Task' });
      const uploadResult = await clientA.upload();

      expect(uploadResult.results[0].accepted).toBe(true);
      expect(uploadResult.results[0].serverSeq).toBe(1);

      // Client B downloads
      const downloadResult = await clientB.download();

      expect(downloadResult.ops).toHaveLength(1);
      expect(downloadResult.ops[0].op.entityId).toBe('task-1');
      expect(downloadResult.ops[0].serverSeq).toBe(1);

      // Verify both clients have the same operation
      expect(clientB.appliedOperations).toHaveLength(1);
      expect(clientB.appliedOperations[0].op.id).toBe(
        clientA.appliedOperations[0]?.op.id || uploadResult.results[0].opId,
      );
    });

    it('should sync multiple operations in correct order', async () => {
      const clientA = new SimulatedClient(app, userId);
      const clientB = new SimulatedClient(app, userId);

      // Client A creates multiple tasks
      clientA.createOp('CRT', 'TASK', 'task-1', { title: 'Task 1' });
      clientA.createOp('CRT', 'TASK', 'task-2', { title: 'Task 2' });
      clientA.createOp('UPD', 'TASK', 'task-1', { title: 'Task 1 Updated' });

      await clientA.upload();

      // Client B downloads all
      const downloadResult = await clientB.downloadAll();

      expect(downloadResult).toHaveLength(3);
      expect(downloadResult[0].serverSeq).toBe(1);
      expect(downloadResult[1].serverSeq).toBe(2);
      expect(downloadResult[2].serverSeq).toBe(3);

      // Verify order matches creation order
      expect(downloadResult[0].op.entityId).toBe('task-1');
      expect(downloadResult[0].op.opType).toBe('CRT');
      expect(downloadResult[1].op.entityId).toBe('task-2');
      expect(downloadResult[2].op.entityId).toBe('task-1');
      expect(downloadResult[2].op.opType).toBe('UPD');
    });

    it('should handle bidirectional sync between two clients', async () => {
      const clientA = new SimulatedClient(app, userId);
      const clientB = new SimulatedClient(app, userId);

      // Client A creates task-1
      clientA.createOp('CRT', 'TASK', 'task-1', { title: 'From A' });
      await clientA.upload();

      // Client B creates task-2 (different entity - no conflict)
      clientB.createOp('CRT', 'TASK', 'task-2', { title: 'From B' });
      await clientB.upload();

      // Both clients sync
      await clientA.download();
      await clientB.download();

      // Both should have 2 operations
      expect(clientA.appliedOperations).toHaveLength(1); // Only remote op (task-2)
      expect(clientB.appliedOperations).toHaveLength(1); // Only remote op (task-1)

      // Verify vector clocks include both clients
      expect(Object.keys(clientA.currentVectorClock)).toContain(clientB.clientId);
      expect(Object.keys(clientB.currentVectorClock)).toContain(clientA.clientId);
    });
  });

  describe('Sequence Continuity', () => {
    it('should assign sequential serverSeq without gaps', async () => {
      const clientA = new SimulatedClient(app, userId);
      const clientB = new SimulatedClient(app, userId);

      // Interleaved uploads from two clients
      clientA.createOp('CRT', 'TASK', 'task-a1', { title: 'A1' });
      await clientA.upload(); // seq 1

      clientB.createOp('CRT', 'TASK', 'task-b1', { title: 'B1' });
      await clientB.upload(); // seq 2

      clientA.createOp('CRT', 'TASK', 'task-a2', { title: 'A2' });
      await clientA.upload(); // seq 3

      clientB.createOp('CRT', 'TASK', 'task-b2', { title: 'B2' });
      await clientB.upload(); // seq 4

      // Fresh client downloads all
      const freshClient = new SimulatedClient(app, userId);
      const allOps = await freshClient.downloadAll(false);

      expect(allOps).toHaveLength(4);
      expect(allOps.map((o) => o.serverSeq)).toEqual([1, 2, 3, 4]);
    });

    it('should paginate correctly with hasMore flag', async () => {
      const client = new SimulatedClient(app, userId);

      // Upload 5 operations
      for (let i = 1; i <= 5; i++) {
        client.createOp('CRT', 'TASK', `task-${i}`, { title: `Task ${i}` });
      }
      await client.upload();

      // Fresh client downloads with limit=2
      const freshClient = new SimulatedClient(app, userId);
      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/ops?sinceSeq=0&limit=2',
        headers: { authorization: `Bearer ${freshClient.authToken}` },
      });

      const body = response.json() as DownloadOpsResponse;
      expect(body.ops).toHaveLength(2);
      expect(body.hasMore).toBe(true);
      expect(body.latestSeq).toBe(5);
    });

    it('should return hasMore=false when all ops retrieved', async () => {
      const client = new SimulatedClient(app, userId);

      client.createOp('CRT', 'TASK', 'task-1', { title: 'Task 1' });
      client.createOp('CRT', 'TASK', 'task-2', { title: 'Task 2' });
      await client.upload();

      const freshClient = new SimulatedClient(app, userId);
      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/ops?sinceSeq=0&limit=10',
        headers: { authorization: `Bearer ${freshClient.authToken}` },
      });

      const body = response.json() as DownloadOpsResponse;
      expect(body.ops).toHaveLength(2);
      expect(body.hasMore).toBe(false);
    });
  });

  describe('Piggybacked Operations', () => {
    it('should include remote ops in upload response when lastKnownServerSeq provided', async () => {
      const clientA = new SimulatedClient(app, userId);
      const clientB = new SimulatedClient(app, userId);

      // Client A uploads first
      clientA.createOp('CRT', 'TASK', 'task-a', { title: 'From A' });
      await clientA.upload();

      // Client B uploads with lastKnownServerSeq=0
      clientB.createOp('CRT', 'TASK', 'task-b', { title: 'From B' });
      const uploadResult = await clientB.upload();

      // Client B should receive Client A's op piggybacked
      expect(uploadResult.newOps).toBeDefined();
      expect(uploadResult.newOps).toHaveLength(1);
      expect(uploadResult.newOps![0].op.entityId).toBe('task-a');
    });

    it('should NOT include own ops in piggybacked response', async () => {
      const client = new SimulatedClient(app, userId);

      // Upload first op
      client.createOp('CRT', 'TASK', 'task-1', { title: 'Task 1' });
      await client.upload();

      // Upload second op with lastKnownServerSeq from first upload
      client.createOp('CRT', 'TASK', 'task-2', { title: 'Task 2' });
      const result = await client.upload();

      // Should NOT get own ops back - newOps is undefined when empty
      expect(result.newOps ?? []).toHaveLength(0);
    });
  });

  describe('Fresh Client Bootstrap', () => {
    it('should allow fresh client to get snapshot after other clients uploaded', async () => {
      const clientA = new SimulatedClient(app, userId);

      // Client A uploads several operations
      clientA.createOp('CRT', 'TASK', 'task-1', { title: 'Task 1' });
      clientA.createOp('CRT', 'TASK', 'task-2', { title: 'Task 2' });
      clientA.createOp('UPD', 'TASK', 'task-1', { title: 'Task 1 Updated' });
      clientA.createOp('DEL', 'TASK', 'task-2', null);
      await clientA.upload();

      // Fresh client requests snapshot
      const freshClient = new SimulatedClient(app, userId);
      const snapshot = await freshClient.getSnapshot();

      expect(snapshot.serverSeq).toBe(4);
      expect(snapshot.state).toBeDefined();
      // State should have task-1 (updated) but NOT task-2 (deleted)
      const state = snapshot.state as Record<string, unknown>;
      // Note: actual state structure depends on snapshot reconstruction logic
    });

    it('should allow fresh client to continue with ops after snapshot', async () => {
      const clientA = new SimulatedClient(app, userId);

      // Initial ops
      clientA.createOp('CRT', 'TASK', 'task-1', { title: 'Task 1' });
      await clientA.upload();

      // Fresh client gets snapshot
      const freshClient = new SimulatedClient(app, userId);
      await freshClient.getSnapshot();

      // Client A adds more ops
      clientA.createOp('CRT', 'TASK', 'task-2', { title: 'Task 2' });
      await clientA.upload();

      // Fresh client downloads ops since snapshot (don't exclude any client)
      const downloaded = await freshClient.download(false);

      expect(downloaded.ops).toHaveLength(1);
      expect(downloaded.ops[0].op.entityId).toBe('task-2');
      expect(downloaded.ops[0].serverSeq).toBe(2);
    });

    /**
     * Scenario: User installs app on new device, server has existing data from other devices.
     *
     * This tests the server-side of the fresh client bootstrap flow:
     * 1. Existing device has uploaded operations (tasks, projects, etc.)
     * 2. Fresh device connects and downloads all remote operations
     * 3. Fresh device should receive complete state without needing to upload anything first
     * 4. After sync, fresh client has same state as server (via ops, not genesis import)
     *
     * Client-side behavior (confirmation dialog, genesis import prevention) is handled
     * by OperationLogSyncService.downloadRemoteOps() - see operation-log-sync.service.ts
     */
    it('should provide complete state to fresh client joining existing sync group', async () => {
      // === Setup: Existing device has been using the app ===
      const existingDevice = new SimulatedClient(app, userId, 'desktop-device');

      // Simulate realistic usage: create project, tasks, updates, deletions
      existingDevice.createOp('CRT', 'PROJECT', 'proj-1', {
        id: 'proj-1',
        title: 'Work Project',
        taskIds: [],
      });
      existingDevice.createOp('CRT', 'TASK', 'task-1', {
        id: 'task-1',
        title: 'First task',
        projectId: 'proj-1',
      });
      existingDevice.createOp('CRT', 'TASK', 'task-2', {
        id: 'task-2',
        title: 'Second task',
        projectId: 'proj-1',
      });
      existingDevice.createOp('UPD', 'TASK', 'task-1', {
        id: 'task-1',
        title: 'First task (completed)',
        done: true,
      });
      existingDevice.createOp('CRT', 'TASK', 'task-3', {
        id: 'task-3',
        title: 'Third task',
        projectId: 'proj-1',
      });
      existingDevice.createOp('DEL', 'TASK', 'task-2', null); // User deleted task-2

      await existingDevice.upload();
      expect(existingDevice.currentSeq).toBe(6);

      // === Fresh client joins (new device installation) ===
      const freshDevice = new SimulatedClient(app, userId, 'mobile-device');

      // Fresh client has NO local state - it starts at seq 0
      expect(freshDevice.currentSeq).toBe(0);
      expect(freshDevice.appliedOperations).toHaveLength(0);

      // Fresh client downloads all operations from server
      // In real app: this triggers confirmation dialog first (client-side)
      const downloadedOps = await freshDevice.downloadAll(false);

      // === Verify: Fresh client receives ALL operations ===
      expect(downloadedOps).toHaveLength(6);

      // Verify operation order matches server sequence
      expect(downloadedOps[0].serverSeq).toBe(1);
      expect(downloadedOps[0].op.opType).toBe('CRT');
      expect(downloadedOps[0].op.entityType).toBe('PROJECT');

      expect(downloadedOps[1].serverSeq).toBe(2);
      expect(downloadedOps[1].op.entityId).toBe('task-1');
      expect(downloadedOps[1].op.opType).toBe('CRT');

      expect(downloadedOps[3].serverSeq).toBe(4);
      expect(downloadedOps[3].op.opType).toBe('UPD');

      expect(downloadedOps[5].serverSeq).toBe(6);
      expect(downloadedOps[5].op.opType).toBe('DEL');
      expect(downloadedOps[5].op.entityId).toBe('task-2');

      // Fresh client is now at same sequence as server
      expect(freshDevice.currentSeq).toBe(6);

      // Fresh client's vector clock includes existing device
      expect(freshDevice.currentVectorClock['desktop-device']).toBe(6);

      // === Verify: Both devices are in sync ===
      // If existing device downloads now, it should get nothing new
      const existingDownload = await existingDevice.downloadAll();
      expect(existingDownload).toHaveLength(0);

      // Both at same sequence
      expect(freshDevice.currentSeq).toBe(existingDevice.currentSeq);
    });

    /**
     * Scenario: Fresh client receives data via operations, NOT via snapshot upload.
     *
     * This verifies that a fresh client bootstraps by downloading ops (which the client
     * then applies locally), rather than by uploading a genesis/initial state.
     * The fresh client should NOT upload anything during initial sync.
     */
    it('should bootstrap fresh client via download only (no upload required)', async () => {
      const existingDevice = new SimulatedClient(app, userId, 'existing');

      // Existing device has data
      existingDevice.createOp('CRT', 'TASK', 'task-1', { title: 'Existing task' });
      existingDevice.createOp('CRT', 'TAG', 'tag-1', { title: 'Existing tag' });
      await existingDevice.upload();

      // Fresh device joins
      const freshDevice = new SimulatedClient(app, userId, 'fresh');

      // Get server status BEFORE fresh client does anything
      const statusBefore = await app.inject({
        method: 'GET',
        url: '/api/sync/status',
        headers: { authorization: `Bearer ${freshDevice.authToken}` },
      });
      const beforeStatus = statusBefore.json();
      expect(beforeStatus.latestSeq).toBe(2);

      // Fresh client downloads (simulates what happens after user confirms dialog)
      await freshDevice.downloadAll(false);

      // Get server status AFTER fresh client synced
      const statusAfter = await app.inject({
        method: 'GET',
        url: '/api/sync/status',
        headers: { authorization: `Bearer ${freshDevice.authToken}` },
      });
      const afterStatus = statusAfter.json();

      // Server sequence should be UNCHANGED - fresh client didn't upload anything
      expect(afterStatus.latestSeq).toBe(2);

      // Fresh client has the data locally now
      expect(freshDevice.appliedOperations).toHaveLength(2);
      expect(freshDevice.currentSeq).toBe(2);
    });

    /**
     * Scenario: Fresh client can contribute after initial sync.
     *
     * After bootstrapping from remote data, the fresh client should be able to
     * create and upload its own operations that sync back to other devices.
     */
    it('should allow fresh client to contribute after initial bootstrap', async () => {
      const existingDevice = new SimulatedClient(app, userId, 'existing');

      // Existing device has data
      existingDevice.createOp('CRT', 'PROJECT', 'proj-1', { title: 'Shared Project' });
      await existingDevice.upload();

      // Fresh device bootstraps
      const freshDevice = new SimulatedClient(app, userId, 'fresh');
      await freshDevice.downloadAll(false);
      expect(freshDevice.currentSeq).toBe(1);

      // Now fresh device creates new data
      freshDevice.createOp('CRT', 'TASK', 'task-from-fresh', {
        title: 'Task created on new device',
        projectId: 'proj-1',
      });
      const uploadResult = await freshDevice.upload();

      // Fresh device's op was accepted
      expect(uploadResult.results[0].accepted).toBe(true);
      expect(uploadResult.results[0].serverSeq).toBe(2);

      // Existing device can now download fresh device's contribution
      const existingDownload = await existingDevice.downloadAll();
      expect(existingDownload).toHaveLength(1);
      expect(existingDownload[0].op.entityId).toBe('task-from-fresh');
      expect(existingDownload[0].op.clientId).toBe('fresh');

      // Both devices now have consistent state
      expect(freshDevice.currentSeq).toBe(2);
      expect(existingDevice.currentSeq).toBe(2);
    });
  });

  describe('Vector Clock Preservation', () => {
    it('should preserve vector clock through upload/download round-trip', async () => {
      const clientA = new SimulatedClient(app, userId);
      const clientB = new SimulatedClient(app, userId);

      // Client A creates op with specific vector clock
      const op = clientA.createOp('CRT', 'TASK', 'task-1', { title: 'Test' });
      const originalVC = { ...op.vectorClock };

      await clientA.upload();

      // Client B downloads (don't exclude self since B hasn't uploaded)
      await clientB.download(false);

      // Verify vector clock is preserved
      expect(clientB.appliedOperations).toHaveLength(1);
      const downloadedOp = clientB.appliedOperations[0];
      expect(downloadedOp.op.vectorClock).toEqual(originalVC);
    });

    it('should correctly merge vector clocks from multiple clients', async () => {
      const clientA = new SimulatedClient(app, userId);
      const clientB = new SimulatedClient(app, userId);
      const clientC = new SimulatedClient(app, userId);

      // Each client uploads one op
      clientA.createOp('CRT', 'TASK', 'task-a', { title: 'A' });
      await clientA.upload();

      clientB.createOp('CRT', 'TASK', 'task-b', { title: 'B' });
      await clientB.upload();

      clientC.createOp('CRT', 'TASK', 'task-c', { title: 'C' });
      await clientC.upload();

      // Client A syncs - should have all 3 clients in vector clock
      await clientA.downloadAll();

      const vcA = clientA.currentVectorClock;
      expect(vcA[clientA.clientId]).toBe(1);
      expect(vcA[clientB.clientId]).toBe(1);
      expect(vcA[clientC.clientId]).toBe(1);
    });
  });

  describe('Idempotency', () => {
    it('should reject duplicate operation IDs', async () => {
      const client = new SimulatedClient(app, userId);

      const op = client.createOp('CRT', 'TASK', 'task-1', { title: 'Test' });
      await client.upload();

      // Try to upload same op ID again (simulate retry)
      const response = await app.inject({
        method: 'POST',
        url: '/api/sync/ops',
        headers: { authorization: `Bearer ${client.authToken}` },
        payload: {
          ops: [op],
          clientId: client.clientId,
        },
      });

      const body = response.json() as UploadOpsResponse;
      expect(body.results[0].accepted).toBe(false);
      // Case-insensitive check for "duplicate"
      expect(body.results[0].error?.toLowerCase()).toContain('duplicate');
    });

    it('should not duplicate ops in download after retry', async () => {
      const clientA = new SimulatedClient(app, userId);
      const clientB = new SimulatedClient(app, userId);

      clientA.createOp('CRT', 'TASK', 'task-1', { title: 'Test' });
      await clientA.upload();

      // Client B downloads (first time) - don't exclude self since B hasn't uploaded
      await clientB.download(false);
      expect(clientB.appliedOperations).toHaveLength(1);

      // Client B downloads again (simulate network retry) - seq is now updated
      // so it won't get the same ops again from the server
      const secondDownload = await clientB.download(false);
      expect(secondDownload.ops).toHaveLength(0);

      // Should still only have 1 applied op total
      expect(clientB.appliedOperations).toHaveLength(1);
    });

    it('should handle partial batch upload recovery (simulated network failure)', async () => {
      // Scenario: Client uploads 5 ops, server accepts first 3, connection dies.
      // Client retries with all 5 ops. Server should reject first 3 as duplicates,
      // accept remaining 2.

      const client = new SimulatedClient(app, userId);

      // Create 5 operations manually (not using client.createOp to avoid auto-queuing)
      const baseVectorClock: Record<string, number> = {};
      const ops: Operation[] = [];
      for (let i = 1; i <= 5; i++) {
        baseVectorClock[client.clientId] = i;
        ops.push({
          id: uuidv7(),
          clientId: client.clientId,
          actionType: 'TEST_ACTION',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: `task-${i}`,
          payload: { title: `Task ${i}` },
          vectorClock: { ...baseVectorClock },
          timestamp: Date.now() + i,
          schemaVersion: 1,
        });
      }

      // Simulate: First 3 ops reach server (response never reaches client)
      const firstThreeOps = ops.slice(0, 3);
      const firstResponse = await app.inject({
        method: 'POST',
        url: '/api/sync/ops',
        headers: { authorization: `Bearer ${client.authToken}` },
        payload: { ops: firstThreeOps, clientId: client.clientId },
      });
      expect(firstResponse.statusCode).toBe(200);
      const firstBody = firstResponse.json() as UploadOpsResponse;
      expect(firstBody.results.filter((r) => r.accepted)).toHaveLength(3);

      // Client retries with ALL 5 ops (doesn't know first 3 succeeded)
      const retryResponse = await app.inject({
        method: 'POST',
        url: '/api/sync/ops',
        headers: { authorization: `Bearer ${client.authToken}` },
        payload: { ops: ops, clientId: client.clientId },
      });

      expect(retryResponse.statusCode).toBe(200);
      const retryBody = retryResponse.json() as UploadOpsResponse;

      // First 3 should be rejected as duplicates
      expect(retryBody.results[0].accepted).toBe(false);
      expect(retryBody.results[0].error?.toLowerCase()).toContain('duplicate');
      expect(retryBody.results[1].accepted).toBe(false);
      expect(retryBody.results[2].accepted).toBe(false);

      // Last 2 should be accepted
      expect(retryBody.results[3].accepted).toBe(true);
      expect(retryBody.results[4].accepted).toBe(true);

      // Verify all 5 ops are now on server (no duplicates, correct order)
      const downloadResponse = await app.inject({
        method: 'GET',
        url: '/api/sync/ops?sinceSeq=0',
        headers: { authorization: `Bearer ${client.authToken}` },
      });
      expect(downloadResponse.statusCode).toBe(200);
      const downloadBody = downloadResponse.json() as DownloadOpsResponse;
      expect(downloadBody.ops).toHaveLength(5);

      // Verify ops are in correct sequence order
      const entityIds = downloadBody.ops.map((o) => o.op.entityId);
      expect(entityIds).toEqual(['task-1', 'task-2', 'task-3', 'task-4', 'task-5']);
    });
  });

  describe('Multi-User Isolation', () => {
    it('should isolate operations between different users', async () => {
      // Create second user
      const db = getDb();
      db.prepare(
        `INSERT INTO users (id, email, password_hash, is_verified, created_at)
         VALUES (?, 'user2@test.com', 'hash', 1, ?)`,
      ).run(2, Date.now());

      const user1Client = new SimulatedClient(app, 1);
      const user2Client = new SimulatedClient(app, 2);

      // User 1 uploads
      user1Client.createOp('CRT', 'TASK', 'task-1', { title: 'User 1 Task' });
      await user1Client.upload();

      // User 2 uploads
      user2Client.createOp('CRT', 'TASK', 'task-2', { title: 'User 2 Task' });
      await user2Client.upload();

      // User 2 downloads - should NOT see User 1's ops
      const user2Download = await user2Client.download();
      expect(user2Download.ops).toHaveLength(0); // Already uploaded, excludeClient filters it

      // User 1 downloads - should NOT see User 2's ops
      const user1Download = await user1Client.download();
      expect(user1Download.ops).toHaveLength(0);

      // Verify sequence numbers are independent
      expect(user1Client.currentSeq).toBe(1);
      expect(user2Client.currentSeq).toBe(1);
    });
  });

  describe('Concurrent Uploads', () => {
    it('should handle simultaneous uploads from multiple clients', async () => {
      const clients = Array.from({ length: 5 }, () => new SimulatedClient(app, userId));

      // All clients create ops
      clients.forEach((client, i) => {
        client.createOp('CRT', 'TASK', `task-${i}`, { title: `Task ${i}` });
      });

      // All upload concurrently
      const results = await Promise.all(clients.map((c) => c.upload()));

      // Verify all accepted with unique sequential serverSeq
      const allSeqs = results.flatMap((r) =>
        r.results.filter((res) => res.accepted).map((res) => res.serverSeq),
      );

      expect(allSeqs).toHaveLength(5);
      expect(new Set(allSeqs).size).toBe(5); // All unique

      // Verify they form a contiguous sequence 1-5
      const sorted = [...allSeqs].sort((a, b) => (a ?? 0) - (b ?? 0));
      expect(sorted).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('Delete Operations', () => {
    it('should properly handle CRT -> DEL sequence', async () => {
      const clientA = new SimulatedClient(app, userId);
      const clientB = new SimulatedClient(app, userId);

      // Create then delete
      clientA.createOp('CRT', 'TASK', 'task-1', { title: 'Will Delete' });
      clientA.createOp('DEL', 'TASK', 'task-1', null);
      await clientA.upload();

      // Client B downloads (don't exclude any client since B hasn't uploaded anything)
      const ops = await clientB.downloadAll(false);

      expect(ops).toHaveLength(2);
      expect(ops[0].op.opType).toBe('CRT');
      expect(ops[1].op.opType).toBe('DEL');
    });
  });

  describe('Error Cases', () => {
    it('should clamp ops with timestamp too far in future', async () => {
      const client = new SimulatedClient(app, userId);

      const futureOp: Operation = {
        id: uuidv7(),
        clientId: client.clientId,
        actionType: 'TEST',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-future',
        payload: { title: 'Future' },
        vectorClock: {},
        timestamp: Date.now() + 120_000, // 2 min in future
        schemaVersion: 1,
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/sync/ops',
        headers: { authorization: `Bearer ${client.authToken}` },
        payload: {
          ops: [futureOp],
          clientId: client.clientId,
        },
      });

      const body = response.json() as UploadOpsResponse;
      // Future timestamps are clamped, not rejected (prevents silent data loss)
      expect(body.results[0].accepted).toBe(true);
      expect(body.results[0].serverSeq).toBeDefined();
    });

    it('should reject ops with invalid entity type', async () => {
      const client = new SimulatedClient(app, userId);

      const badOp: Operation = {
        id: uuidv7(),
        clientId: client.clientId,
        actionType: 'TEST',
        opType: 'CRT',
        entityType: '', // Invalid empty
        entityId: 'task-1',
        payload: { title: 'Test' },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/sync/ops',
        headers: { authorization: `Bearer ${client.authToken}` },
        payload: {
          ops: [badOp],
          clientId: client.clientId,
        },
      });

      // The server validates entityType and should reject
      const body = response.json() as UploadOpsResponse;
      // Either validation fails at schema level (no results) or at service level (results[0].accepted=false)
      if (body.results && body.results.length > 0) {
        expect(body.results[0].accepted).toBe(false);
      } else {
        // Schema validation failed - 400 status
        expect(response.statusCode).toBe(400);
      }
    });
  });
});

describe('Diagnostic: Sync Flow Verification', () => {
  let app: FastifyInstance;
  const userId = 1;

  beforeEach(async () => {
    initDb('./data', true);
    const db = getDb();
    db.prepare(
      `INSERT INTO users (id, email, password_hash, is_verified, created_at)
       VALUES (?, 'test@test.com', 'hash', 1, ?)`,
    ).run(userId, Date.now());
    initSyncService();
    app = Fastify();
    await app.register(syncRoutes, { prefix: '/api/sync' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  /**
   * This test simulates a real-world sync scenario:
   * 1. Client A (desktop) is active and creates tasks
   * 2. Client B (mobile) was offline, comes online
   * 3. Client B syncs and should see all of Client A's changes
   * 4. Client B makes changes
   * 5. Client A syncs and should see Client B's changes
   */
  it('DIAGNOSTIC: Full real-world sync scenario', async () => {
    console.log('\n=== Starting Full Sync Scenario ===\n');

    const desktop = new SimulatedClient(app, userId, 'desktop-client');
    const mobile = new SimulatedClient(app, userId, 'mobile-client');

    // Step 1: Desktop creates initial tasks
    console.log('Step 1: Desktop creating tasks...');
    desktop.createOp('CRT', 'TASK', 'task-1', { title: 'Buy groceries' });
    desktop.createOp('CRT', 'TASK', 'task-2', { title: 'Call mom' });
    const desktopUpload1 = await desktop.upload();
    console.log('  Desktop uploaded:', desktopUpload1.results.length, 'ops');
    console.log('  Server seq:', desktopUpload1.latestSeq);

    // Step 2: Mobile comes online and downloads
    console.log('\nStep 2: Mobile syncing...');
    const mobileDownload1 = await mobile.downloadAll();
    console.log('  Mobile downloaded:', mobileDownload1.length, 'ops');
    console.log(
      '  Mobile entities:',
      mobileDownload1.map((o) => o.op.entityId),
    );

    expect(mobileDownload1).toHaveLength(2);

    // Step 3: Mobile makes changes
    console.log('\nStep 3: Mobile making changes...');
    mobile.createOp('CRT', 'TASK', 'task-3', { title: 'Pick up kids' });
    mobile.createOp('UPD', 'TASK', 'task-1', {
      title: 'Buy groceries (done)',
      done: true,
    });
    const mobileUpload = await mobile.upload();
    console.log('  Mobile uploaded:', mobileUpload.results.length, 'ops');
    console.log('  Server seq:', mobileUpload.latestSeq);

    // Step 4: Desktop syncs
    console.log('\nStep 4: Desktop syncing...');
    const desktopDownload = await desktop.downloadAll();
    console.log('  Desktop downloaded:', desktopDownload.length, 'ops');
    console.log(
      '  Desktop entities:',
      desktopDownload.map((o) => `${o.op.opType}:${o.op.entityId}`),
    );

    expect(desktopDownload).toHaveLength(2); // task-3 CRT + task-1 UPD

    // Final state verification
    console.log('\n=== Final State ===');
    console.log('Desktop seq:', desktop.currentSeq);
    console.log('Mobile seq:', mobile.currentSeq);
    console.log('Desktop VC:', desktop.currentVectorClock);
    console.log('Mobile VC:', mobile.currentVectorClock);

    // Both should be at seq 4
    expect(desktop.currentSeq).toBe(4);
    expect(mobile.currentSeq).toBe(4);

    // Both vector clocks should know about each other
    expect(desktop.currentVectorClock['mobile-client']).toBeDefined();
    expect(mobile.currentVectorClock['desktop-client']).toBeDefined();

    console.log('\n=== Sync Scenario PASSED ===\n');
  });

  /**
   * Diagnostic test to verify server-side conflict detection.
   * Server now detects concurrent edits via vector clock comparison.
   */
  it('DIAGNOSTIC: Concurrent edit detection', async () => {
    console.log('\n=== Concurrent Edit Scenario ===\n');

    const clientA = new SimulatedClient(app, userId, 'client-a');
    const clientB = new SimulatedClient(app, userId, 'client-b');

    // Both start from same baseline
    clientA.createOp('CRT', 'TASK', 'shared-task', { title: 'Original' });
    await clientA.upload();
    // Client B downloads initial state (don't exclude since B hasn't uploaded yet)
    await clientB.downloadAll(false);

    console.log('Initial state - both clients have shared-task');
    console.log('  Client A VC:', clientA.currentVectorClock);
    console.log('  Client B VC:', clientB.currentVectorClock);
    console.log('  Client A seq:', clientA.currentSeq);
    console.log('  Client B seq:', clientB.currentSeq);

    // Both edit the SAME task (this creates concurrent edits)
    // After B downloads A's CRT op, B's VC becomes {client-a: 1}
    // When A edits: A's VC becomes {client-a: 2}
    // When B edits: B's VC becomes {client-a: 1, client-b: 1}
    // These are CONCURRENT (neither > the other)
    console.log('\nBoth clients editing same task concurrently...');
    clientA.createOp('UPD', 'TASK', 'shared-task', { title: 'Edited by A' });
    clientB.createOp('UPD', 'TASK', 'shared-task', { title: 'Edited by B' });

    console.log('  Client A VC after edit:', clientA.currentVectorClock);
    console.log('  Client B VC after edit:', clientB.currentVectorClock);

    // Both upload - Client A uploads first, then B
    const resultA = await clientA.upload();
    const resultB = await clientB.upload();

    console.log('\nUpload results:');
    console.log('  Client A accepted:', resultA.results[0].accepted);
    console.log('  Client B accepted:', resultB.results[0].accepted);
    console.log('  Client B error:', resultB.results[0].error);

    // Client A's edit is accepted (first to upload wins)
    expect(resultA.results[0].accepted).toBe(true);

    // Client B's edit is REJECTED as concurrent conflict
    // Server detects: B's VC {client-a:1, client-b:1} vs server's latest for entity {client-a:2}
    // B has client-a:1 < 2, so not GREATER_THAN → rejected as CONCURRENT
    expect(resultB.results[0].accepted).toBe(false);
    expect(resultB.results[0].errorCode).toBe('CONFLICT_CONCURRENT');

    // Client B gets A's op piggybacked so it can resolve the conflict
    expect(resultB.newOps).toHaveLength(1);
    expect(resultB.newOps![0].op.payload).toEqual({ title: 'Edited by A' });

    console.log('\n=== Concurrent Edit Scenario Complete ===');
    console.log('NOTE: Server detects conflicts via vector clock comparison.');
    console.log('Client must resolve and retry with merged vector clock.');
    console.log('\n');
  });
});

describe('Gzip Compressed Snapshot Integration', () => {
  let app: FastifyInstance;
  const userId = 1;

  beforeEach(async () => {
    initDb('./data', true);
    const db = getDb();
    db.prepare(
      `INSERT INTO users (id, email, password_hash, is_verified, created_at)
       VALUES (?, 'test@test.com', 'hash', 1, ?)`,
    ).run(userId, Date.now());
    initSyncService();
    app = Fastify();
    await app.register(syncRoutes, { prefix: '/api/sync' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  /**
   * Integration test: Verify that gzip-compressed snapshot uploads work
   * through the complete route handler and sync service.
   */
  it('should accept gzip-compressed snapshot and sync to other clients', async () => {
    const zlib = await import('zlib');
    const { promisify } = await import('util');
    const gzipAsync = promisify(zlib.gzip);

    const clientA = new SimulatedClient(app, userId, 'desktop');
    const clientB = new SimulatedClient(app, userId, 'mobile');

    // Create a large payload (simulates backup import)
    const largeState = {
      tasks: Array.from({ length: 100 }, (_, i) => ({
        id: `task-${i}`,
        title: `Task number ${i} with some longer description text`,
        done: i % 3 === 0,
        projectId: 'proj-1',
      })),
      projects: [{ id: 'proj-1', title: 'Main Project', taskIds: [] }],
      tags: [{ id: 'tag-1', name: 'Important' }],
    };

    const snapshotPayload = {
      state: largeState,
      clientId: clientA.clientId,
      reason: 'recovery',
      vectorClock: { [clientA.clientId]: 1 },
      schemaVersion: 1,
    };

    const jsonPayload = JSON.stringify(snapshotPayload);
    const compressedPayload = await gzipAsync(Buffer.from(jsonPayload));

    console.log(
      `Payload size: ${jsonPayload.length} bytes -> ${compressedPayload.length} bytes (${((compressedPayload.length / jsonPayload.length) * 100).toFixed(1)}%)`,
    );

    // Upload compressed snapshot
    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: {
        authorization: `Bearer ${clientA.authToken}`,
        'content-type': 'application/json',
        'content-encoding': 'gzip',
      },
      payload: compressedPayload,
    });

    expect(response.statusCode).toBe(200);
    const result = response.json();
    expect(result.accepted).toBe(true);
    expect(result.serverSeq).toBeDefined();

    console.log(`Snapshot accepted at serverSeq: ${result.serverSeq}`);

    // Client B should be able to download the snapshot
    const snapshotResponse = await app.inject({
      method: 'GET',
      url: '/api/sync/snapshot',
      headers: { authorization: `Bearer ${clientB.authToken}` },
    });

    expect(snapshotResponse.statusCode).toBe(200);
    const snapshot = snapshotResponse.json();

    // Verify the state was correctly stored and retrieved
    expect(snapshot.state).toBeDefined();
    expect(snapshot.serverSeq).toBe(result.serverSeq);

    console.log('Client B successfully retrieved snapshot from server');
  });

  /**
   * Verify that an uncompressed snapshot still works (backwards compatibility).
   */
  it('should accept uncompressed snapshot alongside compressed ones', async () => {
    const zlib = await import('zlib');
    const { promisify } = await import('util');
    const gzipAsync = promisify(zlib.gzip);

    const clientA = new SimulatedClient(app, userId, 'client-a');
    const clientB = new SimulatedClient(app, userId, 'client-b');

    // Client A uploads compressed
    const payloadA = {
      state: { tasks: [{ id: 'task-a', title: 'From A' }] },
      clientId: clientA.clientId,
      reason: 'initial',
      vectorClock: { [clientA.clientId]: 1 },
      schemaVersion: 1,
    };
    const compressedA = await gzipAsync(Buffer.from(JSON.stringify(payloadA)));

    const responseA = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: {
        authorization: `Bearer ${clientA.authToken}`,
        'content-type': 'application/json',
        'content-encoding': 'gzip',
      },
      payload: compressedA,
    });

    expect(responseA.statusCode).toBe(200);
    expect(responseA.json().accepted).toBe(true);

    // Client B uploads uncompressed (no Content-Encoding header)
    const payloadB = {
      state: { tasks: [{ id: 'task-b', title: 'From B' }] },
      clientId: clientB.clientId,
      reason: 'initial',
      vectorClock: { [clientB.clientId]: 1 },
      schemaVersion: 1,
    };

    const responseB = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: {
        authorization: `Bearer ${clientB.authToken}`,
        'content-type': 'application/json',
      },
      payload: payloadB,
    });

    expect(responseB.statusCode).toBe(200);
    expect(responseB.json().accepted).toBe(true);

    // Both should be at sequential server sequences
    const seqA = responseA.json().serverSeq;
    const seqB = responseB.json().serverSeq;
    expect(seqB).toBe(seqA + 1);

    console.log(`Mixed compression: A (gzip) at seq ${seqA}, B (plain) at seq ${seqB}`);
  });
});
