# Operation Log & Sync: Quick Reference

This document provides visual summaries of each major component in the operation log and sync system. For detailed documentation, see `operation-log-architecture.md` and `operation-log-architecture-diagrams.md`.

---

## Area 1: Write Path

The write path captures user actions and persists them as operations to IndexedDB.

```
┌─────────────────────────────────────────────────────────────────┐
│                         Write Path                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. User Action  ──►  NgRx Dispatch                            │
│                              │                                  │
│  2. Reducers     ──►  State Updated (optimistic)               │
│                              │                                  │
│  3. Meta-reducer ──►  operationCaptureMetaReducer              │
│                              │                                  │
│  4. Queue        ──►  OperationCaptureService.enqueue()        │
│                              │                                  │
│  5. Effect       ──►  OperationLogEffects.persistOperation$    │
│                              │                                  │
│  6. Lock         ──►  Web Locks API (cross-tab coordination)   │
│                              │                                  │
│  7. Clock        ──►  incrementVectorClock(clock, clientId)    │
│                              │                                  │
│  8. Validate     ──►  validateOperationPayload() (Checkpoint A)│
│                              │                                  │
│  9. Persist      ──►  SUP_OPS.ops (IndexedDB)                  │
│                              │                                  │
│ 10. Upload       ──►  ImmediateUploadService.trigger()         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key Files:**

- `operation-capture.meta-reducer.ts` - Captures persistent actions
- `operation-capture.service.ts` - FIFO queue
- `operation-log.effects.ts` - Writes to IndexedDB
- `operation-log-store.service.ts` - IndexedDB wrapper

---

## Area 2: Read Path (Hydration)

The read path loads application state at startup by combining a snapshot with tail operations.

```
┌─────────────────────────────────────────────────────────────────┐
│                         Read Path                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. App Startup                                                 │
│                              │                                  │
│  2. Parallel Recovery  ──►  _recoverPendingRemoteOps()         │
│                              _migrateVectorClockFromPfapi()     │
│                              hasStateCacheBackup()              │
│                              │                                  │
│  3. Load Snapshot     ──►  SUP_OPS.state_cache                 │
│                              │                                  │
│  4. Schema Migration  ──►  migrateStateIfNeeded() (if needed)  │
│                              │                                  │
│  5. Validate          ──►  Checkpoint B                        │
│                              │                                  │
│  6. Restore Clock     ──►  setVectorClock(snapshot.vectorClock)│
│                              │                                  │
│  7. Load to NgRx      ──►  loadAllData(snapshot.state)         │
│                              │                                  │
│  8. Load Tail Ops     ──►  getOpsAfterSeq(lastAppliedOpSeq)    │
│                              │                                  │
│  9. Migrate Tail      ──►  _migrateTailOps()                   │
│                              │                                  │
│ 10. Bulk Replay       ──►  bulkApplyOperations()               │
│                              │                                  │
│ 11. Validate          ──►  Checkpoint C                        │
│                              │                                  │
│ 12. Save Snapshot     ──►  saveStateCache() (if many ops)      │
│                              │                                  │
│ 13. Deferred Check    ──►  _scheduleDeferredValidation() (5s)  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key Files:**

- `operation-log-hydrator.service.ts` - Orchestrates hydration
- `schema-migration.service.ts` - Schema migrations
- `bulk-hydration.meta-reducer.ts` - Bulk operation application

---

## Area 3: Server Sync (SuperSync)

SuperSync exchanges individual operations with a centralized server.

