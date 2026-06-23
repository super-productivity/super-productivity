/**
 * On-device A/B benchmark for the op-log persistence backend: native SQLite
 * (`@capacitor-community/sqlite`) vs WebView IndexedDB, measured at the
 * {@link OpLogDbAdapter} layer for the operations boot hydration actually
 * performs. See docs/plans/2026-06-23-oplog-sqlite-benchmark-handover.md.
 *
 * WHY ON-DEVICE: the suspected slowdown is the JS↔native bridge (every SQLite
 * result is serialized to JSON natively, shipped across, and `JSON.parse`d in
 * JS). That bridge does not exist off-device — Karma runs SQLite over sql.js
 * (in-process WASM), which understates the real cost. So a Karma/sql.js run can
 * only catch *algorithmic* regressions; the "is SQLite slower than IDB on a
 * phone, and by how much vs op-count / blob-size" question can only be answered
 * here, on the device.
 *
 * DEV-ONLY: invoked via `window.__benchOpLog()` (wired in src/main.ts behind the
 * `!environment.production && !environment.stage` guard, loaded by a dynamic
 * `import()` so this module — and the SQLite plugin it pulls in — never enters
 * the eager/production bundle). The `.benchmark.ts` suffix also exempts it from
 * the `no-console` rule (it intentionally dumps timing numbers to stdout) and
 * keeps Karma from auto-running it.
 *
 * SAFETY: synthetic data only (so logging it freely cannot leak user content),
 * and bench-only DB names (`SUP_OPS_BENCH*`) so the authoritative `SUP_OPS` is
 * never touched. Both bench DBs are deleted on teardown.
 */
import { OpLogDbAdapter } from './op-log-db-adapter';
import { SqliteOpLogAdapter } from './sqlite-op-log-adapter';
import { CapacitorSqliteDb } from './capacitor-sqlite-db';
import { IndexedDbOpLogAdapter } from './indexed-db-op-log-adapter';
import { OP_LOG_DB_SCHEMA } from './op-log-db-schema';
import { shouldUseNativeSqliteOpLogBackend } from './native-sqlite-backend';
import { SINGLETON_KEY, STORE_NAMES } from './db-keys.const';
import { ActionType, EntityType, Operation, OpType } from '../core/operation.types';
import { uuidv7 } from '../../util/uuid-v7';

const PREFIX = '[opLogBench]';
const SQLITE_BENCH_DB = 'SUP_OPS_BENCH';
const IDB_BENCH_DB = 'SUP_OPS_BENCH_IDB';

/** Progress line to the console (synthetic data → safe to log freely). */
const log = (msg: string): void => console.log(`${PREFIX} ${msg}`);

// ── options & result shapes ──────────────────────────────────────────────────

export interface OpLogBenchOptions {
  /** Op-count sweep — drives the ops-table read measurements + migration cost. */
  readonly opCounts: number[];
  /** State-cache blob sizes in KB — drives the blob-read (loadStateCache) sweep. */
  readonly blobSizesKb: number[];
  /** Warm iterations per read measurement (one cold run precedes these). */
  readonly iterations: number;
  /** Sample size for the per-op append (autocommit) latency measurement. */
  readonly appendSample: number;
  /** Tail size for the "typical boot delta" getOpsAfterSeq read. */
  readonly tailOps: number;
}

export const DEFAULT_BENCH_OPTIONS: OpLogBenchOptions = {
  opCounts: [1_000, 10_000, 50_000],
  blobSizesKb: [100, 1_024, 5_120],
  iterations: 5,
  appendSample: 200,
  tailOps: 100,
};

/** Median + p95 over the warm samples, plus the discarded cold first run. */
export interface Stat {
  readonly cold: number;
  readonly median: number;
  readonly p95: number;
}

export interface OpsCountResult {
  readonly n: number;
  /** Single-sample bulk insert in one transaction — the one-time migration cost. */
  readonly migrationMs: number;
  /** Full-table read (`getAll(OPS)`) — worst case: no/corrupt snapshot → replay all. */
  readonly getAllFull: Stat;
  /** `getOpsAfterSeq(lastSeq - tailOps)` — the typical boot delta. */
  readonly getOpsAfterSeqTail: Stat;
  /** `iterate prev limit:1` — the O(1) hot-path max-seq read. */
  readonly getLastSeq: Stat;
}

