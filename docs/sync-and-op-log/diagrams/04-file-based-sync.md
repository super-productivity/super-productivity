# File-Based Sync Architecture

**Last Updated:** January 2026
**Status:** Implemented

This document contains diagrams explaining the unified operation-log sync architecture for file-based providers (WebDAV, Dropbox, LocalFile).

## Overview

File-based sync uses a single `sync-data.json` file that contains:

- Full application state snapshot
- Recent operations buffer (last 200 ops)
- Vector clock for conflict detection
- Archive data for late-joining clients

```mermaid
flowchart TB
    subgraph Remote["Remote Storage (WebDAV/Dropbox/LocalFile)"]
        subgraph Folder["/superProductivity/"]
            SyncFile["sync-data.json<br/>━━━━━━━━━━━━━━━━━━━<br/>Encrypted + Compressed"]
        end
    end

    subgraph Contents["sync-data.json Contents"]
        direction TB
        Meta["📋 Metadata<br/>• version: 2<br/>• syncVersion: N (locking)<br/>• schemaVersion<br/>• lastModified<br/>• clientId<br/>• checksum"]

        VClock["🕐 Vector Clock<br/>• {clientA: 42, clientB: 17}<br/>• Tracks causality"]

        State["📦 State Snapshot<br/>━━━━━━━━━━━━━━━━━━━<br/>• tasks: TaskState<br/>• projects: ProjectState<br/>• tags: TagState<br/>• notes: NoteState<br/>• globalConfig<br/>• issueProviders<br/>• planner<br/>• simpleCounters<br/>• taskRepeatCfg"]

        Archive["📁 Archive Data<br/>━━━━━━━━━━━━━━━━━━━<br/>• archiveYoung: ArchiveModel<br/>• archiveOld: ArchiveModel<br/>━━━━━━━━━━━━━━━━━━━<br/>Ensures late-joiners get<br/>full archive history"]

        Ops["📝 Recent Operations (last 200)<br/>━━━━━━━━━━━━━━━━━━━<br/>• id, clientId, actionType<br/>• opType, entityType, entityId<br/>• payload, vectorClock<br/>• timestamp<br/>━━━━━━━━━━━━━━━━━━━<br/>Used for conflict detection"]
    end

    SyncFile --> Contents

    style SyncFile fill:#fff3e0,stroke:#e65100,stroke-width:2px
    style State fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style Archive fill:#fce4ec,stroke:#c2185b,stroke-width:2px
    style Ops fill:#e1f5fe,stroke:#01579b,stroke-width:2px
```

### Why Single File Instead of Separate Snapshot + Ops Files?

| Single File (chosen)        | Two Files (considered)      |
| --------------------------- | --------------------------- |
| Atomic: all or nothing      | Partial upload risk         |
| One version to track        | Version coordination        |
| Simple conflict resolution  | Two places to handle        |
| Easy recovery               | Inconsistent state possible |
| Upload full state each time | Often just ops              |

The bandwidth cost is acceptable: state compresses well (~90%), and sync is infrequent.

## Architecture Overview

Shows how `FileBasedSyncAdapter` integrates into the existing op-log system, implementing `OperationSyncCapable` using file operations.

