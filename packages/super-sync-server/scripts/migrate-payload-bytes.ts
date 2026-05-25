import { Prisma, PrismaClient } from '@prisma/client';
import { computeOpStorageBytes } from '../src/sync/sync.const';

// One backfill iteration is 2 round trips (findMany + UPDATE ... FROM (VALUES ...))
// per BATCH_SIZE rows. The UPDATE is N primary-key lookups joined to a small VALUES
// list, so it only takes short per-row locks and never a table lock; VALUES lists of
// a few thousand short tuples are cheap. Keeping these tiny made a 100M-row backfill
// take tens of hours, which in turn keeps the slow octet_length() quota fallback and
// the boot-time backfill self-check on the un-indexed scan path far longer than
// necessary. Size for throughput; the MAX cap still bounds the VALUES string so a
// fat-fingered override cannot OOM the Node process.
const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 1000;
const USER_PAGE_SIZE = 1000;

const prisma = new PrismaClient();

const parseBatchSize = (): number => {
  const raw = process.env.PAYLOAD_BYTES_MIGRATION_BATCH_SIZE;
  if (!raw) return DEFAULT_BATCH_SIZE;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid PAYLOAD_BYTES_MIGRATION_BATCH_SIZE: ${raw}. Must be a positive integer.`,
    );
  }
  return Math.min(parsed, MAX_BATCH_SIZE);
};

const fetchUserIdsWithUnbackfilledRows = async (
  afterUserId: number | undefined,
): Promise<number[]> => {
  const rows = await prisma.$queryRaw<Array<{ user_id: number }>>`
    SELECT DISTINCT user_id
    FROM operations
    WHERE payload_bytes = 0
      ${afterUserId === undefined ? Prisma.empty : Prisma.sql`AND user_id > ${afterUserId}`}
    ORDER BY user_id ASC
    LIMIT ${USER_PAGE_SIZE}
  `;

  return rows.map((row) => row.user_id);
};

const updatePayloadBytesBatch = async (
  updates: Array<{ id: string; bytes: number }>,
): Promise<void> => {
  if (updates.length === 0) return;

  const values = Prisma.join(
    updates.map(
      (update) => Prisma.sql`(${update.id}::text, ${BigInt(update.bytes)}::bigint)`,
    ),
  );

  await prisma.$executeRaw`
    UPDATE operations
    SET payload_bytes = v.bytes
    FROM (VALUES ${values}) AS v(id, bytes)
    WHERE operations.id = v.id
  `;
};

const backfillUser = async (userId: number, batchSize: number): Promise<number> => {
  let updated = 0;
  let lastId: string | undefined;

  for (;;) {
    const rows = await prisma.operation.findMany({
      where: {
        userId,
        payloadBytes: BigInt(0),
        ...(lastId ? { id: { gt: lastId } } : {}),
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: {
        id: true,
        payload: true,
        vectorClock: true,
      },
    });

    if (rows.length === 0) break;

    await updatePayloadBytesBatch(
      rows.map((row) => ({
        id: row.id,
        bytes: computeOpStorageBytes({
          payload: row.payload,
          vectorClock: row.vectorClock,
        }).bytes,
      })),
    );

    updated += rows.length;
    lastId = rows[rows.length - 1].id;
    console.log(
      `Updated ${updated} operation payload byte counters for user ${userId}...`,
    );
  }

  return updated;
};

const reconcileUserStorageUsage = async (userId: number): Promise<void> => {
  await prisma.$executeRaw`
    UPDATE users
    SET storage_used_bytes = usage.total_bytes
    FROM (
      SELECT
        ${userId}::integer AS user_id,
        (
          SELECT COALESCE(SUM(payload_bytes), 0)
          FROM operations
          WHERE user_id = ${userId}
        ) +
        COALESCE((
          SELECT octet_length(snapshot_data)::bigint
          FROM user_sync_state
          WHERE user_id = ${userId}
        ), 0) AS total_bytes
    ) AS usage
    WHERE users.id = usage.user_id
  `;
};

const run = async (): Promise<void> => {
  const batchSize = parseBatchSize();
  let updated = 0;
  let lastUserId: number | undefined;

  for (;;) {
    const userIds = await fetchUserIdsWithUnbackfilledRows(lastUserId);
    if (userIds.length === 0) break;

    for (const userId of userIds) {
      updated += await backfillUser(userId, batchSize);
      await reconcileUserStorageUsage(userId);
      lastUserId = userId;
    }
    console.log(`Updated ${updated} operation payload byte counters total...`);
  }

  console.log(`Payload byte migration complete. Updated ${updated} operations.`);
};

run()
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Payload byte migration failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
