# SuperSync Server Decomposition Implementation Plan (v2)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the three giant SuperSync-server files (`sync.service.ts` 2322 LOC, `sync.routes.ts` 1475 LOC, `services/snapshot.service.ts` 1215 LOC) into cohesive, single-responsibility modules without changing behavior, the HTTP/wire contract, or the DB schema.

**Architecture:** `SyncService` / `SnapshotService` remain thin orchestrator **facades** with their public APIs intact. Heavy cohesive clusters move into new collaborators. Pure logic (op-replay, conflict comparison) becomes Prisma-free top-level modules with their own fast unit tests. Eviction is folded into the existing `StorageQuotaService` (it is one concern with quota accounting), not a new sibling.

**Tech Stack:** TypeScript (strict), Fastify 5, Prisma 5.22, Vitest 3, Zod 4. Single-instance server, process-local caches.

> **v2 changelog (from multi-review of v1):** Fixed Task-8 method list (v1 named a non-existent `aggregateFullStateVectorClock`; ~430 LOC of batch-pipeline internals were unassigned) and split it into 8a/8b/8c. Added mandatory `EncryptedOpsNotSupportedError` re-export (v1 would break `sync.routes.ts` + the snapshot spec). Corrected the regression-gate commands (v1 cited specs **excluded** from `npm test`). Folded eviction into `StorageQuotaService` (v1's "inject SnapshotService" watch-out guarded a dependency that does not exist). Merged the two conflict files into one and the four route-helper modules into two; pure modules moved to `src/sync/` top-level (not `services/`). Added the unavoidable, enumerated spec-spy re-points (v1's "specs 100% untouched" premise was proven false for Tasks 6 & 7).

---

## Guiding principles (read before every task)

1. **Facades preserved.** `SyncService` / `SnapshotService` keep every public method signature. No route file is edited except the two explicitly-listed `import` lines (Task 4) — the `syncRoutes` registration body and all reply shapes are unchanged.
2. **No behavior / API / wire / DB change.** Pure structural moves, verbatim. If a move would change behavior, STOP and flag it.
3. **Spec policy — honest version.** No _behavioral_ spec changes. But three spec sites reach private members through `service as unknown as {...}` casts and **must** be re-pointed when their target moves (proven, not hypothetical):
   - `tests/sync.service.spec.ts:924-929` — `vi.spyOn(service as unknown as {...}, '_aggregatePriorVectorClock')` → re-point to the `OperationUploadService` instance (Task 7b).
   - `tests/sync.service.spec.ts:2117-2122` — `service as unknown as { deleteOldSyncedOpsBatch; storageQuotaService }` → after eviction folds into `StorageQuotaService`, spy/assert on `service['storageQuotaService']` (same instance) (Task 5).
     These are the **only** permitted spec edits, committed with `test:` scope, listed per-task. Everything else: specs untouched.
4. **The regression gate is what `npm test` actually runs.** `vitest.config.ts` **excludes** `tests/sync.routes.spec.ts`, `tests/snapshot-skip-optimization.spec.ts`, and all `tests/integration/**`. Per-task baselines name only specs that execute. Integration specs (need a live Postgres) run out-of-band via `npx vitest run --config vitest.integration.config.ts` and are a **pre-merge** gate (Task 8), not a per-task one. No "run twice for timezones" — that is a client-only trait and false here (server `npm test` sets no `TZ`).
5. **Two-phase move technique (mandatory for the 4 big tasks: 2, 4, 6, 7).** Phase A: in the _original_ file, convert the cluster's methods to free functions / a nested class and re-point call sites; run the targeted spec — the compiler + spec catch every `this`-capture and signature error before anything crosses a file boundary. Phase B: relocate the now-self-contained block to the new file, add imports/exports, re-point. Commit after Phase B (or after each phase for Task 7).
6. **One collaborator per task, smallest viable diff.** Move verbatim. No "while I'm here" rewrites (CLAUDE.md: stay in scope).
7. **Tasks are ordered by ascending risk** and each is independently shippable + green. Hard dependencies are stated explicitly.

### Commands

```bash
npm run checkFile <path>                                   # lint+format every .ts touched
cd packages/super-sync-server && npx vitest run <spec...>   # fast per-task iteration loop
cd packages/super-sync-server && npm test                   # full gate (vitest run); commit gate only
cd packages/super-sync-server && npx vitest run --config vitest.integration.config.ts  # needs live Postgres; pre-merge only
```

