import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

/**
 * Real-Postgres coverage for `DeviceService.touchDevice`.
 *
 * The whole point of that statement is behaviour a mocked `prisma` cannot see:
 * a single `INSERT ... ON CONFLICT DO UPDATE ... WHERE` that must insert when
 * the device is unknown, refresh when the row is stale, and do NOTHING when the
 * row is fresh. Asserting "we called $executeRaw" would pass for SQL Postgres
 * rejects, and for SQL that quietly writes on every request — which is the
 * regression that matters, since this runs on the download path of every sync
 * poll. So the statement is executed against an in-process Postgres.
 *
 * `DeviceService` keeps no in-process state (see its `touchDevice` JSDoc: the
 * throttle is deliberately not cached in-process) — the SQL `WHERE` predicate
 * is the ONLY throttle. A second `DeviceService` stands in for a second server
 * instance to prove the predicate alone suffices across instances.
 */

import { SYNC_DEVICES_DDL } from './sync-devices-ddl.helper';

const mocks = vi.hoisted(() => {
  const state: { db: PGlite | null } = { db: null };
  const prisma = {
    syncDevice: {
      findMany: async (args: { where: { lastSeenAt: { gt: bigint } } }) => {
        const result = await state.db!.query<{
          userId: number;
          appVersion: string | null;
        }>(
          'SELECT user_id AS "userId", app_version AS "appVersion" FROM sync_devices WHERE last_seen_at > $1::bigint',
          [args.where.lastSeenAt.gt.toString()],
        );
        return result.rows;
      },
      deleteMany: async (args: { where: { lastSeenAt: { lt: bigint } } }) => {
        const result = await state.db!.query(
          'DELETE FROM sync_devices WHERE last_seen_at < $1::bigint',
          [args.where.lastSeenAt.lt.toString()],
        );
        return { count: result.affectedRows ?? 0 };
      },
    },
    $executeRaw: async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<number> => {
      const { Prisma } = await import('@prisma/client');
      const sql = Prisma.sql(strings, ...(values as never[]));
      // PGlite's driver has no BigInt serializer; Prisma's does. Passing the
      // decimal string is the same value to a `::bigint` cast, and keeps the
      // shipped statement (not a rewritten one) as what runs here.
      const params = sql.values.map((v) => (typeof v === 'bigint' ? v.toString() : v));
      const res = await state.db!.query(sql.text, params);
      return res.affectedRows ?? 0;
    },
  };
  return { state, prisma };
});

vi.mock('../src/db', () => ({ prisma: mocks.prisma }));

const { DeviceService } = await import('../src/sync/services/device.service');
const { DEVICE_TOUCH_THROTTLE_MS, RETENTION_MS } = await import('../src/sync/sync.types');

type Row = {
  client_id: string;
  user_id: number;
  last_seen_at: bigint | string | number;
  created_at: bigint | string | number;
  app_version: string | null;
};

