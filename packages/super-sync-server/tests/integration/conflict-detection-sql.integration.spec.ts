/**
 * Integration test for the multi-entity conflict-detection raw SQL (#8334).
 *
 * Runs the ACTUAL `detectConflict` / `prefetchLatestEntityOpsForBatch` functions
 * (not a copy of the SQL, not a mock) against a REAL PostgreSQL database. Unit
 * tests mock `$queryRaw` and can only verify the JS transformation around the
 * query — this verifies the literal SQL: the `entity_ids || ARRAY[entity_id]`
 * unnest, the `&&` / `= ANY` prefilter, the `DISTINCT ON` latest-per-entity pick,
 * and the empty-array → scalar fallback for pre-migration rows.
 *
 * The decisive case is "divergent scalar": a stored op whose scalar `entity_id`
 * is NOT a member of its own `entity_ids`. The previous mutually-exclusive
 * `CASE WHEN cardinality(entity_ids) > 0 THEN entity_ids ELSE ARRAY[entity_id]`
 * dropped that scalar from the batch lookup, so a later concurrent op touching it
 * was wrongly accepted (silent data loss). The union covers it.
 *
 * Prerequisites (same as snapshot-vector-clock-sql.integration.spec.ts):
 *   - PostgreSQL running (see docker-compose.yaml), schema applied (prisma db push)
 *   - DATABASE_URL set, e.g.
 *       postgresql://supersync:superpassword@localhost:55432/supersync_db
 *
 * Run with (uses vitest.integration.config.ts — no mocked-Prisma setupFiles):
 *   DATABASE_URL=postgresql://... npx vitest run --config vitest.integration.config.ts \
 *     tests/integration/conflict-detection-sql.integration.spec.ts
 *
 * NOTE: like the other *.integration.spec.ts files, this is excluded from the
 * default `vitest run` (it needs a real DB) and skipped when DATABASE_URL is
 * unset. GIN index *usage* is not asserted here (the planner seq-scans tiny test
 * tables); it is covered structurally by migration-sql.spec.ts and in production.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import {
  detectConflict,
  prefetchLatestEntityOpsForBatch,
  getEntityConflictKey,
} from '../../src/sync/conflict';
import { Operation, VectorClock } from '../../src/sync/sync.types';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('Multi-entity conflict detection SQL (PostgreSQL) (#8334)', () => {
  let prisma: PrismaClient;
  const TEST_USER_ID = 99998; // Unlikely to collide with real data
  const TEST_EMAIL = `test-conflict-sql-${Date.now()}@test.local`;
  let opCounter = 0;

  // A PrismaClient satisfies the `$queryRaw` surface the conflict functions use.
  const tx = (): Prisma.TransactionClient =>
    prisma as unknown as Prisma.TransactionClient;

  // Insert a stored operation row with an explicit scalar entity_id + entity_ids
  // set, exactly as the upload path persists them.
  const insertOp = async (args: {
    serverSeq: number;
    clientId: string;
    entityId: string;
    entityIds: string[];
    vectorClock: VectorClock;
  }): Promise<void> => {
    opCounter++;
    await prisma.operation.create({
      data: {
        id: `test-conflict-sql-${opCounter}-${Date.now()}`,
        userId: TEST_USER_ID,
        clientId: args.clientId,
        serverSeq: args.serverSeq,
        actionType: '[Task] Update',
        opType: 'UPD',
        entityType: 'TASK',
        entityId: args.entityId,
        entityIds: args.entityIds,
        payload: {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON input; matches sibling integration specs
        vectorClock: args.vectorClock as any,
        schemaVersion: 1,
        clientTimestamp: BigInt(Date.now()),
        receivedAt: BigInt(Date.now()),
      },
    });
  };

  // A multi-entity incoming op forces the raw-SQL path (detectConflictForEntities
  // only runs when ≥2 distinct entity ids are checked). The decoy id never
  // matches a stored row, so any detected conflict comes from the real target.
  const incomingMultiEntityOp = (
    clientId: string,
    targetEntityId: string,
    vectorClock: VectorClock,
  ): Operation => ({
    id: `incoming-${clientId}-${Date.now()}`,
    clientId,
    actionType: '[Task] Update',
    opType: 'UPD',
    entityType: 'TASK',
    entityIds: [targetEntityId, 'task-decoy-unmatched'],
    payload: {},
    vectorClock,
    timestamp: Date.now(),
    schemaVersion: 1,
  });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    await prisma.$connect();
    await prisma.user.create({
      data: { id: TEST_USER_ID, email: TEST_EMAIL, isVerified: 1 },
    });
    await prisma.userSyncState.create({ data: { userId: TEST_USER_ID, lastSeq: 0 } });
  });

  afterAll(async () => {
    await prisma.operation.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.userSyncState.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.operation.deleteMany({ where: { userId: TEST_USER_ID } });
    opCounter = 0;
  });

  it('detects a concurrent conflict on an entity inside a stored op entity_ids set', async () => {
    // Common multi-entity row: entity_id = entityIds[0].
    await insertOp({
      serverSeq: 1,
      clientId: 'A',
      entityId: 'task-a',
      entityIds: ['task-a', 'task-b'],
      vectorClock: { A: 1 },
    });

    // Concurrent op (clocks diverge) touching task-b, which lives in entity_ids.
    const result = await detectConflict(
      TEST_USER_ID,
      incomingMultiEntityOp('B', 'task-b', { B: 1 }),
      tx(),
    );

    expect(result.hasConflict).toBe(true);
    expect(result.conflictType).toBe('concurrent');
  });

  it('detects a conflict on a stored op whose scalar entity_id is NOT in its entity_ids (the union fix)', async () => {
    // Divergent scalar: entity_id='task-z' is absent from entity_ids=['task-a'].
    // The old mutually-exclusive CASE dropped task-z from the batch lookup.
    await insertOp({
      serverSeq: 1,
      clientId: 'A',
      entityId: 'task-z',
      entityIds: ['task-a'],
      vectorClock: { A: 1 },
    });

    const result = await detectConflict(
      TEST_USER_ID,
      incomingMultiEntityOp('B', 'task-z', { B: 1 }),
      tx(),
    );

    // Would be { hasConflict: false } under the pre-fix CASE — silent data loss.
    expect(result.hasConflict).toBe(true);
    expect(result.conflictType).toBe('concurrent');
  });

  it('falls back to the scalar entity_id for pre-migration rows (empty entity_ids)', async () => {
    await insertOp({
      serverSeq: 1,
      clientId: 'A',
      entityId: 'task-p',
      entityIds: [], // pre-migration default '{}'
      vectorClock: { A: 1 },
    });

    const result = await detectConflict(
      TEST_USER_ID,
      incomingMultiEntityOp('B', 'task-p', { B: 1 }),
      tx(),
    );

    expect(result.hasConflict).toBe(true);
    expect(result.conflictType).toBe('concurrent');
  });

  it('does not flag a conflict when the incoming op is a clean successor', async () => {
    await insertOp({
      serverSeq: 1,
      clientId: 'A',
      entityId: 'task-a',
      entityIds: ['task-a', 'task-b'],
      vectorClock: { A: 1 },
    });

    // Same client, dominating clock → GREATER_THAN → no conflict.
    const result = await detectConflict(
      TEST_USER_ID,
      incomingMultiEntityOp('A', 'task-b', { A: 2 }),
      tx(),
    );

    expect(result.hasConflict).toBe(false);
  });

  it('compares against the LATEST stored op per entity (DISTINCT ON / server_seq DESC)', async () => {
    await insertOp({
      serverSeq: 1,
      clientId: 'A',
      entityId: 'task-a',
      entityIds: ['task-a'],
      vectorClock: { A: 1 },
    });
    await insertOp({
      serverSeq: 2,
      clientId: 'A',
      entityId: 'task-a',
      entityIds: ['task-a'],
      vectorClock: { A: 2 },
    });

    const result = await detectConflict(
      TEST_USER_ID,
      incomingMultiEntityOp('B', 'task-a', { B: 1 }),
      tx(),
    );

    expect(result.hasConflict).toBe(true);
    // existingClock must be the seq-2 clock, not seq-1.
    expect(result.existingClock).toEqual({ A: 2 });
  });

  it('does not consider operations from other users', async () => {
    const OTHER_USER_ID = TEST_USER_ID + 1;
    const OTHER_EMAIL = `other-conflict-${Date.now()}@test.local`;
    await prisma.user.create({
      data: { id: OTHER_USER_ID, email: OTHER_EMAIL, isVerified: 1 },
    });
    try {
      await prisma.operation.create({
        data: {
          id: `other-user-op-${Date.now()}`,
          userId: OTHER_USER_ID,
          clientId: 'other',
          serverSeq: 1,
          actionType: '[Task] Update',
          opType: 'UPD',
          entityType: 'TASK',
          entityId: 'task-shared',
          entityIds: ['task-shared'],
          payload: {},
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON input; matches sibling integration specs
          vectorClock: { other: 1 } as any,
          schemaVersion: 1,
          clientTimestamp: BigInt(Date.now()),
          receivedAt: BigInt(Date.now()),
        },
      });

      const result = await detectConflict(
        TEST_USER_ID,
        incomingMultiEntityOp('B', 'task-shared', { B: 1 }),
        tx(),
      );

      // The only writer of task-shared is a different user → no conflict for us.
      expect(result.hasConflict).toBe(false);
    } finally {
      await prisma.operation.deleteMany({ where: { userId: OTHER_USER_ID } });
      await prisma.user.deleteMany({ where: { id: OTHER_USER_ID } });
    }
  });

  it('prefetchLatestEntityOpsForBatch covers a divergent scalar entity_id', async () => {
    await insertOp({
      serverSeq: 1,
      clientId: 'A',
      entityId: 'task-z',
      entityIds: ['task-a'],
      vectorClock: { A: 1 },
    });

    const latestByEntity = await prefetchLatestEntityOpsForBatch(
      TEST_USER_ID,
      [{ entityType: 'TASK', entityId: 'task-z' }],
      tx(),
    );

    // Pre-fix this map was empty (task-z invisible); the union exposes it.
    const row = latestByEntity.get(getEntityConflictKey('TASK', 'task-z'));
    expect(row).toBeDefined();
    expect(row?.clientId).toBe('A');
  });
});
