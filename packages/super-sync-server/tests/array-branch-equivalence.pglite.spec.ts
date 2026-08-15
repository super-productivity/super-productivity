import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Prisma } from '@prisma/client';
import { arrayBranchCandidatesCte } from '../src/sync/conflict';

/**
 * The array branch of the batch conflict lookups is a COST choice between forms that
 * must return identical rows. This file is the equivalence evidence for that choice.
 *
 * It exists because #9503's branch twice changed the shape of `arrayBranchCandidatesCte`
 * on cost grounds, and both times the equivalence argument lived in a throwaway script
 * whose result was quoted in a comment. A number nobody can re-derive is exactly what
 * this repo's rules call a defect, and this is a silent-data-loss path: the array branch
 * is how a stored multi-entity op is found via its NON-FIRST entity (#8334). Getting it
 * wrong does not error — it reports "no conflict" and a concurrent remote edit is
 * overwritten.
 *
 * So: randomised differential testing of the SHIPPED form against the alternatives that
 * have been proposed for it, over data shaped to hit the cases that actually differ —
 * duplicate array elements, NULL elements, NULL scalar `entity_id`, divergent scalars
 * (an op whose `entity_id` is not a member of its own `entity_ids`), empty arrays,
 * cross-tenant and cross-entity-type id collisions.
 *
 * The MUTANTS are not decoration. A differential test that cannot fail proves nothing,
 * so each round also runs forms that are deliberately wrong and asserts they diverge at
 * least sometimes across the run. If a mutant ever stops diverging, this file has lost
 * its power and the seed needs widening — that is a failure, not a pass.
 */

const CREATE = `
  CREATE TABLE operations (
    id             text PRIMARY KEY,
    user_id        integer NOT NULL,
    client_id      text NOT NULL,
    server_seq     integer NOT NULL,
    action_type    text NOT NULL,
    entity_type    text NOT NULL,
    entity_id      text,
    entity_ids     text[] NOT NULL DEFAULT '{}',
    schema_version integer NOT NULL DEFAULT 1,
    vector_clock   jsonb NOT NULL
  );
  CREATE UNIQUE INDEX operations_user_id_server_seq_key ON operations (user_id, server_seq);
  CREATE INDEX operations_user_id_entity_type_entity_id_server_seq_idx
    ON operations (user_id, entity_type, entity_id, server_seq);
  CREATE INDEX operations_entity_ids_gin ON operations USING GIN (entity_ids);
`;

/**
 * SHIPPED: one `@>` GIN probe per requested id, tagged with the id from the index.
 *
 * DERIVED from the production fragment, never copied. A hand-written literal here passed
 * whether or not it still matched conflict.ts, so a later cost change to the array branch
 * would have been "proved" equivalent by a file that never saw it — the same
 * keep-these-two-in-sync hazard (#8334) that let #9503 ship the same mis-plan into both
 * batch queries. The fragment binds no values, so `.sql` is its literal text; the first
 * test below pins that, because a `$n` appearing here would silently renumber the `$1/$2/$3`
 * of every query in this file.
 */
const SHIPPED = arrayBranchCandidatesCte(Prisma.sql`SELECT eid FROM probe`).sql;

/**
 * The alternatives, kept here so a future cost change can be re-checked for equivalence
 * without rebuilding this harness. Both were measured and rejected on cost (see
 * arrayBranchCandidatesCte); neither is wrong.
 */
const EQUIVALENT_FORMS: Record<string, string> = {
  'one && per batch, tags via INTERSECT': `cand AS MATERIALIZED (
    SELECT x.eid AS eid, o.user_id, o.entity_type, o.client_id, o.action_type,
           o.vector_clock, o.server_seq
    FROM operations o
    CROSS JOIN LATERAL (
      SELECT unnest(o.entity_ids) AS eid INTERSECT SELECT eid FROM (SELECT eid FROM probe) p
    ) x
    WHERE o.entity_ids && COALESCE((SELECT array_agg(eid) FROM (SELECT eid FROM probe) q), '{}')
  )`,
  'one && per batch, tags via hashed IN': `probe_ids(ids) AS MATERIALIZED (
    SELECT array_agg(eid) FROM (SELECT eid FROM probe) p
  ),
  cand AS MATERIALIZED (
    SELECT x.eid AS eid, o.user_id, o.entity_type, o.client_id, o.action_type,
           o.vector_clock, o.server_seq
    FROM operations o
    CROSS JOIN LATERAL unnest(o.entity_ids) AS x(eid)
    WHERE o.entity_ids && (SELECT ids FROM probe_ids)
      AND x.eid IN (SELECT unnest(ids) FROM probe_ids)
  )`,
};

