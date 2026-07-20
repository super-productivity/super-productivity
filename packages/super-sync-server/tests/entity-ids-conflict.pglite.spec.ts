import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

/**
 * Real-Postgres regression for #8334's multi-entity conflict-detection SQL.
 *
 * The mock-based specs (issue-8334-detect-conflict.spec.ts, conflict-detection.spec.ts)
 * reproduce the Prisma filter semantics by hand and can NOT catch a bug in the raw
 * `unnest(CASE ...)` SQL that detectConflictForEntities / prefetchLatestEntityOpsForBatch
 * actually send to Postgres. This spec runs that SQL against an in-process Postgres
 * (PGlite — no Docker, no DATABASE_URL) so it runs in the normal `npm test` CI job.
 *
 * The SQL below is copied verbatim from packages/super-sync-server/src/sync/conflict.ts
 * (only the Prisma.sql `${}` interpolations are rewritten as `$n` placeholders). If you
 * change the query shape there, update it here — the two are intentionally kept in sync
 * by hand (the source keeps the SQL inline so the conflict-detection.spec mock's
 * positional params stay stable).
 *
 * Load-bearing detail: the unnest folds the scalar `entity_id` INTO the `entity_ids`
 * set with a UNION (`o.entity_ids || ...ARRAY[entity_id]`), NOT a mutually-exclusive
 * `CASE WHEN cardinality(entity_ids) > 0 THEN entity_ids ELSE ARRAY[entity_id]`. The
 * old CASE form dropped the scalar whenever entity_ids was non-empty, so an op whose
 * scalar entity_id is NOT a member of its own entity_ids (the dedup-off-scalar case)
 * was invisible — a later concurrent op touching that scalar was wrongly accepted
 * (silent data loss). The 'divergent scalar' tests below pin this regression. (#8334)
 */
