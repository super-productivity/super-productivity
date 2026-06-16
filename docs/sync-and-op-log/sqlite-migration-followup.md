# SQLite Migration — Follow-up Plan

Companion to [`sqlite-migration.md`](./sqlite-migration.md). That doc holds the
architecture and the per-phase design; this one is the **actionable backlog**
of what remains after the work on branch `claude/issue-7892-root-cause-KY1ED`,
ordered so each item is independently shippable and reviewable.

## Where we are now

- ✅ `OpLogDbAdapter` / `OpLogTx` port + declarative `OP_LOG_DB_SCHEMA`.
- ✅ `IndexedDbOpLogAdapter` (faithful `idb` backend) — the live backend.
- ✅ `OperationLogStoreService` + `ArchiveStoreService` fully routed through the
  port (no direct `this.db`), behind a DI factory token
  (`OP_LOG_DB_ADAPTER_FACTORY`), IndexedDB-backed on every platform today.
- ✅ `SqliteOpLogAdapter` fully implemented against a minimal `SqliteDb` port.
  **Not wired to any platform; no native plugin dependency.**
- ✅ **Validated against a real SQLite engine (sql.js).** `sql.js` is served into
  Karma (dev-only; never in the app bundle) and the adapter's behavioral
  contract runs against both the in-memory fake and real SQLite
  (`sqlite-op-log-adapter.spec.ts`), plus a store-level second pass through
  `OperationLogStoreService` (`remote-apply-store-port.integration.spec.ts`).
  Confirms the real `UNIQUE constraint failed` → `ConstraintError` mapping,
  `AUTOINCREMENT`-after-`clear()`, compound-index + NULL ranges, and real
  `BEGIN IMMEDIATE` rollback. **(B2 translation-layer + store-port passes; the
  on-device real-engine run still remains.)**
- ✅ **C1 backend migration implemented + tested** (`op-log-backend-migration.ts`):
  whole-DB copy from any source adapter to any dest adapter in one dest
  transaction with verify-before-commit (op count + last `seq` + vector clock;
  mismatch → rollback). Validated real-Chrome-IDB → sql.js. **Not wired into
  startup** — B3/C2 decide when to run it.
- ✅ **Backend-aware store init (B3, partial).** `OperationLogStoreService.init()`
  / `ArchiveStoreService._init()` now call `adapter.init()` and skip the IDB open
  for self-managing backends (no `adoptConnection`); the IndexedDB path is
  unchanged. Dead in production until the native token flip. Only the device-gated
  token override + native `SqliteDb` wrapper remain.