```mermaid
flowchart TB
    subgraph Client["Client Application"]
        NgRx["NgRx Store<br/>(Runtime State)"]
        OpLogEffects["OperationLogEffects"]
        OpLogStore["SUP_OPS IndexedDB<br/>(ops + state_cache)"]

        subgraph SyncServices["Sync Services"]
            SyncService["OperationLogSyncService"]
            ConflictRes["ConflictResolutionService"]
            VectorClock["VectorClockService"]
        end

        subgraph ProviderLayer["Provider Abstraction"]
            FileAdapter["FileBasedSyncAdapter<br/>(implements OperationSyncCapable)"]
            SuperSync["SuperSyncProvider<br/>(existing API-based)"]

            subgraph FileProviders["File Providers"]
                WebDAV["WebDAV"]
                Dropbox["Dropbox"]
                LocalFile["LocalFile"]
            end
        end
    end

    subgraph RemoteStorage["Remote Storage"]
        SyncFile["sync-data.json<br/>━━━━━━━━━━━━━━━<br/>• syncVersion<br/>• state snapshot<br/>• recentOps (200)<br/>• vectorClock"]
    end

    NgRx --> OpLogEffects
    OpLogEffects --> OpLogStore
    OpLogStore --> SyncService
    SyncService --> ConflictRes
    SyncService --> VectorClock

    SyncService --> FileAdapter
    SyncService --> SuperSync

    FileAdapter --> WebDAV
    FileAdapter --> Dropbox
    FileAdapter --> LocalFile

    WebDAV --> SyncFile
    Dropbox --> SyncFile
    LocalFile --> SyncFile

    style FileAdapter fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    style SyncFile fill:#fff3e0,stroke:#e65100,stroke-width:2px
    style OpLogStore fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
```

## TypeScript Types

```mermaid
classDiagram
    class FileBasedSyncData {
        +number version = 2
        +number syncVersion
        +number schemaVersion
        +VectorClock vectorClock
        +number lastModified
        +string clientId
        +AppDataComplete state
        +ArchiveModel archiveYoung
        +ArchiveModel archiveOld
        +CompactOperation[] recentOps
        +string checksum
    }

    class AppDataComplete {
        +TaskState task
        +ProjectState project
        +TagState tag
        +GlobalConfigState globalConfig
        +NoteState note
        +IssueProviderState issueProvider
        +PlannerState planner
        +SimpleCounterState simpleCounter
        +TaskRepeatCfgState taskRepeatCfg
    }

    class ArchiveModel {
        +TaskArchive task
        +TimeTrackingState timeTracking
        +number lastTimeTrackingFlush
    }

    class CompactOperation {
        +string id
        +string clientId
        +string actionType
        +OpType opType
        +EntityType entityType
        +string entityId
        +unknown payload
        +VectorClock vectorClock
        +number timestamp
    }

    class VectorClock {
        +Record~string, number~ clocks
    }

    FileBasedSyncData --> AppDataComplete : state
    FileBasedSyncData --> ArchiveModel : archiveYoung?
    FileBasedSyncData --> ArchiveModel : archiveOld?
    FileBasedSyncData --> CompactOperation : recentOps[0..200]
    FileBasedSyncData --> VectorClock : vectorClock
    CompactOperation --> VectorClock : vectorClock
```

## Sync Flow (Content-Based Optimistic Locking with Piggybacking)

```mermaid
sequenceDiagram
    participant Client as Client App
    participant Adapter as FileBasedSyncAdapter
    participant Provider as File Provider
    participant Remote as sync-data.json

    Note over Client,Remote: ═══ DOWNLOAD FLOW ═══

    Client->>Adapter: downloadOps(sinceSeq, clientId)
    Adapter->>Provider: downloadFile("sync-data.json")
    Provider->>Remote: GET
    Remote-->>Provider: {data, rev}
    Provider-->>Adapter: SyncData (syncVersion=N)

    Adapter->>Adapter: Update _expectedSyncVersion = N
    Adapter->>Adapter: Filter ops by sinceSeq
    Adapter-->>Client: OpDownloadResponse

    Client->>Client: Apply remote ops to NgRx
    Client->>Client: setLastServerSeq(latestSeq)

    Note over Client,Remote: ═══ UPLOAD FLOW (with Piggybacking) ═══

    Client->>Adapter: uploadOps(ops, clientId, lastKnownSeq)
    Adapter->>Provider: downloadFile("sync-data.json")
    Provider->>Remote: GET
    Remote-->>Provider: {data, rev}
    Provider-->>Adapter: Current syncVersion=M

    alt syncVersion matches expected (M=N)
        Note over Adapter: No other client synced
    else syncVersion changed (M>N)
        Note over Adapter: Another client synced!<br/>Will piggyback their ops
    end

    Adapter->>Adapter: Merge local ops into recentOps
    Adapter->>Adapter: Update vectorClock
    Adapter->>Adapter: Trim recentOps to 200
    Adapter->>Adapter: Set syncVersion = M+1
    Adapter->>Adapter: Find piggybacked ops<br/>(ops from other clients we haven't seen)

    Adapter->>Provider: uploadFile("sync-data.json", newData)
    Provider->>Remote: PUT
    Remote-->>Provider: Success

    Adapter-->>Client: Success + piggybacked ops (newOps)

    alt Has piggybacked ops
        Client->>Client: Process piggybacked ops
        Client->>Client: setLastServerSeq(latestSeq)
    end
```

