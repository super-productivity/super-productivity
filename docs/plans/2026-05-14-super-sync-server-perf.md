# SuperSync Server Performance Improvements

Date: 2026-05-14
Status: proposal — phases sequenced so independent low-risk wins land first while the large upload-batching work proceeds in parallel.

Scope drawn from an audit of `packages/super-sync-server/` covering: upload processing, snapshot generation/replay, quota accounting, encrypted-op handling, auth, and deployment defaults.

> **Revision note (post-review):** Phases 0b, 1, 2 and 4 were tightened after a subagent review surfaced design issues in the original draft. Specifically: a forgotten `userSyncState.upsert` for first-time users, intra-batch duplicate `op.id` handling, multi-entity (`entityIds[]`) op support, full-state-op aggregate-VC writes, and a `pg_column_size` vs. `computeOpStorageBytes` mismatch in the quota backfill. See each phase for the revised approach.

---

## Phase 0 — Quick wins (one PR each, mostly low risk)

### 0a. Encrypted-op partial index (Finding #4)
- **New migration:** `prisma/migrations/<ts>_add_encrypted_ops_partial_index/migration.sql`
  ```sql
  CREATE INDEX CONCURRENTLY "operations_user_id_server_seq_encrypted_idx"
    ON "operations"("user_id", "server_seq")
    WHERE "is_payload_encrypted" = true;
  ```
