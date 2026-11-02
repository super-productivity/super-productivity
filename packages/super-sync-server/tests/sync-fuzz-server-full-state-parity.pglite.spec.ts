import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Prisma } from '@prisma/client';
import { SyncService } from '../src/sync/sync.service';
import { OperationDownloadService } from '../src/sync/services/operation-download.service';
import type { Operation, UploadResult, VectorClock } from '../src/sync/sync.types';
import * as port from '../../../src/app/op-log/testing/integration/sync-fuzz/fake-super-sync-server';

/**
 * Parity of the sync fuzz port's full-state paths with the real server code
 * (see the port header): SyncService.uploadOps and
 * OperationDownloadService.getOpsSinceWithSeq run on PGlite, with the global
 * Prisma client mocked onto it, against the port's uploadBatch and
 * getOpsSinceWithSeq. Seeded random requests mix regular ops with SYNC_IMPORT,
 * BACKUP_IMPORT and REPAIR ops, clean slates, stale and current cursors and
 * REPAIR bases, and oversized clocks. After every request the verdicts, the
 * stored rows and the sync state (allocator, fence, full-state marker) must
 * match, and so must a download from a random cursor.
 *
 * The snapshot route's own checks (sync.routes.snapshot-handler.ts) are
 * asserted on the port alone, at the end: the route reads through handlers
 * that this spec does not run.
 */

const USER_ID = 1;
const CLIENTS = ['cA', 'cB', 'cC', 'cD'];
/** Enough extra clock entries to push a clock past MAX_VECTOR_CLOCK_SIZE (20). */
const MANY_CLIENTS = Array.from(
  { length: 22 },
  (_, i) => `cX${String(i).padStart(2, '0')}`,
);
const ENTITY_IDS = ['e1', 'e2', 'e3'];
const FULL_STATE_TYPES = ['SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR'] as const;

/** The INTERNAL_ERROR texts of the paths under test, for the coverage check. */
const INTERNAL_ERROR_LABELS: Record<string, string> = {
  [port.STATE_REPLACEMENT_REQUIRED_ERROR]: 'fenced',
  'Batch deferred because its REPAIR snapshot is stale': 'deferred by a stale REPAIR',
  'Clean-slate batch contains an invalid operation': 'beside an invalid op',
  'Clean-slate replacement was rolled back': 'rolled back',
};

const mocked = vi.hoisted(() => ({ prisma: {} as Record<string, unknown> }));
vi.mock('../src/db', () => ({ prisma: mocked.prisma }));

