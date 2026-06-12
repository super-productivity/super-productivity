# Operation Log Infrastructure — Deep Analysis (June 2026)

**Scope:** `src/app/op-log/` (~31k lines, 139 source files), `src/app/core/persistence/operation-log/`,
`packages/sync-core`, `packages/sync-providers`, the capture/apply wiring in
`src/app/util/local-actions.token.ts` + meta-reducer registry, and all docs in
`docs/sync-and-op-log/`.

**Method:** six parallel deep-read passes (capture, apply/hydration, persistence,
sync orchestration, validation/backup/peripherals, package boundaries), each
reading source in full, cross-checked against the design docs. Findings below
are de-duplicated and prioritized. Line numbers are as of commit `5e63eeb`.

**Overall verdict:** the architecture is sound and unusually well-documented —
the docs accurately match the code, the rejected-alternatives rationale is
load-bearing, vector-clock discipline (compare-before-prune, server prunes
after comparison) is consistent everywhere checked, and the package extraction
to `@sp/sync-core` / `@sp/sync-providers` is real (no duplicated algorithms
found). The debt is concentrated in: (1) a handful of genuine correctness
windows on failure paths, (2) one structural liability — the capture-side FIFO
queue — that causes most of the concrete bugs found, (3) duplicated
orchestration blocks in the two biggest services, and (4) a sizeable dead-code
inventory left over from completed migrations.

---

## 1. Correctness findings (fix before/independent of any refactor)

Ordered by (impact × likelihood). Each is a small, individually shippable fix.
Per CLAUDE.md, all of these are sync-critical: land individually with
regression specs.

### C1. Piggybacked ops can be permanently lost (upload path persists `lastServerSeq` too early)

`operation-log-upload.service.ts:336-356` persists `setLastServerSeq()` inside
the upload loop, covering piggybacked ops that are only *applied later* by the
caller (`operation-log-sync.service.ts:296`), after the upload lock is
released. If anything between upload return and `processRemoteOps` completion
throws — or the user cancels the piggybacked-SYNC_IMPORT dialog
(`operation-log-sync.service.ts:264-266`) — the next download starts past those
seqs and the ops are never re-fetched. This violates the invariant the download
path explicitly maintains ("persist lastServerSeq AFTER ops are stored",
`operation-log-sync.service.ts:815-821`; cancel-before-persist at :692 vs
:819).

**Fix:** upload service returns `seqToStore` without persisting; the sync
service persists after piggyback processing succeeds, mirroring the download
path. *Effort: M. Risk: M. Add a crash/cancel-window spec.*

### C2. Failed-op bookkeeping diverges from NgRx reality → double-apply on retry

`packages/sync-core/src/replay-coordinator.ts:115-137` dispatches **all** N ops
to NgRx up front; if the archive side effect for op *k* later throws,
`remote-apply.ts:132-138` marks ops *k..n* FAILED even though their state
changes already landed. `retryFailedRemoteOps()`
(`operation-log-hydrator.service.ts:577`) then re-dispatches them on next boot
— a second application of order-sensitive ops (moves, planTasksForToday).
Compounding it, the retry loop replays ops **one at a time**
(:576-589), so the same-batch archive pre-scan
(`bulk-archive-filter.util.ts`) sees one op per call and loses the issue-#7330
strip protection (can resurrect archived tasks in TODAY).

**Fix:** (a) distinguish "NgRx applied, archive side effect pending" from "not
applied" — retry only the archive handler call, not the dispatch (or persist a
separate archive-retry queue); (b) retry failed ops in **one**
`applyOperations(failedOps)` call ordered by seq. (b) alone is low-effort and
closes the #7330 regression vector. *Effort: (b) L, (a) M. Risk: M.*

### C3. Lock-timeout during capture drops buffered ops and wedges the sync flush

