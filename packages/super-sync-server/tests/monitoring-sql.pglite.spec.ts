import { PGlite } from '@electric-sql/pglite';
import { RETENTION_DAYS } from '../src/sync/sync.types';
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
 * Real-Postgres coverage for the monitoring/analysis CLIs.
 *
 * monitoring-scripts.spec.ts renders each query to a STRING and asserts what it
 * contains — it never sends the SQL anywhere, so a query Postgres refuses to parse
 * still passes there. That matters because the bounded rewrites these reports rely
 * on use constructs a string assertion cannot vet: nested Prisma.sql fragments spliced
 * into MATERIALIZED CTEs, `unnest($1::int[])` driving CROSS JOIN LATERAL per-user
 * tails, and `COUNT(*) OVER ()` alongside a LIMIT. This spec executes the
 * real tagged templates against an in-process Postgres (PGlite — no Docker, no
 * DATABASE_URL).
 *
 * Scope, deliberately: this proves each query PARSES AND PLANS on real Postgres, and
 * that the row-shaping code downstream survives real result rows. It does NOT vet
 * production query cost — the fixture has no realistic index set or row count.
 * Semantics stay pinned by the string assertions in monitoring-scripts.spec.ts;
 * the two specs are complementary.
 *
 * The `active-users` report is the exception: monitoring-scripts.spec.ts carries no
 * assertions on it, so the few SQL-shape assertions it needs live here alongside its
 * behavioural ones. They exist because its two known regressions — widening the
 * window driver back to `users`, and re-splitting the windows into one statement
 * each — are pure COST regressions that emit byte-identical output, so nothing an
 * assertion on the numbers can see would catch them.
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
    user: {
      count: vi.fn(async () => 4),
      findUnique: vi.fn(async () => ({ email: 'user1@example.com' })),
    },
    operation: { findUnique: vi.fn(async () => null) },
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

// Mirrors the monitored columns of schema.prisma. Only the tables these reports read.
const SCHEMA = `
  CREATE TABLE users (
    id serial PRIMARY KEY,
    email text NOT NULL,
    is_verified integer NOT NULL DEFAULT 0,
    created_at timestamp(3) NOT NULL DEFAULT now(),
    storage_quota_bytes bigint NOT NULL DEFAULT 104857600,
    storage_used_bytes bigint NOT NULL DEFAULT 0
  );
  CREATE TABLE operations (
    id text PRIMARY KEY,
    user_id integer NOT NULL,
    client_id text NOT NULL,
    server_seq integer NOT NULL,
    action_type text NOT NULL,
    op_type text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    entity_ids text[] NOT NULL DEFAULT '{}',
    payload jsonb NOT NULL,
    payload_bytes bigint NOT NULL DEFAULT 0,
    vector_clock jsonb NOT NULL,
    schema_version integer NOT NULL,
    client_timestamp bigint NOT NULL,
    received_at bigint NOT NULL,
    is_payload_encrypted boolean NOT NULL DEFAULT false
  );
  CREATE UNIQUE INDEX operations_user_seq ON operations (user_id, server_seq);
  -- Mirrors 0_init. Without it the fixture cannot exercise the plan the
  -- received_at-bounded reports depend on, so a query that only performs
  -- acceptably *because* of this index would look identical here to one that
  -- does not.
  CREATE INDEX operations_user_id_received_at_idx ON operations (user_id, received_at);
  CREATE TABLE user_sync_state (
    user_id integer PRIMARY KEY,
    last_seq integer NOT NULL DEFAULT 0,
    last_snapshot_seq integer,
    snapshot_data bytea,
    snapshot_at bigint
  );
  CREATE TABLE sync_devices (
    client_id text NOT NULL,
    user_id integer NOT NULL,
    device_name text,
    last_seen_at bigint NOT NULL,
    last_acked_seq integer NOT NULL DEFAULT 0,
    created_at bigint NOT NULL,
    PRIMARY KEY (user_id, client_id)
  );
`;

const ONE_DAY = 24 * 60 * 60 * 1000;

