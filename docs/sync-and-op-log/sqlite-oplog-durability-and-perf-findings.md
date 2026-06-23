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
  2. ✅ **WAL pragmas** — done. `CapacitorSqliteDb._applyPerfPragmas` runs
     `PRAGMA journal_mode=WAL; synchronous=NORMAL` best-effort on every open
     (non-fatal; native-only, validate on-device). Faster autocommit appends +
     non-blocking reads.
  3. ✅ **Android Auto Backup exclusion** — done (§4).
- **Stage 1 — measure (still pending, needs a device):** the shipped hydrator
  breadcrumbs (`hydrationLoadStateCacheMs`, `…TailReadMs`, `…FullReplayReadMs`)
  report real `loadStateCache` size/time from actual boots. Get p50/p95/p99 to
  confirm where on the curve real installs sit. No longer a prerequisite for the
  blob fix — Stage 2 is self-gating (below).
- **Stage 2 — blob compression: ✅ done.** `value-codec.ts` gzips (fflate) the
  SQLite `value` column at rest, base64'd behind a `~gz1:` marker, wired into
  `buildInsert`/`decodeRow`. **Self-gating by size** (`COMPRESS_THRESHOLD_BYTES`
  = 2 KB): only large values compress, so ops + small snapshots stay plain JSON
  with zero overhead — which is why it ships safely _without_ the Stage 1 data
  (it can only help the large-blob case, never hurt the small one). Purely a
  **local storage-at-rest** encoding — the adapter decodes back to objects before
  anything above it (sync/hydration) sees them, so it is not a cross-client/sync
  format and carries no compat obligation. Reversible (stop compressing → new
  writes are plain → reads still handle both via the marker). ~3-5× on the blob;
  great for the typical < 2 MB user, ~1-1.5 s at the 30 MB tail. Covered by
  `value-codec.spec.ts` + an end-to-end large-value round-trip on both engines.
  **Snapshot-in-IDB stays deliberately shelved:** it reads sub-second even at
  30 MB, but it splits the atomic snapshot/ops/clock rotation across two backends
  — a new failure surface in the most sensitive part of the system, and a
  hard-to-reverse data-layout choice — to shave ~1 s off a _rare_ huge-account
  boot. Reconsider only if real data shows a large population with multi-10 MB
  snapshots **and** compression proves insufficient **and** lazy-loading (Stage 3)
  is off the table.
- **Stage 3 — long-term, only if needed:** incremental / lazy state load. A 30 MB
  single-blob snapshot is expensive to read+deserialize+load in _any_ store; this
  is the only thing that makes huge accounts boot cheaply (and the real answer for
  the 10-30 MB tail), but it's a real rearchitecture.

**Floor to be honest about:** at 30 MB, compression cannot beat IndexedDB — the
inner `JSON.parse` of a 30 MB object (~0.5-0.8 s) is intrinsic to the
JSON-in-a-cell model; only structured clone (the shelved IDB-snapshot option) or
lazy loading (Stage 3) avoids it. That's why Stage 3 is the real fix for the tail.

---

## Sources

- WHATWG Storage Standard; [MDN — Storage quotas & eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria); [web.dev — Persistent storage](https://web.dev/articles/persistent-storage)
- [chromium-discuss — persist() not implemented in WebView](https://groups.google.com/a/chromium.org/g/chromium-discuss/c/AWMgYFD_gJs)
- [capacitor#7594 — Persist storage (closed, not planned)](https://github.com/ionic-team/capacitor/issues/7594); [Capacitor storage guide](https://capacitorjs.com/docs/guides/storage)
- [Android — Auto Backup](https://developer.android.com/identity/data/autobackup); [Android — Access app-specific files](https://developer.android.com/training/data-storage/app-specific)
- [RxDB — Capacitor database](https://rxdb.info/capacitor-database.html)
- In-repo: `d6475999e2` (#8402 CursorWindow fix); `android/app/src/main/java/com/superproductivity/superproductivity/app/KeyValStore.kt`; `src/app/imex/local-backup/local-backup.service.ts`; `src/app/core/startup/startup.service.ts`; `src/app/op-log/persistence/{op-log-backend-migration.ts,sqlite-op-log-adapter.ts,indexed-db-op-log-adapter.ts,native-sqlite-backend.ts}`
