# SQLite op-log — durability rationale & performance findings

**Date:** 2026-06-23 · **Status:** research record (decisions + open actions) ·
**Context:** PR #8389 makes native SQLite the authoritative op-log backend on
Android. On-device the boot/load "feels slower"; this doc records _why_ SQLite is
the right durable store (and why the obvious alternatives are not), what the
measured cost is, and the recommended performance path.

Companions: [`sqlite-migration.md`](./sqlite-migration.md) (architecture),
[`sqlite-migration-followup.md`](./sqlite-migration-followup.md) (backlog),
[`../plans/2026-06-23-oplog-sqlite-benchmark-handover.md`](../plans/2026-06-23-oplog-sqlite-benchmark-handover.md)
(benchmark harness).

---

## TL;DR — decisions

1. **Keep SQLite as the authoritative op-log store on Android.** The two
   "simpler" alternatives are dead ends: WebView IndexedDB eviction **cannot be
   prevented**, and "just back up to a native store periodically" is the design
   that **already shipped and already failed** (it caused the original data loss).
2. **The op-log read/write cost is acceptable; the one real per-boot cost is the
   state-cache blob read.** That blob is a _rebuildable cache_, so it doesn't need
   the slow durable path — this is where the optimization budget goes.
3. **Stages 0 + 2 — ✅ done:** batched the migration with `executeSet`, set WAL
   pragmas, excluded the op-log DB from Android Auto Backup (§4), and added
   self-gating blob **compression** (not snapshot-in-IDB). Remaining is on-device
   validation + the (now non-blocking) Stage 1 size measurement.

---

## 1. Can we just prevent IndexedDB eviction? — No.

`navigator.storage.persist()` **was never implemented for Android System
WebView.** The granting heuristics it depends on (bookmark, site-engagement
score, add-to-home-screen, notification permission) structurally do not exist in
an embedded WebView, so the request auto-denies and storage stays "best-effort"
(evictable under storage pressure). A Chromium engineer states it directly
(chromium-discuss, reaffirmed Sept 2025): _"I don't think we've done anything to
make this work in WebView. We'd have to expose a callback to the embedding app …
and we don't have that right now."_

Corroborated three independent ways:

- Our own [`sqlite-migration.md:89-98`](./sqlite-migration.md) already concluded
  persist() "on Android WebView … is unlikely to be honored," and the
  not-granted warning is deliberately suppressed on native.
