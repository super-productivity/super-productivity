/**
 * Real-PostgreSQL coverage that concurrent uploads for one account get unique,
 * gap-free `server_seq` values.
 *
 * Each upload increments `user_sync_state.last_seq` under `SELECT ... FOR
 * UPDATE` inside a RepeatableRead transaction (`SyncService.uploadOps`). Under
 * contention a loser fails with a serialization error and the whole batch is
 * rejected as retryable (`INTERNAL_ERROR`, "Concurrent transaction conflict").
 * The invariant this pins: an accepted op's sequence is unique, the stored
 * sequence has no gaps, and a rejected batch stores nothing. Mocked Prisma
 * cannot show any of that; it replaced the legacy multi-client suite's
 * simultaneous-upload cases.
 *
 * Prerequisites:
 *   `npm run supersync:db` — publishes the db on 55432 and applies the schema.
 *
 * Run with:
 *   DATABASE_URL=postgresql://supersync:superpassword@localhost:55432/supersync_db \
 *     npx vitest run --config vitest.integration.config.ts \
 *     tests/integration/concurrent-upload-seq.integration.spec.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db';
import { SyncService } from '../../src/sync/sync.service';
import { Operation, SYNC_ERROR_CODES, UploadResult } from '../../src/sync/sync.types';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

const CLIENTS = 8;
const OPS_PER_UPLOAD = 5;
const MAX_ATTEMPTS = 50;

describeWithDb('Concurrent uploads get unique, gap-free server_seq (PostgreSQL)', () => {
  const TEST_USER_ID = 99994;
  const TEST_EMAIL = `test-concurrent-upload-seq-${Date.now()}@test.local`;

  const makeOps = (clientId: string): Operation[] =>
    Array.from({ length: OPS_PER_UPLOAD }, (_, i) => ({
      id: `${clientId}-op-${i}-${Math.random().toString(36).slice(2, 8)}`,
      clientId,
      actionType: '[Task] Add',
      opType: 'CRT',
      entityType: 'TASK',
      // Distinct entities: only sequencing is under test, not conflict detection.
      entityId: `${clientId}-task-${i}`,
      payload: { title: `Task ${i} from ${clientId}` },
      vectorClock: { [clientId]: i + 1 },
      timestamp: Date.now(),
      schemaVersion: 1,
    }));

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });
    await prisma.user.create({
      data: { id: TEST_USER_ID, email: TEST_EMAIL, isVerified: 1 },
    });
    await prisma.userSyncState.create({ data: { userId: TEST_USER_ID, lastSeq: 0 } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.operation.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.syncDevice.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.userSyncState.update({
      where: { userId: TEST_USER_ID },
      data: { lastSeq: 0, latestStateReplacementSeq: null },
    });
  });

  it('sequences simultaneous uploads from several clients without duplicates or gaps', async () => {
    const service = new SyncService();
    const uploads = Array.from({ length: CLIENTS }, (_, c) => {
      const clientId = `concurrent-seq-client-${c}`;
      return { clientId, ops: makeOps(clientId) };
    });

    const accepted = new Map<string, number>();
    let transientRejections = 0;
    let pending = uploads;
    for (let attempt = 0; pending.length > 0; attempt++) {
      expect(attempt).toBeLessThan(MAX_ATTEMPTS);
      const results = await Promise.all(
        pending.map(({ clientId, ops }) =>
          service.uploadOps(TEST_USER_ID, clientId, ops),
        ),
      );
      const retry: typeof uploads = [];
      results.forEach((batch: UploadResult[], i) => {
        if (batch.every((r) => r.accepted)) {
          for (const r of batch) accepted.set(r.opId, r.serverSeq as number);
          return;
        }
        // A batch is all-or-nothing: the loser of a serialization conflict is
        // rejected whole as retryable, like a client would see it.
        expect(batch.every((r) => !r.accepted)).toBe(true);
        for (const r of batch) {
          expect(r.errorCode).toBe(SYNC_ERROR_CODES.INTERNAL_ERROR);
        }
        transientRejections++;
        retry.push(pending[i]);
      });
      pending = retry;
    }

    const total = CLIENTS * OPS_PER_UPLOAD;
    const stored = await prisma.operation.findMany({
      where: { userId: TEST_USER_ID },
      select: { id: true, serverSeq: true },
      orderBy: { serverSeq: 'asc' },
    });
    // Rejected attempts left nothing behind: exactly one row per op.
    expect(stored).toHaveLength(total);
    expect(stored.map((op) => op.serverSeq)).toEqual(
      Array.from({ length: total }, (_, i) => i + 1),
    );
    // Every acknowledged sequence is the one stored for that op.
    for (const op of stored) expect(accepted.get(op.id)).toBe(op.serverSeq);
    const state = await prisma.userSyncState.findUnique({
      where: { userId: TEST_USER_ID },
    });
    expect(state?.lastSeq).toBe(total);
    // Informational: how often the lock actually contended in this run.
    console.log(`concurrent-upload-seq: ${transientRejections} retryable rejections`);
  });
});
