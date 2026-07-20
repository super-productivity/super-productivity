import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Prisma } from '@prisma/client';
import {
  detectConflictForEntities,
  getEntityConflictKey,
  prefetchLatestEntityOpsForBatch,
} from '../src/sync/conflict';
import type { Operation, VectorClock } from '../src/sync/sync.types';

const USER_ID = 1;
const OTHER_USER_ID = 2;
const TASK_UPDATE_ACTION = '[Task] Update';
const TASK_TIME_DELTA_ACTION = '[TimeTracking] Sync time spent';

/**
 * Real-Postgres regression for #8334's multi-entity conflict-detection SQL.
 *
 * The mock-based specs (issue-8334-detect-conflict.spec.ts, conflict-detection.spec.ts)
 * reproduce the Prisma filter semantics by hand and can NOT catch a bug in the raw
 * `unnest(CASE ...)` SQL that detectConflictForEntities / prefetchLatestEntityOpsForBatch
 * actually send to Postgres. This spec runs that SQL against an in-process Postgres
 * (PGlite — no Docker, no DATABASE_URL) so it runs in the normal `npm test` CI job.
 *
 * A small transaction adapter renders the production Prisma tagged template through
 * Prisma.sql, including nested Prisma.Sql / Prisma.join fragments, then executes its
 * PostgreSQL text and bound values in PGlite. There is no second copy of the query.
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
  let transaction: Prisma.TransactionClient;

  const createTransaction = (): Prisma.TransactionClient => {
    const adapter = {
      $queryRaw: async <T>(
        strings: TemplateStringsArray,
        ...values: Array<Prisma.Sql | Prisma.Sql['values'][number]>
      ): Promise<T> => {
        const query = Prisma.sql(strings, ...values);
        return (await db.query(query.text, query.values)).rows as T;
      },
    };

    return adapter as unknown as Prisma.TransactionClient;
  };

  const incomingOp = (
    overrides: Partial<
      Pick<Operation, 'clientId' | 'actionType' | 'entityType' | 'vectorClock'>
    > = {},
  ): Operation => ({
    id: 'incoming',
    clientId: 'B',
    actionType: TASK_UPDATE_ACTION,
    opType: 'UPD',
    entityType: 'TASK',
    payload: {},
    vectorClock: { B: 1 },
    timestamp: 1,
    schemaVersion: 1,
    ...overrides,
  });

  // Mirrors the two migrations: the entity_ids text[] column + the GIN index, plus
  // the pre-existing btree that the scalar fallback relies on. Building the GIN index
  // here also proves `USING GIN (entity_ids)` is valid DDL on real Postgres.
  const createSchema = async (): Promise<void> => {
    await db.exec(`
      CREATE TABLE operations (
        id          text PRIMARY KEY,
        user_id     integer NOT NULL,
        client_id   text NOT NULL,
        server_seq  integer NOT NULL,
        action_type text NOT NULL,
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
    userId?: number;
    actionType?: string;
    entityType?: string;
    entityId: string | null;
    entityIds?: string[];
    vectorClock?: VectorClock;
  }): Promise<void> => {
    await db.query(
      `INSERT INTO operations
         (id, user_id, client_id, server_seq, action_type, entity_type, entity_id, entity_ids, vector_clock)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        op.id,
        op.userId ?? USER_ID,
        op.clientId,
        op.serverSeq,
        op.actionType ?? TASK_UPDATE_ACTION,
        op.entityType ?? 'TASK',
        op.entityId,
        op.entityIds ?? [],
        JSON.stringify(op.vectorClock ?? { [op.clientId]: op.serverSeq }),
      ],
    );
  };

  beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    transaction = createTransaction();
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
        vectorClock: { A: 1 },
      });

      const result = await detectConflictForEntities(
        USER_ID,
        incomingOp(),
        ['task-2', 'task-unmatched'],
        transaction,
      );

      // Before the fix, task-2 was invisible (only the scalar task-1 was stored), so a
      // stale write to task-2 found no prior writer and was wrongly accepted.
      expect(result).toMatchObject({
        hasConflict: true,
        conflictType: 'concurrent',
        existingClock: { A: 1 },
      });
    });

    it('skips a clean latest op and reports a later entity conflict', async () => {
      // The old row conflicts with the incoming C clock; the latest row is its
      // equal-clock retry from the same client. The second entity is concurrent,
      // so omitting clientId, selecting the old task-1 row, or returning the clean
      // task-1 result early changes the verdict.
      await insertOp({
        id: 'old',
        serverSeq: 1,
        clientId: 'A',
        entityId: 'task-1',
        vectorClock: { A: 1 },
      });
      await insertOp({
        id: 'latest',
        serverSeq: 3,
        clientId: 'C',
        entityId: 'task-1',
        vectorClock: { C: 1 },
      });
      await insertOp({
        id: 'later-conflict',
        serverSeq: 4,
        clientId: 'D',
        entityId: 'task-2',
        vectorClock: { D: 1 },
      });

      const result = await detectConflictForEntities(
        USER_ID,
        incomingOp({ clientId: 'C', vectorClock: { C: 1 } }),
        ['task-1', 'task-2'],
        transaction,
      );

      expect(result).toMatchObject({
        hasConflict: true,
        conflictType: 'concurrent',
        existingClock: { D: 1 },
      });
    });

    it('falls back to the scalar entity_id for a pre-migration row (entity_ids = {})', async () => {
      await insertOp({
        id: 'opB',
        serverSeq: 2,
        clientId: 'A',
        entityId: 'task-3',
        vectorClock: { A: 2 },
      });

      const result = await detectConflictForEntities(
        USER_ID,
        incomingOp(),
        ['task-3', 'task-unmatched'],
        transaction,
      );

      expect(result).toMatchObject({
        hasConflict: true,
        conflictType: 'concurrent',
        existingClock: { A: 2 },
      });
    });

    it('finds a DIVERGENT scalar entity_id not present in entity_ids', async () => {
      // The old mutually-exclusive CASE unnested ['task-A'] and dropped task-Z.
      await insertOp({
        id: 'opD',
        serverSeq: 1,
        clientId: 'A',
        entityId: 'task-Z',
        entityIds: ['task-A'],
        vectorClock: { A: 1 },
      });

      const result = await detectConflictForEntities(
        USER_ID,
        incomingOp(),
        ['task-Z', 'task-unmatched'],
        transaction,
      );

      expect(result).toMatchObject({
        hasConflict: true,
        conflictType: 'concurrent',
        existingClock: { A: 1 },
      });
    });

    it('isolates rows by user and entity type', async () => {
      await insertOp({
        id: 'other-user-task',
        serverSeq: 10,
        clientId: 'A',
        userId: OTHER_USER_ID,
        entityId: 'shared-id',
        vectorClock: { A: 1 },
      });
      await insertOp({
        id: 'same-user-project',
        serverSeq: 11,
        clientId: 'A',
        entityType: 'PROJECT',
        entityId: 'shared-id',
        vectorClock: { A: 1 },
      });

      const result = await detectConflictForEntities(
        USER_ID,
        incomingOp(),
        ['shared-id', 'task-unmatched'],
        transaction,
      );

      expect(result).toEqual({ hasConflict: false });
    });

    it('uses the selected actionType when resolving concurrent timer deltas', async () => {
      await insertOp({
        id: 'timer-delta',
        serverSeq: 1,
        clientId: 'A',
        actionType: TASK_TIME_DELTA_ACTION,
        entityId: 'task-1',
        vectorClock: { A: 1 },
      });

      const result = await detectConflictForEntities(
        USER_ID,
        incomingOp({ actionType: TASK_TIME_DELTA_ACTION }),
        ['task-1', 'task-unmatched'],
        transaction,
      );

      expect(result).toEqual({ hasConflict: false });
    });
  });

  describe('prefetchLatestEntityOpsForBatch (JOIN-over-pairs unnest SQL)', () => {
    it('returns the latest same-user op for each (type,id) pair', async () => {
      await insertOp({
        id: 'opA-old',
        serverSeq: 1,
        clientId: 'A',
        entityType: 'TASK',
        entityId: 'task-2',
        actionType: '[Task] Old Update',
        vectorClock: { A: 1 },
      });
      await insertOp({
        id: 'opA',
        serverSeq: 3,
        clientId: 'A',
        entityType: 'TASK',
        entityId: 'task-1',
        entityIds: ['task-1', 'task-2'],
        actionType: '[Task] Batch Update',
        vectorClock: { A: 1 },
      });
      // Same id string but a different entity type must NOT match the TASK pair.
      await insertOp({
        id: 'opP',
        serverSeq: 2,
        clientId: 'A',
        entityType: 'PROJECT',
        entityId: 'task-2',
        actionType: '[Project] Update',
        vectorClock: { A: 2 },
      });
      await insertOp({
        id: 'other-user-task',
        serverSeq: 10,
        clientId: 'Z',
        userId: OTHER_USER_ID,
        entityType: 'TASK',
        entityId: 'task-2',
        actionType: '[Task] Other User Update',
        vectorClock: { Z: 1 },
      });

      const latestByEntity = await prefetchLatestEntityOpsForBatch(
        USER_ID,
        [
          { entityType: 'TASK', entityId: 'task-2' },
          { entityType: 'PROJECT', entityId: 'task-2' },
        ],
        transaction,
      );

      expect(latestByEntity.get(getEntityConflictKey('TASK', 'task-2'))).toMatchObject({
        entityType: 'TASK',
        entityId: 'task-2',
        clientId: 'A',
        actionType: '[Task] Batch Update',
        vectorClock: { A: 1 },
        serverSeq: 3,
      });
      expect(latestByEntity.get(getEntityConflictKey('PROJECT', 'task-2'))).toMatchObject(
        {
          entityType: 'PROJECT',
          entityId: 'task-2',
          clientId: 'A',
          actionType: '[Project] Update',
          vectorClock: { A: 2 },
          serverSeq: 2,
        },
      );
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
        vectorClock: { A: 1 },
      });

      const latestByEntity = await prefetchLatestEntityOpsForBatch(
        USER_ID,
        [{ entityType: 'TASK', entityId: 'task-Z' }],
        transaction,
      );

      expect(latestByEntity.get(getEntityConflictKey('TASK', 'task-Z'))).toMatchObject({
        entityType: 'TASK',
        entityId: 'task-Z',
        serverSeq: 1,
      });
    });
  });
});