describe('DeviceService.touchDevice (real Postgres)', () => {
  let db: PGlite;
  let service: InstanceType<typeof DeviceService>;

  const readAll = async (): Promise<Row[]> => {
    const res = await db.query<Row>(
      'SELECT * FROM sync_devices ORDER BY user_id, client_id',
    );
    return res.rows;
  };

  const num = (v: bigint | string | number): number => Number(v);

  beforeEach(async () => {
    db = new PGlite();
    mocks.state.db = db;
    await db.exec(SYNC_DEVICES_DDL);
    service = new DeviceService();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await db.close();
  });

  it('inserts a row for a device that has never uploaded', async () => {
    vi.setSystemTime(1_000_000);

    await service.touchDevice(7, 'E_abc123');

    const rows = await readAll();
    expect(rows).toHaveLength(1);
    expect(rows[0].client_id).toBe('E_abc123');
    expect(rows[0].user_id).toBe(7);
    expect(num(rows[0].last_seen_at)).toBe(1_000_000);
    expect(num(rows[0].created_at)).toBe(1_000_000);
  });

  it('does not write again while the row is younger than the throttle window', async () => {
    vi.setSystemTime(1_000_000);
    await service.touchDevice(7, 'E_abc123');

    // A separate instance (as after a restart / on another server): the
    // service holds no in-process state, so this pins the SQL predicate —
    // the only throttle, and why it is correct across instances and restarts.
    vi.setSystemTime(1_000_000 + DEVICE_TOUCH_THROTTLE_MS - 1);
    await new DeviceService().touchDevice(7, 'E_abc123');

    const rows = await readAll();
    expect(num(rows[0].last_seen_at)).toBe(1_000_000);
  });

  it('refreshes once the row is older than the throttle window', async () => {
    vi.setSystemTime(1_000_000);
    await service.touchDevice(7, 'E_abc123');

    const later = 1_000_000 + DEVICE_TOUCH_THROTTLE_MS + 1;
    vi.setSystemTime(later);
    await service.touchDevice(7, 'E_abc123');

    const rows = await readAll();
    expect(num(rows[0].last_seen_at)).toBe(later);
    // createdAt is the device's first-seen stamp and must survive refreshes.
    expect(num(rows[0].created_at)).toBe(1_000_000);
  });

  describe('app_version (#9962)', () => {
    it('stores the reported version on insert and leaves it NULL when none is reported', async () => {
      vi.setSystemTime(1_000_000);
      await service.touchDevice(7, 'E_abc123', '18.22.0');
      await service.touchDevice(7, 'A_xyz789');

      const rows = await readAll();
      expect(rows.map((r) => [r.client_id, r.app_version])).toEqual([
        ['A_xyz789', null],
        ['E_abc123', '18.22.0'],
      ]);
    });

    it('never overwrites a known version with NULL (WebSocket heartbeat touches carry none)', async () => {
      vi.setSystemTime(1_000_000);
      await service.touchDevice(7, 'E_abc123', '18.22.0');

      const later = 1_000_000 + DEVICE_TOUCH_THROTTLE_MS + 1;
      vi.setSystemTime(later);
      await service.touchDevice(7, 'E_abc123');

      const rows = await readAll();
      expect(rows[0].app_version).toBe('18.22.0');
      expect(num(rows[0].last_seen_at)).toBe(later);
    });

    it('records a changed version immediately, bypassing the throttle', async () => {
      vi.setSystemTime(1_000_000);
      await service.touchDevice(7, 'E_abc123', '18.21.1');

      const soon = 1_000_000 + 1;
      vi.setSystemTime(soon);
      await new DeviceService().touchDevice(7, 'E_abc123', '18.22.0');

      const rows = await readAll();
      expect(rows[0].app_version).toBe('18.22.0');
      expect(num(rows[0].last_seen_at)).toBe(soon);
    });

    it('backfills a version onto a row that had none, bypassing the throttle', async () => {
      vi.setSystemTime(1_000_000);
      await service.touchDevice(7, 'E_abc123');

      vi.setSystemTime(1_000_000 + 1);
      await service.touchDevice(7, 'E_abc123', '18.22.0');

      const rows = await readAll();
      expect(rows[0].app_version).toBe('18.22.0');
    });

    it('still writes nothing for an unchanged version inside the throttle window', async () => {
      vi.setSystemTime(1_000_000);
      await service.touchDevice(7, 'E_abc123', '18.22.0');

      vi.setSystemTime(1_000_000 + DEVICE_TOUCH_THROTTLE_MS - 1);
      await service.touchDevice(7, 'E_abc123', '18.22.0');

      const rows = await readAll();
      expect(num(rows[0].last_seen_at)).toBe(1_000_000);
    });
  });

  it('keeps devices and accounts separate', async () => {
    vi.setSystemTime(1_000_000);
    await service.touchDevice(7, 'E_abc123');
    await service.touchDevice(7, 'A_xyz789');
    await service.touchDevice(8, 'E_abc123');

    const rows = await readAll();
    expect(rows.map((r) => `${r.user_id}:${r.client_id}`)).toEqual([
      '7:A_xyz789',
      '7:E_abc123',
      '8:E_abc123',
    ]);
  });

  // Characterizations of known gaps, not evidence that checkpoints are safe.
  // The ORM adapters above execute the service's time predicates against stored
  // rows; touchDevice's shipped SQL and the gate classifier run unchanged.
  describe('checkpoint gate limitations (#9962)', () => {
    it('reports safe after an old device ages out, then unsafe only after it returns', async () => {
      const firstSeen = 1_000_000;
      vi.setSystemTime(firstSeen);
      await service.touchDevice(7, 'A_modern', '19.0.0');
      // A pre-reporting client can retain unsynced edits while offline.
      await service.touchDevice(7, 'B_old');
      expect((await service.summarizeCheckpointGate(0)).safeAccounts).toBe(0);

      const now = firstSeen + RETENTION_MS + 1;
      const cutoff = now - RETENTION_MS;
      vi.setSystemTime(now);
      await service.touchDevice(7, 'A_modern', '19.0.0');
      expect(await service.deleteStaleDevices(cutoff)).toBe(1);
      expect((await service.summarizeCheckpointGate(cutoff)).safeAccounts).toBe(1);

      // A cadence could now create a checkpoint. Re-registering the old device
      // cannot undo a checkpoint already stored for it to download.
      await service.touchDevice(7, 'B_old');
      expect((await service.summarizeCheckpointGate(cutoff)).safeAccounts).toBe(0);
    });

    it('retains a safe classification when the same device stops reporting its version', async () => {
      vi.setSystemTime(1_000_000);
      await service.touchDevice(7, 'A_modern', '19.0.0');
      expect((await service.summarizeCheckpointGate(0)).safeAccounts).toBe(1);

      vi.setSystemTime(1_000_000 + DEVICE_TOUCH_THROTTLE_MS + 1);
      // A download from a downgraded, pre-reporting client has the same call
      // shape as a heartbeat. COALESCE retains the previously reported version.
      await service.touchDevice(7, 'A_modern');
      const rows = await readAll();
      expect(rows[0].app_version).toBe('19.0.0');
      expect((await service.summarizeCheckpointGate(0)).safeAccounts).toBe(1);
    });
  });
});
