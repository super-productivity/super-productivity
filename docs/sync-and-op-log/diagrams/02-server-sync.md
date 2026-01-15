# Server Sync Architecture (SuperSync)

**Last Updated:** January 2026
**Status:** Implemented

This diagram shows the complete sync architecture for SuperSync: client-side flow, server API endpoints, PostgreSQL database operations, and server-side processing.

## Master Architecture Diagram

```mermaid
graph TB
    %% Styles
    classDef client fill:#fff,stroke:#333,stroke-width:2px,color:black;
    classDef api fill:#e3f2fd,stroke:#1565c0,stroke-width:2px,color:black;
    classDef db fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px,color:black;
    classDef conflict fill:#ffebee,stroke:#c62828,stroke-width:2px,color:black;
    classDef validation fill:#fff3e0,stroke:#ef6c00,stroke-width:2px,color:black;

    %% CLIENT SIDE
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

    %% SERVER API LAYER
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

    %% POSTGRESQL DATABASE
    subgraph PostgreSQL["POSTGRESQL DATABASE"]
        direction TB

        OpsTable[("operations<br/>━━━━━━━━━━━━━━━<br/>id, serverSeq<br/>opType, entityType<br/>entityId, payload<br/>vectorClock<br/>clientTimestamp")]:::db

        SyncState[("user_sync_state<br/>━━━━━━━━━━━━━━━<br/>lastSeq<br/>snapshotData<br/>lastSnapshotSeq")]:::db

        Devices[("sync_devices<br/>━━━━━━━━━━━━━━━<br/>clientId<br/>lastSeenAt<br/>lastAckedSeq")]:::db

        Tombstones[("tombstones<br/>━━━━━━━━━━━━━━━<br/>entityType<br/>entityId<br/>deletedAt")]:::db
    end

    %% CONNECTIONS: API -> Processing
    OpsAPI --> V1
    SnapshotAPI --> V1
    V1 --> V2 --> V3 --> V4 --> V5
    V5 --> C1 --> C2 --> C3
    C4 --> P1 --> P2 --> P3 --> P4
    P5 --> P7
    P6 --> P7

    %% CONNECTIONS: Processing -> Database
    P1 -.->|"UPDATE"| SyncState
    P3 -.->|"INSERT"| OpsTable
    P5 -.->|"UPSERT"| Tombstones
    P7 -.->|"UPSERT"| Devices

    %% CONNECTIONS: Read endpoints -> Database
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

## Quick Reference Tables

### API Endpoints

| Endpoint                   | Method | Purpose                         | DB Operations                                                        |
| -------------------------- | ------ | ------------------------------- | -------------------------------------------------------------------- |
| `/api/sync/ops`            | POST   | Upload operations               | INSERT ops, UPDATE lastSeq, UPSERT device, UPSERT tombstone (if DEL) |
| `/api/sync/ops?sinceSeq=N` | GET    | Download operations             | SELECT ops, SELECT lastSeq, find latest snapshot (skip optimization) |
| `/api/sync/snapshot`       | POST   | Upload full state (SYNC_IMPORT) | Same as POST /ops + UPDATE snapshot cache                            |
| `/api/sync/snapshot`       | GET    | Get full state                  | SELECT snapshot (or replay ops if stale)                             |
| `/api/sync/status`         | GET    | Check sync status               | SELECT lastSeq, COUNT devices                                        |
| `/api/sync/restore-points` | GET    | List restore points             | SELECT ops (filter SYNC_IMPORT, BACKUP_IMPORT, REPAIR)               |
| `/api/sync/restore/:seq`   | GET    | Restore to specific point       | SELECT ops, replay to targetSeq                                      |

### PostgreSQL Tables

| Table             | Purpose                                    | Key Columns                                             |
| ----------------- | ------------------------------------------ | ------------------------------------------------------- |
| `operations`      | Event log (append-only)                    | id, serverSeq, opType, entityType, payload, vectorClock |
| `user_sync_state` | Per-user metadata + cached snapshot        | lastSeq, snapshotData, lastSnapshotSeq                  |
| `sync_devices`    | Device tracking                            | clientId, lastSeenAt, lastAckedSeq                      |
| `tombstones`      | Deleted entity tracking (30-day retention) | entityType, entityId, deletedAt, expiresAt              |

### Key Implementation Details

- **Transaction Isolation**: `REPEATABLE_READ` prevents phantom reads during conflict detection
- **Double Conflict Check**: Before AND after sequence allocation (race condition guard)
- **Idempotency**: Duplicate op IDs rejected with `DUPLICATE_OPERATION` error
- **Gzip Support**: Both upload/download support `Content-Encoding: gzip` for bandwidth savings
- **Rate Limiting**: Per-user limits (100 uploads/min, 200 downloads/min)
- **Auto-Resolve Conflicts (Identical)**: Identical conflicts (both DELETE, or same payload) auto-resolved as "remote" without user intervention
- **LWW Conflict Resolution**: Real conflicts are automatically resolved using Last-Write-Wins (timestamp comparison)
- **Fresh Client Safety**: Clients with no history blocked from uploading; confirmation dialog shown before accepting first remote data
- **Piggybacked Ops**: Upload response includes new remote ops → processed immediately to trigger conflict detection
- **Gap Detection**: Server returns `gapDetected: true` when client sinceSeq is invalid → client resets to seq=0 and re-downloads all ops
- **Server Migration**: Gap + empty server (no ops) → client creates SYNC_IMPORT to seed new server
- **Snapshot Skip Optimization**: Server skips pre-snapshot operations when `sinceSeq < latestSnapshotSeq`

## Full-State Operations via Snapshot Endpoint

Full-state operations (BackupImport, Repair, SyncImport) contain the entire application state and can exceed the regular `/api/sync/ops` body size limit (~30MB). These operations are routed through the `/api/sync/snapshot` endpoint instead.

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

## Gap Detection

Gap detection identifies situations where the client cannot reliably sync incrementally and must take corrective action.

### The Four Gap Cases

| Case | Condition                         | Meaning                             | Typical Cause                          |
| ---- | --------------------------------- | ----------------------------------- | -------------------------------------- |
| 1    | `sinceSeq > 0 && latestSeq === 0` | Client has history, server is empty | Server was reset/migrated              |
| 2    | `sinceSeq > latestSeq`            | Client is ahead of server           | Server DB restored from old backup     |
| 3    | `sinceSeq < minSeq - 1`           | Requested ops were purged           | Retention policy deleted old ops       |
| 4    | `firstOpSeq > sinceSeq + 1`       | Gap in sequence numbers             | Database corruption or manual deletion |

### Client-Side Handling

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

## Key Files

| File                                                    | Purpose                         |
| ------------------------------------------------------- | ------------------------------- |
| `src/app/op-log/sync/operation-log-sync.service.ts`     | Main sync orchestration         |
| `src/app/op-log/sync/operation-log-upload.service.ts`   | Upload logic                    |
| `src/app/op-log/sync/operation-log-download.service.ts` | Download logic                  |
| `src/app/op-log/sync/conflict-resolution.service.ts`    | LWW conflict resolution         |
| `src/app/op-log/sync/server-migration.service.ts`       | Server migration (empty server) |
| `packages/super-sync-server/src/sync/`                  | Server-side sync implementation |
