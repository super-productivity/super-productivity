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
  let afterResetDelete: (() => Promise<void>) | undefined;
  let afterDownloadSeqRead: (() => Promise<void>) | undefined;

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
    prisma.$use(async (params, next) => {
      const result = await next(params);
      if (
        params.model === 'UserSyncState' &&
        params.action === 'findUnique' &&
        params.args.where.userId === TEST_USER_ID &&
        params.args.select?.latestFullStateSeq &&
        afterDownloadSeqRead
      ) {
        const resume = afterDownloadSeqRead;
        afterDownloadSeqRead = undefined;
        await resume();
      }
      if (
        params.model === 'Operation' &&
        params.action === 'deleteMany' &&
        params.args.where.userId === TEST_USER_ID &&
        afterResetDelete
      ) {
        const pause = afterResetDelete;
        afterResetDelete = undefined;
        await pause();
      }
      return result;
    });
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
    await prisma.userSyncState.upsert({
      where: { userId: TEST_USER_ID },
      create: { userId: TEST_USER_ID, lastSeq: 0 },
      update: {
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

  it('delivers a replacement to a client that did not observe the empty reset', async () => {
    const service = new SyncService();
    const [seed] = await service.uploadOps(TEST_USER_ID, CLIENT_ID, [
      makeOp({ id: 'before-account-reset' }),
    ]);
    expect(seed.accepted).toBe(true);
    const oldCursor = seed.serverSeq!;
    expect(await service.getLatestSeq(TEST_USER_ID)).toBe(oldCursor);

    await service.deleteAllUserData(TEST_USER_ID);
    const replacement = makeOp({
      id: 'after-account-reset',
      opType: 'SYNC_IMPORT',
      actionType: '[SP_ALL] Load(import) all data',
      entityType: 'ALL',
      entityId: undefined,
      payload: {
        task: {
          ids: ['replacement'],
          entities: { replacement: { id: 'replacement', title: 'Replacement task' } },
        },
      },
      vectorClock: { [CLIENT_ID]: 2 },
    });
    const [uploaded] = await service.uploadOps(TEST_USER_ID, CLIENT_ID, [replacement]);
    expect(uploaded.accepted).toBe(true);
    expect(uploaded.serverSeq).toBeGreaterThan(oldCursor);
    expect(await service.getLatestSeq(TEST_USER_ID)).toBe(uploaded.serverSeq);

    const page = await service.getOpsSinceWithSeq(TEST_USER_ID, oldCursor, 'peer');
    expect(page.ops.map(({ op }) => op.id)).toEqual([replacement.id]);
    expect(page.latestSeq).toBe(uploaded.serverSeq);
  });

  it('reports an empty reset while preserving the sequence allocation counter', async () => {
    const service = new SyncService();
    const [seed] = await service.uploadOps(TEST_USER_ID, CLIENT_ID, [
      makeOp({ id: 'empty-reset-seed' }),
    ]);
    expect(seed.accepted).toBe(true);
    await service.deleteAllUserData(TEST_USER_ID);

    expect(await service.getLatestSeq(TEST_USER_ID)).toBe(0);
    expect(await service.getOpsSinceWithSeq(TEST_USER_ID, seed.serverSeq!)).toMatchObject(
      {
        ops: [],
        latestSeq: 0,
        gapDetected: true,
      },
    );
    expect(await service.getOpsSinceWithSeq(TEST_USER_ID, 0)).toMatchObject({
      ops: [],
      latestSeq: 0,
      gapDetected: false,
    });
    const state = await prisma.userSyncState.findUnique({
      where: { userId: TEST_USER_ID },
    });
    expect(state).toMatchObject({
      lastSeq: seed.serverSeq,
      snapshotData: null,
      latestFullStateSeq: null,
    });
    expect((await readPersistentState()).storageUsedBytes).toBe(0n);
  });

  it('keeps download reads consistent when reset and replacement commit mid-download', async () => {
    const service = new SyncService();
    const [seed] = await service.uploadOps(TEST_USER_ID, CLIENT_ID, [
      makeOp({ id: 'download-reset-seed' }),
    ]);
    expect(seed.accepted).toBe(true);
    const replacement = makeOp({
      id: 'download-reset-replacement',
      opType: 'SYNC_IMPORT',
      actionType: '[SP_ALL] Load(import) all data',
      entityType: 'ALL',
      entityId: undefined,
      payload: { task: { ids: [], entities: {} } },
      vectorClock: { [CLIENT_ID]: 2 },
    });
    afterDownloadSeqRead = async () => {
      // Both writes really commit after the downloader has read its upper bound.
      await service.deleteAllUserData(TEST_USER_ID);
      const [uploaded] = await service.uploadOps(TEST_USER_ID, CLIENT_ID, [replacement]);
      expect(uploaded.accepted).toBe(true);
    };

    const page = await service.getOpsSinceWithSeq(TEST_USER_ID, 0, 'peer');
    expect(page.latestSeq).toBe(seed.serverSeq);
    expect(page.ops.map(({ op }) => op.id)).toEqual(['download-reset-seed']);
    expect(page.gapDetected).toBe(false);

    const nextPage = await service.getOpsSinceWithSeq(TEST_USER_ID, page.latestSeq);
    expect(nextPage.ops.map(({ op }) => op.id)).toEqual([replacement.id]);
    expect(nextPage.latestSeq).toBeGreaterThan(page.latestSeq);
  });

  it.each([
    [0, false],
    [0, true],
    [100000, false],
    [100000, true],
  ] as const)(
    'rejects deleted restore targets (prior sequence: %i, replacement: %s)',
    async (initialSeq, uploadReplacement) => {
      const service = new SyncService();
      await prisma.userSyncState.update({
        where: { userId: TEST_USER_ID },
        data: { lastSeq: initialSeq },
      });
      const [seed] = await service.uploadOps(TEST_USER_ID, CLIENT_ID, [
        makeOp({ id: 'restore-reset-seed' }),
      ]);
      expect(seed.accepted).toBe(true);
      if (initialSeq > 0) {
        await expect(
          service.generateSnapshotAtSeq(TEST_USER_ID, seed.serverSeq!),
        ).rejects.toThrow('Too many operations to process');
      }
      await service.deleteAllUserData(TEST_USER_ID);

      if (uploadReplacement) {
        const [replacement] = await service.uploadOps(TEST_USER_ID, CLIENT_ID, [
          makeOp({
            id: 'restore-reset-replacement',
            opType: 'SYNC_IMPORT',
            entityType: 'ALL',
            entityId: undefined,
            payload: { task: { ids: [], entities: {} } },
            vectorClock: { [CLIENT_ID]: 2 },
          }),
        ]);
        expect(replacement.accepted).toBe(true);
        expect(replacement.serverSeq).toBeGreaterThan(seed.serverSeq!);
      }

      await expect(
        service.generateSnapshotAtSeq(TEST_USER_ID, seed.serverSeq!),
      ).rejects.toThrow(`Target sequence ${seed.serverSeq} is no longer available`);
    },
  );

  it('serializes a concurrent upload before clearing history and accounting', async () => {
    const service = new SyncService();
    const [seed] = await service.uploadOps(TEST_USER_ID, CLIENT_ID, [
      makeOp({ id: 'reset-race-seed' }),
    ]);
    expect(seed.accepted).toBe(true);
    let signalDeleted!: () => void;
    let releaseDelete!: () => void;
    const deleted = new Promise<void>((resolve) => {
      signalDeleted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    afterResetDelete = async () => {
      signalDeleted();
      await release;
    };

    const deleting = service.deleteAllUserData(TEST_USER_ID);
    await deleted;
    const peerOp = makeOp({
      id: 'reset-race-peer',
      clientId: 'reset-race-peer-client',
      entityId: 'peer-task',
      vectorClock: { 'reset-race-peer-client': 1 },
    });
    // A distinct service bypasses process-local locks, like another server instance.
    const peer = new SyncService();
    let uploadFinished = false;
    const uploading = peer
      .uploadOps(
        TEST_USER_ID,
        peerOp.clientId,
        [peerOp],
        undefined,
        undefined,
        undefined,
        false,
        seed.serverSeq,
      )
      .then((result) => {
        uploadFinished = true;
        return result;
      });
    try {
      // Wait for a real PostgreSQL lock wait or an incorrectly completed upload,
      // rather than assuming an upload finishes within an arbitrary sleep.
      await expect
        .poll(async () => {
          const [row] = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND query LIKE '%user_sync_state%'
          ) AS waiting
        `;
          return uploadFinished || row.waiting;
        })
        .toBe(true);
      expect(uploadFinished).toBe(false);
    } finally {
      releaseDelete();
      await deleting;
      await uploading;
    }

    // RepeatableRead may reject the waiting upload once reset commits; retry
    // must succeed with a fresh snapshot and a sequence above the old cursor.
    let results = await uploading;
    if (!results[0].accepted) {
      expect(results[0].errorCode).toBe(SYNC_ERROR_CODES.INTERNAL_ERROR);
      results = await peer.uploadOps(TEST_USER_ID, peerOp.clientId, [peerOp]);
    }
    expect(results[0].accepted).toBe(true);
    expect(results[0].serverSeq).toBeGreaterThan(seed.serverSeq!);
    const state = await readPersistentState();
    expect(state.operations.map((op) => op.id)).toEqual([peerOp.id]);
    expect(state.syncState.lastSeq).toBe(results[0].serverSeq);
    expect(state.storageUsedBytes).toBeGreaterThan(0n);

    const [next] = await peer.uploadOps(TEST_USER_ID, peerOp.clientId, [
      makeOp({
        id: 'after-reset-race',
        entityId: 'next-task',
        clientId: peerOp.clientId,
        vectorClock: { [peerOp.clientId]: 2 },
      }),
    ]);
    expect(next.accepted).toBe(true);
    expect(next.serverSeq).toBeGreaterThan(results[0].serverSeq!);
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
