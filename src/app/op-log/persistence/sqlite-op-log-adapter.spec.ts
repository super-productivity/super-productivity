import {
  buildDdl,
  planTables,
  SqliteDb,
  SqliteOpLogAdapter,
} from './sqlite-op-log-adapter';
import { OpLogDbAdapter } from './op-log-db-adapter';
import { STORE_NAMES, OPS_INDEXES } from './db-keys.const';

/**
 * A small in-memory SQLite stand-in. It is NOT a real SQL engine — it models
 * just enough table semantics (autoinc PK, unique op_id, value + extracted
 * columns, BEGIN/COMMIT/ROLLBACK, WHERE/ORDER for the exact shapes this adapter
 * emits) to validate the adapter's behavior in Karma without a native build.
 *
 * A REAL SQLite engine (the @capacitor-community/sqlite path, or sql.js with a
 * served .wasm) should additionally exercise this adapter on-device — see the
 * note in docs/sync-and-op-log/sqlite-migration.md. This fake verifies the
 * translation layer (SQL/params/value-extraction/decode/tx ordering); it does
 * not re-verify SQLite itself.
 */
interface Row {
  [col: string]: string | number | null;
}

class FakeSqliteDb implements SqliteDb {
  private tables = new Map<string, Row[]>();
  private autoinc = new Map<string, number>();
  private uniqueCols = new Map<string, string[]>(); // table -> unique columns
  // Transaction snapshot for rollback.
  private snapshot: Map<string, Row[]> | null = null;
  /** Records every executed statement for assertion. */
  readonly log: { sql: string; params: unknown[] }[] = [];