const createRandom = (seed: number): (() => number) => {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const COLUMNS: Record<string, string> = {
  id: 'id',
  userId: 'user_id',
  clientId: 'client_id',
  actionType: 'action_type',
  opType: 'op_type',
  entityType: 'entity_type',
  entityId: 'entity_id',
  entityIds: 'entity_ids',
  payload: 'payload',
  vectorClock: 'vector_clock',
  serverSeq: 'server_seq',
  schemaVersion: 'schema_version',
  clientTimestamp: 'client_timestamp',
  receivedAt: 'received_at',
  isPayloadEncrypted: 'is_payload_encrypted',
  syncImportReason: 'sync_import_reason',
  repairBaseServerSeq: 'repair_base_server_seq',
};
const STATE_COLUMNS: Record<string, string> = {
  userId: 'user_id',
  lastSeq: 'last_seq',
  latestStateReplacementSeq: 'latest_state_replacement_seq',
  latestFullStateSeq: 'latest_full_state_seq',
  latestFullStateVectorClock: 'latest_full_state_vector_clock',
};
/** Snapshot-cache columns the clean slate resets; this spec has no cache. */
const IGNORED_STATE_COLUMNS = new Set(['lastSnapshotSeq', 'snapshotData', 'snapshotAt']);

const column = (map: Record<string, string>, key: string): string => {
  if (!map[key]) throw new Error(`no column for ${key}`);
  return map[key];
};

/** Renders the Prisma `where` shapes the upload and download code use. */
const whereSql = (
  where: Record<string, unknown>,
  values: unknown[],
  map: Record<string, string> = COLUMNS,
): string => {
  const parts: string[] = [];
  const param = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  for (const [key, condition] of Object.entries(where)) {
    const col = column(map, key);
    if (condition === null) parts.push(`${col} IS NULL`);
    else if (typeof condition !== 'object') parts.push(`${col} = ${param(condition)}`);
    else {
      for (const [op, value] of Object.entries(condition as Record<string, unknown>)) {
        if (op === 'in') parts.push(`${col} = ANY(${param(value)})`);
        else if (op === 'not' && value === null) parts.push(`${col} IS NOT NULL`);
        else if (op === 'not') parts.push(`${col} <> ${param(value)}`);
        else if (op === 'gt') parts.push(`${col} > ${param(value)}`);
        else if (op === 'lt') parts.push(`${col} < ${param(value)}`);
        else if (op === 'lte') parts.push(`${col} <= ${param(value)}`);
        else throw new Error(`no where operator ${op}`);
      }
    }
  }
  return parts.length ? `WHERE ${parts.join(' AND ')}` : '';
};

const selectSql = (
  select: Record<string, boolean>,
  map: Record<string, string> = COLUMNS,
): string =>
  Object.keys(select)
    .filter((key) => select[key])
    .map((key) => `${column(map, key)} AS "${key}"`)
    .join(', ');

const orderSql = (orderBy?: Record<string, 'asc' | 'desc'>): string =>
  orderBy
    ? `ORDER BY ${Object.entries(orderBy)
        .map(([key, dir]) => `${column(COLUMNS, key)} ${dir.toUpperCase()}`)
        .join(', ')}`
    : '';

/** The JS value of a row, with bigint columns as numbers. */
const normalizeRow = (row: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      typeof value === 'bigint' &&
      key !== 'clientTimestamp' &&
      key !== 'receivedAt' &&
      key !== 'max_counter'
        ? Number(value)
        : value,
    ]),
  );