export interface BlobResult {
  readonly kb: number;
  /** `get(STATE_CACHE)` — the multi-MB snapshot blob read (suspect #1). */
  readonly get: Stat;
}

export interface BackendResult {
  readonly name: string;
  /** Per-op autocommit append latency (the real `append()` hot path). */
  readonly appendPerOpMs?: number;
  readonly opCounts: OpsCountResult[];
  readonly blobs: BlobResult[];
  /** Set when the backend threw (e.g. SQLite unavailable on a non-qualifying device). */
  readonly error?: string;
}

export interface OpLogBenchResult {
  readonly backends: BackendResult[];
  readonly options: OpLogBenchOptions;
}

/** One backend under test, plus its teardown (delete the throwaway bench DB). */
export interface BenchBackend {
  readonly name: string;
  readonly adapter: OpLogDbAdapter;
  readonly teardown: () => Promise<void>;
}
export type BenchBackendFactory = () => Promise<BenchBackend>;

// ── stats & timing (pure) ────────────────────────────────────────────────────

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const percentile = (xs: number[], p: number): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * s.length) - 1;
  return s[Math.min(s.length - 1, Math.max(0, idx))];
};

const timeOnce = async (fn: () => Promise<unknown>): Promise<number> => {
  const start = performance.now();
  await fn();
  return performance.now() - start;
};

/** Run `fn` once (cold, discarded from the stats) then `iterations` warm times. */
const measure = async (fn: () => Promise<unknown>, iterations: number): Promise<Stat> => {
  const cold = await timeOnce(fn);
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    samples.push(await timeOnce(fn));
  }
  return { cold, median: median(samples), p95: percentile(samples, 95) };
};

// ── synthetic data ───────────────────────────────────────────────────────────

const makeOp = (i: number): Operation => ({
  id: uuidv7(),
  actionType: '[Bench] Op' as ActionType,
  opType: OpType.Update,
  entityType: 'TASK' as EntityType,
  entityId: `bench-${i}`,
  payload: { title: `Bench task ${i}`, description: 'synthetic benchmark payload' },
  clientId: 'benchClient',
  vectorClock: { benchClient: i },
  timestamp: Date.now() + i,
  schemaVersion: 1,
});

/** A stored ops entry shaped like OperationLogStoreService writes (minus `seq`). */
const makeEntry = (i: number): unknown => ({
  op: makeOp(i),
  appliedAt: Date.now(),
  source: 'local',
});

/**
 * A structured synthetic object whose JSON size is ~`targetBytes`. Built from
 * many small records (not one giant string) so its `JSON.parse` cost is closer
 * to a real state-cache snapshot than a string-dominated blob would be.
 */
const makeBlob = (targetBytes: number): { items: unknown[] } => {
  const items: { id: string; v: number; s: string }[] = [];
  let size = 12; // approx the {"items":[]} wrapper overhead
  let i = 0;
  while (size < targetBytes) {
    const rec = { id: `e${i}`, v: i, s: 'synthetic-state-cache-field-payload' };
    items.push(rec);
    size += JSON.stringify(rec).length + 1;
    i++;
  }
  return { items };
};

// ── adapter helpers ──────────────────────────────────────────────────────────

/**
 * Seed `n` ops in ONE transaction (BEGIN/COMMIT) — mirrors migrateOpLogBackend,
 * so the elapsed time is the honest one-time migration cost (n bridge crossings
 * within a single transaction) and the same rows back the read measurements.
 */
const seedOps = async (adapter: OpLogDbAdapter, n: number): Promise<number> => {
  const start = performance.now();
  await adapter.transaction([STORE_NAMES.OPS], 'readwrite', async (tx) => {
    for (let i = 0; i < n; i++) {
      await tx.add(STORE_NAMES.OPS, makeEntry(i));
    }
  });
  return performance.now() - start;
};

/** Highest ops `seq` via the same `iterate prev limit:1` path as getLastSeq(). */
const readLastSeq = async (adapter: OpLogDbAdapter): Promise<number> => {
  let last = 0;
  await adapter.iterate<unknown>(
    STORE_NAMES.OPS,
    { direction: 'prev', mode: 'readonly', limit: 1 },
    (_value, key) => {
      last = key as number;
      return 'stop';
    },
  );
  return last;
};