describe('#8334 multi-entity conflict SQL (PGlite)', () => {
  let db: PGlite;

  // Mirrors the two migrations: the entity_ids text[] column + the GIN index, plus
  // the pre-existing btree that the scalar fallback relies on. Building the GIN index
  // here also proves `USING GIN (entity_ids)` is valid DDL on real Postgres.
  const createSchema = async (): Promise<void> => {
    await db.exec(`
      CREATE TABLE operations (
        id          text PRIMARY KEY,
        user_id     integer NOT NULL,
        client_id   text NOT NULL,
        server_seq  bigint NOT NULL,
        entity_type text NOT NULL,
        entity_id   text,
        entity_ids  text[] NOT NULL DEFAULT '{}',
        vector_clock jsonb NOT NULL
      );
      CREATE INDEX operations_entity_ids_gin ON operations USING GIN (entity_ids);
      CREATE INDEX operations_user_entity_seq
        ON operations (user_id, entity_type, entity_id, server_seq);
    `);
  };

  const insertOp = async (op: {
    id: string;
    serverSeq: number;
    clientId: string;
    entityType?: string;
    entityId: string | null;
    entityIds?: string[];
    vectorClock?: Record<string, number>;
  }): Promise<void> => {
    await db.query(
      `INSERT INTO operations
         (id, user_id, client_id, server_seq, entity_type, entity_id, entity_ids, vector_clock)
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7)`,
      [
        op.id,
        op.clientId,
        op.serverSeq,
        op.entityType ?? 'TASK',
        op.entityId,
        op.entityIds ?? [],
        JSON.stringify(op.vectorClock ?? { [op.clientId]: op.serverSeq }),
      ],
    );
  };

  type LatestRow = {
    entityId: string;
    clientId: string;
    serverSeq: number;
    vectorClock: Record<string, number>;
  };

  // detectConflictForEntities() — single-entity-type batch lookup.
  const detectForEntities = async (
    entityType: string,
    ids: string[],
  ): Promise<LatestRow[]> => {
    const res = await db.query<LatestRow>(
      `SELECT DISTINCT ON (eid)
          eid AS "entityId",
          o.client_id AS "clientId",
          o.server_seq AS "serverSeq",
          o.vector_clock AS "vectorClock"
       FROM operations o
       CROSS JOIN LATERAL unnest(
         o.entity_ids || CASE WHEN o.entity_id IS NULL THEN '{}'::text[] ELSE ARRAY[o.entity_id] END
       ) AS eid
       WHERE o.user_id = 1
         AND o.entity_type = $1
         AND (o.entity_ids && $2::text[] OR o.entity_id = ANY($2::text[]))
         AND eid = ANY($2::text[])
       ORDER BY eid, o.server_seq DESC`,
      [entityType, ids],
    );
    return res.rows;
  };

  // prefetchLatestEntityOpsForBatch() — multi-entity-TYPE batch via a JOIN over
  // (entity_type, entity_id) pairs.
  const prefetchForPairs = async (
    pairs: Array<{ entityType: string; entityId: string }>,
  ): Promise<Array<LatestRow & { entityType: string }>> => {
    const valuesSql = pairs.map((_p, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
    const idArrayParam = `$${pairs.length * 2 + 1}`;
    const params: unknown[] = [];
    for (const p of pairs) {
      params.push(p.entityType, p.entityId);
    }
    params.push(pairs.map((p) => p.entityId));
    const res = await db.query<LatestRow & { entityType: string }>(
      `SELECT DISTINCT ON (o.entity_type, eid)
          o.entity_type AS "entityType",
          eid AS "entityId",
          o.client_id AS "clientId",
          o.server_seq AS "serverSeq",
          o.vector_clock AS "vectorClock"
       FROM operations o
       CROSS JOIN LATERAL unnest(
         o.entity_ids || CASE WHEN o.entity_id IS NULL THEN '{}'::text[] ELSE ARRAY[o.entity_id] END
       ) AS eid
       JOIN (VALUES ${valuesSql}) AS touched(entity_type, entity_id)
         ON touched.entity_type = o.entity_type
        AND touched.entity_id = eid
       WHERE o.user_id = 1
         AND (o.entity_ids && ${idArrayParam}::text[] OR o.entity_id = ANY(${idArrayParam}::text[]))
       ORDER BY o.entity_type, eid, o.server_seq DESC`,
      params,
    );
    return res.rows;
  };

  beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.exec('DROP TABLE IF EXISTS operations');
    await createSchema();
  });

  describe('detectConflictForEntities (batch unnest SQL)', () => {
    it('finds a stored multi-entity op via its NON-FIRST entity (the #8334 bug)', async () => {
      // op A touches task-1 + task-2; scalar entity_id is task-1.
      await insertOp({
        id: 'opA',
        serverSeq: 1,
        clientId: 'A',
        entityId: 'task-1',
        entityIds: ['task-1', 'task-2'],
      });

      const rows = await detectForEntities('TASK', ['task-2']);

      // Before the fix, task-2 was invisible (only the scalar task-1 was stored), so a
      // stale write to task-2 found no prior writer and was wrongly accepted.
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ entityId: 'task-2', clientId: 'A', serverSeq: 1 });
    });

    it('returns the LATEST op per entity (DISTINCT ON ... ORDER BY server_seq DESC)', async () => {
      await insertOp({
        id: 'opA',
        serverSeq: 1,
        clientId: 'A',
        entityId: 'task-1',
        entityIds: ['task-1', 'task-2'],
      });
      // A newer single-entity write to task-1.
      await insertOp({ id: 'opC', serverSeq: 3, clientId: 'A', entityId: 'task-1' });

      const rows = await detectForEntities('TASK', ['task-1']);

      expect(rows).toHaveLength(1);
      expect(rows[0].serverSeq).toBe(3);
    });

    it('falls back to the scalar entity_id for a pre-migration row (entity_ids = {})', async () => {
      await insertOp({ id: 'opB', serverSeq: 2, clientId: 'A', entityId: 'task-3' });

      const rows = await detectForEntities('TASK', ['task-3']);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ entityId: 'task-3', serverSeq: 2 });
    });

    it('does not match an unrelated entity', async () => {
      await insertOp({
        id: 'opA',
        serverSeq: 1,
        clientId: 'A',
        entityId: 'task-1',
        entityIds: ['task-1', 'task-2'],
      });

      expect(await detectForEntities('TASK', ['task-9'])).toHaveLength(0);
    });

    it('ignores a full-state op (entity_id NULL, entity_ids {}) without erroring', async () => {
      // SYNC_IMPORT / BACKUP_IMPORT / REPAIR ops have no entity. The unnest hits the
      // ARRAY[entity_id] branch with a NULL element — it must yield no match, not throw.
      await insertOp({ id: 'opFull', serverSeq: 1, clientId: 'A', entityId: null });

      expect(await detectForEntities('TASK', ['task-1'])).toHaveLength(0);
    });

    it('matches an entity stored only in entity_ids when the scalar differs (dedup-off-scalar)', async () => {
      // getStoredEntityIds persists [task-A] even though length === 1 because it differs
      // from the scalar entity_id (task-Z). Without entity_ids, task-A would be invisible.
      await insertOp({
        id: 'opD',
        serverSeq: 1,
        clientId: 'A',
        entityId: 'task-Z',
        entityIds: ['task-A'],
      });

      const rows = await detectForEntities('TASK', ['task-A']);

      expect(rows).toHaveLength(1);
      expect(rows[0].entityId).toBe('task-A');
    });

    it('finds the op via its DIVERGENT scalar entity_id (not a member of entity_ids) — the #8334 silent-data-loss case', async () => {
      // Same dedup-off-scalar op as above, but now query for the SCALAR task-Z, which is
      // NOT a member of entity_ids (['task-A']). The old mutually-exclusive CASE form used
      // entity_ids alone (cardinality > 0) and dropped the scalar, so task-Z found no prior
      // writer and a stale concurrent write to it was wrongly accepted. The UNION fold keeps
      // the scalar visible. This is the case the dedup-off-scalar test above does NOT cover.
      await insertOp({
        id: 'opD',
        serverSeq: 1,
        clientId: 'A',
        entityId: 'task-Z',
        entityIds: ['task-A'],
      });

      const rows = await detectForEntities('TASK', ['task-Z']);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ entityId: 'task-Z', clientId: 'A', serverSeq: 1 });
    });

    it('resolves every requested id to its own latest op in one batch', async () => {
      await insertOp({
        id: 'opA',
        serverSeq: 1,
        clientId: 'A',
        entityId: 'task-1',
        entityIds: ['task-1', 'task-2'],
      });
      await insertOp({ id: 'opB', serverSeq: 2, clientId: 'A', entityId: 'task-3' });
      await insertOp({ id: 'opC', serverSeq: 3, clientId: 'A', entityId: 'task-1' });

      const rows = await detectForEntities('TASK', ['task-1', 'task-2', 'task-3']);
      const byEntity = Object.fromEntries(rows.map((r) => [r.entityId, r.serverSeq]));

      expect(byEntity).toEqual({ 'task-1': 3, 'task-2': 1, 'task-3': 2 });
    });
  });

  describe('prefetchLatestEntityOpsForBatch (JOIN-over-pairs unnest SQL)', () => {
    it('matches each (type,id) pair against the op entity set without crossing types', async () => {
      await insertOp({
        id: 'opA',
        serverSeq: 1,
        clientId: 'A',
        entityType: 'TASK',
        entityId: 'task-1',
        entityIds: ['task-1', 'task-2'],
      });
      // Same id string but a different entity type must NOT match the TASK pair.
      await insertOp({
        id: 'opP',
        serverSeq: 2,
        clientId: 'A',
        entityType: 'PROJECT',
        entityId: 'task-2',
      });

      const rows = await prefetchForPairs([
        { entityType: 'TASK', entityId: 'task-2' },
        { entityType: 'PROJECT', entityId: 'task-2' },
      ]);

      const byKey = Object.fromEntries(
        rows.map((r) => [`${r.entityType}:${r.entityId}`, r.serverSeq]),
      );
      expect(byKey).toEqual({ 'TASK:task-2': 1, 'PROJECT:task-2': 2 });
    });

    it('matches a (type, divergent-scalar) pair not present in entity_ids — the #8334 silent-data-loss case', async () => {
      // The prefetch path got the same scalar-UNION fix as detectConflictForEntities and
      // can drift independently; pin the divergent scalar here too. task-Z is the scalar but
      // not a member of entity_ids (['task-A']); the old CASE form dropped it.
      await insertOp({
        id: 'opD',
        serverSeq: 1,
        clientId: 'A',
        entityType: 'TASK',
        entityId: 'task-Z',
        entityIds: ['task-A'],
      });

      const rows = await prefetchForPairs([{ entityType: 'TASK', entityId: 'task-Z' }]);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        entityType: 'TASK',
        entityId: 'task-Z',
        serverSeq: 1,
      });
    });
  });
});
