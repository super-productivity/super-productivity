import { PGlite } from '@electric-sql/pglite';
import { SYNC_DEVICES_DDL } from './sync-devices-ddl.helper';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

/**
 * `monitor -- quota` (scripts/quota-headroom.ts): the projection math, and the
 * report's SQL run against an in-process Postgres (PGlite), like
 * monitoring-sql.pglite.spec.ts. No real database is involved.
 */

const mocks = vi.hoisted(() => {
  const state: { db: unknown } = { db: null };
  const prisma = {
    $queryRaw: vi.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown> => {
        const { Prisma } = await import('@prisma/client');
        const sql = Prisma.sql(strings, ...(values as never[]));
        const db = state.db as {
          query: (text: string, values: unknown[]) => Promise<{ rows: unknown[] }>;
        };
        return (await db.query(sql.text, sql.values)).rows;
      },
    ),
    $disconnect: vi.fn(async () => undefined),
  };
  return {
    state,
    prisma,
    PrismaClient: vi.fn(function () {
      return prisma;
    }),
  };
});

vi.mock('@prisma/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@prisma/client')>()),
  PrismaClient: mocks.PrismaClient,
}));

const SCHEMA = `
  CREATE TABLE users (
    id serial PRIMARY KEY,
    email text NOT NULL,
    storage_quota_bytes bigint NOT NULL DEFAULT 104857600,
    storage_used_bytes bigint NOT NULL DEFAULT 0
  );
  CREATE TABLE operations (
    id text PRIMARY KEY,
    user_id integer NOT NULL,
    server_seq integer NOT NULL,
    payload jsonb NOT NULL,
    payload_bytes bigint NOT NULL DEFAULT 0,
    vector_clock jsonb NOT NULL,
    received_at bigint NOT NULL
  );
  CREATE UNIQUE INDEX operations_user_seq ON operations (user_id, server_seq);
  CREATE INDEX operations_user_id_received_at_server_seq_idx
    ON operations (user_id, received_at, server_seq);
  CREATE TABLE user_sync_state (
    user_id integer PRIMARY KEY,
    last_seq integer NOT NULL DEFAULT 0
  );
`;

const MB = 1024 * 1024;
const ONE_DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 10, 12);
const QUOTA = 100 * MB;

interface Fixture {
  id: number;
  usedMb: number;
  quotaMb?: number;
  /** Days since the newest device heartbeat; undefined = no device. */
  lastSeenDaysAgo?: number;
  /** [days ago, MB] per operation. */
  ops?: Array<[number, number]>;
}

// Expected per account (30-day window):
//  1: 95 of 100 MB, 10 MB uploaded -> 5 MB at 1/3 MB/day = 15 days
//  2: 60 MB, 4 MB in window (the 20 MB op is older) -> 40 MB at 0.1333/day = 300 days
//  3: 101 MB, over quota
//  4: 80 MB, heartbeat 40 days old -> outside the growth scope, still in the fleet %
//  5: 10 MB, active but nothing uploaded -> not growing
//  6: 120 of 200 MB, 30 MB uploaded -> 80 MB at 1 MB/day = 80 days
//  7: 20 MB, never synced
const FIXTURES: Fixture[] = [
  {
    id: 1,
    usedMb: 95,
    lastSeenDaysAgo: 1,
    ops: [
      [2, 6],
      [29, 4],
    ],
  },
  {
    id: 2,
    usedMb: 60,
    lastSeenDaysAgo: 0,
    ops: [
      [3, 4],
      [50, 20],
    ],
  },
  { id: 3, usedMb: 101, lastSeenDaysAgo: 0, ops: [[1, 1]] },
  { id: 4, usedMb: 80, lastSeenDaysAgo: 40, ops: [[41, 5]] },
  { id: 5, usedMb: 10, lastSeenDaysAgo: 2 },
  { id: 6, usedMb: 120, quotaMb: 200, lastSeenDaysAgo: 0, ops: [[5, 30]] },
  { id: 7, usedMb: 20 },
];

