# Handover: benchmark the native SQLite op-log vs IndexedDB (PR #8389)

**Date:** 2026-06-23 · **Status:** IMPLEMENTED (code landed; on-device run + results write-up remain) · **Branch:** `claude/android-sqlite-migration-fkvvcg` (PR #8389)

This is a self-contained spec for a fresh session. Background memory: `project_sqlite_oplog_android_default_8389.md` (auto-loaded via `MEMORY.md`).

---

## Implementation status (2026-06-23)

Both deliverables are coded, lint-clean (`checkFile`), and unit-smoke-tested in Karma. What remains is operator-only: build the dev APK, run the harness on a device, and write up the numbers.

**Files:**

- `src/app/op-log/persistence/op-log-backend.benchmark.ts` — Deliverable 1 harness. Exports `benchOpLog(opts?)` (device entry), `runOpLogBackendBench(factories, opts)` (testable runner), `formatReport(result)`, `DEFAULT_BENCH_OPTIONS`, and the result types.
- `src/app/op-log/persistence/op-log-backend.benchmark.spec.ts` — Karma smoke test (sql.js): runner produces well-formed median/p95, seeds exact N, isolates a failing backend + still tears down, renders the report. **4/4 green.**
- `src/main.ts` — `window.__benchOpLog()` trigger, dev-only (`!production && !stage`), dynamic `import()` (lazy chunk, stripped from prod).
- `src/app/op-log/persistence/operation-log-hydrator.service.ts` — Deliverable 2 breadcrumbs (shipped). **hydrator spec 61/61 green.**
- `src/app/op-log/persistence/capacitor-sqlite-db.ts` — added `deleteDatabase()` lifecycle method for clean bench teardown (keeps all plugin access in the one designated file).

**How to run (on device):**

> ⚠️ **Must be a DEV build.** The trigger is gated `!environment.production && !environment.stage`. `npm run droid` / `dist:android` build the **stage** config (`environment.stage.ts` = `{production:true, stage:true}`) → the guard is `false` → `window.__benchOpLog` is **never attached** (and because stage builds use `--optimization=false`, the dead `__benchOpLog` string is still in the bundle, so grepping the JS is NOT proof it's wired — check the baked `production:`/`stage:` values, both must be `false`). Same applies to `__e2eTestHelpers` — if both are `undefined`, you're on a stage/prod build.
>
> Also: `npm run buildFrontend:dev` writes to `.tmp/angular-dist`, not `dist/browser` (Capacitor's `webDir`). Pass `--output-path dist`. Verified working sequence:
>
> ```bash
> npm run buildFrontend:dev -- --output-path dist   # dev env (production:false, stage:false) → dist/browser; entry is main.js (unhashed)
> npx cap sync android
> cd android && ./gradlew installFdroidDebug && cd ..   # rm -rf android/app/build android/build first if packageFdroidDebug throws NoSuchFileException
> adb shell am start -n com.superproductivity.superproductivity/.CapacitorMainActivity   # NOT the launcher icon → that's FullscreenActivity (online mode, getPlatform()==='web', no trigger)
> ```
>
> After install, open a FRESH `chrome://inspect` target (the old one points at the dead WebView), confirm `typeof window.__benchOpLog === 'function'`, then run it. Caveat: a dev build is unoptimized, so the JS-side harness loop is slower than prod — but the measured ops are native bridge + SQLite/IDB engine, so the SQLite-vs-IndexedDB delta stays valid.

Then in the DevTools console:

```js
await window.__benchOpLog(); // full default sweep (1k/10k/50k × 100KB/1MB/5MB)
await window.__benchOpLog({ opCounts: [1000] }); // quick smoke; any DEFAULT_BENCH_OPTIONS field is overridable
```

It prints three markdown tables (append latency; ops-table reads + migration cost by N; state-cache blob read by S) and returns the structured result. Synthetic data + `SUP_OPS_BENCH*` DBs, both deleted on teardown — the real `SUP_OPS` is never touched. Logcat alt: `adb logcat | grep -E 'opLogBench|chromium'`.

**Deviations from this spec (and why):**

1. **Location is `persistence/…benchmark.ts`, not `testing/benchmarks/…`.** `src/tsconfig.app.json` excludes `**/testing/**`, so a module there is invisible to the app build — `main.ts` could not type-checked-import it for the device trigger. The `.benchmark.ts` suffix still gives console-exemption (eslint) and keeps Karma from auto-running it.
2. **Migration vs append measured separately.** The real one-time migration (`migrateOpLogBackend`) copies inside ONE `dest.transaction()` (N bridge crossings, one BEGIN/COMMIT), whereas `append()` is one autocommit add per op. The spec table conflated them; the harness reports **migration (single bulk-insert sample)** and **append (per-op autocommit latency)** as distinct numbers.
3. **SQLite backend is platform-gated** (`shouldUseNativeSqliteOpLogBackend()`): off a real Android container it reports a clear error row instead of silently benchmarking the plugin's WASM-on-IndexedDB web build (which has no native bridge → misleading A/B). IndexedDB still runs.
4. **Cold run** is captured in the structured result (`Stat.cold`) but omitted from the printed tables (tables show median/p95) — "report separately" satisfied via the return value.

---

## TL;DR — the task

After PR #8389 makes native SQLite the op-log backend on Android, **task/boot loading feels a bit slower** on-device. Build a **proper on-device A/B benchmark** that measures the SQLite backend vs IndexedDB for the operations boot hydration performs, so we can decide whether the deferred read-perf optimizations are worth implementing — with numbers, not vibes.

Two deliverables:

1. **On-device A/B harness** (primary) — controlled, synthetic, isolated.
2. **Hydrator timing breadcrumbs** (complementary, cheap) — one real number from the actual account's cold boot.

Both are **dev-only / test-scoped** and must not affect production code paths.

---

## Background

PR #8389 moves the op-log (`SUP_OPS`) from WebView IndexedDB to **native SQLite via `@capacitor-community/sqlite`** on Android (to escape OS eviction = the documented data-loss root cause). The op-log is the app's **authoritative store, read during boot hydration**, so its read latency directly affects how fast tasks appear.

Suspected slowdown causes (architectural, **not** from the review fixes already landed):

1. **JS↔native bridge marshalling.** Every SQLite op crosses the Capacitor bridge; results are serialized to a JSON string natively, shipped across, and `JSON.parse`d in JS. The **state-cache blob read** (`loadStateCache`) can be multi-MB → this is suspect #1. IndexedDB is in-process structured-clone (no bridge, no JSON round-trip).
2. **Lost read parallelism.** Both op-log stores now share **one** SQLite connection behind a promise-chain serializer (`runExclusive`, correctness-required to avoid nested `BEGIN`). On IndexedDB they had separate connections, so archive-load and op-load overlapped on boot; now they serialize.
3. **One-time migration** (first launch after upgrade): IDB→SQLite copy is N bridge round-trips. One-off, but skews the first boot.

The boot read path (verified): `OperationLogHydratorService.hydrateStore()` loads `loadStateCache()` (the snapshot blob), then applies the **delta of ops after `snapshot.lastAppliedOpSeq`**. The slow worst case is "no/corrupt snapshot → replay **all** ops" (`getAll(ops)` = whole table over the bridge).

---

## Why a Karma / sql.js benchmark would be WRONG

The suspected bottleneck is the **native bridge**, which does not exist off-device:

- Karma runs the SQLite adapter over **sql.js (in-process WASM)** — no bridge → understates the real cost.
- It also compares sql.js vs Chrome-IDB (two different engines) → not a fair A/B.

So a Karma/sql.js benchmark is only good for catching _algorithmic_ regressions within one backend (e.g. the O(N)→O(1) `getLastSeq` fix already landed). **The real question — "is SQLite slower than IDB on a phone, and by how much vs op-count / blob-size" — can only be answered on-device.** Do not accept a Karma-only benchmark as the answer.

---

## Deliverable 1: on-device A/B harness

### What it does

On the actual Android device, construct **both** backends on **throwaway DBs**, seed identical synthetic data, time the hydration-representative ops, report median + p95.

### Operations to time (the ones boot hydration uses)

| Op (adapter level)                                  | Maps to            | Why                                  |
| --------------------------------------------------- | ------------------ | ------------------------------------ |
| `get(STATE_CACHE, key)`                             | `loadStateCache()` | the big blob read — suspect #1       |
| `getAll(OPS, {lower: snapshotSeq, lowerOpen:true})` | `getOpsAfterSeq()` | the typical boot delta               |
| `getAll(OPS)`                                       | full replay        | worst case (no/corrupt snapshot)     |
| `add(OPS, …)` ×N                                    | migration / append | one-time migration cost              |
| `getLastSeq` equivalent (`iterate prev limit:1`)    | hot path           | confirm the O(1) fix holds on-device |

Benchmark at the **adapter layer** (`OpLogDbAdapter`), not through the full store — cleanest isolation of backend cost.

### Backends compared (same device, same data)

- **SQLite:** `new SqliteOpLogAdapter(new CapacitorSqliteDb('SUP_OPS_BENCH'))`
- **IndexedDB:** `new IndexedDbOpLogAdapter({ ...OP_LOG_DB_SCHEMA, name: 'SUP_OPS_BENCH_IDB' })`

`CapacitorSqliteDb`'s constructor takes the DB name (first param); `IndexedDbOpLogAdapter`'s takes an `OpLogDbSchema` whose `.name` sets the IDB database. **Use distinct bench DB names so the real `SUP_OPS` is never touched.** Tear both down at the end (delete the bench DBs).

### Parameter sweep

- Op count **N ∈ {1_000, 10_000, 50_000}**
- State-cache blob size **S ∈ {100 KB, 1 MB, 5 MB}** (synthetic JSON object)
- Iterations **M ≥ 5** per measurement; report **median + p95** (first run is cold — report it separately or discard).

### Output

A markdown table to `console.log` (readable via `chrome://inspect` DevTools console or `adb logcat`). Columns: backend × op × N (and × S for the blob read). Synthetic data only → **safe to log freely** (no privacy rule violation).

### Safety constraints (must-haves)

- **Synthetic data only.** Never read the user's real op-log. (Honors the no-user-content logging rule by construction.)
- **Separate DB names** (`SUP_OPS_BENCH*`). Never `SUP_OPS`.
- **Dev-gated.** Must not ship a callable that runs in production, and must not import into any production eager path.
- Skip the migration/bootstrap machinery — just `adapter.init()` (creates schema), seed, read.

### Trigger (recommended)

Expose `window.__benchOpLog(opts)` in **dev builds only**, callable from the DevTools console already attached via `chrome://inspect`. Zero UI, easy to re-run with different params. (Alternatives if preferred: a hidden settings/debug action, or a `?benchOpLog=1` URL param.) Confirm the trigger choice with the user before building.

### Suggested location

`src/app/op-log/testing/benchmarks/op-log-backend-bench.ts` (next to the existing `operation-log-stress.benchmark.ts`, which is the IDB-throughput Karma benchmark to model the seeding/timing style after — but note that one runs in Karma and does **not** exercise the bridge).

---

## Deliverable 2: hydrator timing breadcrumbs (cheap, complementary)

Add `performance.now()` timing around the real reads in `OperationLogHydratorService.hydrateStore()` — at minimum `loadStateCache()` and the delta-apply — logged via the existing `OpLog.normal(...)` breadcrumbs (id + duration only, **no user content**). Gives one real data point from the user's actual account boot, alongside the controlled A/B curve. Decide whether to keep these behind a dev flag or ship them (they're cheap and privacy-safe).

---

## Code anchors (verified 2026-06-23, post master-merge — symbol names are stable; line numbers drift)

- `src/app/op-log/persistence/capacitor-sqlite-db.ts` — `CapacitorSqliteDb(dbName, openTimeoutMs?, statementTimeoutMs?)`, the only file that talks to the plugin (bridge).
- `src/app/op-log/persistence/sqlite-op-log-adapter.ts` — `SqliteOpLogAdapter(db, schema?)`; the `SqliteDb` port.
- `src/app/op-log/persistence/indexed-db-op-log-adapter.ts` — `IndexedDbOpLogAdapter(schema?)`.
- `src/app/op-log/persistence/op-log-db-schema.ts` — `OP_LOG_DB_SCHEMA` (`.name` = DB name).
- `src/app/op-log/persistence/operation-log-store.service.ts` — `loadStateCache()`, `getOpsAfterSeq(seq)`, `getLastSeq()`, `_clearAllDataForTesting()`, the `getAll(OPS)` full-table reads.
- `src/app/op-log/persistence/operation-log-hydrator.service.ts` — `hydrateStore()` (the boot read path; snapshot + delta, or full replay).
- `src/app/op-log/testing/benchmarks/operation-log-stress.benchmark.ts` — existing IDB-throughput benchmark (Karma; seeding/timing style to model).

---

## Environment setup & gotchas (this worktree)

- **Run Bash in the worktree dir** (`.worktrees/feat/pr-8389-5afe7c`), not the main repo.
- **`node_modules` is a read-only symlink** to the main repo. To get `@capacitor-community/sqlite` installed, run `npm install` **from the worktree** in a real terminal (already done this session; re-run if reset). Without it, `ng test` / the app build fail to resolve the dynamic `import('@capacitor-community/sqlite')`.
- **Shallow clone WAS unshallowed** this session (`git fetch --unshallow`). Do **not** `git rebase master` if it ever re-shallows — `git merge-base` lies below the graft (it produced 727 phantom add/add conflicts). Use `merge` after unshallowing.
- **master is merged in** (commit on branch). `versionCode` is now `18_12_01_9000` (18.12.1).
- **On-device build:** `npm run buildFrontend:dev && npx cap sync android` (webDir = `dist/browser`; `cap sync`, not `cap update`, regenerates `capacitor.plugins.json` + the cordova-plugins dir). Confirm the plugin registered: `grep -i sqlite android/app/src/main/assets/capacitor.plugins.json` → expect a `CapacitorSQLite` entry.
- **Install without wiping data:** `adb install -r -d <apk>` (keeps data, allows the versionCode downgrade) — works only if the installed app shares the signing key (debug↔debug). A release-signed install can't be overwritten by a debug build (signature mismatch → must uninstall).
- **Karma in the Claude sandbox works** (`npm run test:file <path>`) once the dep is installed, but Karma **cannot** exercise the native bridge — see "Why Karma would be wrong".
- **`gradle` cannot run in the Claude sandbox** (read-only `~/.gradle`); device/emulator builds happen in the user's real terminal / Android Studio.
- **`git push` is sandbox-denied**; the user pushes (e.g. via `!`). Pre-push hook runs the full ~9k suite and exceeds the 2-min `!` timeout → push with `--no-verify` (CI runs the full suite).

---

## Open review follow-ups (context; separate from the benchmark, none are blockers)

From the 2026-06-23 multi-review, still open for the author:

- **Statement-timeout leak:** `CapacitorSqliteDb.withTimeout` rejects but doesn't cancel the in-flight native call → a late `COMMIT` can break the one-transaction invariant. Fix = `reset()` on `TimeoutError`.
- **`INDEX_COLUMN_BY_PATH` drift guard:** a new `OP_LOG_DB_SCHEMA` index not added there is silently dropped (partial/missing index). Add a CI test asserting `planTables()` reproduces every schema index.
- **Android Auto Backup:** the unencrypted `databases/SUP_OPS` is now a first-class backup/`adb backup` target (`allowBackup=true`, rules exclude only one sharedpref). Decide: exclude it or document.
- **Pin `@capacitor-community/sqlite`** (drop the `^` caret — un-CI-able native dep on the authoritative store).
- **`hasSyncedOps` residual:** still scans all _synced_ ops (can't `LIMIT 1` due to the MIGRATION/RECOVERY skip). Minor; the correctness bug (NULL-index parity) is fixed.
- **C2 on-device validation (most important):** install over a legacy-data app that lands in MODE_ONLINE (`FullscreenActivity`, no Capacitor bridge) and confirm it stays on IndexedDB and boots — the gate fix (`getPlatform()==='android' && isPluginAvailable('CapacitorSQLite')`) should keep SQLite off there.

---

## Acceptance criteria

- [x] `window.__benchOpLog()` trigger, dev-only (`!production && !stage`), dynamic-import (never in production). _On-device execution still pending (operator)._
- [x] Produces a median+p95 table comparing SQLite vs IndexedDB across the N×S sweep (plus per-op append + one-time migration). _Numbers require the on-device run._
- [x] Uses only synthetic data and bench-only DB names (`SUP_OPS_BENCH*`); the real `SUP_OPS` is never touched; both bench DBs deleted on teardown.
- [x] Hydrator breadcrumbs emit boot read timings (`loadStateCache`, tail-read, full-replay-read) — id + ms + count only, no user content. Shipped (not dev-gated).
- [ ] A short results write-up (the numbers) so we can decide on the deferred optimizations (seq-windowed ops read, batched `executeSet`, second connection for archive blobs). **← operator: run on device, paste tables here.**
- [x] `npm run checkFile` clean on all new/changed files; benchmark is a lazy chunk behind the dev guard (no eager/production import). Karma smoke 4/4; hydrator spec 61/61.