const benchOneBackend = async (
  backend: BenchBackend,
  o: OpLogBenchOptions,
): Promise<BackendResult> => {
  const { adapter, name } = backend;

  // 1. Per-op append latency — the real append() hot path (one autocommit add
  //    per op = one bridge round-trip on SQLite). Roughly N-independent, so
  //    measured once on an empty ops table.
  await adapter.clear(STORE_NAMES.OPS);
  const appendStart = performance.now();
  for (let i = 0; i < o.appendSample; i++) {
    await adapter.add(STORE_NAMES.OPS, makeEntry(i));
  }
  const appendPerOpMs = (performance.now() - appendStart) / Math.max(1, o.appendSample);
  log(`${name}: append ${o.appendSample} ops → ${appendPerOpMs.toFixed(3)} ms/op`);

  // 2. Ops-table reads across the op-count sweep.
  const opCounts: OpsCountResult[] = [];
  for (const n of o.opCounts) {
    await adapter.clear(STORE_NAMES.OPS);
    log(`${name}: seeding ${n} ops...`);
    const migrationMs = await seedOps(adapter, n);
    const lastSeq = await readLastSeq(adapter);
    const tailLower = Math.max(0, lastSeq - o.tailOps);
    opCounts.push({
      n,
      migrationMs,
      getAllFull: await measure(() => adapter.getAll(STORE_NAMES.OPS), o.iterations),
      getOpsAfterSeqTail: await measure(
        () => adapter.getAll(STORE_NAMES.OPS, { lower: tailLower, lowerOpen: true }),
        o.iterations,
      ),
      getLastSeq: await measure(() => readLastSeq(adapter), o.iterations),
    });
    log(`${name}: N=${n} done (migration ${migrationMs.toFixed(0)}ms)`);
  }

  // 3. State-cache blob reads across the blob-size sweep (loadStateCache).
  const blobs: BlobResult[] = [];
  for (const kb of o.blobSizesKb) {
    await adapter.put(STORE_NAMES.STATE_CACHE, {
      id: SINGLETON_KEY,
      state: makeBlob(kb * 1024),
      lastAppliedOpSeq: 0,
      vectorClock: {},
      compactedAt: 0,
    });
    blobs.push({
      kb,
      get: await measure(
        () => adapter.get(STORE_NAMES.STATE_CACHE, SINGLETON_KEY),
        o.iterations,
      ),
    });
    log(`${name}: blob ${kb}KB done`);
  }

  return { name, appendPerOpMs, opCounts, blobs };
};

// ── runner ───────────────────────────────────────────────────────────────────

/**
 * Run the benchmark over the given backends. Each backend is isolated: a failure
 * (e.g. SQLite unavailable on a non-qualifying device) is recorded and the run
 * continues; teardown always runs. Pure of any platform specifics so it can be
 * driven in Karma with a sql.js backend.
 */
export const runOpLogBackendBench = async (
  factories: ReadonlyArray<{ name: string; make: BenchBackendFactory }>,
  options: OpLogBenchOptions = DEFAULT_BENCH_OPTIONS,
): Promise<OpLogBenchResult> => {
  const backends: BackendResult[] = [];
  for (const f of factories) {
    log(`=== ${f.name} ===`);
    let backend: BenchBackend | undefined;
    try {
      backend = await f.make();
      backends.push(await benchOneBackend(backend, options));
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      log(`${f.name} failed: ${msg}`);
      backends.push({ name: f.name, opCounts: [], blobs: [], error: msg });
    } finally {
      if (backend) {
        try {
          await backend.teardown();
        } catch (e) {
          log(`${f.name} teardown failed: ${e instanceof Error ? e.name : String(e)}`);
        }
      }
    }
  }
  return { backends, options };
};

// ── report ───────────────────────────────────────────────────────────────────

const ms1 = (n: number): string => n.toFixed(1);
const ms3 = (n: number): string => n.toFixed(3);
const cell = (s: Stat): string => `${ms1(s.median)} / ${ms1(s.p95)}`;

