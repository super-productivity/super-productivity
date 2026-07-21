# Vector Clocks Architecture

## 1. Overview

Vector clocks track **causality** — "did this client know about that operation?" — rather than wall-clock time, which can drift between devices. They are the foundation of conflict detection and SYNC_IMPORT filtering in Super Productivity's sync system.

### Core Type

```typescript
interface VectorClock {
  [clientId: string]: number;
}
```

Each entry maps a client ID to a monotonically increasing counter. A clock with `{A: 5, B: 3}` means "this state includes A's first 5 operations and B's first 3 operations".

### Constants

| Constant                | Value | Purpose                           |
| ----------------------- | ----- | --------------------------------- |
| `MAX_VECTOR_CLOCK_SIZE` | 20    | Maximum entries in a pruned clock |

At 6-char client IDs, a 20-entry clock is ~333 bytes — negligible bandwidth. A user needs 21+ unique client IDs (reinstalls/new browsers) before pruning triggers, which is extremely unlikely for a personal productivity app.

---

## 2. Core Operations

Three operations — compare, merge, and prune (`limitVectorClockSize`) — are implemented in the generic sync-core package (`packages/sync-core/src/vector-clock.ts`), used by both client and server. Two operations — initialize and increment — are client-only (`src/app/core/util/vector-clock.ts`), which also wraps the shared operations with null-handling and logging.

### Create

```typescript
initializeVectorClock(clientId) → { [clientId]: 0 }
```

### Increment

```typescript
incrementVectorClock(clock, clientId) → { ...clock, [clientId]: clock[clientId] + 1 }
```

Throws on overflow (approaching `MAX_SAFE_INTEGER`). The only recovery is a `SYNC_IMPORT` to reset clocks.

### Compare

```typescript
compareVectorClocks(a, b) → EQUAL | LESS_THAN | GREATER_THAN | CONCURRENT
```

Standard vector clock comparison. Missing keys are treated as zero.

### Merge

```typescript
mergeVectorClocks(a, b) → { [key]: max(a[key], b[key]) for all keys in a ∪ b }
```

Creates a new clock that dominates both inputs.

---

## 3. Where Vector Clocks Live

### Per-Operation Clock

Every `Operation` carries a `vectorClock` field — the global clock state at the time the operation was created. This is the primary mechanism for causality tracking.

### Global Clock Store

Stored in IndexedDB (`SUP_OPS` database, `vector_clock` object store) as a `VectorClockEntry`:

```typescript
interface VectorClockEntry {
  clock: VectorClock; // Current global clock
  lastUpdate: number; // Timestamp of last update
}
```

The global clock is the **single source of truth** for the client's current causal knowledge. During local operation capture, it is updated atomically with operation writes (single IndexedDB transaction via `appendWithVectorClockOverwrite`). The remote merge path (`mergeRemoteOpClocks`) is likewise a single read-merge-write transaction with a fresh in-transaction read of the durable clock — never the per-tab cache — so concurrent tabs cannot lose entries to a stale read.

### Snapshot Clock

The `state_cache` stores a `vectorClock` representing the clock at compaction time. This serves as a baseline for entities that haven't been modified since the last snapshot.

### Entity Frontier

Per-entity latest clocks, computed on demand by `VectorClockService.getEntityFrontier()`. Built by scanning operations after the snapshot. Used for fine-grained conflict detection.

---

## 4. Vector Clock Lifecycle (Normal Operations)

### Step 1: Local Operation Created

In `operation-log.effects.ts`:

1. `VectorClockService.getCurrentVectorClock()` reads the global clock from the `vector_clock` store
2. `incrementVectorClock(currentClock, clientId)` creates a new clock with the client's counter incremented
3. The operation is created with this **full, unpruned** clock
4. `appendWithVectorClockOverwrite(op, 'local')` writes the operation AND updates the global clock in a **single atomic IndexedDB transaction**

**Key invariant: Normal operations carry full (unpruned) vector clocks. No client-side pruning happens during capture.**

### Step 2: Upload to Server

In `sync.service.ts` (`processOperation`):

1. `ValidationService.validateOp()` sanitizes the clock (DoS cap at 2.5×MAX = 50 entries) but does **NOT** prune
2. `detectConflict()` compares the **full unpruned** incoming clock against the existing entity clock
3. If accepted: `limitVectorClockSize()` prunes to MAX before storage, preserving the uploading client and, when present, the latest causal full-state author
4. The pruned clock is stored in the database