`operation-log.effects.ts:106` — `concatMap((action) => this.writeOperation(action))`
with `writeOperation` re-throwing `LockAcquisitionTimeoutError` (:313-323)
errors the effect stream: every action sitting in `concatMap`'s buffer is
silently discarded (ops never written), and each leaves a leaked capture-queue
entry, after which `flushPendingWrites()` can never reach 0 → every sync hits
the 30s timeout (`operation-write-flush.service.ts:78-95`) until reload.

**Fix:** catch per-action in the effect pipe
(`concatMap((a) => this.writeOperation(a).catch((e) => this.handleEffectWriteFailure(a, e)))`),
keep the throw for the deferred-actions caller (#7700 behavior unchanged).
*Effort: S. Risk: L-M.*

### C4. Double-dequeue in the quota-exceeded retry path (one-line fix)

`operation-log.effects.ts:491` — `handleQuotaExceeded` calls
`writeOperation(action, skipDequeue /* = false */, options)` after the first
attempt already dequeued (:183). On retry it consumes the *next* pending
action's queue entry; every subsequent op's `entityChanges` shift by one and
the flush counter undercounts. Quota-exceeded is exactly when many ops are in
flight.

**Fix:** pass `true` ("already dequeued"). *Effort: trivial + unit test.*
(Subsumed by S1 below, but worth fixing immediately.)

### C5. `saveCurrentStateAsSnapshot()` has an unlocked lost-update window

`operation-log-snapshot.service.ts:82-132` reads NgRx state (:85), then
`getLastSeq()` (:104) **without** holding `LOCK_NAMES.OPERATION_LOG` (appends
do hold it — `operation-log.effects.ts:305`). An op appended between the two
reads has seq ≤ the recorded `lastAppliedOpSeq` while its effect is absent from
the captured state → tail replay starts after it → silently never applied.
Compaction does the identical sequence *inside* the lock
(`operation-log-compaction.service.ts:61-116`).

**Fix:** take the lock (matching compaction), and/or invert the order
(`getLastSeq()` first — degrades to harmless re-replay instead of loss).
*Effort: tiny. Risk: L.*

### C6. Sync side channels are not mutually excluded

`ImmediateUploadService` (`immediate-upload.service.ts:132`) and
`WsTriggeredDownloadService` (`ws-triggered-download.service.ts:43`) both
*check* `providerManager.isSyncInProgress` but neither *sets* it, so they can
interleave with each other. Inner critical sections are locked, but the seams
between them are not: SYNC_IMPORT conflict-gate decisions
(`sync-import-conflict-gate.service.ts:60`), `setLastServerSeq` persistence,
and `mergeRemoteOpClocks` ordering all run outside any lock. Store-level dedup
contains most damage, but the gate-decision→apply TOCTOU is real.

**Fix:** a single `SYNC_CYCLE` lock, or a shared in-progress flag both channels
set and respect. *Effort: L-M. Risk: L.*

### C7. Full-state remote ops apply without the op-log lock or write flush

`remote-ops-processing.service.ts:268-289` — the SYNC_IMPORT/BACKUP_IMPORT
branch calls `applyNonConflictingOps` directly, skipping
`writeFlushService.flushPendingWrites()` and
`lockService.request(LOCK_NAMES.OPERATION_LOG, ...)` that the regular path
acquires (:329-335). A local op captured mid-import lands with a stale clock.

**Fix:** wrap the full-state branch the same way (the `callerHoldsLock`
plumbing already exists). *Effort: L. Risk: L.*

### C8. `forceDownloadRemoteState` (USE_REMOTE) only resets the vector clock when the server returned a snapshot clock

`operation-log-sync.service.ts:961-969` — when no `snapshotVectorClock` is
returned (small datasets / no snapshot optimization), the polluted clock from
discarded local ops survives; later local ops can compare GREATER_THAN against
remote state they never saw and silently win conflicts.

**Fix:** rebuild from `allOpClocks` (already returned on `forceFromSeq0`
downloads, `operation-log-download.service.ts:222-230`) as a fallback.
*Effort: L. Risk: M (clock-sensitive; needs the rejection-loop specs).*

### C9. SQLite adapter: two bugs to fix before the native token flip (#7931 B3)

Both invisible to current users (adapter unwired) but wrong-answer/perf-cliff
bugs once flipped:

- **NULL-key rows leak into index scans.** `sqlite-op-log-adapter.ts:477-526`
  (`sqlIterate`) doesn't filter NULL index columns; IDB index cursors exclude
  them. Concrete consequence: `hasSyncedOps()`
  (`operation-log-store.service.ts:1023-1044`) returns `true` on a
  never-synced client with one local op → spurious server-migration scenario
  (`operation-log-download.service.ts:365`). **Fix:** `WHERE <col> IS NOT NULL`
  when iterating an index without an exact query + a dual-backend spec.
- **`getLastSeq()` becomes O(N).** `sqlIterate` materializes and JSON-parses
  the whole table before the visitor can stop; `getLastSeq()` (used by
  `getUnsynced()`/`getAppliedOpIds()` on every sync tick) does
  `direction: 'prev'` + stop-at-first. **Fix:** `limit` pushdown on
  `DbIterateOptions` or a `maxKey(store)` port method.

### C10. Repair pipeline throws on corrupt data

Several of the 27 passes in `data-repair.ts` `throw` on conditions earlier
passes were supposed to fix (:1077, :1097, :1146, :1200, :1218, :1251, :1280,
:1303, :1326, :1350) — a repair routine that crashes on corruption aborts the
entire backup import (`backup.service.ts:141-144`) and fails
`validateAndRepair`. Nothing but the call order at :109-137 guarantees the
invariants.

**Fix:** replace throws with log-and-skip (+ summary entry). *Effort: S.
Risk: L. Immediate robustness win for the import/repair flows.*

### C11. `BACKUP_IMPORT` confirm dialog inside the remote apply path can wedge sync

`archive-operation-handler.service.ts:497-511, 536-547` — a blocking native
`confirm()` fires while applying a *remote* op; on cancel the op is marked
FAILED and re-prompts on **every startup** (and can fire twice per op:
young + old archive). Combined with C2, NgRx already applied the import while
the archive didn't — inconsistent until the user relents.

**Fix:** decide once per op; on cancel mark rejected/skipped rather than
failed-retryable, or replace with a non-blocking safe default (preserve local,
as the SYNC_IMPORT branch does). Needs a product decision. *Effort: L-M.*

### Lower-severity correctness notes

- **Example-task op discard ordering** is inconsistent between the
  snapshot-hydration path (defers `markRejected` until hydration succeeds,
  `operation-log-sync.service.ts:476-479`) and the two conflict-gate paths
  (discard before processing, :287, :753). Align on defer. *Trivial.*
- **Hydrator's hand-rolled apply window has no `try/finally`**
  (`operation-log-hydrator.service.ts:259-269, 345-353`): a reducer exception
  leaves `isApplyingRemoteOps` stuck true, buffering all local actions into the
  deferred queue until the 100-item cap drops them. Fixed for free by S2 below.
- **LWW crash-safety banner** in `conflict-resolution.service.ts` ("marks
  rejected BEFORE applying") is slightly overstated — remote-wins ops are
  appended `pendingApply` (:328) before locals are rejected (:388). Self-healing
  via `RejectedOpsHandlerService`; document, don't fix.

---

## 2. The single biggest simplification: delete the capture FIFO queue

Two independent passes converged on this from opposite ends:

- **Capture side:** `OperationCaptureService` (`operation-capture.service.ts:53-158`)
  maintains a FIFO of `EntityChange[]` correlated with actions **purely by
  position**. The payload is a *pure function of the action*
  (`_extractEntityChanges`), and is `[]` for every action type except
  TIME_TRACKING and `syncTimeSpent` — i.e. nearly all queue traffic is empty
  arrays whose only job is keeping indices aligned. The positional contract is
  the root cause of C3 and C4, requires the meta-reducer filter
  (`operation-capture.meta-reducer.ts:222-233`) and the effect filter
  (`operation-log.effects.ts:99-104`) to stay in lockstep with no shared
  predicate, and drags along the `skipDequeue`/`WeakSet` deferred-action
  choreography and lock-ordering comments (:297-304).
- **Apply side:** `entityChanges` is captured and validated
  (`validate-operation-payload.ts:524-536`) but **never consumed at apply
  time** — `convertOpToAction` reads only `actionPayload`; the upload side even
  documents "entityChanges are empty"
  (`operation-log-upload.service.ts:458`). TIME_TRACKING reducers replay from
  `actionPayload`, which carries the same data.

**Proposal:** compute `entityChanges` in `writeOperation()` directly from the
action (or, after verifying server/old-client behavior, always write
`entityChanges: []` and delete the extraction too — keep the wire field).
Replace the flush signal (`operation-write-flush.service.ts:66`) with a pending
counter incremented in the meta-reducer and decremented in a `finally` inside
`writeOperation`, so errors can't leak it. This deletes ~half of
`OperationCaptureService`, the dequeue-race comments, the `skipDequeue`
plumbing, and the entire positional-desync bug class (C3's wedge, C4).

*Effort: M (1-2 days incl. spec updates: `operation-capture.service.spec.ts`,
`race-conditions.integration.spec.ts`, `multi-entity-atomicity.integration.spec.ts`).
Risk: M — behavior-preserving on the happy path, strictly safer on error paths.
Prereq: grep the server + conflict resolution for `entityChanges` consumers.*

---

## 3. Structural simplifications by layer

### S2. Hydrator should delegate to `OperationApplierService` (~150 lines, one latent bug)

`operation-log-hydrator.service.ts` hand-rolls the apply window twice
(:259-269, :345-353) — duplicating what
`applyOperations(ops, { isLocalHydration: true })` already does, minus the
`try/finally`, the event-loop yield, and the deferred-action flush. Its two
~80-line replay branches (:210-285 vs :295-368) differ only in log strings and
a snapshot threshold. Three implementations of "unwrap full-state payload"
exist (`operation.types.ts:142-162` — canonical; `operation-converter.util.ts:37-45`;
hydrator `:426-456`, which also hardcodes the three OpTypes instead of
`isFullStateOpType`).

**Do:** replace both blocks with the applier call; extract one
`_replayOps(ops, { label, saveSnapshotMinOps })`; use
`isFullStateOpType` + `extractFullStateFromPayload` everywhere.
*Effort: L-M. Risk: L (62k-line spec file as the gate).*

### S3. `downloadRemoteOps` orchestration (455 lines) — extract before it grows again

`operation-log-sync.service.ts:386-840`: 6 outcome kinds, 8 early returns,
three separate `isWhollyFreshClient()` checks (:535, :633, :667), and every
historical fix (#6571, #7330, #7339, #7985, #8107) added another inline guard.
Two mechanical extractions de-risk it without a rewrite:

- The piggybacked-SYNC_IMPORT gate block in `uploadPendingOps` (:235-294) is a
  near-verbatim copy of the download-path block (:717-760) → one
  `_runFullStateConflictGate(ops, opts): 'cancelled' | 'handled' | 'proceed'`.
- Snapshot hydration is duplicated between `downloadRemoteOps` (:417-622) and
  `forceDownloadRemoteState` (:975-1015), including the "CRITICAL FIX: write
  recentOps" block twice.

A fuller phase-model refactor (`Download → GateCheck → Process → Upload →
ResolveRejections → Reupload` with the existing `sync-results.types.ts`
unions) is worthwhile but should come after the extractions, piecemeal.
*Effort: extractions L, phase model H. Risk: M — the 127KB spec covers most
paths.*

### S4. `OperationLogStoreService` (1,773 lines): split incrementally

Nine distinct responsibilities, from IDB connection lifecycle to vector-clock
*merge policy* (`mergeRemoteOpClocks`, :1403-1516) to user-profile storage
(:1729-1769, zero op-log coupling). Recommended order:

1. **Profile data out** (only consumer:
   `user-profile-storage.service.ts:63-98`) — cheapest cut.
2. **Clock merge/reset policy → `VectorClockService`** (sync layer), leaving
   only the atomic write in the store — the hardest-to-review logic is
   currently buried between key-value getters.
3. State-cache/compaction-counter and ops-CRUD facades only if still warranted
   after 1-2.

Keep `runDestructiveStateReplacement` (:1626-1728) as the small coordinator —
it's genuinely atomic incl. clientId rotation and a model for the rest.
*Effort: incremental. Risk: gated by the 38 integration specs.*

### S5. Consolidate IDB connection management now, not at Track D1

The open-with-retry + `close`/`versionchange` listener logic exists three times
(`operation-log-store.service.ts:267-341`, `archive-store.service.ts:83-167`,
`indexed-db-op-log-adapter.ts:170-236` — the adapter copy dead at runtime), plus
two redundant `DBSchema` restatements (store :118-192, archive :30-39) alongside
`op-log-db-schema.ts`/`db-upgrade.ts`. The sqlite-migration followup defers
this to "once SQLite is the sole native backend", but letting both services
call `adapter.init()` unconditionally is achievable now and removes
`adoptConnection` from the hot path (~250 lines, two schema copies).
*Effort: M. Risk: M (iOS `_withRetryOnClose` must move into/compose with the
adapter; spy seams in specs relocate).*

Related port cleanups: define domain errors (`DbConstraintError`,
`DbQuotaError`) instead of the `DOMException`-by-name contract that forces the
SQLite adapter to fabricate `DOMException`s (`mapSqliteError`,
`sqlite-op-log-adapter.ts:267-276`; five duplicated catch-mappings in the
store); document/assert that compound `DbKeyRange`s must be degenerate exact
matches (`whereRange` is not IDB-lexicographic, :289-317).

### S6. Unify validate ↔ repair rules (the main drift source in the safety-critical module)

Nearly every check in `is-related-model-data-valid.ts` (668 lines) has a
separately-maintained mirror pass in `data-repair.ts` (1,499 lines) — seven
direct pairs identified, with matching #6270 comments maintained in both
files. Meanwhile ~350 lines of data-repair are triplicated
active/archiveYoung/archiveOld loop bodies, and `.includes` scans are O(n²) on
the archives most likely to need repair.

**Do (incrementally):** (a) `forEachTaskStore(data, fn)` helper (−300 lines);
(b) `Set`-based lookups; (c) colocate each cross-model rule as
`{ id, validate(d), repair(d, summary) }` so the validator and repairer derive
from one definition — one relationship at a time behind the existing
`data-repair.spec.ts` suite. Also: return a result object instead of the
module-level `lastValidityError`/`errorCount` globals
(`is-related-model-data-valid.ts:13-21`, has a TODO already).
*Effort: (a)+(b) L, (c) M-H. Risk: M, spec-gated.*

### S7. Sync-layer dead code and small dedups (~150 lines, near-zero risk)

- `conflict-resolution.service.ts`: `_deepEqual` (:234),
  `_extractEntityFromPayload` (:779), `isIdenticalConflict` (:222, no prod
  caller), `_filterAndAppendOpsWithRetry` (:1094, now a one-line delegate),
  log-only loop (:309-321).
- Dominating-clock construction duplicated 4× with identical "don't prune"
  comments (`conflict-resolution.service.ts:622-629, 665-670`;
  `superseded-operation-resolver.service.ts:140-147, 193-199`) → one
  `buildDominatingClock(clocks, clientId)` next to `mergeAndIncrementClocks`.
- `operation-log-download.service.ts:327-384` calls
  `planDownloadFullStateUpload` three times with near-identical args → one call.
- Dead `hasMorePiggyback` field on `UploadOutcome`
  (`operation-log-sync.service.ts:368`, no reader).
- Error-code string-sniffing `message.includes('SYNC_IMPORT_EXISTS')`
  (`operation-log-upload.service.ts:542-544`) — the codebase itself warns this
  is fragile (`rejected-ops-handler.service.ts:150`); surface a structured
  `errorCode`. Plus the `'CONFLICT_STALE'` TODO (:157).
- Encryption-state detection (`sawAnyOps`/`sawEncryptedOp`) duplicated between
  upload and download; only download uses the core helper.

### S8. Error-handling audit (larger, schedule deliberately)

`core/errors/sync-errors.ts` (460 lines) defines ~45 error classes, a large
fraction pfapi-era file-sync relics feeding the ~20-branch `instanceof` chain
in `sync-wrapper.service.ts:626-850` — an audit would likely retire a third.
More structurally, failure flows through **three parallel channels**: thrown
typed errors, outcome-kind unions (the good pattern), and the global
session-validation latch (`SyncSessionValidationService`) read at four sites —
the comments show the latch was already forgotten twice (immediate-upload, WS
download). Migrating validation failure into the outcome unions removes the
mutable-global channel. *Effort: M-H. Risk: M.*

---

## 4. Dead code & quick-win inventory (one or two near-zero-risk PRs)

**Validation/backup/peripheral:**

- `src/app/pfapi/` (~40KB compiled JS) — header says "safe to delete once all
  users have migrated"; **nothing imports it** (the legacy migration reads the
  old DB via `idb` directly). Verify with a build, delete.
- `validation/repair-global-config.ts` (100% commented out) +
  `validation/fix-number-field.ts` (only referenced from the commented code).
- `fixEntityStateConsistencyOrError` (`check-fix-entity-state-consistency.ts:45-67`)
  — unused **and inverted** (throws when state is consistent). Delete.
- `MODEL_CONFIGS.repair` / `cacheOnLoad` fields (`model-config.ts`) — never
  read; the `repair: fixEntityStateConsistency` callback would, if ever wired,
  reintroduce the #8257 ordering bug (it rebuilds `ids` from `Object.keys`,
  exactly what `data-repair.ts:725-785` carefully avoids). Delete fields; fix
  or delete `fixEntityStateConsistency`.
- Deprecated aliases: `getAllSyncModelDataFromStore(Async)` +
  `PfapiStoreDelegateService` re-export (`state-snapshot.service.ts:79-83,
  166-171, 294`) — finish the rename.
- `validateAppDataProperty` (`validation-fn.ts:149-154`), `validateReminders`
  no-op tombstone (`is-related-model-data-valid.ts:553-557`).
- `state-validity-test-utils.ts` (471 lines, spec-only) → move to
  `op-log/testing/`.

**Persistence store:** `db` getter (:343-353), `getLatestFullStateOp()`
(:634-636), `loadStateCacheBackup()` (:1102-1109), `hasOp()`/`appendBatch()`
(test-only), `countFromIndex()` (zero callers across all three port files),
`OP_LOG_INDEX_NAMES` re-export, `ARCHIVE_STORE_NOT_INITIALIZED`, deprecated
`migrateIfNeeded()`/`getMigrations()`. Plus the **vestigial compaction
counter**: `incrementCompactionCounter()` has zero production callers, the
persisted counter is only ever written as 0 or dropped, so the documented
"crash recovery across restarts" behavior doesn't exist — the 500-op threshold
resets every launch. Re-wire or delete (incl. the `state: null` placeholder
path and the redundant `resetCompactionCounter()` after compaction's
`saveStateCache`). Also: the pre-v3 index fallback scans (:563-573, :958-967)
mask real errors as "index not found"; remove or narrow the catch.

**Apply:** `bulkApplyHydrationOperations` + `bulkHydrationMetaReducer`
(spec-only consumers); `_runLegacyMigrationIfNeeded`/`_runLegacyCleanupIfNeeded`
no-op placeholders in the hydrator startup path.

**Capture:** `getOperationCaptureService()`/`getIsApplyingRemoteOps()`
(spec-only); the ~30-line `consecutiveCaptureFailures` machinery guarding an
array push; misleading "operation will not be captured!" warning (:237-239).

**Packages:** `SyncStateCorruptedError` dead end-to-end (class never
constructed; app shim's only importer is its own spec; comments in
`remote-ops-processing.service.ts:466` + hydrator :579 imply classification
that doesn't exist — delete or actually throw it); deprecated full-state compat
exports in sync-core (`full-state-op-types.ts:26-43`, zero consumers);
`SyncConfigPort` port-to-nowhere (`ports.ts:60-81` + dead
`GlobalConfigService.getSyncConfig()`); `ConflictUiPort.notify?` implemented
nowhere; 0-byte `packages/sync-providers/src/index.ts` leftover.

**Misplaced live code (mechanical moves):**

- `src/app/core/persistence/operation-log/compact/` → actively used by op-log
  only; move to `src/app/op-log/persistence/compact/` (~5 import sites; do NOT
  touch `action-type-codes.ts` content — persisted codes).
- `AppDataCompleteLegacy` imported by validation core from
  `imex/sync/sync.model` — re-home the type to remove op-log→imex coupling.
- App-side `VectorClockComparison` enum (`src/app/core/util/vector-clock.ts:39-44`)
  duplicates the sync-core string union (forces a cast at :143) — the only true
  type duplication from the package migration. Import the union; consider
  moving the wrapper to `op-log/util/`.

**Known-drift bug:** `migrate-legacy-backup.ts` — `V17_VALID_KEYS` (:823-842)
and `_ensureV17Defaults` (:777-817) both omit `section`, so **every legacy
backup import fails validation** and is silently rescued by `dataRepair`
(confirmed by the comment at `data-repair.ts:102-104`), taking the
"data damaged" path incl. `recordCriticalErrorTime()`. Add `section`; derive
`V17_VALID_KEYS` from `Object.keys(MODEL_CONFIGS)` so the next slice can't
drift.

---

## 5. Drift-proofing (make hand-maintained invariants machine-checked)

1. **Entity registry is `Partial`** — `satisfies EntityRegistry<EntityType>`
   does not force a new `EntityType` to be registered;
   `getEntityConfig('NEW')` returns `undefined` at runtime in LWW paths (the
   documented `'virtual'` plugin-data incident was this class of bug). Type the
   literal as
   `satisfies Record<Exclude<EntityType, 'ALL' | 'RECOVERY' | 'MIGRATION'>, HostEntityConfig>`.
   *Small, low risk, high leverage.*
2. **ActionType drift:** adding a persistent action touches the creator, the
   enum, `ACTION_TYPE_TO_CODE`, and a magic `toBe(146)` count; the only
   creator↔enum guard is a per-write O(146) `Object.values().includes()`
   devError (`operation-log.effects.ts:154`). Hoist a module-scope `Set`, and
   add an exhaustive spec asserting set-equality between all
   `isPersistent: true` creators and the enum.
3. **`ARCHIVE_AFFECTING_ACTION_TYPES`** (`archive-operation-handler.service.ts:40-54`)
   must mirror the `handleOperation` switch (:141-190) — derive the array from
   a handler map.
4. **Meta-reducer ordering comments contradict each other** — capture file says
   "any position" (:210-212), registry says "MUST be index 0" with a dead
   rationale, bulk meta-reducer states the *actual* reason (capture must wrap
   bulk so replayed per-op actions aren't re-enqueued). Fix all three to state
   the one true invariant.
5. **`OperationCaptureService` duck-typing** — hard-coded
   `'[TimeTracking] Sync time spent'` string and payload-shape sniffing
   (:147, :166-205) instead of `action.type` against the enum.
6. **`recreate-fallback.const.ts`** — `requiredKeys: readonly string[]` isn't
   checked against `defaults`; a 3-line generic makes the claimed "structural
   lockstep" real.
7. **`bulk-archive-filter.util.ts:210-349`** is a shadow reducer tracking
   `deleteTaskHelper` semantics by hand — add a spec diffing the projection
   against the real reducers for a generated batch.
8. **`getStateSnapshot()` silently returns empty archives** — two call sites
   already document near-miss data loss (`clean-slate.service.ts:98-100`,
   `validate-state.service.ts:119-121`). Rename to
   `getStateSnapshotWithoutArchives()` or drop the archive keys from the return
   type so misuse fails at compile time. Also collapse the 17 copies of
   `select().pipe(first()).subscribe()` (:173-282).
9. **`no-actions-in-effects` lint rule** only covers `*.effects.ts`; a plain
   service can still `inject(Actions)`. Production is currently clean — widen
   the rule with an allowlist for the token file.
10. **`local-actions.token.ts:51`** uses `as any` (violates the repo's own
    rule) — trivially typeable.

---

## 6. What's in good shape (calibration — don't churn these)

- The **docs match the code** (rare): vector-clock invariants table,
  clean-slate semantics, pruning sites, rejected-alternatives rationale.
- `LockService` (Web Locks + fallback), `SyncImportFilterService`, the
  WebSocket service (generation supersession, tab dedup, backoff+jitter).
- The action↔operation conversion is **generically symmetric** — no per-action
  switch to keep in sync; the deliberate one-way read-boundary repairs are
  well-commented.
- The adapter port's callback `transaction()` shape;
  `runDestructiveStateReplacement` atomicity; compaction's fail-safe
  two-transaction direction and #7892 empty-state guard;
  `op-log-backend-migration.ts` verify-before-commit.
- The package split: no duplicated algorithms; app-side providers are genuine
  30-50-line factories; the Zod-validators port split is intentional and sound.
- `clean-slate.service.ts` and the encryption/compression adapters.

---

## 7. Suggested roadmap

**PR batch 1 — correctness one-liners & small fixes (independent, ship first):**
C4 (quota double-dequeue), C5 (snapshot lock), C3 (effect-stream catch),
C2(b) (batch the failed-op retry), C7 (full-state lock+flush), example-op
discard ordering, `section` in legacy backup migration.

**PR batch 2 — dead-code sweeps (near-zero risk):** the §4 inventory in 2-3
PRs (validation batch, persistence batch, packages batch incl. the compat-edge
removal: retarget `@sp/shared-schema` vector-clock consumers to
`@sp/sync-core`, add sync-core to the server's deps, drop the re-export).

**PR batch 3 — the queue removal (S1):** verify `entityChanges` has no
server/old-client reader, then delete the FIFO + `skipDequeue` plumbing with a
pending-counter flush signal. Closes the C3/C4 bug class structurally.

**PR batch 4 — orchestration dedup:** S2 (hydrator → applier), S3 extractions
(conflict gate, snapshot hydration), S7 (sync dead code + dominating-clock
helper).

**PR batch 5 — sequencing-sensitive items:** C1 (`lastServerSeq` ordering),
C6 (side-channel exclusion), C8 (USE_REMOTE clock reset) — each with a
dedicated regression spec; these are the highest-risk/highest-value
correctness changes.

**Before the native SQLite flip (#7931 B3):** C9 (NULL-index filter + `limit`
pushdown), M6-style batch path for `appendBatchSkipDuplicates`.

**Tracked issues (larger, schedule deliberately):** S4 (store split,
incremental), S5 (connection consolidation), S6 (validate↔repair rule
unification), S8 (error audit + latch removal), deprecated
`OpType.SyncImport/...` enum members in sync-core (~50 app call sites),
entity-frontier per-entity clock merge (removes the historical-ops re-download
workaround at `operation-log-sync.service.ts:443-457`).
