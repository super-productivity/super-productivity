# Operation Log Architecture

**Status:** Parts A, B, C, D Complete (single-version; cross-version sync A.7.11 documented, not implemented)
**Branch:** `feat/operation-logs`
**Last Updated:** January 8, 2026

> **Note:** As of January 2026, the legacy PFAPI system has been completely eliminated.
> All sync providers (SuperSync, WebDAV, Dropbox, LocalFile) now use the unified operation log system.

---

## Introduction: The Core Architecture

### The Core Concept: Event Sourcing

The Operation Log fundamentally changes how the app treats data. Instead of treating the database as a "bucket" where we overwrite data (e.g., "The task title is now X"), we treat it as a **timeline of events** (e.g., "At 10:00 AM, User changed task title to X").

- **Source of Truth:** The _Log_ is the truth. The "current state" of the app (what you see on screen) is just a calculation derived by replaying that log from the beginning of time.
- **Immutability:** Once an operation is written, it is never changed. We only append new operations. If you "delete" a task, we don't remove the row; we append a `DELETE` operation.

### 1. How Data is Saved (The Write Path)

When a user performs an action (like ticking a checkbox):

1.  **Capture:** The system intercepts the Redux action (e.g., `TaskUpdate`).
2.  **Wrap:** It wraps this action into a standardized `Operation` object. This object includes:
    - **Payload:** What changed (e.g., `{ isDone: true }`).
    - **ID & Timestamp:** A unique ID (UUID v7) and the time it happened.
    - **Vector Clock:** A version counter used to track causality (e.g., "This change happened _after_ version 5").
3.  **Persist:** This `Operation` is immediately appended to the `SUP_OPS` table in IndexedDB. This is very fast because we're just adding a small JSON object, not rewriting a huge file.
4.  **Broadcast:** The operation is broadcast to other open tabs so they update instantly.

### 2. How Data is Loaded (The Read Path)

Replaying _every_ operation since the beginning would be too slow. We use **Snapshots** to speed this up:

1.  **Load Snapshot:** On startup, the app loads the most recent "Save Point" (a full copy of the app state saved, say, yesterday).
2.  **Replay Tail:** The app then queries the Log: "Give me all operations that happened _after_ this snapshot."
3.  **Fast Forward:** It applies those few "tail" operations to the snapshot. Now the app is fully up to date.
4.  **Hydration Optimization:** If a sync just happened, we might simply load the new state directly, skipping the replay entirely.

### 3. How Sync Works

The Operation Log enables two types of synchronization:

**A. True "Server Sync" (The Modern Way)**
This is efficient and precise.

- **Exchange:** Devices swap individual `Operations`, not full files. This saves massive amounts of bandwidth.
- **Conflict Detection:** Because every operation has a **Vector Clock**, we can mathematically prove if two changes happened concurrently.
  - _Example:_ Device A sends "Update Title (Version 1 -> 2)". Device B sees it has "Version 1", so it applies the update safely.
  - _Conflict:_ If Device B _also_ made a change and is at "Version 2", it knows "Wait, we both changed Version 1 at the same time!" -> **Conflict Detected**.
- **Resolution:** The user is shown a dialog to pick the winner. The loser isn't deleted; it's marked as "Rejected" in the log but kept for history.

**B. "File-Based Sync" (Dropbox, WebDAV, Local File)**
This uses a single-file approach with embedded operations.

- File-based providers sync a single `sync-data.json` file containing: full state snapshot + recent operations buffer
- When syncing, the system downloads the remote file, merges any new operations, and uploads the combined state
- Conflict detection uses vector clocks - if two clients sync concurrently, the "piggybacking" mechanism ensures no operations are lost
- This provides entity-level conflict resolution (vs old model-level "last write wins")

### 4. Safety & Self-Healing

The system assumes data corruption is inevitable (power loss, bad sync, cosmic rays) and builds defenses against it:

- **Validation Checkpoints:** Data is checked _before_ writing to disk, _after_ loading from disk, and _after_ receiving sync data.
- **Auto-Repair:** If the state is invalid (e.g., a subtask points to a missing parent), the app doesn't crash. It runs an auto-repair script (e.g., detaches the subtask) and generates a special **`REPAIR` Operation**.
- **Audit Trail:** This `REPAIR` op is saved to the log. This means you can look back and see exactly _when_ and _why_ the system modified your data automatically.

### 5. Maintenance (Compaction)

If we kept every operation forever, the database would grow huge.

- **Compaction:** Every ~500 operations, the system takes a new Snapshot of the current state.
- **Cleanup:** It then looks for old operations that are already "baked into" that snapshot and have been successfully synced to the server. It safely deletes them to free up space, keeping the log lean.

---

## Overview

The Operation Log serves **four distinct purposes**:

| Purpose                    | Description                                       | Status                        |
| -------------------------- | ------------------------------------------------- | ----------------------------- |
| **A. Local Persistence**   | Fast writes, crash recovery, event sourcing       | Complete ✅                   |
| **B. File-Based Sync**     | Single-file sync for WebDAV/Dropbox/LocalFile     | Complete ✅                   |
| **C. Server Sync**         | Upload/download individual operations (SuperSync) | Complete ✅ (single-version)¹ |
| **D. Validation & Repair** | Prevent corruption, auto-repair invalid state     | Complete ✅                   |

