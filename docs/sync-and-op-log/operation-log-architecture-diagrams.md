# Operation Log: Architecture Diagrams

**Last Updated:** December 17, 2025
**Status:** All core diagrams reflect current implementation

These diagrams visualize the Operation Log system architecture. For implementation details, see [operation-log-architecture.md](./operation-log-architecture.md).

---

## 1. Operation Log Architecture (Local Persistence & Legacy Bridge) ✅ IMPLEMENTED

This diagram illustrates how user actions flow through the system, how they are persisted to IndexedDB (`SUP_OPS`), how the system hydrates on startup, and how it bridges to the legacy PFAPI system.

**Implementation Status:** Complete. See Part A and Part B in [operation-log-architecture.md](./operation-log-architecture.md).

```mermaid
graph TD
    %% Styles
    classDef storage fill:#f9f,stroke:#333,stroke-width:2px,color:black;
    classDef process fill:#e1f5fe,stroke:#0277bd,stroke-width:2px,color:black;
    classDef legacy fill:#fff3e0,stroke:#ef6c00,stroke-width:2px,stroke-dasharray: 5 5,color:black;
    classDef trigger fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px,color:black;
    classDef archive fill:#e8eaf6,stroke:#3949ab,stroke-width:2px,color:black;

    User((User / UI)) -->|Dispatch Action| NgRx["NgRx Store <br/> Runtime Source of Truth<br/><sub>*.effects.ts / *.reducer.ts</sub>"]

    subgraph "Write Path (Runtime)"
        NgRx -->|Action Stream| OpEffects["OperationLogEffects<br/><sub>operation-log.effects.ts</sub>"]

        OpEffects -->|1. Check isPersistent| Filter{"Is Persistent?<br/><sub>persistent-action.interface.ts</sub>"}
        Filter -- No --> Ignore[Ignore / UI Only]
        Filter -- Yes --> Transform["Transform to Operation<br/>UUIDv7, Timestamp, VectorClock<br/><sub>operation-converter.util.ts</sub>"]

        Transform -->|2. Validate| PayloadValid{"Payload<br/>Valid?<br/><sub>processing/validate-operation-payload.ts</sub>"}
        PayloadValid -- No --> ErrorSnack[Show Error Snackbar]
        PayloadValid -- Yes --> DBWrite
    end

    subgraph "Persistence Layer (IndexedDB: SUP_OPS)"
        DBWrite["Write to SUP_OPS<br/><sub>store/operation-log-store.service.ts</sub>"]:::storage

        DBWrite -->|Append| OpsTable["Table: ops<br/>The Event Log<br/><sub>IndexedDB</sub>"]:::storage
        DBWrite -->|Update| StateCache["Table: state_cache<br/>Snapshots<br/><sub>IndexedDB</sub>"]:::storage
    end

    subgraph "Archive Storage (IndexedDB: PFAPI)"
        ArchiveWrite["ArchiveService<br/><sub>time-tracking/archive.service.ts</sub>"]:::archive
        ArchiveWrite -->|Write BEFORE dispatch| ArchiveYoung["archiveYoung<br/>━━━━━━━━━━━━━━━<br/>• task: TaskArchive<br/>• timeTracking: State<br/>━━━━━━━━━━━━━━━<br/><sub>Tasks < 21 days old</sub>"]:::archive
        ArchiveYoung -->|"flushYoungToOld action<br/>(every ~14 days)"| ArchiveOld["archiveOld<br/>━━━━━━━━━━━━━━━<br/>• task: TaskArchive<br/>• timeTracking: State<br/>━━━━━━━━━━━━━━━<br/><sub>Tasks > 21 days old</sub>"]:::archive
    end

    User -->|Archive Tasks| ArchiveWrite
    NgRx -.->|moveToArchive action<br/>AFTER archive write| OpEffects

    subgraph "Legacy Bridge (PFAPI)"
        DBWrite -.->|3. Bridge| LegacyMeta["META_MODEL<br/>Vector Clock<br/><sub>pfapi.service.ts</sub>"]:::legacy
        LegacyMeta -.->|Update| LegacySync["Legacy Sync Adapters<br/>WebDAV / Dropbox / Local<br/><sub>pfapi.service.ts</sub>"]:::legacy
        noteLegacy[Updates Vector Clock so<br/>Legacy Sync detects changes]:::legacy
    end

    subgraph "Compaction System"
        OpsTable -->|Count > 500| CompactionTrig{"Compaction<br/>Trigger<br/><sub>operation-log.effects.ts</sub>"}:::trigger
        CompactionTrig -->|Yes| Compactor["CompactionService<br/><sub>store/operation-log-compaction.service.ts</sub>"]:::process
        Compactor -->|Read State| NgRx
        Compactor -->|Save Snapshot| StateCache
        Compactor -->|Delete Old Ops| OpsTable
    end

    subgraph "Read Path (Hydration)"
        Startup((App Startup)) --> Hydrator["OperationLogHydrator<br/><sub>store/operation-log-hydrator.service.ts</sub>"]:::process
        Hydrator -->|1. Load| StateCache

        StateCache -->|Check| Schema{"Schema<br/>Version?<br/><sub>store/schema-migration.service.ts</sub>"}
        Schema -- Old --> Migrator["SchemaMigrationService<br/><sub>store/schema-migration.service.ts</sub>"]:::process
        Migrator -->|Transform State| MigratedState
        Schema -- Current --> CurrentState

        CurrentState -->|Load State| StoreInit[Init NgRx State]
        MigratedState -->|Load State| StoreInit

        Hydrator -->|2. Load Tail| OpsTable
        OpsTable -->|Replay Ops| Replayer["OperationApplier<br/><sub>processing/operation-applier.service.ts</sub>"]:::process
        Replayer -->|Dispatch| NgRx
    end

    subgraph "Single Instance + Sync Locking"
        Startup2((App Startup)) -->|BroadcastChannel| SingleCheck{"Already<br/>Open?<br/><sub>startup.service.ts</sub>"}
        SingleCheck -- Yes --> Block[Block New Tab]
        SingleCheck -- No --> Allow[Allow]

        DBWrite -.->|Critical ops use| WebLocks["Web Locks API<br/><sub>sync/lock.service.ts</sub>"]
    end

    class OpsTable,StateCache storage;
    class LegacyMeta,LegacySync,noteLegacy legacy;
    class ArchiveWrite,ArchiveYoung,ArchiveOld,TimeTracking archive;
```

**Archive Data Flow Notes:**

- **Archive writes happen BEFORE dispatch**: When a user archives tasks, `ArchiveService` writes to IndexedDB first, then dispatches the `moveToArchive` action. This ensures data is safely stored before state updates.
- **ArchiveModel structure**: Each archive tier stores `{ task: TaskArchive, timeTracking: TimeTrackingState, lastTimeTrackingFlush: number }`. Both archived Task entities AND their time tracking data are stored together.
- **Two-tier archive**: Recent tasks go to `archiveYoung` (tasks < 21 days old). Older tasks are flushed to `archiveOld` via `flushYoungToOld` action (checked every ~14 days when archiving tasks).
- **Flush mechanism**: `flushYoungToOld` is a persistent action that:
  1. Triggers when `lastTimeTrackingFlush > 14 days` during `moveTasksToArchiveAndFlushArchiveIfDue()`
  2. Moves tasks older than 21 days from `archiveYoung.task` to `archiveOld.task`
  3. Syncs via operation log so all clients execute the same flush deterministically
- **Not in NgRx state**: Archive data is stored directly in IndexedDB (via PFAPI), not in the NgRx store. Only the operations (`moveToArchive`, `flushYoungToOld`) are logged for sync.
- **Sync handling**: On remote clients, `ArchiveOperationHandler` writes archive data AFTER receiving the operation (see Section 8).

## 2. Operation Log Sync Architecture (Server Sync) ✅ IMPLEMENTED

This master diagram shows the complete sync architecture: client-side flow, server API endpoints, PostgreSQL database operations, and server-side processing.

**Implementation Status:** Complete (single-schema-version). Key services:

- **Client**: `OperationLogSyncService`, `OperationLogUploadService`, `OperationLogDownloadService`, `ConflictResolutionService`
- **Server**: Fastify API (`sync.routes.ts`), `SyncService` (`sync.service.ts`), Prisma ORM