/** A Prisma client on PGlite: the calls SyncService.uploadOps and the download make. */
const createPrisma = (db: PGlite): Record<string, unknown> => {
  const query = async (text: string, values: unknown[] = []) =>
    (await db.query<Record<string, unknown>>(text, values)).rows.map(normalizeRow);
  const raw = async (
    first: TemplateStringsArray | Prisma.Sql,
    ...rest: Array<Prisma.Sql | Prisma.Sql['values'][number]>
  ) => {
    // A tagged-template call, or a prepared Prisma.Sql (not exported as a class).
    const sql = Array.isArray(first)
      ? Prisma.sql(first as TemplateStringsArray, ...rest)
      : (first as Prisma.Sql);
    return query(sql.text, sql.values);
  };
  const stateSet = (data: Record<string, unknown>, values: unknown[]): string => {
    const sets: string[] = [];
    for (const [key, value] of Object.entries(data)) {
      if (IGNORED_STATE_COLUMNS.has(key)) continue;
      const col = column(STATE_COLUMNS, key);
      if (value && typeof value === 'object' && 'increment' in value) {
        values.push((value as { increment: number }).increment);
        sets.push(`${col} = ${col} + $${values.length}`);
      } else if (value && typeof value === 'object' && 'decrement' in value) {
        values.push((value as { decrement: number }).decrement);
        sets.push(`${col} = ${col} - $${values.length}`);
      } else if (value === Prisma.DbNull || value === null) {
        sets.push(`${col} = NULL`);
      } else {
        values.push(key === 'latestFullStateVectorClock' ? JSON.stringify(value) : value);
        sets.push(`${col} = $${values.length}`);
      }
    }
    return sets.join(', ');
  };
  const operation = {
    findUnique: async (args: {
      where: Record<string, unknown>;
      select: Record<string, boolean>;
    }) => {
      const values: unknown[] = [];
      const rows = await query(
        `SELECT ${selectSql(args.select)} FROM operations ${whereSql(args.where, values)}`,
        values,
      );
      return rows[0] ?? null;
    },
    findFirst: async (args: {
      where: Record<string, unknown>;
      select: Record<string, boolean>;
      orderBy?: Record<string, 'asc' | 'desc'>;
    }) => {
      const values: unknown[] = [];
      const rows = await query(
        `SELECT ${selectSql(args.select)} FROM operations ${whereSql(args.where, values)}
           ${orderSql(args.orderBy)} LIMIT 1`,
        values,
      );
      return rows[0] ?? null;
    },
    findMany: async (args: {
      where: Record<string, unknown>;
      select: Record<string, boolean>;
      orderBy?: Record<string, 'asc' | 'desc'>;
      take?: number;
    }) => {
      const values: unknown[] = [];
      return query(
        `SELECT ${selectSql(args.select)} FROM operations ${whereSql(args.where, values)}
           ${orderSql(args.orderBy)} ${args.take !== undefined ? `LIMIT ${args.take}` : ''}`,
        values,
      );
    },
    createMany: async (args: {
      data: Array<Record<string, unknown>>;
      skipDuplicates?: boolean;
    }) => {
      let count = 0;
      for (const row of args.data) {
        const keys = Object.keys(row).filter((key) => key !== 'payloadBytes');
        const result = await db.query(
          `INSERT INTO operations (${keys.map((key) => column(COLUMNS, key)).join(', ')})
           VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})
           ${args.skipDuplicates ? 'ON CONFLICT (id) DO NOTHING' : ''}`,
          keys.map((key) =>
            key === 'payload' || key === 'vectorClock'
              ? JSON.stringify(row[key])
              : typeof row[key] === 'bigint'
                ? String(row[key])
                : row[key],
          ),
        );
        count += result.affectedRows ?? 0;
      }
      return { count };
    },
    deleteMany: async (args: { where: Record<string, unknown> }) => {
      const values: unknown[] = [];
      await db.query(`DELETE FROM operations ${whereSql(args.where, values)}`, values);
      return { count: 0 };
    },
  };
  const userSyncState = {
    upsert: async (args: { where: { userId: number } }) => {
      await db.query(
        `INSERT INTO user_sync_state (user_id, last_seq) VALUES ($1, 0)
         ON CONFLICT (user_id) DO NOTHING`,
        [args.where.userId],
      );
      return {};
    },
    update: async (args: {
      where: { userId: number };
      data: Record<string, unknown>;
    }) => {
      const values: unknown[] = [args.where.userId];
      const rows = await query(
        `UPDATE user_sync_state SET ${stateSet(args.data, values)} WHERE user_id = $1
         RETURNING ${selectSql({ lastSeq: true }, STATE_COLUMNS)}`,
        values,
      );
      return rows[0];
    },
    updateMany: async (args: {
      where: { userId: number };
      data: Record<string, unknown>;
    }) => {
      const values: unknown[] = [args.where.userId];
      await db.query(
        `UPDATE user_sync_state SET ${stateSet(args.data, values)} WHERE user_id = $1`,
        values,
      );
      return { count: 1 };
    },
    findUnique: async (args: {
      where: { userId: number };
      select: Record<string, boolean>;
    }) => {
      const rows = await query(
        `SELECT ${selectSql(args.select, STATE_COLUMNS)} FROM user_sync_state
         WHERE user_id = $1`,
        [args.where.userId],
      );
      return rows[0] ?? null;
    },
  };
  const client: Record<string, unknown> = {
    operation,
    userSyncState,
    // Device rows and the storage counter do not affect any verdict here.
    syncDevice: { deleteMany: async () => ({ count: 0 }), upsert: async () => ({}) },
    user: { update: async () => ({}) },
    $queryRaw: raw,
    $executeRaw: async () => 0,
  };
  client['$transaction'] = async (fn: (tx: unknown) => Promise<unknown>) => {
    await db.exec('BEGIN');
    try {
      // A fresh client per transaction, as Prisma passes: the upload service
      // memoizes the full-state author per tx object.
      const result = await fn({ ...client });
      await db.exec('COMMIT');
      return result;
    } catch (err) {
      await db.exec('ROLLBACK');
      throw err;
    }
  };
  return client;
};

