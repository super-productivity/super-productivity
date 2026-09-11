import { PGlite } from '@electric-sql/pglite';
import { RETENTION_MS } from '../src/sync/sync.types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Real-Postgres coverage for `scripts/dry-run-old-ops-sweep.ts` — the read-only
 * gate an operator is supposed to trust before the destructive sweep runs on
 * the hosted database.
 *
 * The gate had never executed anywhere: no spec ran it, and the two failures it
 * is most likely to have are both invisible to a string assertion. It parses
 * only on real Postgres (nested `Prisma.sql` fragments spliced into a chain of
 * CTEs, one of them `AS MATERIALIZED`, plus a correlated aggregate and a
 * `(VALUES …)` join built with `Prisma.join`) — a template that PostgreSQL
 * rejects looks identical to a working one until it is sent. And its *numbers*
 * are the whole product: a boundary or would-delete count that disagrees with
 * `StorageQuotaService.deleteOldSyncedOpsForAllUsers` makes the gate worse than
 * nothing, because it is consulted precisely to authorize deleting user data.
 *
 * This runs the script end to end against an in-process Postgres (PGlite — no
 * Docker, no DATABASE_URL) over a fixture holding one user of every cohort the
 * sweep distinguishes, and asserts the plan it prints.
 *
 * Scope, deliberately: this proves the gate PARSES, PLANS and COUNTS correctly.
 * That its counts match what the sweep actually deletes is asserted against the
 * real service in `tests/integration/old-ops-sweep.integration.spec.ts`, which
 * runs this same query via `fetchOldOpsSweepPlan`.
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

// Mirrors the columns and indexes of schema.prisma the gate reads. The partial
// index is the one the boundary aggregate is expected to ride
// (20260512000000); without it here a query that only performs acceptably
// *because* of it would look identical to one that does not.
const SCHEMA = `
  CREATE TABLE operations (
    id text PRIMARY KEY,
    user_id integer NOT NULL,
    client_id text NOT NULL,
    server_seq integer NOT NULL,
    action_type text NOT NULL,
    op_type text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    payload jsonb NOT NULL,
    vector_clock jsonb NOT NULL,
    schema_version integer NOT NULL,
    client_timestamp bigint NOT NULL,
    received_at bigint NOT NULL,
    repair_base_server_seq integer,
    is_payload_encrypted boolean NOT NULL DEFAULT false
  );
  CREATE UNIQUE INDEX operations_user_id_server_seq_key
    ON operations (user_id, server_seq);
  CREATE INDEX operations_user_id_received_at_server_seq_idx ON operations (user_id, received_at, server_seq);
  CREATE INDEX operations_user_id_full_state_server_seq_idx
    ON operations (user_id, server_seq)
    WHERE op_type IN ('SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR');
  CREATE TABLE user_sync_state (
    user_id integer PRIMARY KEY,
    last_seq integer NOT NULL DEFAULT 0,
    last_snapshot_seq integer,
    snapshot_data bytea,
    snapshot_at bigint,
    latest_full_state_seq integer
  );
`;

const DAY_MS = 24 * 60 * 60 * 1000;

// One user per cohort the gate reports on. `capped` and `uncapped` differ by
// exactly one thing — whether the cached snapshot blob is still there — because
// that difference is the #9688 fix.
const PRUNABLE_USER = 1;
const CAPPED_USER = 2;
const UNCAPPED_USER = 3;
const FRESH_PREFIX_USER = 4;
const LEGACY_REPAIR_USER = 5;
const SEQ1_IMPORT_USER = 6;
const NO_FULL_STATE_USER = 7;

interface TableRow {
  [column: string]: unknown;
}