- Production logs observed `persist() granted: false`.
- Ionic closed the "persist storage (IndexedDB)" request
  ([capacitor#7594](https://github.com/ionic-team/capacitor/issues/7594)) as
  _not planned_; Capacitor's own docs say "the OS will reclaim local storage from
  Web Views if a device is running low on space."

**OPFS is not an escape** — it lives in the same per-origin storage bucket as
IndexedDB, under the same quota and the same best-effort eviction. There is no
web-platform lever that makes WebView storage durable.

## 2. Isn't a periodic backup to SQLite simpler? — It already exists, and it already failed as a primary.

The backup being proposed **already ships in production**: `LocalBackupService`
(#7924/#7925) writes a full-state JSON snapshot **every 5 minutes** (plus a
30s-debounced trigger on edits) to an _eviction-proof native store_ — Android
Kotlin `KeyValStore` (app-private SQLite KV, not WebView) and iOS
`Directory.Data` — with a two-generation ring and empty-state write guards
(`src/app/imex/local-backup/local-backup.service.ts`). Boot-time eviction
detection and restore already exist too
(`src/app/core/startup/startup.service.ts:222-264`). So this is the existing
**disaster-recovery floor**, not a smaller new project.

It is **not a substitute** for an authoritative store, for three reasons — the
third is decisive:

1. **Lossy window.** Up to ~5 min (or one debounce) of recent edits are lost on
   eviction.
2. **Sync-unsafe restore.** It restores via `BACKUP_IMPORT`, which resets
   `lastServerSeq` / vector clock and can silently drop other devices' concurrent
   work (CLAUDE.md sync rule #7). The code already forces a _manual prompt_ for
   synced backups precisely because of this
   (`local-backup.service.ts` ~`:220-225`).
3. **This exact approach already caused the data-loss bug.** The Android total
   data loss was a two-part chain: WebView IndexedDB was evicted (#7892) **and**
   the native KV backup was _unreadable_ — `KeyValStore.get()` threw
   `SQLiteBlobTooBigException` once the snapshot crossed Android's ~2 MB
   CursorWindow, which happens "after roughly a year of normal use" (commit
   `d6475999e2`, #8401/#8402; chunked-read fix now at
   `android/.../KeyValStore.kt:73-99`). The backup was written but never readable.
   At the 30 MB data ceiling a full-state snapshot backup slams straight back into
   the same large-blob-over-the-bridge problem.

Making the backup lossless + sync-correct (incremental op-level copy keyed on
`lastBackedUpSeq`, replay-based restore that preserves the vector clock) is
**rebuilding most of the SQLite-authoritative design anyway**. The two are
complementary — fast in-process work + a durable copy — and PR #8389 simply moves
the _authoritative_ line onto the non-evictable store so the op-log itself can
never be evicted to blankness.

## 3. Durability tiering (cited)

Moving off IndexedDB is a real, OS-documented durability win — not a myth.
Android auto-reclaims only `getCacheDir()`; `getFilesDir()` / `databases/`
survive until uninstall or user "Clear data" (Android: _Access app-specific
files_).

| Tier      | Primitive                                                                              | Evicted under storage pressure? | Why                                                              |
| --------- | -------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------- |
| Durable   | `@capacitor-community/sqlite` (`databases/`), Filesystem `Directory.Data`, Preferences | **No**                          | App-private internal storage; not quota-managed; ACID for SQLite |
| Evictable | WebView IndexedDB, OPFS                                                                | **Yes**                         | One per-origin best-effort bucket; LRU-evicted under pressure    |

Native SQLite is the explicit ecosystem consensus for must-not-lose Capacitor
data (Capacitor docs, RxDB, Ionic all treat WebView IndexedDB as untrustworthy).

## 4. Android Auto Backup — ✅ addressed (independent of perf)

`allowBackup=true` includes `databases/` by default, and a restore runs **after
install, before first launch** — so a stale cloud/device-transfer backup could
seed an old `SUP_OPS` before the hydrator runs (resurrecting old state, or
tripping sync reconciliation). `@capacitor-community/sqlite` does **not**
auto-exclude its DB. **Fix:** both `res/xml/data_extraction_rules.xml` (API 31+)
and `res/xml/backup_rules.xml` (pre-31) now `<exclude domain="database">` the
op-log files (`SUP_OPSSQLite.db` + `-wal`/`-shm`) from both `cloud-backup` and
`device-transfer`. Deliberately **scoped to the op-log only** — the KeyValStore
(`SupKeyValStore`) disaster-recovery backup stays included as the intended,
guarded restore path, so no-sync users still recover on a new device while the
authoritative op-log is never auto-restored under the hydrator.

> "Clear storage" and uninstall still wipe everything — only sync protects
> against those. SQLite removes the _eviction_ failure mode, not all of them.

---

## 5. Performance

### Measured (synthetic on-device A/B, `__benchOpLog()`)

Append/op: SQLite **2.76 ms** vs IndexedDB **0.51 ms**. Reads (median ms):

| Metric (N / blob)        | SQLite     | IndexedDB |
| ------------------------ | ---------- | --------- |
| migration, 50k ops       | **98,688** | 13,698    |
| getAll full, 50k         | 3,712      | 625       |
| getOpsAfterSeq tail, 50k | 9.3        | 1.5       |
| getLastSeq, 50k          | 1.4        | 0.3       |
| state-cache blob, 1 MB   | 187        | 9.8       |
| state-cache blob, 5 MB   | 897        | 48        |

Blob read scales ~linearly (~180 ms/MB), so the **30 MB worst case extrapolates
to ~5 s on every boot** (typical < 2 MB ≈ ~360 ms).

### Measured AFTER Stage 0 + Stage 2 (2026-06-24, API 36 emulator)

Re-run with the optimizations live (migration batching, WAL pragmas, gzip
compression) and the harness fixed to exercise them (`putBatch` seeding +
realistically-compressible blob). Append/op: SQLite **3.5 ms** vs IndexedDB
**0.59 ms**.

| Metric (N / blob)       | SQLite (before → after) | IndexedDB | After vs IDB       |
| ----------------------- | ----------------------- | --------- | ------------------ |
| migration, 50k ops      | 98,688 → **11,732**     | 13,125    | **0.89× (faster)** |
| getAll full, 50k        | 3,712 → 2,161           | 367       | 5.9×               |
| getOpsAfterSeq tail,50k | 9.3 → 4.4               | 1.2       | 3.7×               |
| state-cache blob, 1 MB  | 187 → 38                | 8.5       | 4.5×               |
| state-cache blob, 5 MB  | 897 → **189**           | 50        | 3.8×               |

**Both headline optimizations validated.** Trust anchor: IDB's 5 MB read is 48 ms
(original) vs 50 ms (this run) → the two environments are comparable for reads, so
the SQLite deltas are real, not device artifacts.

- **Migration: ~8× faster and now scales _better_ than IDB** (1.33× slower at 1k →
  0.89× = faster at 50k). `executeSet` batching amortizes the bridge cost while
  IDB's per-row `put` overhead grows. The original ~99 s pain is gone.
- **Blob read: ~4.7× faster** (897→189 ms @ 5 MB), gap to IDB cut from 18.7× to
  3.8× — and this is the _realistic_ (~3-4× compressible) blob, so it's honest.
  Scales ~38 ms/MB now → **~1.1 s at 30 MB** (was ~5 s), matching the "~1-1.5 s"
  Stage 2 estimate. Stage 3 only warranted if ~1 s is still too slow for the rare
  huge account.
- **Still slower, acceptable:** append 6× but absolute-tiny (matters only in rapid
  bursts, e.g. a 50-op bulk dispatch ≈ +150 ms); `getAll` full 5.9× but that's the
  snapshot-_miss_ replay path, not the hot boot (snapshot + 4.4 ms tail).

**Caveats:** emulator host disk understates the `synchronous=NORMAL` append win
(cheap host fsync) — get honest append/write numbers on a real device (UFS flash).
WAL is verifiable via the `-wal`/`-shm` sidecar files; `synchronous` is a
per-connection runtime setting (not in the file), so it needs an in-app readback to
confirm.

### Why SQLite is slower — three taxes of the JS↔native bridge

The bridge serializes results to a JSON string natively, ships it across, and
JS `JSON.parse`s it. IndexedDB is in-process structured clone (no bridge, no
JSON).

1. **Per-statement bridge round-trip (~2 ms fixed).** Kills row-by-row work:
   migration loops `await tx.put` per row (`op-log-backend-migration.ts:100-105`)
   → N crossings (98 s ÷ 50k ≈ 1.97 ms/insert).
2. **Result-set JSON encode + parse (∝ payload).** The `getAll` full-replay cost.
3. **Double JSON encoding of the `value` column.** The adapter stores
   `JSON.stringify(value)` as TEXT (`sqlite-op-log-adapter.ts:279`) and parses it
   back (`:288`); the bridge then re-escapes that whole string. IndexedDB stores
   the **native object** (`indexed-db-op-log-adapter.ts:266`) — zero JSON. This is
   why the blob is ~18-19× worse.

Op-log writes/reads on the steady-state hot path (append, tail read, getLastSeq)
are already fine. The **state-cache blob read on every boot** is the only real
regression, and that blob is _rebuildable_ (replay ops), so it doesn't need the
durable slow path.

### Recommended path (staged, data-gated)

- **Stage 0 — no-regret, ship now (independent of the blob decision):**
  1. ✅ **`executeSet`-batch the migration** — done. The per-row `tx.put` loop is
     now `tx.putBatch`, which on SQLite collapses a store's rows into a few
     `executeSet` calls (`PUT_BATCH_CHUNK = 500`) instead of one bridge crossing
     per row (`op-log-backend-migration.ts`, `sqlite-op-log-adapter.ts`
     `sqlPutBatch` / `SqliteDb.runSet`, `capacitor-sqlite-db.ts`). IndexedDB just
     loops. Covered by sql.js specs (chunk-boundary + upsert parity); the native
     one-crossing win is the plugin's contract, **validate on-device**.
     **Known ceiling (intentional):** we send each chunk as flat per-row `values`
     entries, so the plugin takes its `oneRowStatement` path and still
     **recompiles each statement** inside the native loop — the win is "1 crossing
     - 1 transaction per chunk," _not_ SQLite's multi-row `VALUES` fast path. That
       fast path (`multipleRowsStatement`) is deliberately left unused: it builds the
       INSERT by **string-concatenating** escaped values instead of binding them, and
       can't fan out our `ON CONFLICT … DO UPDATE SET col = excluded.col` upsert. For
       a one-time migration of _authoritative_ data, keeping parameter binding is the
       right call (correctness > shaving the one-time migration time); revisit only if
       on-device migration time proves unacceptable, and then only via plain `INSERT`
       into the empty destination table (no upsert), never string-concat for blobs.
  2. ✅ **WAL pragmas** — done. `CapacitorSqliteDb._applyPerfPragmas` runs
     `journal_mode=WAL` then `synchronous=NORMAL` best-effort on every open
     (non-fatal; native-only, validate on-device). The real win is the
     `synchronous=NORMAL` fsync drop on each autocommit append — WAL's
     "readers don't block the writer" is mostly moot here (one connection,
     serialized by `runExclusive`, never has read/write contention). **Caveat
     baked in:** the two pragmas are deliberately **separate `execute()` calls** —
     the plugin only splits a multi-statement string on `";\n"` (semicolon+
     newline), so a `"; "`-joined `'…WAL; …NORMAL;'` reaches Android `execSQL()`
     as one statement and runs only the FIRST, silently dropping `synchronous`
     (caught by the strategy double-check; verified against the bundled plugin's
     `UtilsSQLite.getStatementsArray`). Still **validate on-device** that
     `PRAGMA synchronous;` reports `1` (NORMAL) and `journal_mode;` reports `wal`.
  3. ✅ **Android Auto Backup exclusion** — done (§4).
- **Stage 1 — measure (the decision gate for Stage 3; needs a device):** the
  shipped hydrator breadcrumbs (`hydrationLoadStateCacheMs`, `…TailReadMs`,
  `…FullReplayReadMs`) report real `loadStateCache` size/time from actual boots.
  Get p50/p95/p99 to confirm where on the curve real installs sit. No longer a
  prerequisite for the _blob fix_ (Stage 2 is self-gating, below) — but it **is**
  the explicit go/no-go for Stage 3: the entire deferral of the only real tail fix
  rests on the unverified assumption that the population is small, and an op-log
  grows over time (the same "after ~a year" dynamic that caused the original
  CursorWindow data loss). If p95/p99 shows a real multi-10 MB tail, Stage 3 starts
  — it is not a "long-term maybe," it is _the_ fix that's merely been deferred.
- **Stage 2 — blob compression: ✅ done.** `value-codec.ts` gzips (fflate) the
  SQLite `value` column at rest, base64'd behind a `~gz1:` marker, wired into
  `buildInsert`/`decodeRow`. **Self-gating by size** (`COMPRESS_THRESHOLD_BYTES`
  = 2 KB): only large values compress, so ops + small snapshots stay plain JSON
  with zero overhead — which is why it ships safely _without_ the Stage 1 data
  (it can only help the large-blob case, never hurt the small one). Purely a
  **local storage-at-rest** encoding — the adapter decodes back to objects before
  anything above it (sync/hydration) sees them, so it is not a cross-client/sync
  format and carries no compat obligation. Reversible (stop compressing → new
  writes are plain → reads still handle both via the marker). **Monotonic:** the
  encoder keeps the _smaller_ of compressed-vs-plain, so a poorly-compressible value
  just over the threshold (random IDs, embedded base64, encrypted sub-blobs) can
  never grow the row — gzip's near-zero gain there would otherwise be swamped by
  base64's ~33 % inflation. ~3-5× on the typical (compressible) blob; great for the
  typical < 2 MB user, ~1-1.5 s at the 30 MB tail. Note this is a constant-factor
  shave on the _bridge transfer_ that also adds a synchronous `gunzip`+`JSON.parse`
  on the boot thread for the common large snapshot; it does **not** touch the
  intrinsic `JSON.parse` floor (see below). It also has a real **correctness**
  upside on the largest accounts: it shrinks the single `value` cell well under
  Android's ~2 MB CursorWindow read limit (the same limit behind the original
  native-KV data loss), keeping the snapshot readable where an uncompressed
  multi-10 MB cell could trip `SQLiteBlobTooBigException`. Covered by
  `value-codec.spec.ts` (incl. the monotonic guard) + an end-to-end large-value
  round-trip on both engines.
  **Snapshot-in-IDB stays deliberately shelved** — for the right reasons. (The
  earlier rationale "it breaks the atomic snapshot/ops/clock rotation" is _wrong_:
  that rotation is **already non-atomic and crash-tolerant by design** — compaction
  writes the snapshot, then prunes ops in a separate step, and a crash between them
  is safe because the op-log stays the source of truth and the snapshot is a
  self-describing rebuildable cache.) The real reasons to shelve: (a) it
  re-introduces the **eviction surface** we just paid to remove, for the snapshot;
  (b) it permanently splits storage across two backends (a hard-to-reverse layout +
  a doubled bootstrap/migration/failure-mode matrix in the most sensitive
  subsystem); (c) the win (~1 s) only matters for a _rare_ huge account and is zero
  for the typical < 2 MB user. Reconsider only if real data shows a large population
  with multi-10 MB snapshots **and** compression proves insufficient **and**
  lazy-loading (Stage 3) is off the table.
- **Stage 3 — long-term, only if needed:** incremental / lazy state load. A 30 MB
  single-blob snapshot is expensive to read+deserialize+load in _any_ store; this
  is the only thing that makes huge accounts boot cheaply (and the real answer for
  the 10-30 MB tail), but it's a real rearchitecture.

**Floor to be honest about:** at 30 MB, compression cannot beat IndexedDB — the
inner `JSON.parse` of a 30 MB object (~0.5-0.8 s) is intrinsic to the
JSON-in-a-cell model; only structured clone (the shelved IDB-snapshot option) or
lazy loading (Stage 3) avoids it. That's why Stage 3 is the real fix for the tail.

### Migration blocks boot (behind the splash) — safe, but a UX follow-up for huge accounts

The IDB→SQLite migration runs on the **boot-critical path**: `DataInitService`
`await`s `hydrateStore()` → `loadStateCache()` → `NativeOpLogAdapter.init()` →
`bootstrapNativeOpLogBackend()` → `await migrateOpLogBackend()`
(`native-sqlite-backend.ts:158-204`). State can't hydrate until it finishes, so the
~27 s (real-device, 50k ops) migration is ~27 s before the app has data.

This is **safe, not a silent hang**: the static `.app-loading` splash (`index.html`,
logo + spinner) shows throughout — not a frozen/black screen — and the copy is one
atomic transaction with **verify-before-commit**, with the "done" marker written
only _after_ commit. A force-quit mid-migration rolls back cleanly and retries next
launch; no partial/corrupt state.

The only soft spot: there is **no migration-specific progress** ("Migrating your
data…"), so a huge-account user _could_ impatiently force-quit a long spinner
repeatedly and never get past it. **Follow-up (YAGNI-gated):** add a migration
progress/explainer to the splash — but only build it if staged-rollout telemetry
shows real users hitting long migrations; most accounts are far under 50k ops
(1k≈0.3 s, 10k≈2.4 s).

### Rollout gate (the real validation of real-data migration)

Everything tested so far used **synthetic throwaway data** — a _real populated_
IDB→SQLite migration has not run on hardware (the side-by-side `.debug` install
starts empty by design). The intended instrument for that is the staged Play
Console rollout: ramp **1 % → up**, holding while the `opLogSqliteMigrationFailed`
and `opLogSqliteFellBackToIdb` breadcrumbs stay quiet. The fail-loud + in-session
IDB fallback + durable marker exist precisely so a bad migration surfaces in
telemetry instead of silently losing data. Do **not** ship to 100 % on synthetic
validation alone; the rollout _is_ the real-data test (and yields the Stage 1
snapshot-size distribution as a bonus).

---

## Sources

- WHATWG Storage Standard; [MDN — Storage quotas & eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria); [web.dev — Persistent storage](https://web.dev/articles/persistent-storage)
- [chromium-discuss — persist() not implemented in WebView](https://groups.google.com/a/chromium.org/g/chromium-discuss/c/AWMgYFD_gJs)
- [capacitor#7594 — Persist storage (closed, not planned)](https://github.com/ionic-team/capacitor/issues/7594); [Capacitor storage guide](https://capacitorjs.com/docs/guides/storage)
- [Android — Auto Backup](https://developer.android.com/identity/data/autobackup); [Android — Access app-specific files](https://developer.android.com/training/data-storage/app-specific)
- [RxDB — Capacitor database](https://rxdb.info/capacitor-database.html)
- In-repo: `d6475999e2` (#8402 CursorWindow fix); `android/app/src/main/java/com/superproductivity/superproductivity/app/KeyValStore.kt`; `src/app/imex/local-backup/local-backup.service.ts`; `src/app/core/startup/startup.service.ts`; `src/app/op-log/persistence/{op-log-backend-migration.ts,sqlite-op-log-adapter.ts,indexed-db-op-log-adapter.ts,native-sqlite-backend.ts}`