const SYNCING_USERS = 3;
// Heartbeat 10 days old, newest operation 40 days old. Straddles the 7d/30d/90d
// boundaries in DIFFERENT places for the two columns, which is what makes
// "connected" and "syncing" separable: a fixture where every user is inside
// every window cannot tell the per-window counts apart at all, and cannot catch
// a probe that reports the heartbeat where it means the operation.
const LAPSED_USER = 4;
const LAPSED_LAST_SEEN_AGO = 10 * ONE_DAY;
const LAPSED_LAST_OP_AGO = 40 * ONE_DAY;
const NEVER_SYNCED_USER = 5; // no device, no ops, no sync state
// The cohort daily cleanup actually produces: operations with NO sync_devices
// row. `deleteStaleDevices` prunes every device unseen for RETENTION_DAYS, while
// `deleteOldSyncedOpsForAllUsers` SKIPS users whose snapshot predates the same
// cutoff -- so a long-lapsed user keeps its operations and loses its heartbeat.
// A fixture without this user cannot detect a window widened past retention,
// where the device-scoped driver silently stops seeing these accounts.
const PRUNED_DEVICE_USER = 6;
const PRUNED_LAST_OP_AGO = 60 * ONE_DAY;
const TOTAL_USERS = 6;
const OPS_PER_USER = 20;
const MULTI_DEVICE_USER = 1;
const MULTI_DEVICE_COUNT = 3;
// Heartbeats are staggered so the "most recently active users" cap has a defined
// order to cut on; the highest-numbered syncing user is the newest.
const NEWEST_USER = SYNCING_USERS;
// Operations of the syncing users spread over this many distinct UTC days, all
// inside the 7-day window. Engagement is counted in distinct days, so a fixture
// packed into one day leaves the engaged-users report permanently empty.
const ENGAGED_ACTIVE_DAYS = 5;

interface TableRow {
  [column: string]: unknown;
}