### Step 3: Download by Other Clients

In `operation-log-store.service.ts` (`mergeRemoteOpClocks`):

1. Each downloaded operation's clock is merged into the local global clock
2. For full-state operations (SYNC_IMPORT/BACKUP_IMPORT/REPAIR), the global clock is **replaced** (not merged) with the import's clock, then remaining ops are merged on top — existing entries not present in the import's clock **can be lost**
3. For non-full-state downloads, the merge preserves all existing entries (inherits new entries without losing existing ones)

### Key Insight

Normal operations are **NEVER** pruned client-side. The server prunes **after** comparison but **before** storage. This asymmetry is critical — see [Section 6](#6-conflict-detection--resolution-server-upload) for why.

---

## 5. Pruning

### Why Pruning Exists

Clocks grow with each new client. Without bounds, a user who has used many devices would have ever-growing clocks. Pruning limits clocks to `MAX_VECTOR_CLOCK_SIZE` (20) entries.

### The `limitVectorClockSize` Algorithm

```
Input: clock, preserveClientIds[]
If entries ≤ MAX: return clock unchanged
Otherwise:
  1. Add entries from preserveClientIds first (capped at MAX)
  2. Fill remaining slots with highest-counter entries (sorted descending)
  3. Return clock with exactly MAX entries
```

Implemented in `packages/sync-core/src/vector-clock.ts`. Client-side pruning is **store-owned** (#9096): `OperationLogStoreService.pruneClockForStorage` assembles the preserve set — current client + latest full-state author — and every durable-clock write routes through it. Importing `limitVectorClockSize` anywhere else in `src/app` fails lint (`no-restricted-imports`); the wrapper in `src/app/core/util/vector-clock.ts` (adds logging) is importable only by the store.

### When Pruning Happens (Exhaustive List)

| Location                                                                                                                                                                                                                             | When                                                                                                             | What's Preserved                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Server** `processOperation()`                                                                                                                                                                                                      | After conflict detection, before storage                                                                         | Uploading client + active full-state author |
| **Server** `getOpsSinceWithSeq()`                                                                                                                                                                                                    | Aggregating snapshot vector clock                                                                                | Requesting client                           |
| **Client** `OperationLogStoreService` — `calculateRemoteClockMerge` (remote merge + reducer checkpoint, in-transaction)                                                                                                              | Durable clock after a remote batch                                                                               | Current client + latest full-state author   |
| **Client** `OperationLogStoreService.pruneClockForStorage` — inside `setVectorClock`, `saveStateCache`, `commitFileSnapshotBaseline`; called directly by `SyncHydrationService` / `ServerMigrationService` for SYNC_IMPORT op clocks | Every other durable-clock write (snapshot save, compaction, hydration restore, sync-hydration baseline, imports) | Current client + latest full-state author   |
| **Client** callers (snapshot, compaction, hydrator, sync-hydration, server-migration)                                                                                                                                                | **NEVER** — they pass raw clocks; the store prunes (lint-enforced)                                               | N/A                                         |
| **Client** in-store direct clock writes (`appendWithVectorClockOverwrite`, `runRemoteStateReplacement`, `runDestructiveStateReplacement`, `appendRecoveryOperationAndSnapshot`)                                                      | **NEVER** — write full, minimal, or already-server-pruned clocks by design                                       | N/A                                         |
| **Client** `RepairOperationService`                                                                                                                                                                                                  | **NEVER** — REPAIR ships the full clock; the server prunes after conflict detection                              | N/A                                         |
| **Client** normal op capture                                                                                                                                                                                                         | **NEVER**                                                                                                        | N/A                                         |
| **Client** `SupersededOperationResolverService`                                                                                                                                                                                      | **NEVER** (conflict resolution)                                                                                  | N/A                                         |

### Pruning is Rare

With MAX=20, a user needs 21+ unique client IDs before pruning triggers. Both sides preserve the latest causal full-state author alongside their own id: the server when storing uploaded ops, the client at every site that prunes the durable clock (#9096). Preserving that boundary edge matters because `classifyOpAgainstSyncImport` rescues a post-import op from a different client via exactly one predicate — `op.vectorClock[importAuthor] >= importCounter` — and `limitVectorClockSize` never re-invents an absent entry, so an author dropped from the client's durable clock would be missing from every subsequent op permanently. Other pruned edges can still cause one extra server round-trip (false CONCURRENT → client resolves → re-uploads with >MAX clock → GREATER_THAN → accepted).

---

## 6. Conflict Detection & Resolution (Server Upload)

### Server-Side Flow

1. Server finds the latest operation for the same entity — **two separately-indexed lookups**, a scalar `findFirst` plus a raw-SQL `MATERIALIZED` CTE over `entity_ids`, taking whichever has the higher `serverSeq`. Deliberately NOT one combined filter; see the multi-entity section below for why that caused an outage.
2. Compares incoming clock vs existing clock using the **full unpruned** incoming clock
3. Possible outcomes:
   - `GREATER_THAN` → **accept** (incoming op causally succeeds existing)
   - `EQUAL` + same client → **accept** (retry of same operation)
   - `EQUAL` + different client → **reject** (suspicious clock reuse)
   - `CONCURRENT` → **reject** (true conflict)
   - `LESS_THAN` → **reject** (superseded)
4. If accepted: prune clock, then store

### Client-Side Resolution

When the server rejects an operation:

1. Client receives rejection with `existingClock`
2. `SupersededOperationResolverService.resolveSupersededLocalOps()`:
   - Merges the global clock + all superseded ops' clocks + snapshot clock + extra clocks from force download
   - Calls `mergeAndIncrementClocks()` — **no client-side pruning!**
   - Creates new LWW Update ops with the merged clock
3. Re-uploads → server compares the full merged clock (which now has MAX+1 entries or more) → `GREATER_THAN` → accept
4. Server prunes the merged clock before storage

### Critical Invariant: Server Must Prune AFTER Comparison

If the server pruned before comparison, it would be impossible to build a dominating clock when the entity clock already has MAX entries and the client's ID isn't among them.

**Safety net:** `RejectedOpsHandlerService` tracks resolution attempts per entity. After exceeding `MAX_CONCURRENT_RESOLUTION_ATTEMPTS` (3) consecutive failures, ops are permanently rejected.

---

## 7. SYNC_IMPORT / BACKUP_IMPORT / REPAIR Handling

### The Core Rule: Clean Slate Semantics

An import is an explicit user action to restore **all clients** to a specific state. Operations without knowledge of the import are **dropped**:

| Comparison     | Meaning                                | Action   |
| -------------- | -------------------------------------- | -------- |
| `GREATER_THAN` | Op created after seeing import         | **Keep** |
| `EQUAL`        | Same causal history as import          | **Keep** |
| `CONCURRENT`   | Op created without knowledge of import | **Drop** |
| `LESS_THAN`    | Op is dominated by import              | **Drop** |

`CONCURRENT` ops are dropped even from unknown clients. This ensures a true "restore to point in time" semantic.

### How Import Clocks Are Created

| Source                               | Method                   | Clock Construction                                                                       |
| ------------------------------------ | ------------------------ | ---------------------------------------------------------------------------------------- |
| `BACKUP_IMPORT` (clean slate)        | `BackupService`          | Fresh clock `{newClientId: 1}` — small, no pruning issues                                |
| Server migration                     | `ServerMigrationService` | Merge all local op clocks + global clock → increment → prune to MAX                      |
| Sync hydration (conflict resolution) | `SyncHydrationService`   | Merge local clock + state cache clock + remote snapshot clock → increment → prune to MAX |
| Auto-repair                          | `RepairOperationService` | Get current global clock → increment; ships the full clock unpruned (server prunes)      |

### Full-State Operations Skip Server Conflict Detection

In `detectConflict()`, operations with `opType` of `SYNC_IMPORT`, `BACKUP_IMPORT`, or `REPAIR` return `{ hasConflict: false }` immediately. These operations replace entire state and don't operate on individual entities.

### Multi-Entity Ops and Server-Side Conflict Detection (issue #8334)

An op may carry `entityIds: string[]` (batch actions: `deleteTasks`, `moveToArchive`, `__updateMultipleTaskSimple`, round-time-spent, task-repeat-cfg/board/issue-provider batches). `detectConflict()` checks the **incoming** op against **all** of its `entityIds`. The op must also be **looked up** by all of its entities once stored — otherwise a later stale write to a non-first entity would find no prior writer and be wrongly accepted as non-conflicting.

To make that symmetric, the `operations` row stores:

- `entity_id` — the client-supplied scalar. For batch ops the client sets it to `entityIds[0]` (`operation-log.effects.ts`), but the **server does not enforce** `entity_id === entityIds[0]`. It is the lookup key for single-entity ops and the first entity of multi-entity ops, and is also used by duplicate detection.
- `entity_ids` — the entity set for **multi-entity ops only** (a `text[]` column; populated via `getStoredEntityIds(op)`, which returns `[]` for single-entity ops). Keeping single-entity rows out of this column keeps the `GIN(entity_ids)` index small and the array-branch lookup cheap.

The lookups in `conflict.ts` match a requested entity as the scalar `entity_id` **or** a member of `entity_ids`:

- `detectConflictForEntity` (single) — **two separately-indexed lookups, never one combined filter.** A scalar `findFirst` on `{ userId, entityType, entityId }` ordered by `server_seq` (served end to end by the `(user_id, entity_type, entity_id, server_seq)` btree), plus a raw-SQL `MATERIALIZED` CTE taking `MAX(server_seq)` over `entity_ids @> ARRAY[id]`, with the winning row then fetched by the `(user_id, server_seq)` unique key.

  > ⚠️ **Do not "simplify" this back into one query.** It used to be
  > `where: { OR: [{ entityId }, { entityIds: { has: entityId } }] }` + `orderBy: { serverSeq: 'desc' }`,
  > and on 2026-07-20 that caused a total sync outage — 47 stuck backends, longest 75 minutes,
  > 61/66 connections consumed. The `OR` spans two different indexes and GIN cannot supply
  > `server_seq` ordering, so the planner abandons **both** index paths and walks the user's
  > history. Nothing bounds that walk when the entity has no matching rows — i.e. the
  > first-ever op for a new task, the most common upload there is. Op-log pruning does **not**
  > bound it; that assumption is what this paragraph used to assert, and it was wrong.
  >
  > The obvious escalations are broken too. Two ordered `LIMIT 1` lookups still leave the
  > array side unable to order on GIN. Measured under generic planning on a 40k-row seed, the
  > outage query, the naive array-only `LIMIT 1`, the flat `MAX`, Prisma's `aggregate({ _max })`
  > and the CTE with `MATERIALIZED` dropped **all** read the user's whole entity-type slice,
  > against 143 blocks and 0 discarded for the shipped form. The **816 blocks / 2500 rows
  > discarded** figure is the outage query specifically, pinned by the `CANARY` case in
  > `conflict-entity-lookup-plan.pglite.spec.ts`. The other four are not unguarded: that
  > spec rebuilds the array branch from the live tagged template, so dropping `MATERIALIZED`
  > or flattening the `MAX` blows the block budget and fails there (verified by mutation).
  > What is _not_ pinned is their individual historical block counts.
  >
  > Measure any change here with `SET plan_cache_mode = force_generic_plan`. Prisma sends
  > parameterized prepared statements; under `auto` Postgres plans the first ~5 executions as
  > custom, then compares the generic cost against the average custom cost and **may** switch
  > to a generic plan — a cost comparison, not an automatic switch, so some statements stay on
  > custom plans indefinitely. This one was observed going generic on production, and a
  > generic plan cannot see the parameter values. `EXPLAIN` with literal constants is
  > different again and makes every one of those broken shapes look perfect. See
  > `packages/super-sync-server/tests/conflict-entity-lookup-plan.pglite.spec.ts` and the note
  > at `detectConflictForEntity` in `packages/super-sync-server/src/sync/conflict.ts`.

- `detectConflictForEntities` / `prefetchLatestEntityOpsForBatch` (batch) — raw SQL unnesting the **union** of both columns, `entity_ids || CASE WHEN entity_id IS NULL THEN '{}' ELSE ARRAY[entity_id] END`, deduped by `DISTINCT ON`, with an `entity_ids && ... OR entity_id = ANY(...)` prefilter so the `GIN(entity_ids)` index (migration `20260613000001`) and the existing `entity_id` btree stay usable.

  > ⚠️ It must be a **union**, not the mutually exclusive
  > `CASE WHEN cardinality(entity_ids) > 0 THEN entity_ids ELSE ARRAY[entity_id] END`
  > this section used to document. The server does **not** enforce
  > `entity_id === entityIds[0]`, so a multi-entity op can carry a scalar that is not a
  > member of its own `entity_ids` (see `getStoredEntityIds`). The exclusive form drops
  > that scalar whenever the array is non-empty, making the entity invisible to conflict
  > lookups — a later concurrent write to it is wrongly accepted, which is **silent data
  > loss**. That was the #8334 bug; the divergent-scalar case is the decisive test in
  > `tests/integration/conflict-detection-sql.integration.spec.ts`.

**Forward-only by design:** rows written before migration `20260613000000` have an empty `entity_ids` array, so they are reached only by their scalar `entity_id` (= first entity) — via the scalar arm of the batch union above, or the scalar branch of the single-entity lookup. (Not via the exclusive `CASE` form: that is the removed #8334 bug documented in the warning above, not the current shape.) There is no `UPDATE` backfill. Entities 2..n of already-stored multi-entity ops were never persisted and are unrecoverable, so they remain invisible to conflict detection until that entity gets a fresh write. This residual is bounded: client-side LWW is unaffected (the client persists the full op and `VectorClockService.getEntityFrontier()` fans each op out to **every** entity), and the server only builds an authoritative snapshot from non-encrypted ops (`replayOpsToState()` throws on encrypted ops), so the pre-fix gap could only surface a stale value to a fresh client on non-encrypted self-hosted servers.

### The `SyncImportFilterService` Algorithm

Implemented in `src/app/op-log/sync/sync-import-filter.service.ts`:

1. **Find the latest full-state op** — the last full-state op in the downloaded batch wins (server apply order); otherwise use the non-rejected local full-state entry with the greatest local sequence. UUIDv7 IDs are identities, not causal clocks, because a device clock can move backwards.
2. For each non-full-state operation in the batch:
   - Compare `op.vectorClock` vs import clock
   - `GREATER_THAN` or `EQUAL` → **keep**
   - `CONCURRENT` + same client as import + higher counter → **keep** (same-client check)
   - `CONCURRENT` against automatic `REPAIR` → **keep and replay after the repair boundary**
   - Otherwise → **filter**

### Same-Client Check

If an op is from the same client that created the import, with a higher counter, it's definitely a post-import op. A client can't create ops concurrent with its own import — counters are monotonically increasing. This check is always correct and cheap (~15 lines).

---

## 8. Key Scenarios (Step-by-Step Traces)

### Scenario 1: Two-Client Sync (No Conflicts)

```
Initial state: Client A and B both know about each other
  A's global clock: {A: 3, B: 2}
  B's global clock: {A: 3, B: 2}

Step 1: A creates a task
  A increments: {A: 4, B: 2}
  Op carries clock: {A: 4, B: 2}
  A's global clock updated to: {A: 4, B: 2}

Step 2: A uploads
  Server compares op clock {A: 4, B: 2} vs latest entity clock (none) → no conflict
  Server stores op (no pruning needed, 2 entries < MAX)

Step 3: B downloads
  B receives op with clock {A: 4, B: 2}
  B merges into global clock: max({A: 3, B: 2}, {A: 4, B: 2}) = {A: 4, B: 2}

Step 4: B creates a task
  B increments: {A: 4, B: 3}
  B's global clock updated to: {A: 4, B: 3}
```

### Scenario 2: Concurrent Modification (Conflict Resolution)

```
Starting state: Both clients synced
  A's clock: {A: 3, B: 2}    B's clock: {A: 3, B: 2}

Step 1: Both modify the same task offline
  A creates op: {A: 4, B: 2}
  B creates op: {A: 3, B: 3}

Step 2: A uploads first → server accepts (no prior op for this entity)
  Server stores: {A: 4, B: 2}

Step 3: B uploads
  Server compares: {A: 3, B: 3} vs {A: 4, B: 2}
  A=3 < 4 (b greater), B=3 > 2 (a greater) → CONCURRENT → reject
  Server returns existingClock: {A: 4, B: 2}

Step 4: B resolves
  SupersededOperationResolverService merges:
    globalClock={A: 3, B: 3} + existingClock={A: 4, B: 2} + opClock={A: 3, B: 3}
    merged = {A: 4, B: 3}, incremented = {A: 4, B: 4}
  Creates new LWW Update op with clock {A: 4, B: 4}
  NO client-side pruning

Step 5: B re-uploads
  Server compares: {A: 4, B: 4} vs {A: 4, B: 2} → GREATER_THAN → accept
  Server stores (pruned if needed, but only 2 entries here)
```

### Scenario 3: SYNC_IMPORT with Small Clock (Clean Slate)

```
Step 1: Client A does BACKUP_IMPORT (full data restore)
  Creates SYNC_IMPORT op with clock: {A: 1}
  Uploads to server

Step 2: Client B has been working offline
  If B never saw A's state: B's clock: {B: 5}
  Compare: {B: 5} vs {A: 1} → CONCURRENT → filtered ✓

  If B had previously synced with A: B's clock: {A: 3, B: 5}
  Compare: {A: 3, B: 5} vs {A: 1} → GREATER_THAN → kept ✓
  (B's ops were created with knowledge beyond the import point)
```

---

## 9. Invariants

Rules that must hold for the system to be correct. Use these to verify implementations and tests.

1. **Normal ops carry full (unpruned) vector clocks.** No pruning in `operation-log.effects.ts`.

2. **Server prunes AFTER comparison, BEFORE storage.** `processOperation()` calls `limitVectorClockSize()` after `detectConflict()` succeeds.

3. **Client does NOT prune during conflict resolution.** `SupersededOperationResolverService` sends full merged clocks; the server prunes after accepting.

4. **`compareVectorClocks` produces identical results on client and server.** Both import from `@sp/sync-core`. The client wrapper only adds null handling.

5. **Full-state ops skip conflict detection on server.** `detectConflict()` returns `{ hasConflict: false }` for SYNC_IMPORT, BACKUP_IMPORT, and REPAIR.

6. **CONCURRENT ops are FILTERED (not kept) against SYNC_IMPORT** — unless identified as legacy pruning artifacts or same-client ops. Clean slate semantics — this is the explicit, correct behavior.

7. **Global clock is REPLACED (not merged) on remote SYNC_IMPORT.** `mergeRemoteOpClocks()` starts from the import's clock as the base, then merges remaining ops on top. This prevents clock bloat.

8. **DoS cap is NOT pruning.** `sanitizeVectorClock()` rejects clocks with > 2.5×MAX (50) entries entirely — it doesn't prune them down. This is a validation gate, not a size reduction.

---

## 10. Key Files Reference

| Concept                                                     | File(s)                                                                      |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Core algorithms (compare, merge, prune)                     | `packages/sync-core/src/vector-clock.ts`                                     |
| Compatibility re-export for existing shared-schema imports  | (removed — imports now target `@sp/sync-core` directly)                      |
| Client wrappers (null handling, logging, validation)        | `src/app/core/util/vector-clock.ts`                                          |
| Global clock management, entity frontier                    | `src/app/op-log/sync/vector-clock.service.ts`                                |
| Operation capture (no pruning, atomic clock update)         | `src/app/op-log/capture/operation-log.effects.ts`                            |
| Clock persistence                                           | `src/app/op-log/persistence/operation-log-store.service.ts`                  |
| Import filtering + same-client check                        | `src/app/op-log/sync/sync-import-filter.service.ts`                          |
| Conflict resolution (no pruning, merges clocks)             | `src/app/op-log/sync/superseded-operation-resolver.service.ts`               |
| Conflict resolution (LWW logic, `mergeAndIncrementClocks`)  | `src/app/op-log/sync/conflict-resolution.service.ts`                         |
| SYNC_IMPORT creation (sync hydration)                       | `src/app/op-log/persistence/sync-hydration.service.ts`                       |
| SYNC_IMPORT creation (server migration)                     | `src/app/op-log/sync/server-migration.service.ts`                            |
| REPAIR creation                                             | `src/app/op-log/validation/repair-operation.service.ts`                      |
| Server: conflict detection + prune after comparison         | `packages/super-sync-server/src/sync/sync.service.ts`                        |
| Server: DoS cap (sanitize, no pruning)                      | `packages/super-sync-server/src/sync/services/validation.service.ts`         |
| Server: snapshot clock pruning during download optimization | `packages/super-sync-server/src/sync/services/operation-download.service.ts` |

---

## 11. History & Rationale (why pruning is the way it is)

Decision-history behind the current pruning design (previously in a separate
research doc, now git-only). Load-bearing context for anyone changing
`MAX_VECTOR_CLOCK_SIZE` or the prune ordering.

### Compare before pruning — and the bugs that proved it

**Never prune a vector clock before using it in a comparison.** Pruning removes
information: a missing entry is ambiguous — "never knew about this client" vs
"entry was pruned" — so a pre-pruned comparison returns CONCURRENT instead of
EQUAL/causal. Two independent incidents established this:

- **Riak #613:** pruning before comparison caused "sibling explosion" — objects
  accumulated hundreds of siblings that could never resolve because pruned
  clocks always compared CONCURRENT.
- **Super Productivity (Feb 2026):** with `MAX = 10`, server pruning before
  comparison caused an infinite rejection loop — a client merges all clocks +
  its own ID (11 entries), the server prunes to 10, the non-shared key forces
  CONCURRENT, the server rejects, the client re-merges, the loop repeats.

Fix in both systems: compare the **full unpruned** clock, then prune **only
before storage**. This is the invariant in §6 and §9.

### Why MAX = 20 (the 10 → 30 → 20 evolution)

The original defense against the Feb-2026 loop was a 4-layer scheme (broad
protected-client tracking, pruning-aware comparison, an
`isLikelyPruningArtifact` heuristic, the same-client check) — symptom treatment.
The root cause was that `MAX = 10` was too small, making pruning frequent and
interacting badly with SYNC_IMPORT.

Commit `d70f18a94d` raised `MAX` 10 → 30 (later reduced to 20 — a 20-entry
clock is ~333 bytes, negligible) and removed the broad tracking and comparison
heuristics. The server now has one narrow storage-only exception: it preserves
the latest causal full-state author so post-import operations retain that
boundary edge.
`isLikelyPruningArtifact` was dropped (known false positives, unnecessary at
MAX = 20). Only the **same-client check** remains — always mathematically
correct during conflict comparison (monotonic counters are definitive) and
independent of MAX. At
MAX = 20, pruning needs **21+ distinct client IDs**, extremely rare for a
personal productivity app, so the pruning path is effectively dormant
(see §5 "Pruning is Rare").

### Future options (only if the server becomes the coordinator)

In a server-authoritative model, clock growth could be bounded without pruning
via **Dotted Version Vectors** (bound to server vnodes, not devices),
**bounded reclaimable client IDs** (needs a registration/retirement protocol),
or **periodic stable-cut GC** (needs all-to-all clock reporting). None apply to
the current dumb-relay model.

### Future option: staleness-informed eviction (issue #9105 — works in the dumb-relay model)

Pruning today evicts the **lowest-counter** entries, but a low counter
correlates with _importance_ (a fresh import author has counter 1), not with
_deadness_ — the heuristic behind the #9089/#9096 preserve-set bugs. Issue
#9105 tracks the root cause: client IDs are minted per install/profile and
retired almost never, so clocks only grow toward MAX. The decision on #9105
was to **park** the fix — post #9089/#9102 the worst case is the benign extra
round-trip of §5 — and record the agreed direction here.

If pruning stops being rare in practice, evict the **stalest** entries instead
of the lowest-counter ones. Unlike the coordinator options above, this fits
the dumb-relay model with no wire-format change:

- **Server:** the `sync_devices` table already stores `lastSeenAt` per
  `(userId, clientId)`, updated on every upload — and uploads are the only
  path that creates clock entries. A daily job already GCs rows unseen for
  `retentionMs` (45 days), so absence from the registry reads as "stalest".
- **Client (all providers):** keep a small durable `clientId → last-merged-op
time` map, updated where remote clocks are merged (`mergeRemoteOpClocks`) —
  every merged op carries its author's ID. Needs no server support, so it
  covers WebDAV / LocalFile / Dropbox too.

The safety profile is identical to today's pruning (entries are dropped either
way; a dropped ID that returns costs at most the extra round-trip of §5), but
victim selection is strictly better: a recently-seen ID — e.g. a fresh import
author — survives by definition, making the preserve-set invariant of
#9089/#9096 _emergent_ instead of hand-maintained at each prune site (the
explicit preserve sets stay as belt-and-braces). Staleness knowledge differs
per node, so nodes may evict different victims; that adds clock asymmetry but
no new failure class — comparison treats missing keys as zero, and clients
already prune with differing preserve sets.

The supported GC today is a **full-state import**: the clock reset keeps only
`{import author, self}` (§7), and the once-per-session pruning snack points
users at it (sync all devices first — imports intentionally drop concurrent
ops, see `SyncImportFilterService`).

**Revisit trigger:** client pruning WARN-logs `prunedIds` / `survivingIds`
into the exportable log history. If prune warnings appear in real bug
reports — especially ones evicting _live_ IDs — promote this from parked to
scheduled.