- ✅ App-private local backup shipped (#7924): `LocalBackupService` writes a
  JSON snapshot every 5 min on Android (`KeyValStore` rows `backup` /
  `backup_prev`) and iOS (`Directory.Data` `super-productivity-backup.json` /
  `.prev.json`), with an empty-state write guard and a two-generation ring so
  one bad/evicted write cycle can't erase the only good copy. Fresh-launch
  restore prompt is informed (`summarizeBackupStr` shows task / project
  counts). Electron continues to use its own rotated backup folder.

- ✅ **B1 + B3 + C1 code landed (flag-gated, default off).** The native plugin
  (`@capacitor-community/sqlite`) + `CapacitorSqliteDb` wrapper, the
  flag-gated DI token flip (`native-sqlite-backend.ts`), and the one-time
  first-launch IDB→SQLite migration bootstrap are all wired. Inert until
  `SUP_USE_NATIVE_SQLITE_OP_LOG` is set on a native build (which needs
  `npx cap sync`). On-device validation + staged rollout (C2) remain.

Nothing in the SQLite tracks below changes runtime behavior for existing users
until the `SUP_USE_NATIVE_SQLITE_OP_LOG` flag flips a native build to the SQLite
backend. The #7924 local-backup work is already live on Android/iOS.

---

## Track A — Ship the #7892 safeguards now (independent of SQLite)

These directly reduce the data-loss blast radius and do **not** depend on the
SQLite work. Highest user value per unit effort; do these first.

### A1. Make `navigator.storage.persist()` observable on native

`startup.service._requestPersistence()` suppresses the not-granted branch on
native and logs nothing when `persist()` resolves `false`. On Android WebView
the grant is often not honored, so today a report like #7892 carries no signal.

- **Do:** `Log.log({ persisted, granted })` on every branch (incl. native), so
  exported logs always carry the durability state of the WebView store.
  Optionally surface in About diagnostics as a follow-up.
- **Size:** ~1 file, a few lines. **Risk:** none (logging only).
- **Payoff:** the next #7892-style report is conclusive instead of a mystery,
  and the telemetry decides whether the next protective steps (e.g. the
  near-empty write guard below) are worth the added complexity.

### A2 (shipped). Debounced on-data-change backup trigger

✅ Shipped in #7925: `LocalBackupService._triggerBackupSave$` merges a
`LOCAL_ACTIONS`-driven trigger with the existing 5-min interval — any local
action settles into a backup after a 30s quiet period. `LOCAL_ACTIONS`
already filters out remote/hydration replays, and the existing empty-state
guard in `_backup()` prevents writing a degraded post-eviction snapshot
over a good backup, so the trigger strictly adds frequency without spam.

### A3 (shipped). Near-empty write-time overwrite guard

✅ Shipped in #7925: `LocalBackupService._backupAndroid()` and `_backupIOS()`
each read the existing primary slot before promoting/overwriting, and bail
when a near-empty snapshot (< 3 tasks) would clobber a substantial existing
backup (≥ 10 tasks). Counts include active + young-archived + old-archived
tasks via the shared `countAllTasks` helper, so the threshold is the same
on the read side (`summarizeBackupStr`) and the write side. Electron is
unchanged — its rotated, timestamped backup chain isn't a single-slot
overwrite. Fail-safe: skipping never loses data; the guard self-clears
once the store grows back past 3 tasks, so a legitimate bulk-delete is
captured on the next tick.

> A1, A2, and A3 have shipped — Track A is complete. SQLite (Track B) is
> the durable architectural fix and is tracked in #7931.

---

## Track B — Finish the SQLite backend (native)

### B1. Add `@capacitor-community/sqlite` + a `SqliteDb` wrapper — ✅ code landed, `npx cap sync` + on-device remains

- ✅ **Plugin added** (`@capacitor-community/sqlite`, `dependencies`) and
  `CapacitorSqliteDb` (`capacitor-sqlite-db.ts`) wraps its `SQLiteDBConnection`
  into the `SqliteDb` port (`run`/`query`), opening one `SUP_OPS` connection. The
  plugin is pulled in via a **dynamic `import()`** so its web WASM build never
  enters the eager bundle; only a `import type` reaches the web build.
- ✅ **Web-eviction gotcha respected:** construction is gated behind
  `shouldUseNativeSqliteOpLogBackend()` (native **and** the opt-in flag). The
  plugin's **web** build is WASM-SQLite persisted into IndexedDB — never bound on
  web/PWA/Electron.
- ✅ **Perf mitigation 1 baked in:** `run` returns the plugin's own `lastId` from
  the insert response — no separate `SELECT last_insert_rowid()`. `run` is issued
  with `transaction = false` so the adapter's explicit `BEGIN/COMMIT/ROLLBACK` is
  the single transaction in force.
- ✅ **Android `includePlugins` allowlist updated.** `capacitor.config.ts` uses an
  explicit `android.includePlugins` allowlist — without adding
  `@capacitor-community/sqlite` to it the plugin is **not registered on Android**
  (iOS has no allowlist and is unaffected), so every native call would reject on
  the exact platform this targets. Now listed.
- ✅ **WebView-reload-safe open.** `_open()` calls
  `checkConnectionsConsistency()` and falls back from `createConnection` to
  `retrieveConnection` on "already exists", so a reload (fresh JS runtime, stale
  native connection) can't wedge on a dangling `SUP_OPS` handle.
- ✅ **Shared-connection serializer.** One SQLite connection has ONE transaction
  context, so both stores sharing the connection would otherwise nest `BEGIN`s /
  leak statements across transactions. `CapacitorSqliteDb` implements the new
  `SqliteDb.runExclusive`, and `SqliteOpLogAdapter` routes every top-level op
  (each transaction as one unit) through it. Covered by a real-sql.js concurrency
  test (`sqlite-op-log-adapter.spec.ts`) that asserts the collision without the
  serializer and success with it.
- ⏳ **Remains (device-gated):** run `npx cap sync` (+ `pod install`) so the
  Android/iOS projects pick up the now-allowlisted native plugin, then build + run
  on a real device, including a WebView force-reload to exercise the reuse path.
  Perf mitigation 2 (the `executeSet` bulk-write path) is still deferred — see the
  note below; it only matters on the bridge and can't be measured with in-process
  sql.js.
- **⚡ Perf — bake two mitigations into the wrapper from the start.** On native
  the dominant cost is the Capacitor JS↔native bridge round-trip, not SQLite
  itself. Reads (`getAll`/`count`) are already one query = one crossing.
  Single-op append is negligible. The one cliff is **bulk write**:
  `OperationLogStoreService.appendBatch()` loops `await tx.add()` once per op, so
  N ops = N crossings. Mitigations (only matter on the bridge; can't be measured
  with in-process sql.js, so validate on-device):
  1. **Return `lastId` from the plugin's own `run` response** (it provides it) —
     never issue a separate `SELECT last_insert_rowid()`, which would double
     every insert to two crossings.
  2. **Add an optional bulk path to the port** (e.g. `runBatch(statements)` on
     `SqliteDb` + an `addBatch` on `OpLogTx`) so `appendBatch` collapses to one
     crossing via the plugin's `executeSet`. Per-op `seq` recovery from a batched
     insert needs `RETURNING seq` (SQLite ≥ 3.35) or `last_insert_rowid()`
     arithmetic over the consecutive AUTOINCREMENT range — pick after confirming
     the plugin's SQLite version on-device.

### B2. Validate `SqliteOpLogAdapter` against a real engine — ✅ done (CI), on-device remains

- ✅ **sql.js in Karma.** `sql.js` is a devDependency, served into Karma as a
  global script + a proxied `.wasm` (`src/karma.conf.js`), so the webpack `node:`
  import problem is sidestepped (loaded as a script, not bundled). A ~25-line
  `SqlJsDb` wrapper (`sql-js-db.test-helper.ts`) satisfies the `SqliteDb` port.
- ✅ **Adapter contract dual-run.** `sqlite-op-log-adapter.spec.ts` runs the
  behavioral contract against both the fake and real sql.js; SQL-emission specs
  stay fake-only. Confirmed the real `UNIQUE constraint failed` → `ConstraintError`
  mapping, `AUTOINCREMENT`-after-`clear()`, compound-index + NULL ranges, real
  `BEGIN IMMEDIATE` rollback. No surprises surfaced.
- ✅ **Store-port second pass.** `remote-apply-store-port.integration.spec.ts`
  runs the store's composed flows (apply/mark/merge-clock, partial failures,
  full-state clearing) through `OperationLogStoreService` on both backends.