/** Render the result as markdown tables to the console (chrome://inspect / logcat). */
export const formatReport = (result: OpLogBenchResult): string => {
  const o = result.options;
  const lines: string[] = [
    '',
    '# Op-log backend benchmark (on-device A/B)',
    '',
    `Params: iterations=${o.iterations} warm (+1 cold discarded), ` +
      `appendSample=${o.appendSample}, tailOps=${o.tailOps}`,
    'Read cells are **median / p95 ms** over warm iterations. Synthetic data.',
    '',
    '## Append latency (per op, autocommit — the append() hot path)',
    '',
    '| Backend | ms/op |',
    '|---|---|',
  ];
  for (const b of result.backends) {
    lines.push(`| ${b.name} | ${b.error ? 'ERROR' : ms3(b.appendPerOpMs ?? 0)} |`);
  }

  lines.push(
    '',
    '## Ops-table reads & one-time migration cost (by op count N)',
    '',
    '| Backend | N | migration (ms) | getAll full | getOpsAfterSeq tail | getLastSeq |',
    '|---|---|---|---|---|---|',
  );
  for (const b of result.backends) {
    if (b.error) {
      lines.push(`| ${b.name} | — | ERROR: ${b.error} |  |  |  |`);
      continue;
    }
    for (const r of b.opCounts) {
      lines.push(
        `| ${b.name} | ${r.n} | ${ms1(r.migrationMs)} | ${cell(r.getAllFull)} | ` +
          `${cell(r.getOpsAfterSeqTail)} | ${cell(r.getLastSeq)} |`,
      );
    }
  }

  lines.push(
    '',
    '## State-cache blob read (loadStateCache — suspect #1) (by blob size S)',
    '',
    '| Backend | blob size | get (median / p95 ms) |',
    '|---|---|---|',
  );
  for (const b of result.backends) {
    if (b.error) continue;
    for (const r of b.blobs) {
      lines.push(`| ${b.name} | ${r.kb} KB | ${cell(r.get)} |`);
    }
  }
  lines.push('');
  return lines.join('\n');
};

// ── device entry point ───────────────────────────────────────────────────────

const makeSqliteBackend: BenchBackendFactory = async () => {
  // Guard against a misleading off-device run: the plugin's WEB build is
  // WASM-SQLite persisted into IndexedDB (no native bridge), so benchmarking it
  // on desktop/web would compare the wrong thing. Fail clearly instead — the
  // runner records this as the SQLite row's error while IndexedDB still runs.
  if (!shouldUseNativeSqliteOpLogBackend()) {
    throw new Error(
      'native SQLite backend not available on this platform — run __benchOpLog() ' +
        'on a real Capacitor Android device',
    );
  }
  const db = new CapacitorSqliteDb(SQLITE_BENCH_DB);
  const adapter = new SqliteOpLogAdapter(db);
  await adapter.init();
  return {
    name: 'SQLite',
    adapter,
    teardown: async () => {
      adapter.close();
      await db.deleteDatabase();
    },
  };
};

const makeIdbBackend: BenchBackendFactory = async () => {
  const adapter = new IndexedDbOpLogAdapter({ ...OP_LOG_DB_SCHEMA, name: IDB_BENCH_DB });
  await adapter.init();
  return {
    name: 'IndexedDB',
    adapter,
    teardown: async () => {
      adapter.close();
      await deleteIdbDatabase(IDB_BENCH_DB);
    },
  };
};

const deleteIdbDatabase = (name: string): Promise<void> =>
  new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });

/**
 * Dev-only entry point — exposed as `window.__benchOpLog()`. Runs the A/B
 * benchmark on real native SQLite vs IndexedDB, prints the markdown report, and
 * returns the structured result for further inspection from the console.
 */
export const benchOpLog = async (
  opts: Partial<OpLogBenchOptions> = {},
): Promise<OpLogBenchResult> => {
  const options: OpLogBenchOptions = { ...DEFAULT_BENCH_OPTIONS, ...opts };
  const result = await runOpLogBackendBench(
    [
      { name: 'SQLite', make: makeSqliteBackend },
      { name: 'IndexedDB', make: makeIdbBackend },
    ],
    options,
  );
  console.log(formatReport(result));
  return result;
};