/** Deliberately WRONG forms, to prove the harness can tell the difference. */
const MUTANTS: Record<string, string> = {
  'tags every id the op touched, not just probed ones': `cand AS MATERIALIZED (
    SELECT x.eid AS eid, o.user_id, o.entity_type, o.client_id, o.action_type,
           o.vector_clock, o.server_seq
    FROM operations o
    CROSS JOIN LATERAL (SELECT unnest(o.entity_ids) AS eid) x
    WHERE o.entity_ids && COALESCE((SELECT array_agg(eid) FROM (SELECT eid FROM probe) q), '{}')
  )`,
  'requires ALL probed ids present (@> instead of &&)': `cand AS MATERIALIZED (
    SELECT x.eid AS eid, o.user_id, o.entity_type, o.client_id, o.action_type,
           o.vector_clock, o.server_seq
    FROM operations o
    CROSS JOIN LATERAL (
      SELECT unnest(o.entity_ids) AS eid INTERSECT SELECT eid FROM (SELECT eid FROM probe) p
    ) x
    WHERE o.entity_ids @> COALESCE((SELECT array_agg(eid) FROM (SELECT eid FROM probe) q), '{}')
  )`,
  'drops the scalar branch (#8334 divergent scalar becomes invisible)': `cand AS MATERIALIZED (
    SELECT p.eid AS eid, o.user_id, o.entity_type, o.client_id, o.action_type,
           o.vector_clock, o.server_seq
    FROM (SELECT eid FROM probe) p
    JOIN operations o ON o.entity_ids @> ARRAY[p.eid] AND o.entity_id IS NOT NULL
  )`,
};

/** The real detectConflictForEntities shape, with only the array branch swapped. */
const detectQuery = (cand: string): string => `
  WITH probe(eid) AS (SELECT DISTINCT eid FROM unnest($1::text[]) AS eid),
  scalar_hits AS (
    SELECT p.eid AS eid, x.client_id, x.action_type, x.vector_clock, x.server_seq
    FROM probe p
    CROSS JOIN LATERAL (
      SELECT o.client_id, o.action_type, o.vector_clock, o.server_seq
      FROM operations o
      WHERE o.user_id = $2 AND o.entity_type = $3 AND o.entity_id = p.eid
      ORDER BY o.server_seq DESC LIMIT 1
    ) x
  ),
  ${cand},
  array_hits AS (
    SELECT c.eid AS eid, c.client_id, c.action_type, c.vector_clock, c.server_seq
    FROM cand c WHERE c.user_id = $2 AND c.entity_type = $3
  )
  SELECT DISTINCT ON (eid) eid, client_id, action_type, vector_clock
  FROM (
    SELECT eid, client_id, action_type, vector_clock, server_seq FROM scalar_hits
    UNION ALL
    SELECT eid, client_id, action_type, vector_clock, server_seq FROM array_hits
  ) u
  ORDER BY eid, server_seq DESC`;

/** Deterministic PRNG — a flaky equivalence test is worse than none. */
const makeRandom = (seed: number): (() => number) => {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
};

const USERS = [1, 2, 3];
const TYPES = ['TASK', 'PROJECT', 'TAG'];
/** Small id universe so collisions, overlaps and duplicates are COMMON, not rare. */
const IDS = Array.from({ length: 12 }, (_, i) => `e${i}`);
const ROUNDS = 120;