### Key Insight: Piggybacking

Instead of throwing an error on version mismatch, the adapter:

1. Merges local ops with whatever is in the file
2. Returns ops from other clients as `newOps` (piggybacked)
3. The upload service processes these before updating `lastServerSeq`

This ensures no ops are missed, even when clients sync concurrently.

## Conflict Resolution (Two Clients Syncing Simultaneously)

```mermaid
sequenceDiagram
    participant A as Client A
    participant B as Client B
    participant File as sync-data.json<br/>(syncVersion: 5)

    Note over A,File: Initial: syncVersion=5, both clients synced

    rect rgb(232, 245, 233)
        Note over A,B: Both make offline changes
        A->>A: Create Task X
        A->>A: expectedSyncVersion = 5
        B->>B: Update Task Y
        B->>B: expectedSyncVersion = 5
    end

    Note over A,File: Race condition begins

    A->>File: Upload starts (downloads file, sees v=5)
    B->>File: Upload starts (downloads file, sees v=5)

    A->>A: Merge ops [TaskX], set syncVersion=6
    A->>File: Upload sync-data.json (v=6)
    Note over A,File: A wins the race ✓
    File-->>A: Success
    A->>A: expectedSyncVersion = 6

    B->>B: Merge ops [TaskY]
    Note over B: Downloads file again for upload...
    B->>File: Download (sees syncVersion=6!)
    Note over B,File: Version changed!<br/>Expected 5, found 6

    rect rgb(225, 245, 254)
        Note over B: Piggybacking (not retry!)
        B->>B: Find piggybacked ops from file<br/>(A's TaskX op, seq > lastProcessedSeq)
        B->>B: Merge [TaskX, TaskY] into recentOps
        B->>B: Set syncVersion = 7
        B->>File: Upload sync-data.json (v=7)
        File-->>B: Success ✓

        B->>B: Return piggybacked=[TaskX]
        B->>B: Process TaskX op → apply to NgRx
        B->>B: setLastServerSeq(latestSeq)
    end

    Note over A,File: A syncs B's TaskY on next sync
    A->>File: Download (sinceSeq=6)
    File-->>A: ops=[TaskY]
    A->>A: Apply TaskY → both clients have both tasks
```

### How Piggybacking Resolves Conflicts

| Step                         | What Happens                                                |
| ---------------------------- | ----------------------------------------------------------- |
| 1. Version mismatch detected | B expected v=5, found v=6                                   |
| 2. No retry needed           | B proceeds with merge anyway                                |
| 3. Find piggybacked ops      | Ops in file with seq > lastProcessedSeq, from other clients |
| 4. Merge and upload          | B's ops + file's ops → new file                             |
| 5. Return piggybacked        | Upload response includes A's ops                            |
| 6. Process piggybacked       | Upload service applies them before advancing lastServerSeq  |

**LWW (Last-Write-Wins) for Same Entity:**

If both A and B modified the same task, the piggybacked ops flow through `ConflictResolutionService` which uses vector clocks and timestamps to determine the winner.

## First-Sync Conflict Handling

When a client with local data syncs for the first time to a remote that already has data, a conflict dialog is shown:

