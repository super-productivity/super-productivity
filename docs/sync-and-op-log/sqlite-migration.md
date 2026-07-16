# SQLite Migration Plan — Op-Log Persistence

> Status: **Phase A complete; Phase B in progress.** Tracks the data-loss
> class behind issue #7892 (Android WebView storage evicted → total data loss
> with no sync configured).
>
> **Progress:**
>
> - ✅ `OpLogDbAdapter` / `OpLogTx` port + declarative schema descriptor.
> - ✅ `IndexedDbOpLogAdapter` (faithful `idb` backend) + 30 specs.
> - ✅ `adoptConnection()` seam: the adapter shares the owning service's single
>   connection, so each service migrates method-by-method with one connection
>   and no spec breakage.
> - ✅ **`OperationLogStoreService` fully migrated** — every method routes
>   through the adapter, including the two flagship atomic flows
>   (`appendWithVectorClockOverwrite`, `runDestructiveStateReplacement`). No direct
>   `this.db` calls remain.
> - ✅ **`ArchiveStoreService` fully migrated** (own adopted connection +
>   `_withRetryOnClose` re-adopt path).
> - ✅ **Phase B step 1 — DI:** both services inject `OP_LOG_DB_ADAPTER_FACTORY`
>   (a factory token; each service gets its own adapter). `adoptConnection` is
>   now an optional, IDB-only bridge method on the interface.
> - ✅ **Phase B step 2 — `SqliteOpLogAdapter` (fully implemented):**
>   dependency-free schema→table planning + DDL (`planTables`/`buildDdl`),
>   value→column extraction, all query/index/range/count methods, cursor
>   `iterate` (incl. keyed + delete), and `BEGIN/COMMIT/ROLLBACK` transactions
>   with rollback-on-throw and SQLite→`DOMException` error mapping
>   (UNIQUE→ConstraintError, disk-full→QuotaExceededError). Talks only to a
>   minimal `SqliteDb` port, so no native dependency. 23 specs validate the
>   translation layer + transaction semantics against an in-memory SQLite
>   stand-in.
> - ✅ **Phase B step 3 — real-engine validation (CI):** `sql.js` served into
>   Karma drives the adapter's behavioral contract (`sqlite-op-log-adapter.spec.ts`)
>   and a store-level pass (`remote-apply-store-port.integration.spec.ts`) against
>   actual SQLite. Confirms the `UNIQUE`→`ConstraintError` mapping,
>   `AUTOINCREMENT`-after-`clear()`, compound-index/NULL ranges, real
>   `BEGIN IMMEDIATE` rollback. No surprises.
> - ✅ **Phase C step (algorithm) — backend migration:** `migrateOpLogBackend`
>   (`op-log-backend-migration.ts`) copies the whole DB source→dest with
>   verify-before-commit; tested real-IDB → sql.js. Not yet wired into startup.
> - ⏳ Remaining (device-gated): add `@capacitor-community/sqlite` + a thin
>   `SqliteDb` wrapper over its `SQLiteDBConnection` (with the bridge-perf
>   mitigations — see followup B1), override `OP_LOG_DB_ADAPTER_FACTORY` for
>   native behind a flag, fix the store `init()` to call `adapter.init()` / skip
>   the IDB open on SQLite (see followup B3), wire the C1 migration trigger, and
>   run on-device. The other small IDB consumers (theme, credential, oauth,
>   client-id) are out of the data-loss scope (Phase D).
>
> **Open decisions (need on-device validation):**
>
> - Adding `@capacitor-community/sqlite` is a native dependency that can't be
>   validated in CI (its web build is WASM-on-IndexedDB, not the native path;
>   sql.js's universal build statically imports `node:` modules webpack can't
>   bundle for Karma). Defer the plugin + on-device run to a device-capable
>   environment.
> - Consider shipping the cheap #7892 safeguards independently and sooner:
>   diagnostic logging of `navigator.storage.persist()` result on native, and a
>   periodic Capacitor Filesystem auto-backup (a second copy outside the
>   evictable WebView store).
> - Gate after each group: 170 store unit + 3 archive unit + 367 op-log
>   integration specs green.

