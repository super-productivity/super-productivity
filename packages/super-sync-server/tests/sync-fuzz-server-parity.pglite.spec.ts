import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Prisma } from '@prisma/client';
import {
  detectConflict,
  getConflictEntityIds,
  getStoredEntityIds,
  isSameDuplicateOperation,
  isSameIncomingOperation,
  resolveConflictForExistingOp,
} from '../src/sync/conflict';
import { OperationUploadService } from '../src/sync/services/operation-upload.service';
import { ValidationService } from '../src/sync/services/validation.service';
import {
  DEFAULT_SYNC_CONFIG,
  limitVectorClockSize,
  SYNC_ERROR_CODES,
  type Operation,
  type UploadResult,
  type VectorClock,
} from '../src/sync/sync.types';
import * as port from '../../../src/app/op-log/testing/integration/sync-fuzz/fake-super-sync-server';

/**
 * Parity for the in-memory SuperSync port the app's sync fuzz harness runs
 * against (src/app/op-log/testing/integration/sync-fuzz/). Seeded random
 * operations go through the real server code and through the port; every
 * verdict must match:
 * - conflict.ts: detectConflict on PGlite, with the production SQL, and the
 *   pure entity-id, duplicate and retry helpers;
 * - ValidationService.validateOp against the port's validateOpSubset;
 * - OperationUploadService.processOperation on PGlite against the port's
 *   uploadOps, per op: accepted or not, error code, existingClock, serverSeq
 *   and the stored row.
 * The piggyback and the download's `hasMore` probe are asserted on the port
 * alone: the route handlers read through the global Prisma client.
 * sync-fuzz-server-full-state-parity.pglite.spec.ts mocks that client onto
 * PGlite to check SyncService.uploadOps (full-state ops) and the download
 * service. The port header lists what is not checked. A server change to the rules compared with the real code
 * fails here until the port follows; a change to the port-only rules does not.
 */

const USER_ID = 1;
const DELTA = '[TimeTracking] Sync time spent';
const CLIENTS = ['cA', 'cB', 'cC', 'cD'];
const ENTITY_IDS = ['e1', 'e2', 'e3', 'tasks', 'misc'];
const REGULAR_OP_TYPES = ['UPD', 'CRT', 'DEL', 'MOV'] as const;

