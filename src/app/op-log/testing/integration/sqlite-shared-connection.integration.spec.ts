import { TestBed } from '@angular/core/testing';
import { Provider } from '@angular/core';
import { ActionType, EntityType, Operation, OpType } from '../../core/operation.types';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { ArchiveStoreService } from '../../persistence/archive-store.service';
import { CLIENT_ID_PROVIDER, ClientIdProvider } from '../../util/client-id.provider';
import { OP_LOG_DB_ADAPTER_FACTORY } from '../../persistence/op-log-db-adapter.token';
import { SqliteDb, SqliteOpLogAdapter } from '../../persistence/sqlite-op-log-adapter';
import { createSqlJsDb } from '../../persistence/sql-js-db.test-helper';
import { ArchiveModel } from '../../../features/archive/archive.model';

/**
 * Store-level guards for the native SQLite topology (#8746): the op-log store
 * and the archive store each hold their own adapter over ONE physical
 * connection, and the archive writer does not take the OPERATION_LOG web lock.
 * Every case runs against both backends so a divergence shows up as "passes on
 * IndexedDB, fails on sql.js":
 * - concurrent op-log appends and archive flushes all land, and a failing
 *   archive transaction cannot take a concurrent append down with it;
 * - `hasSyncedOps()` ignores rows an IndexedDB index would not contain
 *   (NULL `syncedAt`, #8312);
 * - `getLastSeq()` transfers one row, not the ops table (#8313, sql.js only).
 */

const mockClientIdProvider: ClientIdProvider = {
  loadClientId: () => Promise.resolve('testClient'),
  getOrGenerateClientId: () => Promise.resolve('testClient'),
  clearCache: () => {},
};

const makeOp = (id: string, overrides: Partial<Operation> = {}): Operation => ({
  id,
  actionType: '[Task] Update' as ActionType,
  opType: OpType.Update,
  entityType: 'TASK' as EntityType,
  entityId: id,
  payload: {},
  clientId: 'testClient',
  vectorClock: { testClient: 1 },
  timestamp: 1,
  schemaVersion: 1,
  ...overrides,
});

const archiveModel = (taskIds: string[]): ArchiveModel =>
  ({
    task: {
      ids: taskIds,
      entities: Object.fromEntries(
        taskIds.map((id) => [id, { id, title: `Archived ${id}`, isDone: true }]),
      ),
    },
    timeTracking: { project: {}, tag: {} },
    lastTimeTrackingFlush: 0,
  }) as unknown as ArchiveModel;

/**
 * A payload that neither backend can persist: JSON.stringify rejects the cycle
 * (SQLite value column) and structured clone rejects the function (IndexedDB).
 */
const unstorableArchive = (): ArchiveModel => {
  const poison: Record<string, unknown> = { fn: () => undefined };
  poison['self'] = poison;
  return poison as unknown as ArchiveModel;
};

/** A SqliteDb that counts the rows every `query` hands back over the "bridge". */
const withRowCounter = (db: SqliteDb): SqliteDb & { rowsReturned: number } => {
  const counting = {
    rowsReturned: 0,
    run: (sql: string, params?: unknown[]) => db.run(sql, params),
    query: async (sql: string, params?: unknown[]) => {
      const rows = await db.query(sql, params);
      counting.rowsReturned += rows.length;
      return rows;
    },
  };
  return counting;
};

interface Backend {
  label: string;
  providers: () => Promise<Provider[]>;
  /** Row counter for the sql.js backend; absent on IndexedDB. */
  counter?: () => SqliteDb & { rowsReturned: number };
}