describe('batch array branch: alternative forms are equivalent (PGlite)', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec(CREATE);
  });

  afterEach(async () => {
    await db.close();
  });

  it('splices the REAL production fragment, and it binds no parameters', () => {
    const fragment = arrayBranchCandidatesCte(Prisma.sql`SELECT eid FROM probe`);
    // If the fragment ever binds a value, its `$1` would collide with this file's own
    // `$1/$2/$3` and every query here would silently probe the wrong thing. Fail here
    // instead, where the message says what to do.
    expect(
      fragment.values,
      'arrayBranchCandidatesCte now binds values; thread them through detectQuery',
    ).toEqual([]);
    expect(SHIPPED).not.toMatch(/\$\d/);
    // Sanity that we spliced the array branch and not something else entirely.
    expect(SHIPPED).toContain('cand AS MATERIALIZED');
    expect(SHIPPED).toContain('@> ARRAY[p.eid]');
  });

  it('returns identical rows to every alternative form, and mutants diverge', async () => {
    const rnd = makeRandom(987654321);
    const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
    const subset = (max: number): string[] =>
      Array.from({ length: Math.floor(rnd() * (max + 1)) }, () => pick(IDS));

    const seqByUser: Record<number, number> = {};
    const divergences: Record<string, number> = {};
    let comparisons = 0;

    for (let round = 0; round < ROUNDS; round++) {
      // Grow the table as we go, so probes see many different states.
      for (let k = 0; k < 5; k++) {
        const userId = pick(USERS);
        seqByUser[userId] = (seqByUser[userId] ?? 0) + 1;
        const ids = subset(4);
        // ~8% of rows carry a NULL array element, which is where INTERSECT's
        // NOT-DISTINCT-FROM semantics could differ from `@>` if a probe ever held one.
        if (rnd() < 0.08) ids.push(null as unknown as string);
        await db.query(`INSERT INTO operations VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9)`, [
          `op-${round}-${k}`,
          userId,
          `c${Math.floor(rnd() * 3)}`,
          seqByUser[userId],
          pick(['[Task] Update', '[TimeTracking] Sync time spent']),
          pick(TYPES),
          // ~15% full-state ops (NULL scalar); the rest often DIVERGE from their own
          // entity_ids, which is the #8334 shape.
          rnd() < 0.15 ? null : pick(IDS),
          ids,
          JSON.stringify({ [`c${Math.floor(rnd() * 3)}`]: round }),
        ]);
      }

      const probeIds = [...new Set(subset(6))].filter(Boolean);
      if (probeIds.length === 0) continue;
      const params = [probeIds, pick(USERS), pick(TYPES)];

      const shipped = await db.query(detectQuery(SHIPPED), params);
      comparisons++;

      for (const [name, cand] of Object.entries(EQUIVALENT_FORMS)) {
        const other = await db.query(detectQuery(cand), params);
        expect(
          JSON.stringify(other.rows),
          `"${name}" diverged from the shipped form on probe ${JSON.stringify(probeIds)}`,
        ).toBe(JSON.stringify(shipped.rows));
      }

      for (const [name, cand] of Object.entries(MUTANTS)) {
        const mutant = await db.query(detectQuery(cand), params);
        if (JSON.stringify(mutant.rows) !== JSON.stringify(shipped.rows)) {
          divergences[name] = (divergences[name] ?? 0) + 1;
        }
      }
    }

    expect(comparisons).toBeGreaterThan(80);
    // Every mutant must be caught SOMETIMES. A zero here means the seed stopped covering
    // the case that mutant breaks, and the equivalence assertions above lost their power.
    for (const name of Object.keys(MUTANTS)) {
      expect(
        divergences[name] ?? 0,
        `mutant "${name}" was never detected`,
      ).toBeGreaterThan(0);
    }
  }, 180_000);

  it('agrees on the edge shapes that operators actually disagree about', async () => {
    // One row per case that has previously been argued about, so a failure names the
    // case instead of a random round number.
    await db.query(
      `INSERT INTO operations VALUES
        ('dup',       1,'c',1,'[Task] Update','TASK','e0', ARRAY['e1','e1','e2'], 1,'{"c":1}'),
        ('nullelem',  1,'c',2,'[Task] Update','TASK','e3', ARRAY['e4',NULL],      1,'{"c":2}'),
        ('divergent', 1,'c',3,'[Task] Update','TASK','e5', ARRAY['e6','e7'],      1,'{"c":3}'),
        ('nullscalar',1,'c',4,'[Task] Update','TASK',NULL, ARRAY['e8'],           1,'{"c":4}'),
        ('emptyarr',  1,'c',5,'[Task] Update','TASK','e9', '{}',                  1,'{"c":5}'),
        ('othertenant',2,'c',1,'[Task] Update','TASK','e0',ARRAY['e1'],           1,'{"c":6}'),
        ('othertype', 1,'c',6,'[Task] Update','PROJECT','e1',ARRAY['e2'],         1,'{"c":7}')`,
    );

    const params = [IDS, 1, 'TASK'];
    const shipped = await db.query(detectQuery(SHIPPED), params);
    // Sanity: the fixture must actually produce rows, or "identical" is vacuous.
    expect(shipped.rows.length).toBeGreaterThan(0);

    for (const [name, cand] of Object.entries(EQUIVALENT_FORMS)) {
      const other = await db.query(detectQuery(cand), params);
      expect(JSON.stringify(other.rows), `"${name}" diverged`).toBe(
        JSON.stringify(shipped.rows),
      );
    }
  });
});