`pretest` runs `prisma generate` (idempotent — run once per session, not per edit). Sandbox note: if `prisma generate`/vitest fails on a read-only home, prefix with a seeded fake home — memory `reference_supersync_prisma_sandbox.md` (`cp -r ~/.cache/prisma $TMPDIR/fakehome/.cache/prisma && HOME=$TMPDIR/fakehome npm test`).

### Commit convention

`refactor(sync): <what moved>` for moves; `test(sync): re-point private spy to <collaborator>` for the three sanctioned spec edits. Never `fix(test):`. One commit per task (Task 7: one per sub-step).

---

## Task 0: Hoist SyncService-local shared types into `sync.types.ts`

Prevents the circular import (`sync.service.ts → services/index.ts → new module → sync.service.ts`) that Tasks 2/7 would otherwise create. Pure type move, zero runtime change.

**Files:** Modify `src/sync/sync.service.ts`, `src/sync/sync.types.ts`.

**Move** (currently declared in `sync.service.ts`): `DuplicateOperationCandidate` (32), `DUPLICATE_OP_SELECT` (55), `LatestEntityOperationRow` (72), `LatestBatchEntityOperationRow` (78), `BatchUploadCandidate` (82), `AcceptedBatchOperation` (89), and the const `CONFLICT_DETECTION_ENTITY_BATCH_SIZE` (96) → `sync.types.ts`. Re-import them into `sync.service.ts`.

**Steps:** Baseline `npx vitest run tests/sync.service.spec.ts` → move types → `checkFile` both files → `npm test` green → commit `refactor(sync): hoist shared upload/conflict types into sync.types`.

---

## Task 1: Extract pure op-replay engine → `src/sync/op-replay.ts`

Lowest risk: replay is already pure. Pure logic belongs at `src/sync/` top-level (precedent: `sync.types.ts`, `gzip.ts`, `cleanup.ts`), **not** under `services/` (that barrel is for stateful classes extracted from SyncService).

**Files:**

- Create: `packages/super-sync-server/src/sync/op-replay.ts`
- Create: `packages/super-sync-server/tests/op-replay.spec.ts`
- Modify: `src/sync/services/snapshot.service.ts`

**Move to `op-replay.ts`** (from `snapshot.service.ts`, verbatim, as exported free functions/values): `replayOpsToState` (914-1123, **verified zero `this.` refs — genuinely pure**); the pure top-level helpers ~35-166 (op-size estimation, `MAX_REPLAY_STATE_SIZE_BYTES` + size guard); `EncryptedOpsNotSupportedError` (115); `assertContiguousReplayBatch` (146); `ReplayOperationRow` (the replay input-contract type, ~135); `_resolveExpectedFirstSeq` (1191-1214, **verified pure**). Leave `REPLAY_OPERATION_SELECT` (124, a Prisma select) and `MAX_SNAPSHOT_SIZE_BYTES` in `snapshot.service.ts` (generation owns those; Task 6 imports `ReplayOperationRow` from `op-replay.ts`).

**CRITICAL re-export (do not skip):** `sync.routes.ts:40` imports `EncryptedOpsNotSupportedError` from `./services/snapshot.service` and does identity-sensitive `instanceof` at `sync.routes.ts:941` and `:1451`; `tests/snapshot.service.spec.ts:4` imports it the same way. `snapshot.service.ts` MUST add `export { EncryptedOpsNotSupportedError } from '../op-replay';` (re-export the _same_ class object — never re-declare). Without this, the routes and the 1899-LOC snapshot spec fail to compile / `instanceof` silently returns false.

**Steps:**

1. Baseline: `npx vitest run tests/snapshot.service.spec.ts tests/sync.service.spec.ts` → record green.
2. Create `op-replay.ts` (verbatim moves; `replayOpsToState` becomes `export const replayOpsToState = (...) => {...}`).
3. In `snapshot.service.ts`: replace `replayOpsToState` body with a one-line delegate (preserve the public method — `snapshot.service.spec.ts:1444+` calls it as a public instance method); import the moved helpers from `../op-replay`; add the **re-export** line.
4. Add `tests/op-replay.spec.ts` — direct pure unit tests (no DB): empty ops → base; CREATE→UPDATE fold; DEL semantics; oversized-state guard throws; encrypted op → `EncryptedOpsNotSupportedError`; `assertContiguousReplayBatch` gap rejection; `_resolveExpectedFirstSeq` leading-gap rule. Mirror assertions already in `snapshot.service.spec.ts` (do NOT delete those).
5. `checkFile` all changed/created `.ts`.
6. `npm test` full green (same counts + new spec).
7. Commit `refactor(sync): extract pure op-replay engine; re-export EncryptedOpsNotSupportedError`.