```mermaid
graph TB
    %% Styles
    classDef client fill:#fff,stroke:#333,stroke-width:2px,color:black;
    classDef api fill:#e3f2fd,stroke:#1565c0,stroke-width:2px,color:black;
    classDef db fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px,color:black;
    classDef conflict fill:#ffebee,stroke:#c62828,stroke-width:2px,color:black;
    classDef validation fill:#fff3e0,stroke:#ef6c00,stroke-width:2px,color:black;

    %% ═══════════════════════════════════════════════════════════════
    %% CLIENT SIDE
    %% ═══════════════════════════════════════════════════════════════

    subgraph Client["CLIENT (Angular)"]
        direction TB

        subgraph SyncLoop["Sync Loop"]
            Scheduler((Scheduler)) -->|Interval| SyncService["OperationLogSyncService"]
            SyncService -->|1. Get lastSyncedSeq| LocalMeta["SUP_OPS IndexedDB"]
        end

        subgraph DownloadFlow["Download Flow"]
            SyncService -->|"2. GET /api/sync/ops?sinceSeq=N"| DownAPI
            DownAPI -->|Response| GapCheck{Gap Detected?}
            GapCheck -- "Yes + Empty Server" --> ServerMigration["Server Migration:<br/>Create SYNC_IMPORT"]
            GapCheck -- "Yes + Has Ops" --> ResetSeq["Reset sinceSeq=0<br/>Re-download all"]
            GapCheck -- No --> FreshCheck{Fresh Client?}
            ResetSeq --> FreshCheck
            FreshCheck -- "Yes + Has Ops" --> ConfirmDialog["Confirmation Dialog"]
            FreshCheck -- No --> FilterApplied
            ConfirmDialog -- Confirmed --> FilterApplied{Already Applied?}
            ConfirmDialog -- Cancelled --> SkipDownload[Skip]
            FilterApplied -- Yes --> Discard[Discard]
            FilterApplied -- No --> ConflictDet
        end

        subgraph ConflictMgmt["Conflict Management (LWW Auto-Resolution)"]
            ConflictDet{"Compare<br/>Vector Clocks"}:::conflict
            ConflictDet -- Sequential --> ApplyRemote
            ConflictDet -- Concurrent --> AutoCheck{"Auto-Resolve?"}

            AutoCheck -- "Both DELETE or<br/>Identical payload" --> AutoResolve["Auto: Keep Remote"]
            AutoCheck -- "Real conflict" --> LWWResolve["LWW: Compare<br/>Timestamps"]:::conflict

            AutoResolve --> MarkRejected
            LWWResolve -- "Remote newer<br/>or tie" --> MarkRejected[Mark Local Rejected]:::conflict
            LWWResolve -- "Local newer" --> LocalWins["Create Update Op<br/>with local state"]:::conflict
            LocalWins --> RejectBoth[Mark both rejected]
            RejectBoth --> CreateNewOp[New op syncs local state]
            MarkRejected --> ApplyRemote
        end

        subgraph Application["Application & Validation"]
            ApplyRemote -->|Dispatch| NgRx["NgRx Store"]
            NgRx --> Validator{Valid State?}
            Validator -- Yes --> SyncDone((Done))
            Validator -- No --> Repair["Auto-Repair"]:::conflict
            Repair --> NgRx
        end

        subgraph UploadFlow["Upload Flow"]
            LocalMeta -->|Get Unsynced| PendingOps[Pending Ops]
            PendingOps --> FreshUploadCheck{Fresh Client?}
            FreshUploadCheck -- Yes --> BlockUpload["Block Upload<br/>(must download first)"]
            FreshUploadCheck -- No --> FilterRejected{Rejected?}
            FilterRejected -- Yes --> SkipRejected[Skip]
            FilterRejected -- No --> ClassifyOp{Op Type?}

            ClassifyOp -- "SYNC_IMPORT<br/>BACKUP_IMPORT<br/>REPAIR" --> SnapshotAPI
            ClassifyOp -- "CRT/UPD/DEL/MOV/BATCH" --> OpsAPI

            OpsAPI -->|Response with<br/>piggybackedOps| ProcessPiggybacked["Process Piggybacked<br/>(→ Conflict Detection)"]
            ProcessPiggybacked --> ConflictDet
        end
    end

    %% ═══════════════════════════════════════════════════════════════
    %% SERVER API LAYER
    %% ═══════════════════════════════════════════════════════════════

    subgraph Server["SERVER (Fastify + Node.js)"]
        direction TB

        subgraph APIEndpoints["API Endpoints"]
            DownAPI["GET /api/sync/ops<br/>━━━━━━━━━━━━━━━<br/>Download operations<br/>Query: sinceSeq, limit"]:::api
            OpsAPI["POST /api/sync/ops<br/>━━━━━━━━━━━━━━━<br/>Upload operations<br/>Body: ops[], clientId"]:::api
            SnapshotAPI["POST /api/sync/snapshot<br/>━━━━━━━━━━━━━━━<br/>Upload full state<br/>Body: state, reason"]:::api
            GetSnapshotAPI["GET /api/sync/snapshot<br/>━━━━━━━━━━━━━━━<br/>Get full state"]:::api
            StatusAPI["GET /api/sync/status<br/>━━━━━━━━━━━━━━━<br/>Check sync status"]:::api
            RestoreAPI["GET /api/sync/restore/:seq<br/>━━━━━━━━━━━━━━━<br/>Restore to point"]:::api
        end

        subgraph ServerProcessing["Server-Side Processing (SyncService)"]
            direction TB

            subgraph Validation["1. Validation"]
                V1["Validate op.id, opType"]
                V2["Validate entityType allowlist"]
                V3["Sanitize vectorClock"]
                V4["Check payload size"]
                V5["Check timestamp drift"]
            end

            subgraph ConflictCheck["2. Conflict Detection"]
                C1["Find latest op for entity"]
                C2["Compare vector clocks"]
                C3{Result?}
                C3 -- GREATER_THAN --> C4[Accept]
                C3 -- CONCURRENT --> C5[Reject]
                C3 -- LESS_THAN --> C6[Reject]
            end

            subgraph Persist["3. Persistence (REPEATABLE_READ)"]
                P1["Increment lastSeq"]
                P2["Re-check conflict"]
                P3["INSERT operation"]
                P4{DEL op?}
                P4 -- Yes --> P5["UPSERT tombstone"]
                P4 -- No --> P6[Skip]
                P7["UPSERT sync_device"]
            end
        end
    end

    %% ═══════════════════════════════════════════════════════════════
    %% POSTGRESQL DATABASE
    %% ═══════════════════════════════════════════════════════════════

    subgraph PostgreSQL["POSTGRESQL DATABASE"]
        direction TB

        OpsTable[("operations<br/>━━━━━━━━━━━━━━━<br/>id, serverSeq<br/>opType, entityType<br/>entityId, payload<br/>vectorClock<br/>clientTimestamp")]:::db

        SyncState[("user_sync_state<br/>━━━━━━━━━━━━━━━<br/>lastSeq<br/>snapshotData<br/>lastSnapshotSeq")]:::db

        Devices[("sync_devices<br/>━━━━━━━━━━━━━━━<br/>clientId<br/>lastSeenAt<br/>lastAckedSeq")]:::db

        Tombstones[("tombstones<br/>━━━━━━━━━━━━━━━<br/>entityType<br/>entityId<br/>deletedAt")]:::db
    end

    %% ═══════════════════════════════════════════════════════════════
    %% CONNECTIONS: API -> Processing
    %% ═══════════════════════════════════════════════════════════════

    OpsAPI --> V1
    SnapshotAPI --> V1
    V1 --> V2 --> V3 --> V4 --> V5
    V5 --> C1 --> C2 --> C3
    C4 --> P1 --> P2 --> P3 --> P4
    P5 --> P7
    P6 --> P7

    %% ═══════════════════════════════════════════════════════════════
    %% CONNECTIONS: Processing -> Database
    %% ═══════════════════════════════════════════════════════════════

    P1 -.->|"UPDATE"| SyncState
    P3 -.->|"INSERT"| OpsTable
    P5 -.->|"UPSERT"| Tombstones
    P7 -.->|"UPSERT"| Devices

    %% ═══════════════════════════════════════════════════════════════
    %% CONNECTIONS: Read endpoints -> Database
    %% ═══════════════════════════════════════════════════════════════

    DownAPI -.->|"SELECT ops > sinceSeq"| OpsTable
    DownAPI -.->|"SELECT lastSeq"| SyncState
    GetSnapshotAPI -.->|"SELECT snapshot"| SyncState
    GetSnapshotAPI -.->|"SELECT (replay)"| OpsTable
    StatusAPI -.->|"SELECT"| SyncState
    StatusAPI -.->|"COUNT"| Devices
    RestoreAPI -.->|"SELECT (replay)"| OpsTable

    %% Subgraph styles
    style Validation fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style ConflictCheck fill:#ffebee,stroke:#c62828,stroke-width:2px
    style Persist fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style PostgreSQL fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style APIEndpoints fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
```

### Quick Reference Tables

**API Endpoints:**

| Endpoint                   | Method | Purpose                         | DB Operations                                                        |
| -------------------------- | ------ | ------------------------------- | -------------------------------------------------------------------- |
| `/api/sync/ops`            | POST   | Upload operations               | INSERT ops, UPDATE lastSeq, UPSERT device, UPSERT tombstone (if DEL) |
| `/api/sync/ops?sinceSeq=N` | GET    | Download operations             | SELECT ops, SELECT lastSeq, find latest snapshot (skip optimization) |
| `/api/sync/snapshot`       | POST   | Upload full state (SYNC_IMPORT) | Same as POST /ops + UPDATE snapshot cache                            |
| `/api/sync/snapshot`       | GET    | Get full state                  | SELECT snapshot (or replay ops if stale)                             |
| `/api/sync/status`         | GET    | Check sync status               | SELECT lastSeq, COUNT devices                                        |
| `/api/sync/restore-points` | GET    | List restore points             | SELECT ops (filter SYNC_IMPORT, BACKUP_IMPORT, REPAIR)               |
| `/api/sync/restore/:seq`   | GET    | Restore to specific point       | SELECT ops, replay to targetSeq                                      |

**PostgreSQL Tables:**

| Table             | Purpose                                    | Key Columns                                             |
| ----------------- | ------------------------------------------ | ------------------------------------------------------- |
| `operations`      | Event log (append-only)                    | id, serverSeq, opType, entityType, payload, vectorClock |
| `user_sync_state` | Per-user metadata + cached snapshot        | lastSeq, snapshotData, lastSnapshotSeq                  |
| `sync_devices`    | Device tracking                            | clientId, lastSeenAt, lastAckedSeq                      |
| `tombstones`      | Deleted entity tracking (30-day retention) | entityType, entityId, deletedAt, expiresAt              |

**Key Implementation Details:**

- **Transaction Isolation**: `REPEATABLE_READ` prevents phantom reads during conflict detection
- **Double Conflict Check**: Before AND after sequence allocation (race condition guard)
- **Idempotency**: Duplicate op IDs rejected with `DUPLICATE_OPERATION` error
- **Gzip Support**: Both upload/download support `Content-Encoding: gzip` for bandwidth savings
- **Rate Limiting**: Per-user limits (100 uploads/min, 200 downloads/min)
- **Auto-Resolve Conflicts (Identical)**: Identical conflicts (both DELETE, or same payload) auto-resolved as "remote" without user intervention
- **LWW Conflict Resolution**: Real conflicts are automatically resolved using Last-Write-Wins (timestamp comparison). See Section 2d below for detailed diagrams.
- **Fresh Client Safety**: Clients with no history blocked from uploading; confirmation dialog shown before accepting first remote data
- **Piggybacked Ops**: Upload response includes new remote ops → processed immediately to trigger conflict detection
- **Gap Detection**: Server returns `gapDetected: true` when client sinceSeq is invalid → client resets to seq=0 and re-downloads all ops
- **Server Migration**: Gap + empty server (no ops) → client creates SYNC_IMPORT to seed new server
- **Snapshot Skip Optimization**: Server skips pre-snapshot operations when `sinceSeq < latestSnapshotSeq`. Returns `latestSnapshotSeq` in response. See Section 2e below.

---

## 2b. Full-State Operations via Snapshot Endpoint ✅ IMPLEMENTED

Full-state operations (BackupImport, Repair, SyncImport) contain the entire application state and can exceed the regular `/api/sync/ops` body size limit (~30MB). These operations are routed through the `/api/sync/snapshot` endpoint instead.

**Implementation Status:** Complete. See `OperationLogUploadService._uploadFullStateOpAsSnapshot()`.

```mermaid
flowchart TB
    subgraph "Upload Decision Flow"
        GetUnsynced[Get Unsynced Operations<br/>from IndexedDB]
        Classify{Classify by OpType}

        GetUnsynced --> Classify

        subgraph FullStateOps["Full-State Operations"]
            SyncImport[OpType.SyncImport]
            BackupImport[OpType.BackupImport]
            Repair[OpType.Repair]
        end

        subgraph RegularOps["Regular Operations"]
            CRT[OpType.CRT]
            UPD[OpType.UPD]
            DEL[OpType.DEL]
            MOV[OpType.MOV]
            BATCH[OpType.BATCH]
        end

        Classify --> FullStateOps
        Classify --> RegularOps

        FullStateOps --> SnapshotPath
        RegularOps --> OpsPath

        subgraph SnapshotPath["Snapshot Endpoint Path"]
            MapReason["Map OpType to reason:<br/>SyncImport → 'initial'<br/>BackupImport → 'recovery'<br/>Repair → 'recovery'"]
            Encrypt1{E2E Encryption<br/>Enabled?}
            EncryptPayload[Encrypt state payload]
            UploadSnapshot["POST /api/sync/snapshot<br/>{state, clientId, reason,<br/>vectorClock, schemaVersion}"]
        end

        subgraph OpsPath["Ops Endpoint Path"]
            Encrypt2{E2E Encryption<br/>Enabled?}
            EncryptOps[Encrypt operation payloads]
            Batch[Batch up to 100 ops]
            UploadOps["POST /api/sync/ops<br/>{ops[], clientId, lastKnownSeq}"]
        end

        MapReason --> Encrypt1
        Encrypt1 -- Yes --> EncryptPayload
        Encrypt1 -- No --> UploadSnapshot
        EncryptPayload --> UploadSnapshot

        Encrypt2 -- Yes --> EncryptOps
        Encrypt2 -- No --> Batch
        EncryptOps --> Batch
        Batch --> UploadOps
    end

    UploadSnapshot --> MarkSynced[Mark Operation as Synced]
    UploadOps --> MarkSynced

    style FullStateOps fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style RegularOps fill:#c8e6c9,stroke:#2e7d32,stroke-width:2px
    style SnapshotPath fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style OpsPath fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
```

