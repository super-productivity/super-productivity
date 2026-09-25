/**
 * Real-PostgreSQL reproduction of the download-touch vs. upload-transaction
 * race on `sync_devices`.
 *
 * The download route touches the caller's device row fire-and-forget
 * (`DeviceService.touchDevice`, INSERT ... ON CONFLICT). The upload used to
 * upsert the SAME row inside its RepeatableRead transaction; a touch that
 * committed between the transaction's snapshot and that upsert aborted the
 * whole upload with `could not serialize access due to concurrent update`
 * (40001) → every op rejected as "Concurrent transaction conflict". Seen in
 * CI right after a clean slate or wipe, where the row does not exist yet and
 * both sides INSERT it — that shape is the first test below.
 *
 * Determinism: Prisma middleware sees the transaction's own statements, so the
 * touch is injected right after the op insert, while the transaction is still
 * open. On the pre-fix code both tests fail with INTERNAL_ERROR.
 *
 * Prerequisites:
 *   `npm run supersync:db` — the db has no fixed host port, so this publishes
 *   one on 55432 and applies the schema.
 *
 * Run with:
 *   DATABASE_URL=postgresql://supersync:superpassword@localhost:55432/supersync_db \
 *     npx vitest run --config vitest.integration.config.ts \
 *     tests/integration/device-touch-upload-race.integration.spec.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db';
import { SyncService } from '../../src/sync/sync.service';
import { DeviceService } from '../../src/sync/services/device.service';
import { Operation } from '../../src/sync/sync.types';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('Device touch vs. upload transaction race (PostgreSQL)', () => {
  const TEST_USER_ID = 99996;
  const TEST_EMAIL = `test-device-touch-race-${Date.now()}@test.local`;
  const CLIENT_ID = 'device-touch-race-client';
  const deviceService = new DeviceService();
  let touchDuringUpload: (() => Promise<void>) | undefined;

  const makeOp = (overrides: Partial<Operation> = {}): Operation => ({
    id: `device-race-op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    clientId: CLIENT_ID,
    actionType: '[Task] Add',
    opType: 'CRT',
    entityType: 'TASK',
    entityId: `task-${Date.now()}`,
    payload: { title: 'Survive the touch' },
    vectorClock: { [CLIENT_ID]: 1 },
    timestamp: Date.now(),
    schemaVersion: 1,
    ...overrides,
  });

  beforeAll(async () => {
    prisma.$use(async (params, next) => {
      const result = await next(params);
      // Runs inside the upload transaction, after the op row is inserted and
      // before the transaction commits — the window the fix is about.
      if (
        params.model === 'Operation' &&
        params.action === 'createMany' &&
        touchDuringUpload
      ) {
        const touch = touchDuringUpload;
        touchDuringUpload = undefined;
        await touch();
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
    touchDuringUpload = undefined;
    await prisma.operation.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.syncDevice.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.userSyncState.update({
      where: { userId: TEST_USER_ID },
      data: { lastSeq: 0, latestStateReplacementSeq: null },
    });
  });

  it('accepts an upload when the device row is created by a concurrent touch (post clean-slate shape)', async () => {
    const service = new SyncService();
    // The touch runs on its own pool connection and commits immediately, i.e.
    // exactly what the fire-and-forget download-route touch does.
    touchDuringUpload = () =>
      deviceService.touchDevice(TEST_USER_ID, CLIENT_ID, '18.0.0');

    const [result] = await service.uploadOps(TEST_USER_ID, CLIENT_ID, [makeOp()]);

    expect(result).toMatchObject({ accepted: true });
    expect(result.error).toBeUndefined();
    const device = await prisma.syncDevice.findUnique({
      where: { userId_clientId: { userId: TEST_USER_ID, clientId: CLIENT_ID } },
    });
    expect(device).not.toBeNull();
    expect(device?.appVersion).toBe('18.0.0');
  });

  it('accepts an upload when a concurrent touch updates an existing device row (app version change)', async () => {
    const service = new SyncService();
    await prisma.syncDevice.create({
      data: {
        userId: TEST_USER_ID,
        clientId: CLIENT_ID,
        lastSeenAt: BigInt(Date.now()),
        createdAt: BigInt(Date.now()),
        lastAckedSeq: 0,
      },
    });
    // The row has no app_version yet, so the throttle's version clause lets
    // this touch write — the every-first-download-after-upload case.
    touchDuringUpload = () =>
      deviceService.touchDevice(TEST_USER_ID, CLIENT_ID, '18.1.0');

    const [result] = await service.uploadOps(TEST_USER_ID, CLIENT_ID, [makeOp()]);

    expect(result).toMatchObject({ accepted: true });
    expect(result.error).toBeUndefined();
  });
});