```
┌─────────────────────────────────────────────────────────────────┐
│                    COMPLETE SYNC CYCLE                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. UPLOAD                                                      │
│     ├─ Flush pending writes                                    │
│     ├─ Server migration check (inside lock)                    │
│     ├─ Upload ops in batches of 25                             │
│     ├─ Receive piggybacked ops + rejected ops list             │
│     ├─ Process piggybacked → triggers conflict detection       │
│     └─ Handle rejected → LWW or mark rejected                  │
│                                                                 │
│  2. DOWNLOAD (if hasMorePiggyback or scheduled)                │
│     ├─ GET /ops?sinceSeq=X                                     │
│     ├─ Gap detection → reset to seq 0 if needed                │
│     ├─ Filter already-applied ops                              │
│     ├─ Decrypt if encrypted                                    │
│     ├─ Paginate while hasMore                                  │
│     └─ Return ops for processing                               │
│                                                                 │
│  3. PROCESS REMOTE OPS                                         │
│     ├─ Schema migration                                        │
│     ├─ Filter ops invalidated by SYNC_IMPORT                   │
│     ├─ Full-state op? → Apply directly                         │
│     ├─ Conflict detection via vector clocks                    │
│     ├─ LWW resolution if conflicts                             │
│     ├─ Apply to NgRx via operationApplier                      │
│     ├─ Merge clocks                                            │
│     └─ Validate state (Checkpoint D)                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key Files:**

- `operation-log-sync.service.ts` - Sync orchestration
- `operation-log-upload.service.ts` - Upload logic
- `operation-log-download.service.ts` - Download logic

---

## Area 4: Conflict Detection

Conflict detection uses vector clocks to determine causal relationships.

```
                      Remote Op Arrives
                            │
                            ▼
                ┌───────────────────────┐
                │ Get entity IDs from op│
                └───────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            ▼                               ▼
    For each entityId:                 All checked?
            │                               │
            ▼                               ▼
    ┌───────────────────┐          Return { conflicts,
    │ Build local       │          nonConflicting }
    │ frontier clock    │
    └───────────────────┘
            │
            ▼
    ┌───────────────────┐
    │ Compare clocks    │
    │ local vs remote   │
    └───────────────────┘
            │
    ┌───────┼───────┬───────────┬──────────┐
    ▼       ▼       ▼           ▼          ▼
  EQUAL  GREATER  LESS       CONCURRENT
    │    _THAN    _THAN          │
    │       │       │            │
    ▼       ▼       ▼            ▼
  Skip    Skip   Has local   TRUE CONFLICT
  (dup) (superseded) pending?  → Collect
                    │
              ┌─────┴─────┐
              ▼           ▼
             NO          YES
              │           │
              ▼           ▼
           Apply      CONFLICT
                     (needs pending)
```

**Comparison Results:**

| Comparison     | Meaning           | Has Local Pending? | Action                   |
| -------------- | ----------------- | ------------------ | ------------------------ |
| `EQUAL`        | Same operation    | N/A                | Skip (duplicate)         |
| `GREATER_THAN` | Local is newer    | N/A                | Skip (superseded remote) |
| `LESS_THAN`    | Remote is newer   | No                 | Apply remote             |
| `LESS_THAN`    | Remote is newer   | Yes                | Apply (remote dominates) |
| `CONCURRENT`   | Neither dominates | No                 | Apply remote             |
| `CONCURRENT`   | Neither dominates | Yes                | **TRUE CONFLICT**        |

**Key Files:**

- `vector-clock.service.ts` - Vector clock management
- `conflict-resolution.service.ts` - Conflict detection logic
- `src/app/sync/util/vector-clock.ts` - Clock comparison

---

## Area 5: Conflict Resolution (LWW)

Last-Write-Wins automatically resolves conflicts using timestamps.

```
┌─────────────────────────────────────────────────────────────────┐
│                    LWW RESOLUTION PIPELINE                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. CONFLICT DETECTED (vector clocks CONCURRENT)               │
│     Local ops: [Op1, Op2]   Remote ops: [Op3]                  │
│                                                                 │
│  2. COMPARE TIMESTAMPS                                          │
│     local_max = max(Op1.ts, Op2.ts)                            │
│     remote_max = max(Op3.ts)                                    │
│                                                                 │
│  3a. IF local_max > remote_max → LOCAL WINS                    │
│      ├─ Create new UPDATE op with:                             │
│      │   • Current state from NgRx store                       │
│      │   • Merged clock (all ops) + increment                  │
│      │   • Preserved original timestamp                        │
│      ├─ Reject old local ops (superseded clocks)               │
│      ├─ Store remote ops, mark rejected                        │
│      └─ New op will sync on next cycle                         │
│                                                                 │
│  3b. IF remote_max >= local_max → REMOTE WINS                  │
│      ├─ Apply remote ops to NgRx                               │
│      ├─ Reject local ops (including ALL pending for entity)   │
│      └─ Remote state is now authoritative                      │
│                                                                 │
│  4. VALIDATE STATE (Checkpoint D)                               │
│     Run validateAndRepairCurrentState()                        │
│                                                                 │
│  5. NOTIFY USER                                                 │
│     "Auto-resolved X conflicts: Y local, Z remote wins"        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key Invariants:**