**Why This Matters:**

1. **Body Size Limits**: Regular `/api/sync/ops` has a ~30MB limit which backup imports can exceed
2. **Efficiency**: Snapshot endpoint is designed for large payloads and stores state directly
3. **Server-Side Handling**: Server creates a synthetic operation record for audit purposes

## 2c. SYNC_IMPORT Filtering with Clean Slate Semantics ✅ IMPLEMENTED

When a SYNC_IMPORT or BACKUP_IMPORT operation is received, it represents an explicit user action to restore **all clients** to a specific point in time. Operations created without knowledge of the import are filtered out using vector clock comparison.

**Implementation Status:** Complete. See `SyncImportFilterService.filterOpsInvalidatedBySyncImport()`.

### The Problem: Stale Operations After Import

```mermaid
sequenceDiagram
    participant A as Client A
    participant S as Server
    participant B as Client B

    Note over A,B: Both start synced

    A->>A: Create Op1, Op2 (offline)

    Note over B: Client B does SYNC_IMPORT<br/>(restores from backup)

    B->>S: Upload SYNC_IMPORT

    Note over A: Client A comes online

    A->>S: Upload Op1, Op2
    A->>A: Download SYNC_IMPORT

    Note over A: Problem: Op1, Op2 reference<br/>entities that were WIPED by import
```

### The Solution: Clean Slate Semantics

SYNC_IMPORT/BACKUP_IMPORT are explicit user actions to restore to a specific state. **ALL operations without knowledge of the import are dropped** - this ensures a true "restore to point in time" semantic.

We use **vector clock comparison** (not UUIDv7 timestamps) because vector clocks track **causality** ("did the client know about the import?") rather than wall-clock time (which can be affected by clock drift).

```mermaid
flowchart TD
    subgraph Input["Remote Operations Received"]
        Ops["Op1, Op2, SYNC_IMPORT, Op3, Op4"]
    end

    subgraph Filter["SyncImportFilterService"]
        FindImport["Find latest SYNC_IMPORT<br/>(in batch or local store)"]
        Compare["Compare each op's vector clock<br/>against import's vector clock"]
    end

    subgraph Results["Vector Clock Comparison"]
        GT["GREATER_THAN<br/>Op created AFTER seeing import"]
        EQ["EQUAL<br/>Same causal history"]
        LT["LESS_THAN<br/>Op dominated by import"]
        CC["CONCURRENT<br/>Op created WITHOUT<br/>knowledge of import"]
    end

    subgraph Outcome["Outcome"]
        Keep["✅ KEEP"]
        Drop["❌ DROP"]
    end

    Input --> FindImport
    FindImport --> Compare
    Compare --> GT
    Compare --> EQ
    Compare --> LT
    Compare --> CC

    GT --> Keep
    EQ --> Keep
    LT --> Drop
    CC --> Drop

    style GT fill:#c8e6c9,stroke:#2e7d32
    style EQ fill:#c8e6c9,stroke:#2e7d32
    style LT fill:#ffcdd2,stroke:#c62828
    style CC fill:#ffcdd2,stroke:#c62828
    style Keep fill:#e8f5e9,stroke:#2e7d32
    style Drop fill:#ffebee,stroke:#c62828
```

### Vector Clock Comparison Results

| Comparison     | Meaning                                | Action                     |
| -------------- | -------------------------------------- | -------------------------- |
| `GREATER_THAN` | Op created after seeing import         | ✅ Keep (has knowledge)    |
| `EQUAL`        | Same causal history as import          | ✅ Keep                    |
| `LESS_THAN`    | Op dominated by import                 | ❌ Drop (already captured) |
| `CONCURRENT`   | Op created without knowledge of import | ❌ Drop (clean slate)      |

### Implementation Details

```typescript
// In SyncImportFilterService.filterOpsInvalidatedBySyncImport()
for (const op of ops) {
  // Full state import operations themselves are always valid
  if (op.opType === OpType.SyncImport || op.opType === OpType.BackupImport) {
    validOps.push(op);
    continue;
  }

  // Use VECTOR CLOCK comparison to determine causality
  // Vector clocks track "did this client know about the import?"
  // rather than wall-clock time, making them immune to clock drift.
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

**Key Points:**

- Uses **vector clock comparison** (not UUIDv7 timestamps) for causality tracking
- CONCURRENT ops are dropped even from "unknown" clients
- Import can be in current batch OR from previous sync cycle (checks both)
- This is the correct behavior: import is an explicit user action to restore state

**Why Vector Clocks Instead of UUIDv7?**

Vector clocks track **causality** - whether a client "knew about" the import when it created an operation. UUIDv7 timestamps only track wall-clock time, which is unreliable due to clock drift between devices. An operation created 5 seconds after an import (by timestamp) may still reference entities that no longer exist if the client hadn't seen the import yet.

---

## 2d. LWW (Last-Write-Wins) Conflict Auto-Resolution ✅ IMPLEMENTED

When two clients make concurrent changes to the same entity, a conflict occurs. Rather than interrupting the user with a dialog, the system automatically resolves conflicts using **Last-Write-Wins (LWW)** based on operation timestamps.

**Implementation Status:** Complete. See `ConflictResolutionService.autoResolveConflictsLWW()`.

### 2d.1 What is a Conflict?

A conflict occurs when vector clock comparison returns `CONCURRENT` - meaning neither operation "happened before" the other. They represent independent, simultaneous edits.

```mermaid
flowchart TD
    subgraph Detection["Conflict Detection (Vector Clocks)"]
        Download[Download remote ops] --> Compare{Compare Vector Clocks}

        Compare -->|"LESS_THAN<br/>(remote is older)"| Discard["Discard remote<br/>(already have it)"]
        Compare -->|"GREATER_THAN<br/>(remote is newer)"| Apply["Apply remote<br/>(sequential update)"]
        Compare -->|"CONCURRENT<br/>(independent edits)"| Conflict["⚠️ CONFLICT<br/>Both changed same entity"]
    end

    subgraph Example["Example: Concurrent Edits"]
        direction LR
        ClientA["Client A<br/>Clock: {A:5, B:3}<br/>Marks task done"]
        ClientB["Client B<br/>Clock: {A:4, B:4}<br/>Renames task"]

        ClientA -.->|"Neither dominates"| Concurrent["CONCURRENT<br/>A has more A,<br/>B has more B"]
        ClientB -.-> Concurrent
    end

    Conflict --> Resolution["LWW Resolution"]

    style Conflict fill:#ffebee,stroke:#c62828,stroke-width:2px
    style Concurrent fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
```

### 2d.2 LWW Resolution Algorithm

The winner is determined by comparing the **maximum timestamp** from each operation's vector clock. The operation with the later timestamp wins. Ties go to remote (to ensure convergence).

```mermaid
flowchart TD
    subgraph Input["Conflicting Operations"]
        Local["LOCAL Operation<br/>━━━━━━━━━━━━━━━<br/>vectorClock: {A:5, B:3}<br/>timestamps: [1702900000, 1702899000]<br/>maxTimestamp: 1702900000"]
        Remote["REMOTE Operation<br/>━━━━━━━━━━━━━━━<br/>vectorClock: {A:4, B:4}<br/>timestamps: [1702898000, 1702901000]<br/>maxTimestamp: 1702901000"]
    end

    subgraph Algorithm["LWW Comparison"]
        GetMax["Extract max timestamp<br/>from each vector clock"]
        Compare{"Compare<br/>Timestamps"}

        GetMax --> Compare

        Compare -->|"Local > Remote"| LocalWins["🏆 LOCAL WINS<br/>Local state preserved<br/>Create UPDATE op to sync"]
        Compare -->|"Remote > Local<br/>OR tie"| RemoteWins["🏆 REMOTE WINS<br/>Apply remote state<br/>Reject local op"]
    end

    Local --> GetMax
    Remote --> GetMax

    subgraph Outcome["Resolution Outcome"]
        LocalWins --> CreateOp["Create new UPDATE operation<br/>with current entity state<br/>+ merged vector clock"]
        RemoteWins --> MarkRejected["Mark local op as rejected<br/>Apply remote op"]

        CreateOp --> Sync["New op syncs to server<br/>Other clients receive update"]
        MarkRejected --> Apply["Remote state applied<br/>User sees change"]
    end

    style LocalWins fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style RemoteWins fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style CreateOp fill:#c8e6c9,stroke:#2e7d32,stroke-width:2px
```

### 2d.3 Two Possible Outcomes

```mermaid
flowchart LR
    subgraph RemoteWinsPath["REMOTE WINS (more common)"]
        direction TB
        RW1["Remote timestamp >= Local timestamp"]
        RW2["Mark local op as REJECTED"]
        RW3["Apply remote operation"]
        RW4["Local change is overwritten"]

        RW1 --> RW2 --> RW3 --> RW4
    end

    subgraph LocalWinsPath["LOCAL WINS (less common)"]
        direction TB
        LW1["Local timestamp > Remote timestamp"]
        LW2["Mark BOTH ops as rejected"]
        LW3["Keep current local state"]
        LW4["Create NEW update operation<br/>with merged vector clock"]
        LW5["New op syncs to server"]
        LW6["Other clients receive<br/>local state as update"]

        LW1 --> LW2 --> LW3 --> LW4 --> LW5 --> LW6
    end

    style RemoteWinsPath fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style LocalWinsPath fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
