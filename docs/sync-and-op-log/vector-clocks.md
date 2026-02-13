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

Three operations — compare, merge, and prune (`limitVectorClockSize`) — are implemented in the shared package (`packages/shared-schema/src/vector-clock.ts`), used by both client and server. Two operations — initialize and increment — are client-only (`src/app/core/util/vector-clock.ts`), which also wraps the shared operations with null-handling and logging.

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

The global clock is the **single source of truth** for the client's current causal knowledge. During local operation capture, it is updated atomically with operation writes (single IndexedDB transaction via `appendWithVectorClockUpdate`). The remote merge path (`mergeRemoteOpClocks`) updates the clock in a separate write after reading the current state.

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
4. `appendWithVectorClockUpdate(op, 'local')` writes the operation AND updates the global clock in a **single atomic IndexedDB transaction**

**Key invariant: Normal operations carry full (unpruned) vector clocks. No client-side pruning happens during capture.**

### Step 2: Upload to Server

In `sync.service.ts` (`processOperation`):

1. `ValidationService.validateOp()` sanitizes the clock (DoS cap at 2.5×MAX = 50 entries) but does **NOT** prune
2. `detectConflict()` compares the **full unpruned** incoming clock against the existing entity clock
3. If accepted: `limitVectorClockSize(clock, [clientId])` prunes to MAX before storage, preserving only the uploading client's ID
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

Implemented in `packages/shared-schema/src/vector-clock.ts`. The client wrapper in `src/app/core/util/vector-clock.ts` adds logging and passes `[currentClientId]` as the preserve list.

### When Pruning Happens (Exhaustive List)

| Location                                        | When                                            | What's Preserved      |
| ----------------------------------------------- | ----------------------------------------------- | --------------------- |
| **Server** `processOperation()`                 | After conflict detection, before storage        | Uploading client's ID |
| **Server** `getOpsSinceWithSeq()`               | Aggregating snapshot vector clock               | Requesting client     |
| **Client** `SyncHydrationService`               | Creating SYNC_IMPORT during conflict resolution | Current client only   |
| **Client** `ServerMigrationService`             | Creating SYNC_IMPORT during migration           | Current client only   |
| **Client** `RepairOperationService`             | Creating REPAIR operation                       | Current client only   |
| **Client** normal op capture                    | **NEVER**                                       | N/A                   |
| **Client** `SupersededOperationResolverService` | **NEVER** (conflict resolution)                 | N/A                   |

### Pruning is Rare

With MAX=20, a user needs 21+ unique client IDs before pruning triggers. In the unlikely event it does trigger, the worst case is one extra server round-trip (false CONCURRENT → client resolves → re-uploads with >MAX clock → GREATER_THAN → accepted).

---

## 6. Conflict Detection & Resolution (Server Upload)

### Server-Side Flow

1. Server finds the latest operation for the same entity (`findFirst` by `entityType + entityId`, ordered by `serverSeq desc`)
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
| Auto-repair                          | `RepairOperationService` | Get current global clock → increment → prune to MAX                                      |

### Full-State Operations Skip Server Conflict Detection

In `detectConflict()`, operations with `opType` of `SYNC_IMPORT`, `BACKUP_IMPORT`, or `REPAIR` return `{ hasConflict: false }` immediately. These operations replace entire state and don't operate on individual entities.

### The `SyncImportFilterService` Algorithm

Implemented in `src/app/op-log/sync/sync-import-filter.service.ts`:

1. **Find the latest full-state op** — check current batch AND local store (via `getLatestFullStateOpEntry()`), keep the one with the latest UUIDv7 ID
2. For each non-full-state operation in the batch:
   - Compare `op.vectorClock` vs import clock
   - `GREATER_THAN` or `EQUAL` → **keep**
   - `CONCURRENT` + same client as import + higher counter → **keep** (same-client check)
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

4. **`compareVectorClocks` produces identical results on client and server.** Both import from `@sp/shared-schema`. The client wrapper only adds null handling.

5. **Full-state ops skip conflict detection on server.** `detectConflict()` returns `{ hasConflict: false }` for SYNC_IMPORT, BACKUP_IMPORT, and REPAIR.

6. **CONCURRENT ops are FILTERED (not kept) against SYNC_IMPORT** — unless identified as legacy pruning artifacts or same-client ops. Clean slate semantics — this is the explicit, correct behavior.

7. **Global clock is REPLACED (not merged) on remote SYNC_IMPORT.** `mergeRemoteOpClocks()` starts from the import's clock as the base, then merges remaining ops on top. This prevents clock bloat.

8. **DoS cap is NOT pruning.** `sanitizeVectorClock()` rejects clocks with > 2.5×MAX (50) entries entirely — it doesn't prune them down. This is a validation gate, not a size reduction.

---

## 10. Key Files Reference

| Concept                                                     | File(s)                                                                      |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Core algorithms (compare, merge, prune)                     | `packages/shared-schema/src/vector-clock.ts`                                 |
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