  async run(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ changes: number; lastId?: number }> {
    this.log.push({ sql, params });
    const s = sql.trim();

    if (/^CREATE TABLE/i.test(s)) {
      const table = /CREATE TABLE IF NOT EXISTS (\w+)/i.exec(s)![1];
      if (!this.tables.has(table)) {
        this.tables.set(table, []);
        this.autoinc.set(table, 0);
      }
      return { changes: 0 };
    }
    if (/^CREATE (UNIQUE )?INDEX/i.test(s)) {
      const m = /ON (\w+)\(([^)]+)\)/i.exec(s)!;
      if (/UNIQUE/i.test(s)) {
        this.uniqueCols.set(
          m[1],
          m[2].split(',').map((c) => c.trim()),
        );
      }
      return { changes: 0 };
    }
    if (s === 'BEGIN IMMEDIATE' || s === 'BEGIN DEFERRED') {
      this.snapshot = new Map(
        [...this.tables].map(([t, rows]) => [t, rows.map((r) => ({ ...r }))]),
      );
      return { changes: 0 };
    }
    if (s === 'COMMIT') {
      this.snapshot = null;
      return { changes: 0 };
    }
    if (s === 'ROLLBACK') {
      if (this.snapshot) this.tables = this.snapshot;
      this.snapshot = null;
      return { changes: 0 };
    }
    if (/^INSERT INTO/i.test(s)) {
      return this.insert(s, params);
    }
    if (/^DELETE FROM/i.test(s)) {
      return this.delete(s, params);
    }
    throw new Error(`FakeSqliteDb.run: unsupported SQL: ${s}`);
  }

  async query(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    this.log.push({ sql, params });
    const s = sql.trim();
    if (/last_insert_rowid/i.test(s)) {
      return [{ id: this._lastId }];
    }
    const table = /FROM (\w+)/i.exec(s)![1];
    let rows = [...(this.tables.get(table) ?? [])];
    rows = this.applyWhere(rows, s, params);
    rows = this.applyOrder(rows, s);
    if (/SELECT COUNT\(\*\)/i.test(s)) {
      return [{ n: rows.length }];
    }
    if (/LIMIT 1/i.test(s)) {
      rows = rows.slice(0, 1);
    }
    // Project selected columns (value, seq AS k / __pk, key, etc.).
    return rows.map((r) => this.project(r, s));
  }

  private _lastId = 0;

  private insert(sql: string, params: unknown[]): { changes: number; lastId?: number } {
    const m = /INSERT INTO (\w+) \(([^)]+)\)/i.exec(sql)!;
    const table = m[1];
    const cols = m[2].split(',').map((c) => c.trim());
    const rows = this.tables.get(table)!;
    const row: Row = {};
    cols.forEach((c, i) => (row[c] = params[i] as string | number | null));

    const upsert = /ON CONFLICT/i.test(sql);
    const uniq = this.uniqueCols.get(table) ?? [];

    // Primary-key conflict. 'key' tables key on `key`; the autoinc (`ops`)
    // table keys on `seq` when one was supplied (a re-put / explicit-seq add).
    const pkCol = 'key' in row ? 'key' : 'seq' in row ? 'seq' : null;
    if (pkCol) {
      const existing = rows.find((r) => r[pkCol] === row[pkCol]);
      if (existing) {
        if (upsert) {
          Object.assign(existing, row);
          return { changes: 1, lastId: this._lastId };
        }
        throw new Error('UNIQUE constraint failed: primary key');
      }
    }
    // Unique index conflict (op_id).
    for (const uc of uniq) {
      if (row[uc] != null && rows.some((r) => r[uc] === row[uc])) {
        throw new Error(`UNIQUE constraint failed: ${table}.${uc}`);
      }
    }
    // AUTOINCREMENT semantics for the keyless `ops` table: an explicit seq is
    // honored and advances the high-water mark (so a later auto seq never
    // reuses it); an absent seq is assigned the next monotonic value.
    if (!('key' in row)) {
      if ('seq' in row) {
        const seq = row['seq'] as number;
        this.autoinc.set(table, Math.max(this.autoinc.get(table) ?? 0, seq));
        this._lastId = seq;
      } else {
        const next = (this.autoinc.get(table) ?? 0) + 1;
        this.autoinc.set(table, next);
        row['seq'] = next;
        this._lastId = next;
      }
    }
    rows.push(row);
    return { changes: 1, lastId: this._lastId };
  }

  private delete(sql: string, params: unknown[]): { changes: number } {
    const table = /DELETE FROM (\w+)/i.exec(sql)![1];
    const rows = this.tables.get(table)!;
    if (!/WHERE/i.test(sql)) {
      const n = rows.length;
      rows.length = 0;
      return { changes: n };
    }
    const before = rows.length;
    const kept = this.applyWhere(rows, sql, params, true);
    this.tables.set(table, kept);
    return { changes: before - kept.length };
  }

  /** Apply the single `col OP ?` / `a = ? AND b = ?` WHERE shapes we emit. */
  private applyWhere(rows: Row[], sql: string, params: unknown[], invert = false): Row[] {
    const w = /WHERE (.+?)(?: ORDER BY| LIMIT|$)/i.exec(sql);
    if (!w) return rows;
    const conds = w[1].split(/ AND /i).map((c) => c.trim());
    let pi = 0;
    const test = (r: Row): boolean =>
      conds.every((cond) => {
        const mm = /(\w+) (>=|<=|>|<|=) \?/.exec(cond)!;
        const [, col, op] = mm;
        const val = params[pi++] as string | number | null;
        const cell = r[col];
        switch (op) {
          case '=':
            return cell === val;
          case '>':
            return (cell as number) > (val as number);
          case '>=':
            return (cell as number) >= (val as number);
          case '<':
            return (cell as number) < (val as number);
          case '<=':
            return (cell as number) <= (val as number);
          default:
            return false;
        }
      });
    return rows.filter((r) => {
      pi = 0;
      const ok = test(r);
      return invert ? !ok : ok;
    });
  }

  private applyOrder(rows: Row[], sql: string): Row[] {
    const o = /ORDER BY (.+?)(?: LIMIT|$)/i.exec(sql);
    if (!o) return rows;
    const terms = o[1].split(',').map((t) => t.trim());
    return [...rows].sort((a, b) => {
      for (const term of terms) {
        const [col, dir] = term.split(/\s+/);
        const av = a[col] as number;
        const bv = b[col] as number;
        if (av !== bv) return (av < bv ? -1 : 1) * (dir === 'DESC' ? -1 : 1);
      }
      return 0;
    });
  }

  private project(r: Row, sql: string): Row {
    const sel = /SELECT (.+?) FROM/i.exec(sql)![1];
    if (sel.includes('*')) return { ...r };
    const out: Row = {};
    for (const part of sel.split(',').map((p) => p.trim())) {
      const asMatch = /(\w+) AS (\w+)/i.exec(part);
      if (asMatch) out[asMatch[2]] = r[asMatch[1]];
      else out[part] = r[part];
    }
    return out;
  }
}