```

### 2d.4 Complete LWW Flow

```mermaid
sequenceDiagram
    participant A as Client A
    participant S as Server
    participant B as Client B

    Note over A,B: Both start with Task "Buy milk"

    A->>A: User marks task done (T=100)
    B->>B: User renames to "Buy oat milk" (T=105)

    Note over A,B: Both go offline, then reconnect

    B->>S: Upload: Rename op (T=105)
    S-->>B: OK (serverSeq=50)

    A->>S: Upload: Done op (T=100)
    S-->>A: Rejected (CONCURRENT with seq=50)
    S-->>A: Piggybacked: Rename op from B

    Note over A: Conflict detected!<br/>Local: Done (T=100)<br/>Remote: Rename (T=105)

    A->>A: LWW: Remote wins (105 > 100)
    A->>A: Mark local op REJECTED
    A->>A: Apply remote (rename)
    A->>A: Show snackbar notification

    Note over A: Task is now "Buy oat milk"<br/>(not done - A's change lost)

    A->>S: Sync (download only)
    B->>S: Sync
    S-->>B: No new ops

    Note over A,B: ✅ Both clients converged<br/>Task: "Buy oat milk" (not done)
```

### 2d.5 Local Wins Scenario (with Update Propagation)

```mermaid
sequenceDiagram
    participant A as Client A
    participant S as Server
    participant B as Client B

    Note over A,B: Both start with Task "Meeting"

    B->>B: User adds note (T=100)

    Note over B: B goes offline

    B->>S: Upload: Add note op (T=100)
    S-->>B: OK (serverSeq=50)

    Note over A: A is offline, makes change later

    A->>A: User marks urgent (T=200)

    A->>S: Sync (download first)
    S-->>A: Download: Add note op from B

    Note over A: Conflict detected!<br/>Local: Urgent (T=200)<br/>Remote: Note (T=100)

    A->>A: LWW: Local wins (200 > 100)
    A->>A: Mark BOTH ops rejected
    A->>A: Create NEW update op with<br/>current state (urgent + note merged)<br/>+ merged vector clock

    A->>S: Upload: New update op
    S-->>A: OK (serverSeq=51)

    B->>S: Sync
    S-->>B: Download: Update op from A
    B->>B: Apply update

    Note over A,B: ✅ Both clients converged<br/>Task has BOTH changes
```

### 2d.6 User Notification

After auto-resolution, users see a non-blocking snackbar notification informing them that conflicts were resolved automatically.

```mermaid
flowchart LR
    subgraph Resolution["After LWW Resolution"]
        Resolved["Conflicts resolved"]
    end

    subgraph Notification["User Notification"]
        Snack["📋 Snackbar<br/>━━━━━━━━━━━━━━━<br/>'X conflicts were<br/>auto-resolved'<br/>━━━━━━━━━━━━━━━<br/>Non-blocking<br/>Auto-dismisses"]
    end

    subgraph Backup["Safety Net"]
        BackupCreated["💾 Safety Backup<br/>━━━━━━━━━━━━━━━<br/>Created BEFORE resolution<br/>User can restore if needed"]
    end

    Resolution --> Notification
    Resolution --> Backup

    style Snack fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style BackupCreated fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
```

### 2d.7 Key Implementation Details

| Aspect                 | Implementation                                                              |
| ---------------------- | --------------------------------------------------------------------------- |
| **Timestamp Source**   | `Math.max(...Object.values(vectorClock))` - max timestamp from vector clock |
| **Tie Breaker**        | Remote wins (ensures convergence across all clients)                        |
| **Safety Backup**      | Created via `BackupService` before any resolution                           |
| **Local Win Update**   | New `OpType.UPD` operation created with merged vector clock                 |
| **Vector Clock Merge** | `mergeVectorClocks(localClock, remoteClock)` for local-win ops              |
| **Entity State**       | Retrieved from NgRx store via entity-specific selectors                     |
| **Notification**       | Non-blocking snackbar showing count of resolved conflicts                   |

### 2d.8 Why LWW?

```mermaid
flowchart TB
    subgraph Problem["❌ Manual Resolution (Old Approach)"]
        P1["User sees blocking dialog"]
        P2["Must choose: local or remote"]
        P3["Interrupts workflow"]
        P4["Confusing for non-technical users"]
        P5["Can cause sync to stall"]
    end

    subgraph Solution["✅ LWW Auto-Resolution (New Approach)"]
        S1["Automatic, instant resolution"]
        S2["Based on objective criteria (time)"]
        S3["Non-blocking notification"]
        S4["Safety backup available"]
        S5["All clients converge to same state"]
    end

    subgraph Tradeoff["⚖️ Tradeoff"]
        T1["Occasionally 'wrong' winner<br/>(user's intent may differ from timestamp)"]
        T2["Mitigated by: undo, backup,<br/>and generally rare conflicts"]
    end

    Problem --> Solution
    Solution --> Tradeoff

    style Problem fill:#ffebee,stroke:#c62828,stroke-width:2px
    style Solution fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style Tradeoff fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
```

---

## 2e. Full-State Operation Skip Optimization ✅ IMPLEMENTED

When a SYNC_IMPORT, BACKUP_IMPORT, or REPAIR operation exists, all prior operations are superseded because the full-state operation contains the complete application state. This optimization reduces bandwidth and processing by skipping pre-snapshot operations during download.

**Implementation Status:** Complete.

- **Server**: `SyncService.getOpsSinceWithSeq()` in `sync.service.ts`
- **Client**: `OperationLogSyncService._filterOpsInvalidatedBySyncImport()` in `operation-log-sync.service.ts`

### 2e.1 The Problem: Wasted Bandwidth

Without optimization, a fresh client downloading operations after a SYNC_IMPORT would receive all historical operations, even though they're superseded by the full-state snapshot:

```mermaid
flowchart TD
    subgraph Problem["❌ Without Optimization"]
        Server["Server Operations<br/>━━━━━━━━━━━━━━━<br/>Op 1-99: Historical ops<br/>Op 100: SYNC_IMPORT<br/>Op 101-105: Post-import"]

        Client["Fresh Client<br/>sinceSeq = 0"]

        Download["Downloads ALL 105 ops<br/>━━━━━━━━━━━━━━━<br/>• Ops 1-99: Will be filtered<br/>• Op 100: Applied (snapshot)<br/>• Ops 101-105: Applied"]

        Waste["⚠️ 99 ops downloaded<br/>but immediately discarded"]
    end

    Server --> Client
    Client --> Download
    Download --> Waste

    style Waste fill:#ffebee,stroke:#c62828,stroke-width:2px
```

### 2e.2 The Solution: Server-Side Skip

The server detects the latest full-state operation and skips directly to it when the client's `sinceSeq` is before the snapshot:

```mermaid
flowchart TD
    subgraph Solution["✅ With Optimization"]
        Server2["Server Operations<br/>━━━━━━━━━━━━━━━<br/>Op 1-99: Historical ops<br/>Op 100: SYNC_IMPORT ⬅️<br/>Op 101-105: Post-import"]

        Query["GET /api/sync/ops?sinceSeq=0"]

        Detect["Server detects:<br/>latestSnapshotSeq = 100<br/>sinceSeq (0) < snapshotSeq (100)"]

        Skip["Skip to seq 99<br/>(effectiveSinceSeq = 99)"]

        Response["Response:<br/>━━━━━━━━━━━━━━━<br/>• ops: [100, 101, 102, 103, 104, 105]<br/>• latestSnapshotSeq: 100<br/>• gapDetected: false"]

        Efficient["✅ Only 6 ops downloaded<br/>(not 105)"]
    end

    Query --> Detect
    Detect --> Skip
    Skip --> Response
    Response --> Efficient

    style Efficient fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style Skip fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
```

### 2e.3 Server-Side Implementation

```mermaid
flowchart TD
    subgraph ServerLogic["Server: getOpsSinceWithSeq()"]
        Start[Receive request<br/>sinceSeq, excludeClient]

        FindSnapshot["Find latest full-state op<br/>WHERE opType IN<br/>('SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR')<br/>ORDER BY serverSeq DESC"]

        CheckSkip{sinceSeq <<br/>snapshotSeq?}

        Skip["effectiveSinceSeq =<br/>snapshotSeq - 1"]

        NoSkip["effectiveSinceSeq =<br/>sinceSeq"]

        Query["SELECT ops WHERE<br/>serverSeq > effectiveSinceSeq"]

        GapCheck{"Gap detection:<br/>first op > effectiveSinceSeq + 1?"}

        Response["Return {<br/>  ops,<br/>  latestSeq,<br/>  latestSnapshotSeq,<br/>  gapDetected<br/>}"]
    end

    Start --> FindSnapshot
    FindSnapshot --> CheckSkip
    CheckSkip -->|Yes| Skip
    CheckSkip -->|No| NoSkip
    Skip --> Query
    NoSkip --> Query
    Query --> GapCheck
    GapCheck --> Response

    style Skip fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
```

### 2e.4 Client-Side Filtering

Even with server-side optimization, the client maintains its own safety filter for pre-import operations. This handles edge cases like:

- Pagination (ops downloaded in multiple batches)
- `excludeClient` parameter filtering
- Race conditions during upload

```mermaid
flowchart TD
    subgraph ClientFilter["Client: _filterOpsInvalidatedBySyncImport()"]
        Receive["Receive downloaded ops"]

        FindImport["Find latest full-state op<br/>in downloaded batch"]

        HasImport{Found<br/>SYNC_IMPORT?}

        ForEach["For each operation:"]

        IsFullState{Is full-state<br/>operation?}

        CheckTimestamp{"UUIDv7 timestamp<br/>op.id >= import.id?"}

        Keep["Keep operation<br/>(valid)"]

        Discard["Discard operation<br/>(superseded)"]

        Return["Return filtered ops"]
    end

    Receive --> FindImport
    FindImport --> HasImport
    HasImport -->|No| Return
    HasImport -->|Yes| ForEach

    ForEach --> IsFullState
    IsFullState -->|Yes| Keep
    IsFullState -->|No| CheckTimestamp

    CheckTimestamp -->|Yes| Keep
    CheckTimestamp -->|No| Discard

    Keep --> ForEach
    Discard --> ForEach

    style Keep fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style Discard fill:#ffebee,stroke:#c62828,stroke-width:2px
```

**Important:** The client filter uses **UUIDv7 timestamp comparison** (not client ID) to determine which operations are valid. Operations created **before** the SYNC_IMPORT (by timestamp) are filtered out, regardless of which client created them.

### 2e.5 Gap Detection Interaction

The skip optimization must not trigger false gap detection. The server uses `effectiveSinceSeq` for gap detection:

| Scenario                | sinceSeq | snapshotSeq | effectiveSinceSeq | First Op | Gap?                |
| ----------------------- | -------- | ----------- | ----------------- | -------- | ------------------- |
| Fresh client, skip      | 0        | 100         | 99                | 100      | ❌ No (100 = 99+1)  |
| Client past snapshot    | 150      | 100         | 150               | 151      | ❌ No (151 = 150+1) |
| Real gap after snapshot | 52       | 50          | 52                | 56       | ✅ Yes (56 > 52+1)  |
| Client at snapshot      | 100      | 100         | 100               | 101      | ❌ No (101 = 100+1) |

### 2e.6 Full-State Operation Types

| OpType          | Description                   | When Created                           |
| --------------- | ----------------------------- | -------------------------------------- |
| `SYNC_IMPORT`   | Full state from sync download | Client receives full state during sync |
| `BACKUP_IMPORT` | Full state from backup file   | User imports a backup file             |
| `REPAIR`        | Full state from auto-repair   | System detects and fixes corruption    |

All three operation types contain `{ appDataComplete: {...} }` payload with the entire application state.

### 2e.7 Response Schema

```typescript
interface DownloadOpsResponse {
  ops: ServerOperation[]; // Operations after sinceSeq (or after snapshot)
  hasMore: boolean; // True if more ops available (pagination)
  latestSeq: number; // Server's latest sequence number
  gapDetected?: boolean; // True if operations are missing
  latestSnapshotSeq?: number; // Server seq of latest full-state op (if any)
}
```

The `latestSnapshotSeq` field is informational - clients can use it to know a snapshot exists without scanning the ops array.

---

## 2f. Vector Clock-Based SYNC_IMPORT Filtering ✅ IMPLEMENTED

When a SYNC_IMPORT occurs, operations created **without knowledge** of the import must be filtered out - they reference state that no longer exists. This section explains why **vector clock comparison** is more reliable than UUIDv7 timestamp comparison for this filtering.

**Implementation Status:** ✅ Implemented in `operation-log-sync.service.ts:_filterOpsInvalidatedBySyncImport()`. Uses `compareVectorClocks()` to determine causality rather than UUIDv7 timestamps.

### 2f.1 The Problem: Clock Drift with UUIDv7

UUIDv7 timestamps depend on client wall-clock time. If a client's clock is incorrect, pre-import operations may have future timestamps and bypass filtering:

```mermaid
flowchart LR
    subgraph UUIDv7["❌ UUIDv7 Approach (Previous)"]
        direction TB
        U1["Client B's clock is 2 hours AHEAD"]
        U2["B creates op at REAL time 10:00"]
        U3["UUIDv7 timestamp = 12:00<br/>(wrong due to clock drift)"]
        U4["SYNC_IMPORT at 11:00"]
        U5["Filter check: 12:00 > 11:00"]
        U6["🐛 NOT FILTERED!<br/>Old op applied, corrupts state"]

        U1 --> U2 --> U3 --> U4 --> U5 --> U6
    end

    subgraph VectorClock["✅ Vector Clock Approach (Current)"]
        direction TB
        V1["Client B's clock is 2 hours AHEAD"]
        V2["B creates op (offline)"]
        V3["op.vectorClock = {A: 2, B: 3}<br/>(wall-clock time irrelevant)"]
        V4["SYNC_IMPORT.vectorClock = {A: 3}"]
        V5["Compare: {A:2,B:3} vs {A:3}<br/>Result: CONCURRENT"]
        V6["✅ FILTERED!<br/>Op created without knowledge of import"]

        V1 --> V2 --> V3 --> V4 --> V5 --> V6
    end

    style U6 fill:#ffcccc
    style V6 fill:#ccffcc
```

### 2f.2 How Vector Clocks Track Causality

Each client maintains a counter. When creating an operation, the client increments its counter and attaches the full clock state. When receiving operations, it **merges** clocks (taking the max of each component).

```mermaid
sequenceDiagram
    participant A as Client A<br/>clock: {}
    participant Server as Server
    participant B as Client B<br/>clock: {}

    Note over A,B: === PHASE 1: Normal Sync ===

    rect rgb(220, 240, 220)
        Note over A: Creates op1<br/>clock: {A: 1}
        A->>Server: upload op1<br/>vectorClock: {A: 1}

        Note over A: Creates op2<br/>clock: {A: 2}
        A->>Server: upload op2<br/>vectorClock: {A: 2}
    end

    rect rgb(220, 220, 240)
        Server->>B: download op1, op2
        Note over B: Merges clocks<br/>clock: {A: 2}

        Note over B: Creates op3<br/>clock: {A: 2, B: 1}
        B->>Server: upload op3<br/>vectorClock: {A: 2, B: 1}
    end

    rect rgb(220, 240, 220)
        Server->>A: download op3
        Note over A: Merges clocks<br/>clock: {A: 2, B: 1}
    end

    Note over A,B: Both clients now have synchronized clocks<br/>A: {A: 2, B: 1}, B: {A: 2, B: 1}

    Note over A,B: === PHASE 2: Client B Goes Offline ===

    rect rgb(255, 240, 220)
        Note over B: 🔴 OFFLINE

        Note over B: Creates op4 (offline)<br/>clock: {A: 2, B: 2}
        Note over B: Creates op5 (offline)<br/>clock: {A: 2, B: 3}

        Note over B: These ops reference<br/>the OLD state
    end

    Note over A,B: === PHASE 3: Client A Does SYNC_IMPORT ===

    rect rgb(255, 220, 220)
        Note over A: User imports backup<br/>FULL STATE REPLACEMENT

        Note over A: Creates SYNC_IMPORT op<br/>clock: {A: 3}

        A->>Server: upload SYNC_IMPORT<br/>vectorClock: {A: 3}

        Note over Server: Server has:<br/>op1 {A:1}<br/>op2 {A:2}<br/>op3 {A:2,B:1}<br/>SYNC_IMPORT {A:3}<br/>(op4, op5 not uploaded yet)
    end

    Note over A,B: === PHASE 4: Client B Comes Online ===

    rect rgb(255, 240, 220)
        Note over B: 🟢 ONLINE
        B->>Server: upload op4, op5<br/>vectorClock: {A: 2, B: 2}<br/>vectorClock: {A: 2, B: 3}
    end

    Note over A,B: === PHASE 5: The Problem - Client A Downloads B's Ops ===

    rect rgb(255, 200, 200)
        Server->>A: download op4, op5

        Note over A: Compare op4 to SYNC_IMPORT:<br/>op4: {A: 2, B: 2}<br/>import: {A: 3}<br/><br/>A: 2 < 3 (import ahead)<br/>B: 2 > 0 (op4 ahead)<br/><br/>Result: CONCURRENT

        Note over A: CONCURRENT means:<br/>"Created WITHOUT knowledge<br/>of the SYNC_IMPORT"<br/><br/>These ops reference entities<br/>that may not exist anymore!
    end
```

### 2f.3 Vector Clock Comparison Logic

```mermaid
flowchart TB
    subgraph VectorClockComparison["Vector Clock Comparison Logic"]
        direction TB

        Compare["Compare op.vectorClock vs syncImport.vectorClock"]

        Compare --> CheckAll{"For each client ID<br/>in both clocks"}

        CheckAll --> |"All op values ≤ import values"| LessThan["LESS_THAN<br/>(Dominated)"]
        CheckAll --> |"All op values ≥ import values"| GreaterThan["GREATER_THAN<br/>(Newer)"]
        CheckAll --> |"All values equal"| Equal["EQUAL"]
        CheckAll --> |"Some greater, some less"| Concurrent["CONCURRENT<br/>(Independent)"]

        LessThan --> Filter1["🚫 FILTER<br/>Op created BEFORE import"]
        Concurrent --> Filter2["🚫 FILTER<br/>Op created WITHOUT<br/>KNOWLEDGE of import"]
        Equal --> Keep1["✅ KEEP"]
        GreaterThan --> Keep2["✅ KEEP<br/>Op created AFTER<br/>seeing import"]
    end

    subgraph Example1["Example: LESS_THAN (Dominated)"]
        E1Op["op.vectorClock = {A: 1}"]
        E1Import["import.vectorClock = {A: 3}"]
        E1Result["A: 1 < 3<br/>Result: LESS_THAN → FILTER"]
    end

    subgraph Example2["Example: CONCURRENT (The Problem Case)"]
        E2Op["op.vectorClock = {A: 2, B: 3}"]
        E2Import["import.vectorClock = {A: 3}"]
        E2Result["A: 2 < 3 (import ahead)<br/>B: 3 > 0 (op ahead)<br/>Result: CONCURRENT → FILTER"]
    end

    subgraph Example3["Example: GREATER_THAN (Valid)"]
        E3Op["op.vectorClock = {A: 3, B: 4}"]
        E3Import["import.vectorClock = {A: 3}"]
        E3Result["A: 3 = 3 (equal)<br/>B: 4 > 0 (op ahead)<br/>Result: GREATER_THAN → KEEP"]
    end
```

### 2f.4 The Key Insight: CONCURRENT = "No Knowledge"

```mermaid
flowchart TB
    subgraph KeyInsight["🔑 Key Insight"]
        direction TB

        K1["CONCURRENT = 'Created without knowledge of'"]
        K2["If Client B had SEEN the import first..."]
        K3["B would merge: {A: 3} into their clock"]
        K4["B's new ops would have: {A: 3, B: 4}"]
        K5["Compare {A:3,B:4} vs {A:3} = GREATER_THAN"]
        K6["These ops are VALID (created after seeing import)"]

        K1 --> K2 --> K3 --> K4 --> K5 --> K6
    end

    subgraph FilterRule["📋 Filter Rule"]
        direction TB

        R1["For each downloaded op:"]
        R2{"compareVectorClocks(<br/>op.vectorClock,<br/>syncImport.vectorClock)"}

        R2 --> |"LESS_THAN"| R3["🚫 Filter (dominated)"]
        R2 --> |"CONCURRENT"| R4["🚫 Filter (no knowledge)"]
        R2 --> |"EQUAL"| R5["✅ Keep"]
        R2 --> |"GREATER_THAN"| R6["✅ Keep (saw import)"]

        R1 --> R2
    end

    style K1 fill:#ffffcc
    style R3 fill:#ffcccc
    style R4 fill:#ffcccc
    style R5 fill:#ccffcc
    style R6 fill:#ccffcc
```

### 2f.5 Comparison Summary

| Scenario                                             | Vector Clock Comparison | UUIDv7 Comparison            | Correct Action                           |
| ---------------------------------------------------- | ----------------------- | ---------------------------- | ---------------------------------------- |
| Op created before import, same client                | LESS_THAN               | Earlier timestamp            | ✅ Both filter correctly                 |
| Op created before import, different client (offline) | CONCURRENT              | Earlier timestamp            | ✅ Both filter correctly                 |
| Op created after seeing import                       | GREATER_THAN            | Later timestamp              | ✅ Both keep correctly                   |
| **Op created before import, but client clock ahead** | CONCURRENT              | **Later timestamp (wrong!)** | Vector clock filters ✅, UUIDv7 fails ❌ |

**Why Vector Clocks Are More Reliable:**

Vector clocks track **causality via counters**, not wall-clock time. A client that didn't see the import will always produce CONCURRENT ops, regardless of what their system clock says. This makes the filtering immune to clock drift.

---

## 2g. Gap Detection ✅ IMPLEMENTED

Gap detection identifies situations where the client cannot reliably sync incrementally and must take corrective action. When `gapDetected: true` is returned, the client resets to `sinceSeq=0` and re-downloads all operations.

### 2g.1 The Four Gap Cases

The server checks for gaps in `OperationDownloadService.getOpsSinceWithSeq()`:

| Case | Condition                         | Meaning                             | Typical Cause                          |
| ---- | --------------------------------- | ----------------------------------- | -------------------------------------- |
| 1    | `sinceSeq > 0 && latestSeq === 0` | Client has history, server is empty | Server was reset/migrated              |
| 2    | `sinceSeq > latestSeq`            | Client is ahead of server           | Server DB restored from old backup     |
| 3    | `sinceSeq < minSeq - 1`           | Requested ops were purged           | Retention policy deleted old ops       |
| 4    | `firstOpSeq > sinceSeq + 1`       | Gap in sequence numbers             | Database corruption or manual deletion |

**Case 3 Math Explained:**

- If `sinceSeq = 5` and `minSeq = 7` → `5 < 6` = **gap** (op 6 was purged)
- If `sinceSeq = 5` and `minSeq = 6` → `5 < 5` = **no gap** (op 6 exists)

### 2g.2 Client-Side Handling

```mermaid
flowchart TD
    Download["Download ops from server"]
    GapCheck{gapDetected?}
    Reset["Reset sinceSeq = 0<br/>Clear accumulated ops"]
    ReDownload["Re-download from beginning"]
    HasReset{Already reset<br/>this session?}
    ServerEmpty{Server empty?<br/>latestSeq === 0}
    Migration["Server Migration:<br/>Create SYNC_IMPORT<br/>with full local state"]
    Continue["Process downloaded ops normally"]

    Download --> GapCheck
    GapCheck -->|Yes| HasReset
    HasReset -->|No| Reset
    Reset --> ReDownload
    ReDownload --> GapCheck
    HasReset -->|Yes| ServerEmpty
    GapCheck -->|No| Continue
    ServerEmpty -->|Yes| Migration
    ServerEmpty -->|No| Continue
    Migration --> Continue

    style Migration fill:#fff3e0,stroke:#e65100,stroke-width:2px
    style Reset fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
```

**Key behaviors:**

- **All gap cases**: Client resets to `sinceSeq=0` and re-downloads everything
- **Infinite loop prevention**: `hasResetForGap` flag ensures reset only happens once per sync session
- **Case 1 special handling**: If gap detected AND server is empty → trigger server migration

### 2g.3 Server Migration Flow

When a client with existing data connects to an empty server (Case 1), it must seed the server with its state:

```mermaid
sequenceDiagram
    participant Client
    participant Server
    participant DB

    Note over Client: Has local data,<br/>lastServerSeq = 100

    Client->>Server: GET /api/sync/ops?sinceSeq=100
    Server->>DB: Check latestSeq
    DB-->>Server: latestSeq = 0 (empty)
    Server-->>Client: {ops: [], latestSeq: 0, gapDetected: true}

    Note over Client: Gap detected!<br/>Reset sinceSeq = 0

    Client->>Server: GET /api/sync/ops?sinceSeq=0
    Server-->>Client: {ops: [], latestSeq: 0, gapDetected: false}

    Note over Client: Server still empty<br/>after reset = migration!

    Client->>Client: Create SYNC_IMPORT op<br/>with full local state
    Client->>Server: POST /api/sync/snapshot
    Server->>DB: Store SYNC_IMPORT
    Server-->>Client: {serverSeq: 1}

    Note over Client,Server: New server is now seeded<br/>Other clients can sync
```

**What SYNC_IMPORT contains:**

- Full application state (tasks, projects, tags, etc.)
- Vector clock incremented for the creating client
- `opType: 'SYNC_IMPORT'`, `entityType: 'ALL'`

### 2g.4 Code References

| Component                | File                                                                         | Lines   |
| ------------------------ | ---------------------------------------------------------------------------- | ------- |
| Server gap detection     | `packages/super-sync-server/src/sync/services/operation-download.service.ts` | 157-196 |
| Client gap handling      | `src/app/op-log/sync/operation-log-download.service.ts`                      | 169-182 |
| Server migration service | `src/app/op-log/sync/server-migration.service.ts`                            | -       |
| Server migration trigger | `src/app/op-log/sync/operation-log-sync.service.ts`                          | 245-252 |

### 2g.5 Testing

Gap detection is comprehensively tested:

- **Server tests**: `packages/super-sync-server/tests/gap-detection.spec.ts` (~15 tests)
- **Client download tests**: `src/app/op-log/sync/operation-log-download.service.spec.ts` (6 gap-specific tests)
- **Migration service tests**: `src/app/op-log/sync/server-migration.service.spec.ts` (~20 tests)
- **Integration tests**: `src/app/op-log/testing/integration/server-migration.integration.spec.ts` (8 tests)

---

## 3. Conflict-Aware Migration Strategy (The Migration Shield)

> **Note:** Sections 3, 4.1, and 4.2 describe the **cross-version migration strategy** (A.7.8) which is designed but not yet implemented. Currently `CURRENT_SCHEMA_VERSION = 1`, so all clients are on the same version. State cache snapshots are migrated via `SchemaMigrationService.migrateIfNeeded()`. Individual operation migration will be needed when schema versions diverge between clients.

This diagram visualizes the "Receiver-Side Migration" strategy. The Migration Layer acts as a shield, ensuring that _only_ operations matching the current schema version ever reach the core conflict detection and application logic.

```mermaid
graph TD
    %% Nodes
    subgraph "Sources of Operations (Mixed Versions)"
        Remote[Remote Client Sync]:::src
        Disk[Local Disk Tail Ops]:::src
    end

    subgraph "Migration Layer (The Shield)"
        Check{"Is Op Old?<br/>(vOp < vCurrent)"}:::logic
        Migrate["Run migrateOperation()<br/>Pipeline"]:::action
        CheckDrop{"Result is<br/>Null?"}:::logic
        Pass["Pass Through"]:::pass
    end

    subgraph "Core System (Current Version Only)"
        Conflict["Conflict Detection<br/>(Apples-to-Apples)"]:::core
        Apply["Apply to State"]:::core
    end

    %% Flow
    Remote --> Check
    Disk --> Check

    Check -- Yes --> Migrate
    Check -- No --> Pass

    Migrate --> CheckDrop
    CheckDrop -- Yes --> Drop[("🗑️ Drop Op<br/>(Destructive Change)")]:::drop
    CheckDrop -- No --> Conflict

    Pass --> Conflict
    Conflict --> Apply

    %% Styles
    classDef src fill:#fff3e0,stroke:#ef6c00,stroke-width:2px;
    classDef logic fill:#fff,stroke:#333,stroke-width:2px;
    classDef action fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px;
    classDef pass fill:#e3f2fd,stroke:#1565c0,stroke-width:2px;
    classDef drop fill:#ffebee,stroke:#c62828,stroke-width:2px,stroke-dasharray: 5 5;
    classDef core fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px;
```

## 4. Migration Scenarios

### 4.1 Tail Ops Migration (Local Startup Consistency)

Ensures that operations occurring after a snapshot ("Tail Ops") are migrated to the current version before being applied to the migrated state.

<details>
<summary>Sequence Diagram</summary>

```mermaid
sequenceDiagram
    participant IDB as IndexedDB (SUP_OPS)
    participant Hydrator as OpLogHydrator
    participant Migrator as SchemaMigrationService
    participant Applier as OperationApplier
    participant Store as NgRx Store

    Note over IDB, Store: App Updated from V1 -> V2

    Hydrator->>IDB: Load Snapshot (Version 1)
    IDB-->>Hydrator: Returns Snapshot V1

    Hydrator->>Migrator: migrateIfNeeded(Snapshot V1)
    Migrator-->>Hydrator: Returns Migrated Snapshot (Version 2)

    Hydrator->>Store: Load Initial State (V2)

    Hydrator->>IDB: Load Tail Ops (Version 1)
    Note right of IDB: Ops created after snapshot<br/>but before update
    IDB-->>Hydrator: Returns Ops [OpA(v1), OpB(v1)]

    loop For Each Op
        Hydrator->>Migrator: migrateOperation(Op V1)
        Migrator-->>Hydrator: Returns Op V2 (or null)

        alt Op was Dropped (null)
            Hydrator->>Hydrator: Ignore
        else Op Migrated
            Hydrator->>Applier: Apply(Op V2)
            Applier->>Store: Dispatch Action (V2 Payload)
        end
    end

    Note over Store: State matches V2 Schema<br/>Consistency Preserved
```

</details>

<details>
<summary>Flowchart Diagram</summary>

```mermaid
graph TD
    subgraph "Hydration & Migration"
        direction TB
        Start((App Start)) --> LoadSnap["Load Snapshot<br/>(Version V1)"]
        LoadSnap --> CheckVer{"Schema<br/>Version?"}

        CheckVer -- Match --> LoadState
        CheckVer -- Old --> MigrateSnap["migrateIfNeeded()<br/>Upgrade V1 -> V2"]
        MigrateSnap --> LoadState["Init NgRx State<br/>(Version V2)"]

        LoadState --> LoadTail["Load Tail Ops<br/>(Version V1)"]
        LoadTail --> Iterate{Next Op?}

        Iterate -- No --> Done((Ready))
        Iterate -- Yes --> MigOp["migrateOperation(Op V1)"]

        MigOp --> NullCheck{Result?}
        NullCheck -- Null --> Drop[Drop Op]
        NullCheck -- Valid --> Apply[Apply Op V2]

        Drop --> Iterate
        Apply --> Iterate
    end

    classDef process fill:#e1f5fe,stroke:#0277bd,stroke-width:2px;
    classDef decision fill:#fff,stroke:#333,stroke-width:2px;
    class LoadSnap,MigrateSnap,LoadState,LoadTail,MigOp,Apply process;
    class CheckVer,Iterate,NullCheck decision;
```

</details>

### 4.2 Receiver-Side Sync Migration

Demonstrates how a client on V2 handles incoming data from a client still on V1.

<details>
<summary>Sequence Diagram</summary>

```mermaid
sequenceDiagram
    participant Remote as Remote Client (V1)
    participant Server as Sync Server
    participant Local as Local Client (V2)
    participant Conflict as Conflict Detector

    Remote->>Server: Upload Operation (Version 1)<br/>{ payload: { oldField: 'X' } }
    Server-->>Local: Download Operation (Version 1)

    Note over Local: Client V2 receives V1 data

    Local->>Local: Check Op Schema Version (v1 < v2)
    Local->>Local: Call SchemaMigrationService.migrateOperation()

    Note over Local: Transforms payload:<br/>{ oldField: 'X' } -> { newField: 'X' }

    Local->>Conflict: detectConflicts(Remote Op V2)

    alt Conflict Detected
        Conflict->>Local: Show Dialog (V2 vs V2 comparison)
    else No Conflict
        Local->>Local: Apply Operation (V2)
    end
```

</details>

<details>
<summary>Flowchart Diagram</summary>

```mermaid
graph TD
    subgraph "Remote"
        RemoteClient["Remote Client<br/>(Version V1)"] -->|Upload| Server[(Server)]
    end

    subgraph "Local Client (Version V2)"
        Server -->|Download| InOp["Incoming Op<br/>(Version V1)"]
        InOp --> CheckSchema{"Schema<br/>Check"}

        CheckSchema -- "V1 < V2" --> Migrate["migrateOperation()<br/>Upgrade V1 -> V2"]
        CheckSchema -- "V1 == V2" --> Conflict

        Migrate --> NullCheck{Result?}
        NullCheck -- Null --> Discard[Discard Op]
        NullCheck -- Valid --> Conflict

        Conflict{"Conflict<br/>Detection"}
        Conflict -- "No Conflict" --> Apply[Apply Op V2]
        Conflict -- "Conflict" --> Resolve[Resolution Dialog]
    end

    classDef remote fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px;
    classDef local fill:#e3f2fd,stroke:#1565c0,stroke-width:2px;
    classDef decision fill:#fff,stroke:#333,stroke-width:2px;

    class RemoteClient,Server remote;
    class InOp,Migrate,Apply,Resolve,Discard local;
    class CheckSchema,NullCheck,Conflict decision;
```

</details>

## 5. Hybrid Manifest (File-Based Sync) ✅ IMPLEMENTED

This diagram illustrates the "Hybrid Manifest" optimization (`hybrid-manifest-architecture.md`) which reduces HTTP request overhead for WebDAV/Dropbox sync by buffering small operations directly inside the manifest file.

**Implementation Status:** Complete. Managed by `OperationLogManifestService` with remote cleanup after 14 days.

```mermaid
graph TD
    %% Nodes
    subgraph "Hybrid Manifest File (JSON)"
        ManVer[Version: 2]:::file
        SnapRef[Last Snapshot: 'snap_123.json']:::file
        Buffer[Embedded Ops Buffer<br/>Op1, Op2, ...]:::buffer
        ExtFiles[External Files List<br/>ops_A.json, ...]:::file
    end

    subgraph "Sync Logic (Upload Path)"
        Start((Start Sync)) --> ReadMan[Download Manifest]
        ReadMan --> CheckSize{Buffer Full?<br/>more than 50 ops}

        CheckSize -- No --> AppendBuffer[Append to<br/>Embedded Ops]:::action
        AppendBuffer --> WriteMan[Upload Manifest]:::io

        CheckSize -- Yes --> Flush[Flush Buffer]:::action
        Flush --> CreateFile[Create 'ops_NEW.json'<br/>with old buffer content]:::io
        CreateFile --> UpdateRef[Add 'ops_NEW.json'<br/>to External Files]:::action
        UpdateRef --> ClearBuffer[Clear Buffer &<br/>Add Pending Ops]:::action
        ClearBuffer --> WriteMan
    end

    %% Styles
    classDef file fill:#fff3e0,stroke:#ef6c00,stroke-width:2px;
    classDef buffer fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px;
    classDef action fill:#e3f2fd,stroke:#1565c0,stroke-width:2px;
    classDef io fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px;
```

## 6. Hybrid Manifest Conceptual Overview ✅ IMPLEMENTED

This diagram shows the Hybrid Manifest architecture: how operations flow from "hot" (recent, in manifest) to "cold" (archived files) to "frozen" (snapshot), and the decision logic for each transition.

**Implementation Status:** Complete. Used by `OperationLogUploadService` and `OperationLogDownloadService` for file-based sync providers (WebDAV, Dropbox).

### 6.1 Data Lifecycle: Hot → Cold → Frozen

```mermaid
graph LR
    subgraph "HOT: Manifest Buffer"
        direction TB
        Buffer["embeddedOperations[]<br/>━━━━━━━━━━━━━━━<br/>• Op 47<br/>• Op 48<br/>• Op 49<br/>━━━━━━━━━━━━━━━<br/>~50 ops max"]
    end

    subgraph "COLD: Operation Files"
        direction TB
        Files["operationFiles[]<br/>━━━━━━━━━━━━━━━<br/>• overflow_001.json<br/>• overflow_002.json<br/>• overflow_003.json<br/>━━━━━━━━━━━━━━━<br/>~50 files max"]
    end

    subgraph "FROZEN: Snapshot"
        direction TB
        Snap["lastSnapshot<br/>━━━━━━━━━━━━━━━<br/>snap_170789.json<br/>━━━━━━━━━━━━━━━<br/>Full app state"]
    end

    NewOp((New Op)) -->|"Always"| Buffer
    Buffer -->|"When full<br/>(overflow)"| Files
    Files -->|"When too many<br/>(compaction)"| Snap

    style Buffer fill:#c8e6c9,stroke:#2e7d32,stroke-width:2px
    style Files fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style Snap fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style NewOp fill:#fff,stroke:#333,stroke-width:2px
```

### 6.2 Manifest File Structure

```mermaid
graph TB
    subgraph Manifest["manifest.json"]
        direction TB

        V["version: 2"]
        FC["frontierClock: { A: 5, B: 3 }"]

        subgraph SnapRef["lastSnapshot (optional)"]
            SF["fileName: 'snap_170789.json'"]
            SV["vectorClock: { A: 2, B: 1 }"]
        end

        subgraph EmbeddedOps["embeddedOperations[] — THE BUFFER"]
            E1["Op { id: 'abc', entityType: 'TASK', ... }"]
            E2["Op { id: 'def', entityType: 'PROJECT', ... }"]
            E3["...up to 50 ops"]
        end

        subgraph OpFiles["operationFiles[] — OVERFLOW REFERENCES"]
            F1["{ fileName: 'overflow_001.json', opCount: 100 }"]
            F2["{ fileName: 'overflow_002.json', opCount: 100 }"]
        end
    end

    style Manifest fill:#fff,stroke:#333,stroke-width:3px
    style EmbeddedOps fill:#c8e6c9,stroke:#2e7d32,stroke-width:2px
    style OpFiles fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style SnapRef fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
```

### 6.3 Write Path: Buffer vs Overflow Decision

```mermaid
flowchart TD
    Start([Client has pending ops]) --> Download[Download manifest.json]
    Download --> CheckRemote{Remote has<br/>new ops?}

    CheckRemote -->|Yes| ApplyFirst[Download & apply<br/>remote ops first]
    ApplyFirst --> CheckBuffer
    CheckRemote -->|No| CheckBuffer

    CheckBuffer{Buffer + Pending<br/>< 50 ops?}

    CheckBuffer -->|Yes| FastPath
    CheckBuffer -->|No| SlowPath

    subgraph FastPath["⚡ FAST PATH (1 request)"]
        Append[Append pending to<br/>embeddedOperations]
        Append --> Upload1[Upload manifest.json]
    end

    subgraph SlowPath["📦 OVERFLOW PATH (2 requests)"]
        Flush[Upload embeddedOperations<br/>as overflow_XXX.json]
        Flush --> AddRef[Add file to operationFiles]
        AddRef --> Clear[Put pending ops in<br/>now-empty buffer]
        Clear --> Upload2[Upload manifest.json]
    end

    Upload1 --> CheckSnap
    Upload2 --> CheckSnap

    CheckSnap{Files > 50 OR<br/>Ops > 5000?}
    CheckSnap -->|Yes| Compact[Trigger Compaction]
    CheckSnap -->|No| Done([Done])
    Compact --> Done

    style FastPath fill:#c8e6c9,stroke:#2e7d32,stroke-width:2px
    style SlowPath fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style Start fill:#fff,stroke:#333
    style Done fill:#fff,stroke:#333
```

### 6.4 Read Path: Reconstructing State

```mermaid
flowchart TD
    Start([Client checks for updates]) --> Download[Download manifest.json]

    Download --> QuickCheck{frontierClock<br/>changed?}
    QuickCheck -->|No| Done([No changes - done])

    QuickCheck -->|Yes| NeedSnap{Local behind<br/>snapshot?}

    NeedSnap -->|Yes| LoadSnap
    NeedSnap -->|No| LoadFiles

    subgraph LoadSnap["🧊 Load Snapshot (fresh install / behind)"]
        DownSnap[Download snapshot file]
        DownSnap --> ApplySnap[Apply as base state]
    end

    ApplySnap --> LoadFiles

    subgraph LoadFiles["📁 Load Operation Files"]
        FilterFiles[Filter to unseen files only]
        FilterFiles --> DownFiles[Download each file]
        DownFiles --> CollectOps[Collect all operations]
    end

    CollectOps --> LoadEmbed

    subgraph LoadEmbed["⚡ Load Embedded Ops"]
        FilterEmbed[Filter by op.id<br/>skip already-applied]
        FilterEmbed --> AddOps[Add to collected ops]
    end

    AddOps --> Apply

    subgraph Apply["✅ Apply All"]
        Sort[Sort by vectorClock]
        Sort --> Detect[Detect conflicts]
        Detect --> ApplyOps[Apply non-conflicting]
    end

    ApplyOps --> UpdateClock[Update local<br/>lastSyncedClock]
    UpdateClock --> Done2([Done])

    style LoadSnap fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style LoadFiles fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style LoadEmbed fill:#c8e6c9,stroke:#2e7d32,stroke-width:2px
    style Apply fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
```

### 6.5 Compaction: Freezing State

```mermaid
flowchart TD
    Trigger{{"Trigger Conditions"}}
    Trigger --> C1["operationFiles > 50"]
    Trigger --> C2["Total ops > 5000"]
    Trigger --> C3["7+ days since snapshot"]

    C1 --> Start
    C2 --> Start
    C3 --> Start

    Start([Begin Compaction]) --> Sync[Ensure full sync<br/>no pending ops]
    Sync --> Read[Read current state<br/>from NgRx]
    Read --> Generate[Generate snapshot file<br/>+ checksum]
    Generate --> UpSnap[Upload snapshot file]

    UpSnap --> UpdateMan

    subgraph UpdateMan["Update Manifest"]
        SetSnap[Set lastSnapshot →<br/>new file reference]
        SetSnap --> ClearFiles[Clear operationFiles]
        ClearFiles --> ClearBuffer[Clear embeddedOperations]
        ClearBuffer --> ResetClock[Set frontierClock →<br/>snapshot's clock]
    end

    UpdateMan --> UpMan[Upload manifest.json]
    UpMan --> Cleanup[Async: Delete old files<br/>from server]
    Cleanup --> Done([Done])

    style Trigger fill:#ffebee,stroke:#c62828,stroke-width:2px
    style UpdateMan fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
```

---

## 7. Atomic State Consistency (Meta-Reducer Pattern) ✅ IMPLEMENTED

This diagram illustrates how meta-reducers ensure atomic state changes across multiple entities, preventing inconsistency during sync. See Part F in [operation-log-architecture.md](./operation-log-architecture.md).

**Implementation Status:** Complete. Key files:

- `tag-shared.reducer.ts` - Tag deletion with task/repeat-cfg/time-tracking cleanup
- `state-capture.meta-reducer.ts` - Before-state capture for multi-entity operations
- `state-change-capture.service.ts` - Computes entity changes from state diff

### 7.1 Meta-Reducer Flow for Multi-Entity Operations

```mermaid
flowchart TD
    subgraph UserAction["User Action (e.g., Delete Tag)"]
        Action[deleteTag action]
    end

    subgraph MetaReducers["Meta-Reducer Chain (Atomic)"]
        Capture["stateCaptureMetaReducer<br/>━━━━━━━━━━━━━━━<br/>Captures before-state"]
        TagMeta["tagSharedMetaReducer<br/>━━━━━━━━━━━━━━━<br/>• Remove tag from tasks<br/>• Delete orphaned tasks<br/>• Clean TaskRepeatCfgs<br/>• Clean TimeTracking"]
        OtherMeta["Other meta-reducers<br/>━━━━━━━━━━━━━━━<br/>Pass through"]
    end

    subgraph FeatureReducers["Feature Reducers"]
        TagReducer["tag.reducer<br/>━━━━━━━━━━━━━━━<br/>Delete tag entity"]
    end

    subgraph Effects["Effects Layer"]
        OpEffect["OperationLogEffects<br/>━━━━━━━━━━━━━━━<br/>• Compute state diff<br/>• Create single Operation<br/>• with entityChanges[]"]
    end

    subgraph Result["Single Atomic Operation"]
        Op["Operation {<br/>  opType: 'DEL',<br/>  entityType: 'TAG',<br/>  entityChanges: [<br/>    {TAG, delete},<br/>    {TASK, update}x3,<br/>    {TASK_REPEAT_CFG, delete}<br/>  ]<br/>}"]
    end

    Action --> Capture
    Capture --> TagMeta
    TagMeta --> OtherMeta
    OtherMeta --> FeatureReducers
    FeatureReducers --> OpEffect
    OpEffect --> Result

    style UserAction fill:#fff,stroke:#333,stroke-width:2px
    style MetaReducers fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style FeatureReducers fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style Effects fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style Result fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
```

### 7.2 Why Meta-Reducers vs Effects

```mermaid
flowchart LR
    subgraph Problem["❌ Effects Pattern (Non-Atomic)"]
        direction TB
        A1[deleteTag action] --> E1[tag.reducer]
        E1 --> A2[effect: removeTagFromTasks]
        A2 --> E2[task.reducer]
        E2 --> A3[effect: cleanTaskRepeatCfgs]
        A3 --> E3[taskRepeatCfg.reducer]

        Note1["Each action = separate operation<br/>Sync may deliver partially<br/>→ Inconsistent state"]
    end

    subgraph Solution["✅ Meta-Reducer Pattern (Atomic)"]
        direction TB
        B1[deleteTag action] --> M1[tagSharedMetaReducer]
        M1 --> M2["All changes in one pass:<br/>• tasks updated<br/>• repeatCfgs cleaned<br/>• tag deleted"]
        M2 --> R1[Single reduced state]

        Note2["One action = one operation<br/>All changes sync together<br/>→ Consistent state"]
    end

    style Problem fill:#ffebee,stroke:#c62828,stroke-width:2px
    style Solution fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
```

---

## 8. Archive Operations & Side Effects ✅ IMPLEMENTED

This section documents how archive-related side effects are handled, establishing the general rule that **effects should never run for remote operations**.

### 8.1 The General Rule: Effects Only for Local Actions

```mermaid
flowchart TD
    subgraph Rule["🔒 GENERAL RULE"]
        R1["All NgRx effects MUST use LOCAL_ACTIONS"]
        R2["Effects should NEVER run for remote operations"]
        R3["Side effects for remote ops are handled<br/>explicitly by OperationApplierService"]
    end

    subgraph Why["Why This Matters"]
        W1["• Prevents duplicate side effects"]
        W2["• Makes sync behavior predictable"]
        W3["• Side effects happen exactly once<br/>(on originating client)"]
        W4["• Receiving clients only update state"]
    end

    Rule --> Why

    style Rule fill:#e8f5e9,stroke:#2e7d32,stroke-width:3px
    style Why fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
```

### 8.2 Dual-Database Architecture

Super Productivity uses **two separate IndexedDB databases** for persistence:

```mermaid
flowchart TB
    subgraph Browser["Browser IndexedDB"]
        subgraph SUPOPS["SUP_OPS Database (Operation Log)"]
            direction TB
            OpsTable["ops table<br/>━━━━━━━━━━━━━━━<br/>Operation event log<br/>UUIDv7, vectorClock, payload"]
            StateCache["state_cache table<br/>━━━━━━━━━━━━━━━<br/>NgRx state snapshots<br/>for fast hydration"]
        end

        subgraph PFAPI["PFAPI Database (Legacy + Archive)"]
            direction TB
            ArchiveYoung["archiveYoung<br/>━━━━━━━━━━━━━━━<br/>ArchiveModel:<br/>• task: TaskArchive<br/>• timeTracking: State<br/>━━━━━━━━━━━━━━━<br/>Tasks < 21 days old"]
            ArchiveOld["archiveOld<br/>━━━━━━━━━━━━━━━<br/>ArchiveModel:<br/>• task: TaskArchive<br/>• timeTracking: State<br/>━━━━━━━━━━━━━━━<br/>Tasks > 21 days old"]
            MetaModel["META_MODEL<br/>━━━━━━━━━━━━━━━<br/>Vector clocks for<br/>legacy sync providers"]
            OtherModels["Other Models<br/>━━━━━━━━━━━━━━━<br/>globalConfig, etc.<br/>legacy storage"]
        end
    end

    subgraph Writers["What Writes Where"]
        OpLog["OperationLogStoreService"] -->|ops, snapshots| SUPOPS
        Archive["ArchiveService<br/>ArchiveOperationHandler"] -->|"ArchiveModel:<br/>tasks + time tracking"| PFAPI
        Legacy["VectorClockFacadeService"] -->|vector clocks| MetaModel
    end

    style SUPOPS fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style PFAPI fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style Writers fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
```

**Key Points:**

| Database  | Purpose                                           | Written By                                                  |
| --------- | ------------------------------------------------- | ----------------------------------------------------------- |
| `SUP_OPS` | Operation log (event sourcing)                    | `OperationLogStoreService`                                  |
| `PFAPI`   | Archive data, time tracking, legacy sync metadata | `ArchiveService`, `ArchiveOperationHandler`, `PfapiService` |

### 8.3 Archive Operations Flow

Archive data is stored in PFAPI's IndexedDB, **not** in NgRx state or the operation log. This requires special handling through a **unified** `ArchiveOperationHandler`:

- **Local operations**: `ArchiveOperationHandlerEffects` routes through `ArchiveOperationHandler` (using LOCAL_ACTIONS)
- **Remote operations**: `OperationApplierService` calls `ArchiveOperationHandler` directly after dispatch

Both paths use the same handler to ensure consistent behavior.

```mermaid
flowchart TD
    subgraph LocalOp["LOCAL Operation (User Action)"]
        L1[User archives tasks] --> L2["ArchiveService writes<br/>to PFAPI IndexedDB<br/>BEFORE dispatch"]
        L2 --> L3[Dispatch moveToArchive]
        L3 --> L4[Meta-reducers update NgRx state]
        L4 --> L5[ArchiveOperationHandlerEffects<br/>via LOCAL_ACTIONS]
        L5 --> L6["ArchiveOperationHandler<br/>.handleOperation<br/>(skips - already written)"]
        L4 --> L7[OperationLogEffects<br/>creates operation in SUP_OPS]
    end

    subgraph RemoteOp["REMOTE Operation (Sync)"]
        R1[Download operation<br/>from SUP_OPS sync] --> R2[OperationApplierService<br/>dispatches action]
        R2 --> R3[Meta-reducers update NgRx state]
        R3 --> R4["ArchiveOperationHandler<br/>.handleOperation"]
        R4 --> R5["Write to PFAPI IndexedDB<br/>(archiveYoung/archiveOld)"]

        NoEffect["❌ Regular effects DON'T run<br/>(action has meta.isRemote=true)"]
    end

    subgraph Storage["Storage Layer"]
        PFAPI_DB[("PFAPI IndexedDB<br/>archiveYoung<br/>archiveOld")]
        SUPOPS_DB[("SUP_OPS IndexedDB<br/>ops table")]
    end

    L2 --> PFAPI_DB
    L7 --> SUPOPS_DB
    R5 --> PFAPI_DB
    SUPOPS_DB -.->|"Sync downloads ops"| R1

    style LocalOp fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style RemoteOp fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style NoEffect fill:#ffebee,stroke:#c62828,stroke-width:2px
    style PFAPI_DB fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style SUPOPS_DB fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
```

### 8.4 ArchiveOperationHandler Integration

The `OperationApplierService` uses a **fail-fast** approach: if hard dependencies are missing, it throws `SyncStateCorruptedError` rather than attempting complex retry logic. This triggers a full re-sync, which is safer than partial recovery.

```mermaid
flowchart TD
    subgraph OperationApplierService["OperationApplierService (Fail-Fast)"]
        OA1[Receive operation] --> OA2{Check hard<br/>dependencies}
        OA2 -->|Missing| OA_ERR["throw SyncStateCorruptedError<br/>(triggers full re-sync)"]
        OA2 -->|OK| OA3[convertOpToAction]
        OA3 --> OA4["store.dispatch(action)<br/>with meta.isRemote=true"]
        OA4 --> OA5["archiveOperationHandler<br/>.handleOperation(action)"]
    end

    subgraph Handler["ArchiveOperationHandler"]
        H1{Action Type?}
        H1 -->|moveToArchive| H2[Write tasks to<br/>archiveYoung<br/>REMOTE ONLY]
        H1 -->|restoreTask| H3[Delete task from<br/>archive]
        H1 -->|flushYoungToOld| H4[Move old tasks<br/>Young → Old]
        H1 -->|deleteProject| H5[Remove tasks<br/>for project +<br/>cleanup time tracking]
        H1 -->|deleteTag/deleteTags| H6[Remove tag<br/>from tasks +<br/>cleanup time tracking]
        H1 -->|deleteTaskRepeatCfg| H7[Remove repeatCfgId<br/>from tasks]
        H1 -->|deleteIssueProvider| H8[Unlink issue data<br/>from tasks]
        H1 -->|deleteIssueProviders| H8b[Unlink multiple<br/>issue providers]
        H1 -->|other| H9[No-op]
    end

    OA5 --> H1

    style OperationApplierService fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style Handler fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style OA_ERR fill:#ffcdd2,stroke:#c62828,stroke-width:2px
```

**Why Fail-Fast?**

The server guarantees operations arrive in sequence order, and delete operations are atomic via meta-reducers. If dependencies are missing, something is fundamentally wrong with sync state. A full re-sync is safer than attempting partial recovery with potential inconsistencies.

### 8.5 Archive Operations Summary

| Operation              | Local Handling                                                         | Remote Handling                                              |
| ---------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| `moveToArchive`        | ArchiveService writes BEFORE dispatch; handler skips (no double-write) | ArchiveOperationHandler writes AFTER dispatch                |
| `restoreTask`          | ArchiveOperationHandlerEffects → ArchiveOperationHandler               | ArchiveOperationHandler removes from archive                 |
| `flushYoungToOld`      | ArchiveOperationHandlerEffects → ArchiveOperationHandler               | ArchiveOperationHandler executes flush                       |
| `deleteProject`        | ArchiveOperationHandlerEffects → ArchiveOperationHandler               | ArchiveOperationHandler removes tasks + cleans time tracking |
| `deleteTag/deleteTags` | ArchiveOperationHandlerEffects → ArchiveOperationHandler               | ArchiveOperationHandler removes tags + cleans time tracking  |
| `deleteTaskRepeatCfg`  | ArchiveOperationHandlerEffects → ArchiveOperationHandler               | ArchiveOperationHandler removes repeatCfgId from tasks       |
| `deleteIssueProvider`  | ArchiveOperationHandlerEffects → ArchiveOperationHandler               | ArchiveOperationHandler unlinks issue data                   |

### 8.6 Key Files

| File                                              | Purpose                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| `processing/archive-operation-handler.service.ts` | **Unified** handler for all archive side effects (local AND remote) |
| `processing/archive-operation-handler.effects.ts` | Routes local actions to ArchiveOperationHandler via LOCAL_ACTIONS   |
| `processing/operation-applier.service.ts`         | Calls ArchiveOperationHandler after dispatching remote operations   |
| `features/time-tracking/archive.service.ts`       | Local archive write logic (moveToArchive writes BEFORE dispatch)    |
| `features/time-tracking/task-archive.service.ts`  | Archive CRUD operations                                             |