- ⏳ **Remains: the on-device real-engine run.** sql.js validates the engine, not
  the Capacitor bridge or the native plugin's specific SQLite build/flags. The
  `operation-log-stress.benchmark.ts` harness is the lever for the on-device
  perf + behavior pass (see B1 perf note).

### B3. Flip the DI token on native — init fix ✅ landed; token flip device-gated

- ✅ **Backend-aware store init (the half found during B2 stage 2, now done).**
  `OperationLogStoreService.init()` and `ArchiveStoreService._init()` were
  IDB-shaped — they unconditionally opened+adopted a WebView IndexedDB connection
  and never called `adapter.init()`, so on SQLite the tables were never created
  _and_ the evictable store was still touched. Now: when the adapter exposes no
  `adoptConnection` (self-managing, e.g. SQLite), `init()` calls
  `await this._adapter.init()` and **skips the IDB open**; the IndexedDB path is
  unchanged. Two unit tests cover both branches; the store-port integration spec
  now drives the store fully on SQLite (no pre-init workaround). The new branch is
  **dead in production** until the token flip below, so it shipped risk-free.
- ✅ **Token flip landed (flag-gated, default off).** `OP_LOG_DB_ADAPTER_FACTORY`
  now returns the native SQLite factory when `shouldUseNativeSqliteOpLogBackend()`
  (`native-sqlite-backend.ts`) — i.e. on native **and** the
  `SUP_USE_NATIVE_SQLITE_OP_LOG` localStorage flag is `'true'`. Otherwise the
  IndexedDB default is unchanged. `createNativeSqliteOpLogAdapterFactory()` closes
  over ONE `CapacitorSqliteDb` and vends every service its own adapter over that
  single connection (mirroring the shared IDB connection); the bootstrap runs once
  regardless of how many adapters init. Unit-covered (`native-sqlite-backend.spec.ts`).