const defineSharedConnectionContract = (backend: Backend): void => {
  describe(`Op-log + archive stores over one connection (${backend.label})`, () => {
    let opLogStore: OperationLogStoreService;
    let archiveStore: ArchiveStoreService;

    beforeEach(async () => {
      TestBed.configureTestingModule({
        providers: [
          OperationLogStoreService,
          ArchiveStoreService,
          { provide: CLIENT_ID_PROVIDER, useValue: mockClientIdProvider },
          ...(await backend.providers()),
        ],
      });
      opLogStore = TestBed.inject(OperationLogStoreService);
      archiveStore = TestBed.inject(ArchiveStoreService);
      await opLogStore.init();
      await opLogStore._clearAllDataForTesting();
      await archiveStore._clearAllDataForTesting();
    });

    it('op-log appends racing archive flushes on one connection all land (no lost ops)', async () => {
      // Fire everything WITHOUT awaiting in between — on a single SQLite
      // connection with no serialization this either throws "cannot start a
      // transaction within a transaction" or lets a bare `add` join the
      // archive's BEGIN…ROLLBACK and vanish.
      const work: Promise<unknown>[] = [];
      for (let i = 0; i < 10; i++) {
        work.push(
          opLogStore.appendBatch([makeOp(`batch-${i}-a`), makeOp(`batch-${i}-b`)]),
        );
        work.push(
          archiveStore.saveArchivesAtomic(archiveModel([`y${i}`]), archiveModel([])),
        );
        work.push(opLogStore.append(makeOp(`single-${i}`)));
      }
      await Promise.all(work);

      const ops = await opLogStore.getOpsAfterSeq(0);
      expect(ops.length).toBe(30);
      const young = await archiveStore.loadArchiveYoung();
      expect(young?.task.ids).toEqual(['y9']);
    });

    it('a failing archive transaction rolls back alone, not a concurrent op append', async () => {
      // The archive tx writes ARCHIVE_YOUNG, then fails on ARCHIVE_OLD → ROLLBACK
      // while the append below is in flight on the same connection.
      const failing = archiveStore
        .saveArchivesAtomic(archiveModel(['y']), unstorableArchive())
        .then(
          () => 'committed' as const,
          () => 'rolled-back' as const,
        );
      const append = opLogStore.append(makeOp('survivor'));
      const [outcome] = await Promise.all([failing, append]);

      expect(outcome).toBe('rolled-back');
      // The archive's own first write was rolled back with it…
      expect(await archiveStore.loadArchiveYoung()).toBeUndefined();
      // …and the concurrent append was not.
      expect((await opLogStore.getOpsAfterSeq(0)).map((e) => e.op.id)).toEqual([
        'survivor',
      ]);
    });

    it('hasSyncedOps() is false on a never-synced client with only local ops (#8312)', async () => {
      await opLogStore.append(makeOp('local-only'), 'local');
      // IndexedDB: a record without `syncedAt` is absent from the bySyncedAt
      // index. SQLite stores NULL `synced_at`, which sorts first in an
      // unbounded `ORDER BY synced_at ASC` scan — the adapter must exclude it.
      expect(await opLogStore.hasSyncedOps()).toBeFalse();
      await opLogStore.append(makeOp('remote-op', { clientId: 'other' }), 'remote');
      expect(await opLogStore.hasSyncedOps()).toBeTrue();
    });

    if (backend.counter) {
      const counter = backend.counter;
      it('getLastSeq() transfers one row, not the whole ops table (#8313)', async () => {
        await opLogStore.appendBatch(
          Array.from({ length: 50 }, (_, i) => makeOp(`op-${i}`)),
        );
        counter().rowsReturned = 0;
        expect(await opLogStore.getLastSeq()).toBe(50);
        expect(counter().rowsReturned).toBe(1);
      });
    }
  });
};

defineSharedConnectionContract({ label: 'IndexedDB', providers: async () => [] });

let sqlCounter: SqliteDb & { rowsReturned: number };
defineSharedConnectionContract({
  label: 'sql.js (real SQLite)',
  providers: async () => {
    // ONE physical connection, TWO adapters (one per service) — the native topology.
    sqlCounter = withRowCounter(await createSqlJsDb());
    const db = sqlCounter;
    return [
      { provide: OP_LOG_DB_ADAPTER_FACTORY, useValue: () => new SqliteOpLogAdapter(db) },
    ];
  },
  counter: () => sqlCounter,
});