describe('monitoring report SQL (PGlite)', () => {
  let db: PGlite;
  let previousArgv: string[];
  let previousExitCode: typeof process.exitCode;
  let previousScopeUsers: string | undefined;
  let consoleLog: ReturnType<typeof vi.spyOn>;
  let consoleError: ReturnType<typeof vi.spyOn>;
  let consoleTable: ReturnType<typeof vi.spyOn>;

  const seed = async (): Promise<void> => {
    const now = Date.now();

    for (let userId = 1; userId <= SYNCING_USERS; userId++) {
      await db.query(
        `INSERT INTO users (id, email, is_verified, storage_used_bytes)
         VALUES ($1, $2, 1, $3)`,
        [userId, `user${userId}@example.com`, 1000 * userId],
      );
      await db.query(
        `INSERT INTO user_sync_state
           (user_id, last_seq, last_snapshot_seq, snapshot_data, snapshot_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, 10 * userId, 5 * userId, Buffer.from(`snapshot-${userId}`), now],
      );
      // One user owns several devices so the sync_devices join fan-out is visible.
      const devices = userId === MULTI_DEVICE_USER ? MULTI_DEVICE_COUNT : 1;
      for (let device = 1; device <= devices; device++) {
        await db.query(
          `INSERT INTO sync_devices
             (client_id, user_id, device_name, last_seen_at, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            `client-${userId}-${device}`,
            userId,
            `Device ${userId}-${device}`,
            now - (SYNCING_USERS - userId) * 1000 - 1000,
            now - 100000,
          ],
        );
      }
      for (let seq = 1; seq <= OPS_PER_USER; seq++) {
        await db.query(
          `INSERT INTO operations
             (id, user_id, client_id, server_seq, action_type, op_type, entity_type,
              entity_id, payload, payload_bytes, vector_clock, schema_version,
              client_timestamp, received_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,$12,$12)`,
          [
            `op-${userId}-${seq}`,
            userId,
            `client-${userId}-1`,
            seq,
            '[Task] Update Task',
            'UPD',
            'TASK',
            `task-${seq}`,
            JSON.stringify({ title: 'x'.repeat(seq) }),
            // Leave the odd rows unbackfilled so the OCTET_LENGTH(payload) fallback
            // branch of every size expression is executed, not just the counter.
            seq % 2 === 0 ? 100 * seq : 0,
            JSON.stringify({ [`client-${userId}-1`]: seq }),
            // Newer ops carry a higher server_seq, matching production ordering.
            // Spread over ENGAGED_ACTIVE_DAYS distinct days but still inside the
            // 7-day window, so the newest op of every syncing user is `now`.
            now - ((OPS_PER_USER - seq) % ENGAGED_ACTIVE_DAYS) * ONE_DAY,
          ],
        );
      }
    }

    // A user who still opens the app but has stopped changing anything: the
    // heartbeat is 10 days old while the newest operation is 40 days old, so the
    // two columns of every window disagree for exactly one account.
    await db.query(
      `INSERT INTO users (id, email, is_verified, storage_used_bytes)
       VALUES ($1, $2, 1, 500)`,
      [LAPSED_USER, `user${LAPSED_USER}@example.com`],
    );
    // Sync state without a snapshot: the upload path always writes this row, but
    // holding no snapshot keeps this user out of the snapshot ranking.
    await db.query(`INSERT INTO user_sync_state (user_id, last_seq) VALUES ($1, $2)`, [
      LAPSED_USER,
      1,
    ]);
    await db.query(
      `INSERT INTO sync_devices
         (client_id, user_id, device_name, last_seen_at, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        `client-${LAPSED_USER}-1`,
        LAPSED_USER,
        `Device ${LAPSED_USER}-1`,
        now - LAPSED_LAST_SEEN_AGO,
        now - 90 * ONE_DAY,
      ],
    );
    await db.query(
      `INSERT INTO operations
         (id, user_id, client_id, server_seq, action_type, op_type, entity_type,
          entity_id, payload, payload_bytes, vector_clock, schema_version,
          client_timestamp, received_at)
       VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,1,$11,$11)`,
      [
        `op-${LAPSED_USER}-1`,
        LAPSED_USER,
        `client-${LAPSED_USER}-1`,
        '[Task] Update Task',
        'UPD',
        'TASK',
        'task-1',
        JSON.stringify({ title: 'lapsed' }),
        100,
        JSON.stringify({ [`client-${LAPSED_USER}-1`]: 1 }),
        now - LAPSED_LAST_OP_AGO,
      ],
    );

    // A registered user who never synced: exercises the LEFT JOIN / COALESCE /
    // GREATEST branches that a fully populated fixture never reaches.
    await db.query(
      `INSERT INTO users (id, email, is_verified, storage_used_bytes)
       VALUES ($1, $2, 0, 0)`,
      [NEVER_SYNCED_USER, `user${NEVER_SYNCED_USER}@example.com`],
    );

    // Long-lapsed: operations survive, the device row has been pruned. See
    // PRUNED_DEVICE_USER for why this state is the normal outcome of cleanup
    // rather than a corrupt fixture.
    await db.query(
      `INSERT INTO users (id, email, is_verified, storage_used_bytes)
       VALUES ($1, $2, 1, 300)`,
      [PRUNED_DEVICE_USER, `user${PRUNED_DEVICE_USER}@example.com`],
    );
    await db.query(`INSERT INTO user_sync_state (user_id, last_seq) VALUES ($1, $2)`, [
      PRUNED_DEVICE_USER,
      1,
    ]);
    await db.query(
      `INSERT INTO operations
         (id, user_id, client_id, server_seq, action_type, op_type, entity_type,
          entity_id, payload, payload_bytes, vector_clock, schema_version,
          client_timestamp, received_at)
       VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,1,$11,$11)`,
      [
        `op-${PRUNED_DEVICE_USER}-1`,
        PRUNED_DEVICE_USER,
        `client-${PRUNED_DEVICE_USER}-1`,
        '[Task] Update Task',
        'UPD',
        'TASK',
        'task-1',
        JSON.stringify({ title: 'pruned' }),
        100,
        JSON.stringify({ [`client-${PRUNED_DEVICE_USER}-1`]: 1 }),
        now - PRUNED_LAST_OP_AGO,
      ],
    );
  };

  beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    mocks.state.db = db;
    await db.exec(SCHEMA);
    await seed();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(() => {
    vi.resetModules();
    previousArgv = process.argv;
    previousExitCode = process.exitCode;
    previousScopeUsers = process.env.MONITOR_SCOPE_USERS;
    delete process.env.MONITOR_SCOPE_USERS;
    process.exitCode = undefined;
    mocks.prisma.$disconnect.mockClear();
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    consoleTable = vi.spyOn(console, 'table').mockImplementation(() => undefined);
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // The CLIs call process.exit directly on bad arguments; without this a future
    // argv would kill the vitest worker instead of failing a test.
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`Unexpected process.exit(${code})`);
    });
  });

  afterEach(() => {
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
    if (previousScopeUsers === undefined) delete process.env.MONITOR_SCOPE_USERS;
    else process.env.MONITOR_SCOPE_USERS = previousScopeUsers;
    vi.restoreAllMocks();
  });

  const SCRIPTS = {
    monitor: () => import('../scripts/monitor'),
    'analyze-storage': () => import('../scripts/analyze-storage'),
  };

  const run = async (script: keyof typeof SCRIPTS, args: string[]): Promise<void> => {
    process.argv = ['node', script, ...args];
    await SCRIPTS[script]();
    // Every CLI disconnects in its `finally`, strictly after any console.error and
    // any exit-code write, so waiting on it also waits out the whole query chain.
    await vi.waitFor(() => expect(mocks.prisma.$disconnect).toHaveBeenCalled());
    expect(consoleError.mock.calls).toEqual([]);
    expect(process.exitCode).toBeUndefined();
  };

  const tableRows = (): TableRow[] =>
    consoleTable.mock.calls.flatMap((call: unknown[]) => call[0] as TableRow[]);

  const rowsWithColumn = (column: string): TableRow[] =>
    tableRows().filter((row) => column in row);

  // Every report the production suite runs, plus the two `monitor` commands that are
  // only reachable directly (documented in MONITORING-README.md and docker-monitor.sh).
  const REPORTS: Array<[string, keyof typeof SCRIPTS, string[]]> = [
    ['monitor active-users (direct command only)', 'monitor', ['active-users']],
    ['monitor active-users --engaged', 'monitor', ['active-users', '--engaged']],
    ['monitor active-users-quick', 'monitor', ['active-users-quick']],
    ['monitor ops (all users)', 'monitor', ['ops']],
    ['monitor ops (single user)', 'monitor', ['ops', '--user', '1']],
    ['analyze operation-sizes (sampled fleet)', 'analyze-storage', ['operation-sizes']],
    [
      'analyze operation-sizes (single user)',
      'analyze-storage',
      ['operation-sizes', '--user', '1'],
    ],
    ['analyze operation-types (sampled fleet)', 'analyze-storage', ['operation-types']],
    [
      'analyze operation-types (single user)',
      'analyze-storage',
      ['operation-types', '--user', '1'],
    ],
    ['analyze operation-timeline', 'analyze-storage', ['operation-timeline']],
    [
      'analyze large-ops (sampled fleet)',
      'analyze-storage',
      ['large-ops', '--limit', '20'],
    ],
    ['analyze rapid-fire', 'analyze-storage', ['rapid-fire', '--threshold', '5']],
    ['analyze snapshot-analysis', 'analyze-storage', ['snapshot-analysis']],
  ];

  for (const [name, script, args] of REPORTS) {
    it(`parses and plans on real Postgres: ${name}`, async () => {
      await run(script, args);
    });
  }

  it('lists every user from the cached storage counter, including never-synced ones', async () => {
    await run('monitor', ['usage', '--no-save']);
    expect(rowsWithColumn('LastSeq')).toHaveLength(TOTAL_USERS);
  });

  it('lists the newest operations per user first', async () => {
    await run('monitor', ['ops', '--user', '1', '--tail', '5']);
    const ops = rowsWithColumn('PayloadSize');
    expect(ops).toHaveLength(5);
    // server_seq DESC, so the highest-seq (newest) op leads.
    expect(ops[0].Entity).toBe(`TASK:task-${OPS_PER_USER}`);
  });

  it('reads only the capped set of most recently active users', async () => {
    process.env.MONITOR_SCOPE_USERS = '1';
    await run('monitor', ['ops']);
    const users = new Set(rowsWithColumn('PayloadSize').map((row) => row.User));
    // Without the cap this query fans out across every user that ever synced --
    // the driver that made this report time out against production.
    expect(users).toEqual(new Set([NEWEST_USER]));
  });

  it('reports how many users matched when the cap truncates the fleet', async () => {
    process.env.MONITOR_SCOPE_USERS = '1';
    await run('analyze-storage', ['rapid-fire']);
    // "up to N" reads identically whether the cap bound or not; the realized
    // counts are what tell an operator they are looking at a truncated sample.
    expect(consoleLog).toHaveBeenCalledWith(
      `Based on the newest 100 operations of each of the 1 most recently active users, of ${SYNCING_USERS} matching (widen with MONITOR_SCOPE_USERS).`,
    );
  });

  it('refuses a MONITOR_SCOPE_USERS value that would remove the bound', async () => {
    // parseInt('abc') is NaN, which Prisma serialises to SQL NULL -- and
    // `LIMIT NULL` is `LIMIT ALL`, i.e. the unbounded fan-out this module exists
    // to prevent. It has to fail loudly instead.
    process.env.MONITOR_SCOPE_USERS = 'abc';
    process.argv = ['node', 'analyze-storage', 'rapid-fire'];
    await SCRIPTS['analyze-storage']();
    await vi.waitFor(() => expect(mocks.prisma.$disconnect).toHaveBeenCalled());
    expect(process.exitCode).toBe(1);
    expect(consoleError).toHaveBeenCalledWith(
      'Error:',
      expect.objectContaining({
        message: expect.stringContaining(
          'MONITOR_SCOPE_USERS must be a positive integer',
        ),
      }),
    );
    process.exitCode = undefined;
  });

  it("does not multiply a user's operation count by their device count", async () => {
    await run('monitor', ['active-users']);
    const recent = rowsWithColumn('Ops (7d)');
    const multiDevice = recent.find((row) => row.ID === MULTI_DEVICE_USER);
    expect(multiDevice?.Devices).toBe(MULTI_DEVICE_COUNT);
    // ops_7d is counted after the page is cut, so no sync_devices join remains to
    // fan the rows out. Were operations joined alongside devices again, this
    // would read OPS_PER_USER * MULTI_DEVICE_COUNT.
    expect(multiDevice?.['Ops (7d)']).toBe(OPS_PER_USER);
  });

  it('counts each active user once per window, and never-synced users not at all', async () => {
    await run('monitor', ['active-users']);

    // SYNCING_USERS connected, not SYNCING_USERS + (MULTI_DEVICE_COUNT - 1):
    // the per-user maxima collapse a user's devices before anything is counted.
    // And the registered-but-never-synced user is in no window at all.
    //
    // The lapsed user is what separates the two columns. It enters "connected"
    // at 30d (heartbeat 10 days old) but "syncing" only at 90d (newest operation
    // 40 days old), so a probe that read the heartbeat where it means the
    // operation would report SYNCING_USERS + 1 syncing at 30d, and a driver
    // narrowed to a window smaller than the widest would drop it from both.
    expect(consoleLog).toHaveBeenCalledWith(
      `  Last 24 hours: ${SYNCING_USERS} connected / ${SYNCING_USERS} syncing`,
    );
    expect(consoleLog).toHaveBeenCalledWith(
      `  Last 7 days: ${SYNCING_USERS} connected / ${SYNCING_USERS} syncing`,
    );
    expect(consoleLog).toHaveBeenCalledWith(
      `  Last 30 days: ${SYNCING_USERS + 1} connected / ${SYNCING_USERS} syncing`,
    );
    expect(consoleLog).toHaveBeenCalledWith(
      `  Last 45 days: ${SYNCING_USERS + 1} connected / ${SYNCING_USERS + 1} syncing`,
    );
  });

  it('never claims a window wider than the operations it can still see', async () => {
    await run('monitor', ['active-users']);

    // The device-scoped driver is exact only at or below retention. Past it,
    // PRUNED_DEVICE_USER -- operations at 60 days, device row already swept --
    // is invisible to the driver but WOULD be counted by a direct scan of
    // `operations`, so a wider window under-reports without any sign of it.
    // Widening the last window back to 90 days makes this fail.
    const windowLines: string[] = consoleLog.mock.calls
      .map((call: unknown[]) => String(call[0]))
      .filter((line: string) => / connected \/ .* syncing$/.test(line));
    expect(windowLines).toHaveLength(4);
    expect(windowLines.some((line: string) => line.includes('Last 90 days'))).toBe(false);
    // Pinned to the server's retention constant, not to the literal 45: lowering
    // RETENTION_DAYS shrinks the window the driver can answer exactly, and
    // nothing in monitor.ts would otherwise notice.
    expect(windowLines[3]).toContain(`Last ${RETENTION_DAYS} days`);
  });

  it('answers every window from one pass over the operations table', async () => {
    await run('monitor', ['active-users']);

    const statements = mocks.prisma.$queryRaw.mock.calls.map((call: unknown[]) =>
      (call[0] as TemplateStringsArray).join('?'),
    );

    // The shape this replaced issued `COUNT(DISTINCT user_id) FROM operations`
    // once per window. `received_at` is the non-leading column of the only index
    // covering it, so each of those walked the whole index -- a cost set by the
    // size of `operations` rather than by the size of the answer, and charged
    // four times per report.
    expect(statements.filter((sql) => sql.includes('COUNT(DISTINCT user_id)'))).toEqual(
      [],
    );
    // All four windows come back from a single bucketed pass instead.
    const windowed = statements.filter((sql: string) => sql.includes('windows (bucket)'));
    expect(windowed).toHaveLength(1);

    // The driver table, pinned. Widening it back to `users` -- the shape that
    // was tried and reverted -- pays an index descent for every registered
    // account including those that never synced, but produces byte-identical
    // output on any fixture. No assertion on the numbers can catch that; only
    // an assertion on the SQL can.
    expect(windowed[0]).toMatch(
      /active_devices AS MATERIALIZED[\s\S]*?FROM sync_devices/,
    );
    expect(windowed[0]).not.toMatch(/active_devices AS MATERIALIZED[\s\S]*?FROM users/);
  });

  it('leaves the operations-bound engaged section out of the default report', async () => {
    await run('monitor', ['active-users']);

    // The default report has to be answerable from the active-user set alone.
    // Engagement is counted in distinct active days, so it must visit every
    // operation in a two-week window -- more work than the windowed count that
    // was already exceeding statement_timeout on the hosted instance.
    const statements = mocks.prisma.$queryRaw.mock.calls.map((call: unknown[]) =>
      (call[0] as TemplateStringsArray).join('?'),
    );
    expect(statements.filter((sql) => sql.includes('active_days'))).toEqual([]);
    expect(rowsWithColumn('Active Days')).toEqual([]);
    expect(consoleLog).toHaveBeenCalledWith(
      '\n--- Engaged Users: skipped (pass --engaged; reads 2 weeks of operations) ---',
    );
  });

  it('reports the true engaged-user count while paging the table', async () => {
    await run('monitor', ['active-users', '--engaged', '--limit', '2']);

    // Every syncing user is engaged: their operations span ENGAGED_ACTIVE_DAYS
    // distinct UTC days, above the default threshold of 3.
    expect(consoleLog).toHaveBeenCalledWith(`Count: ${SYNCING_USERS}`);
    expect(consoleLog).toHaveBeenCalledWith(`(showing the top 2 of ${SYNCING_USERS})`);
    // The count above is what the section is for; the row list is a sample of it
    // and must honour --limit, as every other table in this report does.
    expect(rowsWithColumn('Active Days')).toHaveLength(2);
  });

  it('still reports the engaged count when asked for no rows', async () => {
    await run('monitor', ['active-users', '--engaged', '--limit', '0']);

    // `--limit 0` is a legal way to ask for counts without a table. The count
    // rides back on the rows, so fetching literally zero of them would print
    // "Count: 0" for a fleet of thousands -- a wrong number, not a missing one.
    expect(consoleLog).toHaveBeenCalledWith(`Count: ${SYNCING_USERS}`);
    expect(rowsWithColumn('Active Days')).toEqual([]);
  });

  it('buckets per-user sizes across backfilled and unbackfilled rows', async () => {
    await run('analyze-storage', ['operation-sizes', '--user', '1']);
    const buckets = rowsWithColumn('Bucket').map((row) => row.Bucket);
    // Odd seqs fall back to OCTET_LENGTH(payload), even seqs use payload_bytes
    // (100..2000), so both branches must contribute rows.
    expect(buckets).toContain('0-512B');
    expect(buckets).toContain('1KB-5KB');
  });

  it('ranks only users that actually hold a snapshot', async () => {
    await run('analyze-storage', ['snapshot-analysis']);
    expect(rowsWithColumn('SnapshotSize')).toHaveLength(SYNCING_USERS);
  });
});