| Invariant                         | Reason                                                                     |
| --------------------------------- | -------------------------------------------------------------------------- |
| Archive-wins rule                 | `moveToArchive` always wins over field-level updates, bypassing timestamps |
| Preserve original timestamp       | Prevents unfair advantage in future conflicts                              |
| Merge ALL clocks                  | New op dominates everything known                                          |
| Reject ALL pending ops for entity | Prevents superseded ops from being uploaded                                |
| Mark rejected BEFORE applying     | Crash safety                                                               |
| Remote wins on tie                | Server-authoritative                                                       |

**Superseded Operation Special Cases:**

| Operation Type  | Superseded Handling                                                                           |
| --------------- | --------------------------------------------------------------------------------------------- |
| Regular UPDATE  | Re-created with current entity state + merged clock                                           |
| DELETE          | Re-created with original payload + merged clock (entity gone from store)                      |
| `moveToArchive` | Re-created with original payload + merged clock (entity removed from NgRx by archive reducer) |

**Key Files:**

- `conflict-resolution.service.ts` - LWW resolution + archive-wins rule
- `superseded-operation-resolver.service.ts` - Superseded op handling (incl. moveToArchive special case)

---

## Area 6: SYNC_IMPORT Filtering

Clean slate semantics ensure imports restore all clients to the same state.

```
┌─────────────────────────────────────────────────────────────────┐
│                 SYNC_IMPORT FILTERING PIPELINE                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Remote Ops Received: [Op1, Op2, SYNC_IMPORT, Op3, Op4]        │
│                                                                 │
│  1. FIND IMPORTS                                                │
│     ├─ Check current batch for SYNC_IMPORT/BACKUP_IMPORT/REPAIR│
│     └─ Check local store for previously downloaded import      │
│                                                                 │
│  2. DETERMINE LATEST IMPORT                                     │
│     └─ Compare by UUIDv7 ID (time-ordered)                     │
│                                                                 │
│  3. FOR EACH OP:                                                │
│     ├─ Is it a full-state op? → ✅ Keep                        │
│     └─ Compare vectorClock with import's clock:                │
│         ├─ GREATER_THAN → ✅ Keep (has knowledge)              │
│         ├─ EQUAL        → ✅ Keep (same history)               │
│         ├─ LESS_THAN    → ❌ Drop (dominated)                  │
│         └─ CONCURRENT   → ❌ Drop (clean slate)                │
│                                                                 │
│  4. RETURN                                                      │
│     ├─ validOps: [SYNC_IMPORT, Op4]                            │
│     └─ invalidatedOps: [Op1, Op2, Op3]                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Why Vector Clocks, Not UUIDv7 Timestamps?**

| Approach          | Problem                                     |
| ----------------- | ------------------------------------------- |
| UUIDv7 Timestamps | Affected by clock drift                     |
| Vector Clocks     | Track **causality** - immune to clock drift |

**Key Files:**

- `sync-import-filter.service.ts` - Filtering logic

---

## Area 7: Archive Handling

Archive data bypasses NgRx and is stored directly in IndexedDB.

```
┌─────────────────────────────────────────────────────────────────┐
│                   ARCHIVE HANDLING PIPELINE                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  LOCAL OPERATION                                                │
│  ───────────────                                                │
│  1. User completes task                                         │
│  2. ArchiveService writes to archiveYoung (BEFORE dispatch)    │
│  3. Dispatch moveToArchive action                               │
│  4. Reducer updates NgRx state                                  │
│  5. ArchiveOperationHandlerEffects                              │
│     └─ handleOperation() → SKIP (already written)              │
│  6. Operation logged with payload (no archive data!)            │
│                                                                 │
│  REMOTE OPERATION                                               │
│  ────────────────                                               │
│  1. Download moveToArchive operation                            │
│  2. OperationApplierService.applyOperations()                   │
│     ├─ dispatch(bulkApplyOperations) → Reducer updates state   │
│     └─ handleOperation() → Write to archiveYoung               │
│  3. Result: Same archive state as originating client            │
│                                                                 │
│  KEY INSIGHT: Archive data NOT in operation payload!            │
│  Each client executes the SAME deterministic logic locally.     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Why This Architecture?**