```mermaid
flowchart TD
    Start[First sync attempt] --> Download[Download sync-data.json]
    Download --> HasLocal{Has local data?}
    HasLocal -->|No| Apply[Apply remote state]
    HasLocal -->|Yes| HasRemote{Remote has data?}
    HasRemote -->|No| Upload[Upload local state]
    HasRemote -->|Yes| Dialog[Show conflict dialog]

    Dialog --> UseLocal[User chooses: Use Local]
    Dialog --> UseRemote[User chooses: Use Remote]

    UseLocal --> CreateImport[Create SYNC_IMPORT<br/>with local state]
    CreateImport --> UploadImport[Upload to remote]

    UseRemote --> ApplyRemote[Apply remote state<br/>Discard local]

    style Dialog fill:#fff3e0,stroke:#e65100,stroke-width:2px
```

## Master Architecture Diagram

```mermaid
graph TB
    %% Styles
    classDef client fill:#fff,stroke:#333,stroke-width:2px,color:black;
    classDef provider fill:#e3f2fd,stroke:#1565c0,stroke-width:2px,color:black;
    classDef storage fill:#fff3e0,stroke:#e65100,stroke-width:2px,color:black;
    classDef conflict fill:#ffebee,stroke:#c62828,stroke-width:2px,color:black;
    classDef success fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px,color:black;

    %% CLIENT SIDE
    subgraph Client["CLIENT (Angular)"]
        direction TB

        subgraph SyncLoop["Sync Loop"]
            Scheduler((Scheduler)) -->|Interval| SyncService["OperationLogSyncService"]
            SyncService -->|1. Get lastSeq| LocalMeta["SUP_OPS IndexedDB"]
        end

        subgraph DownloadFlow["Download Flow"]
            SyncService -->|"2. downloadOps(sinceSeq)"| Adapter
            Adapter -->|Response| VersionCheck{syncVersion<br/>Changed?}
            VersionCheck -- "Yes (reset)" --> GapDetect{Gap Detected?}
            VersionCheck -- "No change" --> FilterOps
            GapDetect -- "Yes + No Ops" --> SnapshotCheck{Has Snapshot<br/>State?}
            GapDetect -- "Yes + Has Ops" --> FilterOps
            SnapshotCheck -- Yes --> LocalDataCheck{Has Local<br/>Unsynced Ops?}
            SnapshotCheck -- No --> FilterOps
            LocalDataCheck -- Yes --> ConflictDialog["Show Conflict Dialog"]:::conflict
            LocalDataCheck -- No --> FreshCheck{Fresh Client?}
            FreshCheck -- Yes --> ConfirmDialog["Confirmation Dialog"]
            FreshCheck -- No --> HydrateSnapshot["Hydrate from Snapshot"]:::success
            ConfirmDialog -- Confirmed --> HydrateSnapshot
            ConfirmDialog -- Cancelled --> SkipSync[Skip]
            ConflictDialog -- "Use Local" --> CreateSyncImport["Create SYNC_IMPORT"]
            ConflictDialog -- "Use Remote" --> HydrateSnapshot
            FilterOps["Filter ops by sinceSeq"]
        end

        subgraph ConflictMgmt["Conflict Management (LWW Auto-Resolution)"]
            FilterOps --> ConflictDet{{"Compare<br/>Vector Clocks"}}:::conflict
            ConflictDet -- Sequential --> ApplyRemote
            ConflictDet -- Concurrent --> LWWCheck{{"LWW: Compare<br/>Timestamps"}}:::conflict

            LWWCheck -- "Remote newer<br/>or tie" --> MarkRejected["Mark Local Rejected"]:::conflict
            LWWCheck -- "Local newer" --> LocalWins["Create Update Op<br/>with local state"]:::conflict
            LocalWins --> RejectBoth["Mark both rejected"]
            RejectBoth --> CreateNewOp["New op syncs to remote"]
            MarkRejected --> ApplyRemote
        end

        subgraph Application["Application & Validation"]
            ApplyRemote -->|Dispatch| NgRx["NgRx Store"]
            HydrateSnapshot -->|"Hydrate full state"| NgRx
            NgRx --> UpdateSeq["setLastServerSeq()"]
            UpdateSeq --> SyncDone((Done))
        end

        subgraph UploadFlow["Upload Flow"]
            LocalMeta -->|Get Unsynced| PendingOps["Pending Ops"]
            PendingOps --> ClassifyOp{Op Type?}

            ClassifyOp -- "SYNC_IMPORT<br/>BACKUP_IMPORT" --> UploadSnapshot["Upload as Snapshot<br/>(full state in file)"]
            ClassifyOp -- "CRT/UPD/DEL" --> MergeOps["Merge into recentOps"]

            MergeOps --> BuildState["Build state snapshot<br/>from NgRx"]
            BuildState --> IncrVersion["syncVersion++"]
            IncrVersion --> UploadFile["Upload sync-data.json"]
            UploadSnapshot --> UploadFile

            UploadFile --> CheckPiggyback{Piggybacked<br/>Ops Found?}
            CheckPiggyback -- Yes --> ProcessPiggyback["Process Piggybacked Ops<br/>(→ Conflict Detection)"]
            ProcessPiggyback --> ConflictDet
            CheckPiggyback -- No --> MarkSynced["Mark Ops Synced"]:::success
        end
    end

    %% FILE PROVIDER LAYER
    subgraph ProviderLayer["FILE PROVIDER LAYER"]
        direction TB

        subgraph Adapter["FileBasedSyncAdapter"]
            DownloadOp["downloadOps()<br/>━━━━━━━━━━━━━━━<br/>• Download file<br/>• Filter by sinceSeq<br/>• Detect version changes<br/>• Return snapshotState if gap"]:::provider
            UploadOp["uploadOps()<br/>━━━━━━━━━━━━━━━<br/>• Download current file<br/>• Merge ops + state<br/>• Increment syncVersion<br/>• Upload merged file<br/>• Return piggybacked ops"]:::provider
            SeqTracking["Sequence Tracking<br/>━━━━━━━━━━━━━━━<br/>• _expectedSyncVersions<br/>• _localSeqCounters<br/>• _syncDataCache"]:::provider
        end

        subgraph Providers["File Providers"]
            WebDAV["WebDAV<br/>━━━━━━━━━━━━<br/>downloadFile()<br/>uploadFile()"]:::provider
            Dropbox["Dropbox<br/>━━━━━━━━━━━━<br/>downloadFile()<br/>uploadFile()"]:::provider
            LocalFile["LocalFile<br/>━━━━━━━━━━━━<br/>downloadFile()<br/>uploadFile()"]:::provider
        end
    end

    %% REMOTE STORAGE
    subgraph Remote["REMOTE STORAGE"]
        direction TB

        SyncFile[("sync-data.json<br/>━━━━━━━━━━━━━━━━━━━<br/>📋 version: 2<br/>📋 syncVersion: N<br/>📋 clientId<br/>━━━━━━━━━━━━━━━━━━━<br/>🕐 vectorClock<br/>━━━━━━━━━━━━━━━━━━━<br/>📦 state (full snapshot)<br/>━━━━━━━━━━━━━━━━━━━<br/>📁 archiveYoung<br/>📁 archiveOld<br/>━━━━━━━━━━━━━━━━━━━<br/>📝 recentOps[0..200]")]:::storage
    end

    %% CONNECTIONS
    Adapter --> WebDAV
    Adapter --> Dropbox
    Adapter --> LocalFile

    WebDAV --> SyncFile
    Dropbox --> SyncFile
    LocalFile --> SyncFile

    CreateSyncImport --> UploadSnapshot

    %% Subgraph styles
    style DownloadFlow fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style ConflictMgmt fill:#ffebee,stroke:#c62828,stroke-width:2px
    style UploadFlow fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style Application fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    style ProviderLayer fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style Remote fill:#fff3e0,stroke:#e65100,stroke-width:2px
```

