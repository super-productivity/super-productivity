/**
 * Real-PostgreSQL coverage for destructive clean-slate uploads.
 *
 * Unit tests use a transaction-aware Prisma mock. This suite verifies that the
 * actual database transaction restores operations, sequence state, devices, and
 * storage accounting when any replacement operation is rejected.
 *
 * Prerequisites:
 *   `npm run supersync:db` — the db has no fixed host port, so this publishes
 *   one on 55432 and applies the schema.
 *
 * Run with:
 *   DATABASE_URL=postgresql://supersync:superpassword@localhost:55432/supersync_db \
 *     npx vitest run --config vitest.integration.config.ts \
 *     tests/integration/clean-slate-atomicity-sql.integration.spec.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db';
import { SyncService } from '../../src/sync/sync.service';
import { Operation, SYNC_ERROR_CODES } from '../../src/sync/sync.types';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('Clean-slate upload atomicity (PostgreSQL)', () => {
  const TEST_USER_ID = 99997;
  const TEST_EMAIL = `test-clean-slate-${Date.now()}@test.local`;
  const CLIENT_ID = 'clean-slate-integration-client';

  const makeOp = (overrides: Partial<Operation> = {}): Operation => ({
    id: `clean-slate-op-${Date.now()}`,
    clientId: CLIENT_ID,
    actionType: '[Task] Add',
    opType: 'CRT',
    entityType: 'TASK',
    entityId: 'task-before-clean-slate',
    payload: { title: 'Preserve me' },
    vectorClock: { [CLIENT_ID]: 1 },
    timestamp: Date.now(),
    schemaVersion: 1,
    ...overrides,
  });

  const readPersistentState = async () => {
    const [operations, syncState, devices, user] = await Promise.all([
      prisma.operation.findMany({
        where: { userId: TEST_USER_ID },
        orderBy: { serverSeq: 'asc' },
      }),
      prisma.userSyncState.findUniqueOrThrow({ where: { userId: TEST_USER_ID } }),
      prisma.syncDevice.findMany({
        where: { userId: TEST_USER_ID },
        orderBy: { clientId: 'asc' },
      }),
      prisma.user.findUniqueOrThrow({
        where: { id: TEST_USER_ID },
        select: { storageUsedBytes: true },
      }),
    ]);

    return {
      operations,
      syncState,
      devices,
      storageUsedBytes: user.storageUsedBytes,
    };
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });
    await prisma.user.create({
      data: { id: TEST_USER_ID, email: TEST_EMAIL, isVerified: 1 },
    });
    await prisma.userSyncState.create({
      data: { userId: TEST_USER_ID, lastSeq: 0 },
    });
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
      data: {
        lastSeq: 0,
        lastSnapshotSeq: null,
        snapshotData: null,
        snapshotAt: null,
        latestFullStateSeq: null,
        latestFullStateVectorClock: null,
        latestStateReplacementSeq: null,
      },
    });
    await prisma.user.update({
      where: { id: TEST_USER_ID },
      data: { storageUsedBytes: 0 },
    });
  });

  it('rolls back the whole replacement on a rejected sibling', async () => {
    const service = new SyncService();
    const existingOp = makeOp({ id: 'existing-op' });
    const seedResult = await service.uploadOps(TEST_USER_ID, CLIENT_ID, [existingOp]);
    expect(seedResult[0].accepted).toBe(true);

    const before = await readPersistentState();

    const replacement = makeOp({
      id: 'duplicate-replacement',
      opType: 'SYNC_IMPORT',
      actionType: 'LOAD_ALL_DATA',
      entityType: 'ALL',
      entityId: undefined,
      payload: { task: { ids: ['replacement-task'] } },
      vectorClock: { [CLIENT_ID]: 2 },
      syncImportReason: 'FORCE_UPLOAD',
    });
    const results = await service.uploadOps(
      TEST_USER_ID,
      CLIENT_ID,
      [replacement, { ...replacement }],
      true,
    );

    expect(results).toHaveLength(2);
    expect(results.every(({ accepted }) => !accepted)).toBe(true);
    expect(results[0].errorCode).toBe(SYNC_ERROR_CODES.INTERNAL_ERROR);
    expect(results[1].errorCode).toBe(SYNC_ERROR_CODES.DUPLICATE_OPERATION);

    expect(await readPersistentState()).toEqual(before);
    expect(
      await prisma.operation.findUnique({ where: { id: replacement.id } }),
    ).toBeNull();
  });

  it('rejects stale deltas after a replacement without blocking current clients', async () => {
    const service = new SyncService();
    const replacement = makeOp({
      id: 'state-replacement',
      opType: 'SYNC_IMPORT',
      actionType: '[SP_ALL] Load(import) all data',
      entityType: 'ALL',
      entityId: undefined,
      payload: { task: { ids: ['replacement-task'] } },
      vectorClock: { [CLIENT_ID]: 1 },
      syncImportReason: 'FORCE_UPLOAD',
    });
    const replacementResult = await service.uploadOps(
      TEST_USER_ID,
      CLIENT_ID,
      [replacement],
      true,
    );
    const replacementSeq = replacementResult[0].serverSeq;
    expect(replacementResult[0].accepted).toBe(true);
    expect(replacementSeq).toBeDefined();
    if (replacementSeq === undefined) {
      throw new Error('State replacement did not receive a server sequence');
    }
    // Simulate an upgrade from a server version that wrote the retained
    // replacement operation before the new boundary column was maintained.
    await prisma.userSyncState.update({
      where: { userId: TEST_USER_ID },
      data: { latestStateReplacementSeq: null },
    });

    const staleDelta = makeOp({
      id: 'stale-delta',
      clientId: 'stale-client',
      entityId: 'stale-task',
      vectorClock: { 'stale-client': 1 },
    });
    const staleResult = await service.uploadOps(
      TEST_USER_ID,
      staleDelta.clientId,
      [staleDelta],
      undefined,
      undefined,
      undefined,
      false,
      replacementSeq - 1,
    );

    expect(staleResult[0]).toEqual(
      expect.objectContaining({
        accepted: false,
        errorCode: SYNC_ERROR_CODES.INTERNAL_ERROR,
      }),
    );
    expect(
      await prisma.operation.findUnique({ where: { id: staleDelta.id } }),
    ).toBeNull();

    const currentDelta = makeOp({
      id: 'current-delta',
      clientId: 'current-client',
      entityId: 'current-task',
      vectorClock: { 'current-client': 1 },
    });
    const currentResult = await service.uploadOps(
      TEST_USER_ID,
      currentDelta.clientId,
      [currentDelta],
      undefined,
      undefined,
      undefined,
      false,
      replacementSeq,
    );

    expect(currentResult[0].accepted).toBe(true);
    expect(
      await prisma.userSyncState.findUniqueOrThrow({
        where: { userId: TEST_USER_ID },
        select: { latestStateReplacementSeq: true },
      }),
    ).toEqual({ latestStateReplacementSeq: replacementSeq });
  });
});