| Concern      | Solution                                        |
| ------------ | ----------------------------------------------- |
| Archive size | Don't sync archive data in operations           |
| Consistency  | Deterministic replay produces same result       |
| Performance  | Local writes, no network overhead               |
| Sync safety  | Operations carry timestamps for reproducibility |

**Key Files:**

- `archive-operation-handler.service.ts` - Unified handler
- `archive-operation-handler.effects.ts` - Local action routing
- `operation-applier.service.ts` - Calls handler for remote ops

---

## Area 8: Meta-Reducers

Meta-reducers enable atomic multi-entity changes in a single reducer pass.

```
┌─────────────────────────────────────────────────────────────────┐
│              META-REDUCER CHAIN (8 Phases, 15 Entries)          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Action Dispatched                                              │
│        │                                                        │
│        ▼                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Phase 1: operationCaptureMetaReducer    [MUST BE FIRST] │   │
│  │          Captures original state BEFORE modifications   │   │
│  └─────────────────────────────────────────────────────────┘   │
│        │                                                        │
│        ▼                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Phase 2: bulkOperationsMetaReducer                      │   │
│  │          Unwraps bulk dispatches for hydration/sync     │   │
│  │          Pre-scans for archive ops to prevent           │   │
│  │          resurrection via LWW Update                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│        │                                                        │
│        ▼                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Phase 3: undoTaskDeleteMetaReducer                      │   │
│  │          Captures task context before deletion          │   │
│  └─────────────────────────────────────────────────────────┘   │
│        │                                                        │
│        ▼                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Phase 4: Core CRUD Meta-Reducers (dependency order)     │   │
│  │          • taskSharedCrudMetaReducer                     │   │
│  │          • taskBatchUpdateMetaReducer                    │   │
│  │          • taskSharedLifecycleMetaReducer                │   │
│  │          • taskSharedSchedulingMetaReducer               │   │
│  └─────────────────────────────────────────────────────────┘   │
│        │                                                        │
│        ▼                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Phase 5: Entity-Specific Cascades                       │   │
│  │          • projectSharedMetaReducer                      │   │
│  │          • tagSharedMetaReducer                          │   │
│  │          • issueProviderSharedMetaReducer                │   │
│  │          • taskRepeatCfgSharedMetaReducer                │   │
│  └─────────────────────────────────────────────────────────┘   │
│        │                                                        │
│        ▼                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Phase 6: plannerSharedMetaReducer                       │   │
│  │          Syncs with task.dueDay and TODAY_TAG           │   │
│  └─────────────────────────────────────────────────────────┘   │
│        │                                                        │
│        ▼                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Phase 7: Synthetic Multi-Step Operations                │   │
│  │          • shortSyntaxSharedMetaReducer                  │   │
│  │          • lwwUpdateMetaReducer                          │   │
│  │            (adapter / singleton / unsupported patterns)  │   │
│  └─────────────────────────────────────────────────────────┘   │
│        │                                                        │
│        ▼                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Phase 8: actionLoggerReducer            [MUST BE LAST]  │   │
│  │          Pure logging only                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│        │                                                        │
│        ▼                                                        │
│  Final State                                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Critical Ordering Rules:**

- `operationCaptureMetaReducer` must be at index 0 (captures pre-modification state)
- `bulkOperationsMetaReducer` must be at index 1 (unwraps bulk before other reducers run)
- `actionLoggerReducer` must be last (logs final state)
- Development mode validates these constraints at startup

**Why Meta-Reducers for Multi-Entity Changes?**

| Approach      | Problem                                                  |
| ------------- | -------------------------------------------------------- |
| Effects       | Multiple dispatches = multiple operations = partial sync |
| Meta-reducers | Single pass = single operation = atomic sync             |

**Example: Tag Deletion Cascade**

```
deleteTag({ id: 'tag-1' })
       │
       ▼ (tag-shared.reducer.ts)
