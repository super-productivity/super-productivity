/**
 * Real-PostgreSQL coverage for the daily old-ops sweep
 * (`deleteOldSyncedOpsForAllUsers`).
 *
 * Unit tests exercise the sweep through an in-memory Prisma mock; this suite
 * pins the actual SQL the sweep issues, on real rows:
 *   - a lapsed user (snapshot older than the retention cutoff) gets the
 *     superseded prefix pruned while the causal full-state base + replay tail
 *     survive (regression for the inverted snapshotAt >= cutoff gate),
 *   - snapshotless, encrypted-only and state-row-less histories are pruned
 *     from the operation stream's own causal boundary (#9688),
 *   - a cached snapshot BLOB caps that boundary while it exists, and the cap
 *     lifts once the blob is dropped even if the cursor is left behind,
 *   - a prefix holding an op inside retention is kept whole, never pruned
 *     around,
 *   - a user whose only full-state op is a legacy REPAIR (no causal base
 *     cursor) is skipped entirely,
 *   - and the read-only pre-flight gate (`scripts/dry-run-old-ops-sweep.ts`)
 *     predicts, row for row, what the sweep then does.
 *
 * Prerequisites:
 *   `npm run supersync:db` — the db has no fixed host port, so this publishes
 *   one on 55432 and applies the schema.
 *
 * Run with:
 *   DATABASE_URL=postgresql://supersync:superpassword@localhost:55432/supersync_db \
 *     npx vitest run --config vitest.integration.config.ts \
 *     tests/integration/old-ops-sweep.integration.spec.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db';
import { SyncService } from '../../src/sync/sync.service';
import {
  affectedUsers,
  causalFullStateSql,
  fetchOldOpsSweepPlan,
  toNum,
} from '../../scripts/old-ops-sweep-plan';
import { CAUSAL_FULL_STATE_OPERATION_WHERE } from '../../src/sync/sync.types';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

const DAY_MS = 24 * 60 * 60 * 1000;
const LAPSED_USER_ID = 99981;
const SNAPSHOTLESS_USER_ID = 99982;
const LEGACY_REPAIR_USER_ID = 99983;
const SNAPSHOTLESS_IMPORT_USER_ID = 99984;
const ENCRYPTED_USER_ID = 99985;
const NO_STATE_ROW_USER_ID = 99986;
const STUCK_SNAPSHOT_USER_ID = 99987;
const SEQ1_IMPORT_ONLY_USER_ID = 99988;
const PREDICATE_MATRIX_USER_ID = 99989;
const MULTI_BATCH_USER_ID = 99990;
const ALL_USER_IDS = [
  LAPSED_USER_ID,
  SNAPSHOTLESS_USER_ID,
  LEGACY_REPAIR_USER_ID,
  SNAPSHOTLESS_IMPORT_USER_ID,
  ENCRYPTED_USER_ID,
  NO_STATE_ROW_USER_ID,
  STUCK_SNAPSHOT_USER_ID,
  SEQ1_IMPORT_ONLY_USER_ID,
  PREDICATE_MATRIX_USER_ID,
  MULTI_BATCH_USER_ID,
];

describeWithDb('Old-ops sweep (PostgreSQL)', () => {
  const now = Date.now();
  const cutoffTime = now - 50 * DAY_MS;
  const oldReceivedAt = BigInt(now - 60 * DAY_MS);

  const seedOp = async (
    userId: number,
    serverSeq: number,
    overrides: {
      opType?: string;
      actionType?: string;
      entityType?: string;
      entityId?: string | null;
      payload?: object;
      repairBaseServerSeq?: number | null;
      isPayloadEncrypted?: boolean;
      receivedAt?: bigint;
    } = {},
  ): Promise<void> => {
    await prisma.operation.create({
      data: {
        id: `sweep-op-${userId}-${serverSeq}`,
        userId,
        clientId: `sweep-client-${userId}`,
        serverSeq,
        actionType: overrides.actionType ?? '[Task] Add',
        opType: overrides.opType ?? 'CRT',
        entityType: overrides.entityType ?? 'TASK',
        entityId:
          overrides.entityId === undefined ? `task-${serverSeq}` : overrides.entityId,
        payload: overrides.payload ?? { title: 'sweep fixture' },
        vectorClock: { [`sweep-client-${userId}`]: serverSeq },
        schemaVersion: 1,
        clientTimestamp: oldReceivedAt,
        receivedAt: overrides.receivedAt ?? oldReceivedAt,
        repairBaseServerSeq: overrides.repairBaseServerSeq ?? null,
        isPayloadEncrypted: overrides.isPayloadEncrypted ?? false,
      },
    });
  };

  const seedImportOp = async (
    userId: number,
    serverSeq: number,
    overrides: {
      opType?: string;
      repairBaseServerSeq?: number | null;
      isPayloadEncrypted?: boolean;
      receivedAt?: bigint;
    } = {},
  ): Promise<void> =>
    seedOp(userId, serverSeq, {
      opType: overrides.opType ?? 'SYNC_IMPORT',
      actionType: 'LOAD_ALL_DATA',
      entityType: 'ALL',
      entityId: null,
      payload: { appDataComplete: { TASK: {} } },
      repairBaseServerSeq: overrides.repairBaseServerSeq ?? null,
      isPayloadEncrypted: overrides.isPayloadEncrypted,
      receivedAt: overrides.receivedAt,
    });

  /**
   * Prefix (1–3) + causal base (4) + tail (5), plus a sync-state row whose
   * cursor is frozen at seq 1. The two cap tests must differ by exactly one
   * thing — whether the cached snapshot blob is still there — so they share
   * this seeder rather than each spelling the row out.
   */
  const seedPrefixBaseTail = async (
    userId: number,
    opts: { cachedBlob: boolean },
  ): Promise<void> => {
    await seedImportOp(userId, 1);
    await seedOp(userId, 2);
    await seedOp(userId, 3);
    await seedImportOp(userId, 4);
    await seedOp(userId, 5);
    await prisma.userSyncState.create({
      data: {
        userId,
        lastSeq: 5,
        lastSnapshotSeq: 1,
        snapshotAt: BigInt(now - 100 * DAY_MS),
        snapshotData: opts.cachedBlob ? Buffer.from('legacy-cached-snapshot') : undefined,
      },
    });
  };

  const runSweep = (): Promise<{ totalDeleted: number; affectedUserIds: number[] }> =>
    new SyncService({}).deleteOldSyncedOpsForAllUsers(cutoffTime);

  const survivingSeqs = async (userId: number): Promise<number[]> => {
    const ops = await prisma.operation.findMany({
      where: { userId },
      orderBy: { serverSeq: 'asc' },
      select: { serverSeq: true },
    });
    return ops.map((op) => op.serverSeq);
  };

  /**
   * `survivingSeqs` for several users in one round trip, keyed by user id.
   * Every seeded user gets an entry even when they hold no operations, so the
   * gate-vs-sweep comparison below never silently drops a cohort.
   */
  const seqsByUser = async (userIds: number[]): Promise<Record<number, number[]>> => {
    const ops = await prisma.operation.findMany({
      where: { userId: { in: userIds } },
      orderBy: [{ userId: 'asc' }, { serverSeq: 'asc' }],
      select: { userId: true, serverSeq: true },
    });
    const byUser: Record<number, number[]> = Object.fromEntries(
      userIds.map((userId) => [userId, [] as number[]]),
    );
    for (const op of ops) {
      byUser[op.userId].push(op.serverSeq);
    }
    return byUser;
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: ALL_USER_IDS } } });
    for (const id of ALL_USER_IDS) {
      await prisma.user.create({
        data: { id, email: `sweep-test-${id}@test.local`, isVerified: 1 },
      });
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: ALL_USER_IDS } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.operation.deleteMany({ where: { userId: { in: ALL_USER_IDS } } });
    await prisma.userSyncState.deleteMany({
      where: { userId: { in: ALL_USER_IDS } },
    });
  });

  it('prunes a lapsed user to the causal base + tail, leaves the other cohorts intact', async () => {
    // Lapsed user: snapshot taken 100 days ago (predates the cutoff — the
    // cohort the removed snapshotAt >= cutoff gate used to skip forever).
    // Ops 1-3 = superseded prefix, 4 = causal SYNC_IMPORT base, 5 = tail.
    await seedOp(LAPSED_USER_ID, 1);
    await seedOp(LAPSED_USER_ID, 2);
    await seedOp(LAPSED_USER_ID, 3);
    await seedImportOp(LAPSED_USER_ID, 4);
    await seedOp(LAPSED_USER_ID, 5);
    await prisma.userSyncState.create({
      data: {
        userId: LAPSED_USER_ID,
        lastSeq: 5,
        lastSnapshotSeq: 4,
        snapshotAt: BigInt(now - 100 * DAY_MS),
        latestFullStateSeq: 4,
      },
    });

    // Plain-op-only user: no full-state op anywhere, so no boundary can
    // authorize pruning — everything survives regardless of the snapshot.
    await seedOp(SNAPSHOTLESS_USER_ID, 1);
    await prisma.userSyncState.create({
      data: { userId: SNAPSHOTLESS_USER_ID, lastSeq: 1 },
    });

    // Legacy-REPAIR user: full-state op without a causal base cursor must
    // never authorize pruning, even with a stale marker pointing at it.
    await seedOp(LEGACY_REPAIR_USER_ID, 1);
    await seedOp(LEGACY_REPAIR_USER_ID, 2);
    await seedImportOp(LEGACY_REPAIR_USER_ID, 3, {
      opType: 'REPAIR',
      repairBaseServerSeq: null,
    });
    await prisma.userSyncState.create({
      data: {
        userId: LEGACY_REPAIR_USER_ID,
        lastSeq: 3,
        lastSnapshotSeq: 3,
        snapshotAt: BigInt(now - 100 * DAY_MS),
        latestFullStateSeq: 3,
      },
    });

    // The sweep runs across ALL users in this database, so assert per-user
    // outcomes rather than totals other suites' leftovers could inflate.
    const { affectedUserIds } = await runSweep();

    expect(await survivingSeqs(LAPSED_USER_ID)).toEqual([4, 5]);
    expect(affectedUserIds).toContain(LAPSED_USER_ID);

    expect(await survivingSeqs(SNAPSHOTLESS_USER_ID)).toEqual([1]);
    expect(affectedUserIds).not.toContain(SNAPSHOTLESS_USER_ID);

    expect(await survivingSeqs(LEGACY_REPAIR_USER_ID)).toEqual([1, 2, 3]);
    expect(affectedUserIds).not.toContain(LEGACY_REPAIR_USER_ID);
  });

  it('keeps a fresh prefix (inside retention) even below the causal base', async () => {
    // Ops below the boundary but received inside the retention window must
    // survive until they age out — deletion requires BOTH seq < boundary
    // AND receivedAt < cutoff.
    await seedOp(LAPSED_USER_ID, 1, { receivedAt: BigInt(now - 10 * DAY_MS) });
    await seedImportOp(LAPSED_USER_ID, 2);
    await prisma.userSyncState.create({
      data: {
        userId: LAPSED_USER_ID,
        lastSeq: 2,
        lastSnapshotSeq: 2,
        snapshotAt: BigInt(now - 100 * DAY_MS),
        latestFullStateSeq: 2,
      },
    });

    await runSweep();

    expect(await survivingSeqs(LAPSED_USER_ID)).toEqual([1, 2]);
  });

  // ——— Issue #9688: cohorts with no usable snapshot cursor ———————————————
  // The boundary that authorizes deletion is the newest causal full-state op
  // in the operation stream itself — the same op the download path already
  // fast-forwards every client past, and the op `_resolveExpectedFirstSeq`
  // accepts as a leading-gap replay base. A snapshot cursor is not required;
  // it only CAPS the boundary while it exists (legacy cached-snapshot cohort).

  it('prunes a snapshotless user below their newest causal full-state op (#9688)', async () => {
    // No lastSnapshotSeq/snapshotAt — the pre-#9688 sweep never selected
    // this user, so the superseded prefix accumulated forever.
    await seedOp(SNAPSHOTLESS_IMPORT_USER_ID, 1);
    await seedOp(SNAPSHOTLESS_IMPORT_USER_ID, 2);
    await seedOp(SNAPSHOTLESS_IMPORT_USER_ID, 3);
    await seedImportOp(SNAPSHOTLESS_IMPORT_USER_ID, 4);
    await seedOp(SNAPSHOTLESS_IMPORT_USER_ID, 5);
    await prisma.userSyncState.create({
      data: { userId: SNAPSHOTLESS_IMPORT_USER_ID, lastSeq: 5 },
    });

    const { affectedUserIds } = await runSweep();

    expect(await survivingSeqs(SNAPSHOTLESS_IMPORT_USER_ID)).toEqual([4, 5]);
    expect(affectedUserIds).toContain(SNAPSHOTLESS_IMPORT_USER_ID);
  });

  it('prunes an E2EE user with no server snapshot — encrypted causal boundary (#9688)', async () => {
    // Encrypted payloads are never cached server-side (cacheSnapshotIfReplayable
    // skips them), so under the mandatory-E2EE gate no user can earn a snapshot
    // cursor anymore. The opType envelope stays plaintext, so the causal
    // full-state boundary is still provable from metadata alone.
    await seedOp(ENCRYPTED_USER_ID, 1, { isPayloadEncrypted: true });
    await seedOp(ENCRYPTED_USER_ID, 2, { isPayloadEncrypted: true });
    await seedImportOp(ENCRYPTED_USER_ID, 3, { isPayloadEncrypted: true });
    await seedOp(ENCRYPTED_USER_ID, 4, { isPayloadEncrypted: true });
    await prisma.userSyncState.create({
      data: { userId: ENCRYPTED_USER_ID, lastSeq: 4 },
    });

    await runSweep();

    expect(await survivingSeqs(ENCRYPTED_USER_ID)).toEqual([3, 4]);
  });

  it('prunes a user holding ops but no user_sync_state row at all (#9688)', async () => {
    await seedOp(NO_STATE_ROW_USER_ID, 1);
    await seedOp(NO_STATE_ROW_USER_ID, 2);
    await seedImportOp(NO_STATE_ROW_USER_ID, 3);
    await seedOp(NO_STATE_ROW_USER_ID, 4);

    await runSweep();

    expect(await survivingSeqs(NO_STATE_ROW_USER_ID)).toEqual([3, 4]);
  });

  it('keeps a partly-fresh prefix whole rather than pruning around the fresh op', async () => {
    // Seq 1 is past the cutoff; seq 2 and the causal base at seq 3 are inside
    // retention. Pruning around seq 2 would leave a plain delta as the lowest
    // surviving op and break replay — see
    // StorageQuotaService.deleteOldSyncedOpsForAllUsers.
    //
    // receivedAt rises with serverSeq here because the upload path stamps both
    // in one transaction: a fixture where a lower seq is NEWER than a higher
    // one cannot occur in production, so a guard that only holds for such rows
    // would look tested while never firing on real data.
    await seedOp(SNAPSHOTLESS_IMPORT_USER_ID, 1);
    await seedOp(SNAPSHOTLESS_IMPORT_USER_ID, 2, {
      receivedAt: BigInt(now - 10 * DAY_MS),
    });
    await seedImportOp(SNAPSHOTLESS_IMPORT_USER_ID, 3, {
      receivedAt: BigInt(now - 9 * DAY_MS),
    });
    await prisma.userSyncState.create({
      data: { userId: SNAPSHOTLESS_IMPORT_USER_ID, lastSeq: 3 },
    });

    const { affectedUserIds } = await runSweep();

    expect(await survivingSeqs(SNAPSHOTLESS_IMPORT_USER_ID)).toEqual([1, 2, 3]);
    expect(affectedUserIds).not.toContain(SNAPSHOTLESS_IMPORT_USER_ID);
  });

  it('caps the boundary at lastSnapshotSeq while a cached snapshot blob exists', async () => {
    // Stuck-snapshot cohort (e.g. issue user 1515): cached snapshot frozen at
    // seq 1. While the blob exists, pruning must never pass its cursor — the
    // newest causal full-state op below the cap is seq 1, which authorizes
    // nothing. The cap lifts when the E2EE eradication sweep nulls the cached
    // snapshot (next test).
    await seedPrefixBaseTail(STUCK_SNAPSHOT_USER_ID, { cachedBlob: true });

    const { affectedUserIds } = await runSweep();

    expect(await survivingSeqs(STUCK_SNAPSHOT_USER_ID)).toEqual([1, 2, 3, 4, 5]);
    expect(affectedUserIds).not.toContain(STUCK_SNAPSHOT_USER_ID);
  });

  it('unsticks the capped user once the cached snapshot blob is dropped (post-eradication)', async () => {
    // Identical to the previous test but for `cachedBlob`: the E2EE
    // eradication plan nulls the BLOB and leaves `lastSnapshotSeq` behind
    // (docs/e2ee-legacy-data-eradication-plan.md). `generateSnapshotAtSeq`
    // uses the cached base only when the blob is present, so the cap must key
    // on the blob too — keying it on the stale cursor would exempt this user
    // from retention forever, which is the #9688 failure.
    await seedPrefixBaseTail(STUCK_SNAPSHOT_USER_ID, { cachedBlob: false });

    const { affectedUserIds } = await runSweep();

    expect(await survivingSeqs(STUCK_SNAPSHOT_USER_ID)).toEqual([4, 5]);
    expect(affectedUserIds).toContain(STUCK_SNAPSHOT_USER_ID);
  });

  it('never prunes a user whose only causal full-state op is the initial import at seq 1', async () => {
    // Everything after the initial import is live history with no superseding
    // boundary — structurally unprunable until a newer full-state op exists
    // (issue #9688 direction 2: client checkpoint cadence).
    await seedImportOp(SEQ1_IMPORT_ONLY_USER_ID, 1);
    await seedOp(SEQ1_IMPORT_ONLY_USER_ID, 2);
    await seedOp(SEQ1_IMPORT_ONLY_USER_ID, 3);
    await prisma.userSyncState.create({
      data: { userId: SEQ1_IMPORT_ONLY_USER_ID, lastSeq: 3 },
    });

    const { affectedUserIds } = await runSweep();

    expect(await survivingSeqs(SEQ1_IMPORT_ONLY_USER_ID)).toEqual([1, 2, 3]);
    expect(affectedUserIds).not.toContain(SEQ1_IMPORT_ONLY_USER_ID);
  });

  it('skips a snapshotless legacy-REPAIR-only history (no causal base)', async () => {
    // A legacy REPAIR (repairBaseServerSeq NULL) must never authorize pruning,
    // with or without a snapshot cursor.
    await seedOp(LEGACY_REPAIR_USER_ID, 1);
    await seedOp(LEGACY_REPAIR_USER_ID, 2);
    await seedImportOp(LEGACY_REPAIR_USER_ID, 3, {
      opType: 'REPAIR',
      repairBaseServerSeq: null,
    });
    await prisma.userSyncState.create({
      data: { userId: LEGACY_REPAIR_USER_ID, lastSeq: 3 },
    });

    await runSweep();

    expect(await survivingSeqs(LEGACY_REPAIR_USER_ID)).toEqual([1, 2, 3]);
  });
  // ——— The dry-run gate must not drift away from the sweep ——————————————
  // `scripts/dry-run-old-ops-sweep.ts` is what an operator reads before
  // authorizing a destructive run on the hosted database, and it re-derives the
  // sweep's boundary logic in set-based SQL rather than calling it. Two
  // independent implementations of the same rule drift silently, and the
  // direction that matters is the gate UNDER-reporting: rows deleted that the
  // operator was never shown. So run both over the same seeded rows and compare.

  it('the dry-run gate predicts, row for row, what the sweep deletes', async () => {
    // Prunable: prefix 1-3 aged out, causal base 4, tail 5.
    await seedOp(LAPSED_USER_ID, 1);
    await seedOp(LAPSED_USER_ID, 2);
    await seedOp(LAPSED_USER_ID, 3);
    await seedImportOp(LAPSED_USER_ID, 4);
    await seedOp(LAPSED_USER_ID, 5);
    await prisma.userSyncState.create({
      data: {
        userId: LAPSED_USER_ID,
        lastSeq: 5,
        lastSnapshotSeq: 4,
        snapshotAt: BigInt(now - 100 * DAY_MS),
      },
    });

    // Prunable, no user_sync_state row at all (#9688).
    await seedOp(NO_STATE_ROW_USER_ID, 1);
    await seedOp(NO_STATE_ROW_USER_ID, 2);
    await seedImportOp(NO_STATE_ROW_USER_ID, 3);
    await seedOp(NO_STATE_ROW_USER_ID, 4);

    // Capped by a cached snapshot blob frozen at seq 1: nothing to delete.
    await seedPrefixBaseTail(STUCK_SNAPSHOT_USER_ID, { cachedBlob: true });

    // Prunable boundary, but the prefix still holds an op inside retention, so
    // the whole-or-nothing rule skips the user. The gate must skip it too or it
    // would promise deletions the sweep refuses to make.
    await seedOp(SNAPSHOTLESS_IMPORT_USER_ID, 1);
    await seedOp(SNAPSHOTLESS_IMPORT_USER_ID, 2, {
      receivedAt: BigInt(now - 10 * DAY_MS),
    });
    await seedImportOp(SNAPSHOTLESS_IMPORT_USER_ID, 3, {
      receivedAt: BigInt(now - 9 * DAY_MS),
    });

    // Only full-state op is the initial import at seq 1: structurally
    // unprunable.
    await seedImportOp(SEQ1_IMPORT_ONLY_USER_ID, 1);
    await seedOp(SEQ1_IMPORT_ONLY_USER_ID, 2);
    await seedOp(SEQ1_IMPORT_ONLY_USER_ID, 3);

    const seededUserIds = [
      LAPSED_USER_ID,
      NO_STATE_ROW_USER_ID,
      STUCK_SNAPSHOT_USER_ID,
      SNAPSHOTLESS_IMPORT_USER_ID,
      SEQ1_IMPORT_ONLY_USER_ID,
    ];
    const before = await seqsByUser(seededUserIds);

    // Same cutoff the sweep is about to run with — the gate derives its own
    // from RETENTION_MS, which this suite deliberately does not depend on.
    const plan = await fetchOldOpsSweepPlan(prisma, BigInt(cutoffTime));
    const wouldDeleteByUserId = new Map(affectedUsers(plan).map((r) => [r.user_id, r]));
    const predicted = Object.fromEntries(
      seededUserIds.map((userId) => {
        const row = wouldDeleteByUserId.get(userId);
        return [
          userId,
          {
            deleted: row ? toNum(row.would_delete) : 0,
            // The boundary IS the lowest row expected to survive — the property
            // `_resolveExpectedFirstSeq` depends on, so compare it rather than
            // the count alone.
            lowestSurviving: row?.protected_from_seq ?? before[userId][0],
          },
        ];
      }),
    );

    const { affectedUserIds } = await runSweep();
    const after = await seqsByUser(seededUserIds);
    const actual = Object.fromEntries(
      seededUserIds.map((userId) => [
        userId,
        {
          deleted: before[userId].length - after[userId].length,
          lowestSurviving: after[userId][0],
        },
      ]),
    );

    expect(actual).toEqual(predicted);
    // Pinned separately so a gate and a sweep that BOTH stopped doing anything
    // still fail: agreement on nothing is not agreement.
    expect(predicted).toEqual({
      [LAPSED_USER_ID]: { deleted: 3, lowestSurviving: 4 },
      [NO_STATE_ROW_USER_ID]: { deleted: 2, lowestSurviving: 3 },
      [STUCK_SNAPSHOT_USER_ID]: { deleted: 0, lowestSurviving: 1 },
      [SNAPSHOTLESS_IMPORT_USER_ID]: { deleted: 0, lowestSurviving: 1 },
      [SEQ1_IMPORT_ONLY_USER_ID]: { deleted: 0, lowestSurviving: 1 },
    });
    expect(affectedUserIds.filter((id) => seededUserIds.includes(id)).sort()).toEqual(
      [LAPSED_USER_ID, NO_STATE_ROW_USER_ID].sort(),
    );
  });
  /**
   * The gate re-implements the sweep's authorizing predicate in raw SQL, so the
   * two must stay in lockstep or the read-only pre-flight measures a different
   * sweep than the one that deletes. The fixture-based drift test above only
   * covers the shapes it happens to seed; this walks the whole (opType x
   * repairBaseServerSeq) matrix and checks both against a third, independent
   * statement of the rule so a matching pair of wrong predicates still fails.
   */
  it('the gate SQL and the Prisma causal predicate agree on every op shape', async () => {
    const opTypes = [
      'CRT',
      'UPD',
      'DEL',
      'MOV',
      'SYNC_IMPORT',
      'BACKUP_IMPORT',
      'REPAIR',
    ];
    // 0 is the load-bearing base cursor: a REPAIR over an empty stream is
    // causal, so any predicate spelled `> 0` rather than `IS NOT NULL` diverges
    // here and nowhere else.
    const repairBases: Array<number | null> = [null, 0, 7];
    const expectedCausalSeqs: number[] = [];
    let seq = 0;
    for (const opType of opTypes) {
      for (const repairBaseServerSeq of repairBases) {
        seq++;
        await seedOp(PREDICATE_MATRIX_USER_ID, seq, { opType, repairBaseServerSeq });
        const isCausal =
          opType === 'SYNC_IMPORT' ||
          opType === 'BACKUP_IMPORT' ||
          (opType === 'REPAIR' && repairBaseServerSeq !== null);
        if (isCausal) {
          expectedCausalSeqs.push(seq);
        }
      }
    }

    const viaPrisma = (
      await prisma.operation.findMany({
        where: { userId: PREDICATE_MATRIX_USER_ID, ...CAUSAL_FULL_STATE_OPERATION_WHERE },
        orderBy: { serverSeq: 'asc' },
        select: { serverSeq: true },
      })
    ).map((op) => op.serverSeq);
    const viaGate = (
      await prisma.$queryRaw<Array<{ server_seq: number }>>`
        SELECT o.server_seq
        FROM operations o
        WHERE o.user_id = ${PREDICATE_MATRIX_USER_ID} AND ${causalFullStateSql('o')}
        ORDER BY o.server_seq ASC
      `
    ).map((row) => row.server_seq);

    expect(viaGate).toEqual(viaPrisma);
    expect(viaPrisma).toEqual(expectedCausalSeqs);
  });
  /**
   * The drain loop continues on the SELECTED row count, and it only ever
   * continues past the first batch when a user's aged prefix is longer than
   * OLD_OPS_CLEANUP_DELETE_BATCH_SIZE (5000 by default). Every other fixture
   * here is a handful of rows, so that continuation — the line that decides
   * whether a prefix is drained whole or left truncated with a plain delta
   * lowest — has never executed against real rows. Shrink the batch instead of
   * seeding 5000 ops.
   */
  it('drains a prefix longer than one delete batch whole, across batches', async () => {
    const previousBatchSize = process.env.OLD_OPS_CLEANUP_DELETE_BATCH_SIZE;
    process.env.OLD_OPS_CLEANUP_DELETE_BATCH_SIZE = '2';
    try {
      for (let seq = 1; seq <= 9; seq++) {
        await seedOp(MULTI_BATCH_USER_ID, seq);
      }
      await seedImportOp(MULTI_BATCH_USER_ID, 10);
      await seedOp(MULTI_BATCH_USER_ID, 11);
      await prisma.userSyncState.create({
        data: { userId: MULTI_BATCH_USER_ID, lastSeq: 11 },
      });

      const result = await runSweep();

      // 9 prefix ops removed over 5 batches of 2; stopping after any one of
      // them would leave a plain delta as the lowest surviving row.
      expect(result.totalDeleted).toBe(9);
      expect(await survivingSeqs(MULTI_BATCH_USER_ID)).toEqual([10, 11]);
    } finally {
      if (previousBatchSize === undefined) {
        delete process.env.OLD_OPS_CLEANUP_DELETE_BATCH_SIZE;
      } else {
        process.env.OLD_OPS_CLEANUP_DELETE_BATCH_SIZE = previousBatchSize;
      }
    }
  });
});