---

## Task 2: Extract conflict logic → single `src/sync/conflict.ts`

One file (pure functions + the 3 thin DB functions taking `tx`), not two — the pure functions are independently testable as named exports regardless of file. Top-level, not `services/`.

**Files:**

- Create: `packages/super-sync-server/src/sync/conflict.ts`
- Create: `packages/super-sync-server/tests/conflict.spec.ts`
- Modify: `src/sync/sync.service.ts`

**Move to `conflict.ts`** (verbatim; use the Phase-A/B technique):

- _Pure fns:_ `resolveConflictForExistingOp` (304), `isSameDuplicateOperation` (402), `isSameDuplicateTimestamp` (431, takes `maxClockDriftMs` param), `areJsonValuesEqual` (458), `stableJsonStringify` (462), `toStableJsonValue` (466), `getConflictEntityIds` (538), `getEntityConflictKey` (547), `getBatchConflictEntityPairs` (551), `pruneVectorClockForStorage` (612, **note: mutates `op.vectorClock` + logs — not referentially pure; test asserts mutation**).
- _DB fns (take `tx: Prisma.TransactionClient`):_ `detectConflict` (219), `detectConflictForEntities` (254), `detectConflictForEntity` (~372), `prefetchLatestEntityOpsForBatch` (570).