const createRandom = (seed: number): (() => number) => {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const pickFrom =
  (random: () => number) =>
  <T>(items: readonly T[]): T =>
    items[Math.floor(random() * items.length)];

const randomOp = (random: () => number, id: string): Operation => {
  const pick = pickFrom(random);
  const clock: VectorClock = {};
  for (const client of CLIENTS) {
    if (random() < 0.6) clock[client] = 1 + Math.floor(random() * 3);
  }
  const clientId = pick(CLIENTS);
  clock[clientId] = clock[clientId] ?? 1;
  const multi = random() < 0.25;
  const entityType = random() < 0.2 ? 'GLOBAL_CONFIG' : pick(['TASK', 'NOTE']);
  const entityId = pick(ENTITY_IDS);
  const opType = random() < 0.05 ? 'SYNC_IMPORT' : pick(REGULAR_OP_TYPES);
  return {
    id,
    clientId,
    actionType: random() < 0.3 ? DELTA : pick(['[Task] Update', '[Note] Update Note']),
    opType: opType as Operation['opType'],
    entityType,
    entityId,
    ...(multi
      ? { entityIds: [pick(ENTITY_IDS), pick(ENTITY_IDS), pick(ENTITY_IDS)] }
      : {}),
    payload: { v: Math.floor(random() * 3) },
    vectorClock: clock,
    timestamp: 1_000 + Math.floor(random() * 3),
    schemaVersion: random() < 0.2 ? 1 : 2,
  };
};

/**
 * One field of `op` broken the way a malformed upload could be, or `op` as is.
 * Without `isPayloadVisible` the payload stays: past the E2EE gate every
 * payload is a ciphertext string.
 */
const withInvalidField = (
  random: () => number,
  op: Operation,
  isPayloadVisible = true,
): Operation => {
  const roll = random();
  if (roll < 0.05) return { ...op, entityId: '' };
  if (roll < 0.08) return { ...op, entityId: '   ' };
  if (roll < 0.12) return { ...op, entityId: undefined };
  if (roll < 0.15) return { ...op, entityIds: ['e1', ''] };
  if (roll < 0.27 && isPayloadVisible) {
    return { ...op, payload: pickFrom(random)([undefined, null, [], 42]) };
  }
  if (roll < 0.3) return { ...op, schemaVersion: pickFrom(random)([0, 101, 1.5]) };
  if (roll < 0.33) return { ...op, timestamp: pickFrom(random)([1.5, Number.NaN]) };
  return op;
};

/** A task-time delta payload, valid or broken in one of the ways validateOp checks. */
const deltaPayload = (random: () => number, entityId: string | undefined): unknown => {
  const valid = { taskId: entityId, date: '2026-09-30', duration: 1_000 };
  const variant = pickFrom(random)([
    valid,
    { actionPayload: valid },
    { ...valid, taskId: 'other' },
    { ...valid, date: '2026-02-30' },
    { ...valid, date: '30.09.2026' },
    { ...valid, duration: -1 },
    { ...valid, duration: '5' },
    { ...valid, duration: Number.NaN },
    null,
  ]);
  return variant;
};

/** Renders the Prisma calls the real conflict and upload code makes as SQL on PGlite. */
const createTransaction = (
  db: PGlite,
  syncState: { lastSeq: number },
): Prisma.TransactionClient => {
  const columns: Record<string, string> = {
    id: 'id',
    userId: 'user_id AS "userId"',
    clientId: 'client_id AS "clientId"',
    actionType: 'action_type AS "actionType"',
    opType: 'op_type AS "opType"',
    entityType: 'entity_type AS "entityType"',
    entityId: 'entity_id AS "entityId"',
    entityIds: 'entity_ids AS "entityIds"',
    payload: 'payload',
    vectorClock: 'vector_clock AS "vectorClock"',
    serverSeq: 'server_seq AS "serverSeq"',
    schemaVersion: 'schema_version AS "schemaVersion"',
    clientTimestamp: 'client_timestamp AS "clientTimestamp"',
    receivedAt: 'received_at AS "receivedAt"',
    isPayloadEncrypted: 'is_payload_encrypted AS "isPayloadEncrypted"',
    syncImportReason: 'sync_import_reason AS "syncImportReason"',
    repairBaseServerSeq: 'repair_base_server_seq AS "repairBaseServerSeq"',
  };
  const selectSql = (select: Record<string, boolean>): string =>
    Object.keys(select)
      .filter((key) => select[key])
      .map((key) => {
        if (!columns[key]) throw new Error(`no column for select key ${key}`);
        return columns[key];
      })
      .join(', ');
  interface Where {
    userId: number;
    entityType: string;
    entityId: string;
    schemaVersion?: { lt: number };
  }
  interface CreateRow {
    id: string;
    userId: number;
    clientId: string;
    serverSeq: number;
    actionType: string;
    opType: string;
    entityType: string;
    entityId: string | null;
    entityIds: string[];
    payload: unknown;
    payloadBytes: bigint;
    vectorClock: unknown;
    schemaVersion: number;
    clientTimestamp: bigint;
    receivedAt: bigint;
    isPayloadEncrypted: boolean;
    syncImportReason: string | null;
    repairBaseServerSeq: number | null;
  }
  const tx = {
    operation: {
      findFirst: async (args: { where: Where; select: Record<string, boolean> }) => {
        const { userId, entityType, entityId, schemaVersion } = args.where;
        const rows = await db.query<Record<string, unknown>>(
          `SELECT ${selectSql(args.select)} FROM operations
             WHERE user_id = $1 AND entity_type = $2 AND entity_id = $3
             ${schemaVersion ? 'AND schema_version < $4' : ''}
             ORDER BY server_seq DESC LIMIT 1`,
          schemaVersion
            ? [userId, entityType, entityId, schemaVersion.lt]
            : [userId, entityType, entityId],
        );
        return rows.rows[0] ?? null;
      },
      findUnique: async (args: {
        where:
          | { id: string }
          | { userId_serverSeq: { userId: number; serverSeq: number } };
        select: Record<string, boolean>;
      }) => {
        const rows =
          'id' in args.where
            ? await db.query<Record<string, unknown>>(
                `SELECT ${selectSql(args.select)} FROM operations WHERE id = $1`,
                [args.where.id],
              )
            : await db.query<Record<string, unknown>>(
                `SELECT ${selectSql(args.select)} FROM operations
                   WHERE user_id = $1 AND server_seq = $2`,
                [
                  args.where.userId_serverSeq.userId,
                  args.where.userId_serverSeq.serverSeq,
                ],
              );
        return rows.rows[0] ?? null;
      },
      createMany: async (args: { data: CreateRow[]; skipDuplicates?: boolean }) => {
        let count = 0;
        for (const row of args.data) {
          const result = await db.query(
            `INSERT INTO operations (id, user_id, client_id, server_seq, action_type,
               op_type, entity_type, entity_id, entity_ids, payload, payload_bytes,
               vector_clock, schema_version, client_timestamp, received_at,
               is_payload_encrypted, sync_import_reason, repair_base_server_seq)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
               $16, $17, $18)
             ${args.skipDuplicates ? 'ON CONFLICT (id) DO NOTHING' : ''}`,
            [
              row.id,
              row.userId,
              row.clientId,
              row.serverSeq,
              row.actionType,
              row.opType,
              row.entityType,
              row.entityId,
              row.entityIds,
              JSON.stringify(row.payload),
              String(row.payloadBytes),
              JSON.stringify(row.vectorClock),
              row.schemaVersion,
              String(row.clientTimestamp),
              String(row.receivedAt),
              row.isPayloadEncrypted,
              row.syncImportReason,
              row.repairBaseServerSeq,
            ],
          );
          count += result.affectedRows ?? 0;
        }
        return { count };
      },
    },
    userSyncState: {
      update: async (args: {
        data: { lastSeq?: { increment?: number; decrement?: number } };
      }) => {
        syncState.lastSeq += args.data.lastSeq?.increment ?? 0;
        syncState.lastSeq -= args.data.lastSeq?.decrement ?? 0;
        return { ...syncState };
      },
    },
    $queryRaw: async (
      strings: TemplateStringsArray,
      ...values: Array<Prisma.Sql | Prisma.Sql['values'][number]>
    ) => {
      const query = Prisma.sql(strings, ...values);
      return (await db.query(query.text, query.values)).rows;
    },
  };
  return tx as unknown as Prisma.TransactionClient;
};

interface Verdict {
  accepted: boolean;
  serverSeq?: number;
  errorCode?: string;
  existingClock?: unknown;
}

/** The fields an upload result is compared on (the error text is free to differ). */
const verdict = (result: Verdict): Record<string, unknown> => ({
  accepted: result.accepted,
  ...(result.serverSeq !== undefined ? { serverSeq: result.serverSeq } : {}),
  ...(result.errorCode ? { errorCode: result.errorCode } : {}),
  ...(result.existingClock ? { existingClock: result.existingClock } : {}),
});

describe('sync fuzz SuperSync port: parity with the real server rules', () => {
  let db: PGlite;
  let syncState: { lastSeq: number };
  let tx: Prisma.TransactionClient;

  beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    syncState = { lastSeq: 0 };
    tx = createTransaction(db, syncState);
    await db.exec(`
      DROP TABLE IF EXISTS operations;
      CREATE TABLE operations (
        id text PRIMARY KEY,
        user_id integer NOT NULL,
        client_id text NOT NULL,
        server_seq integer NOT NULL,
        action_type text NOT NULL,
        op_type text NOT NULL DEFAULT 'UPD',
        entity_type text NOT NULL,
        entity_id text,
        entity_ids text[] NOT NULL DEFAULT '{}',
        payload jsonb,
        payload_bytes bigint NOT NULL DEFAULT 0,
        vector_clock jsonb NOT NULL,
        schema_version integer NOT NULL,
        client_timestamp bigint NOT NULL DEFAULT 0,
        received_at bigint NOT NULL DEFAULT 0,
        is_payload_encrypted boolean NOT NULL DEFAULT false,
        sync_import_reason text,
        repair_base_server_seq integer
      );
      CREATE INDEX operations_entity_ids_gin ON operations USING GIN (entity_ids);
    `);
  });

  /** Persists `op` as the server stores an accepted op, in PGlite and the port. */
  const store = async (
    server: port.FakeSuperSyncServer,
    op: Operation,
    serverSeq: number,
  ): Promise<void> => {
    const stored = {
      ...op,
      vectorClock: limitVectorClockSize(op.vectorClock, [op.clientId]),
      entityIds: getStoredEntityIds(op),
    };
    await db.query(
      `INSERT INTO operations (id, user_id, client_id, server_seq, action_type,
         entity_type, entity_id, entity_ids, vector_clock, schema_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        op.id,
        USER_ID,
        op.clientId,
        serverSeq,
        op.actionType,
        op.entityType,
        op.entityId ?? null,
        stored.entityIds,
        JSON.stringify(stored.vectorClock),
        op.schemaVersion,
      ],
    );
    server.rows.push({
      serverSeq,
      receivedAt: 5_000,
      clientTimestamp: op.timestamp,
      op: stored,
    });
  };

  it('agrees on the pre-v2 GLOBAL_CONFIG misc alias for tasks settings', async () => {
    const server = new port.FakeSuperSyncServer(() => 5_000);
    const config = (
      id: string,
      entityId: string,
      clock: VectorClock,
      v: number,
    ): Operation => ({
      id,
      clientId: Object.keys(clock)[0],
      actionType: '[Global Config] Update Global Config Section',
      opType: 'UPD',
      entityType: 'GLOBAL_CONFIG',
      entityId,
      payload: {},
      vectorClock: clock,
      timestamp: 1_000,
      schemaVersion: v,
    });
    await store(server, config('tasks-v2', 'tasks', { cA: 1 }, 2), 1);
    await store(server, config('misc-v1', 'misc', { cB: 1 }, 1), 2);
    // Concurrent only with the newer legacy misc row, which the alias consults.
    const incoming = config('tasks-next', 'tasks', { cA: 2 }, 2);
    const real = await detectConflict(USER_ID, incoming, tx);
    expect(real.hasConflict).toBe(true);
    expect(server.detectConflict(incoming)).toEqual(real);
  });

  for (let seed = 1; seed <= 12; seed++) {
    it(`detectConflict agrees on random histories (seed ${seed})`, async () => {
      const random = createRandom(seed);
      const server = new port.FakeSuperSyncServer(() => 5_000);
      for (let i = 0; i < 60; i++) {
        const op = randomOp(random, `op-${seed}-${i}`);
        const real = await detectConflict(USER_ID, op, tx);
        const ported = server.detectConflict(op);
        expect(ported, `op ${i}: ${JSON.stringify(op)}`).toEqual(real);

        // Store it either way, as the server would store an accepted op.
        await store(server, op, i + 1);
      }
    });
  }

  /** The real verdicts the upload seeds reached, for the coverage check after them. */
  const reached = new Set<string>();

  for (let seed = 1; seed <= 8; seed++) {
    it(`uploads get the real per-op verdicts and stored rows (seed ${seed})`, async () => {
      // The real server only accepts E2EE uploads, so every op is encrypted:
      // an opaque string payload that neither side can read.
      const random = createRandom(100 + seed);
      const pick = pickFrom(random);
      const validation = new ValidationService(DEFAULT_SYNC_CONFIG);
      const uploadService = new OperationUploadService(validation, DEFAULT_SYNC_CONFIG);
      let now = 50_000;
      const server = new port.FakeSuperSyncServer(() => now);
      const sent: Operation[] = [];
      for (let request = 0; request < 40; request++) {
        now += Math.floor(random() * 40_000);
        const clientId = pick(CLIENTS);
        const ops: Operation[] = [];
        for (let i = 0; i < 1 + Math.floor(random() * 3); i++) {
          const roll = random();
          if (roll < 0.15 && sent.length) {
            // A retry of an earlier upload: exact, or with one field changed.
            const earlier = pick(sent);
            const change = random();
            ops.push(
              change < 0.5
                ? { ...earlier }
                : change < 0.7
                  ? { ...earlier, payload: `enc:${request}` }
                  : change < 0.85
                    ? { ...earlier, vectorClock: { ...earlier.vectorClock, cD: 9 } }
                    : { ...earlier, timestamp: earlier.timestamp + 1 },
            );
          } else if (roll < 0.22 && ops.length) {
            ops.push({ ...ops[ops.length - 1] }); // the same id twice in one request
          } else {
            const base = randomOp(random, `u-${seed}-${request}-${i}`);
            const op: Operation = withInvalidField(
              random,
              {
                ...base,
                clientId: random() < 0.9 ? clientId : base.clientId,
                vectorClock: {
                  ...base.vectorClock,
                  [clientId]: base.vectorClock[clientId] ?? 1,
                },
                opType: pick(REGULAR_OP_TYPES),
                payload: `enc:${Math.floor(random() * 3)}`,
                isPayloadEncrypted: true,
                // Some from a client clock far ahead, which the server clamps.
                timestamp:
                  random() < 0.1 ? now + 200_000 : now - Math.floor(random() * 1_000),
              },
              false,
            );
            ops.push(op);
          }
        }
        sent.push(...ops);

        const first = new Map<string, { op: Operation; originalTimestamp: number }>();
        const real: UploadResult[] = [];
        for (const op of structuredClone(ops)) {
          // The per-op loop of SyncService.uploadOps.
          const firstRequestOperation = first.get(op.id);
          const valid = validation.validateOp(op, clientId);
          if (!firstRequestOperation) {
            first.set(op.id, { op: { ...op }, originalTimestamp: op.timestamp });
          }
          const { result } = await uploadService.processOperation(
            USER_ID,
            clientId,
            op,
            now,
            tx,
            valid,
            false,
            firstRequestOperation,
          );
          real.push(result);
          reached.add(result.accepted ? 'accepted' : `${result.errorCode}`);
          if (result.existingClock) reached.add(`${result.errorCode} existingClock`);
        }
        const ported = server.uploadOps(structuredClone(ops), clientId).results;
        expect(
          ported.map(verdict),
          `request ${request} from ${clientId}: ${JSON.stringify(ops)}`,
        ).toEqual(real.map(verdict));
      }
      const rows = await db.query<{
        id: string;
        serverSeq: number;
        clientTimestamp: string;
        vectorClock: VectorClock;
        entityIds: string[];
      }>(
        `SELECT id, server_seq AS "serverSeq", client_timestamp::text AS "clientTimestamp",
           vector_clock AS "vectorClock", entity_ids AS "entityIds"
         FROM operations ORDER BY server_seq`,
      );
      expect(
        server.rows.map((row) => ({
          id: row.op.id,
          serverSeq: row.serverSeq,
          clientTimestamp: String(row.clientTimestamp),
          vectorClock: row.op.vectorClock,
          entityIds: row.op.entityIds,
        })),
      ).toEqual(rows.rows);
    });
  }

  it('the upload seeds reach every verdict the port models (runs after them)', () => {
    expect([...reached].sort()).toEqual([
      'CONFLICT_CONCURRENT',
      'CONFLICT_CONCURRENT existingClock',
      'CONFLICT_SUPERSEDED',
      'CONFLICT_SUPERSEDED existingClock',
      'DUPLICATE_OPERATION',
      'INVALID_CLIENT_ID',
      'INVALID_ENTITY_ID',
      'INVALID_OP_ID',
      'INVALID_SCHEMA_VERSION',
      'INVALID_TIMESTAMP',
      'MISSING_ENTITY_ID',
      'accepted',
    ]);
  });

  it('decides without reading payloads, as the E2EE-only server must', () => {
    // Two ports get the same uploads; one gets arbitrary payloads, and retries
    // with payloads other than the first send's.
    const random = createRandom(31);
    const pick = pickFrom(random);
    const payloads: unknown[] = [undefined, null, 42, [], 'enc:1', { v: 1 }, { x: [2] }];
    for (let run = 0; run < 10; run++) {
      const plain = new port.FakeSuperSyncServer(() => 5_000);
      const varied = new port.FakeSuperSyncServer(() => 5_000);
      const sent: Operation[] = [];
      for (let request = 0; request < 30; request++) {
        const clientId = pick(CLIENTS);
        const ops = [0, 1, 2].map((i): Operation => {
          if (sent.length && random() < 0.25) return { ...pick(sent) };
          const base = randomOp(random, `b-${run}-${request}-${i}`);
          return {
            ...base,
            clientId,
            opType: pick(REGULAR_OP_TYPES),
            vectorClock: {
              ...base.vectorClock,
              [clientId]: base.vectorClock[clientId] ?? 1,
            },
          };
        });
        sent.push(...ops);
        const expected = plain.uploadOps(ops, clientId).results.map(verdict);
        const actual = varied
          .uploadOps(
            ops.map((op) => ({ ...op, payload: pick(payloads) })),
            clientId,
          )
          .results.map(verdict);
        expect(actual, `run ${run} request ${request}: ${JSON.stringify(ops)}`).toEqual(
          expected,
        );
      }
    }
  });

  it('validateOpSubset agrees with ValidationService.validateOp', () => {
    const random = createRandom(7);
    const validation = new ValidationService(DEFAULT_SYNC_CONFIG);
    for (let i = 0; i < 2_000; i++) {
      const base = randomOp(random, `v-${i}`);
      const op = withInvalidField(random, {
        ...base,
        payload:
          base.actionType === DELTA ? deltaPayload(random, base.entityId) : base.payload,
        ...(random() < 0.3 ? { isPayloadEncrypted: true } : {}),
        ...(random() < 0.1 ? { payload: 'enc:1' } : {}),
      });
      const clientId = random() < 0.1 ? 'cX' : op.clientId;
      const real = validation.validateOp(structuredClone(op), clientId);
      const ported = port.validateOpSubset(structuredClone(op), clientId);
      expect(
        { valid: !ported, errorCode: ported?.errorCode },
        `op ${i}: ${JSON.stringify(op)} as ${clientId}`,
      ).toEqual({
        valid: real.valid,
        errorCode: real.valid ? undefined : real.errorCode,
      });
    }
  });

  it('pure helpers agree on random operations', () => {
    const random = createRandom(99);
    // A retry of `op` with at most one field changed, or an unrelated op, so
    // every identity field of the duplicate checks is exercised on its own.
    const variantOf = (op: Operation, id: string): Operation => {
      const other = randomOp(random, id);
      const roll = random();
      if (roll < 0.3) return { ...op };
      if (roll < 0.4) return { ...op, vectorClock: other.vectorClock };
      if (roll < 0.5) return { ...op, payload: other.payload };
      if (roll < 0.6) return { ...op, entityIds: other.entityIds };
      if (roll < 0.7) return { ...op, timestamp: op.timestamp + 1 };
      if (roll < 0.8) return { ...op, schemaVersion: other.schemaVersion };
      return other;
    };
    for (let i = 0; i < 600; i++) {
      const op = randomOp(random, `p-${i}`);
      const other = variantOf(op, `p-${i}`);
      const existing = randomOp(random, `x-${i}`);
      expect(port.getConflictEntityIds(op)).toEqual(getConflictEntityIds(op));
      expect(port.getStoredEntityIds(op)).toEqual(getStoredEntityIds(op));
      expect(port.resolveConflictForExistingOp(op, 'e1', existing)).toEqual(
        resolveConflictForExistingOp(op, 'e1', existing),
      );
      expect(port.isSameIncomingOperation(op, other)).toBe(
        isSameIncomingOperation(op, other),
      );
      const storedClock = limitVectorClockSize(other.vectorClock, [other.clientId]);
      const receivedAt =
        5_000 - (random() < 0.3 ? DEFAULT_SYNC_CONFIG.maxClockDriftMs : 0);
      expect(
        port.isSameDuplicateOperation(
          {
            serverSeq: 1,
            receivedAt,
            clientTimestamp: other.timestamp,
            op: {
              ...other,
              vectorClock: storedClock,
              entityIds: getStoredEntityIds(other),
              isPayloadEncrypted: false,
            },
          },
          op,
          DEFAULT_SYNC_CONFIG.maxClockDriftMs,
        ),
      ).toBe(
        isSameDuplicateOperation(
          {
            id: other.id,
            userId: USER_ID,
            clientId: other.clientId,
            actionType: other.actionType,
            opType: other.opType,
            entityType: other.entityType,
            entityId: other.entityId ?? null,
            entityIds: getStoredEntityIds(other),
            payload: other.payload,
            vectorClock: storedClock,
            schemaVersion: other.schemaVersion,
            clientTimestamp: other.timestamp,
            receivedAt,
            isPayloadEncrypted: false,
            syncImportReason: null,
            repairBaseServerSeq: null,
          },
          USER_ID,
          op,
          DEFAULT_SYNC_CONFIG.maxClockDriftMs,
        ),
      );
    }
  });

  // Asserted on the port only: the route handler and the download service
  // read through the global Prisma client, so they are not run here.
  it("piggybacks and downloads other clients' ops, and flags gaps (sync.routes*.ts)", () => {
    const server = new port.FakeSuperSyncServer(() => 5_000);
    const op = (
      id: string,
      clientId: string,
      entityId: string,
      counter: number,
    ): Operation => ({
      id,
      clientId,
      actionType: '[Task] Update',
      opType: 'UPD',
      entityType: 'TASK',
      entityId,
      payload: 'enc:1',
      isPayloadEncrypted: true,
      vectorClock: { [clientId]: counter },
      timestamp: 1_000,
      schemaVersion: 2,
    });
    server.uploadOps([op('a1', 'cA', 'e1', 1)], 'cA');
    server.uploadOps([op('b1', 'cB', 'e2', 1)], 'cB');
    const response = server.uploadOps([op('a2', 'cA', 'e3', 2)], 'cA', 0);
    expect(response.results.map((r) => r.accepted)).toEqual([true]);
    expect(response.newOps?.map((o) => o.op.id)).toEqual(['b1']);
    expect(response.latestSeq).toBe(3);

    const download = server.downloadOps(0, 'cB', 1);
    expect(download.ops.map((o) => o.op.id)).toEqual(['a1']);
    expect(download.hasMore).toBe(true);
    expect(server.downloadOps(0, 'cA', 10).ops.map((o) => o.op.id)).toEqual(['b1']);
    const all = server.downloadOps(1, undefined, 10);
    expect(all.ops.map((o) => o.op.id)).toEqual(['b1', 'a2']);
    expect(all.gapDetected).toBeUndefined();

    // The gap cases of getOpsSinceWithSeq: a cursor ahead of the server, then,
    // with rows gone as if pruned, a hole in the returned ops and a cursor
    // behind the oldest kept op.
    expect(server.downloadOps(5, 'cB', 10).gapDetected).toBe(true);
    server.rows.splice(1, 1); // seq 2
    expect(server.downloadOps(1, undefined, 10).gapDetected).toBe(true);
    server.rows.splice(0, 1); // seq 1
    expect(server.downloadOps(1, 'cB', 10).gapDetected).toBe(true);
  });

  it('uses the server error codes and clock-drift window', () => {
    for (const code of [
      'CONFLICT_CONCURRENT',
      'CONFLICT_SUPERSEDED',
      'DUPLICATE_OPERATION',
      'INVALID_OP_ID',
    ]) {
      expect(SYNC_ERROR_CODES).toHaveProperty(code, code);
    }
    expect(DEFAULT_SYNC_CONFIG.maxClockDriftMs).toBe(60_000);
  });
});