describe('quota headroom projection', () => {
  it('projects days to quota from the window upload rate', async () => {
    const { projectDaysToQuota } = await import('../scripts/quota-headroom');
    const base = { id: 1, quotaBytes: 100, usedBytes: 40 };
    expect(projectDaysToQuota({ ...base, uploadedBytes: 30 })).toBe(60);
    expect(projectDaysToQuota({ ...base, uploadedBytes: 30 }, 10)).toBe(20);
    expect(projectDaysToQuota({ ...base, uploadedBytes: 0 })).toBeNull();
    expect(projectDaysToQuota({ ...base, usedBytes: 100, uploadedBytes: 0 })).toBe(0);
    expect(projectDaysToQuota({ ...base, usedBytes: 120, uploadedBytes: 5 })).toBe(0);
  });

  it('orders soonest first, then non-growing accounts by quota use', async () => {
    const { sortByUrgency, toAccountReport } = await import('../scripts/quota-headroom');
    const reports = [
      { id: 1, usedBytes: 10, quotaBytes: 100, uploadedBytes: 0 },
      { id: 2, usedBytes: 50, quotaBytes: 100, uploadedBytes: 0 },
      { id: 3, usedBytes: 50, quotaBytes: 100, uploadedBytes: 5 },
      { id: 4, usedBytes: 100, quotaBytes: 100, uploadedBytes: 0 },
    ].map((a) => toAccountReport(a));
    expect(sortByUrgency(reports).map((r) => r.id)).toEqual([4, 3, 2, 1]);
  });

  it('counts horizons cumulatively and keeps accounts at quota out of them', async () => {
    const { summarizeProjections, toAccountReport } =
      await import('../scripts/quota-headroom');
    const summary = summarizeProjections(
      [
        { id: 1, usedBytes: 0, quotaBytes: 90, uploadedBytes: 30 }, // 90 days
        { id: 2, usedBytes: 0, quotaBytes: 91, uploadedBytes: 30 }, // 91 days
        { id: 3, usedBytes: 0, quotaBytes: 365, uploadedBytes: 30 }, // 365 days
        { id: 4, usedBytes: 0, quotaBytes: 366, uploadedBytes: 30 }, // 366 days
        { id: 5, usedBytes: 5, quotaBytes: 5, uploadedBytes: 30 }, // at quota
      ].map((a) => toAccountReport(a)),
    );
    expect(summary).toEqual({
      withinDays: { 90: 1, 180: 2, 365: 3 },
      atOrOverQuota: 1,
    });
  });
});

describe('quota growth estimate', () => {
  it('multiplies the window operation count by the window average size', async () => {
    const { estimateWindowBytes } = await import('../scripts/quota-headroom');
    const row = { user_id: 1, last_seq: 50, avg_bytes: 999 };
    expect(estimateWindowBytes({ ...row, first_seq: 41, avg_window_bytes: 100 })).toBe(
      1000,
    );
    // No in-window size known: fall back to the tail average.
    expect(estimateWindowBytes({ ...row, first_seq: 50, avg_window_bytes: null })).toBe(
      999,
    );
    // Nothing in the window.
    expect(estimateWindowBytes({ ...row, first_seq: null, avg_window_bytes: null })).toBe(
      0,
    );
    // bigint columns from Postgres.
    expect(
      estimateWindowBytes({
        ...row,
        last_seq: BigInt(10),
        first_seq: BigInt(9),
        avg_window_bytes: 5,
      }),
    ).toBe(10);
  });
});

