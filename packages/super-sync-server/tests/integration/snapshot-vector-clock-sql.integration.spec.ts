/**
 * Integration test for the snapshot vector clock SQL aggregate query.
 *
 * This test runs against a REAL PostgreSQL database to verify the raw SQL
 * used in OperationDownloadService.getOpsSinceWithSeq(). Unit tests mock
 * $queryRaw and can only verify the transformation logic — this test verifies
 * the actual SQL syntax, jsonb_each_text expansion, type casts, and filtering.
 *
 * Prerequisites:
 *   - PostgreSQL running (see docker-compose.yaml)
 *   - DATABASE_URL set (e.g., postgresql://supersync:superpassword@localhost:55432/supersync_db)
 *   - Schema applied: npx prisma db push
 *
 * Run with:
 *   DATABASE_URL=postgresql://... npx vitest run tests/integration/snapshot-vector-clock-sql.integration.spec.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { VectorClock, MAX_VECTOR_CLOCK_SIZE } from '../../src/sync/sync.types';

const DATABASE_URL = process.env.DATABASE_URL;

// Skip entire suite if no database is available
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('Snapshot Vector Clock SQL Aggregate (PostgreSQL)', () => {
  let prisma: PrismaClient;
  const TEST_USER_ID = 99999; // Unlikely to collide with real data
  const TEST_EMAIL = `test-vc-sql-${Date.now()}@test.local`;
  let opCounter = 0;

  // Helper: insert a test operation with a specific vector clock
  const insertOp = async (
    serverSeq: number,
    clientId: string,
    vectorClock: VectorClock,
    opType: string = 'UPDATE',
  ) => {
    opCounter++;
    await prisma.operation.create({
      data: {
        id: `test-vc-sql-${opCounter}-${Date.now()}`,
        userId: TEST_USER_ID,
        clientId,
        serverSeq,
        actionType: '[Task] Update',
        opType,
        entityType: 'TASK',
        entityId: `task-${opCounter}`,
        payload: {},
        vectorClock: vectorClock as any,
        schemaVersion: 1,
        clientTimestamp: BigInt(Date.now()),
        receivedAt: BigInt(Date.now()),
      },
    });
  };

  // The actual SQL query from operation-download.service.ts
  const runSnapshotClockQuery = async (
    userId: number,
    latestSnapshotSeq: number,
  ): Promise<VectorClock> => {
    const clockRows = await prisma.$queryRaw<
      Array<{ client_id: string; max_counter: bigint }>
    >`
      SELECT kv.key AS client_id, MAX(kv.value::bigint) AS max_counter
      FROM operations, LATERAL jsonb_each_text(vector_clock) AS kv(key, value)
      WHERE user_id = ${userId}
        AND server_seq <= ${latestSnapshotSeq}
        AND jsonb_typeof(vector_clock) = 'object'
        AND kv.value ~ '^[0-9]+$'
      GROUP BY kv.key
    `;

    const clock: VectorClock = {};
    for (const row of clockRows) {
      clock[row.client_id] = Number(row.max_counter);
    }
    return clock;
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    await prisma.$connect();

    // Create test user
    await prisma.user.create({
      data: {
        id: TEST_USER_ID,
        email: TEST_EMAIL,
        isVerified: 1,
      },
    });

    // Create UserSyncState
    await prisma.userSyncState.create({
      data: {
        userId: TEST_USER_ID,
        lastSeq: 0,
      },
    });
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.operation.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.userSyncState.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clear operations between tests
    await prisma.operation.deleteMany({ where: { userId: TEST_USER_ID } });
    opCounter = 0;
  });

  it('should aggregate max values per client across multiple operations', async () => {
    await insertOp(1, 'A', { A: 1, B: 2 });
    await insertOp(2, 'A', { A: 3, C: 1 });
    await insertOp(3, 'B', { B: 5, C: 2 });

    const clock = await runSnapshotClockQuery(TEST_USER_ID, 3);

    expect(clock).toEqual({
      A: 3, // max(1, 3)
      B: 5, // max(2, 5)
      C: 2, // max(1, 2)
    });
  });

  it('should only include operations up to latestSnapshotSeq', async () => {
    await insertOp(1, 'A', { A: 1 });
    await insertOp(2, 'A', { A: 2 });
    await insertOp(3, 'B', { B: 10 }); // After snapshot — should be excluded

    const clock = await runSnapshotClockQuery(TEST_USER_ID, 2);

    expect(clock).toEqual({ A: 2 });
    expect(clock['B']).toBeUndefined();
  });

  it('should return empty clock when no operations exist', async () => {
    const clock = await runSnapshotClockQuery(TEST_USER_ID, 100);

    expect(clock).toEqual({});
  });

  it('should handle a single operation with a single client', async () => {
    await insertOp(1, 'solo', { solo: 42 });

    const clock = await runSnapshotClockQuery(TEST_USER_ID, 1);

    expect(clock).toEqual({ solo: 42 });
  });

  it('should handle operations with zero-value clock entries', async () => {
    await insertOp(1, 'A', { A: 0, B: 5 });

    const clock = await runSnapshotClockQuery(TEST_USER_ID, 1);

    expect(clock).toEqual({ A: 0, B: 5 });
  });

  it('should handle large counter values within safe integer range', async () => {
    const largeClock = { A: 99999999 }; // Within the 100M sanitization cap
    await insertOp(1, 'A', largeClock);

    const clock = await runSnapshotClockQuery(TEST_USER_ID, 1);

    expect(clock).toEqual({ A: 99999999 });
    expect(typeof clock['A']).toBe('number');
  });

  it('should handle many clients (>MAX_VECTOR_CLOCK_SIZE) in single op', async () => {
    const bigClock: VectorClock = {};
    for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE + 5; i++) {
      bigClock[`client-${i}`] = i + 1;
    }
    await insertOp(1, 'A', bigClock);

    const clock = await runSnapshotClockQuery(TEST_USER_ID, 1);

    // SQL aggregate returns ALL entries — pruning happens in JS (limitVectorClockSize)
    expect(Object.keys(clock).length).toBe(MAX_VECTOR_CLOCK_SIZE + 5);
    expect(clock['client-0']).toBe(1);
    expect(clock[`client-${MAX_VECTOR_CLOCK_SIZE + 4}`]).toBe(MAX_VECTOR_CLOCK_SIZE + 5);
  });

  it('should merge clocks from many operations by different clients', async () => {
    // Simulate realistic multi-client scenario: 5 clients, 20 ops each
    for (let seq = 1; seq <= 100; seq++) {
      const clientIdx = (seq - 1) % 5;
      const clientId = `client-${clientIdx}`;
      const clock: VectorClock = {};
      // Each op carries a clock with the creating client's counter and known counters
      for (let c = 0; c <= clientIdx; c++) {
        clock[`client-${c}`] = seq;
      }
      await insertOp(seq, clientId, clock);
    }

    const clock = await runSnapshotClockQuery(TEST_USER_ID, 100);

    // All 5 clients should be present
    expect(Object.keys(clock).length).toBe(5);
    // Client-0 appears in all clocks, so max should be 100
    expect(clock['client-0']).toBe(100);
  });

  it('should not be affected by operations from other users', async () => {
    // Insert op for our test user
    await insertOp(1, 'A', { A: 10 });

    // Insert op for a different user (need to create that user first)
    const OTHER_USER_ID = TEST_USER_ID + 1;
    const OTHER_EMAIL = `other-${Date.now()}@test.local`;
    await prisma.user.create({
      data: { id: OTHER_USER_ID, email: OTHER_EMAIL, isVerified: 1 },
    });
    try {
      await prisma.operation.create({
        data: {
          id: `other-user-op-${Date.now()}`,
          userId: OTHER_USER_ID,
          clientId: 'other-client',
          serverSeq: 1,
          actionType: '[Task] Add',
          opType: 'ADD',
          entityType: 'TASK',
          entityId: 'task-other',
          payload: {},
          vectorClock: { 'other-client': 999 } as any,
          schemaVersion: 1,
          clientTimestamp: BigInt(Date.now()),
          receivedAt: BigInt(Date.now()),
        },
      });

      const clock = await runSnapshotClockQuery(TEST_USER_ID, 1);

      // Should only contain our user's data
      expect(clock).toEqual({ A: 10 });
      expect(clock['other-client']).toBeUndefined();
    } finally {
      await prisma.operation.deleteMany({ where: { userId: OTHER_USER_ID } });
      await prisma.user.deleteMany({ where: { id: OTHER_USER_ID } });
    }
  });

  it('should handle SYNC_IMPORT operation alongside regular ops', async () => {
    await insertOp(1, 'A', { A: 5, B: 3 });
    await insertOp(2, 'B', { A: 4, B: 7 });
    await insertOp(3, 'A', { A: 8 }, 'SYNC_IMPORT'); // Full-state op

    const clock = await runSnapshotClockQuery(TEST_USER_ID, 3);

    expect(clock).toEqual({
      A: 8, // max(5, 4, 8)
      B: 7, // max(3, 7)
    });
  });
});
