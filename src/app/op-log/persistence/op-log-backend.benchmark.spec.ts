/**
 * Smoke test for the op-log backend benchmark harness
 * (op-log-backend.benchmark.ts). Validates the runner's logic — seeding, timing,
 * stats, per-backend isolation — against a REAL SQLite engine (sql.js) through
 * the same {@link SqliteOpLogAdapter} the device uses.
 *
 * NOTE: this does NOT measure the JS↔native bridge (sql.js is in-process WASM),
 * so the numbers here are meaningless as performance figures — the point is only
 * that the harness runs end-to-end and produces well-formed results. The actual
 * SQLite-vs-IndexedDB comparison must be run on a device via `window.__benchOpLog`.
 */
import { OpLogDbAdapter } from './op-log-db-adapter';
import { SqliteOpLogAdapter } from './sqlite-op-log-adapter';
import { createSqlJsDb } from './sql-js-db.test-helper';
import { STORE_NAMES } from './db-keys.const';
import {
  BenchBackend,
  OpLogBenchOptions,
  formatReport,
  runOpLogBackendBench,
} from './op-log-backend.benchmark';

const TINY: OpLogBenchOptions = {
  opCounts: [5, 20],
  blobSizesKb: [1, 4],
  iterations: 2,
  appendSample: 5,
  tailOps: 3,
};

const sqlJsBackend = async (): Promise<BenchBackend> => {
  const adapter = new SqliteOpLogAdapter(await createSqlJsDb());
  await adapter.init();
  return {
    name: 'SQLite(sql.js)',
    adapter,
    teardown: async () => adapter.close(),
  };
};

describe('op-log backend benchmark harness', () => {
  it('produces median/p95 numbers for every measured op against a real SQLite engine', async () => {
    const result = await runOpLogBackendBench(
      [{ name: 'SQLite(sql.js)', make: sqlJsBackend }],
      TINY,
    );

    expect(result.backends.length).toBe(1);
    const b = result.backends[0];
    expect(b.error).toBeUndefined();

    // append latency measured
    expect(b.appendPerOpMs).toBeGreaterThanOrEqual(0);

    // one ops-count row per N, each with finite stats
    expect(b.opCounts.map((r) => r.n)).toEqual(TINY.opCounts);
    for (const r of b.opCounts) {
      expect(r.migrationMs).toBeGreaterThanOrEqual(0);
      for (const stat of [r.getAllFull, r.getOpsAfterSeqTail, r.getLastSeq]) {
        expect(Number.isFinite(stat.cold)).toBeTrue();
        expect(Number.isFinite(stat.median)).toBeTrue();
        expect(Number.isFinite(stat.p95)).toBeTrue();
      }
    }

    // one blob row per S, each with a finite read stat
    expect(b.blobs.map((r) => r.kb)).toEqual(TINY.blobSizesKb);
    for (const r of b.blobs) {
      expect(Number.isFinite(r.get.median)).toBeTrue();
    }
  });

  it('seeds exactly the requested op count into the ops table', async () => {
    const adapter = new SqliteOpLogAdapter(await createSqlJsDb());
    await adapter.init();
    try {
      await runOpLogBackendBench(
        [
          {
            name: 'x',
            make: async () => ({ name: 'x', adapter, teardown: async () => {} }),
          },
        ],
        { ...TINY, opCounts: [20], blobSizesKb: [] },
      );
      // After the last (and only) seeded N, the ops table holds exactly N rows.
      const all = await adapter.getAll(STORE_NAMES.OPS);
      expect(all.length).toBe(20);
    } finally {
      adapter.close();
    }
  });

  it('isolates a failing backend and still runs its teardown', async () => {
    let toreDown = false;
    const result = await runOpLogBackendBench(
      [
        {
          name: 'boom',
          make: async () => ({
            name: 'boom',
            // clear() is the first call benchOneBackend makes — throw there.
            adapter: {
              clear: () => Promise.reject(new Error('seed fail')),
            } as unknown as OpLogDbAdapter,
            teardown: async () => {
              toreDown = true;
            },
          }),
        },
      ],
      TINY,
    );

    expect(result.backends.length).toBe(1);
    expect(result.backends[0].error).toContain('seed fail');
    expect(toreDown).toBeTrue();
  });

  it('renders a markdown report without throwing', async () => {
    const result = await runOpLogBackendBench(
      [{ name: 'SQLite(sql.js)', make: sqlJsBackend }],
      { ...TINY, opCounts: [5], blobSizesKb: [1] },
    );
    const report = formatReport(result);
    expect(report).toContain('Op-log backend benchmark');
    expect(report).toContain('SQLite(sql.js)');
  });
});
