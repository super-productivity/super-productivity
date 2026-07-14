/**
 * PostgreSQL integration coverage for causal REPAIR acceptance.
 *
 * Run with the integration Vitest config and a migrated test database:
 *   DATABASE_URL=postgresql://... npx vitest run --config vitest.integration.config.ts \
 *     tests/integration/repair-causality.integration.spec.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import { SyncService } from '../../src/sync/sync.service';
import { Operation, SYNC_ERROR_CODES } from '../../src/sync/sync.types';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('causal REPAIR serialization (PostgreSQL)', () => {
  const userId = 99996;
  const email = `repair-causality-${Date.now()}@test.local`;
  let prisma: PrismaClient;

  const makeDelta = (): Operation => ({
    id: uuidv7(),
    clientId: 'delta-client',
    actionType: '[Task] Add',
    opType: 'CRT',
    entityType: 'TASK',
    entityId: uuidv7(),
    payload: { title: 'concurrent delta' },
    vectorClock: { 'delta-client': 1 },
    timestamp: Date.now(),
    schemaVersion: 1,
  });

  const makeRepair = (): Operation => ({
    id: uuidv7(),
    clientId: 'repair-client',
    actionType: '[Repair] Auto Repair',
    opType: 'REPAIR',
    entityType: 'ALL',
    payload: { appDataComplete: { task: { ids: [], entities: {} } } },
    vectorClock: { 'repair-client': 1 },
    timestamp: Date.now(),
    schemaVersion: 1,
    repairBaseServerSeq: 0,
  });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    await prisma.$connect();
    await prisma.user.create({
      data: { id: userId, email, isVerified: 1 },
    });
  });

  afterAll(async () => {
    await prisma.operation.deleteMany({ where: { userId } });
    await prisma.syncDevice.deleteMany({ where: { userId } });
    await prisma.userSyncState.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  for (const batchUpload of [false, true]) {
    it(`serializes a concurrent delta against REPAIR (batchUpload=${batchUpload})`, async () => {
      const service = new SyncService({ batchUpload });

      for (let attempt = 0; attempt < 5; attempt++) {
        await prisma.operation.deleteMany({ where: { userId } });
        await prisma.syncDevice.deleteMany({ where: { userId } });
        await prisma.userSyncState.upsert({
          where: { userId },
          create: { userId, lastSeq: 0 },
          update: {
            lastSeq: 0,
            latestFullStateSeq: null,
            latestFullStateVectorClock: Prisma.DbNull,
          },
        });

        const repair = makeRepair();
        const delta = makeDelta();
        const [repairResults, deltaResults] = await Promise.all([
          service.uploadOps(userId, repair.clientId, [repair], false, undefined, 0),
          service.uploadOps(userId, delta.clientId, [delta]),
        ]);
        const repairResult = repairResults[0];
        const deltaResult = deltaResults[0];

        expect(repairResult.accepted || deltaResult.accepted).toBe(true);
        if (repairResult.accepted && deltaResult.accepted) {
          expect(repairResult.serverSeq ?? Number.MAX_SAFE_INTEGER).toBeLessThan(
            deltaResult.serverSeq ?? 0,
          );
        } else if (!repairResult.accepted) {
          expect(deltaResult.accepted).toBe(true);
          expect([
            SYNC_ERROR_CODES.REPAIR_STALE,
            SYNC_ERROR_CODES.INTERNAL_ERROR,
          ]).toContain(repairResult.errorCode);
        } else {
          expect(deltaResult.errorCode).toBe(SYNC_ERROR_CODES.INTERNAL_ERROR);
        }
      }
    });
  }
});