## Quick Reference Tables

### File Operations

| Operation | Method               | Purpose              | Key Steps                                                                          |
| --------- | -------------------- | -------------------- | ---------------------------------------------------------------------------------- |
| Download  | `downloadOps()`      | Get remote changes   | Download file → Filter by sinceSeq → Detect gaps → Return ops or snapshot          |
| Upload    | `uploadOps()`        | Push local changes   | Download current → Merge ops → Increment syncVersion → Upload → Return piggybacked |
| Get Seq   | `getLastServerSeq()` | Get processed seq    | Read from `_localSeqCounters` map                                                  |
| Set Seq   | `setLastServerSeq()` | Update processed seq | Write to `_localSeqCounters` + persist                                             |

### sync-data.json Structure

| Field           | Type                 | Purpose                                              |
| --------------- | -------------------- | ---------------------------------------------------- |
| `version`       | `2`                  | File format version                                  |
| `syncVersion`   | `number`             | Content-based lock counter (incremented each upload) |
| `schemaVersion` | `number`             | App data schema version (for migrations)             |
| `clientId`      | `string`             | Last client to modify file                           |
| `lastModified`  | `number`             | Timestamp of last modification                       |
| `vectorClock`   | `VectorClock`        | Causal ordering of all operations                    |
| `state`         | `AppDataComplete`    | Full application state snapshot                      |
| `archiveYoung`  | `ArchiveModel?`      | Tasks archived < 21 days                             |
| `archiveOld`    | `ArchiveModel?`      | Tasks archived > 21 days                             |
| `recentOps`     | `CompactOperation[]` | Last 200 operations (for conflict detection)         |
| `checksum`      | `string?`            | SHA-256 of uncompressed state                        |