describe('SqliteOpLogAdapter', () => {
  let db: FakeSqliteDb;
  let adapter: SqliteOpLogAdapter;

  const makeOpEntry = (
    id: string,
    source: 'local' | 'remote',
    applicationStatus?: 'pending' | 'applied' | 'failed',
    syncedAt?: number,
  ): Record<string, unknown> => ({
    op: { id },
    appliedAt: Date.now(),
    source,
    syncedAt,
    applicationStatus,
  });

  beforeEach(async () => {
    db = new FakeSqliteDb();
    adapter = new SqliteOpLogAdapter(db);
    await adapter.init();
  });

  // ── schema mapping / DDL (pure) ────────────────────────────────────────────

  it('plans one table per store and maps store kinds correctly', () => {
    const plans = planTables();
    expect(plans.map((p) => p.table).sort()).toEqual(Object.values(STORE_NAMES).sort());
    expect(plans.find((p) => p.table === STORE_NAMES.OPS)!.primaryKey).toBe('autoinc');
    expect(plans.find((p) => p.table === STORE_NAMES.STATE_CACHE)!.keyJsonPath).toBe(
      '$.id',
    );
    expect(
      plans.find((p) => p.table === STORE_NAMES.VECTOR_CLOCK)!.keyJsonPath,
    ).toBeUndefined();
  });

  it('buildDdl emits AUTOINCREMENT, a UNIQUE byId index and the composite index', () => {
    const ddl = buildDdl(planTables().find((p) => p.table === STORE_NAMES.OPS)!);
    expect(ddl.some((s) => /seq INTEGER PRIMARY KEY AUTOINCREMENT/.test(s))).toBeTrue();
    expect(ddl.some((s) => /CREATE UNIQUE INDEX.*op_id/.test(s))).toBeTrue();
    expect(ddl.some((s) => /\(source, application_status\)/.test(s))).toBeTrue();
  });

  it('init applies one CREATE TABLE per store plus the ops indexes', () => {
    const creates = db.log.filter((e) => /^CREATE TABLE/i.test(e.sql));
    expect(creates.length).toBe(Object.values(STORE_NAMES).length);
    expect(db.log.some((e) => /CREATE UNIQUE INDEX.*op_id/i.test(e.sql))).toBeTrue();
  });

  // ── value extraction: the INSERT carries the extracted index columns ───────

  it('add() extracts op_id/source/applicationStatus/synced_at into columns', async () => {
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('x', 'remote', 'pending', 1234));
    const insert = db.log.find((e) => /^INSERT INTO ops/i.test(e.sql))!;
    expect(insert.sql).toContain('op_id');
    expect(insert.sql).toContain('application_status');
    // value JSON + extracted columns are passed as params.
    expect(insert.params).toContain('x'); // op_id
    expect(insert.params).toContain('remote'); // source
    expect(insert.params).toContain('pending'); // application_status
    expect(insert.params).toContain(1234); // synced_at
  });

  // ── CRUD against the in-memory model ───────────────────────────────────────

  it('add() auto-increments seq and get() round-trips the JSON value', async () => {
    const s1 = await adapter.add(STORE_NAMES.OPS, makeOpEntry('a', 'local'));
    const s2 = await adapter.add(STORE_NAMES.OPS, makeOpEntry('b', 'local'));
    expect(s2).toBe(s1 + 1);
    const got = await adapter.get<{ op: { id: string } }>(STORE_NAMES.OPS, s1);
    expect(got?.op.id).toBe('a');
  });

  it('seq keeps climbing after clear() (AUTOINCREMENT, never reused)', async () => {
    const s1 = await adapter.add(STORE_NAMES.OPS, makeOpEntry('a', 'local'));
    await adapter.clear(STORE_NAMES.OPS);
    const s2 = await adapter.add(STORE_NAMES.OPS, makeOpEntry('b', 'local'));
    expect(s2).toBeGreaterThan(s1);
  });

  it('put()/get() works for a keyPath store (state_cache, key from $.id)', async () => {
    await adapter.put(STORE_NAMES.STATE_CACHE, { id: 'current', state: { x: 1 } });
    const got = await adapter.get<{ state: { x: number } }>(
      STORE_NAMES.STATE_CACHE,
      'current',
    );
    expect(got?.state.x).toBe(1);
  });

  it('put() upserts a keyless singleton under an explicit key', async () => {
    await adapter.put(STORE_NAMES.VECTOR_CLOCK, { clock: { a: 1 } }, 'current');
    await adapter.put(STORE_NAMES.VECTOR_CLOCK, { clock: { a: 2 } }, 'current');
    const vc = await adapter.get<{ clock: Record<string, number> }>(
      STORE_NAMES.VECTOR_CLOCK,
      'current',
    );
    expect(vc?.clock['a']).toBe(2);
    expect(await adapter.count(STORE_NAMES.VECTOR_CLOCK)).toBe(1);
  });

  it('enforces the unique byId index, surfacing a ConstraintError', async () => {
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('dup', 'local'));
    await expectAsync(
      adapter.add(STORE_NAMES.OPS, makeOpEntry('dup', 'local')),
    ).toBeRejectedWith(jasmine.objectContaining({ name: 'ConstraintError' }));
  });

  it('get() / getFromIndex() return undefined on a miss', async () => {
    expect(await adapter.get(STORE_NAMES.OPS, 999)).toBeUndefined();
    expect(
      await adapter.getFromIndex(STORE_NAMES.OPS, OPS_INDEXES.BY_ID, 'absent'),
    ).toBeUndefined();
  });

  // ── indexes & ranges ───────────────────────────────────────────────────────

  it('getFromIndex(byId) / getKeyFromIndex resolve to the row and its seq', async () => {
    const seq = await adapter.add(STORE_NAMES.OPS, makeOpEntry('probe', 'local'));
    const row = await adapter.getFromIndex<{ op: { id: string } }>(
      STORE_NAMES.OPS,
      OPS_INDEXES.BY_ID,
      'probe',
    );
    expect(row?.op.id).toBe('probe');
    expect(
      await adapter.getKeyFromIndex(STORE_NAMES.OPS, OPS_INDEXES.BY_ID, 'probe'),
    ).toBe(seq);
    expect(
      await adapter.getKeyFromIndex(STORE_NAMES.OPS, OPS_INDEXES.BY_ID, 'nope'),
    ).toBeUndefined();
  });

  it('getAll with a primary-key range filters by seq (getOpsAfterSeq pattern)', async () => {
    const s1 = await adapter.add(STORE_NAMES.OPS, makeOpEntry('a', 'local'));
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('b', 'local'));
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('c', 'local'));
    const after = await adapter.getAll<{ op: { id: string } }>(STORE_NAMES.OPS, {
      lower: s1,
      lowerOpen: true,
    });
    expect(after.map((r) => r.op.id)).toEqual(['b', 'c']);
  });

  it('getAllFromIndex matches a compound-index exact key (bySourceAndStatus)', async () => {
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('p1', 'remote', 'pending'));
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('a1', 'remote', 'applied'));
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('p2', 'remote', 'pending'));
    const pending = await adapter.getAllFromIndex<{ op: { id: string } }>(
      STORE_NAMES.OPS,
      OPS_INDEXES.BY_SOURCE_AND_STATUS,
      { lower: ['remote', 'pending'], upper: ['remote', 'pending'] },
    );
    expect(pending.map((r) => r.op.id).sort()).toEqual(['p1', 'p2']);
  });

  it('count reflects a primary-key range; countFromIndex an index match', async () => {
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('a', 'remote', 'pending'));
    const s2 = await adapter.add(STORE_NAMES.OPS, makeOpEntry('b', 'remote', 'applied'));
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('c', 'remote', 'pending'));
    expect(await adapter.count(STORE_NAMES.OPS)).toBe(3);
    expect(await adapter.count(STORE_NAMES.OPS, { lower: s2 })).toBe(2);
    expect(
      await adapter.countFromIndex(STORE_NAMES.OPS, OPS_INDEXES.BY_SOURCE_AND_STATUS, {
        lower: ['remote', 'pending'],
        upper: ['remote', 'pending'],
      }),
    ).toBe(2);
  });

  // ── cursor iteration ───────────────────────────────────────────────────────

  it('iterate(prev) walks descending and exposes the primary key', async () => {
    const s1 = await adapter.add(STORE_NAMES.OPS, makeOpEntry('a', 'local'));
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('b', 'local'));
    const s3 = await adapter.add(STORE_NAMES.OPS, makeOpEntry('c', 'local'));
    const seen: Array<{ id: string; key: number }> = [];
    await adapter.iterate<{ op: { id: string } }>(
      STORE_NAMES.OPS,
      { direction: 'prev', mode: 'readonly' },
      (v, key) => {
        seen.push({ id: v.op.id, key: key as number });
        return 'continue';
      },
    );
    expect(seen.map((x) => x.id)).toEqual(['c', 'b', 'a']);
    expect(seen[0].key).toBe(s3);
    expect(seen[2].key).toBe(s1);
  });

  it('readonly iterate does not open a transaction', async () => {
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('a', 'local'));
    db.log.length = 0;
    await adapter.iterate<{ op: { id: string } }>(
      STORE_NAMES.OPS,
      { mode: 'readonly' },
      () => 'continue',
    );
    expect(db.log.some((e) => /^BEGIN/i.test(e.sql))).toBeFalse();
  });

  it("iterate 'delete' prunes matching rows in a transaction", async () => {
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('keep1', 'local'));
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('drop', 'remote'));
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('keep2', 'local'));
    await adapter.iterate<{ op: { id: string }; source: string }>(
      STORE_NAMES.OPS,
      {},
      (v) => (v.source === 'remote' ? 'delete' : 'continue'),
    );
    expect(
      (await adapter.getAll<{ op: { id: string } }>(STORE_NAMES.OPS))
        .map((r) => r.op.id)
        .sort(),
    ).toEqual(['keep1', 'keep2']);
  });

  it("iterate 'delete-stop' over an index at an exact key removes one entry", async () => {
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('alpha', 'local'));
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('beta', 'local'));
    const seen: string[] = [];
    await adapter.iterate<{ op: { id: string } }>(
      STORE_NAMES.OPS,
      { index: OPS_INDEXES.BY_ID, query: 'beta' },
      (v) => {
        seen.push(v.op.id);
        return 'delete-stop';
      },
    );
    expect(seen).toEqual(['beta']);
    expect(
      (await adapter.getAll<{ op: { id: string } }>(STORE_NAMES.OPS)).map((r) => r.op.id),
    ).toEqual(['alpha']);
  });

  // ── transactions: commit / rollback ────────────────────────────────────────

  it('transaction commits a multi-store write atomically (BEGIN…COMMIT)', async () => {
    await adapter.transaction(
      [STORE_NAMES.OPS, STORE_NAMES.VECTOR_CLOCK],
      'readwrite',
      async (tx) => {
        await tx.add(STORE_NAMES.OPS, makeOpEntry('tx', 'local'));
        await tx.put(STORE_NAMES.VECTOR_CLOCK, { clock: { c: 1 } }, 'current');
      },
    );
    expect(db.log.some((e) => e.sql === 'BEGIN IMMEDIATE')).toBeTrue();
    expect(db.log.some((e) => e.sql === 'COMMIT')).toBeTrue();
    expect(
      (
        await adapter.getFromIndex<{ op: { id: string } }>(
          STORE_NAMES.OPS,
          OPS_INDEXES.BY_ID,
          'tx',
        )
      )?.op.id,
    ).toBe('tx');
  });

  it('transaction rolls back a destructive clear()+delete() on throw', async () => {
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('survivor1', 'local'));
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('survivor2', 'local'));
    await adapter.put(STORE_NAMES.VECTOR_CLOCK, { clock: { keep: 7 } }, 'current');

    await expectAsync(
      adapter.transaction(
        [STORE_NAMES.OPS, STORE_NAMES.VECTOR_CLOCK],
        'readwrite',
        async (tx) => {
          await tx.clear(STORE_NAMES.OPS);
          await tx.delete(STORE_NAMES.VECTOR_CLOCK, 'current');
          await tx.add(STORE_NAMES.OPS, makeOpEntry('newBaseline', 'local'));
          throw new Error('interrupted');
        },
      ),
    ).toBeRejectedWithError('interrupted');

    expect(db.log.some((e) => e.sql === 'ROLLBACK')).toBeTrue();
    expect(
      (await adapter.getAll<{ op: { id: string } }>(STORE_NAMES.OPS))
        .map((o) => o.op.id)
        .sort(),
    ).toEqual(['survivor1', 'survivor2']);
    expect(
      (
        await adapter.get<{ clock: Record<string, number> }>(
          STORE_NAMES.VECTOR_CLOCK,
          'current',
        )
      )?.clock['keep'],
    ).toBe(7);
  });

  it('transaction aborts on an inner UNIQUE violation, mapping to ConstraintError', async () => {
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('dup', 'local'));
    await expectAsync(
      adapter.transaction([STORE_NAMES.OPS], 'readwrite', async (tx) => {
        await tx.add(STORE_NAMES.OPS, makeOpEntry('fresh', 'local'));
        await tx.add(STORE_NAMES.OPS, makeOpEntry('dup', 'local'));
      }),
    ).toBeRejectedWith(jasmine.objectContaining({ name: 'ConstraintError' }));
    expect(
      await adapter.getFromIndex(STORE_NAMES.OPS, OPS_INDEXES.BY_ID, 'fresh'),
    ).toBeUndefined();
  });

  it('exposes transactional reads, index reads and cursor iteration', async () => {
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('r1', 'remote', 'pending'));
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('r2', 'remote', 'pending'));
    const out = await adapter.transaction([STORE_NAMES.OPS], 'readwrite', async (tx) => {
      const byId = await tx.getFromIndex<{ op: { id: string } }>(
        STORE_NAMES.OPS,
        OPS_INDEXES.BY_ID,
        'r1',
      );
      const all = await tx.getAll<{ op: { id: string } }>(STORE_NAMES.OPS);
      const ids: string[] = [];
      await tx.iterate<{ op: { id: string } }>(STORE_NAMES.OPS, {}, (v) => {
        ids.push(v.op.id);
        return 'continue';
      });
      return { byId: byId?.op.id, count: all.length, ids: ids.sort() };
    });
    expect(out).toEqual({ byId: 'r1', count: 2, ids: ['r1', 'r2'] });
  });

  // ── autoinc seq round-trip + in-place update (the mark*/clearUnsynced path) ─

  it('reads of the ops table carry their seq (the autoinc PK), like IDB', async () => {
    const seq = await adapter.add(STORE_NAMES.OPS, makeOpEntry('s', 'local'));
    const got = await adapter.get<{ seq: number }>(STORE_NAMES.OPS, seq);
    expect(got?.seq).toBe(seq);
    const fromIndex = await adapter.getFromIndex<{ seq: number }>(
      STORE_NAMES.OPS,
      OPS_INDEXES.BY_ID,
      's',
    );
    expect(fromIndex?.seq).toBe(seq);
  });

  it('put() on the ops table updates in place by seq, not inserting a duplicate', async () => {
    const seq = await adapter.add(STORE_NAMES.OPS, makeOpEntry('m', 'remote', 'pending'));
    // The mark*/clearUnsynced flow: read the entry, mutate it, put it back.
    const entry = await adapter.get<Record<string, unknown>>(STORE_NAMES.OPS, seq);
    entry!['applicationStatus'] = 'applied';
    await adapter.put(STORE_NAMES.OPS, entry);
    expect(await adapter.count(STORE_NAMES.OPS)).toBe(1);
    const after = await adapter.get<{ applicationStatus: string }>(STORE_NAMES.OPS, seq);
    expect(after?.applicationStatus).toBe('applied');
  });

  // ── port-contract hardening: readonly-delete + transaction store scope ──────

  it('iterate under mode:readonly rejects a delete action and does not mutate', async () => {
    await adapter.add(STORE_NAMES.OPS, makeOpEntry('a', 'local'));
    await expectAsync(
      adapter.iterate<{ op: { id: string } }>(
        STORE_NAMES.OPS,
        { mode: 'readonly' },
        () => 'delete',
      ),
    ).toBeRejectedWith(jasmine.objectContaining({ name: 'ReadOnlyError' }));
    expect(await adapter.count(STORE_NAMES.OPS)).toBe(1);
  });

  it('transaction rejects touching a store outside its declared scope', async () => {
    await expectAsync(
      adapter.transaction([STORE_NAMES.OPS], 'readwrite', async (tx) => {
        await tx.put(STORE_NAMES.VECTOR_CLOCK, { clock: { a: 1 } }, 'current');
      }),
    ).toBeRejectedWithError(/outside this transaction's declared scope/);
    expect(db.log.some((e) => e.sql === 'ROLLBACK')).toBeTrue();
  });

  it('does not implement adoptConnection (SQLite self-manages its handle)', () => {
    expect((adapter as OpLogDbAdapter).adoptConnection).toBeUndefined();
  });
});
