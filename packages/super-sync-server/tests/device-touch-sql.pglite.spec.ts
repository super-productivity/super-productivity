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
const { DEVICE_TOUCH_THROTTLE_MS } = await import('../src/sync/sync.types');

type Row = {
  client_id: string;
  user_id: number;
  last_seen_at: bigint | string | number;
  created_at: bigint | string | number;
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
});