┌─────────────────────────────────────────┐
│ 1. Remove tag from tag.ids              │
│ 2. Remove tag from task.tagIds (all)    │
│ 3. Remove tag from planner references   │
│ 4. Update TODAY_TAG.taskIds if needed   │
└─────────────────────────────────────────┘
       │
       ▼
Single operation logged with all changes
```

**Key Files:**

- `meta-reducer-registry.ts` - Ordering documentation
- `tag-shared.reducer.ts` - Tag deletion cascade
- `project-shared.reducer.ts` - Project deletion cascade
- `planner-shared.reducer.ts` - Planner updates

---

## Area 9: Compaction

Compaction prevents the operation log from growing indefinitely.

```
┌─────────────────────────────────────────────────────────────────┐
│                    COMPACTION PIPELINE                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  TRIGGER                                                        │
│  ───────                                                        │
│  Every 500 operations (COMPACTION_THRESHOLD)                    │
│  OR Emergency (storage quota exceeded)                          │
│                                                                 │
│  STEPS (all within OPERATION_LOG lock)                          │
│  ─────                                                          │
│  1. Get current state from NgRx store                           │
│                   │                                             │
│  2. Get current vector clock                                    │
│                   │                                             │
│  3. Get lastSeq IMMEDIATELY before saving                       │
│                   │                                             │
│  4. Extract snapshotEntityKeys from state                       │
│     (for conflict detection post-compaction)                    │
│                   │                                             │
│  5. Save snapshot to IndexedDB (state_cache):                   │
│     {                                                           │
│       state: currentState,                                      │
│       lastAppliedOpSeq: lastSeq,                                │
│       vectorClock: currentVectorClock,                          │
│       compactedAt: Date.now(),                                  │
│       schemaVersion: CURRENT_SCHEMA_VERSION,                    │
│       snapshotEntityKeys: [...]                                 │
│     }                                                           │
│                   │                                             │
│  6. Reset compaction counter                                    │
│                   │                                             │
│  7. Delete old operations WHERE:                                │
│     ├─ syncedAt IS SET (never drop unsynced ops!)              │
│     ├─ appliedAt < cutoff (7 days, or 1 day emergency)         │
│     └─ seq <= lastSeq (keep tail for conflict frontier)         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key Constants:**

| Constant                            | Value      | Purpose                   |
| ----------------------------------- | ---------- | ------------------------- |
| `COMPACTION_THRESHOLD`              | 500 ops    | Triggers compaction       |
| `COMPACTION_RETENTION_MS`           | 7 days     | Keep synced ops           |
| `EMERGENCY_COMPACTION_RETENTION_MS` | 1 day      | Aggressive cleanup        |
| `COMPACTION_TIMEOUT_MS`             | 25 seconds | Abort before lock expires |

**Safety Rules:**

| Rule                      | Why                       |
| ------------------------- | ------------------------- |
| Never delete unsynced ops | Would lose user data      |
| Get lastSeq BEFORE saving | Race window safety        |
| Keep ops within retention | Allow conflict resolution |

**Key Files:**

- `operation-log-compaction.service.ts` - Compaction logic
- `operation-log.effects.ts` - Trigger and counter
- `operation-log.const.ts` - Configuration constants

---

## Area 10: Bulk Application

Bulk application optimizes performance by applying many operations in a single dispatch.