**Explicitly NOT moved here** (they are upload-pipeline concerns, not conflict logic — they go to Task 7's `OperationUploadService`): `clampFutureTimestamp` (485, reads config + mutates + audit-logs), `rejectedUploadResult` (509, audit-logs + shapes `UploadResult`).

**SyncService wiring:** add `private conflict = ...` — since `conflict.ts` is functions, the facade and `OperationUploadService` import them directly; keep facade method names only where a spec references them (none do — `conflict-detection.spec.ts` exercises via public `uploadOps`). The serial path's legacy post-sequence re-check (`processOperation`, the `this.detectConflict` call at ~1463 with the compensating `lastSeq` decrement at ~1465) becomes a `conflict.detectConflict(tx, ...)` call — keep the decrement paired with it (Task 7c).

**Steps:** Baseline `npx vitest run tests/sync.service.spec.ts tests/conflict-detection.spec.ts tests/duplicate-operation-precheck.spec.ts` → Phase A (in-file fn conversion, run targeted spec) → Phase B (move to `conflict.ts`) → add `tests/conflict.spec.ts` (dup true/false, timestamp-clamp boundaries, vector-clock CONCURRENT vs LESS_THAN, stable-stringify key ordering, prune at `MAX_VECTOR_CLOCK_SIZE=20` per `docs/sync-and-op-log/vector-clocks.md`, `pruneVectorClockForStorage` mutation) → `checkFile` → `npm test` green → commit `refactor(sync): extract conflict detection + resolution into pure module`.

---

## Task 3: Split `sync.routes.ts` HTTP helpers → 2 flat modules

Two modules (not four). Flat `sync.routes.*.ts` siblings (codebase route convention is flat: `sync.routes.ts`, `websocket.routes.ts` — no `routes/` subdir, no new barrel).

**Files:**

- Create: `src/sync/sync.routes.payload.ts` — compression/body-size constants (74-96), `getMaxRawBodySizeForCompressedPayload` (91), `createRawBodyLimitPreParsingHook` (163), `getHeaderString` (111), `hasHeaderToken` (119), `getParsedContentLength` (127), `createPayloadTooLargeError` (105), `ENCRYPTED_OPS_CLIENT_MESSAGE` (50), `createValidationErrorResponse` (58), `errorMessage` (186), `sendCompressedBodyParseFailure` (383).
- Create: `src/sync/sync.routes.quota.ts` — `computeOpsStorageBytes` (201), `computeJsonStorageBytes` (214), `getRawOpsCount` (222), `sendOpsBatchTooLargeReply` (228), `applyStorageUsageDelta` (243), `sendQuotaExceededReply` (268), `enforceStorageQuota` (414), `enforceCleanSlateStorageQuota` (479), and the sync-import-idempotency trio `findExistingSyncImport` (303), `isIdempotentSyncImportRetry` (346), `sendSyncImportExistsReply` (351) (used only by the snapshot handler).
- Modify: `sync.routes.ts` (imports only; `syncRoutes` body unchanged).

**Steps:** Baseline `npx vitest run tests/sync-compressed-body.routes.spec.ts tests/decompress-body.spec.ts tests/storage-quota-cleanup.spec.ts` (NOT `sync.routes.spec.ts` — excluded from `npm test`) → create the 2 modules (verbatim; `quota.ts` imports `errorMessage`/`createValidationErrorResponse` from `payload.ts`) → update imports → `checkFile` → `npm test` green → commit `refactor(sync): split sync.routes HTTP helpers into payload + quota modules`.

---

## Task 4: Extract POST handlers from `sync.routes.ts`

Depends on Task 3 (handlers close over its helpers).

**Files:**

- Create: `src/sync/sync.routes.ops-handler.ts` — POST `/ops` body (546-812).
- Create: `src/sync/sync.routes.snapshot-handler.ts` — POST `/snapshot` body (963-1297).
- Modify: `sync.routes.ts` — register handlers by reference; Fastify schema objects stay in `sync.routes.ts`. The two `import` lines for `EncryptedOpsNotSupportedError` and the new handlers are the only permitted route-file edits.

**Watch-outs:** handlers resolve `getSyncService()` internally exactly as inline today; preserve call order, transaction boundaries, reply shapes, and the `instanceof EncryptedOpsNotSupportedError` checks (now satisfied by Task 1's re-export). Use the editor "move to new file" refactor where possible (auto-threads helper imports).

**Steps:** Baseline `npx vitest run tests/sync-operations.spec.ts tests/sync-compressed-body.routes.spec.ts tests/sync-fixes.spec.ts` → Phase A/B move → wire references → `checkFile` → `npm test` green → commit `refactor(sync): extract /ops and /snapshot handlers from sync.routes`.

---

## Task 5: Fold eviction into `StorageQuotaService`; move `deleteStaleDevices` to `DeviceService`

Eviction + quota accounting are one concern (free → reconcile counter → re-check → rollback). `deleteOldestRestorePointAndOps` clears the snapshot cache via a **direct `prisma.userSyncState.update`** (~2062-2075) — there is NO `snapshotService` dependency (v1's watch-out was wrong). The eviction code's only collaborator is `StorageQuotaService` itself.

**Files:**

- Modify: `src/sync/services/storage-quota.service.ts` (gains eviction), `src/sync/services/device.service.ts` (gains `deleteStaleDevices`), `src/sync/sync.service.ts` (delegations), `tests/sync.service.spec.ts` (one sanctioned spec re-point).

**Move to `StorageQuotaService`:** `deleteOldSyncedOpsForAllUsers` (1849), private `deleteOldSyncedOpsBatch` (~1941), `deleteOldestRestorePointAndOps` (1981), `freeStorageForUpload` (2106), and the `OLD_OPS_CLEANUP_*` constants + `getOldOpsCleanup*` env helpers (102-177). They already call `this.updateStorageUsage/checkStorageQuota/decrementStorageUsage/incrementStorageUsage` — these become same-class calls (delete the SyncService delegate hops). `SyncService` keeps thin facades (`cleanup.ts:27/46` calls `syncService.deleteOldSyncedOpsForAllUsers` / `deleteStaleDevices` — preserve those + the return contract `cleanup.spec.ts:72` asserts).
**Move to `DeviceService`:** `deleteStaleDevices` (2251). `isDeviceOwner`/`getAllUserIds`/`getOnlineDeviceCount` (2296-2305) are **already** delegates to `DeviceService` (no work). `deleteAllUserData` (2264) is multi-cache orchestration — stays on the facade.

**Sanctioned spec re-point:** `tests/sync.service.spec.ts:2117-2122` accesses `service as unknown as { deleteOldSyncedOpsBatch; storageQuotaService }` and asserts `storageQuotaService.needsReconcile`. After the fold, `deleteOldSyncedOpsBatch` lives on the _same_ `storageQuotaService` instance the spec already reaches — re-point the spy to `service['storageQuotaService']`. Commit separately: `test(sync): re-point deleteOldSyncedOpsBatch spy to StorageQuotaService`.

**Steps:** Baseline `npx vitest run tests/storage-quota-cleanup.spec.ts tests/storage-quota.service.spec.ts tests/sync.service.spec.ts tests/cleanup.spec.ts` → move methods (verbatim; snapshot-cache invalidation stays the inline `prisma.userSyncState.update`) → adjust facade delegations → re-point the one spec spy → `checkFile` → `npm test` green → 2 commits (`refactor(sync): fold storage eviction into StorageQuotaService; move deleteStaleDevices to DeviceService` + the `test:` re-point).

---

## Task 6: Extract `SnapshotGenerationService` from `snapshot.service.ts`

Depends on Task 1 (`replayOpsToState` from `op-replay.ts`). `SnapshotService` keeps the lock map + read-side cache accessors + cache orchestration; generation (which itself does write-through cache DB writes) moves out — name is accurate, facade role is "lock + read-cache + orchestration."

**Files:** Create `src/sync/services/snapshot-generation.service.ts`; modify `snapshot.service.ts`, `services/index.ts`.

**Move:** `_generateSnapshotImpl` (474-731), `generateSnapshotAtSeq` body (783-1124), `_assertNoEncryptedOps` (1125), `_assertCachedSnapshotBaseReplayable` (1146). Keep on facade (delegating): public `generateSnapshot` (439), public `generateSnapshotAtSeq` (783 signature), `snapshotGenerationLocks`, `getCached*`, `cacheSnapshot*`, `_invalidateCachedSnapshot`, `getRestorePoints`/`_getRestorePointDescription`. The collaborator imports `replayOpsToState`/`ReplayOperationRow`/`_resolveExpectedFirstSeq` from `../op-replay` and owns `REPLAY_OPERATION_SELECT`. Preserve the per-user generation-lock semantics exactly.

**Steps:** Baseline `npx vitest run tests/snapshot.service.spec.ts` (NOT `snapshot-skip-optimization.spec.ts` — excluded) → Phase A/B move → delegate → barrel → `checkFile` → `npm test` green → commit `refactor(sync): extract SnapshotGenerationService from SnapshotService`. (Pre-merge: also run the excluded `snapshot-skip-optimization` + integration specs via the integration config — see Task 8.)

---

## Task 7: Extract `OperationUploadService` (upload pipeline) — highest risk, three sub-steps

`SyncService.uploadOps` keeps the `prisma.$transaction` shell, `RepeatableRead` isolation, 60s timeout, clean-slate block, post-tx cache clears, summary logging, and the serialization-failure classification (it shapes the client retry contract). All extracted methods take `tx: Prisma.TransactionClient` per call and **never** open their own transaction (verified: the pipeline already uses injected `tx` throughout — no `prisma.$transaction` inside). Depends on **Task 2** (conflict module) and **Task 0** (shared types).

**Constructor deps (explicit):** `ValidationService`, the `conflict` module functions, `config` (for `clampFutureTimestamp`'s `maxClockDriftMs`). No DB-handle injection — `tx` per call.

**Files:** Create `src/sync/services/operation-upload.service.ts`; modify `sync.service.ts`, `services/index.ts`, `tests/sync.service.spec.ts` (one sanctioned re-point).

**Add a characterization spec first (additive, allowed):** `tests/operation-upload-characterization.spec.ts` — before any move, feed representative batches through `syncService.uploadOps` (single op; multi-entity; intra-batch dup; conflict; clean-slate; full-state vector-clock aggregate) and snapshot the exact `UploadResult[]` + resulting `storage_used_bytes` + final `lastSeq`. This pins the byte-accounting and retry-contract invariants the existing behavioral suite does not assert precisely. Commit it green before 7a.

**Sub-steps (each: baseline → Phase A/B move → `checkFile` → `npm test` green → commit):**

- **7a — pure/serial helpers.** Move `validateAndClampBatch` (1022), `rejectIntraBatchDuplicates` (1064), `_aggregatePriorVectorClock` (868), `persistMergedFullStateClock` (905, called by **both** batch@1320 and serial@1605 — must move now). Plus the upload-result helpers excluded from Task 2: `clampFutureTimestamp` (485), `rejectedUploadResult` (509).
- **7b — batch pipeline (moves as one unit; partial moves are uncompilable).** `processOperationBatch` (925), `classifyExistingDuplicates` (1095), `detectBatchConflicts` (1157), `reserveSeqAndInsert` (1255), `persistBatchFullStateClock` (1307). `detectBatchConflicts` calls `conflict.prefetchLatestEntityOpsForBatch` (Task 2) — wire it. **Sanctioned spec re-point:** `tests/sync.service.spec.ts:924-929` spies `_aggregatePriorVectorClock` on the `SyncService` cast and asserts call-count after public `uploadOps`; re-point the spy to the `OperationUploadService` instance (`service['operationUploadService']`). Separate commit `test(sync): re-point _aggregatePriorVectorClock spy to OperationUploadService`.
- **7c — serial path.** `processOperation` (1335). Keep its legacy post-sequence `conflict.detectConflict` re-check paired with the compensating `lastSeq` decrement (~1463-1468) and the inlined prune (~1502-1509 — do NOT unify with the batch path's `pruneVectorClockForStorage` call; preserve both verbatim).

**Pre-merge gate (not per-sub-step):** run the integration suite — `npx vitest run --config vitest.integration.config.ts` (needs live Postgres; if unavailable in the environment, state that explicitly and rely on the characterization spec + `sync-operations`/`time-tracking-operations`/`conflict-detection`/`sync-fixes` specs, noting the reduced coverage).

---

## Task 8: Final verification & barrel doc

- Full `npm test` green. If Postgres available: `npx vitest run --config vitest.integration.config.ts` green (covers the `npm test`-excluded `multi-client-sync` + `snapshot-skip-optimization` integration specs). Otherwise document that integration was not run here and must run in CI before merge.
- `wc -l` the big 3. Realistic targets (v1's were unachievable): `sync.routes.ts` ≤ ~450, `snapshot.service.ts` ≤ ~600, `sync.service.ts` ≤ ~1100 (the `uploadOps` tx shell + facade delegations are an irreducible orchestration core — this is "relocate the pipeline into a cohesive unit," not "make sync.service.ts tiny"; say so).
- `npm run checkFile` on every file touched across all tasks.
- Extend the existing `src/sync/services/index.ts` header comment with one line per new collaborator (no new doc file — keeps the map next to the code, aligns with the no-proactive-docs rule).
- Final commit `docs(sync): note new SuperSync server module boundaries in barrel`.

**Do not** open a PR or merge — separate decision (superpowers:finishing-a-development-branch when the user asks).

---

## Risk ledger

| Task                        | Risk     | Hard deps | Sanctioned spec edit        |
| --------------------------- | -------- | --------- | --------------------------- |
| 0 hoist types               | trivial  | —         | none                        |
| 1 op-replay (+ re-export)   | very low | —         | none                        |
| 2 conflict.ts               | low      | 0         | none                        |
| 3 route helpers ×2          | low      | —         | none                        |
| 4 route handlers ×2         | medium   | 3         | none (2 route imports only) |
| 5 eviction→StorageQuota     | medium   | —         | 1 (`:2117` spy re-point)    |
| 6 snapshot-generation       | medium   | 1         | none                        |
| 7 operation-upload (7a/b/c) | high     | 0, 2      | 1 (`:924` spy re-point)     |
| 8 verify + doc              | trivial  | all       | —                           |

Sync-correctness invariants (transaction atomicity, vector-clock prune order, SYNC_IMPORT/BACKUP_IMPORT/REPAIR early-return, replay determinism, no-user-content logging) are preserved by the verbatim-move + facade rules — confirmed by review against `CLAUDE.md` rules 1/6/7/8/9 and `docs/sync-and-op-log/vector-clocks.md`. The single highest-correctness-risk surface is Task 7; the characterization spec is its primary guard.

## Out of scope (YAGNI)

Dropping the facades; touching `api.ts`/`passkey.ts`/`auth.ts`/`scripts/`; behavior/perf/DB/wire changes; rewriting tests (only additive new specs + the 2 enumerated spy re-points); a new `routes/` directory or `docs/` artifact.
