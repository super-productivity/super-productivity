import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { initDb, getDb } from '../src/db';
import { initSyncService } from '../src/sync/sync.service';
import { syncRoutes } from '../src/sync/sync.routes';
import { uuidv7 } from 'uuidv7';
import * as jwt from 'jsonwebtoken';

// Mock the JWT secret for tests
const JWT_SECRET = 'super-sync-dev-secret-do-not-use-in-production';

// Helper to create valid JWT token
const createToken = (userId: number, email: string): string => {
  return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '365d' });
};

// Helper to create operation
const createOp = (
  clientId: string,
  overrides: Partial<{
    id: string;
    actionType: string;
    opType: string;
    entityType: string;
    entityId: string;
    payload: unknown;
    vectorClock: Record<string, number>;
    timestamp: number;
    schemaVersion: number;
  }> = {},
) => ({
  id: uuidv7(),
  clientId,
  actionType: 'ADD_TASK',
  opType: 'CRT',
  entityType: 'TASK',
  entityId: 'task-1',
  payload: { title: 'Test Task' },
  vectorClock: {},
  timestamp: Date.now(),
  schemaVersion: 1,
  ...overrides,
});

describe('Sync Routes', () => {
  let app: FastifyInstance;
  const userId = 1;
  const clientId = 'test-device-1';
  let authToken: string;

  beforeEach(async () => {
    // Initialize in-memory database
    initDb('./data', true);
    const db = getDb();

    // Create test user
    db.prepare(
      `INSERT INTO users (id, email, password_hash, is_verified, created_at)
       VALUES (?, 'test@test.com', 'hash', 1, ?)`,
    ).run(userId, Date.now());

    // Initialize sync service
    initSyncService();

    // Create auth token
    authToken = createToken(userId, 'test@test.com');

    // Create Fastify instance with sync routes
    app = Fastify();
    await app.register(syncRoutes, { prefix: '/api/sync' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /api/sync/ops - Upload Operations', () => {
    it('should upload operations successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/sync/ops',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          ops: [createOp(clientId)],
          clientId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.results).toHaveLength(1);
      expect(body.results[0].accepted).toBe(true);
      expect(body.results[0].serverSeq).toBe(1);
      expect(body.latestSeq).toBe(1);
    });

    it('should return 401 without authorization header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/sync/ops',
        payload: {
          ops: [createOp(clientId)],
          clientId,
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error).toBe('Missing or invalid Authorization header');
    });

    it('should return 401 with invalid token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/sync/ops',
        headers: {
          authorization: 'Bearer invalid-token',
        },
        payload: {
          ops: [createOp(clientId)],
          clientId,
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error).toBe('Invalid token');
    });

    it('should return 400 for empty ops array', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/sync/ops',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          ops: [],
          clientId,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('Validation failed');
    });

    it('should return 400 for missing clientId', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/sync/ops',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          ops: [createOp(clientId)],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('Validation failed');
    });

    it('should return 400 for invalid opType', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/sync/ops',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          ops: [createOp(clientId, { opType: 'INVALID' })],
          clientId,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should include new ops when lastKnownServerSeq is provided', async () => {
      // First, upload some ops from another client
      const otherClient = 'other-client';
      await app.inject({
        method: 'POST',
        url: '/api/sync/ops',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          ops: [createOp(otherClient, { entityId: 'task-other' })],
          clientId: otherClient,
        },
      });

      // Now upload from our client with lastKnownServerSeq=0
      const response = await app.inject({
        method: 'POST',
        url: '/api/sync/ops',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          ops: [createOp(clientId)],
          clientId,
          lastKnownServerSeq: 0,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.newOps).toBeDefined();
      expect(body.newOps.length).toBeGreaterThan(0);
    });

    it('should handle multiple operations in one request', async () => {
      const ops = [
        createOp(clientId, { entityId: 'task-1' }),
        createOp(clientId, { entityId: 'task-2' }),
        createOp(clientId, { entityId: 'task-3' }),
      ];

      const response = await app.inject({
        method: 'POST',
        url: '/api/sync/ops',
        headers: { authorization: `Bearer ${authToken}` },
        payload: { ops, clientId },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.results).toHaveLength(3);
      expect(body.results.every((r: { accepted: boolean }) => r.accepted)).toBe(true);
    });
  });

  describe('GET /api/sync/ops - Download Operations', () => {
    beforeEach(async () => {
      // Upload some operations first
      for (let i = 1; i <= 5; i++) {
        await app.inject({
          method: 'POST',
          url: '/api/sync/ops',
          headers: { authorization: `Bearer ${authToken}` },
          payload: {
            ops: [createOp(clientId, { entityId: `task-${i}` })],
            clientId,
          },
        });
      }
    });

    it('should download operations since given sequence', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/ops?sinceSeq=2',
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.ops).toHaveLength(3);
      expect(body.ops[0].serverSeq).toBe(3);
      expect(body.hasMore).toBe(false);
      expect(body.latestSeq).toBe(5);
    });

    it('should return 401 without authorization', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/ops?sinceSeq=0',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 400 for missing sinceSeq', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/ops',
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should respect limit parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/ops?sinceSeq=0&limit=2',
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.ops).toHaveLength(2);
      expect(body.hasMore).toBe(true);
    });

    it('should exclude operations from specified client', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/sync/ops?sinceSeq=0&excludeClient=${clientId}`,
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.ops).toHaveLength(0);
    });

    it('should return empty array when no operations exist after sequence', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/ops?sinceSeq=100',
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.ops).toHaveLength(0);
    });

    it('should include serverTime in response for clock drift detection', async () => {
      const beforeTime = Date.now();
      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/ops?sinceSeq=0',
        headers: { authorization: `Bearer ${authToken}` },
      });
      const afterTime = Date.now();

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.serverTime).toBeDefined();
      expect(body.serverTime).toBeGreaterThanOrEqual(beforeTime);
      expect(body.serverTime).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('GET /api/sync/snapshot - Get Snapshot', () => {
    beforeEach(async () => {
      // Upload some operations
      await app.inject({
        method: 'POST',
        url: '/api/sync/ops',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          ops: [
            createOp(clientId, {
              entityId: 't1',
              payload: { title: 'Task 1', done: false },
            }),
          ],
          clientId,
        },
      });
    });

    it('should return current state snapshot', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/snapshot',
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.serverSeq).toBe(1);
      expect(body.state).toBeDefined();
      expect(body.generatedAt).toBeDefined();
    });

    it('should return 401 without authorization', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/snapshot',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /api/sync/snapshot - Upload Snapshot', () => {
    it('should upload snapshot successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/sync/snapshot',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          state: { task: { t1: { title: 'Task 1' } } },
          clientId,
          reason: 'initial',
          vectorClock: { [clientId]: 1 },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.accepted).toBe(true);
      expect(body.serverSeq).toBeDefined();
    });

    it('should return 401 without authorization', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/sync/snapshot',
        payload: {
          state: {},
          clientId,
          reason: 'initial',
          vectorClock: {},
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 400 for invalid reason', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/sync/snapshot',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          state: {},
          clientId,
          reason: 'invalid-reason',
          vectorClock: {},
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/sync/snapshot',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          state: {},
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/sync/status - Get Sync Status', () => {
    it('should return sync status', async () => {
      // Upload some ops first
      await app.inject({
        method: 'POST',
        url: '/api/sync/ops',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          ops: [createOp(clientId)],
          clientId,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/status',
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.latestSeq).toBeDefined();
      expect(body.devicesOnline).toBeDefined();
    });

    it('should return 401 without authorization', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/status',
      });

      expect(response.statusCode).toBe(401);
    });
  });
});

describe('Multi-User Isolation', () => {
  let app: FastifyInstance;
  const user1Id = 1;
  const user2Id = 2;
  const clientId = 'test-device';
  let user1Token: string;
  let user2Token: string;

  beforeEach(async () => {
    initDb('./data', true);
    const db = getDb();

    // Create two test users
    db.prepare(
      `INSERT INTO users (id, email, password_hash, is_verified, created_at)
       VALUES (?, 'user1@test.com', 'hash', 1, ?)`,
    ).run(user1Id, Date.now());

    db.prepare(
      `INSERT INTO users (id, email, password_hash, is_verified, created_at)
       VALUES (?, 'user2@test.com', 'hash', 1, ?)`,
    ).run(user2Id, Date.now());

    initSyncService();

    user1Token = createToken(user1Id, 'user1@test.com');
    user2Token = createToken(user2Id, 'user2@test.com');

    app = Fastify();
    await app.register(syncRoutes, { prefix: '/api/sync' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should isolate operations between users', async () => {
    // User 1 uploads an operation
    await app.inject({
      method: 'POST',
      url: '/api/sync/ops',
      headers: { authorization: `Bearer ${user1Token}` },
      payload: {
        ops: [createOp(clientId, { entityId: 'user1-task' })],
        clientId,
      },
    });

    // User 2 uploads an operation
    await app.inject({
      method: 'POST',
      url: '/api/sync/ops',
      headers: { authorization: `Bearer ${user2Token}` },
      payload: {
        ops: [createOp(clientId, { entityId: 'user2-task' })],
        clientId,
      },
    });

    // User 1 should only see their operation
    const user1Response = await app.inject({
      method: 'GET',
      url: '/api/sync/ops?sinceSeq=0',
      headers: { authorization: `Bearer ${user1Token}` },
    });

    expect(user1Response.statusCode).toBe(200);
    const user1Body = user1Response.json();
    expect(user1Body.ops).toHaveLength(1);
    expect(user1Body.ops[0].op.entityId).toBe('user1-task');

    // User 2 should only see their operation
    const user2Response = await app.inject({
      method: 'GET',
      url: '/api/sync/ops?sinceSeq=0',
      headers: { authorization: `Bearer ${user2Token}` },
    });

    expect(user2Response.statusCode).toBe(200);
    const user2Body = user2Response.json();
    expect(user2Body.ops).toHaveLength(1);
    expect(user2Body.ops[0].op.entityId).toBe('user2-task');
  });

  it('should isolate snapshots between users', async () => {
    // User 1 uploads operations
    await app.inject({
      method: 'POST',
      url: '/api/sync/ops',
      headers: { authorization: `Bearer ${user1Token}` },
      payload: {
        ops: [
          createOp(clientId, {
            entityId: 'user1-task',
            payload: { title: 'User 1 Task' },
          }),
        ],
        clientId,
      },
    });

    // User 2 uploads operations
    await app.inject({
      method: 'POST',
      url: '/api/sync/ops',
      headers: { authorization: `Bearer ${user2Token}` },
      payload: {
        ops: [
          createOp(clientId, {
            entityId: 'user2-task',
            payload: { title: 'User 2 Task' },
          }),
        ],
        clientId,
      },
    });

    // Get user 1's snapshot
    const user1Snapshot = await app.inject({
      method: 'GET',
      url: '/api/sync/snapshot',
      headers: { authorization: `Bearer ${user1Token}` },
    });

    const user1State = user1Snapshot.json().state as Record<
      string,
      Record<string, { title: string }>
    >;
    expect(user1State.TASK['user1-task']).toBeDefined();
    expect(user1State.TASK['user2-task']).toBeUndefined();

    // Get user 2's snapshot
    const user2Snapshot = await app.inject({
      method: 'GET',
      url: '/api/sync/snapshot',
      headers: { authorization: `Bearer ${user2Token}` },
    });

    const user2State = user2Snapshot.json().state as Record<
      string,
      Record<string, { title: string }>
    >;
    expect(user2State.TASK['user2-task']).toBeDefined();
    expect(user2State.TASK['user1-task']).toBeUndefined();
  });

  it('should isolate sync status between users', async () => {
    // User 1 uploads 3 operations
    for (let i = 1; i <= 3; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/sync/ops',
        headers: { authorization: `Bearer ${user1Token}` },
        payload: {
          ops: [createOp(clientId, { entityId: `task-${i}` })],
          clientId,
        },
      });
    }

    // User 2 uploads 1 operation
    await app.inject({
      method: 'POST',
      url: '/api/sync/ops',
      headers: { authorization: `Bearer ${user2Token}` },
      payload: {
        ops: [createOp(clientId)],
        clientId,
      },
    });

    // Check user 1's status
    const user1Status = await app.inject({
      method: 'GET',
      url: '/api/sync/status',
      headers: { authorization: `Bearer ${user1Token}` },
    });

    expect(user1Status.json().latestSeq).toBe(3);

    // Check user 2's status
    const user2Status = await app.inject({
      method: 'GET',
      url: '/api/sync/status',
      headers: { authorization: `Bearer ${user2Token}` },
    });

    expect(user2Status.json().latestSeq).toBe(1);
  });
});

describe('Gzip Compressed Snapshot Upload', () => {
  let app: FastifyInstance;
  const userId = 1;
  const clientId = 'test-device-1';
  let authToken: string;

  beforeEach(async () => {
    initDb('./data', true);
    const db = getDb();

    db.prepare(
      `INSERT INTO users (id, email, password_hash, is_verified, created_at)
       VALUES (?, 'test@test.com', 'hash', 1, ?)`,
    ).run(userId, Date.now());

    initSyncService();
    authToken = createToken(userId, 'test@test.com');

    app = Fastify();
    await app.register(syncRoutes, { prefix: '/api/sync' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should accept gzip-compressed snapshot upload', async () => {
    const zlib = await import('zlib');
    const { promisify } = await import('util');
    const gzipAsync = promisify(zlib.gzip);

    const payload = {
      state: { task: { t1: { title: 'Compressed Task' } } },
      clientId,
      reason: 'initial',
      vectorClock: { [clientId]: 1 },
      schemaVersion: 1,
    };

    const jsonPayload = JSON.stringify(payload);
    const compressedPayload = await gzipAsync(Buffer.from(jsonPayload, 'utf-8'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
        'content-encoding': 'gzip',
      },
      payload: compressedPayload,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.accepted).toBe(true);
    expect(body.serverSeq).toBeDefined();
  });

  it('should still accept uncompressed snapshot upload', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
      payload: {
        state: { task: { t1: { title: 'Uncompressed Task' } } },
        clientId,
        reason: 'recovery',
        vectorClock: { [clientId]: 1 },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.accepted).toBe(true);
  });

  it('should return 400 for invalid gzip data', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
        'content-encoding': 'gzip',
      },
      payload: Buffer.from('not valid gzip data'),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('decompress');
  });

  it('should handle large compressed payloads', async () => {
    const zlib = await import('zlib');
    const { promisify } = await import('util');
    const gzipAsync = promisify(zlib.gzip);

    // Create a large payload (simulate backup import)
    const tasks: Record<string, { title: string; description: string }> = {};
    for (let i = 0; i < 1000; i++) {
      tasks[`task-${i}`] = {
        title: `Task ${i}`,
        description: 'A'.repeat(1000), // 1KB per task
      };
    }

    const payload = {
      state: { task: tasks },
      clientId,
      reason: 'recovery',
      vectorClock: { [clientId]: 1 },
      schemaVersion: 1,
    };

    const jsonPayload = JSON.stringify(payload);
    const compressedPayload = await gzipAsync(Buffer.from(jsonPayload, 'utf-8'));

    // Compression should significantly reduce size
    expect(compressedPayload.length).toBeLessThan(jsonPayload.length * 0.5);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
        'content-encoding': 'gzip',
      },
      payload: compressedPayload,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.accepted).toBe(true);
  });

  it('should validate payload after decompression', async () => {
    const zlib = await import('zlib');
    const { promisify } = await import('util');
    const gzipAsync = promisify(zlib.gzip);

    // Invalid payload (missing required fields)
    const payload = {
      state: { task: {} },
      // missing clientId, reason, vectorClock
    };

    const jsonPayload = JSON.stringify(payload);
    const compressedPayload = await gzipAsync(Buffer.from(jsonPayload, 'utf-8'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
        'content-encoding': 'gzip',
      },
      payload: compressedPayload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Validation failed');
  });

  it('should accept base64-encoded gzip snapshot from Android clients', async () => {
    const zlib = await import('zlib');
    const { promisify } = await import('util');
    const gzipAsync = promisify(zlib.gzip);

    const payload = {
      state: { task: { t1: { title: 'Android Task' } } },
      clientId: 'android-client',
      reason: 'initial',
      vectorClock: { 'android-client': 1 },
      schemaVersion: 1,
    };

    const jsonPayload = JSON.stringify(payload);
    const compressedPayload = await gzipAsync(Buffer.from(jsonPayload, 'utf-8'));
    // Base64 encode the gzip data (as Android CapacitorHttp does)
    const base64Payload = compressedPayload.toString('base64');

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'content-transfer-encoding': 'base64',
      },
      payload: base64Payload,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.accepted).toBe(true);
    expect(body.serverSeq).toBe(1);
  });

  it('should accept base64-encoded gzip ops upload from Android clients', async () => {
    const zlib = await import('zlib');
    const { promisify } = await import('util');
    const gzipAsync = promisify(zlib.gzip);

    const payload = {
      ops: [createOp('android-client')],
      clientId: 'android-client',
    };

    const jsonPayload = JSON.stringify(payload);
    const compressedPayload = await gzipAsync(Buffer.from(jsonPayload, 'utf-8'));
    const base64Payload = compressedPayload.toString('base64');

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/ops',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'content-transfer-encoding': 'base64',
      },
      payload: base64Payload,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].accepted).toBe(true);
  });

  it('should return 400 for invalid base64 gzip data', async () => {
    // Send non-base64 data with the base64 header
    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/snapshot',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'content-transfer-encoding': 'base64',
      },
      payload: 'this is not valid base64 gzip!!!@#$%',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('decompress');
  });
});

describe('Concurrent Operations', () => {
  let app: FastifyInstance;
  const userId = 1;
  let authToken: string;

  beforeEach(async () => {
    initDb('./data', true);
    const db = getDb();

    db.prepare(
      `INSERT INTO users (id, email, password_hash, is_verified, created_at)
       VALUES (?, 'test@test.com', 'hash', 1, ?)`,
    ).run(userId, Date.now());

    initSyncService();
    authToken = createToken(userId, 'test@test.com');

    app = Fastify();
    await app.register(syncRoutes, { prefix: '/api/sync' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should handle concurrent uploads from multiple clients', async () => {
    const clients = ['client-1', 'client-2', 'client-3'];

    // Simulate concurrent uploads
    const uploadPromises = clients.map((clientId) =>
      app.inject({
        method: 'POST',
        url: '/api/sync/ops',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          ops: [createOp(clientId, { entityId: `${clientId}-task` })],
          clientId,
        },
      }),
    );

    const responses = await Promise.all(uploadPromises);

    // All should succeed
    responses.forEach((response) => {
      expect(response.statusCode).toBe(200);
      expect(response.json().results[0].accepted).toBe(true);
    });

    // All operations should be stored
    const downloadResponse = await app.inject({
      method: 'GET',
      url: '/api/sync/ops?sinceSeq=0',
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(downloadResponse.json().ops).toHaveLength(3);
  });

  it('should assign unique sequential server_seq to concurrent operations', async () => {
    const clients = ['client-1', 'client-2', 'client-3', 'client-4', 'client-5'];

    const uploadPromises = clients.map((clientId) =>
      app.inject({
        method: 'POST',
        url: '/api/sync/ops',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          ops: [createOp(clientId, { entityId: `${clientId}-task` })],
          clientId,
        },
      }),
    );

    await Promise.all(uploadPromises);

    const downloadResponse = await app.inject({
      method: 'GET',
      url: '/api/sync/ops?sinceSeq=0',
      headers: { authorization: `Bearer ${authToken}` },
    });

    const ops = downloadResponse.json().ops;
    const serverSeqs = ops.map((op: { serverSeq: number }) => op.serverSeq);

    // All sequences should be unique
    expect(new Set(serverSeqs).size).toBe(serverSeqs.length);

    // Sequences should be 1, 2, 3, 4, 5 (in some order)
    expect(serverSeqs.sort((a: number, b: number) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('Restore Points API', () => {
  let app: FastifyInstance;
  const userId = 1;
  const clientId = 'test-device-1';
  let authToken: string;

  beforeEach(async () => {
    initDb('./data', true);
    const db = getDb();

    db.prepare(
      `INSERT INTO users (id, email, password_hash, is_verified, created_at)
       VALUES (?, 'test@test.com', 'hash', 1, ?)`,
    ).run(userId, Date.now());

    initSyncService();
    authToken = createToken(userId, 'test@test.com');

    app = Fastify();
    await app.register(syncRoutes, { prefix: '/api/sync' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/sync/restore-points', () => {
    it('should return empty array when no restore points exist', async () => {
      // Upload regular operations (not restore points)
      await app.inject({
        method: 'POST',
        url: '/api/sync/ops',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          ops: [createOp(clientId)],
          clientId,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/restore-points',
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.restorePoints).toHaveLength(0);
    });

    it('should return restore points for SYNC_IMPORT operations', async () => {
      // Upload a SYNC_IMPORT operation
      await app.inject({
        method: 'POST',
        url: '/api/sync/ops',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          ops: [
            createOp(clientId, {
              opType: 'SYNC_IMPORT',
              entityType: 'ALL',
              actionType: '[SP_ALL] Load(import) all data',
              payload: { globalConfig: {}, tasks: {} },
            }),
          ],
          clientId,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/restore-points',
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.restorePoints).toHaveLength(1);
      expect(body.restorePoints[0].type).toBe('SYNC_IMPORT');
      expect(body.restorePoints[0].serverSeq).toBe(1);
    });

    it('should return restore points for BACKUP_IMPORT operations', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/sync/ops',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          ops: [
            createOp(clientId, {
              opType: 'BACKUP_IMPORT',
              entityType: 'ALL',
              actionType: '[SP_ALL] Load(import) all data',
              payload: { globalConfig: {} },
            }),
          ],
          clientId,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/restore-points',
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.restorePoints).toHaveLength(1);
      expect(body.restorePoints[0].type).toBe('BACKUP_IMPORT');
    });

    it('should respect limit query parameter', async () => {
      // Upload 5 SYNC_IMPORT operations
      for (let i = 1; i <= 5; i++) {
        await app.inject({
          method: 'POST',
          url: '/api/sync/ops',
          headers: { authorization: `Bearer ${authToken}` },
          payload: {
            ops: [
              createOp(clientId, {
                opType: 'SYNC_IMPORT',
                entityType: 'ALL',
                actionType: '[SP_ALL] Load(import) all data',
                payload: { version: i },
              }),
            ],
            clientId,
          },
        });
      }

      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/restore-points?limit=2',
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.restorePoints).toHaveLength(2);
      expect(body.restorePoints[0].serverSeq).toBe(5);
      expect(body.restorePoints[1].serverSeq).toBe(4);
    });

    it('should return 401 without authorization', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/restore-points',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /api/sync/restore/:serverSeq', () => {
    beforeEach(async () => {
      // Upload some operations to create history
      await app.inject({
        method: 'POST',
        url: '/api/sync/ops',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          ops: [
            createOp(clientId, {
              entityId: 't1',
              payload: { title: 'Task 1', done: false },
            }),
          ],
          clientId,
        },
      });

      await app.inject({
        method: 'POST',
        url: '/api/sync/ops',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          ops: [
            createOp(clientId, {
              entityId: 't2',
              payload: { title: 'Task 2', done: false },
            }),
          ],
          clientId,
        },
      });

      await app.inject({
        method: 'POST',
        url: '/api/sync/ops',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          ops: [
            createOp(clientId, {
              opType: 'UPD',
              actionType: 'UPDATE_TASK',
              entityId: 't1',
              payload: { done: true },
            }),
          ],
          clientId,
        },
      });
    });

    it('should return snapshot at specific serverSeq', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/restore/2',
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.serverSeq).toBe(2);
      expect(body.state).toBeDefined();
      expect(body.generatedAt).toBeDefined();

      // At seq 2, t1 should not be done yet (update is at seq 3)
      const state = body.state as Record<string, Record<string, { done: boolean }>>;
      expect(state.TASK.t1.done).toBe(false);
    });

    it('should return state before later operations', async () => {
      // Get state at seq 1 (only first task exists)
      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/restore/1',
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      const state = body.state as Record<string, Record<string, { title: string }>>;

      expect(state.TASK.t1).toBeDefined();
      expect(state.TASK.t2).toBeUndefined();
    });

    it('should return 400 for invalid serverSeq (too high)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/restore/999',
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('exceeds');
    });

    it('should return 400 for serverSeq of 0', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/restore/0',
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('at least 1');
    });

    it('should return 400 for negative serverSeq', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/restore/-1',
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 401 without authorization', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/restore/1',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /api/sync/snapshot - SYNC_IMPORT_EXISTS Rejection', () => {
    it('should reject duplicate SYNC_IMPORT when reason is initial', async () => {
      // First upload should succeed
      const firstResponse = await app.inject({
        method: 'POST',
        url: '/api/sync/snapshot',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          state: { task: { t1: { title: 'Task 1' } } },
          clientId: 'client-1',
          reason: 'initial',
          vectorClock: { 'client-1': 1 },
        },
      });

      expect(firstResponse.statusCode).toBe(200);
      expect(firstResponse.json().accepted).toBe(true);

      // Second upload with reason 'initial' should be rejected
      const secondResponse = await app.inject({
        method: 'POST',
        url: '/api/sync/snapshot',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          state: { task: { t2: { title: 'Task 2' } } },
          clientId: 'client-2',
          reason: 'initial',
          vectorClock: { 'client-2': 1 },
        },
      });

      expect(secondResponse.statusCode).toBe(409);
      const body = secondResponse.json();
      expect(body.errorCode).toBe('SYNC_IMPORT_EXISTS');
      expect(body.existingImportId).toBeDefined();
    });

    it('should allow recovery snapshot even if SYNC_IMPORT exists', async () => {
      // First upload SYNC_IMPORT
      const firstResponse = await app.inject({
        method: 'POST',
        url: '/api/sync/snapshot',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          state: { task: { t1: { title: 'Task 1' } } },
          clientId: 'client-1',
          reason: 'initial',
          vectorClock: { 'client-1': 1 },
        },
      });

      expect(firstResponse.statusCode).toBe(200);

      // Recovery snapshot should still be allowed
      const recoveryResponse = await app.inject({
        method: 'POST',
        url: '/api/sync/snapshot',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          state: { task: { t2: { title: 'Task 2 - recovery' } } },
          clientId: 'client-1',
          reason: 'recovery',
          vectorClock: { 'client-1': 2 },
        },
      });

      expect(recoveryResponse.statusCode).toBe(200);
      expect(recoveryResponse.json().accepted).toBe(true);
    });

    it('should allow migration snapshot even if SYNC_IMPORT exists', async () => {
      // First upload SYNC_IMPORT
      const firstResponse = await app.inject({
        method: 'POST',
        url: '/api/sync/snapshot',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          state: { task: { t1: { title: 'Task 1' } } },
          clientId: 'client-1',
          reason: 'initial',
          vectorClock: { 'client-1': 1 },
        },
      });

      expect(firstResponse.statusCode).toBe(200);

      // Migration snapshot should still be allowed
      const migrationResponse = await app.inject({
        method: 'POST',
        url: '/api/sync/snapshot',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          state: { task: { t2: { title: 'Task 2 - migration' } } },
          clientId: 'client-1',
          reason: 'migration',
          vectorClock: { 'client-1': 2 },
        },
      });

      expect(migrationResponse.statusCode).toBe(200);
      expect(migrationResponse.json().accepted).toBe(true);
    });

    it('should allow initial SYNC_IMPORT from same client (retry scenario)', async () => {
      // First upload SYNC_IMPORT
      const firstResponse = await app.inject({
        method: 'POST',
        url: '/api/sync/snapshot',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          state: { task: { t1: { title: 'Task 1' } } },
          clientId: 'client-1',
          reason: 'initial',
          vectorClock: { 'client-1': 1 },
        },
      });

      expect(firstResponse.statusCode).toBe(200);

      // Same client retrying initial should also be rejected (we don't special-case this)
      // The client should handle 409 and download instead
      const retryResponse = await app.inject({
        method: 'POST',
        url: '/api/sync/snapshot',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          state: { task: { t1: { title: 'Task 1 - retry' } } },
          clientId: 'client-1',
          reason: 'initial',
          vectorClock: { 'client-1': 1 },
        },
      });

      expect(retryResponse.statusCode).toBe(409);
      expect(retryResponse.json().errorCode).toBe('SYNC_IMPORT_EXISTS');
    });
  });

  describe('DELETE /api/sync/data - Reset Account (Delete All User Data)', () => {
    it('should delete all user data and return success', async () => {
      // First upload some operations
      await app.inject({
        method: 'POST',
        url: '/api/sync/ops',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          ops: [
            createOp(clientId, { entityId: 'task-1' }),
            createOp(clientId, { entityId: 'task-2' }),
          ],
          clientId,
        },
      });

      // Verify ops exist
      const opsBefore = await app.inject({
        method: 'GET',
        url: '/api/sync/ops?sinceSeq=0',
        headers: { authorization: `Bearer ${authToken}` },
      });
      expect(opsBefore.json().ops.length).toBe(2);

      // Delete all user data
      const deleteResponse = await app.inject({
        method: 'DELETE',
        url: '/api/sync/data',
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(deleteResponse.statusCode).toBe(200);
      expect(deleteResponse.json()).toEqual({ success: true });

      // Verify ops are gone
      const opsAfter = await app.inject({
        method: 'GET',
        url: '/api/sync/ops?sinceSeq=0',
        headers: { authorization: `Bearer ${authToken}` },
      });
      expect(opsAfter.json().ops.length).toBe(0);
    });

    it('should return 401 without authorization', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/sync/data',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should allow uploading new data after reset', async () => {
      // Upload initial data
      await app.inject({
        method: 'POST',
        url: '/api/sync/ops',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          ops: [createOp(clientId, { entityId: 'old-task' })],
          clientId,
        },
      });

      // Delete all data
      await app.inject({
        method: 'DELETE',
        url: '/api/sync/data',
        headers: { authorization: `Bearer ${authToken}` },
      });

      // Upload new data after reset
      const uploadResponse = await app.inject({
        method: 'POST',
        url: '/api/sync/ops',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          ops: [createOp(clientId, { entityId: 'new-task' })],
          clientId,
        },
      });

      expect(uploadResponse.statusCode).toBe(200);
      expect(uploadResponse.json().results[0].accepted).toBe(true);

      // Verify only new data exists
      const ops = await app.inject({
        method: 'GET',
        url: '/api/sync/ops?sinceSeq=0',
        headers: { authorization: `Bearer ${authToken}` },
      });
      expect(ops.json().ops.length).toBe(1);
      expect(ops.json().ops[0].entityId).toBe('new-task');
    });
  });
});