```
┌─────────────────────────────────────────────────────────────────┐
│                   BULK APPLICATION FLOW                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  WITHOUT BULK (naive):                                          │
│  Op1 → dispatch → update → effects                              │
│  Op2 → dispatch → update → effects                              │
│  ...                                                            │
│  Op500 → dispatch → update → effects                            │
│  Result: 500 updates, 500 effect evaluations                    │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  WITH BULK (optimized):                                         │
│  [Op1, Op2, ..., Op500]                                        │
│           │                                                     │
│           ▼                                                     │
│  dispatch(bulkApplyOperations({ operations }))                  │
│           │                                                     │
│           ▼ (in bulkOperationsMetaReducer)                     │
│  ┌────────────────────────────────────────┐                    │
│  │  // Pre-scan: collect archived IDs     │                    │
│  │  archivedIds = findArchiveOps(ops)     │                    │
│  │                                        │                    │
│  │  for (op of operations) {              │                    │
│  │    action = convertOpToAction(op)      │                    │
│  │    // Skip LWW Updates for archived    │                    │
│  │    if (isLwwUpdate(action) &&          │                    │
│  │        archivedIds.has(entityId))      │                    │
│  │      continue;                         │                    │
│  │    state = reducer(state, action)      │                    │
│  │  }                                     │                    │
│  │  return state                          │                    │
│  └────────────────────────────────────────┘                    │
│           │                                                     │
│           ▼                                                     │
│  Single store update                                            │
│  Effects see only: '[OperationLog] Bulk Apply Operations'       │
│                                                                 │
│  Result: 1 update, 0 individual effect triggers (10-50x faster) │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Why Effects Don't Fire:**

| Effect Type    | Behavior                                                    |
| -------------- | ----------------------------------------------------------- |
| Action-based   | Only see `bulkApplyOperations` (no listener)                |
| Selector-based | Suppressed by `HydrationStateService.isApplyingRemoteOps()` |

**Key Files:**

- `bulk-hydration.meta-reducer.ts` - Core loop
- `bulk-hydration.action.ts` - Action definition
- `operation-converter.util.ts` - Op → Action conversion
- `operation-applier.service.ts` - Orchestration

---

## Area 11: Encryption (E2E)

End-to-end encryption ensures the server never sees plaintext data.

```
┌─────────────────────────────────────────────────────────────────┐
│                   ENCRYPTION ARCHITECTURE                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  CLIENT A                    SERVER               CLIENT B      │
│  ─────────                   ──────               ─────────     │
│                                                                 │
│  { task: "secret" }                                             │
│        │                                                        │
│        ▼                                                        │
│  ┌─────────────┐                                                │
│  │  Argon2id   │ ← User password                               │
│  │  Key Derive │   (64MB memory-hard)                          │
│  └─────────────┘                                                │
│        │                                                        │
│        ▼                                                        │
│  ┌─────────────┐                                                │
│  │  AES-256    │                                                │
│  │  GCM Encrypt│                                                │
│  └─────────────┘                                                │
│        │                                                        │
│        ▼                                                        │
│  "base64..." ──────────► [Encrypted blob] ─────────►            │
│                          (server stores)            │           │
│                                                     ▼           │
│                                            ┌─────────────┐      │
│                                            │  AES-256    │      │
│                                            │  GCM Decrypt│      │
│                                            └─────────────┘      │
│                                                     │           │
│                                                     ▼           │
│                                            { task: "secret" }   │
│                                                                 │
│  SERVER SEES: Encrypted base64 blobs only                       │
│  ZERO KNOWLEDGE: Server cannot read operation payloads          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Encryption Parameters:**

| Parameter         | Value             |
| ----------------- | ----------------- |
| Algorithm         | AES-256-GCM       |
| Key derivation    | Argon2id          |
| Salt length       | 16 bytes (random) |
| IV length         | 12 bytes (random) |
| Argon2 memory     | 64 MB             |
| Argon2 iterations | 3                 |

**Encrypted Blob Format:**

```
┌──────────────────────────────────────────────────────────┐
│ Salt (16B) │ IV (12B) │ Ciphertext + GCM Auth Tag       │
└──────────────────────────────────────────────────────────┘
                    → Encoded as base64 for transport
```

**Key Files:**

- `operation-encryption.service.ts` - High-level API
- `sync/encryption/encryption.ts` - AES-GCM + Argon2id
- `operation-log-upload.service.ts` - Encryption during upload
- `operation-log-download.service.ts` - Decryption during download

---

## Area 12: Unified File-Based Sync

All sync providers (WebDAV, Dropbox, LocalFile, SuperSync) now use the unified operation log system.