- ⏳ **Remains (device-gated):** flip the flag on a real native build and verify.
- **Size:** done. **Risk:** gated by the flag — dead in production until set.

---

## Track C — Data migration (native, one-time)

### C1. IDB → SQLite copy on first launch after enabling B3 — ✅ algorithm + wiring done, on-device run remains

- ✅ **Algorithm:** `migrateOpLogBackend(source, dest)` in
  `op-log-backend-migration.ts` copies **all** stores in one `dest` transaction
  with verify-before-commit (op count + last `seq` + vector clock; mismatch →
  rollback, source untouched). Generic `iterate`→`put`: preserves ops `seq`
  (incl. gaps) via put-honors-seq, writes singletons at their out-of-line key,
  no per-store special-casing. Adapter-agnostic, so validated real-Chrome-IDB →
  sql.js in CI; the native plugin dest behaves identically through the port.
- ✅ **Wiring landed (with B3):** `bootstrapNativeOpLogBackend()` runs once on the
  first adapter `init()` — it creates the SQLite schema, then (guarded by a
  `sup_op_log_meta` marker table, a non-empty destination, and a best-effort
  `indexedDB.databases()` presence check) calls `migrateOpLogBackend` to copy the
  legacy `SUP_OPS` IndexedDB across. The marker is set only **after** a successful
  verified copy, so a failed/aborted run retries next launch; the IDB copy is left
  **untouched** as a ≥ 1-release fallback. Unit-covered (idempotency, empty-source,
  shared-connection) in `native-sqlite-backend.spec.ts`.
- ✅ **Bootstrap-failure fallback (no permanent wedge).** A bootstrap that throws
  every launch (corrupt source row, SQLite open failure) would otherwise leave the
  op-log uninitialised forever — the factory rethrows and `init()` keeps rejecting.
  Now `shouldUseNativeSqliteOpLogBackend()` tracks a localStorage failure counter
  (`SUP_NATIVE_SQLITE_OP_LOG_FAIL_COUNT`) and, after
  `MAX_NATIVE_SQLITE_BOOTSTRAP_FAILURES` (3) **pre-migration** failures, falls back
  to IndexedDB so the app keeps working. **Critical asymmetry:** the fallback is
  only safe _before_ migration commits — once the copy succeeds, SQLite holds the
  live data and the retained IDB copy is a stale frozen snapshot, so falling back
  to it would silently drop every post-migration op. A localStorage "authoritative"
  mirror (`SUP_NATIVE_SQLITE_OP_LOG_MIGRATED`, set on first successful bootstrap)
  makes the gate keep retrying SQLite forever post-migration and never fall back.
  To re-attempt after hitting the cap, clear the fail-count key. Unit-covered (both
  branches) in `native-sqlite-backend.spec.ts`.
- ⏳ **Remains (device-gated):** run on a real device with the flag set and confirm
  a populated legacy install migrates end-to-end.