describe('old-ops sweep dry-run gate (PGlite)', () => {
  let db: PGlite;
  let logged: string[];
  let tables: TableRow[][];
  let errors: string[];
  let exitCode: typeof process.exitCode;

  const now = Date.now();
  // Comfortably outside/inside the gate's own cutoff (now - RETENTION_MS), so
  // the fixture never straddles it while the suite runs.
  const oldAt = BigInt(now - RETENTION_MS - 15 * DAY_MS);
  const freshAt = BigInt(now - 1 * DAY_MS);

  const seedOp = async (
    userId: number,
    serverSeq: number,
    opts: {
      opType?: string;
      repairBaseServerSeq?: number | null;
      receivedAt?: bigint;
      encrypted?: boolean;
    } = {},
  ): Promise<void> => {
    await db.query(
      `INSERT INTO operations (
         id, user_id, client_id, server_seq, action_type, op_type, entity_type,
         entity_id, payload, vector_clock, schema_version, client_timestamp,
         received_at, repair_base_server_seq, is_payload_encrypted
       ) VALUES ($1, $2, $3, $4, '[Task] Add', $5, 'TASK', $6, '{}'::jsonb,
                 '{}'::jsonb, 1, $7, $7, $8, $9)`,
      [
        `dry-run-op-${userId}-${serverSeq}`,
        userId,
        `client-${userId}`,
        serverSeq,
        opts.opType ?? 'CRT',
        `task-${serverSeq}`,
        (opts.receivedAt ?? oldAt).toString(),
        opts.repairBaseServerSeq ?? null,
        opts.encrypted ?? false,
      ],
    );
  };

  const seedSyncState = async (
    userId: number,
    lastSnapshotSeq: number,
    cachedBlob: boolean,
  ): Promise<void> => {
    await db.query(
      `INSERT INTO user_sync_state (user_id, last_seq, last_snapshot_seq, snapshot_data)
       VALUES ($1, $2, $3, $4)`,
      [userId, lastSnapshotSeq, lastSnapshotSeq, cachedBlob ? Buffer.from('blob') : null],
    );
  };

  const seed = async (): Promise<void> => {
    // Prunable: prefix 1-4, causal base 5, tail 6. No sync-state row at all —
    // the #9688 cohort that the pre-fix sweep never even selected.
    for (const seq of [1, 2, 3, 4]) await seedOp(PRUNABLE_USER, seq);
    await seedOp(PRUNABLE_USER, 5, { opType: 'SYNC_IMPORT' });
    await seedOp(PRUNABLE_USER, 6);

    // Capped: newer causal base at 4, but a cached snapshot blob pins the
    // cursor at 1, so the boundary drops to seq 1 and authorizes nothing.
    for (const userId of [CAPPED_USER, UNCAPPED_USER]) {
      await seedOp(userId, 1, { opType: 'SYNC_IMPORT' });
      await seedOp(userId, 2);
      await seedOp(userId, 3);
      await seedOp(userId, 4, { opType: 'BACKUP_IMPORT' });
      await seedOp(userId, 5);
    }
    await seedSyncState(CAPPED_USER, 1, true);
    // Same stale cursor, blob dropped by the E2EE eradication sweep: the cap
    // must lift (keying it on the cursor would exempt this user forever).
    await seedSyncState(UNCAPPED_USER, 1, false);

    // Prunable boundary, but the prefix still holds an op inside retention, so
    // the sweep skips the user whole rather than pruning around it.
    await seedOp(FRESH_PREFIX_USER, 1);
    await seedOp(FRESH_PREFIX_USER, 2, { receivedAt: freshAt });
    await seedOp(FRESH_PREFIX_USER, 3, { opType: 'SYNC_IMPORT', receivedAt: freshAt });

    // Legacy REPAIR (no causal base cursor) never authorizes pruning.
    await seedOp(LEGACY_REPAIR_USER, 1);
    await seedOp(LEGACY_REPAIR_USER, 2);
    await seedOp(LEGACY_REPAIR_USER, 3, { opType: 'REPAIR', repairBaseServerSeq: null });

    // Initial import at seq 1 only: structurally unprunable, and still active.
    await seedOp(SEQ1_IMPORT_USER, 1, { opType: 'SYNC_IMPORT' });
    await seedOp(SEQ1_IMPORT_USER, 2);
    await seedOp(SEQ1_IMPORT_USER, 3, { receivedAt: freshAt });

    // No full-state op at all, encrypted-only, dormant.
    await seedOp(NO_FULL_STATE_USER, 1, { encrypted: true });
    await seedOp(NO_FULL_STATE_USER, 2, { encrypted: true });
  };

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(SCHEMA);
    await seed();
    mocks.state.db = db;

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const consoleTable = vi.spyOn(console, 'table').mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // The script calls `main()` at module scope, so importing it IS running it.
    await import('../scripts/dry-run-old-ops-sweep');
    // It disconnects in its `finally`, strictly after the last console write
    // and after any exit-code write, so waiting on that waits out the run.
    await vi.waitFor(() => expect(mocks.prisma.$disconnect).toHaveBeenCalled());

    logged = consoleLog.mock.calls.map((call: unknown[]) => String(call[0]));
    tables = consoleTable.mock.calls.map((call: unknown[]) => call[0] as TableRow[]);
    errors = consoleError.mock.calls.map((call: unknown[]) => String(call[0]));
    exitCode = process.exitCode;

    // Restore before asserting anything: a failed assertion here would leave
    // console stubbed and `process.exitCode` at 1 for every later test file in
    // this worker, turning one broken gate into an unreadable run.
    consoleLog.mockRestore();
    consoleTable.mockRestore();
    consoleError.mockRestore();
    consoleWarn.mockRestore();
    process.exitCode = undefined;
  });

  afterAll(async () => {
    await db.close();
  });

  const line = (prefix: string): string =>
    logged.find((entry) => entry.startsWith(prefix)) ?? `<no line starting "${prefix}">`;

  it('runs the whole gate against real Postgres without a query error', () => {
    // First, because a query PostgreSQL rejects lands here and would leave
    // every table assertion below vacuously empty rather than failing.
    expect(errors).toEqual([]);
    expect(exitCode).toBeUndefined();
    expect(line('\nAll safety checks passed.')).toContain('All safety checks passed');
  });

  it('re-verifies every boundary it would act on and finds none stale', () => {
    // Safety check 1 sends its own `(VALUES …)` query per chunk; a template
    // Postgres rejects would surface here rather than as a silent OK.
    expect(line('boundary is a surviving causal full-state op:')).toContain('OK');
    expect(
      line('boundary <= lastSnapshotSeq where a cached snapshot blob exists:'),
    ).toContain('OK');
  });

  it('reports the per-user plan for the users the sweep would touch', () => {
    // Sorted by would-delete descending; both users below have a distinct
    // count so the order is defined.
    expect(tables[0]).toEqual([
      {
        user_id: PRUNABLE_USER,
        boundary_seq: 5,
        would_delete: 4,
        base_plus_tail_kept: 2,
        capped: false,
      },
      {
        user_id: UNCAPPED_USER,
        boundary_seq: 4,
        would_delete: 3,
        base_plus_tail_kept: 2,
        capped: false,
      },
    ]);
  });

  it('counts the cohorts it cannot or will not touch', () => {
    expect(line('users holding operations:')).toContain('7');
    // Prunable = boundary above seq 1: the two affected users plus the
    // partly-fresh one the whole-or-nothing rule skips.
    expect(line('  with a causal prune boundary:')).toContain('3');
    expect(line('    boundary capped by snapshot:')).toContain('0');
    expect(line('    skipped, prefix not fully aged:')).toContain('1');
    expect(line('  unreachable (no usable boundary):')).toContain('4');
    expect(line('total rows the sweep would delete:')).toContain('7');
  });

  it('segments the unreachable residual cohort by shape, activity and payload', () => {
    expect(
      [...tables[1]].sort((a, b) => String(a.segment).localeCompare(String(b.segment))),
    ).toEqual([
      {
        segment: 'initial import at seq 1 only | active | holds plaintext',
        users: 1,
        ops: 3,
      },
      { segment: 'legacy-REPAIR-only | dormant | holds plaintext', users: 1, ops: 3 },
      { segment: 'no full-state op at all | dormant | encrypted-only', users: 1, ops: 2 },
      {
        segment:
          'snapshot-capped (cached blob blocks newer boundary) | dormant | holds plaintext',
        users: 1,
        ops: 5,
      },
    ]);
  });
});