```
┌─────────────────────────────────────────────────────────────────┐
│                   UNIFIED SYNC ARCHITECTURE                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              OperationLogSyncService                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            │                                    │
│              ┌─────────────┴─────────────┐                     │
│              ▼                           ▼                      │
│  ┌────────────────────┐     ┌────────────────────────────────┐ │
│  │ FileBasedSyncAdapter│     │  SuperSyncProvider             │ │
│  │ (OperationSyncable) │     │  (OperationSyncable)           │ │
│  │                    │     │                                │ │
│  │  ├─ uploadOps()    │     │  ├─ uploadOps()                │ │
│  │  ├─ downloadOps()  │     │  ├─ downloadOps()              │ │
│  │  └─ uploadSnapshot │     │  └─ uploadSnapshot()           │ │
│  └────────────────────┘     └────────────────────────────────┘ │
│              │                           │                      │
│  ┌───────┬───┴───┬──────────┐           │                      │
│  ▼       ▼       ▼          ▼           ▼                      │
│ WebDAV Dropbox LocalFile  ...     SuperSync Server             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**File-Based Sync Model (Unified):**

```
Remote Storage (WebDAV/Dropbox folder):

/superProductivity/
├── sync-data.json      ← Single file with:
│                         • Full state snapshot
│                         • Recent ops buffer (200)
│                         • Vector clock
│                         • Archive data
└── sync-data.json.bak  ← Backup of previous version
```

**All Providers Now Use Same Interface:**

| Aspect        | File-Based (WebDAV/Dropbox/LocalFile) | SuperSync             |
| ------------- | ------------------------------------- | --------------------- |
| Granularity   | Individual operations                 | Individual operations |
| Conflict Unit | Single entity                         | Single entity         |
| Resolution    | Automatic (LWW)                       | Automatic (LWW)       |
| Storage       | Single sync-data.json                 | PostgreSQL            |
| History       | Recent 200 ops                        | Full op log           |

**Key Files:**

- `op-log/sync-providers/file-based/file-based-sync-adapter.service.ts` - File-based adapter
- `op-log/sync-providers/file-based/file-based-sync.types.ts` - Types for sync-data.json
- `op-log/sync-providers/super-sync/super-sync.ts` - SuperSync provider
- `op-log/sync/operation-log-sync.service.ts` - Main sync orchestration
- `op-log/persistence/pfapi-migration.service.ts` - Legacy PFAPI migration

---

## File Reference

```
src/app/op-log/
├── core/                                 # Types, constants, errors
│   ├── operation.types.ts                # Type definitions
│   ├── operation-log.const.ts            # Constants
│   ├── persistent-action.interface.ts    # Action interface
│   └── entity-registry.ts                # Entity type registry
├── capture/                              # Write path: Actions → Operations
│   ├── operation-capture.meta-reducer.ts # Captures persistent actions
│   ├── operation-capture.service.ts      # FIFO queue
│   └── operation-log.effects.ts          # Writes to IndexedDB
├── apply/                                # Read path: Operations → State
│   ├── bulk-hydration.action.ts          # Bulk apply action
│   ├── bulk-hydration.meta-reducer.ts    # Applies ops in single pass
│   ├── operation-applier.service.ts      # Apply ops to NgRx
│   ├── operation-converter.util.ts       # Op → Action conversion
│   ├── hydration-state.service.ts        # Tracks hydration state
│   └── archive-operation-handler.service.ts # Archive side effects
├── store/                                # IndexedDB persistence
│   ├── operation-log-store.service.ts    # IndexedDB wrapper
│   ├── operation-log-hydrator.service.ts # Startup hydration
│   ├── operation-log-compaction.service.ts # Snapshot + GC
│   └── schema-migration.service.ts       # Schema migrations
├── sync/                                 # Server sync (SuperSync)
│   ├── operation-log-sync.service.ts     # Sync orchestration
│   ├── operation-log-upload.service.ts   # Upload logic
│   ├── operation-log-download.service.ts # Download logic
│   ├── conflict-resolution.service.ts    # LWW resolution
│   ├── sync-import-filter.service.ts     # SYNC_IMPORT filtering
│   ├── vector-clock.service.ts           # Clock management
│   └── operation-encryption.service.ts   # E2E encryption
├── validation/                           # State validation
│   ├── validate-state.service.ts         # State consistency checks
│   └── validate-operation-payload.ts     # Operation validation
├── util/                                 # Shared utilities
│   ├── entity-key.util.ts                # Entity key helpers
│   └── client-id.provider.ts             # Client ID management
└── testing/                              # Test infrastructure
    ├── integration/                      # Integration tests
    └── benchmarks/                       # Performance tests
```