- **Risk:** high (data movement) — mitigated by the verify-before-commit safety
  net (tested to actually roll back) + retain-source + the run-once marker.

### C2. Staged rollout

Beta/dogfood on real Android devices → staged enable → remove the IDB fallback
and the `adoptConnection` bridge once SQLite is the sole native backend.

---

## Track D — Cleanup (after SQLite is the native default)

- **D1.** Remove the transitional `adoptConnection` bridge from the port and the
  two services once no backend relies on a borrowed connection.
- **D2.** Consider deriving the IndexedDB upgrade from `OP_LOG_DB_SCHEMA` so
  `runDbUpgrade` only carries _deltas_ (the schema spec already guards against
  drift; this removes the remaining hand-maintained duplication).
- **D3.** Out-of-scope for #7892, optional: migrate the other small IDB
  databases (`SUPThemes`, `sup-sync`, `sup-plugin-oauth`) only if fully
  evacuating WebView storage is desired.

---

## Suggested order

1. ✅ Track A complete — **A1** (storage-persistence diagnostics) → **A2**
   (debounced data-change trigger) → **A3** (near-empty write-time overwrite
   guard) all shipped.
2. ✅ **B1 → B2 → B3** code landed (SQLite runnable behind the
   `SUP_USE_NATIVE_SQLITE_OP_LOG` flag, default off); the on-device run +
   `npx cap sync` remain — tracked in #7931.
3. ✅ **C1** wiring landed (first-launch IDB→SQLite copy, verify-before-commit);
   **C2** staged on-device rollout remains — tracked in #7931.
4. **D** (tidy up once SQLite is the native default) — tracked in #7931.

> **Enabling on a native build:** `localStorage.setItem('SUP_USE_NATIVE_SQLITE_OP_LOG', 'true')`
> then restart. Requires `npx cap sync` first so the native plugin is built in.

Tracks A and B/C/D are independent — A shipped while B/C/D moves at its own
device-gated cadence.

## Cross-cutting / hardening

These don't belong to a single track but were surfaced by the #7924 review and
should land alongside the next time the area is touched.

- **`JavaScriptInterface.kt` JS-literal injection** (Android bridge). The
  `loadFromDbCallback(...)` call is built by raw single-quote interpolation of
  the stored value into `evaluateJavascript`. Beyond the security smell, it is
  a real functional bug: `JSON.stringify` does not escape `'`, so a backup
  blob containing an apostrophe terminates the JS string literal and
  load-from-DB returns garbage. Fix is to use `JSONObject.quote()` for the
  arguments (the same primitive already used by
  `emitForegroundServiceStartFailed`).
- **Backup-date in the restore prompt** (strengthens the informed-restore UX
  from #7924). iOS has `Filesystem.stat.mtime` for free; Android needs a
  bridge change to surface the (now-real) `KEY_CREATED_AT` —
  `loadFromDbWrapped(key)` returns only the value, so add a meta-aware reader
  (e.g. `loadFromDbWithMeta` → `{ value, createdAt }`). This gives
  `KEY_CREATED_AT` its first reader; the column is behaviorally inert today.
- **Robust restore on empty/degraded boot** (was #7901 item 4). Today
  `_initBackups()` only offers restore when there is no `stateCache` at all.
  Extend the trigger to also fire when the loaded state is degraded per
  `hasMeaningfulStateData`. Needs a decision on auto-restore vs prompt and a
  guard against resurrecting an intentional wipe (the informed-restore prompt
  shipped in #7924 already lets the user decline knowingly).
- **"Last backup" visibility on mobile** (was #7901 item 5). Surface the
  most recent successful backup time in About / a settings panel so no-sync
  users can see they are protected. Pairs naturally with the backup-date
  bridge change.
- **No-sync onboarding nudge** (was #7901 item 6). On a no-sync mobile
  install, surface that local-only data is at risk and recommend enabling
  sync. Default-on local backup (since #7924) already protects them; this is
  the awareness piece.
