import { Prisma, PrismaClient } from '@prisma/client';
import { computeOpStorageBytes } from '../src/sync/sync.const';

const DEFAULT_BATCH_SIZE = 1000;
const MAX_BATCH_SIZE = 10000;
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

const run = async (): Promise<void> => {
  const batchSize = parseBatchSize();
  let updated = 0;
  let lastUserId: number | undefined;

  for (;;) {
    const userIds = await fetchUserIdsWithUnbackfilledRows(lastUserId);
    if (userIds.length === 0) break;

    for (const userId of userIds) {
      updated += await backfillUser(userId, batchSize);
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