> ¹ **Cross-version sync limitation**: Part C is complete for clients on the same schema version. Cross-version sync (A.7.11) is not yet implemented—see [A.7.11 Conflict-Aware Migration](#a711-conflict-aware-migration-strategy) for guardrails.

> **✅ Migration Ready**: Migration safety (A.7.12), tail ops consistency (A.7.13), and unified migration interface (A.7.15) are now implemented. The system is ready for schema migrations when `CURRENT_SCHEMA_VERSION > 1`.

This document is structured around these four purposes. Most complexity lives in **Part A** (local persistence). **Part B** handles file-based sync via the `FileBasedSyncAdapter`. **Part C** handles operation-based sync with SuperSync server. **Part D** integrates validation and automatic repair.

```
┌───────────────────────────────────────────────────────────────────┐
│                          User Action                              │
└───────────────────────────────────────────────────────────────────┘
                             ▼
                        NgRx Store
                  (Runtime Source of Truth)
                             │
         ┌───────────────────┼───────────────────┐
         ▼                   │                   ▼
   OpLogEffects              │             Other Effects
         │                   │
         ├──► SUP_OPS ◄──────┘
         │    (Local Persistence - Part A)
         │
         └──► Sync Providers
              ├── SuperSync (Part C - operation-based)
              └── WebDAV/Dropbox/LocalFile (Part B - file-based)
```

---

# Part A: Local Persistence

The operation log is primarily a **Write-Ahead Log (WAL)** for local persistence. It provides:

1. **Fast writes** - Small ops are instant vs. serializing 5MB on every change
2. **Crash recovery** - Replay uncommitted ops from log
3. **Event sourcing** - Full history of user actions for debugging/undo

## A.1 Database Architecture

### SUP_OPS Database

```typescript
// ops table - the event log
interface OperationLogEntry {
  seq: number; // Auto-increment primary key
  op: Operation; // The operation
  appliedAt: number; // When applied locally
  source: 'local' | 'remote';
  syncedAt?: number; // For server sync (Part C)
  rejectedAt?: number; // When rejected during conflict resolution
}

// state_cache table - periodic snapshots
interface StateCache {
  state: AllSyncModels; // Full snapshot
  lastAppliedOpSeq: number;
  vectorClock: VectorClock; // Current merged vector clock
  compactedAt: number; // When this snapshot was created
  schemaVersion?: number; // Optional for backward compatibility
}
```

### IndexedDB Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│                         IndexedDB                                    │
├─────────────────────────────────────────────────────────────────────┤
│      'SUP_OPS' database (Operation Log)                             │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │ ops (event log)      - Append-only operation log         │       │
│  │ state_cache          - Periodic state snapshots          │       │
│  │ meta                 - Vector clocks, sync state         │       │
│  │ archive_young        - Recent archived tasks             │       │
│  │ archive_old          - Old archived tasks                │       │
│  └──────────────────────────────────────────────────────────┘       │
│                                                                      │
│  ALL model data persisted here                                       │
└─────────────────────────────────────────────────────────────────────┘
```

**Key insight:** All application data is persisted in the `SUP_OPS` database via the operation log system.

## A.2 Write Path

```
User Action
    │
    ▼
NgRx Dispatch (action)
    │
    ├──► Reducer updates state (optimistic, in-memory)
    │
    └──► OperationLogEffects
              │
              ├──► Filter: action.meta.isPersistent === true?
              │         └──► Skip if false or missing
              │
              ├──► Filter: action.meta.isRemote === true?
              │         └──► Skip (prevents re-logging sync/replay)
              │
              ├──► Convert action to Operation
              │
              ├──► Append to SUP_OPS.ops (disk)
              │
              ├──► Increment META_MODEL.vectorClock (Part B bridge)
              │
              └──► Broadcast to other tabs
```

### Operation Structure

```typescript
interface Operation {
  id: string; // UUID v7 (time-ordered)
  actionType: string; // NgRx action type
  opType: OpType; // CRT | UPD | DEL | MOV | BATCH
  entityType: EntityType; // TASK | PROJECT | TAG | NOTE | ...
  entityId?: string; // Affected entity ID
  entityIds?: string[]; // For batch operations
  payload: unknown; // Action payload
  clientId: string; // Device ID
  vectorClock: VectorClock; // Per-op causality (for Part C)
  timestamp: number; // Wall clock (epoch ms)
  schemaVersion: number; // For migrations
}

type OpType =
  | 'CRT' // Create
  | 'UPD' // Update
  | 'DEL' // Delete
  | 'MOV' // Move (list reordering)
  | 'BATCH' // Bulk operations (import, mass update)
  | 'SYNC_IMPORT' // Full state import from remote sync
  | 'BACKUP_IMPORT' // Full state import from backup file
  | 'REPAIR'; // Auto-repair operation with full repaired state

type EntityType =
  | 'TASK'
  | 'PROJECT'
  | 'TAG'
  | 'NOTE'
  | 'GLOBAL_CONFIG'
  | 'SIMPLE_COUNTER'
  | 'WORK_CONTEXT'
  | 'TASK_REPEAT_CFG'
  | 'ISSUE_PROVIDER'
  | 'PLANNER'
  | 'MENU_TREE'
  | 'METRIC'
  | 'BOARD'
  | 'REMINDER'
  | 'PLUGIN_USER_DATA'
  | 'PLUGIN_METADATA'
  | 'MIGRATION'
  | 'RECOVERY'
  | 'ALL';
```

### Persistent Action Pattern

Actions are persisted based on explicit `meta.isPersistent: true`:

```typescript
// persistent-action.interface.ts
export interface PersistentActionMeta {
  isPersistent?: boolean; // When true, action is persisted
  entityType: EntityType;
  entityId?: string;
  entityIds?: string[]; // For batch operations
  opType: OpType;
  isRemote?: boolean; // TRUE if from Sync (prevents re-logging)
  isBulk?: boolean; // TRUE for batch operations
}

// Type guard - only actions with explicit isPersistent: true are persisted
export const isPersistentAction = (action: Action): action is PersistentAction => {
  const a = action as PersistentAction;
  return !!a.meta && a.meta.isPersistent === true;
};
```

Actions that should NOT be persisted:

- UI-only actions (selectedTaskId, currentTaskId, toggle sidebar, etc.)
- Load/hydration actions (data already in log)
- Upsert actions (typically from sync/import)
- Internal cleanup actions

## A.3 Read Path (Hydration)

```
App Startup
    │
    ▼
OperationLogHydratorService
    │
    ├──► Load snapshot from SUP_OPS.state_cache
    │         │
    │         └──► If no snapshot: Genesis migration from 'pf'
    │
    ├──► Run schema migration if needed
    │
    ├──► Dispatch loadAllData(snapshot, { isHydration: true })
    │
    └──► Load tail ops (seq > snapshot.lastAppliedOpSeq)
              │
              ├──► If last op is SyncImport: load directly (skip replay)
              │
              ├──► Otherwise: Replay ops (prevents re-logging via isRemote flag)
              │
              └──► If replayed >10 ops: Save new snapshot for faster future loads
```

### Hydration Optimizations

Two optimizations speed up hydration:

1. **Skip replay for SyncImport**: When the last operation in the log is a `SyncImport` (full state import), the hydrator loads it directly instead of replaying all preceding operations. This significantly speeds up initial load after imports or syncs.

2. **Save snapshot after replay**: After replaying more than 10 tail operations, a new state cache snapshot is saved. This avoids replaying the same operations on subsequent startups.

### Genesis Migration

On first startup (SUP_OPS empty), the system initializes with default state:

```typescript
async createGenesisSnapshot(): Promise<void> {
  // Initialize with default state or migrate from legacy if present
  const initialState = await this.getInitialState();

  // Create initial snapshot
  await this.opLogStore.saveStateCache({
    state: initialState,
    lastAppliedOpSeq: 0,
    vectorClock: {},
    compactedAt: Date.now(),
    schemaVersion: CURRENT_SCHEMA_VERSION
  });
}
```

For users upgrading from legacy formats, `ServerMigrationService` handles the migration during first sync.

## A.4 Compaction

### Purpose

Without compaction, the op log grows unbounded. Compaction:

1. Creates a fresh snapshot from current NgRx state
2. Deletes old ops that are "baked into" the snapshot

### Triggers

- Every **500 operations**
- After sync download (safety)
- On app close (optional)

### Process

```typescript
async compact(): Promise<void> {
  // 1. Acquire lock
  await this.lockService.request('sp_op_log_compact', async () => {
    // 2. Read current state from NgRx (via delegate)
    const currentState = await this.storeDelegate.getAllSyncModelDataFromStore();

    // 3. Save new snapshot
    const lastSeq = await this.opLogStore.getLastSeq();
    await this.opLogStore.saveStateCache({
      state: currentState,
      lastAppliedOpSeq: lastSeq,
      vectorClock: await this.opLogStore.getCurrentVectorClock(),
      compactedAt: Date.now(),
      schemaVersion: CURRENT_SCHEMA_VERSION
    });

    // 4. Delete old ops (sync-aware)
    // Only delete ops that have been synced AND are older than retention window
    const retentionWindowMs = 7 * 24 * 60 * 60 * 1000; // 7 days
    const cutoff = Date.now() - retentionWindowMs;

    await this.opLogStore.deleteOpsWhere(
      (entry) =>
        !!entry.syncedAt && // never drop unsynced ops
        entry.appliedAt < cutoff &&
        entry.seq <= lastSeq
    );
  });
}
```

### Configuration

| Setting                         | Value   | Description                                    |
| ------------------------------- | ------- | ---------------------------------------------- |
| Compaction trigger              | 500 ops | Ops before snapshot                            |
| Retention window                | 7 days  | Keep recent synced ops                         |
| Emergency retention             | 1 day   | Shorter retention for quota exceeded           |
| Compaction timeout              | 25 sec  | Abort if exceeds (prevents lock expiration)    |
| Max compaction failures         | 3       | Failures before user notification              |
| Unsynced ops                    | ∞       | Never delete unsynced ops                      |
| Max download ops in memory      | 50,000  | Bounds memory during API download              |
| Remote file retention           | 14 days | Server-side operation file retention           |
| Max remote files to keep        | 100     | Minimum recent files on server                 |
| Max conflict retry attempts     | 5       | Retries before rejecting failed ops            |
| Max rejected ops before warning | 10      | Threshold for user notification                |
| Lock timeout                    | 30 sec  | localStorage fallback lock timeout             |
| Lock acquire timeout            | 60 sec  | Max wait to acquire a lock                     |
| Max download retries            | 3       | Retry attempts for failed file downloads       |
| Max ops for snapshot (server)   | 100,000 | Server-side memory protection for snapshot gen |

## A.5 Multi-Tab Coordination

### Write Locking

```typescript
// Primary: Web Locks API
await navigator.locks.request('sp_op_log_write', async () => {
  await this.writeOperation(op);
});

// Fallback: localStorage mutex (for older WebViews)
```

### State Broadcast

When one tab writes an operation:

1. Write to SUP_OPS
2. Broadcast via BroadcastChannel
3. Other tabs receive and apply (with `isRemote=true` to prevent re-logging)

```typescript
// Tab A writes
this.broadcastChannel.postMessage({ type: 'NEW_OP', op });

// Tab B receives
this.broadcastChannel.onmessage = (event) => {
  if (event.data.type === 'NEW_OP') {
    const action = convertOpToAction(event.data.op); // Sets isRemote: true
    this.store.dispatch(action);
  }
};
```

## A.6 LOCAL_ACTIONS Token for Effects

### The Problem

When operations are synced from remote clients (other tabs or devices), they are dispatched to NgRx with `meta.isRemote: true`. Effects that perform side effects (snacks, work logs, notifications, plugin hooks) should NOT run for these remote operations because:

1. **Duplicate side effects** - The side effect already happened on the original client
2. **Invalid state access** - The task/entity referenced by the action may not exist yet (out-of-order delivery)
3. **User confusion** - Showing "Task completed!" snack for something completed on another device hours ago

### The Solution: LOCAL_ACTIONS Injection Token

The `LOCAL_ACTIONS` injection token provides a pre-filtered Actions stream that excludes remote operations:

```typescript
// src/app/util/local-actions.token.ts
import { inject, InjectionToken } from '@angular/core';
import { Actions } from '@ngrx/effects';
import { Action } from '@ngrx/store';
import { Observable } from 'rxjs';
import { filter } from 'rxjs/operators';

export const LOCAL_ACTIONS = new InjectionToken<Observable<Action>>('LOCAL_ACTIONS', {
  providedIn: 'root',
  factory: () => {
    const actions$ = inject(Actions);
    return actions$.pipe(filter((action: Action) => !(action as any).meta?.isRemote));
  },
});
```

### Usage in Effects

Use `LOCAL_ACTIONS` instead of `Actions` for effects that should NOT run for remote operations:

```typescript
@Injectable()
export class MyEffects {
  private _actions$ = inject(LOCAL_ACTIONS); // LOCAL actions only (excludes isRemote)

  // ✅ Use LOCAL_ACTIONS for side effects
  showSnack$ = createEffect(
    () =>
      this._localActions$.pipe(
        ofType(TaskSharedActions.updateTask),
        filter((action) => action.task.changes.isDone === true),
        tap(() => this.snackService.open({ msg: 'Task completed!' })),
      ),
    { dispatch: false },
  );

  // ✅ Use regular actions$ for state updates that should apply everywhere
  moveTaskToList$ = createEffect(() =>
    this._actions$.pipe(
      ofType(moveTaskInTodayList),
      // This dispatches another action - should work for all sources
      map(({ taskId }) => TaskSharedActions.updateTask({ ... })),
    ),
  );
}
```

### When to Use LOCAL_ACTIONS

| Scenario                          | Use LOCAL_ACTIONS? | Reason                                              |
| --------------------------------- | ------------------ | --------------------------------------------------- |
| Show snackbar/toast               | ✅ Yes             | UI notification already happened on original client |
| Post work log to Jira/OpenProject | ✅ Yes             | External API call already made                      |
| Play sound                        | ✅ Yes             | Audio feedback is local-only                        |
| Update Electron taskbar           | ✅ Yes             | Desktop UI is local-only                            |
| Dispatch plugin hooks             | ✅ Yes             | Plugins already ran on original client              |
| Update another entity in store    | ❌ No              | State change should apply everywhere                |
| Navigate/route change             | ✅ Yes             | Navigation is local-only                            |
| Dispatch cascading actions        | ⚠️ Depends         | If it modifies state: No. If side-effect only: Yes  |

---

## A.7 Disaster Recovery

### SUP_OPS Corruption

```
1. Detect: Hydration fails or returns empty/invalid state
2. Check legacy 'pf' database for data
3. If found: Run recovery migration with that data
4. If not: Check remote sync for data
5. If remote has data: Force sync download
6. If all else fails: User must restore from backup
```

### Implementation

```typescript
async hydrateStore(): Promise<void> {
  try {
    const snapshot = await this.opLogStore.loadStateCache();
    if (!snapshot || !this.isValidSnapshot(snapshot)) {
      await this.attemptRecovery();
      return;
    }
    // Normal hydration...
  } catch (e) {
    await this.attemptRecovery();
  }
}

private async attemptRecovery(): Promise<void> {
  // 1. Try backup from state cache
  const backupState = await this.tryLoadBackupSnapshot();
  if (backupState) {
    await this.recoverFromBackup(backupState);
    return;
  }
  // 2. Try remote sync (triggers ServerMigrationService if needed)
  // 3. Show error to user
}
```

## A.7 Schema Migrations

When Super Productivity's data model changes (new fields, renamed properties, restructured entities), schema migrations ensure existing data remains usable after app updates.

> **Current Status:** Migration infrastructure is implemented, but no actual migrations exist yet. The `MIGRATIONS` array is empty and `CURRENT_SCHEMA_VERSION = 1`. This section documents the designed behavior for when migrations are needed.

### Configuration

`CURRENT_SCHEMA_VERSION` is defined in `src/app/op-log/store/schema-migration.service.ts`:

```typescript
export const CURRENT_SCHEMA_VERSION = 1;
export const MIN_SUPPORTED_SCHEMA_VERSION = 1;
export const MAX_VERSION_SKIP = 5; // Max versions ahead we'll attempt to load
```

### Core Concepts

| Concept                    | Description                                                                 |
| -------------------------- | --------------------------------------------------------------------------- |
| **Schema Version**         | Integer tracking current data model version (stored in ops + snapshots)     |
| **Migration**              | Function transforming state from version N to N+1                           |
| **Snapshot Boundary**      | Migrations run when loading snapshots, creating clean versioned checkpoints |
| **Forward Compatibility**  | Newer apps can read older data (via migrations)                             |
| **Backward Compatibility** | Older apps receiving newer ops (via graceful degradation)                   |

### Migration Triggers

```
┌─────────────────────────────────────────────────────────────────────┐
│                    App Update Detected                               │
│                    (schemaVersion mismatch)                          │
└─────────────────────────────────────────────────────────────────────┘
                               │
           ┌───────────────────┼───────────────────┐
           ▼                   ▼                   ▼
    Load Snapshot         Replay Ops         Receive Remote Ops
    (superseded version)       (mixed versions)   (newer/older version)
           │                   │                   │
           ▼                   ▼                   ▼
    Run migrations       Apply ops as-is     Migrate if needed
    on full state        (ops are additive)  (full state imports)
```

### A.7.1 Snapshot Migration (Local)

When app starts and finds a snapshot with older schema version:

```
App Startup (schema v1 → v2)
    │
    ▼
Load state_cache (v1 snapshot)
    │
    ▼
Detect version mismatch: snapshot.schemaVersion < CURRENT_SCHEMA_VERSION
    │
    ▼
Run migration chain: migrateV1ToV2(snapshot.state)
    │
    ▼
Dispatch loadAllData(migratedState)
    │
    ▼
Force new snapshot with schemaVersion = 2
    │
    ▼
Continue with tail ops (ops after snapshot)
```

### A.7.2 Operation Replay (Mixed Versions)

Operations in the log may have different schema versions. During replay:

```typescript
// Operations are "additive" - they describe what changed, not full state
// Example: { opType: 'UPD', payload: { task: { id: 'x', changes: { title: 'new' } } } }

// Old ops apply to migrated state because:
// 1. Fields they reference still exist (or are mapped)
// 2. New fields have defaults filled by migration
// 3. Renamed fields are handled by migration aliases

async replayOperation(op: Operation, currentState: AppDataComplete): Promise<void> {
  // Op schema version is informational - ops apply to current state structure
  // The snapshot was already migrated to current schema
  await this.operationApplier.applyOperations([op]);
}
```

> **Limitation:** Operations are NOT migrated during replay. If a migration renames a field (e.g., `estimate` → `timeEstimate`), old operations referencing `estimate` will apply that field to the entity, potentially causing data inconsistency. To avoid this:
>
> 1. **Prefer additive migrations** - Add new fields with defaults rather than renaming
> 2. **Use aliases in reducers** - If renaming is necessary, reducers should accept both old and new field names
> 3. **Force compaction after migration** - Reduce the window of mixed-version operations
>
> Operation-level migration (transforming old ops to new schema during replay) is listed as a future enhancement in A.7.9.

### A.7.3 Remote Sync (Cross-Version Clients)

When clients run different Super Productivity versions, sync must handle version differences:

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Remote Sync Scenarios                            │
└─────────────────────────────────────────────────────────────────────┘

Scenario 1: Newer client receives older ops
──────────────────────────────────────────
Client v2 ◄─── ops from v1 client
    │
    └── Ops apply normally (additive changes to migrated state)
        Missing new fields use defaults from migration

Scenario 2: Older client receives newer ops
──────────────────────────────────────────
Client v1 ◄─── ops from v2 client
    │
    ├── Individual ops: Unknown fields ignored (graceful degradation)
    │   { task: { id: 'x', changes: { title: 'a', newFieldV2: 'b' } } }
    │                                            ↑ ignored by v1
    │
    └── Full state imports (SYNC_IMPORT): May fail validation
        → User prompted to update app or resolve manually

Scenario 3: Mixed version sync with conflicts
──────────────────────────────────────────
Client v1 conflicts with Client v2
    │
    └── Conflict resolution uses entity-level comparison
        Version-specific fields handled during merge
```

### A.7.4 Full State Imports (SYNC_IMPORT/BACKUP_IMPORT)

When receiving full state from remote (e.g., SYNC_IMPORT from another client):

```typescript
async handleFullStateImport(payload: { appDataComplete: AppDataComplete }): Promise<void> {
  const { appDataComplete } = payload;

  // 1. Detect schema version of incoming state (from schemaVersion field or structure)
  const incomingVersion = appDataComplete.schemaVersion ?? detectSchemaVersion(appDataComplete);

  if (incomingVersion < CURRENT_SCHEMA_VERSION) {
    // 2a. Migrate incoming state up to current version
    const migratedState = await this.migrateState(appDataComplete, incomingVersion);
    this.store.dispatch(loadAllData({ appDataComplete: migratedState }));

  } else if (incomingVersion > CURRENT_SCHEMA_VERSION + MAX_VERSION_SKIP) {
    // 2b. Too far ahead - reject and prompt user to update
    this.snackService.open({
      type: 'ERROR',
      msg: T.F.SYNC.S.VERSION_TOO_OLD,
      actionStr: T.PS.UPDATE_APP,
      actionFn: () => window.open(UPDATE_URL, '_blank'),
    });
    throw new Error(`Schema version ${incomingVersion} requires app update`);

  } else if (incomingVersion > CURRENT_SCHEMA_VERSION) {
    // 2c. Slightly ahead - attempt graceful load with warning
    PFLog.warn('Received state from newer app version', { incomingVersion, current: CURRENT_SCHEMA_VERSION });
    this.snackService.open({
      type: 'WARN',
      msg: T.F.SYNC.S.NEWER_VERSION_WARNING, // "Data from newer app version - some features may not work"
    });
    // Attempt load - unknown fields will be stripped by Typia validation
    // This may cause data loss for fields the older app doesn't understand
    this.store.dispatch(loadAllData({ appDataComplete }));

  } else {
    // 2d. Same version - direct load
    this.store.dispatch(loadAllData({ appDataComplete }));
  }

  // 3. Save snapshot (always with current schema version)
  await this.saveStateCache(/* current state with schemaVersion = CURRENT_SCHEMA_VERSION */);
}
```

### A.7.5 Migration Implementation

Migrations are defined in `src/app/op-log/store/schema-migration.service.ts`.

**How to Create a New Migration:**

1. Increment `CURRENT_SCHEMA_VERSION`
2. Add entry to `MIGRATIONS` array with `fromVersion`, `toVersion`, `description`, `migrate()`
3. Test migration chain (v1→v2→v3 should equal v1→v3)

```typescript
interface SchemaMigration {
  fromVersion: number;
  toVersion: number;
  description: string;
  migrate: (state: unknown) => unknown;
  migrateOperation?: (op: Operation) => Operation | null; // For field renames/removals
  requiresOperationMigration: boolean;
}
```

**Design Principles:**

| Principle                      | Description                                        |
| ------------------------------ | -------------------------------------------------- |
| **Additive changes preferred** | Adding new optional fields with defaults is safest |
| **Avoid breaking renames**     | Use aliases or transformations instead             |
| **Preserve unknown fields**    | Don't strip fields from newer versions             |
| **Idempotent migrations**      | Running twice should be safe                       |

**Version Mismatch Handling:** Remote data too new → prompt user to update app. Remote data too old → show error, may need manual intervention.

### A.7.10 Legacy Data Migration

> **Note:** The legacy PFAPI system has been removed (January 2026). This section documents historical migration paths.

For users upgrading from older versions (pre-operation-log), the `ServerMigrationService` handles migration:

1. On first sync, it detects legacy remote data format
2. Downloads the full state from the legacy format
3. Creates a `SYNC_IMPORT` operation with the imported state
4. Uploads the new format to the sync provider

**Key file:** `src/app/op-log/sync/server-migration.service.ts`

All future schema changes should use the **Schema Migration** system (A.7) described above.

### A.7.6 Implemented Safety Features

**Migration Safety (A.7.12)** ✅ - Backup created before migration; rollback on failure.

**Tail Ops Consistency (A.7.13)** ✅ - Tail ops are migrated during hydration to match current schema.

**Unified Migrations (A.7.15)** ✅ - State and operation migrations linked in single `SchemaMigration` definition.

### A.7.7 When Is Operation Migration Needed?

| Change Type          | State Migration   | Op Migration                   | Example                     |
| -------------------- | ----------------- | ------------------------------ | --------------------------- |
| Add optional field   | ✅ (set default)  | ❌ (old ops just don't set it) | `priority?: string`         |
| Rename field         | ✅ (copy old→new) | ✅ (transform payload)         | `estimate` → `timeEstimate` |
| Remove field/feature | ✅ (delete it)    | ✅ (drop ops or strip field)   | Remove `pomodoro`           |
| Change field type    | ✅ (convert)      | ✅ (convert in payload)        | `"1h"` → `3600`             |
| Add entity type      | ✅ (initialize)   | ❌ (no old ops exist)          | New `Board` entity          |

**Rule of thumb:** Additive changes (new optional fields, new entities) don't need operation migration. Field renames/removals require it.

### A.7.8 Cross-Version Sync (Not Yet Implemented)

**Status:** Design ready, not implemented. Safe while `CURRENT_SCHEMA_VERSION = 1`.

**Strategy:** Receiver migrates incoming ops before conflict detection. Sender uploads ops as-is.

**Interim guardrails:**

- Reject ops with `schemaVersion > CURRENT + MAX_VERSION_SKIP`
- Prompt user to update app when receiving newer-version ops

**Required before:** Any schema migration that renames/removes fields.

### A.7.11 Cross-Version Sync Implementation Guide

> **Status:** Not yet implemented. This section documents the design for when `CURRENT_SCHEMA_VERSION > 1`.

This guide provides the implementation roadmap for supporting sync between clients on different schema versions.

#### When to Bump CURRENT_SCHEMA_VERSION

Bump the schema version when:

| Change Type                     | Bump Version? | Reason                                                               |
| ------------------------------- | ------------- | -------------------------------------------------------------------- |
| Add optional field with default | ✅ Yes        | Old clients won't set it; new clients need to know to apply defaults |
| Rename field                    | ✅ Yes        | Operations need payload transformation                               |
| Remove field/feature            | ✅ Yes        | Operations may reference removed entities                            |
| Change field type               | ✅ Yes        | Payload values need conversion                                       |
| Add new entity type             | ✅ Yes        | Old snapshots need initialization                                    |
| Add new action type             | ❌ No         | Old clients ignore unknown actions                                   |
| Bug fix in reducer              | ❌ No         | Not a schema change                                                  |

**Decision rule:** If the change affects how `state_cache` snapshots or operation payloads are structured, bump the version.

#### Operation Transformation Strategy

When receiving operations from older versions:

```typescript
// In SchemaMigrationService.migrateOperation()
async migrateOperation(op: Operation): Promise<Operation | null> {
  const opVersion = op.schemaVersion ?? 1;

  if (opVersion >= CURRENT_SCHEMA_VERSION) {
    return op; // Already current
  }

  // Run through migration chain
  let migratedPayload = op.payload;
  for (let v = opVersion; v < CURRENT_SCHEMA_VERSION; v++) {
    const migration = MIGRATIONS.find(m => m.fromVersion === v);
    if (migration?.migrateOperation) {
      const result = migration.migrateOperation(op.actionType, migratedPayload);
      if (result === null) {
        // Operation should be dropped (removed feature)
        return null;
      }
      migratedPayload = result;
    }
  }

  return {
    ...op,
    payload: migratedPayload,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
}
```

#### Conflict Detection Across Versions

The migration shield ensures conflict detection always compares apples-to-apples:

```
Remote Op (v1)          Local Op (v2)
     │                       │
     ▼                       │
┌─────────────────┐          │
│ Migration Layer │          │
│  (v1 → v2)      │          │
└────────┬────────┘          │
         │                   │
         ▼                   ▼
    ┌────────────────────────────┐
    │   Conflict Detection       │
    │   (Both ops now v2)        │
    └────────────────────────────┘
```

**Key invariant:** Operations are ALWAYS migrated to current version BEFORE conflict detection. This ensures:

- Vector clock comparison is valid (same logical schema)
- LWW timestamp comparison is fair (same field semantics)
- Entity IDs are comparable (no renamed references)

#### Backward Compatibility Guarantees

| Scenario                                   | Behavior                                             | User Experience           |
| ------------------------------------------ | ---------------------------------------------------- | ------------------------- |
| Newer client → Older client                | Ops uploaded as-is; older client migrates on receive | Seamless                  |
| Older client → Newer client                | Newer client migrates incoming ops                   | Seamless                  |
| Client too old (> MAX_VERSION_SKIP behind) | Reject ops, prompt update                            | "Please update app" modal |
| Client too new (server rejects)            | N/A - server doesn't validate schema                 | No issue                  |

**MAX_VERSION_SKIP = 5**: Clients more than 5 versions behind cannot sync until updated. This bounds the migration chain complexity.

#### Migration Rollout Strategy

When deploying a schema migration:

1. **Release new version with migration code**
   - Add migration to `MIGRATIONS` array
   - Bump `CURRENT_SCHEMA_VERSION`
   - Migration handles both state and operations

2. **Graceful degradation period**
   - Old clients continue working (they don't know about new schema)
   - New clients migrate incoming old ops seamlessly
   - Mixed-version sync works via receiver-side migration

3. **Monitoring** (future)
   - Track `op.schemaVersion` distribution in server logs
   - Alert if many clients are > 2 versions behind

4. **Cleanup** (optional, after many versions)
   - Remove migrations for versions < `MIN_SUPPORTED_SCHEMA_VERSION`
   - Update `MIN_SUPPORTED_SCHEMA_VERSION`
   - Old clients will see "update required" prompt

#### Example Migration: Renaming a Field

```typescript
// packages/shared-schema/src/migrations.ts
export const MIGRATIONS: SchemaMigration[] = [
  {
    fromVersion: 1,
    toVersion: 2,
    description: 'Rename task.estimate to task.timeEstimate',

    // Migrate state snapshot
    migrateState: (state: unknown): unknown => {
      const s = state as AppDataComplete;
      return {
        ...s,
        task: {
          ...s.task,
          entities: Object.fromEntries(
            Object.entries(s.task.entities).map(([id, task]) => [
              id,
              {
                ...task,
                timeEstimate: (task as any).estimate, // Copy old field
                estimate: undefined, // Remove old field
              },
            ]),
          ),
        },
      };
    },

    // Migrate operation payload
    requiresOperationMigration: true,
    migrateOperation: (actionType: string, payload: unknown): unknown | null => {
      if (actionType.includes('[Task]') && payload && typeof payload === 'object') {
        const p = payload as Record<string, unknown>;
        if ('estimate' in p) {
          return {
            ...p,
            timeEstimate: p.estimate,
            estimate: undefined,
          };
        }
      }
      return payload; // No change for other actions
    },
  },
];
```

#### Testing Cross-Version Sync

Before releasing any migration:

1. **Unit tests** in `schema-migration.service.spec.ts`:
   - State migration correctness
   - Operation migration correctness
   - Null return for dropped operations

2. **Integration tests** in `cross-version-sync.integration.spec.ts`:
   - Client A (v1) syncs with Client B (v2)
   - Both clients converge to same state
   - No data loss during migration

3. **E2E tests** (manual or automated):
   - Install old app version, create data
   - Update to new version
   - Verify data migrated correctly
   - Sync with another device on new version

---

# Part B: File-Based Sync

File-based sync providers (WebDAV, Dropbox, LocalFile) use a single-file approach via the `FileBasedSyncAdapter`.

## B.1 How File-Based Sync Works

```
Sync Triggered (WebDAV/Dropbox/LocalFile)
    │
    ▼
FileBasedSyncAdapter.downloadOps()
    │
    └──► Downloads sync-data.json from remote
              │
              ├──► Contains: state snapshot + recent ops buffer
              │
              └──► Compares vector clocks for conflict detection
                        │
                        ▼
                   Process new ops, merge state
                        │
                        ▼
                   FileBasedSyncAdapter.uploadOps()
                        │
                        └──► Upload merged state + ops
```

**Key file:** `src/app/op-log/sync-providers/file-based/file-based-sync-adapter.service.ts`

## B.2 FileBasedSyncData Format

```typescript
interface FileBasedSyncData {
  version: 2;
  schemaVersion: number;
  vectorClock: VectorClock;
  syncVersion: number; // Content-based optimistic locking
  lastSeq: number;
  lastModified: number;

  // Full state snapshot (~95% of file size)
  state: AppDataComplete;

  // Recent operations for conflict detection (last 200, ~5% of file)
  recentOps: CompactOperation[];

  // Checksum for integrity verification
  checksum?: string;
}
```

## B.3 Piggybacking Mechanism

When two clients sync concurrently, the adapter uses "piggybacking" to ensure no operations are lost:

1. Client A uploads state (syncVersion 1 → 2)
2. Client B tries to upload, detects version mismatch
3. Client B downloads A's changes, finds ops it hasn't seen
4. Client B merges A's ops into its state, uploads (syncVersion 2 → 3)
5. Both clients end up with all operations

```typescript
// In FileBasedSyncAdapter.uploadOps()
const remote = await this._downloadRemoteData(provider);
if (remote && remote.syncVersion !== expectedSyncVersion) {
  // Another client synced - find ops we haven't processed
  const newOps = remote.recentOps.filter((op) => op.seq > lastProcessedSeq);
  // Return these as "piggybacked" ops for the caller to process
  return { localOps, newOps };
}
```

## B.4 Sync Download Persistence

When remote data is downloaded, the sync system creates a SYNC_IMPORT operation:

```typescript
async hydrateFromRemoteSync(downloadedMainModelData?: Record<string, unknown>): Promise<void> {
  // 1. Create SYNC_IMPORT operation with downloaded state
  const op: Operation = {
    id: uuidv7(),
    opType: 'SYNC_IMPORT',
    entityType: 'ALL',
    payload: downloadedMainModelData,
    // ...
  };
  await this.opLogStore.append(op, 'remote');

  // 2. Force snapshot for crash safety
  await this.opLogStore.saveStateCache({
    state: downloadedMainModelData,
    lastAppliedOpSeq: lastSeq,
    // ...
  });

  // 3. Dispatch to NgRx
  this.store.dispatch(loadAllData({ appDataComplete: downloadedMainModelData }));
}
```

### loadAllData Variants

| Source               | Create Op?          | Force Snapshot? |
| -------------------- | ------------------- | --------------- |
| Hydration (startup)  | No                  | No              |
| Remote sync download | Yes (SYNC_IMPORT)   | Yes             |
| Backup file import   | Yes (BACKUP_IMPORT) | Yes             |

## B.5 Archive Data Handling

Archive data (`archiveYoung`, `archiveOld`) is included in the state snapshot for file-based sync.
Archives are written directly to IndexedDB via `ArchiveDbAdapter` (bypassing the operation log for performance).

### Why Archives Bypass Operation Log

1. **Size**: Archived tasks can grow to tens of thousands of entries over years
2. **Frequency**: Archive updates are rare (only when archiving tasks or flushing old data)
3. **Sync needs**: Archives sync as part of the state snapshot, but don't need operation-level granularity

### Archive Write Path

```
Archive Operation (e.g., archiving a completed task)
    │
    ├──► 1. Update archive directly via ArchiveDbAdapter
    │
    └──► 2. On next sync, archive is included in state snapshot
```

**Key files:**

- `src/app/op-log/archive/archive-db-adapter.service.ts`
- `src/app/op-log/archive/archive-operation-handler.service.ts`

---

# Part C: Server Sync

For server-based sync, the operation log IS the sync mechanism. Individual operations are uploaded/downloaded rather than full state snapshots.

## C.1 How Server Sync Differs from File-Based

| Aspect              | File-Based Sync (Part B)     | Server Sync (Part C)  |
| ------------------- | ---------------------------- | --------------------- |
| What syncs          | State snapshot + recent ops  | Individual operations |
| Conflict detection  | Vector clock on snapshot     | Entity-level per-op   |
| Transport           | Single file (sync-data.json) | HTTP API              |
| Op-log role         | Builds snapshot from ops     | IS the sync           |
| `syncedAt` tracking | Not needed                   | Required              |

## C.2 Operation Sync Protocol

Providers that support operation sync implement `OperationSyncCapable`:

```typescript
interface OperationSyncCapable {
  supportsOperationSync: true;
  uploadOps(
    ops: SyncOperation[],
    clientId: string,
    lastKnownSeq: number,
  ): Promise<UploadResponse>;
  downloadOps(
    sinceSeq: number,
    clientId?: string,
    limit?: number,
  ): Promise<DownloadResponse>;
  getLastServerSeq(): Promise<number>;
  setLastServerSeq(seq: number): Promise<void>;
}
```

### Upload Flow

```typescript
async uploadPendingOps(syncProvider: OperationSyncCapable): Promise<void> {
  const pendingOps = await this.opLogStore.getUnsynced();

  // Upload in batches (up to 25 ops per request)
  for (const chunk of chunkArray(pendingOps, 25)) {
    const response = await syncProvider.uploadOps(
      chunk.map(entry => toSyncOperation(entry.op)),
      clientId,
      lastKnownServerSeq
    );

    // Mark accepted ops as synced
    const acceptedSeqs = response.results
      .filter(r => r.accepted)
      .map(r => findEntry(r.opId).seq);
    await this.opLogStore.markSynced(acceptedSeqs);

    // Process piggybacked new ops from other clients
    if (response.newOps?.length > 0) {
      await this.processRemoteOps(response.newOps);
    }
  }
}
```

### Download Flow

```typescript
async downloadRemoteOps(syncProvider: OperationSyncCapable): Promise<void> {
  let sinceSeq = await syncProvider.getLastServerSeq();
  let hasMore = true;

  while (hasMore) {
    const response = await syncProvider.downloadOps(sinceSeq, undefined, 500);

    // Filter already-applied ops
    const newOps = response.ops.filter(op => !appliedOpIds.has(op.id));
    await this.processRemoteOps(newOps);

    sinceSeq = response.ops[response.ops.length - 1].serverSeq;
    hasMore = response.hasMore;
    await syncProvider.setLastServerSeq(response.latestSeq);
  }
}
```

## C.3 Full-State Operations via Snapshot Endpoint

Operations that contain the full application state (`SyncImport`, `BackupImport`, `Repair`) can be very large (10-30MB+). Instead of sending these through the regular `/api/sync/ops` endpoint, they are uploaded via the dedicated `/api/sync/snapshot` endpoint which is optimized for large payloads.

### Operation Routing

```
Upload Flow
    │
    ├──► Filter: Is opType in { SYNC_IMPORT, BACKUP_IMPORT, REPAIR }?
    │         │
    │         ├──► YES: Upload via /api/sync/snapshot
    │         │         • Uses uploadSnapshot() method
    │         │         • Maps opType to reason: initial, recovery, migration
    │         │         • Supports E2E encryption
    │         │
    │         └──► NO: Upload via /api/sync/ops (normal batched upload)
```

### Implementation

```typescript
// Full-state op types routed to snapshot endpoint
const FULL_STATE_OP_TYPES = new Set([
  OpType.SyncImport,
  OpType.BackupImport,
  OpType.Repair,
]);

// In OperationLogUploadService._uploadPendingOpsViaApi():
const fullStateOps = pendingOps.filter((entry) =>
  FULL_STATE_OP_TYPES.has(entry.op.opType as OpType),
);
const regularOps = pendingOps.filter(
  (entry) => !FULL_STATE_OP_TYPES.has(entry.op.opType as OpType),
);

// Upload full-state ops via snapshot endpoint
for (const entry of fullStateOps) {
  await syncProvider.uploadSnapshot(
    entry.op.payload, // Full app state
    entry.op.clientId,
    mapOpTypeToReason(entry.op.opType), // 'initial' | 'recovery' | 'migration'
    entry.op.vectorClock,
    entry.op.schemaVersion,
  );
}

// Upload regular ops in batches via ops endpoint
// ... (existing batch upload logic)
```

### OpType to Reason Mapping

| OpType          | Snapshot Reason | Use Case                         |
| --------------- | --------------- | -------------------------------- |
| `SYNC_IMPORT`   | `initial`       | First sync or full state refresh |
| `BACKUP_IMPORT` | `recovery`      | Restoring from backup file       |
| `REPAIR`        | `recovery`      | Auto-repair with corrected state |

### Benefits

1. **Reduced body limit issues** - Snapshot endpoint has 30MB limit, separate from regular ops
2. **Semantic clarity** - Full state uploads use appropriate endpoint
3. **Server-side optimization** - Server can cache snapshots for faster client bootstrap

## C.4 File-Based Sync Fallback

For providers without API support (WebDAV/Dropbox), operations are synced via files (`OperationLogUploadService` and `OperationLogDownloadService` handle this transparently):

```
ops/
├── manifest.json
├── ops_CLIENT1_1701234567890.json
├── ops_CLIENT1_1701234599999.json
└── ops_CLIENT2_1701234600000.json
```

The manifest tracks which operation files exist. Each file contains a batch of operations. The system supports both API-based sync and this file-based fallback.

## C.4 Conflict Detection

Conflicts are detected using vector clocks at the entity level. **Importantly, a conflict can only
occur when there are pending (unsynced) local operations for an entity.** If local has no pending
changes for an entity, any remote operation is safe to apply - there's nothing local to conflict with.

```typescript
async detectConflicts(remoteOps: Operation[]): Promise<ConflictResult> {
  const localPendingByEntity = await this.opLogStore.getUnsyncedByEntity();
  const appliedFrontierByEntity = await this.opLogStore.getEntityFrontier();

  for (const remoteOp of remoteOps) {
    const entityKey = `${remoteOp.entityType}:${remoteOp.entityId}`;
    const localPendingOps = localPendingByEntity.get(entityKey) || [];

    // FAST PATH: No pending local ops = no conflict possible
    // Conflicts require concurrent modifications. If local hasn't modified
    // this entity since last sync, any remote op can be applied safely.
    if (localPendingOps.length === 0) {
      nonConflicting.push(remoteOp);
      continue;
    }

    // Build local frontier from applied + pending ops
    const localFrontier = mergeClocks(
      appliedFrontierByEntity.get(entityKey),
      ...localPendingOps.map(op => op.vectorClock)
    );

    const comparison = compareVectorClocks(localFrontier, remoteOp.vectorClock);
    if (comparison === VectorClockComparison.CONCURRENT) {
      conflicts.push({
        entityType: remoteOp.entityType,
        entityId: remoteOp.entityId,
        localOps: localPendingOps,
        remoteOps: [remoteOp],
        suggestedResolution: 'manual'
      });
    } else {
      nonConflicting.push(remoteOp);
    }
  }

  return { nonConflicting, conflicts };
}
```

### Why Pending Ops Matter for Conflict Detection

The key insight is that **conflicts are about uncommitted changes**, not historical state:

- **Applied/synced ops**: Already reconciled between clients. Their vector clocks contributed to the
  global sync state, but they don't represent "in-flight" changes that could be lost.
- **Pending ops**: Not yet synced. These represent changes that could conflict with incoming remote ops.

If Client A sends a delete operation for a task, and Client B has no pending ops for that task,
Client B should simply apply the delete - there's no local work to lose. The snapshot/frontier
vector clocks track _history_, not _intent_.

## C.5 Conflict Resolution (LWW Auto-Resolution)

Conflicts are automatically resolved using Last-Write-Wins (LWW) strategy via `ConflictResolutionService.autoResolveConflictsLWW()`:

### LWW Resolution Strategy

1. **Compare timestamps**: Each side's maximum operation timestamp is compared
2. **Newer wins**: The side with the newer timestamp wins
3. **Tie-breaker**: When timestamps are equal, remote wins (server-authoritative)

```typescript
async autoResolveConflictsLWW(conflicts: EntityConflict[], nonConflictingOps: Operation[]): Promise<void> {
  for (const conflict of conflicts) {
    const localMaxTimestamp = Math.max(...conflict.localOps.map(op => op.timestamp));
    const remoteMaxTimestamp = Math.max(...conflict.remoteOps.map(op => op.timestamp));

    if (localMaxTimestamp > remoteMaxTimestamp) {
      // Local wins - create new UPDATE op with current entity state
      const localWinOp = await this._createLocalWinUpdateOp(conflict);
      // Reject both old local and remote ops
      await this.opLogStore.markRejected([...localOpIds, ...remoteOpIds]);
      // New op will sync local state on next upload
      await this.opLogStore.append(localWinOp, 'local');
    } else {
      // Remote wins (including tie)
      await this.operationApplier.applyOperations(conflict.remoteOps);
      await this.opLogStore.markRejected(localOpIds);
    }
  }
}
```

### When Local Wins

When local state is newer, we can't just reject the remote ops - that would cause the local state to never sync to the server. Instead:

1. **Reject both** local AND remote ops (they're now obsolete)
2. **Create a new UPDATE operation** with:
   - Current entity state from NgRx store
   - Merged vector clock (local + remote) + increment
   - **Preserved maximum timestamp from local ops** (critical for correct LWW semantics - using `Date.now()` would give unfair advantage in future conflicts)
3. **This new op will be uploaded** on next sync cycle, propagating local state to server

A warning-level log is emitted: `OpLog.warn('LWW local wins - creating update op for ${entityType}:${entityId}')`

### Rejected Operations

When operations are rejected (either local or remote):

- Rejected ops remain in the log for history/debugging
- `getUnsynced()` excludes rejected ops (won't re-upload)
- Compaction may eventually delete old rejected ops

### Archive-Wins Rule

When a `moveToArchive` operation conflicts with a field-level update (e.g., rename, time tracking changes), the archive operation **always wins** regardless of timestamps. This bypasses the normal LWW timestamp comparison because archiving represents explicit user intent that should not be reversed by a concurrent field update.

**Rationale:** If Client A archives a task and Client B concurrently renames it, the archive must win — otherwise, the LWW update would "resurrect" the archived task back into the active store by replacing its state.

**Implementation:** `ConflictResolutionService` checks whether either the local or remote side contains a `TASK_SHARED_MOVE_TO_ARCHIVE` action. If so, the archive side wins automatically, and a new archive operation is created with a merged vector clock (via `_createArchiveWinOp()`).

This is the **first level** of archive resurrection prevention. The **second level** is in the `bulkOperationsMetaReducer` (see [Area 10: Bulk Application](#area-10-bulk-application) in the quick reference), which pre-scans operation batches for archive operations and skips any LWW Update operations targeting entities being archived in the same batch. This two-level defense handles the 3+ client scenario where LWW Updates can arrive before or after archive ops in the same batch.

**Key files:**

- `src/app/op-log/sync/conflict-resolution.service.ts` — Archive-wins check and `_createArchiveWinOp()`
- `src/app/op-log/apply/bulk-hydration.meta-reducer.ts` — Pre-scan archive filtering

### Superseded Operation Handling for moveToArchive

The `SupersededOperationResolverService` treats `moveToArchive` as a special case alongside DELETE operations. When a `moveToArchive` op is rejected by the server due to concurrent conflicts, it is **re-created with a merged vector clock** instead of being discarded.

This is necessary because `moveToArchive` removes entities from the NgRx store (via the archive reducer), so `getCurrentEntityState()` returns `undefined` for archived entities. Without this special handling, the superseded operation resolver would be unable to re-create the operation, and archived tasks would be lost.

**Implementation:** Before entity-by-entity processing, `SupersededOperationResolverService` identifies bulk semantic operations like `moveToArchive` and re-creates them with the original payload and a merged vector clock, preserving the full task data in `MultiEntityPayload` format.

**Key file:** `src/app/op-log/sync/superseded-operation-resolver.service.ts`

### Singleton Entity LWW Updates

The `lwwUpdateMetaReducer` handles LWW Update actions (created when the local side wins a conflict) differently depending on the entity's storage pattern:

| Storage Pattern | Entity Types                                          | LWW Update Behavior                                                             |
| --------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Adapter**     | TASK, PROJECT, TAG, NOTE, TASK_REPEAT_CFG, etc.       | Individual entity replacement via NgRx entity adapter (`updateOne` or `addOne`) |
| **Singleton**   | GLOBAL_CONFIG, TIME_TRACKING, MENU_TREE, WORK_CONTEXT | Entire feature state replaced with the winning data                             |
| **Unsupported** | Map, array, virtual patterns                          | Logged as warning; not supported for LWW                                        |

For **adapter entities**, the meta-reducer also syncs relationships (e.g., `project.taskIds` when `projectId` changes, `tag.taskIds` when `tagIds` changes, `TODAY_TAG.taskIds` when `dueDay` changes, `parent.subTaskIds` when `parentId` changes).

**Key file:** `src/app/root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer.ts`

### User Notification

A non-blocking snack notification is shown after auto-resolution:

- "Sync conflicts auto-resolved: X local win(s), Y remote win(s)"

## C.6 Dependency Resolution

Operations may have dependencies (e.g., subtask requires parent task):

```typescript
interface OperationDependency {
  entityType: EntityType;
  entityId: string;
  mustExist: boolean; // Hard dependency
  relation: 'parent' | 'reference';
}

// Operations with missing hard dependencies are queued for retry
// After MAX_RETRY_ATTEMPTS (3), they're marked as permanently failed
```

## C.7 SYNC_IMPORT Filtering (Clean Slate Semantics)

When a `SYNC_IMPORT` or `BACKUP_IMPORT` operation is received, it represents an explicit user action to restore **all clients** to a specific point in time. Operations created without knowledge of the import are filtered out.

**Implementation:** `SyncImportFilterService.filterOpsInvalidatedBySyncImport()`

### The Problem

Consider this scenario:

1. Client A creates Op1, Op2 (offline)
2. Client B does a SYNC_IMPORT (restores from backup)
3. Client B uploads the SYNC_IMPORT to server
4. Client A comes online, uploads Op1, Op2, then downloads SYNC_IMPORT
5. **Problem**: Op1, Op2 reference entities that were WIPED by the import

### The Solution: Clean Slate Semantics

SYNC_IMPORT/BACKUP_IMPORT are explicit user actions to restore to a specific state. **ALL operations without knowledge of the import are dropped** - this ensures a true "restore to point in time" semantic.

We use **vector clock comparison** (not UUIDv7 timestamps) because vector clocks track **causality** ("did the client know about the import?") rather than wall-clock time (which can be affected by clock drift).

```typescript
// In SyncImportFilterService.filterOpsInvalidatedBySyncImport()
for (const op of ops) {
  // Full state import operations themselves are always valid
  if (op.opType === OpType.SyncImport || op.opType === OpType.BackupImport) {
    validOps.push(op);
    continue;
  }

  // Use VECTOR CLOCK comparison to determine causality
  const comparison = compareVectorClocks(op.vectorClock, latestImport.vectorClock);

  if (
    comparison === VectorClockComparison.GREATER_THAN ||
    comparison === VectorClockComparison.EQUAL
  ) {
    // Op was created by a client that had knowledge of the import
    validOps.push(op);
  } else {
    // CONCURRENT or LESS_THAN: Op was created without knowledge of import
    // Filter it to ensure clean slate semantics
    invalidatedOps.push(op);
  }
}
```

### Vector Clock Comparison Results

| Comparison     | Meaning                                | Action                     |
| -------------- | -------------------------------------- | -------------------------- |
| `GREATER_THAN` | Op created after seeing import         | ✅ Keep (has knowledge)    |
| `EQUAL`        | Same causal history as import          | ✅ Keep                    |
| `LESS_THAN`    | Op dominated by import                 | ❌ Drop (already captured) |
| `CONCURRENT`   | Op created without knowledge of import | ❌ Drop (clean slate)      |

**Example:**

- SYNC_IMPORT clock: `{A: 10, B: 5}`
- Op clock: `{A: 11, B: 5}` → `GREATER_THAN` → ✅ Keep (client A saw the import)
- Op clock: `{B: 3}` → `LESS_THAN` → ❌ Drop (dominated by import)
- Op clock: `{C: 1}` → `CONCURRENT` → ❌ Drop (client C didn't know about import)

**Why Drop CONCURRENT?** An operation from a client that never saw the import may reference entities that no longer exist in the imported state. Dropping ensures the import truly restores all clients to the same point in time.

See [operation-log-architecture-diagrams.md](./operation-log-architecture-diagrams.md) Section 2c for visual diagrams.

---

# Part D: Data Validation & Repair

The operation log includes comprehensive validation and automatic repair to prevent data corruption and recover from invalid states.

## D.1 Validation Architecture

Four validation checkpoints ensure data integrity throughout the operation lifecycle:

| Checkpoint | Location                            | When                      | Action on Failure                          |
| ---------- | ----------------------------------- | ------------------------- | ------------------------------------------ |
| **A**      | `operation-log.effects.ts`          | Before IndexedDB write    | Reject operation, log error, show snackbar |
| **B**      | `operation-log-hydrator.service.ts` | After loading snapshot    | Attempt repair, create REPAIR op           |
| **C**      | `operation-log-hydrator.service.ts` | After replaying tail ops  | Attempt repair, create REPAIR op           |
| **D**      | `operation-log-sync.service.ts`     | After applying remote ops | Attempt repair, create REPAIR op           |

## D.2 REPAIR Operation Type

When validation fails at checkpoints B, C, or D, the system attempts automatic repair using the `dataRepair()` function. If repair succeeds, a REPAIR operation is created:

```typescript
enum OpType {
  // ... existing types
  Repair = 'REPAIR', // Auto-repair operation with full repaired state
}

interface RepairPayload {
  appDataComplete: AppDataCompleteNew; // Full repaired state
  repairSummary: RepairSummary; // What was fixed
}

interface RepairSummary {
  entityStateFixed: number; // Fixed ids/entities array sync
  orphanedEntitiesRestored: number; // Tasks restored from archive
  invalidReferencesRemoved: number; // Non-existent project/tag IDs removed
  relationshipsFixed: number; // Project/tag ID consistency
  structureRepaired: number; // Menu tree, inbox project creation
  typeErrorsFixed: number; // Typia errors auto-fixed
}
```

### REPAIR Operation Behavior

- **During replay**: REPAIR operations load state directly (like SyncImport), skipping prior operations
- **User notification**: Shows snackbar with count of issues fixed
- **Audit trail**: REPAIR operations are visible in the operation log for debugging

## D.3 Checkpoint A: Payload Validation

Before writing to IndexedDB, operation payloads are validated in `validate-operation-payload.ts`:

```typescript
validateOperationPayload(op: Operation): PayloadValidationResult {
  // 1. Structural validation - payload must be object
  // 2. OpType-specific validation:
  //    - CREATE: entity with valid 'id' field required
  //    - UPDATE: id + changes, or entity with id required
  //    - DELETE: entityId/entityIds required
  //    - MOVE: ids array required
  //    - BATCH: non-empty payload required
  //    - SYNC_IMPORT/BACKUP_IMPORT: appDataComplete structure required
  //    - REPAIR: skip (internally generated)
}
```

This validation is **intentionally lenient** - it checks structural requirements rather than deep entity validation. Full Typia validation happens at state checkpoints.

## D.4 Checkpoints B & C: Hydration Validation

During hydration, state is validated at two points:

```
App Startup
    │
    ▼
Load snapshot from state_cache
    │
    ├──► CHECKPOINT B: Validate snapshot
    │         │
    │         └──► If invalid: repair + create REPAIR op
    │
    ▼
Dispatch loadAllData(snapshot)
    │
    ▼
Replay tail operations
    │
    └──► CHECKPOINT C: Validate current state
              │
              └──► If invalid: repair + create REPAIR op + dispatch repaired state
```

### Implementation

```typescript
// In operation-log-hydrator.service.ts
private async _validateAndRepairState(state: AppDataCompleteNew): Promise<AppDataCompleteNew> {
  if (this._isRepairInProgress) return state; // Prevent infinite loops

  const result = this.validateStateService.validateAndRepair(state);
  if (!result.wasRepaired) return state;

  this._isRepairInProgress = true;
  try {
    await this.repairOperationService.createRepairOperation(
      result.repairedState,
      result.repairSummary,
    );
    return result.repairedState;
  } finally {
    this._isRepairInProgress = false;
  }
}
```

## D.5 Checkpoint D: Post-Sync Validation

After applying remote operations, state is validated:

- In `operation-log-sync.service.ts` - after applying non-conflicting ops (when no conflicts)
- In `conflict-resolution.service.ts` - after resolving all conflicts

This catches:

- State drift from remote operations
- Corruption introduced during sync
- Invalid operations from other clients

## D.6 ValidateStateService

Wraps validation and repair functionality using Typia and cross-model validation:

```typescript
@Injectable({ providedIn: 'root' })
export class ValidateStateService {
  validateState(state: AppDataCompleteNew): StateValidationResult {
    // 1. Run Typia schema validation
    const typiaResult = validateAllData(state);

    // 2. Run cross-model relationship validation
    //    NOTE: isRelatedModelDataValid errors are now caught and treated as validation failures
    //    rather than crashing, allowing validateAndRepair to trigger dataRepair.
    let isRelatedValid = true;
    try {
      isRelatedValid = isRelatedModelDataValid(state);
    } catch (e) {
      PFLog.warn(
        'isRelatedModelDataValid threw an error, treating as validation failure',
        e,
      );
      isRelatedValid = false;
    }

    return {
      isValid,
      typiaErrors,
      crossModelError: !isRelatedValid
        ? 'isRelatedModelDataValid threw error'
        : undefined,
    };
  }

  validateAndRepair(state: AppDataCompleteNew): ValidateAndRepairResult {
    // 1. Validate
    // 2. If invalid: run dataRepair()
    // 3. Re-validate repaired state
    // 4. Return repaired state + summary
  }
}
```

## D.7 RepairOperationService

Creates REPAIR operations and notifies the user:

```typescript
@Injectable({ providedIn: 'root' })
export class RepairOperationService {
  async createRepairOperation(
    repairedState: AppDataCompleteNew,
    repairSummary: RepairSummary,
  ): Promise<void> {
    // 1. Create REPAIR operation with repaired state + summary
    // 2. Append to operation log
    // 3. Save state cache snapshot
    // 4. Show notification to user
  }

  static createEmptyRepairSummary(): RepairSummary {
    return {
      entityStateFixed: 0,
      orphanedEntitiesRestored: 0,
      invalidReferencesRemoved: 0,
      relationshipsFixed: 0,
      structureRepaired: 0,
      typeErrorsFixed: 0,
    };
  }
}
```

---

# Edge Cases & Missing Considerations

This section documents known edge cases and areas requiring further design or implementation.

## Storage & Resource Limits

### IndexedDB Quota Exhaustion

**Status:** ✅ Implemented (December 2025)

When IndexedDB storage quota is exceeded, the system handles it gracefully:

**Implementation** (see `operation-log.effects.ts`):

1. **Error Detection**: Catches `QuotaExceededError` including browser variants:
   - Standard: `DOMException` with name `QuotaExceededError`
   - Firefox: `NS_ERROR_DOM_QUOTA_REACHED`
   - Safari (legacy): Error code 22

2. **Emergency Compaction**: Triggers `emergencyCompact()` with shorter retention:
   - Normal retention: 7 days (`COMPACTION_RETENTION_MS`)
   - Emergency retention: 24 hours (`EMERGENCY_COMPACTION_RETENTION_MS`)
   - Only deletes ops that have been synced (`syncedAt` set)

3. **Circuit Breaker**: Flag `isHandlingQuotaExceeded` prevents infinite retry loops:
   - If quota exceeded during retry attempt, aborts immediately
   - Shows error to user instead of looping forever

4. **User Notification**: On permanent failure (after emergency compaction fails):
   - Shows snackbar with error message
   - Dispatches rollback action to revert optimistic update
   - User data in NgRx store remains consistent

**Constants** (`operation-log.const.ts`):

- `EMERGENCY_COMPACTION_RETENTION_MS = 24 * 60 * 60 * 1000` (1 day)
- `MAX_COMPACTION_FAILURES = 3`

### Compaction Trigger Coordination

**Status:** Implemented ✅

The 500-ops compaction trigger uses a persistent counter stored in `state_cache.compactionCounter`:

- Counter is shared across tabs via IndexedDB
- Counter persists across app restarts
- Counter is reset after successful compaction
- Web Locks still prevent concurrent compaction execution

## Data Integrity Edge Cases

### Genesis Migration with Partial Data

**Status:** ⚠️ Not Fully Defined — Edge Case Risk

**Risk Level:** MEDIUM — Silent data loss possible in crash/interruption scenarios.

What if data exists in both `pf` AND `SUP_OPS` databases?

- **Scenario**: Crash during genesis migration, or app downgrade after migration
- **Current behavior**: If `SUP_OPS.state_cache` exists, use it; ignore `pf` entirely
- **Risk**: May lose newer data that was written to `pf` after partial migration completed
- **Detection gap**: No mechanism to detect if `pf` has newer data than `SUP_OPS`

**Proposed solution:**

1. Store `migrationTimestamp` in both `SUP_OPS.state_cache` and `pf.META_MODEL`
2. On startup, compare timestamps:
   - If `pf.lastUpdate > SUP_OPS.migrationTimestamp`: Warn user, offer merge or re-migrate
   - If equal or `pf` older: Proceed with SUP_OPS (current behavior)
3. For app downgrades: Show clear error that downgrade may lose data, require explicit confirmation

**Mitigation (current):** Genesis migration is a one-time event. Once SUP_OPS is established, all writes go there. Risk is limited to the migration moment itself.

### Compaction During Active Sync

**Status:** Handled via Locks

- Compaction acquires `sp_op_log_compact` lock
- Sync operations use separate locks
- **Verified safe**: Compaction only deletes ops with `syncedAt` set, so unsynced ops from active sync are preserved

---

# Part E: Smart Archive Handling

The application splits data into "Active State" (in-memory, Redux) and "Archive State" (on-disk, rarely accessed) to maintain performance.

- **ArchiveYoung**: Recently archived tasks and their worklogs (e.g., last 30 days).
- **ArchiveOld**: Deep storage for historical data (months/years old).

## E.1 The Problem with Syncing Archives

In the legacy system, changing one task in the archive required re-uploading the entire (potentially massive) archive file. This was bandwidth-intensive and slow.

## E.2 New Strategy: Deterministic Local Side Effects

In the Operation Log architecture, **we do NOT sync the archive files directly.** Instead, we sync the **Instructions** that modify the archives. Because the logic is deterministic, all clients end up with identical archive files without ever transferring them.

| Component        | Sync Strategy                 | Mechanism                                                                  |
| ---------------- | ----------------------------- | -------------------------------------------------------------------------- |
| **Active State** | **Operation Log**             | Standard sync (Ops applied to Redux)                                       |
| **ArchiveYoung** | **Deterministic Side Effect** | `moveToArchive` ops trigger local moves from Active → Young on all clients |
| **ArchiveOld**   | **Deterministic Side Effect** | `flushYoungToOld` ops trigger local flush from Young → Old on all clients  |

### E.3 Workflow: moveToArchive

When a user archives tasks:

1.  **Client A (Origin):**
    - Generates `moveToArchive` operation.
    - Locally moves Tasks + Worklogs from Active Store → `ArchiveYoung`.
2.  **Sync:** Operation travels to Client B.
3.  **Client B (Remote):**
    - Receives `moveToArchive` operation.
    - Executes the **exact same logic**:
      - Selects the targeted tasks from its _own_ Active Store.
      - Moves Tasks + Worklogs to its _own_ `ArchiveYoung`.
      - Removes them from Active Store.

**Result:** Both clients have identical `ArchiveYoung` files, but zero archive data was transferred over the network.

### E.4 Workflow: Flushing (Young → Old)

_Planned for future implementation._ When `ArchiveYoung` grows too large, client emits `flushYoungToOld` operation. All clients execute the same flush logic (move items older than X days), keeping `ArchiveOld` consistent.

### E.5 Idempotency Requirements

All archive operations MUST be idempotent:

| Operation            | Guarantee                          |
| -------------------- | ---------------------------------- |
| `moveToArchive`      | Skip if task already in archive    |
| `flushYoungToOld`    | Move only items not already in Old |
| `restoreFromArchive` | Skip if task already in Active     |

**Edge cases:** Missing entities (deleted/out-of-order) → queue for retry or skip. Out-of-order flush → idempotent no-op if Young is empty.

## E.6 Time Tracking Sync Semantics

Time tracking data follows a special sync pattern that differs from regular entities.

### E.6.1 TimeTrackingState Structure

```typescript
interface TimeTrackingState {
  project: {
    [projectId: string]: {
      [dateStr: string]: { s?: number; e?: number; b?: number; bt?: number };
    };
  };
  tag: {
    [tagId: string]: {
      [dateStr: string]: { s?: number; e?: number; b?: number; bt?: number };
    };
  };
}
// s = start time, e = end time, b = break count, bt = break time
```

This is a 3-level nested structure: `category → contextId → date → data`.

### E.6.2 Three-Tier Storage Model

Time tracking data exists in three locations:

| Location         | Contents                    | Sync Frequency       |
| ---------------- | --------------------------- | -------------------- |
| **Active State** | Today's time tracking only  | Every sync (small)   |
| **archiveYoung** | Recent data (< 21 days)     | Daily (medium)       |
| **archiveOld**   | Historical data (≥ 21 days) | On flush only (rare) |

This split reduces sync payload size significantly.

### E.6.3 Data Flow

```
Daily (finish work):
  Active TimeTracking → archiveYoung
  (Only today's data stays in active)

Every ~14 days (flush):
  archiveYoung → archiveOld
  (ALL timeTracking data moves, not threshold-based)
```

### E.6.4 Merge Behavior

When merging time tracking from multiple sources (e.g., during import):

**Priority**: `current > archiveYoung > archiveOld`

**Deep Merge at Field Level**:

```typescript
// If current has {s: 100}, archiveYoung has {e: 200}, archiveOld has {b: 5}
// Result: {s: 100, e: 200, b: 5}
```

This ensures no data loss when fields are partially populated across sources.

### E.6.5 Conflict Resolution

Time tracking uses **Last-Write-Wins (LWW)** for conflicts:

- If Client A and B both modify `project[id][date]`, the last operation wins
- This is intentional: later accurate measurement should override earlier estimate
- No user conflict dialog - LWW is automatically applied

### E.6.6 Fresh Client Hydration

Fresh clients receive time tracking via SYNC_IMPORT:

1. Server finds latest SYNC_IMPORT operation (snapshot skip optimization)
2. SYNC_IMPORT contains complete `timeTracking` + `archiveYoung.timeTracking` + `archiveOld.timeTracking`
3. Client applies SYNC_IMPORT → all time tracking data populated in one operation

**Without SYNC_IMPORT**: Client replays all individual `syncTimeTracking` operations incrementally (slower but correct).

### E.6.7 Key Implementation Files

| File                                   | Purpose                           |
| -------------------------------------- | --------------------------------- |
| `merge-time-tracking-states.ts`        | Three-source merge with priority  |
| `sort-data-to-flush.ts`                | Archive flush logic (young→old)   |
| `time-tracking.reducer.ts`             | NgRx reducer for syncTimeTracking |
| `archive-operation-handler.service.ts` | Handles flushYoungToOld remotely  |

---

# Part F: Atomic State Consistency

This section documents the architectural principles ensuring that related model changes happen atomically, preventing state inconsistency during sync.

## F.1 The Problem: Effects Create Non-Atomic Changes

When a user deletes a tag, multiple entities must be updated:

- The tag is deleted
- Tasks referencing the tag have their `tagIds` updated
- TaskRepeatCfgs referencing the tag are updated or deleted
- TimeTracking data for the tag is cleaned up

If these changes happen in separate NgRx effects:

1. Each effect dispatches a separate action
2. Each action becomes a separate operation in the log
3. During sync, operations may arrive out of order or partially
4. **Result**: Temporary or permanent state inconsistency

## F.2 The Solution: Meta-Reducers for Atomic Changes

**Principle**: All related entity changes from a single user action should happen in a single reducer pass.

Meta-reducers intercept actions before they reach feature reducers and can modify the entire store state atomically:

```typescript
// tag-shared.reducer.ts - handles deleteTag atomically
[deleteTag.type]: () => {
  // 1. Remove tag references from tasks
  // 2. Delete orphaned tasks (no project, no tags, no parent)
  // 3. Clean up task repeat configs
  // 4. Clean up time tracking state
  return updatedState; // All changes in one pass
},
```

### Meta-Reducers in Use

| Meta-Reducer                      | Purpose                                                  |
| --------------------------------- | -------------------------------------------------------- |
| `tagSharedMetaReducer`            | Tag deletion cleanup (tasks, repeat cfgs, time tracking) |
| `projectSharedMetaReducer`        | Project deletion cleanup                                 |
| `taskSharedCrudMetaReducer`       | Task CRUD with tag/project updates                       |
| `taskSharedLifecycleMetaReducer`  | Task lifecycle (archive, restore)                        |
| `taskSharedSchedulingMetaReducer` | Task scheduling with Today tag updates                   |
| `plannerSharedMetaReducer`        | Planner day management                                   |
| `taskRepeatCfgSharedMetaReducer`  | Repeat config deletion with task cleanup                 |
| `issueProviderSharedMetaReducer`  | Issue provider updates                                   |
| `operationCaptureMetaReducer`     | Captures before/after state, enqueues entity changes     |

## F.3 Multi-Entity Operation Capture

The `OperationCaptureService` and `operation-capture.meta-reducer` work together using a **simple FIFO queue** to capture actions:

1. **After action**: Meta-reducer calls `OperationCaptureService.enqueue()` with the action
2. **Effect processes**: Effect calls `OperationCaptureService.dequeue()` to get entity changes
3. **Result**: Single operation with action payload and optional `entityChanges[]` array

The FIFO queue works because NgRx reducers process actions sequentially, and effects use `concatMap` for sequential processing. Order is preserved between enqueue and dequeue.

**Note**: Most actions return empty `entityChanges[]` - the action payload is sufficient for replay. Only TIME_TRACKING and TASK time sync actions have special handling to extract entity changes from the action payload.

```
User Action (e.g., Delete Tag)
    │
    ▼
tagSharedMetaReducer (+ other meta-reducers)
    ├──► Atomically update all related entities
    │
    ▼
Feature Reducers
    │
    ▼
operation-capture.meta-reducer
    ├──► Call OperationCaptureService.enqueue(action)
    │         └──► Extracts entity changes from action payload (for special cases)
    │         └──► Pushes to FIFO queue
    │
    ▼
OperationLogEffects
    ├──► Call OperationCaptureService.dequeue() to get entity changes
    └──► Create single Operation with action payload
```

## F.4 When to Use Meta-Reducers vs Effects

| Scenario                           | Use Meta-Reducer | Use Effect |
| ---------------------------------- | ---------------- | ---------- |
| Updating related entities in store | ✅               | ❌         |
| Deleting entity with cleanup       | ✅               | ❌         |
| UI notifications (snackbar, sound) | ❌               | ✅         |
| External API calls                 | ❌               | ✅         |
| Archive operations (async I/O)     | ❌               | ✅         |
| Navigation/routing                 | ❌               | ✅         |

**Rule of thumb**: If it modifies NgRx state, use a meta-reducer. If it's a side effect (I/O, UI, external), use an effect with `LOCAL_ACTIONS`.

## F.5 Board-Style Hybrid Pattern

For references between entities (e.g., `tag.taskIds`), we use a "board-style" pattern where:

- **Source of truth**: The child entity's reference (e.g., `task.tagIds`)
- **Derived list**: The parent entity's list (e.g., `tag.taskIds`) is for ordering only

Selectors recompute membership from the source of truth, providing self-healing:

```typescript
// work-context.selectors.ts
export const computeOrderedTaskIdsForTag = (
  tag: Tag,
  allTasks: Dictionary<Task>,
): string[] => {
  // Use tag.taskIds for order, but filter by actual task.tagIds membership
  const validFromTagList = tag.taskIds.filter((id) => {
    const task = allTasks[id];
    return task && !task.parentId && task.tagIds.includes(tag.id);
  });

  // Add any tasks that reference this tag but aren't in the list
  const missingTasks = Object.values(allTasks).filter(
    (task) =>
      task &&
      !task.parentId &&
      task.tagIds.includes(tag.id) &&
      !tag.taskIds.includes(task.id),
  );

  return [...validFromTagList, ...missingTasks.map((t) => t.id)];
};
```

This ensures stale references are filtered and missing references are auto-added.

## F.6 Guidelines for New Features

When adding new entities or relationships:

1. **Identify related entities** that must change together
2. **Create or extend a meta-reducer** to handle atomic updates
3. **Add action to `ACTION_AFFECTED_ENTITIES`** in `state-change-capture.service.ts`
4. **Use `LOCAL_ACTIONS`** in effects for side effects only
5. **Consider board-style pattern** for parent-child list references

---

# Implementation Status

## Part A: Local Persistence

### Complete ✅

- SUP_OPS IndexedDB store (ops + state_cache)
- NgRx effect capture with isPersistent pattern
- Snapshot + tail replay hydration
- Multi-tab BroadcastChannel coordination
- Web Locks + localStorage fallback
- Genesis migration from legacy data
- Compaction with 7-day retention window
- Disaster recovery from legacy 'pf' database
- Schema migration service infrastructure (no migrations defined yet)
- Persistent action metadata on all model actions
- Rollback notification on persistence failure (shows snackbar with reload action)
- Hydration optimizations (skip replay for SyncImport, save snapshot after >10 ops replayed)
- **Migration safety backup (A.7.12)** - Creates backup before migration, restores on failure
- **Tail ops migration (A.7.13)** - Migrates operations during hydration before replay
- **Unified migration interface (A.7.15)** - `SchemaMigration` includes both `migrateState` and optional `migrateOperation`
- **Persistent compaction counter** - Counter stored in `state_cache`, shared across tabs/restarts
- **`syncedAt` index** - Index on ops store for faster `getUnsynced()` queries
- **Quota handling** - Emergency compaction on `QuotaExceededError` with circuit breaker to prevent infinite loops

### Not Implemented ⚠️

| Item                            | Section | Risk if Missing                          | When Critical                                           |
| ------------------------------- | ------- | ---------------------------------------- | ------------------------------------------------------- |
| **Conflict-aware op migration** | A.7.11  | Conflicts may compare mismatched schemas | Before any schema migration that renames/removes fields |

> **Note**: A.7.11 is required for cross-version sync. Currently safe because `CURRENT_SCHEMA_VERSION = 1` (all clients on same version). See [A.7.11 Interim Guardrails](#interim-guardrails-until-implementation) for pre-release checklist.

## Part B: Legacy Sync Bridge

### Complete ✅

- `PfapiStoreDelegateService` (reads all NgRx models for sync)
- META_MODEL vector clock update (B.2)
- Sync download persistence via `hydrateFromRemoteSync()` (B.3)
- All models in NgRx (no hybrid persistence)
- Skip META_MODEL update during sync (prevents lock errors)

## Part C: Server Sync

### Complete ✅ (Single-Version)

- Operation sync protocol interface (`OperationSyncCapable`)
- `OperationLogSyncService` (orchestration, processRemoteOps, detectConflicts)
- `OperationLogUploadService` (API upload + file-based fallback, batching)
- `OperationLogDownloadService` (API download + file-based fallback, pagination)
- Entity-level conflict detection (vector clock comparisons)
- `ConflictResolutionService` (LWW auto-resolution + batch apply)
- `VectorClockService` (global/entity frontier tracking, compaction recovery)
- `DependencyResolverService` (extract/check hard/soft dependencies)
- `OperationApplierService` (fail-fast on missing deps → throws `SyncStateCorruptedError`)
- Rejected operation tracking (`rejectedAt` field + user notification)
- Fresh client safety checks (prevents empty clients from overwriting server)
- Bounded memory during download (`MAX_DOWNLOAD_OPS_IN_MEMORY = 50,000`)
- Integration test suite (`sync-scenarios.integration.spec.ts`)
- E2E test infrastructure (`supersync.spec.ts` with Playwright)
- **End-to-end encryption** (December 2025):
  - `OperationEncryptionService` for payload encryption/decryption
  - AES-256-GCM with Argon2id key derivation
  - Optional per-provider encryption password
  - See [supersync-encryption-architecture.md](./supersync-encryption-architecture.md)
- **Server-side security hardening** (December 2025):
  - Structured audit logging for security events
  - Structured error codes (`SYNC_ERROR_CODES`) for upload results
  - Gap detection in download operations
  - Request ID deduplication for idempotent uploads
  - Transaction isolation for download operations
  - Entity type allowlist to prevent injection
  - Input validation for operation ID, entity ID, and schema version
  - Server-side conflict detection
  - Vector clock sanitization
  - Rate limiting and size validation for plugin data
  - JWT secret minimum length validation (32 chars)
  - Batch cleanup queries (replaced N+1 pattern)
  - Database index on `(user_id, received_at)` for cleanup queries

> **Cross-version limitation**: Part C is complete for clients on the same schema version. When `CURRENT_SCHEMA_VERSION > 1` and clients run different versions, A.7.11 (conflict-aware op migration) is required to ensure correct conflict detection.

## Part D: Validation & Repair

### Complete ✅

- Payload validation at write (Checkpoint A - structural validation before IndexedDB write)
- State validation during hydration (Checkpoints B & C - Typia + cross-model validation)
- Post-sync validation (Checkpoint D - validation after applying remote ops)
- REPAIR operation type (auto-repair with full state + repair summary)
- ValidateStateService (wraps Typia validation + data repair)
- RepairOperationService (creates REPAIR ops, user notification)
- User notification on repair (snackbar with issue count)

## Future Enhancements 🔮

| Component  | Description                                | Priority | Notes                                                                          |
| ---------- | ------------------------------------------ | -------- | ------------------------------------------------------------------------------ |
| Auto-merge | Automatic merge for non-conflicting fields | Low      |                                                                                |
| Undo/Redo  | Leverage op-log for undo history           | Low      |                                                                                |
| Tombstones | Soft delete with retention window          | Medium   | Deferred Dec 2025 - current safeguards sufficient (see todo.md for evaluation) |
| A.7.11     | Conflict-aware operation migration         | High     | Required before `CURRENT_SCHEMA_VERSION > 1` for cross-version sync            |

> **Recently Completed (December 2025):**
>
> - **Server Sync (SuperSync)**: Full upload/download infrastructure with conflict detection, user resolution UI, and integration tests
> - **End-to-End Encryption**: AES-256-GCM payload encryption with Argon2id key derivation via `OperationEncryptionService`
> - **Server Security Hardening**: Audit logging, structured error codes, request deduplication, transaction isolation, input validation, rate limiting
> - **Unified Archive Handling**: `ArchiveOperationHandler` is now the single source of truth for all archive operations, used by both local effects and remote operation application
> - **Simplified OperationCaptureService**: Refactored to FIFO queue with reference equality optimization for detecting changed feature states
> - **Simplified OperationApplierService**: Refactored to fail-fast approach - throws `SyncStateCorruptedError` on missing hard deps (no retry queues)
> - **Tag sanitization**: Remove subtask IDs from tags when parent deleted, filter non-existent taskIds on sync
> - **Anchor-based move operations**: All task drag-drop moves now use `afterTaskId` instead of full list replacement (including subtask moves)
> - **Quota handling**: Emergency compaction and circuit breaker on `QuotaExceededError`
> - **`syncedAt` index**: Faster `getUnsynced()` queries
> - **Persistent compaction counter**: Tracks ops across tabs/restarts
> - **Plugin data sync**: Operation logging for plugin user data and metadata
> - **Gap detection**: Download operations detect and report sequence gaps
> - **Server-side conflict detection**: Prevents concurrent modifications on server
> - **Compaction race safety**: Safety check to abort deletion if new ops written during snapshot
> - **Entity validation in meta-reducers**: Improved getTag/getProject helpers with validation and safe variants
> - **Project cleanup in deleteTasks**: handleDeleteTasks now cleans up project taskIds/backlogTaskIds
> - **Archive validation**: archiveOld tasks now validated for project/tag references, null-safety added
> - **Lock service robustness**: Handle NaN timestamps and invalid lock formats in fallback lock
> - **Array payload rejection**: Explicit check to reject arrays (which bypass `typeof === 'object'`)
> - **Pending operation expiry**: Operations pending >24h are rejected instead of replayed (PENDING_OPERATION_EXPIRY_MS)

---

# File Reference

```
src/app/op-log/
├── operation.types.ts                    # Type definitions (Operation, OpType, EntityType)
├── operation-log.const.ts                # Constants (thresholds, timeouts, limits)
├── operation-log.effects.ts              # Action capture + META_MODEL bridge
├── operation-converter.util.ts           # Op ↔ Action conversion
├── persistent-action.interface.ts        # PersistentAction type + isPersistentAction guard
├── entity-key.util.ts                    # Entity key generation utilities
├── store/
│   ├── operation-log-store.service.ts        # SUP_OPS IndexedDB wrapper
│   ├── operation-log-hydrator.service.ts     # Startup hydration + crash recovery
│   ├── operation-log-compaction.service.ts   # Snapshot + cleanup + emergency mode
│   ├── operation-log-manifest.service.ts     # File-based sync manifest management
│   ├── operation-log-migration.service.ts    # Genesis migration from legacy
│   └── schema-migration.service.ts           # State schema migrations
├── sync/
│   ├── operation-log-sync.service.ts         # Orchestration (Part C)
│   ├── operation-log-download.service.ts     # Download ops (API + file fallback)
│   ├── operation-log-upload.service.ts       # Upload ops (API + file fallback)
│   ├── operation-encryption.service.ts       # E2EE payload encryption (AES-256-GCM)
│   ├── vector-clock.service.ts               # Global/entity frontier tracking
│   ├── lock.service.ts                       # Cross-tab locking (Web Locks + fallback)
│   ├── conflict-resolution.service.ts        # LWW conflict resolution + user notification
│   ├── sync-import-filter.service.ts         # Filter ops invalidated by SYNC_IMPORT
│   ├── immediate-upload.service.ts           # Trigger immediate sync on critical ops
│   ├── super-sync-status.service.ts          # SuperSync connection status tracking
│   ├── server-migration.service.ts           # Server-side schema migration handling
│   ├── operation-write-flush.service.ts      # Batch write operations with flush
│   └── operation-sync.util.ts                # Sync helper utilities
├── processing/
│   ├── operation-applier.service.ts          # Apply ops with fail-fast dependency handling
│   ├── operation-capture.service.ts          # FIFO queue for capturing entity changes
│   ├── operation-capture.meta-reducer.ts     # Meta-reducer for before/after state capture
│   ├── hydration-state.service.ts            # Track hydration/remote ops application state
│   ├── archive-operation-handler.service.ts  # Unified handler for archive side effects
│   ├── archive-operation-handler.effects.ts  # Routes local actions to ArchiveOperationHandler
│   ├── validate-state.service.ts             # Typia + cross-model validation
│   ├── validate-operation-payload.ts         # Checkpoint A - payload validation
│   └── repair-operation.service.ts           # REPAIR operation creation
├── integration/                              # Integration test suite
│   ├── sync-scenarios.integration.spec.ts    # Protocol-level sync tests
│   ├── multi-client-sync.integration.spec.ts # Multi-client scenarios
│   ├── state-consistency.integration.spec.ts # State validation tests
│   └── helpers/                              # Test utilities
│       ├── mock-sync-server.helper.ts        # Server mock for tests
│       ├── simulated-client.helper.ts        # Client simulation
│       ├── test-client.helper.ts             # Test client utilities
│       └── operation-factory.helper.ts       # Test operation builders
└── benchmarks/
    └── operation-log-stress.spec.ts          # Performance stress tests

src/app/features/work-context/store/
├── work-context-meta.actions.ts          # Move actions (moveTaskInTodayList, etc.)
└── work-context-meta.helper.ts           # Anchor-based positioning helpers

src/app/op-log/sync-providers/
├── super-sync/                           # SuperSync server provider
│   ├── super-sync.ts                     # Server-based sync implementation
│   └── super-sync.model.ts               # SuperSync types
├── file-based/                           # File-based providers (Part B)
│   ├── file-based-sync-adapter.service.ts  # Unified adapter for file providers
│   ├── file-based-sync.types.ts          # FileBasedSyncData types
│   ├── webdav/                           # WebDAV provider
│   ├── dropbox/                          # Dropbox provider
│   └── local-file/                       # Local file sync provider
├── provider-manager.service.ts           # Provider activation/management
├── wrapped-provider.service.ts           # Provider wrapper with encryption
└── credential-store.service.ts           # OAuth/credential storage

e2e/
├── tests/sync/supersync.spec.ts          # E2E SuperSync tests (Playwright)
├── pages/supersync.page.ts               # Page object for sync tests
└── utils/supersync-helpers.ts            # E2E test utilities
```

---

# References

- [Operation Rules](./operation-rules.md) - Payload and validation rules
- [SuperSync Encryption](./supersync-encryption-architecture.md) - End-to-end encryption implementation
- [Hybrid Manifest Architecture](./long-term-plans/hybrid-manifest-architecture.md) - File-based sync optimization
- [Vector Clocks](./vector-clocks.md) - Vector clock implementation details
- [File-Based Sync Implementation](../ai/file-based-oplog-sync-implementation-plan.md) - Historical implementation plan