- **Why:** `snapshot.service.ts:1083` and `:1114` `count(*) WHERE is_payload_encrypted=true` over a seq range. Today this scans the range and filters. With the partial index, the common case (no encrypted ops for the user) becomes an empty-index probe.
- **Leave alone:** existing `operations_user_id_full_state_server_seq_idx` already covers the `op_type IN (...)` filter for the `findFirst` at `snapshot.service.ts:1103`. (That `findFirst` also filters `isPayloadEncrypted: false`, which isn't in the partial-index predicate — currently a cheap index scan + flag recheck rather than a single probe. Not worth a second partial index.)
- **Verify:** `EXPLAIN ANALYZE` against a synthetic 100k-op user; existing `snapshot.service.spec` stays green.

### 0b. Snapshot replay size-check cadence (Finding #2)
- **File:** `packages/super-sync-server/src/sync/services/snapshot.service.ts:879-900`
- **Change:** replace `i % 1000 === 0 → JSON.stringify(state)` with delta-based accounting, with a carve-out for full-state ops:
  - Before each call to `replayOpsToState` (which is called once per replay batch from `generateSnapshot`), compute `baseBytes = Buffer.byteLength(JSON.stringify(initialState), 'utf8')` once. Track `estimatedBytes = baseBytes` and `accumulatedDelta = 0`.
  - During the loop, for each op add a cheap upper-bound delta = `Buffer.byteLength(JSON.stringify(payload || ''), 'utf8')` to `accumulatedDelta`. Overestimating is safe; deletes contribute 0.
  - **Carve-out: when the op is `SYNC_IMPORT`, `BACKUP_IMPORT`, or `REPAIR`**, the op replaces state wholesale. The upper-bound counter would otherwise keep accumulating across the wipe and produce false "State too large" throws. After applying such an op, force a real measurement: `estimatedBytes = Buffer.byteLength(JSON.stringify(state), 'utf8')`, reset `accumulatedDelta = 0`.
  - Trigger the real measurement (and reset `accumulatedDelta`) when `estimatedBytes + accumulatedDelta > 0.8 * MAX_REPLAY_STATE_SIZE_BYTES`. Throw if the real value still exceeds the cap.
- **Migration-split ops:** the inner loop at `:935-952` can fan one op into many; "delta per op = byteLength(payload)" still upper-bounds growth correctly (sum of fanned payloads ≥ state growth). No special handling needed.
- **Why:** today a 100k-op replay does ~100 full stringifications of a multi-MB state inside the 60s RepeatableRead tx. After this change the expensive check only fires near the cap or on a wholesale replace.
- **Verify:** existing `snapshot.service.spec.ts` replay tests + add: 1500 small `CREATE`/`UPDATE` ops trigger zero full stringifications; a single `SYNC_IMPORT` triggers exactly one.

### 0c. Snapshot blob measurement (Finding #5, snapshot half)
- **File:** `storage-quota.service.ts:114-117` (the `findUnique({ select: { snapshotData: true } })`; `.length` is read at `:120`)
- **Change:** swap the `findUnique` for the same `octet_length(snapshot_data)` `$queryRaw` already used at `snapshot.service.ts:187-191` (`getCachedSnapshotBytes`). Don't pull a multi-MB `bytea` blob back to Node just to read `.length`.
- **Verify:** unit test: `calculateStorageUsage` agrees with `prepareSnapshotCache.bytes` (both are the gzip output length).
- **Caveat:** check how often `calculateStorageUsage` actually runs. `storage-quota.service.ts:84` describes it as "at most once per quota-cleanup event (rare per user)." If frequency is truly rare, this is a polish fix rather than a hot-path win.

### 0d. Helm memory defaults (Finding #3, half)
- **File:** `helm/supersync/values.yaml:178-184`
- **Current baseline:** `requests.memory: 128Mi`, `limits.memory: 256Mi`.
- **Change:** raise `limits.memory` to `512Mi`; raise `requests.memory` to `256Mi`. Add a comment naming the constants that drive the upper bound (`MAX_SNAPSHOT_DECOMPRESSED_BYTES`, `MAX_REPLAY_STATE_SIZE_BYTES`).
- **Why:** decompressed request body + parsed state + serialized buffer + gzip output can each be tens of MB. The current 256Mi cap is fragile by design.
- **Also:** sweep `docs/sync-and-op-log/` for any documentation citing 256Mi.

---

## Phase 1 — Upload batch processing (Finding #1, the big one)

The plan-as-originally-drafted underspecified four real cases. The revised design below makes each explicit.

### 1a. Refactor `processOperation` into a batch primitive

**File:** `packages/super-sync-server/src/sync/sync.service.ts` — caller at `:459-467`, worker at `:634-790+`, and the upsert/counter/syncDevice tail at `:445-518`.

**New shape, in order, inside the existing `tx`:**

1. **Validate all ops in memory** (`validationService.validateOp`) — no DB. Produce a `decisions: Array<{ op, status: 'valid' | 'rejected', errorCode? }>`.

2. **Dedupe by `op.id` within the batch.** If two ops in the same batch share an `id`, accept the first and reject subsequent ones as `DUPLICATE_OPERATION`. The current per-op loop produces this same audit trail naturally; the batch path must reproduce it before reserving sequence numbers. Without this step, `lastSeq` advances for the duplicate and a server_seq gap is left when the row is silently skipped at insert time.

3. **Prefetch existing op-id duplicates in one query:**
   ```ts
   const existing = await tx.operation.findMany({
     where: { id: { in: validOpIds } },
     select: { /* fields needed by isSameDuplicateOperation */ },
   });
   ```
   Build `Map<opId, existingRow>`. For each `op` whose id is in the map, run `isSameDuplicateOperation` and audit as either `DUPLICATE_OPERATION` (idempotent retry) or `INVALID_OP_ID` (collision with a different op).

4. **Prefetch latest-entity-op-per-(entityType, entityId) for every entity touched in the batch.**
   **Multi-entity ops** carry `entityIds: string[]` (not just `entityId`) — see `sync.service.ts` `detectConflict` (lines 140-156). The prefetch set must be:
   ```ts
   const entityKeys = new Set<string>();
   for (const op of batch) {
     const ids = op.entityIds ?? (op.entityId ? [op.entityId] : []);
     for (const id of ids) entityKeys.add(`${op.entityType}::${id}`);
   }
   ```
   Then one `DISTINCT ON` raw query (or one `findMany` with an in-app reduction) keyed on `(entityType, entityId)` ordered by `serverSeq DESC`, restricted to the touched set. Uses `@@index([userId, entityType, entityId, serverSeq])`.

5. **Conflict detection in memory** against the prefetched map, **updating the map as each op is accepted** so intra-batch conflicts (two ops on the same entity inside one batch) resolve in order — matches today's serial semantics. Full-state ops (`SYNC_IMPORT`/`BACKUP_IMPORT`/`REPAIR`) bypass conflict detection, as in `detectConflict` lines 129-136.

6. **Reserve sequence numbers and ensure `user_sync_state` row exists in one round trip.**
   The original draft proposed `tx.userSyncState.update(...)` for the increment, which throws `P2025` on a brand-new user (the row doesn't exist yet) and also leaves the existing `tx.userSyncState.upsert` at `:445-449` redundantly grabbing the same row lock. Replace **both** with one statement:
   ```sql
   INSERT INTO user_sync_state (user_id, last_seq)
   VALUES ($userId, $delta)
   ON CONFLICT (user_id) DO UPDATE
     SET last_seq = user_sync_state.last_seq + $delta
   RETURNING last_seq
   ```
   `lastSeq` from the result is the new high-water mark; `accepted[i].serverSeq = lastSeq - accepted.length + i + 1`. Skip the statement entirely when `accepted.length === 0` (and skip the rest of the batch tail).

7. **Bulk insert** with one `tx.operation.createMany({ data: rows })`. **Do NOT pass `skipDuplicates: true`.** Phase 1's correctness assumes the in-memory dedupe (step 2) and prefetch (step 3) have caught all duplicate ids; a row-level dup at insert time means our snapshot was stale and the right answer is to fail the batch with `P2002` → outer 40001-style retry, not to silently drop a row whose sequence number we already reserved.

8. **Run `_aggregatePriorVectorClock` once** if the batch contained any accepted full-state op (`isFullStateOpType(op.opType)`). This call (`sync.service.ts:600-628`) reads ALL prior ops via `jsonb_each_text LATERAL`; it's not prefetchable. Use `beforeServerSeq = lastAcceptedFullStateOp.serverSeq` so the aggregate sees all batch inserts. Persist `latestFullStateSeq` and `latestFullStateVectorClock` once. If a batch somehow contains two full-state ops, process them in batch-order — the last write wins, matching today's per-op-loop behavior.

9. **Storage counter update** (`sync.service.ts:504-518`) — keep the `acceptedDeltaBytes` accumulation, summing `computeOpStorageBytes(op)` over accepted ops. Preserve the `isCleanSlate` SET-vs-INCREMENT branching exactly.

10. **`syncDevice.upsert`** (`:476-495`) — per-batch already; stays as is.

### 1b. FIX 1.5 — drop, with a recorded rationale

Drop the per-op re-check at `sync.service.ts:786-794`. The safety it covered is delivered by the **shared `user_sync_state.lastSeq` row-write**, which forces concurrent batches to serialize: the second writer blocks on the row lock, then fails with `40001` (serialization failure) on commit. RR isolation alone does NOT provide this — PostgreSQL RR does not run full serializable snapshot isolation. The row-lock pattern is what makes the new design safe.

**This rationale belongs in `ARCHITECTURE-DECISIONS.md`** so that anyone proposing to remove the `lastSeq` increment from the hot path (e.g. sharded sequence assignment, distributed counters) re-introduces the race they were avoiding. Title the entry "Batch uploads under RepeatableRead — safety derives from `user_sync_state.lastSeq` row-lock, not from RR snapshot isolation."

### 1c. Tests

- Extend `tests/sync.service.spec.ts`. Mock surfaces use the existing hand-rolled `vi.mock('../src/db', …)` pattern (not Prisma `$on('query')`, which isn't wired). Use `vi.spyOn(prisma.operation, 'findMany')` etc. to assert call counts.
  - **25-op batch:** exactly 1 `findMany` for dup-id prefetch, 1 `findMany` (or `$queryRaw`) for entity prefetch, 1 `INSERT ... ON CONFLICT` for the sync-state row, 1 `operation.createMany`, 1 `syncDevice.upsert`, 1 `UPDATE users` counter, optionally 1 `_aggregatePriorVectorClock`.
  - **Intra-batch duplicate `op.id`:** `[A, A]` — first accepted, second audited `DUPLICATE_OPERATION`, `lastSeq` advances by exactly 1, exactly one row inserted.
  - **Intra-batch entity conflict:** `[op1, op2]` on the same entity — op1 wins, op2 rejected as concurrent.
  - **Multi-entity op:** an op with `entityIds: [a, b, c]` correctly drives the prefetch and conflict-detection.
  - **First-time user:** no `user_sync_state` row → upload succeeds; the `INSERT ... ON CONFLICT` creates the row with `last_seq = accepted.length`.
  - **Full-state op in batch:** `_aggregatePriorVectorClock` runs exactly once at the end, sees the batch inserts.
  - **Partial-acceptance batch:** 5 dups + 15 accepted → counters correct, audit log has 20 entries.
  - **Concurrency:** two parallel batches on same user — outer retry on `P2034` / `40001` handles the loser. (This is unchanged in spirit but the failure mode shifts from "per-op re-check" to "shared row lock" — verify it still works.)
- **E2E:** `e2e/tests/sync/` (not `e2e/sync/`) — add one batch-of-50 upload test and assert latency drop vs. baseline.
- **Bench:** docker-compose Postgres, time 25-op and 100-op upload before/after. **Also measure concurrent-batch latency:** the shared row-lock means two simultaneous batches serialize hard — the per-batch latency under contention may be similar to today's per-op design. Total throughput should still win because each batch holds the lock for far less wall time.

### 1d. Risk and rollout

- Highest-blast-radius change in the plan. Land behind config flag `SUPERSYNC_BATCH_UPLOAD`, default `false` for one release, `true` the next.
- **Wire the flag:** `src/config.ts` exposes a `ServerConfig` parsed from env in `loadConfigFromEnv`. Add `batchUpload: boolean` parsed from `process.env.SUPERSYNC_BATCH_UPLOAD === 'true'`, thread through `SyncService` constructor.
- **Invariant:** every op in the batch produces **exactly one** persisted row OR **exactly one** audited rejection — never both, never neither, never gapped sequence numbers.

---

## Phase 2 — Quota byte accounting (Finding #5, ops half)

### 2a. Schema change
- New migration: add `payload_bytes BIGINT NOT NULL DEFAULT 0` to `operations`.
- Backfill — see §2b for why this can't be pure SQL.

### 2b. Backfill must use `computeOpStorageBytes`, not `pg_column_size`

The original draft proposed `UPDATE ... SET payload_bytes = pg_column_size(payload) + pg_column_size(vector_clock)`. **This is wrong.**

- `pg_column_size(payload)` returns the TOAST-compressed on-disk size — typically much smaller than the uncompressed value for large JSONB.
- The write path uses `computeOpStorageBytes(op)` (in `sync.const.ts`), which returns `Buffer.byteLength(JSON.stringify(payload ?? null), 'utf8') + Buffer.byteLength(JSON.stringify(vectorClock ?? {}), 'utf8')` — i.e. the uncompressed UTF-8 length.

These are different numbers by design. The file's own comment at `storage-quota.service.ts:88-103` already calls out this mismatch as the historical bug. Backfilling with `pg_column_size` seeds drift instead of fixing it: the SUM-query and the increment-counter will disagree on every reconcile after deployment.

**Correct backfill:** stream `operations` rows in batches (e.g. 1000 at a time) from a one-time Node script, compute `computeOpStorageBytes(row)` per row, and `UPDATE operations SET payload_bytes = $bytes WHERE id = $id`. Slow (single-row UPDATEs) but correct. Acceptable because it runs once and doesn't block writes. Run it as a separate `migrate-payload-bytes.ts` (mirroring the existing `migrate-passkey-credentials.ts` pattern) **outside** the Prisma migration framework — Prisma migrations run synchronously at startup, and a synchronous backfill on a 100M-row `operations` table would block the server for hours.

There is no clean SQL equivalent of `Buffer.byteLength(JSON.stringify(payload))` over JSONB. `octet_length(payload::text)` is close but reads/detoasts every row, which is the very disk-I/O DoS the file's comment warns about.

### 2c. Write path
- In the new bulk-`createMany` path (Phase 1), compute `payload_bytes` per op using `computeOpStorageBytes` so the on-row value matches the increment-counter value the hot path is already adding. This is the consistency `calculateStorageUsage` needs.

### 2d. Read path
- Replace `storage-quota.service.ts:109-112`:
  ```sql
  SELECT COALESCE(SUM(payload_bytes), 0) AS total
  FROM operations
  WHERE user_id = $1
  ```
- Drop `pg_column_size` entirely. No detoasting, no I/O DoS.
- Snapshot side is handled in 0c.

### 2e. Tests
- Unit: after a 100-op upload, `calculateStorageUsage` and the cached `storage_used_bytes` counter agree to the byte.
- Test: reconcile-after-upload is idempotent (drift = 0).
- Test: a synthetic row with `payload_bytes = 0` (pre-backfill) still produces a sensible SUM (it'll just under-count by the unbackfilled portion). Decide explicitly whether read path should treat 0 as "needs backfill" and fall through to `computeOpStorageBytes`-style accounting, or whether we hard-cut on backfill completion.

---

## Phase 3 — Snapshot serialization off the hot path (Finding #3, remainder)

Pick after profiling Phase 0d in production:

### 3a. Streaming serialize + gzip (preferred if memory still hot)
- Replace `prepareSnapshotCache` (`snapshot.service.ts:175-184`) with a streaming pipeline: a streaming JSON stringifier feeding `zlib.createGzip()`, collecting chunks into a final `Buffer.concat(...)`.
- Net peak memory: ~state size, not ~3× state size.
- **Verification gate:** `snapshotData` is only used for byte-count accounting and gunzip-then-parse round-tripping (verified — no hash or content comparison anywhere in `src/`). So byte-for-byte stability is NOT required; round-trip correctness is. Add a property-based test: random state → stream-stringify-gzip → gunzip-parse → deep-equal original.

### 3b. Worker-thread offload (simpler fallback)
- Move `JSON.stringify(state)` into a `worker_threads` worker. 100MB cap → worker pool of 2 is plenty.
- Pro: zero risk to output bytes. Con: doesn't reduce peak memory, only gets it off the event loop.

If 0d alone is sufficient in prod (no OOMs, no event-loop-blocking signals), defer this phase indefinitely.

---

## Phase 4 — Auth token-verification cache (Finding #6)

### 4a. Cache shape
- **New module:** `packages/super-sync-server/src/auth-cache.ts`, wired into `verifyToken` at `auth.ts:114-158`.
- LRU + TTL: `Map<userId, { tokenVersion: number, isVerified: boolean, expiresAt: number }>`. TTL 30s, max 10k entries.
- On verify:
  1. JWT decode (as today).
  2. Cache hit && not expired && `payload.tokenVersion === cached.tokenVersion` && `cached.isVerified` → return valid.
  3. Else hit DB, update cache, return.

### 4b. Invalidation — full surface

All `tokenVersion: { increment: 1 }` write sites plus account deletion must invalidate:
- `auth.ts:77` (`revokeAllTokens`)
- `auth.ts:95` (`replaceToken`)
- `passkey.ts:611` (passkey recovery)
- `api.ts:209` (`prisma.user.delete`) — without this, a deleted user's stale cache entry serves "valid" until TTL expires (ghost token window).

Each call site needs an `authCache.invalidate(userId)` adjacent to the write. Add a code-search-friendly comment near each so future `tokenVersion` writes don't miss it.

`isVerified` currently has no flip-to-zero path (`passkey.ts:276` deletes unverified users rather than flipping the flag). Add a comment in `auth-cache.ts` noting this assumption — if a future code path adds verification revocation, the cache will serve stale "valid" for up to TTL.

### 4c. Multi-instance concerns
- `helm/supersync/values.yaml:193` caps `maxReplicas: 1`, so in-process LRU is safe. Comment explicitly so a future multi-instance rollout doesn't accidentally introduce 30s revocation lag.

### 4d. Tests
- Unit: revoke-and-replace invalidates cache; expired tokens still hit DB; tokenVersion mismatch falls through; user deletion invalidates cache; passkey recovery invalidates cache.
- Bench: 1000 sequential `verifyToken` calls — expect ~10× p50 latency drop on warm cache.

---

## Cross-cutting

- **Merge order:** 0a, 0b, 0c, 0d can land in any order, in parallel with Phase 1 design. Phase 2 depends on Phase 1 (same code paths). Phase 3 is conditional. Phase 4 is independent.
- **Telemetry first:** before Phase 1 lands, add structured logging of `(opsInBatch, txDurationMs, dbRoundtrips)` to `uploadOps` so we can quantify the win. Existing audit log handles per-op decisions; add a single batch-summary line.
- **ADR:** add a `ARCHITECTURE-DECISIONS.md` entry per §1b ("Batch uploads under RepeatableRead — safety derives from `user_sync_state.lastSeq` row-lock, not from RR snapshot isolation").
- **Docs:** update `docs/sync-and-op-log/operation-log-architecture-diagrams.md` §upload-path if it diagrams the per-op loop.
- **Test patterns:** the codebase uses `vi.mock('../src/db', …)` with hand-rolled mocks, not Prisma `$on('query')` interceptors. Test-count assertions must use `vi.spyOn` on the mock surfaces.
- **Out of scope:** WebSocket fan-out, cleanup-job optimization, passkey paths. None flagged in the audit.

---

## Estimated impact (rough order of magnitude)

| Phase | Hot path affected                  | Expected win                          | Risk |
| ----- | ---------------------------------- | ------------------------------------- | ---- |
| 0a    | Snapshot fast-path validation      | Eliminates seq-range scan on count    | very low |
| 0b    | Snapshot replay                    | ~100× fewer full stringifications (modulo full-state ops) | low |
| 0c    | Quota reconcile                    | Skips blob load (tens of MB)          | very low |
| 0d    | All routes (memory headroom)       | Stops OOMs near snapshot cap          | low (ops change) |
| 1     | Upload (every client batch)        | ~5× fewer DB round trips on 25-op batch; shorter `user_sync_state` row lock; throughput-positive even under contention | medium-high |
| 2     | Quota reconcile (slow path)        | Removes `pg_column_size` table scan; consistency between SUM and counter | medium (schema + backfill) |
| 3     | Snapshot upload memory             | Halves peak heap on large snapshots   | medium |
| 4     | Auth on every request              | ~10× p50 latency drop on warm cache   | low |
