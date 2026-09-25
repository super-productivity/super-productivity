import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

import {
  CAUSAL_FULL_STATE_OPERATION_WHERE,
  latestCausalFullStateSql,
} from '../src/sync/sync.types';
import { createIndexFromMigration } from './migration-index.helper';
import { explainCustom, explainGeneric } from './explain-plan.helper';

/**
 * Real-Postgres coverage for `latestCausalFullStateSql` — the statement both sync hot
 * paths use to find a user's newest causal full-state op (download fast-forward,
 * upload clock-pruning author).
 *
 * Everything else that covers it is MOCKED: the unit specs assert on SQL text, so a
 * statement Postgres rejects, or one that quietly returns the wrong row, passes them
 * all. That is not hypothetical here — the statement was rewritten from a Prisma
 * `findFirst` into raw SQL, so its column names, its row shape and its exclusion of
 * legacy REPAIRs are now hand-written and unverified by construction.
 *
 * The plan assertions matter as much as the rows, and they are the reason this runs
 * in-process rather than only in the (DATABASE_URL-gated) integration spec. The whole
 * point of the rewrite is that LITERAL op_types keep
 * `operations_user_id_causal_full_state_server_seq_idx` reachable while BOUND ones do
 * not: `operator_predicate_proof` needs `Const` nodes, and a `Param` fails every branch
 * (predtest.c), so under a generic plan the partial index is not even considered.
 *
 * That difference is SCALE-INDEPENDENT — it is a proof failure, not a costing outcome —
 * so it reproduces on a 12-row fixture, which the production symptom (a 60s
 * statement_timeout on a 9M-row table) does not. `enable_seqscan = off` removes the
 * cost dimension entirely and leaves only the question this spec exists to answer:
 * CAN the planner reach that index? The index DDL is read out of its migration rather
 * than copied, so a migration whose predicate changes fails here loudly.
 *
 * PGlite is PG18 and production is PG 16.x, so this spec is NOT a substitute for
 * tests/integration/download-full-state-plan.integration.spec.ts, which measures cost and
 * buffers against a production-shaped fixture on the real server version. What transfers
 * across those versions is the only thing asserted here: predicate proof is a structural
 * rule in predtest.c, unchanged in either, and it does not depend on statistics.
 */

const CAUSAL_INDEX = 'operations_user_id_causal_full_state_server_seq_idx';
const USER = 1;
const OTHER_USER = 2;

const OPERATIONS_DDL = `
  CREATE TABLE operations (
    id                     text PRIMARY KEY,
    user_id                integer NOT NULL,
    client_id              text NOT NULL,
    server_seq             integer NOT NULL,
    op_type                text NOT NULL,
    repair_base_server_seq integer
  );
  -- Production's @@unique([userId, serverSeq]). Present because it is the index the
  -- parameterized form falls back to when the partial index is unreachable — the
  -- backward whole-history walk that timed out in production.
  CREATE UNIQUE INDEX operations_user_id_server_seq_key
    ON operations (user_id, server_seq);
`;

type Row = { server_seq: number; client_id: string };

/**
 * The pre-fix shape, derived from the shipped statement by turning its op_type literals
 * into bind parameters and nothing else. Deriving rather than hand-writing keeps the
 * two forms different in exactly one respect — the variable under test.
 */
const toParameterizedForm = (
  text: string,
  values: unknown[],
): { text: string; values: unknown[] } => {
  let next = values.length;
  const opTypes: string[] = [];
  const parameterized = text.replace(/'([A-Z_]+)'/g, (_match, opType: string) => {
    opTypes.push(opType);
    next += 1;
    return `$${next}`;
  });
  return { text: parameterized, values: [...values, ...opTypes] };
};