interface Verdict {
  accepted: boolean;
  serverSeq?: number;
  errorCode?: string;
  error?: string;
  existingClock?: unknown;
}

/** An upload result as compared: the error text only where it is the protocol. */
const verdict = (result: Verdict): Record<string, unknown> => ({
  accepted: result.accepted,
  ...(result.serverSeq !== undefined ? { serverSeq: result.serverSeq } : {}),
  ...(result.errorCode ? { errorCode: result.errorCode } : {}),
  ...(result.errorCode === 'INTERNAL_ERROR' ? { error: result.error } : {}),
  ...(result.existingClock ? { existingClock: result.existingClock } : {}),
});

describe('sync fuzz SuperSync port: full-state parity with the real server', () => {
  let db: PGlite;
  let now = 50_000;

  beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    Object.assign(mocked.prisma, createPrisma(db));
    vi.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await db.close();
  });

  beforeEach(async () => {
    now = 50_000;
    await db.exec(`
      DROP TABLE IF EXISTS operations;
      DROP TABLE IF EXISTS user_sync_state;
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
        repair_base_server_seq integer,
        UNIQUE (user_id, server_seq)
      );
      CREATE INDEX operations_entity_ids_gin ON operations USING GIN (entity_ids);
      CREATE TABLE user_sync_state (
        user_id integer PRIMARY KEY,
        last_seq integer NOT NULL DEFAULT 0,
        latest_state_replacement_seq integer,
        latest_full_state_seq integer,
        latest_full_state_vector_clock jsonb
      );
    `);
  });

  const realState = async (): Promise<unknown> => {
    const rows = await db.query<Record<string, unknown>>(
      `SELECT last_seq AS "lastSeq",
         latest_state_replacement_seq AS "latestStateReplacementSeq",
         latest_full_state_seq AS "seq",
         latest_full_state_vector_clock AS "clock"
       FROM user_sync_state WHERE user_id = $1`,
      [USER_ID],
    );
    const row = rows.rows[0];
    return {
      lastSeq: row ? Number(row['lastSeq']) : 0,
      latestStateReplacementSeq: row?.['latestStateReplacementSeq'] ?? null,
      latestFullState:
        row?.['seq'] === null || row?.['seq'] === undefined
          ? null
          : { seq: row['seq'], clock: row['clock'] },
    };
  };

  const realRows = async (): Promise<unknown[]> =>
    (
      await db.query<Record<string, unknown>>(
        `SELECT id, server_seq AS "serverSeq", op_type AS "opType",
           vector_clock AS "vectorClock", entity_ids AS "entityIds"
         FROM operations ORDER BY server_seq`,
      )
    ).rows;

  const portRows = (server: port.FakeSuperSyncServer): unknown[] =>
    server.rows.map((row) => ({
      id: row.op.id,
      serverSeq: row.serverSeq,
      opType: row.op.opType,
      vectorClock: row.op.vectorClock,
      entityIds: row.op.entityIds,
    }));

  /**
   * A random clock, or a caught-up one (every stored entry, own counter
   * ahead) that most conflict checks accept. Sometimes oversized, with the
   * extra entries above the four clients' counters, so storage pruning must
   * keep a low-counter full-state author.
   */
  const randomClock = (
    random: () => number,
    clientId: string,
    server: port.FakeSuperSyncServer,
  ): VectorClock => {
    const clock: VectorClock = {};
    if (random() < 0.5) {
      for (const row of server.rows) {
        for (const [id, counter] of Object.entries(row.op.vectorClock)) {
          clock[id] = Math.max(clock[id] ?? 0, counter as number);
        }
      }
      clock[clientId] = (clock[clientId] ?? 0) + 1;
    } else {
      for (const client of CLIENTS) {
        if (random() < 0.6) clock[client] = 1 + Math.floor(random() * 4);
      }
    }
    if (random() < 0.2) {
      for (const client of MANY_CLIENTS) {
        clock[client] = Math.max(clock[client] ?? 0, 5 + Math.floor(random() * 3));
      }
    }
    clock[clientId] = clock[clientId] ?? 1;
    return clock;
  };

  /** What the seeds reached, for the coverage check after them. */
  const reached = new Set<string>();

  for (let seed = 1; seed <= 16; seed++) {
    it(`uploads and downloads agree with full-state ops (seed ${seed})`, async () => {
      const random = createRandom(700 + seed);
      const pick = <T>(items: readonly T[]): T =>
        items[Math.floor(random() * items.length)];
      const syncService = new SyncService();
      const download = new OperationDownloadService();
      const server = new port.FakeSuperSyncServer(() => now);
      let opCounter = 0;
      for (let request = 0; request < 30; request++) {
        now += 1_000 + Math.floor(random() * 20_000);
        const clientId = pick(CLIENTS);
        const latestSeq = server.syncState.lastSeq;
        const opFor = (opType: Operation['opType']): Operation => {
          const isFullState = (FULL_STATE_TYPES as readonly string[]).includes(opType);
          return {
            id: `op-${seed}-${++opCounter}`,
            clientId,
            actionType: isFullState ? port.FULL_STATE_ACTION_TYPE : '[Task] Update',
            opType,
            entityType: isFullState ? 'ALL' : 'TASK',
            ...(isFullState ? {} : { entityId: pick(ENTITY_IDS) }),
            payload: `enc:${opCounter}`,
            isPayloadEncrypted: true,
            vectorClock: randomClock(random, clientId, server),
            timestamp: now - Math.floor(random() * 1_000),
            schemaVersion: 2,
          };
        };
        const kind = random();
        let ops: Operation[];
        let isCleanSlate: boolean | undefined;
        let repairBaseServerSeq: number | undefined;
        let allowLegacy = false;
        let lastKnownServerSeq: number | undefined;
        if (kind < 0.5) {
          ops = Array.from({ length: 1 + Math.floor(random() * 3) }, () =>
            opFor(pick(['UPD', 'UPD', 'CRT', 'DEL'] as const)),
          );
          // The ops route passes a cursor: current, stale, or none. The API
          // also takes a clean slate of regular ops alone.
          if (random() < 0.05) isCleanSlate = true;
          const cursor = random();
          lastKnownServerSeq =
            cursor < 0.4
              ? latestSeq
              : cursor < 0.8
                ? Math.floor(random() * (latestSeq + 1))
                : undefined;
        } else if (kind < 0.8) {
          // A snapshot upload: one full-state op, without a cursor.
          const opType = pick(FULL_STATE_TYPES);
          ops = [
            {
              ...opFor(opType),
              ...(random() < 0.5 ? { syncImportReason: 'FORCE_UPLOAD' } : {}),
            },
          ];
          isCleanSlate = opType === 'REPAIR' ? random() < 0.2 : random() < 0.6;
          if (opType === 'REPAIR') {
            const base = random();
            repairBaseServerSeq =
              base < 0.6
                ? latestSeq
                : base < 0.8
                  ? Math.max(0, latestSeq - 1)
                  : undefined;
            allowLegacy = repairBaseServerSeq === undefined && isCleanSlate === true;
          }
          if (repairBaseServerSeq !== undefined) {
            ops[0].repairBaseServerSeq = repairBaseServerSeq;
          }
        } else {
          // Full-state ops on the ops route, mixed with regular ones, and
          // an occasional invalid op in a clean slate.
          ops = [opFor(pick(FULL_STATE_TYPES)), opFor('UPD')];
          // A second edit of the same entity can conflict with the first,
          // after a clean slate's wipe, which then rolls back.
          if (random() < 0.4) ops.push({ ...opFor('UPD'), entityId: ops[1].entityId });
          if (random() < 0.3) ops.reverse();
          if (random() < 0.5) isCleanSlate = true;
          if (random() < 0.2) ops[1] = { ...ops[1], entityId: '' };
          lastKnownServerSeq =
            random() < 0.5 ? latestSeq : Math.floor(random() * (latestSeq + 1));
        }
        const context = `request ${request} from ${clientId}: ${JSON.stringify({
          ops: ops.map((op) => [op.id, op.opType, op.entityId, op.vectorClock]),
          isCleanSlate,
          repairBaseServerSeq,
          allowLegacy,
          lastKnownServerSeq,
        })}`;
        const real: UploadResult[] = await syncService.uploadOps(
          USER_ID,
          clientId,
          structuredClone(ops),
          isCleanSlate,
          undefined,
          repairBaseServerSeq,
          allowLegacy,
          lastKnownServerSeq,
        );
        const ported = server.uploadBatch(structuredClone(ops), clientId, {
          isCleanSlate,
          repairBaseServerSeq,
          allowLegacyRepairWithoutBase: allowLegacy,
          lastKnownServerSeq,
        });
        expect(ported.map(verdict), context).toEqual(real.map(verdict));
        for (const [i, result] of real.entries()) {
          const type = (FULL_STATE_TYPES as readonly string[]).includes(ops[i].opType)
            ? ops[i].opType
            : 'regular';
          reached.add(
            `${type}${isCleanSlate ? ' clean-slate' : ''} ${
              result.accepted
                ? 'accepted'
                : result.errorCode === 'INTERNAL_ERROR'
                  ? INTERNAL_ERROR_LABELS[result.error ?? '']
                  : result.errorCode
            }`,
          );
        }
        expect(portRows(server), context).toEqual(await realRows());
        expect(server.syncState, context).toEqual(await realState());

        // A download from a random cursor, with or without an excluded client.
        const sinceSeq = Math.floor(random() * (server.syncState.lastSeq + 2));
        const exclude = random() < 0.5 ? pick(CLIENTS) : undefined;
        const limit = 1 + Math.floor(random() * 6);
        const realDown = await download.getOpsSinceWithSeq(
          USER_ID,
          sinceSeq,
          exclude,
          limit,
        );
        const portDown = server.getOpsSinceWithSeq(sinceSeq, exclude, limit);
        if (realDown.snapshotVectorClock) reached.add('download snapshot clock');
        if (realDown.gapDetected) reached.add('download gap');
        const author = server.rows.filter((row) => port.isCausalFullState(row.op)).pop()
          ?.op.clientId;
        const last = server.rows[server.rows.length - 1];
        if (
          author &&
          last &&
          last.op.clientId !== author &&
          Object.keys(last.op.vectorClock).length === 20 &&
          last.op.vectorClock[author] !== undefined &&
          last.op.vectorClock[author] < 5
        ) {
          reached.add('pruned clock keeps a low full-state author');
        }
        expect(
          JSON.parse(JSON.stringify(portDown)),
          `${context}; download since ${sinceSeq} excluding ${exclude}`,
        ).toEqual(
          JSON.parse(
            JSON.stringify({
              ops: realDown.ops,
              latestSeq: realDown.latestSeq,
              gapDetected: realDown.gapDetected,
              snapshotVectorClock: realDown.snapshotVectorClock,
            }),
          ),
        );
      }
    });
  }

  it('the seeds reach every full-state outcome (runs after them)', () => {
    expect([...reached].sort()).toEqual([
      'BACKUP_IMPORT accepted',
      'BACKUP_IMPORT clean-slate INVALID_ENTITY_ID',
      'BACKUP_IMPORT clean-slate accepted',
      'BACKUP_IMPORT clean-slate beside an invalid op',
      'BACKUP_IMPORT clean-slate fenced',
      'BACKUP_IMPORT clean-slate rolled back',
      'BACKUP_IMPORT fenced',
      'REPAIR REPAIR_STALE',
      'REPAIR accepted',
      'REPAIR clean-slate REPAIR_STALE',
      'REPAIR clean-slate accepted',
      'REPAIR clean-slate beside an invalid op',
      'REPAIR clean-slate fenced',
      'REPAIR fenced',
      'SYNC_IMPORT INVALID_ENTITY_ID',
      'SYNC_IMPORT accepted',
      'SYNC_IMPORT clean-slate accepted',
      'SYNC_IMPORT clean-slate beside an invalid op',
      'SYNC_IMPORT clean-slate fenced',
      'SYNC_IMPORT clean-slate rolled back',
      'SYNC_IMPORT fenced',
      'download gap',
      'download snapshot clock',
      'pruned clock keeps a low full-state author',
      'regular CONFLICT_CONCURRENT',
      'regular CONFLICT_SUPERSEDED',
      'regular INVALID_ENTITY_ID',
      'regular accepted',
      'regular clean-slate CONFLICT_CONCURRENT',
      'regular clean-slate CONFLICT_SUPERSEDED',
      'regular clean-slate INVALID_ENTITY_ID',
      'regular clean-slate accepted',
      'regular clean-slate beside an invalid op',
      'regular clean-slate deferred by a stale REPAIR',
      'regular clean-slate fenced',
      'regular clean-slate rolled back',
      'regular deferred by a stale REPAIR',
      'regular fenced',
    ]);
  });
});