describe('monitor quota SQL (PGlite)', () => {
  let db: PGlite;
  let previousScopeUsers: string | undefined;
  let consoleTable: ReturnType<typeof vi.spyOn>;
  let consoleLog: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(SCHEMA + SYNC_DEVICES_DDL);
    for (const f of FIXTURES) {
      await db.query(
        `INSERT INTO users (id, email, storage_quota_bytes, storage_used_bytes)
         VALUES ($1, $2, $3, $4)`,
        [f.id, `user${f.id}@example.com`, (f.quotaMb ?? 100) * MB, f.usedMb * MB],
      );
      if (f.lastSeenDaysAgo !== undefined) {
        // A second, older device: the scope must not count an account twice.
        for (const [client, ago] of [
          ['a', f.lastSeenDaysAgo],
          ['b', f.lastSeenDaysAgo + 3],
        ] as const) {
          await db.query(
            `INSERT INTO sync_devices (client_id, user_id, last_seen_at, created_at)
             VALUES ($1, $2, $3, $3)`,
            [`client-${f.id}-${client}`, f.id, NOW - ago * ONE_DAY],
          );
        }
      }
      // server_seq is per account and grows with received_at, as in production.
      const ops = [...(f.ops ?? [])].sort(([a], [b]) => b - a);
      for (const [index, [ago, mb]] of ops.entries()) {
        await db.query(
          `INSERT INTO operations
             (id, user_id, server_seq, payload, payload_bytes, vector_clock, received_at)
           VALUES ($1, $2, $3, '{}', $4, '{}', $5)`,
          [`op-${f.id}-${index + 1}`, f.id, index + 1, mb * MB, NOW - ago * ONE_DAY],
        );
      }
      if (ops.length > 0) {
        await db.query(
          `INSERT INTO user_sync_state (user_id, last_seq) VALUES ($1, $2)`,
          [f.id, ops.length],
        );
      }
    }
    mocks.state.db = db;
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(() => {
    vi.resetModules();
    mocks.prisma.$queryRaw.mockClear();
    previousScopeUsers = process.env.MONITOR_SCOPE_USERS;
    delete process.env.MONITOR_SCOPE_USERS;
    consoleTable = vi.spyOn(console, 'table').mockImplementation(() => undefined);
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (previousScopeUsers === undefined) delete process.env.MONITOR_SCOPE_USERS;
    else process.env.MONITOR_SCOPE_USERS = previousScopeUsers;
    vi.restoreAllMocks();
  });

  const tables = (): Array<Array<Record<string, unknown>>> =>
    consoleTable.mock.calls.map(
      (call: unknown[]) => call[0] as Record<string, unknown>[],
    );

  const renderedQueries = (): string[] =>
    mocks.prisma.$queryRaw.mock.calls.map((call) =>
      (call[0] as TemplateStringsArray).join('?'),
    );

  it('summarises every account against its own quota', async () => {
    const { queryFleetSummary } = await import('../scripts/quota-headroom');
    expect(await queryFleetSummary()).toEqual({
      accounts: 7,
      abovePercent: { 50: 5, 75: 3, 90: 2 },
      atOrOverQuota: 1,
    });
  });

  it('measures growth only for accounts active in the window, over the window', async () => {
    const { queryGrowingAccounts } = await import('../scripts/quota-headroom');
    const { accounts, matched } = await queryGrowingAccounts(
      BigInt(NOW - 30 * ONE_DAY),
      200,
    );
    expect(matched).toBe(5);
    expect(accounts).toEqual([
      { id: 3, usedBytes: 101 * MB, quotaBytes: QUOTA, uploadedBytes: 1 * MB },
      { id: 1, usedBytes: 95 * MB, quotaBytes: QUOTA, uploadedBytes: 10 * MB },
      { id: 2, usedBytes: 60 * MB, quotaBytes: QUOTA, uploadedBytes: 4 * MB },
      { id: 6, usedBytes: 120 * MB, quotaBytes: 200 * MB, uploadedBytes: 30 * MB },
      { id: 5, usedBytes: 10 * MB, quotaBytes: QUOTA, uploadedBytes: 0 },
    ]);
  });

  it('caps the growth scope at MONITOR_SCOPE_USERS, highest quota use first', async () => {
    process.env.MONITOR_SCOPE_USERS = '2';
    const { showQuotaHeadroom } = await import('../scripts/quota-headroom');
    await showQuotaHeadroom([], NOW);
    const perAccount = tables()[2];
    expect(perAccount.map((row) => row.ID)).toEqual([3, 1]);
    expect(consoleLog.mock.calls.flat().join('\n')).toContain(
      'the 2 with the highest quota use of 5 accounts active in the last 30 days',
    );
  });

  it('prints the fleet, projection and per-account tables', async () => {
    const { showQuotaHeadroom } = await import('../scripts/quota-headroom');
    await showQuotaHeadroom(['--limit', '10'], NOW);
    const [fleet, projections, perAccount] = tables();
    expect(fleet.map((row) => row.Accounts)).toEqual([5, 3, 2, 1]);
    expect(projections).toEqual([
      { 'Reaches quota': 'within 90 days', Accounts: 2 },
      { 'Reaches quota': 'within 180 days', Accounts: 2 },
      { 'Reaches quota': 'within 365 days', Accounts: 3 },
      { 'Reaches quota': 'already at or over', Accounts: 1 },
    ]);
    expect(perAccount.map((row) => [row.ID, row['To quota']])).toEqual([
      [3, 'at quota'],
      [1, '15 d'],
      [6, '80 d'],
      [2, '300 d'],
      [5, 'not growing'],
    ]);
  });

  it('never reads or prints an email address', async () => {
    const { showQuotaHeadroom } = await import('../scripts/quota-headroom');
    await showQuotaHeadroom([], NOW);
    for (const query of renderedQueries()) expect(query).not.toMatch(/email/i);
    expect(JSON.stringify(tables())).not.toContain('@');
    expect(consoleLog.mock.calls.flat().join('\n')).not.toContain('@');
  });

  it('reads operations through bounded per-account lookups, never a window sum', async () => {
    const { showQuotaHeadroom } = await import('../scripts/quota-headroom');
    await showQuotaHeadroom([], NOW);
    const opsQueries = renderedQueries().filter((q) => /\boperations\b/.test(q));
    expect(opsQueries).toHaveLength(1);
    const [query] = opsQueries;
    expect(query).toContain('unnest(');
    // Both per-account lookups are LIMITed index reads...
    expect(query.match(/LATERAL/g)).toHaveLength(2);
    expect(query.match(/LIMIT (\?|1)(?!\d)/g)).toHaveLength(2);
    expect(query).toMatch(
      /ORDER BY operations\.received_at, operations\.server_seq\s+LIMIT/,
    );
    expect(query).toMatch(/ORDER BY operations\.server_seq DESC\s+LIMIT/);
    // ...and nothing sums the window, which timed out on the hosted instance.
    expect(query).not.toMatch(/SUM\(/);
  });

  it('runs through the monitor CLI', async () => {
    const previousArgv = process.argv;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.argv = ['node', 'monitor', 'quota'];
    try {
      await import('../scripts/monitor');
      await vi.waitFor(() => expect(mocks.prisma.$disconnect).toHaveBeenCalled());
      expect(consoleError).not.toHaveBeenCalled();
      expect(tables()).toHaveLength(3);
    } finally {
      process.argv = previousArgv;
    }
  });
});