> **Follow-up backlog:** the actionable, ordered list of what remains (the
> near-term #7892 safeguards, the native SQLite wiring, and data migration)
> lives in [`sqlite-migration-followup.md`](./sqlite-migration-followup.md).

## 0. Goal & non-goal

**Goal:** On **native (Capacitor iOS/Android)**, move the op-log persistence off
WebView IndexedDB into app-private SQLite, so task data no longer lives in the
OS-evictable WebView sandbox.

**Non-goal:** Replacing IndexedDB on web/PWA/Electron. Those either have no
native SQLite or an already-adequate persistence model (Electron). Note that
`@capacitor-community/sqlite`'s **web** build falls back to WASM SQLite
persisted _into IndexedDB_ — which reintroduces the exact eviction risk. So this
is a **native-only backend swap behind a shared abstraction**, not a global
rewrite.

## 1. Why (root cause)

On Capacitor Android the app is a WebView. All op-log data lives in the
WebView's IndexedDB (`SUP_OPS` database), which is subject to OS eviction under
storage pressure and to being cleared as "cache" by the system or cleaner apps.
`navigator.storage.persist()` (`startup.service.ts`) is the only mitigation
today, and on Android WebView it is unlikely to be honored — and the
"persistence not allowed" warning is deliberately suppressed on native. Moving
the data into app-private SQLite (`/data/data/<pkg>/databases/`) makes it
non-evictable; only a full _Clear storage_ or uninstall removes it.

## 2. Today's constraints (from the code)

- **No storage-adapter seam exists.** 8 non-test files import `idb` directly.
  `operation-log-store.service.ts` is ~1,750 lines implementing
  `RemoteOperationApplyStorePort` + ~40 more public methods over ~84
  transaction/index/cursor calls.
- **Prior art:** the legacy `pfapi` layer injected an `IndexedDbAdapter` behind a
  `DBAdapter` interface (`src/app/pfapi/api/pfapi.js`). Same _pattern_, revived
  for the op-log system.
- **Critical DB is `SUP_OPS`** (9 stores). Other IDB databases (`SUPThemes`,
  `sup-sync`, `sup-plugin-oauth`, legacy `pf`) are cosmetic / re-acquirable /
  read-only-migration and are out of scope for the data-loss fix.
- **Atomicity is the hard part**, not CRUD. Two methods need single-transaction
  multi-store writes that MUST stay atomic:
  - `appendWithVectorClockOverwrite()` — OPS + VECTOR_CLOCK in one tx.
  - `runDestructiveStateReplacement()` — OPS + STATE*CACHE + VECTOR_CLOCK +
    CLIENT_ID (+ ARCHIVE*\*) in one tx (crash-safety, issues #7709, #7732).
    Plus: auto-increment `seq` keypath, a **unique** `byId` index, and a compound
    `[source, applicationStatus]` index.
- **38 integration specs** in `op-log/testing/integration/` exercise this store;
  several are IDB-specific (`indexeddb-error-recovery`, `clean-slate-interrupt`,
  `multi-entity-atomicity`, `race-conditions`). These are the regression gate.

## 3. Strategy: adapter seam first, SQLite second

### Phase A — Extract the persistence port (no behavior change) ⭐ highest risk/effort

Define `OpLogDbAdapter` (+ `OpLogTx`) expressed so neither IDB nor SQL leaks
through — shaped around the operations the store needs, with a **callback-based
`transaction()`** as the atomicity linchpin (IDB auto-commit and SQLite
`BEGIN/COMMIT` both map onto "run fn, commit on resolve, roll back on throw").

1. Define `OpLogDbAdapter` / `OpLogTx` interfaces + a declarative `StoreSchema`
   descriptor (replacing `runDbUpgrade`'s imperative
   `createObjectStore`/`createIndex`).
2. Implement `IndexedDbOpLogAdapter` over `idb` — faithful wrapper of today's
   behavior incl. open-retry, `versionchange`/`close` listeners, and
   `ConstraintError`→duplicate / `QuotaExceededError` mappings.
3. Refactor `operation-log-store.service.ts` + `archive-store.service.ts` onto
   the injected adapter. **No behavior change.**
4. Keep all 38 integration specs green against the IDB adapter — the gate.

> Ship Phase A on its own. Pure refactor, independently valuable, nothing
> user-visible changes.

### Phase B — SQLite backend (native only)

1. Add `@capacitor-community/sqlite` + iOS/Android native config.
2. Implement `SqliteOpLogAdapter implements OpLogDbAdapter`:
   - One table per store. Ops table: `seq INTEGER PRIMARY KEY AUTOINCREMENT`,
     `op_id TEXT UNIQUE` (→ `byId`), index on `synced_at` and
     `(source, application_status)`. Singleton stores → single-row tables keyed
     by `SINGLETON_KEY`.
   - Store the encoded `CompactOperation` as a JSON/TEXT `payload` column — no
     need to query inside ops, so `encode/decodeOperation` is unchanged.
   - `transaction()` → `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` (real ACID,
     stronger than IDB's auto-commit-on-microtask-gap).
   - Map SQLite errors → the same `StorageQuotaExceededError` / duplicate-op
     errors the rest of the system expects.
3. **DI wiring:** bind `OpLogDbAdapter` to `SqliteOpLogAdapter` when
   `platformService.isNative`, else `IndexedDbOpLogAdapter`. One token, one
   factory; the store doesn't know which backend it has.

### Phase C — One-time data migration (native, first launch after update)

1. Detect: SQLite empty/absent **and** legacy `SUP_OPS` IndexedDB present.
2. Copy OPS, STATE*CACHE, VECTOR_CLOCK, CLIENT_ID, ARCHIVE*\* IDB→SQLite in one
   SQLite transaction (reuse IDB adapter read side + SQLite adapter write side).
3. Verify (count + last-seq + vector-clock match), set a migration-complete
   marker, **keep the IDB copy untouched** ≥1 release as fallback.
4. Slots into the existing `_initBackups()` / `loadStateCache()` startup flow,
   mirroring the proven legacy `pf`→`SUP_OPS` migration pattern.

### Phase D — Other databases (optional, deferred)

`SUPThemes`, `sup-plugin-oauth`, `sup-sync` are cosmetic / re-acquirable;
migrate only if fully evacuating WebView storage. They do not affect the #7892
data-loss class.

## 4. Sequencing & rollout

1. **Phase A** → merge behind no flag (IDB still the only backend). Gate: all
   unit + 38 integration specs green.
2. **Phase B + C** → merge behind a native feature flag, default **off**.
   Dogfood on real Android devices.
3. Parameterize the integration harness to run a **second time against
   `SqliteOpLogAdapter`** — catches auto-increment/unique-index/atomicity gaps.
4. Staged enable on native; retain IDB fallback ≥1 release; then add cleanup.

## 5. Risk register

| Risk                                                     | Severity | Mitigation                                                                                                    |
| -------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| Refactor regresses sync correctness                      | High     | Phase A behavior-preserving; 38 specs gate; run suite against both adapters                                   |
| Atomicity differs (IDB auto-commit vs SQL BEGIN/COMMIT)  | High     | Callback `transaction()`; SQLite stricter; dedicated `runDestructiveStateReplacement` interrupt specs (#7709) |
| `@capacitor-community/sqlite` web fallback = WASM-on-IDB | Medium   | Native-only binding; never use SQLite backend on web/PWA                                                      |
| Migration data loss/corruption                           | High     | Verify-before-mark; retain IDB copy ≥1 release; reuse `pf`→`SUP_OPS` pattern                                  |
| Plugin/native build complexity                           | Medium   | Standard Capacitor plugin; CI for both platforms                                                              |
| `seq` autoinc + `byId` unique parity                     | Medium   | Schema-level `AUTOINCREMENT` + `UNIQUE`; explicit parity specs                                                |

## 6. Effort

- **Phase A** is the bulk (multi-week; touches the most correctness-sensitive
  subsystem). This cost exists regardless of SQLite.
- **Phase B** is comparatively small once A exists — the "just another adapter"
  part.
- **Phase C** moderate, pattern-matched to existing code.
- **Phase D** optional.

Because Phase A takes months of careful work, pair this with the cheap interim
mitigations (diagnostic logging of `persist()` result on native; native
filesystem auto-backup) so users are protected in the meantime.