### Key Implementation Details

| Feature                 | Implementation                                                               |
| ----------------------- | ---------------------------------------------------------------------------- |
| **Optimistic Locking**  | `syncVersion` counter - no server ETags needed                               |
| **Gap Detection**       | syncVersion reset or snapshot replacement triggers re-download from seq=0    |
| **Piggybacking**        | On upload, ops from other clients (seq > lastProcessed) returned as `newOps` |
| **First-Sync Conflict** | Local unsynced ops + remote snapshot → show conflict dialog                  |
| **Fresh Client Safety** | Confirmation dialog before accepting first remote data                       |
| **LWW Conflicts**       | Concurrent vector clocks → compare timestamps → later wins                   |
| **Snapshot Bootstrap**  | Gap detected + has snapshot → hydrate full state (skip ops)                  |
| **Cache Optimization**  | Downloaded sync data cached to avoid redundant download before upload        |
| **Archive Sync**        | Archive data embedded in file; `ArchiveOperationHandler` writes to IndexedDB |

## Key Points

1. **Single Sync File**: All data in `sync-data.json` - state snapshot + recent ops + vector clock
2. **Content-Based Versioning**: `syncVersion` counter detects conflicts without server ETags
3. **Piggybacking on Upload**: Version mismatch doesn't throw - ops from other clients are returned as `newOps`
4. **Sequence Counter Separation**:
   - `_expectedSyncVersions`: Tracks file's syncVersion (for version mismatch detection)
   - `_localSeqCounters`: Tracks ops we've processed (updated via `setLastServerSeq`)
5. **Archive via Op-Log**: Archive operations sync; `ArchiveOperationHandler` writes data
6. **Deterministic Replay**: Same operation + same timestamp = same result everywhere

## Implementation Files

| File                                                                               | Purpose                        |
| ---------------------------------------------------------------------------------- | ------------------------------ |
| `src/app/op-log/sync-providers/file-based/file-based-sync-adapter.service.ts`      | Main adapter (~800 LOC)        |
| `src/app/op-log/sync-providers/file-based/file-based-sync.types.ts`                | TypeScript types and constants |
| `src/app/op-log/sync-providers/file-based/file-based-sync-adapter.service.spec.ts` | Unit tests                     |