// Asserted on the port only: the snapshot and ops routes run handlers and
// caches that the parity spec above does not.
describe('sync fuzz SuperSync port: snapshot and ops routes', () => {
  const snapshot = (
    overrides: Partial<port.FakeSnapshotRequest> & { opId: string; clientId: string },
  ): port.FakeSnapshotRequest => ({
    state: 'enc:state',
    reason: 'initial',
    vectorClock: { [overrides.clientId]: 1 },
    schemaVersion: 2,
    isPayloadEncrypted: true,
    ...overrides,
  });
  const regular = (id: string, clientId: string, clock: VectorClock): Operation => ({
    id,
    clientId,
    actionType: '[Task] Update',
    opType: 'UPD',
    entityType: 'TASK',
    entityId: 'e1',
    payload: 'enc:1',
    isPayloadEncrypted: true,
    vectorClock: clock,
    timestamp: 1_000,
    schemaVersion: 2,
  });

  it('refuses a second initial import with 409, but not its retry or a clean slate', () => {
    const server = new port.FakeSuperSyncServer(() => 5_000);
    const first = server.uploadSnapshot(snapshot({ opId: 'i1', clientId: 'cA' }));
    expect(first).toEqual({ accepted: true, serverSeq: 1 });
    expect(server.uploadSnapshot(snapshot({ opId: 'i1', clientId: 'cA' }))).toEqual({
      accepted: true,
      serverSeq: 1,
    });
    expect(() => server.uploadSnapshot(snapshot({ opId: 'i2', clientId: 'cB' }))).toThrow(
      port.FakeSyncImportExistsError,
    );
    const forced = server.uploadSnapshot(
      snapshot({ opId: 'i3', clientId: 'cB', isCleanSlate: true }),
    );
    expect(forced).toEqual({ accepted: true, serverSeq: 2 });
    expect(server.rows.map((row) => row.op.id)).toEqual(['i3']);
    // Retrying the clean slate is idempotent; reusing its id is not.
    expect(
      server.uploadSnapshot(snapshot({ opId: 'i3', clientId: 'cB', isCleanSlate: true })),
    ).toEqual({ accepted: true, serverSeq: 2 });
    expect(
      server.uploadSnapshot(
        snapshot({
          opId: 'i3',
          clientId: 'cB',
          isCleanSlate: true,
          vectorClock: { cB: 2 },
        }),
      ),
    ).toEqual(expect.objectContaining({ accepted: false, errorCode: 'INVALID_OP_ID' }));
  });

  it('accepts a REPAIR only on the current server state, and it does not fence', () => {
    const server = new port.FakeSuperSyncServer(() => 5_000);
    server.uploadOps([regular('r1', 'cA', { cA: 1 })], 'cA', 0);
    const repair = (opId: string, base?: number): port.FakeSnapshotRequest =>
      snapshot({
        opId,
        clientId: 'cB',
        reason: 'recovery',
        snapshotOpType: 'REPAIR',
        vectorClock: { cA: 1, cB: 1 },
        ...(base !== undefined ? { repairBaseServerSeq: base } : {}),
      });
    expect(server.uploadSnapshot(repair('p1', 0))).toEqual(
      expect.objectContaining({ accepted: false, errorCode: 'REPAIR_STALE' }),
    );
    expect(server.uploadSnapshot(repair('p2'))).toEqual(
      expect.objectContaining({ accepted: false, errorCode: 'REPAIR_STALE' }),
    );
    expect(server.uploadSnapshot(repair('p3', 1))).toEqual({
      accepted: true,
      serverSeq: 2,
    });
    // A response-loss retry reaches the durable op-id check first.
    expect(server.uploadSnapshot(repair('p3', 1))).toEqual({
      accepted: true,
      serverSeq: 2,
    });
    // An upload from before the repair is not fenced...
    const late = server.uploadOps([regular('r2', 'cC', { cA: 1, cC: 1 })], 'cC', 1);
    expect(late.results).toEqual([{ opId: 'r2', accepted: true, serverSeq: 3 }]);
    // ...but a cursor before the repair downloads from it, with its clock.
    const down = server.downloadOps(0, 'cC');
    expect(down.ops.map((o) => o.op.id)).toEqual(['p3']);
    expect(down.snapshotVectorClock).toEqual({ cA: 1, cB: 1 });
  });

  it('fences a stale cursor after an import and piggybacks the uploader’s own import', () => {
    const server = new port.FakeSuperSyncServer(() => 5_000);
    server.uploadOps([regular('r1', 'cA', { cA: 1 })], 'cA', 0);
    const imported = server.uploadSnapshot(
      snapshot({
        opId: 'b1',
        clientId: 'cB',
        reason: 'recovery',
        snapshotOpType: 'BACKUP_IMPORT',
        isCleanSlate: true,
        vectorClock: { cB: 1 },
      }),
    );
    expect(imported).toEqual({ accepted: true, serverSeq: 2 });
    // cB, still at cursor 1, uploads: the whole batch is fenced, and the
    // piggyback includes cB's own import.
    const fenced = server.uploadOps([regular('r2', 'cB', { cB: 2 })], 'cB', 1);
    expect(fenced.results).toEqual([
      {
        opId: 'r2',
        accepted: false,
        error: port.STATE_REPLACEMENT_REQUIRED_ERROR,
        errorCode: 'INTERNAL_ERROR',
      },
    ]);
    expect(fenced.newOps?.map((o) => o.op.id)).toEqual(['b1']);
    const current = server.uploadOps([regular('r3', 'cB', { cB: 2 })], 'cB', 2);
    expect(current.results[0].accepted).toBe(true);
    expect(current.newOps).toBeUndefined();
    // The download skips the wiped history; the import's clock is the marker.
    const down = server.downloadOps(0, 'cA');
    expect(down.ops.map((o) => o.op.id)).toEqual(['b1', 'r3']);
    expect(down.snapshotVectorClock).toEqual({ cB: 1 });
    expect(down.ops[0].op).toEqual(
      expect.objectContaining({
        opType: 'BACKUP_IMPORT',
        entityType: 'ALL',
        actionType: port.FULL_STATE_ACTION_TYPE,
        payload: 'enc:state',
      }),
    );
  });
});
