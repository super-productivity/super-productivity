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
  DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_server_seq_encrypted_idx";
  CREATE INDEX CONCURRENTLY "operations_user_id_server_seq_encrypted_idx"
    ON "operations"("user_id", "server_seq")
    WHERE "is_payload_encrypted" = true;
  ```
- **Why:** `snapshot.service.ts:1083` and `:1114` `count(*) WHERE is_payload_encrypted=true` over a seq range. Today this scans the range and filters. With the partial index, the common case (no encrypted ops for the user) becomes an empty-index probe.
- **Leave alone:** existing `operations_user_id_full_state_server_seq_idx` already covers the `op_type IN (...)` filter for the `findFirst` at `snapshot.service.ts:1103`. (That `findFirst` also filters `isPayloadEncrypted: false`, which isn't in the partial-index predicate — currently a cheap index scan + flag recheck rather than a single probe. Not worth a second partial index.)
- **Verify (post-deploy on staging, NOT a CI merge gate):** `EXPLAIN ANALYZE` against a production-like distribution requires populated DB state. Run on staging after the migration applies, with 1M ops for a user holding 0-100 encrypted rows; run `ANALYZE operations` after the migration and record the expected plan. Also re-check the latest full-state `findFirst` path that filters `isPayloadEncrypted: false`; the existing full-state partial index does not include that predicate, so many encrypted full-state rows can still force scan-time rechecks.

### 0b. Snapshot replay size-check cadence (Finding #2)

- **File:** `packages/super-sync-server/src/sync/services/snapshot.service.ts:879-900`
- **Change:** replace `i % 1000 === 0 → JSON.stringify(state)` with delta-based accounting, with a carve-out for full-state ops:
  - Before each call to `replayOpsToState` (which is called once per replay batch from `generateSnapshot`), compute `baseBytes = Buffer.byteLength(JSON.stringify(initialState), 'utf8')` once. Track `estimatedBytes = baseBytes` and `accumulatedDelta = 0`.
  - During the loop, for each op add a cheap upper-bound delta = `Buffer.byteLength(JSON.stringify(payload || ''), 'utf8')` to `accumulatedDelta`. Overestimating is safe; deletes contribute 0.
  - **Carve-out: when the op is `SYNC_IMPORT`, `BACKUP_IMPORT`, or `REPAIR`**, the op replaces state wholesale. The upper-bound counter would otherwise keep accumulating across the wipe and produce false "State too large" throws. After applying such an op, force a real measurement: `estimatedBytes = Buffer.byteLength(JSON.stringify(state), 'utf8')`, reset `accumulatedDelta = 0`.
  - Trigger the real measurement (and reset `accumulatedDelta`) when `estimatedBytes + accumulatedDelta > 0.8 * MAX_REPLAY_STATE_SIZE_BYTES`. Throw if the real value still exceeds the cap.
- **Migration-split ops:** the inner loop at `:935-952` can fan one op into many; "delta per op = byteLength(payload)" still upper-bounds growth correctly (sum of fanned payloads ≥ state growth). No special handling needed.
- **Delete-heavy degradation:** deletes contribute 0 to the bound, but each forced real measurement re-reads the (now smaller) true size and resets `accumulatedDelta`, so the bound does not stay pinned — a delete-heavy stream after a large import triggers at most a handful of extra measurements, and only when the imported base alone is already near the cap. Effectively unreachable for normal data; signed-delta accounting is not worth the added complexity.
- **Why:** the pre-existing per-op-loop replay stringified the multi-MB state every 1000 ops, so a 100k-op replay did on the order of ~90 full stringifications inside the 60s RepeatableRead tx. After this change a 100k-op replay does ~1 per 10k-op replay batch (≈10), plus one per accepted full-state op; and because the delta bound is a proven over-estimate, the dominant case — a small/incremental replay whose bound stays under the cap — does **zero** (no regression vs the old loop, which also did zero below its 1000-op cadence). Net ≈5–10× on large replays, break-even on the common path.
- **Verify:** existing `snapshot.service.spec.ts` replay tests + add: 1500 small `CREATE`/`UPDATE` ops trigger zero full stringifications; a single `SYNC_IMPORT` triggers exactly one.

### 0c. Snapshot blob measurement (Finding #5, snapshot half)

- **File:** `storage-quota.service.ts:114-117` (the `findUnique({ select: { snapshotData: true } })`; `.length` is read at `:120`)
- **Change:** swap the `findUnique` for the same `octet_length(snapshot_data)` `$queryRaw` already used at `snapshot.service.ts:187-191` (`getCachedSnapshotBytes`). Don't pull a multi-MB `bytea` blob back to Node just to read `.length`.
- **Verify:** unit test: `calculateStorageUsage` agrees with `prepareSnapshotCache.bytes` (both are the gzip output length).
- **Caveat:** check how often `calculateStorageUsage` actually runs. `storage-quota.service.ts:84` describes it as "at most once per quota-cleanup event (rare per user)." If frequency is truly rare, this is a polish fix rather than a hot-path win.

### 0d. Helm memory defaults (Finding #3, half)

- **File:** `helm/supersync/values.yaml:178-184`
- **Current baseline:** `requests.memory: 128Mi`, `limits.memory: 256Mi`.
- **Change:** raise `limits.memory` to `1Gi`; raise `requests.memory` to `512Mi`. Add a comment naming the constants that drive the upper bound (`MAX_SNAPSHOT_DECOMPRESSED_BYTES`, `MAX_REPLAY_STATE_SIZE_BYTES`) and note the image-level `NODE_OPTIONS=--max-old-space-size=896`.
- **Why:** realistic single snapshot uploads can peak around 310-390MB (decompressed body + parsed JS object + serialized string + gzip output + baseline). Two concurrent snapshots can reach 600MB-1GB, so 512Mi remains fragile unless snapshot concurrency is separately pinned.
- **Also:** sweep `docs/sync-and-op-log/` for any documentation citing 256Mi.

---

## Phase 1 — Upload batch processing (Finding #1, the big one)

The plan-as-originally-drafted underspecified four real cases. The revised design below makes each explicit.

### 1a. Refactor `processOperation` into a batch primitive

**File:** `packages/super-sync-server/src/sync/sync.service.ts` — caller at `:459-467`, worker at `:634-790+`, and the upsert/counter/syncDevice tail at `:445-518`.

**New shape, in order, inside the existing `tx`:**

1. **Validate all ops in memory** (`validationService.validateOp`) — no DB. Produce a `decisions: Array<{ op, status: 'valid' | 'rejected', errorCode? }>`.

2. **Dedupe by `op.id` within the batch.** If two ops in the same batch share an `id`, accept the first and reject subsequent ones as `DUPLICATE_OPERATION` — by id only, not content. This must happen before reserving sequence numbers; otherwise `lastSeq` advances for the duplicate and a server_seq gap is left when the row is silently skipped at insert time.

   **Deliberate divergence from the legacy per-op path (C4):** for an intra-batch `[A, A']` where the second op shares `A`'s id but has _different_ content, the legacy loop inserts `A` then catches `A'` at the DB and returns `INVALID_OP_ID`; the batch path returns `DUPLICATE_OPERATION`. Both are terminal rejections with no persisted row and no sequence gap, so all sync invariants hold — but the client treats them differently (`DUPLICATE_OPERATION` → marked synced silently; `INVALID_OP_ID` → hard rejection + error surfaced). This is an accepted behavior change while both paths coexist behind `SUPERSYNC_BATCH_UPLOAD`: the batch outcome (idempotent, non-noisy) is the preferred one. Pinned by the `sync.service.spec.ts` test "rejects an intra-batch same-id op as DUPLICATE_OPERATION even when its content differs". If the legacy path is retired, this divergence retires with it.

3. **Prefetch existing op-id duplicates in one query:**

   ```ts
   const existing = await tx.operation.findMany({
     where: { id: { in: validOpIds } },
     select: {
       /* fields needed by isSameDuplicateOperation */
     },
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

5. **Conflict detection in memory** against the prefetched map, **updating the map as each non-full-state op is accepted** so intra-batch conflicts (two ops on the same entity inside one batch) resolve in order — matches today's serial semantics. Full-state ops (`SYNC_IMPORT`/`BACKUP_IMPORT`/`REPAIR`) bypass conflict detection, as in `detectConflict` lines 129-136; they are not entity-scoped (`entityType: 'ALL'`, no `entityId`), so map invalidation is a no-op.

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

7. **Bulk insert** with one `tx.operation.createMany({ data: rows })`. **Do NOT pass `skipDuplicates: true`.** Phase 1's correctness assumes the in-memory dedupe (step 2) and prefetch (step 3) have caught all duplicate ids; a row-level dup at insert time means our snapshot was stale and the right answer is to fail the batch with `P2002` on the operations primary key → outer 40001-style retry, not to silently drop a row whose sequence number we already reserved.

8. **Run `_aggregatePriorVectorClock` once** if the batch contained any accepted full-state op (`isFullStateOpType(op.opType)`). This call (`sync.service.ts:600-628`) reads historical ops via `jsonb_each_text LATERAL`; it's not prefetchable. Use `beforeServerSeq = lastAcceptedFullStateOp.serverSeq` with `WHERE server_seq < beforeServerSeq`, so the aggregate includes prior history and accepted earlier-in-batch ops but excludes the full-state op itself and any later batch inserts. Persist `latestFullStateSeq` and `latestFullStateVectorClock` once. If a batch somehow contains two full-state ops, process them in batch-order — the last write wins, matching today's per-op-loop behavior.

9. **Storage counter update** (`sync.service.ts:504-518`) — keep the `acceptedDeltaBytes` accumulation, summing `computeOpStorageBytes(op)` over accepted ops. Preserve the `isCleanSlate` SET-vs-INCREMENT branching exactly.

10. **`syncDevice.upsert`** (`:476-495`) — per-batch already; stays as is.

### 1b. FIX 1.5 — drop, with a recorded rationale

Drop the per-op re-check at `sync.service.ts:786-794`. The safety it covered is delivered by the **shared `user_sync_state.lastSeq` row-write**, which forces concurrent batches to serialize: the second writer blocks on the row lock, then fails with `40001` (serialization failure) on commit. RR isolation alone does NOT provide this — PostgreSQL RR does not run full serializable snapshot isolation. The row-lock pattern is what makes the new design safe.

**Already recorded as `ARCHITECTURE-DECISIONS.md` Decision #4** ("Batch Uploads Under RepeatableRead", line 121). Anyone proposing to remove the `lastSeq` increment from the hot path (e.g. sharded sequence assignment, distributed counters) must re-read that decision before doing so.

### 1c. Tests

- Extend `tests/sync.service.spec.ts`. Mock surfaces use the existing hand-rolled `vi.mock('../src/db', …)` pattern (not Prisma `$on('query')`, which isn't wired). Use `vi.spyOn(prisma.operation, 'findMany')` etc. to assert call counts.
  - **25-op batch:** exactly 1 `findMany` for dup-id prefetch, 1 `findMany` (or `$queryRaw`) for entity prefetch, 1 `INSERT ... ON CONFLICT` for the sync-state row, 1 `operation.createMany`, 1 `syncDevice.upsert`, 1 `UPDATE users` counter, optionally 1 `_aggregatePriorVectorClock`.
  - **Intra-batch duplicate `op.id`:** `[A, A]` — first accepted, second audited `DUPLICATE_OPERATION`, `lastSeq` advances by exactly 1, exactly one row inserted.
  - **Intra-batch entity conflict:** `[op1, op2]` on the same entity — op1 wins, op2 rejected as concurrent.
  - **Multi-entity op:** an op with `entityIds: [a, b, c]` correctly drives the prefetch and conflict-detection.
  - **First-time user:** no `user_sync_state` row → upload succeeds; the `INSERT ... ON CONFLICT` creates the row with `last_seq = accepted.length`.
  - **Full-state op in batch:** `_aggregatePriorVectorClock` runs exactly once at the end and sees only rows with `server_seq < fullState.serverSeq`.
  - **Partial-acceptance batch:** 5 dups + 15 accepted → counters correct, audit log has 20 entries.
  - **Concurrency:** two parallel batches on same user — outer retry on `P2034` / `40001` handles the loser. (This is unchanged in spirit but the failure mode shifts from "per-op re-check" to "shared row lock" — verify it still works.)
  - **Sequence-gap invariant:** mixed-batch `[accept, reject, accept, reject, accept]` → persisted rows have contiguous `serverSeq = N, N+1, N+2`, `lastSeq` advances by exactly 3, no gaps anywhere.
  - **No-double-terminal invariant:** every accepted op produces exactly zero rejection audits; every rejected op produces exactly zero persisted rows. Run across the full audit-event taxonomy (`OP_REJECTED`, `DUPLICATE_OPERATION`, `INVALID_OP_ID`, `CONFLICT_*`).
  - **TIMESTAMP_CLAMPED additive case:** an op with `timestamp > now + maxClockDriftMs` produces one persisted row with the clamped timestamp **plus** one additional `TIMESTAMP_CLAMPED` audit event. The clamp is not a rejection — both outcomes coexist for the same op.
- **E2E:** `e2e/tests/sync/` (not `e2e/sync/`) — add one batch-of-50 upload test and assert latency drop vs. baseline.
- **Bench:** docker-compose Postgres, time 25-op and 100-op upload before/after. **Also measure concurrent-batch latency:** the shared row-lock means two simultaneous batches serialize hard — the per-batch latency under contention may be similar to today's per-op design. Total throughput should still win because each batch holds the lock for far less wall time.

### 1d. Risk and rollout

- Highest-blast-radius change in the plan. Land behind config flag `SUPERSYNC_BATCH_UPLOAD`, default `false` for one release, `true` the next.
- **Wire the flag** (shipped in `src/config.ts:172-179`): `batchUpload = (SUPERSYNC_BATCH_UPLOAD === 'true') && (SUPERSYNC_PAYLOAD_BYTES_BACKFILL_COMPLETE === 'true')`. The first condition without the second throws at startup with a message pointing operators at `npm run migrate-payload-bytes`. The DB-side complement is the startup self-check (see Cross-cutting): if `batchUpload === true` but `operations` still contains rows with `payload_bytes = 0`, the server refuses to boot. This closes the trust hole if an operator flips the env flag too early.
- **Route cap** (shipped in `sync.routes.ts:85, 601-604`): `MAX_OPS_PER_BATCH = SUPER_SYNC_MAX_OPS_PER_UPLOAD = 100` (from `packages/shared-schema/src/supersync-http-contract.ts:5`). Enforced before Zod parsing, returns HTTP 413 with `errorCode: 'PAYLOAD_TOO_LARGE'`. Same value also enforced inside the Zod schema as `.max(SUPER_SYNC_MAX_OPS_PER_UPLOAD)` so the OpenAPI contract stays in sync.
- **Invariant:** every op in the batch produces exactly one terminal-status audit (rejection) OR exactly one persisted row, plus optionally one additive `TIMESTAMP_CLAMPED` audit — never both terminal outcomes, never neither, never gapped sequence numbers.

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

**Correct backfill:** stream `operations` rows per user in small batches from a one-time Node script, compute `computeOpStorageBytes(row)` per row, and batch the writes:

```sql
UPDATE operations
SET payload_bytes = v.bytes::bigint
FROM (VALUES ...) AS v(id, bytes)
WHERE operations.id = v.id
```

This preserves correctness while avoiding one network round trip per row. Run it as a separate `migrate-payload-bytes.ts` (mirroring the existing `migrate-passkey-credentials.ts` pattern) **outside** the Prisma migration framework — Prisma migrations run synchronously at startup, and a synchronous backfill on a 100M-row `operations` table would block the server for hours.

There is no clean SQL equivalent of `Buffer.byteLength(JSON.stringify(payload))` over JSONB. `octet_length(payload::text)` is close but reads/detoasts every row, which is the very disk-I/O DoS the file's comment warns about.

### 2c. Write path

- **All insert sites** populate `payload_bytes` per op using `computeOpStorageBytes` so the on-row value matches the increment-counter value the hot path is already adding. Both code paths are wired today: batch path at `sync.service.ts:1115`, legacy per-op path at `:1393`. This is the consistency `calculateStorageUsage` needs and the reason an old per-op insert deployed under `SUPERSYNC_BATCH_UPLOAD=false` does not seed drift while batch is rolled out.

### 2d. Read path

- Replace `storage-quota.service.ts:109-112` with the `CASE WHEN` form already shipped at `:97-120`:
  ```sql
  SELECT COALESCE(
    SUM(
      CASE
        WHEN payload_bytes > 0 THEN payload_bytes
        ELSE octet_length(payload::text)::bigint +
             octet_length(vector_clock::text)::bigint
      END
    ),
    0
  ) AS total
  FROM operations
  WHERE user_id = $1
  ```
- The `ELSE` branch (option (b) in the design analysis) is the only candidate on the same UTF-8 scale as `computeOpStorageBytes`. Detoasting cost is bounded — only un-backfilled rows hit it, and the set drains monotonically to zero.
- Drop `pg_column_size` entirely. No detoasting on backfilled rows, no I/O DoS.
- Snapshot side is handled in 0c.

### 2e. Tests

- Unit: after a 100-op upload, `calculateStorageUsage` and the cached `storage_used_bytes` counter agree to the byte.
- Test: reconcile-after-upload is idempotent (drift = 0).
- Test: a synthetic row with `payload_bytes = 0` (pre-backfill) still produces a conservative fallback SUM. Hard-cut rollout on backfill completion: `SUPERSYNC_BATCH_UPLOAD=true` must require an operator-set completion flag after `npm run migrate-payload-bytes` finishes.

---

## Phase 3 — Snapshot serialization off the hot path (Finding #3, remainder)

Pick after profiling Phase 0d in production:

### 3a. Streaming serialize + gzip (conditional, NOT a default win)

- Replace `prepareSnapshotCache` (`snapshot.service.ts:175-184`) with a streaming pipeline: a streaming JSON stringifier feeding `zlib.createGzip()`, collecting chunks into a final `Buffer.concat(...)`.
- **Pursue only if Phase 0d profiling shows OOM near `MAX_SNAPSHOT_DECOMPRESSED_BYTES` AND event-loop blocking — not memory pressure alone.** The 3-5× wall-clock regression vs native `JSON.stringify` makes this a memory-vs-latency trade.
- Net peak memory: saves the intermediate serialized string buffer (~100MB on large states), but the parsed JS object remains because it already exists. Expect roughly 30-40% peak reduction, not 50%+.
- **Verification gate:** `snapshotData` is only used for byte-count accounting and gunzip-then-parse round-tripping (verified — no hash or content comparison anywhere in `src/`). So byte-for-byte stability is NOT required; round-trip correctness is. Add a property-based test: random state → stream-stringify-gzip → gunzip-parse → deep-equal original.

### 3b. Worker-thread offload (only if replay moves too)

- Do not move only `JSON.stringify(state)` into a `worker_threads` worker. Structured-cloning a large state into the worker temporarily doubles heap and can cost more event-loop time than the stringify it avoids. Worker offload only makes sense if replay and stringify both move to the worker.

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

All `tokenVersion: { increment: 1 }` write sites plus account deletion must invalidate. Already wired in code with `// AUTH_CACHE_INVALIDATION:` comments adjacent to each write — kept here for future-PR awareness:

- `auth.ts:77`/`:80` (`revokeAllTokens`)
- `auth.ts:96`/`:102` (`replaceToken`)
- `auth.ts:108` (post-write second invalidate after the new token version is read back)
- `passkey.ts:592`/`:616` (passkey recovery — pre- and post-write)
- `passkey.ts:278` (unverified-user delete in registration flow)
- `api.ts:210`/`:213`/`:215` (`prisma.user.delete` in account deletion — both pre- and post-delete invalidate)

`isVerified` currently has no flip-to-zero path (`passkey.ts:277` deletes unverified users rather than flipping the flag). The assumption is already documented at `auth-cache.ts:80` — if a future code path adds verification revocation, the cache will serve stale "valid" for up to TTL.

### 4c. Multi-instance concerns

- `helm/supersync/values.yaml:193` caps `maxReplicas: 1`, so in-process LRU is safe. Comment explicitly so a future multi-instance rollout doesn't accidentally introduce 30s revocation lag.

### 4d. Tests

- Unit: revoke-and-replace invalidates cache; expired tokens still hit DB; tokenVersion mismatch falls through; user deletion invalidates cache; passkey recovery invalidates cache.
- Bench: 1000 sequential `verifyToken` calls — expect ~10× p50 latency drop on warm cache.

---

## Cross-cutting

- **Merge order:** 0a, 0b, 0c, 0d can land in any order, in parallel with Phase 1 design. Phase 2 depends on Phase 1 (same code paths). Phase 3 is conditional. Phase 4 is independent.
- **Telemetry first:** before Phase 1 lands, add structured logging of `(opsInBatch, txDurationMs, dbRoundtrips)` to `uploadOps` so we can quantify the win. Existing audit log handles per-op decisions; add a single batch-summary line.
- **Backfill-flag DB self-check:** the env-only `SUPERSYNC_PAYLOAD_BYTES_BACKFILL_COMPLETE=true` flag is operator-trusted. To prevent a too-early flip, the server runs a cheap `EXISTS (SELECT 1 FROM operations WHERE payload_bytes = 0 LIMIT 1)` probe at startup whenever `batchUpload === true` and refuses to boot if any unbackfilled rows remain.
- **Reconcile guard during backfill window:** `calculateStorageUsage` returns a `hasUnbackfilledRows` flag (computed from a `BOOL_OR(payload_bytes = 0)` over the same single scan). `updateStorageUsage` skips the `users.storage_used_bytes` write when the flag is true, so an approximate SUM-with-`octet_length`-fallback never replaces the exact incrementally-maintained counter mid-backfill. The forced-reconcile marker is preserved across the skip so the next call (after backfill completes) reconciles correctly.
- **ADR:** see `ARCHITECTURE-DECISIONS.md` Decision #4 ("Batch Uploads Under RepeatableRead"); already merged.
- **Docs:** update `docs/sync-and-op-log/operation-log-architecture-diagrams.md` §upload-path if it diagrams the per-op loop.
- **Prisma migrate dev:** document the shadow-DB workaround for migrations containing `CREATE INDEX CONCURRENTLY`; `migrate deploy` can run the production workaround, but `migrate dev` wraps migration SQL in a transaction where `CONCURRENTLY` is forbidden.
- **Server seq precision:** any raw `last_seq` read that crosses the JavaScript boundary must hard-fail if it is not a safe integer instead of blindly calling `Number(...)`.
- **Test patterns:** the codebase uses `vi.mock('../src/db', …)` with hand-rolled mocks, not Prisma `$on('query')` interceptors. Test-count assertions must use `vi.spyOn` on the mock surfaces.
- **Out of scope:** WebSocket fan-out, cleanup-job optimization, passkey paths. None flagged in the audit.

---

## Estimated impact (rough order of magnitude)

| Phase | Hot path affected             | Expected win                                                                                                           | Risk                       |
| ----- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 0a    | Snapshot fast-path validation | Eliminates seq-range scan on **encrypted-op count**; full-state `findFirst` rechecks unchanged                         | very low                   |
| 0b    | Snapshot replay               | ~5–10× fewer full stringifications on large replays; zero (no regression) on the common small/incremental replay       | low                        |
| 0c    | Quota reconcile               | Skips blob load (tens of MB)                                                                                           | very low                   |
| 0d    | All routes (memory headroom)  | Stops OOMs near snapshot cap                                                                                           | low (ops change)           |
| 1     | Upload (every client batch)   | ~5× fewer DB round trips on 25-op batch; shorter `user_sync_state` row lock; throughput-positive even under contention | medium-high                |
| 2     | Quota reconcile (slow path)   | Removes `pg_column_size` table scan; consistency between SUM and counter                                               | medium (schema + backfill) |
| 3     | Snapshot upload memory        | ~30-40% lower peak heap if streaming wins in profiling                                                                 | medium                     |
| 4     | Auth on every request         | ~10× p50 latency drop on warm cache                                                                                    | low                        |