/** Strips identifier quoting and collapses whitespace, so two dialects compare. */
const normalize = (sql: string): string =>
  sql.replace(/"/g, '').replace(/\s+/g, ' ').trim();

describe('latestCausalFullStateSql (real Postgres)', () => {
  let db: PGlite;

  const query = async (sql: { text: string; values: unknown[] }): Promise<Row[]> => {
    const res = await db.query<Row>(sql.text, sql.values);
    return res.rows;
  };

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(OPERATIONS_DDL);
    await db.exec(
      createIndexFromMigration(
        '20260829000000_add_causal_full_state_index',
        CAUSAL_INDEX,
      ) + ';',
    );

    // seq 5/15 are causal boundaries; 25 is a LEGACY repair (no base cursor) and must
    // never be treated as one; OTHER_USER has a boundary that must never leak across.
    const rows: Array<[string, number, string, number, string, number | null]> = [
      ['a1', USER, 'c-a', 1, 'STATE_CHANGE', null],
      ['a2', USER, 'c-import', 5, 'SYNC_IMPORT', null],
      ['a3', USER, 'c-a', 9, 'STATE_CHANGE', null],
      ['a4', USER, 'c-backup', 15, 'BACKUP_IMPORT', null],
      ['a5', USER, 'c-a', 20, 'STATE_CHANGE', null],
      ['a6', USER, 'c-legacy', 25, 'REPAIR', null],
      ['a7', USER, 'c-a', 30, 'STATE_CHANGE', null],
      ['b1', OTHER_USER, 'c-b', 7, 'SYNC_IMPORT', null],
      ['b2', OTHER_USER, 'c-b', 8, 'STATE_CHANGE', null],
    ];
    for (const [id, userId, clientId, seq, opType, base] of rows) {
      await db.query(
        `INSERT INTO operations (id, user_id, client_id, server_seq, op_type, repair_base_server_seq)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, userId, clientId, seq, opType, base],
      );
    }
    await db.exec('ANALYZE operations;');
  });

  afterAll(async () => {
    await db.close();
  });

  describe('rows', () => {
    it('returns the newest causal boundary at or below the bound', async () => {
      expect(await query(latestCausalFullStateSql(USER, 30))).toEqual([
        { server_seq: 15, client_id: 'c-backup' },
      ]);
    });

    it('honours the bound rather than reading the newest overall', async () => {
      expect(await query(latestCausalFullStateSql(USER, 14))).toEqual([
        { server_seq: 5, client_id: 'c-import' },
      ]);
    });

    it('never offers a legacy REPAIR (no base cursor) as a boundary', async () => {
      // seq 25 is a REPAIR and the newest full-state row; picking it would authorize a
      // fast-forward past ops it cannot replay.
      const rows = await query(latestCausalFullStateSql(USER, 30));
      expect(rows[0].server_seq).not.toBe(25);
    });

    it('counts a REPAIR that carries a base cursor', async () => {
      await db.query(
        `INSERT INTO operations VALUES ('a8', $1, 'c-repair', 40, 'REPAIR', 20)`,
        [USER],
      );
      expect(await query(latestCausalFullStateSql(USER, 50))).toEqual([
        { server_seq: 40, client_id: 'c-repair' },
      ]);
      await db.exec(`DELETE FROM operations WHERE id = 'a8'`);
    });

    it('reads the whole history when no bound is given (upload path)', async () => {
      expect(await query(latestCausalFullStateSql(USER))).toEqual([
        { server_seq: 15, client_id: 'c-backup' },
      ]);
    });

    it('returns no rows for a user with no causal boundary', async () => {
      // The production case: this user's download walked the entire history and was
      // cancelled at the statement_timeout.
      await db.query(
        `INSERT INTO operations VALUES ('c1', 3, 'c-c', 1, 'STATE_CHANGE', NULL)`,
      );
      expect(await query(latestCausalFullStateSql(3, 100))).toEqual([]);
    });

    it('does not read another user rows', async () => {
      expect(await query(latestCausalFullStateSql(OTHER_USER, 100))).toEqual([
        { server_seq: 7, client_id: 'c-b' },
      ]);
    });

    it('returns server_seq as a number, not a bigint', async () => {
      // `serverSeq Int` in schema.prisma, so LatestCausalFullStateRow types it `number`.
      // A bigint would survive every mocked spec and break the `latestSnapshotSeq - 1`
      // arithmetic on the download path.
      const [row] = await query(latestCausalFullStateSql(USER, 30));
      expect(typeof row.server_seq).toBe('number');
      expect(typeof row.client_id).toBe('string');
    });
  });

  describe('index reachability', () => {
    beforeAll(async () => {
      await db.exec('SET enable_seqscan = off;');
    });

    it('reaches the partial index under a GENERIC plan', async () => {
      const sql = latestCausalFullStateSql(USER, 30);
      const { nodes } = await explainGeneric(db, sql.text, sql.values);
      expect(nodes).toContain(CAUSAL_INDEX);
    });

    it('reaches it under a custom plan too', async () => {
      const sql = latestCausalFullStateSql(USER, 30);
      const { nodes } = await explainCustom(db, sql.text, sql.values);
      expect(nodes).toContain(CAUSAL_INDEX);
    });

    it('CANARY: bound op_types cannot reach it, and fall back to the seq walk', async () => {
      // The pre-fix behaviour, and the reason the literals must stay literals. If this
      // ever starts finding the index, predtest.c changed and the rewrite is moot.
      const sql = latestCausalFullStateSql(USER, 30);
      const parameterized = toParameterizedForm(sql.text, [...sql.values]);
      const { nodes } = await explainGeneric(
        db,
        parameterized.text,
        parameterized.values,
      );
      expect(nodes).not.toContain(CAUSAL_INDEX);
      expect(nodes).toContain('operations_user_id_server_seq_key');
    });

    it('CANARY: the two forms still answer identically', async () => {
      const sql = latestCausalFullStateSql(USER, 30);
      const parameterized = toParameterizedForm(sql.text, [...sql.values]);
      expect(await query(parameterized)).toEqual(await query(sql));
    });
  });

  describe('predicate lockstep', () => {
    it('matches the shipped index predicate verbatim', async () => {
      // Index reachability depends on the query predicate and the index predicate being
      // the SAME expression. Nothing else in the repo enforces that, and a drifted copy
      // fails silently — the rows stay right and the plan quietly degrades.
      const ddl = createIndexFromMigration(
        '20260829000000_add_causal_full_state_index',
        CAUSAL_INDEX,
      );
      const indexPredicate = normalize(ddl.slice(ddl.indexOf(' WHERE ') + 7));
      expect(normalize(latestCausalFullStateSql(USER, 30).text)).toContain(
        indexPredicate,
      );
    });

    it('carries every op type of CAUSAL_FULL_STATE_OPERATION_WHERE as a literal', async () => {
      const { text } = latestCausalFullStateSql(USER, 30);
      const [importBranch, repairBranch] = CAUSAL_FULL_STATE_OPERATION_WHERE.OR;
      for (const opType of importBranch.opType.in) {
        expect(text).toContain(`'${opType}'`);
      }
      expect(text).toContain(`'${repairBranch.opType}'`);
      // Nothing else may have been added to the constant without landing here.
      expect(CAUSAL_FULL_STATE_OPERATION_WHERE.OR).toHaveLength(2);
    });
  });
});
