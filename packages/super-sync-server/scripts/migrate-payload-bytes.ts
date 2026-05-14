import { PrismaClient } from '@prisma/client';
import { computeOpStorageBytes } from '../src/sync/sync.const';

const DEFAULT_BATCH_SIZE = 1000;
const MAX_BATCH_SIZE = 10000;

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

const run = async (): Promise<void> => {
  const batchSize = parseBatchSize();
  let updated = 0;
  let lastId: string | undefined;

  for (;;) {
    const rows = await prisma.operation.findMany({
      where: {
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

    for (const row of rows) {
      const sized = computeOpStorageBytes({
        payload: row.payload,
        vectorClock: row.vectorClock,
      });
      await prisma.operation.update({
        where: { id: row.id },
        data: { payloadBytes: BigInt(sized.bytes) },
      });
      updated++;
    }

    lastId = rows[rows.length - 1].id;
    console.log(`Updated ${updated} operation payload byte counters...`);
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
