/**
 * PostgreSQL coverage for the stale-cursor upload guard surviving history
 * pruning.
 *
 * `latestStateReplacementSeq` is resolved lazily from the operation stream and
 * then PERSISTED, so a lookup that cannot see the surviving boundary does not
 * just answer one request wrong — it writes the wrong answer down. Both
 * pruning paths can delete a SYNC_IMPORT out from under a later causal REPAIR:
 *   - quota recovery (`deleteOldestRestorePointAndOps`) deletes up to and
 *     including the OLDEST restore point,
 *   - the daily old-ops sweep deletes everything below the NEWEST causal
 *     boundary (#9688/#9693, which widened it from over-quota accounts to the
 *     whole fleet).
 * With only the REPAIR left, an import-only lookup resolves to "none", persists
 * 0, and a client whose cursor predates the replacement can upload deltas built
 * on superseded state — resurrecting what the replacement removed.
 *
 * Prerequisites:
 *   `npm run supersync:db` — the db has no fixed host port, so this publishes
 *   one on 55432 and applies the schema.
 *
 * Run with:
 *   DATABASE_URL=postgresql://supersync:superpassword@localhost:55432/supersync_db \
 *     npx vitest run --config vitest.integration.config.ts \
 *     tests/integration/state-replacement-guard.integration.spec.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { prisma } from '../../src/db';
import { SyncService } from '../../src/sync/sync.service';
import { Operation, STATE_REPLACEMENT_REQUIRED_ERROR } from '../../src/sync/sync.types';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

const DAY_MS = 24 * 60 * 60 * 1000;
const PRUNED_USER_ID = 99971;
const LEGACY_REPAIR_USER_ID = 99972;
const ALL_USER_IDS = [PRUNED_USER_ID, LEGACY_REPAIR_USER_ID];

describeWithDb('State-replacement guard vs history pruning (PostgreSQL)', () => {
  const now = Date.now();
  const cutoffTime = now - 50 * DAY_MS;
  const oldReceivedAt = BigInt(now - 60 * DAY_MS);

  const seedOp = async (
    userId: number,
    serverSeq: number,
    overrides: { opType?: string; repairBaseServerSeq?: number | null } = {},
  ): Promise<void> => {
    const opType = overrides.opType ?? 'CRT';
    const isFullState = opType !== 'CRT';
    await prisma.operation.create({
      data: {
        id: `guard-op-${userId}-${serverSeq}`,
        userId,
        clientId: `guard-client-${userId}`,
        serverSeq,
        actionType: isFullState ? 'LOAD_ALL_DATA' : '[Task] Add',
        opType,
        entityType: isFullState ? 'ALL' : 'TASK',
        entityId: isFullState ? null : `task-${serverSeq}`,
        payload: isFullState
          ? { appDataComplete: { TASK: {} } }
          : { title: 'guard fixture' },
        vectorClock: { [`guard-client-${userId}`]: serverSeq },
        schemaVersion: 1,
        clientTimestamp: oldReceivedAt,
        receivedAt: oldReceivedAt,
        repairBaseServerSeq: overrides.repairBaseServerSeq ?? null,
        isPayloadEncrypted: false,
      },
    });
  };

  /**
   * Import at seq 1, deltas at 2-3, a causal REPAIR at 4 and a tail at 5 — all
   * aged past the retention cutoff, and a sync-state row whose replacement
   * cursor is still unresolved (the lazily-migrated shape). Both pruning paths
   * below delete the import and keep the REPAIR.
   */
  const seedImportBelowCausalRepair = async (userId: number): Promise<void> => {
    await seedOp(userId, 1, { opType: 'SYNC_IMPORT' });
    await seedOp(userId, 2);
    await seedOp(userId, 3);
    await seedOp(userId, 4, { opType: 'REPAIR', repairBaseServerSeq: 3 });
    await seedOp(userId, 5);
    await prisma.userSyncState.create({
      data: { userId, lastSeq: 5, latestStateReplacementSeq: null },
    });
  };

  /** A delta from a client whose cursor predates every replacement. */
  const staleDelta = (): Operation => ({
    id: uuidv7(),
    clientId: 'stale-client',
    actionType: '[Task] Add',
    opType: 'CRT',
    entityType: 'TASK',
    entityId: uuidv7(),
    payload: { title: 'built on superseded state' },
    vectorClock: { 'stale-client': 1 },
    timestamp: Date.now(),
    schemaVersion: 1,
  });

  const uploadFromCursorZero = (
    service: SyncService,
    userId: number,
  ): ReturnType<SyncService['uploadOps']> =>
    service.uploadOps(
      userId,
      'stale-client',
      [staleDelta()],
      false,
      undefined,
      undefined,
      false,
      0,
    );

  const survivingOps = async (userId: number): Promise<string[]> =>
    (
      await prisma.operation.findMany({
        where: { userId },
        orderBy: { serverSeq: 'asc' },
        select: { serverSeq: true, opType: true },
      })
    ).map((op) => `${op.serverSeq}:${op.opType}`);

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: ALL_USER_IDS } } });
    for (const id of ALL_USER_IDS) {
      await prisma.user.create({
        data: { id, email: `guard-test-${id}@test.local`, isVerified: 1 },
      });
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: ALL_USER_IDS } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.operation.deleteMany({ where: { userId: { in: ALL_USER_IDS } } });
    await prisma.userSyncState.deleteMany({ where: { userId: { in: ALL_USER_IDS } } });
  });

  it('rejects a stale cursor while the import is still retained', async () => {
    await seedImportBelowCausalRepair(PRUNED_USER_ID);
    const service = new SyncService({});

    await expect(service.getLatestStateReplacementSeq(PRUNED_USER_ID)).resolves.toBe(1);
    const results = await uploadFromCursorZero(service, PRUNED_USER_ID);

    expect(results[0].accepted).toBe(false);
    expect(results[0].error).toBe(STATE_REPLACEMENT_REQUIRED_ERROR);
  });

  it('keeps rejecting after the old-ops sweep prunes the import below the REPAIR', async () => {
    await seedImportBelowCausalRepair(PRUNED_USER_ID);
    const service = new SyncService({});

    await service.deleteOldSyncedOpsForAllUsers(cutoffTime);
    expect(await survivingOps(PRUNED_USER_ID)).toEqual(['4:REPAIR', '5:CRT']);

    await expect(service.getLatestStateReplacementSeq(PRUNED_USER_ID)).resolves.toBe(4);
    const results = await uploadFromCursorZero(service, PRUNED_USER_ID);

    expect(results[0].accepted).toBe(false);
    expect(results[0].error).toBe(STATE_REPLACEMENT_REQUIRED_ERROR);
    // The resolved answer is written down, so a wrong one would disarm the
    // guard for every later upload, not just this one.
    const state = await prisma.userSyncState.findUnique({
      where: { userId: PRUNED_USER_ID },
      select: { latestStateReplacementSeq: true },
    });
    expect(state?.latestStateReplacementSeq).toBe(4);
  });

  it('keeps rejecting after quota recovery prunes the import below the REPAIR', async () => {
    await seedImportBelowCausalRepair(PRUNED_USER_ID);
    const service = new SyncService({});

    const cleanup = await service.deleteOldestRestorePointAndOps(PRUNED_USER_ID);
    expect(cleanup.success).toBe(true);
    expect(await survivingOps(PRUNED_USER_ID)).toEqual([
      '2:CRT',
      '3:CRT',
      '4:REPAIR',
      '5:CRT',
    ]);

    await expect(service.getLatestStateReplacementSeq(PRUNED_USER_ID)).resolves.toBe(4);
    const results = await uploadFromCursorZero(service, PRUNED_USER_ID);

    expect(results[0].accepted).toBe(false);
    expect(results[0].error).toBe(STATE_REPLACEMENT_REQUIRED_ERROR);
  });

  it('does not arm the guard from a legacy REPAIR with no causal base', async () => {
    // Legacy REPAIR rows carry no base cursor, so they are not proven to
    // supersede their prefix (CAUSAL_FULL_STATE_OPERATION_WHERE excludes them
    // everywhere else too). They must stay invisible to the guard.
    await seedOp(LEGACY_REPAIR_USER_ID, 1, { opType: 'REPAIR' });
    await seedOp(LEGACY_REPAIR_USER_ID, 2);
    await prisma.userSyncState.create({
      data: {
        userId: LEGACY_REPAIR_USER_ID,
        lastSeq: 2,
        latestStateReplacementSeq: null,
      },
    });
    const service = new SyncService({});

    await expect(
      service.getLatestStateReplacementSeq(LEGACY_REPAIR_USER_ID),
    ).resolves.toBeNull();
    const results = await uploadFromCursorZero(service, LEGACY_REPAIR_USER_ID);

    expect(results[0].accepted).toBe(true);
  });
});
