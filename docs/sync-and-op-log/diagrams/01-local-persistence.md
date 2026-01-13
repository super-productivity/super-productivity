# Local Persistence Architecture

**Last Updated:** January 2026
**Status:** Implemented

This diagram illustrates how user actions flow through the system, how they are persisted to IndexedDB (`SUP_OPS`), and how the system hydrates on startup.

## Operation Log Architecture

```mermaid
graph TD
    %% Styles
    classDef storage fill:#f9f,stroke:#333,stroke-width:2px,color:black;
    classDef process fill:#e1f5fe,stroke:#0277bd,stroke-width:2px,color:black;
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

    subgraph "Archive Storage (IndexedDB)"
        ArchiveWrite["ArchiveService<br/><sub>time-tracking/archive.service.ts</sub>"]:::archive
        ArchiveWrite -->|Write BEFORE dispatch| ArchiveYoung["archiveYoung<br/>━━━━━━━━━━━━━━━<br/>• task: TaskArchive<br/>• timeTracking: State<br/>━━━━━━━━━━━━━━━<br/><sub>Tasks < 21 days old</sub>"]:::archive
        ArchiveYoung -->|"flushYoungToOld action<br/>(every ~14 days)"| ArchiveOld["archiveOld<br/>━━━━━━━━━━━━━━━<br/>• task: TaskArchive<br/>• timeTracking: State<br/>━━━━━━━━━━━━━━━<br/><sub>Tasks > 21 days old</sub>"]:::archive
    end

    User -->|Archive Tasks| ArchiveWrite
    NgRx -.->|moveToArchive action<br/>AFTER archive write| OpEffects

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
    class ArchiveWrite,ArchiveYoung,ArchiveOld,TimeTracking archive;
```

## Archive Data Flow Notes

- **Archive writes happen BEFORE dispatch**: When a user archives tasks, `ArchiveService` writes to IndexedDB first, then dispatches the `moveToArchive` action. This ensures data is safely stored before state updates.
- **ArchiveModel structure**: Each archive tier stores `{ task: TaskArchive, timeTracking: TimeTrackingState, lastTimeTrackingFlush: number }`. Both archived Task entities AND their time tracking data are stored together.
- **Two-tier archive**: Recent tasks go to `archiveYoung` (tasks < 21 days old). Older tasks are flushed to `archiveOld` via `flushYoungToOld` action (checked every ~14 days when archiving tasks).
- **Flush mechanism**: `flushYoungToOld` is a persistent action that:
  1. Triggers when `lastTimeTrackingFlush > 14 days` during `moveTasksToArchiveAndFlushArchiveIfDue()`
  2. Moves tasks older than 21 days from `archiveYoung.task` to `archiveOld.task`
  3. Syncs via operation log so all clients execute the same flush deterministically
- **Not in NgRx state**: Archive data is stored directly in IndexedDB, not in the NgRx store. Only the operations (`moveToArchive`, `flushYoungToOld`) are logged for sync.
- **Sync handling**: On remote clients, `ArchiveOperationHandler` writes archive data AFTER receiving the operation (see [archive-operations.md](./06-archive-operations.md)).

## Key Files

| File                                                   | Purpose                                |
| ------------------------------------------------------ | -------------------------------------- |
| `op-log/effects/operation-log.effects.ts`              | Captures actions and writes operations |
| `op-log/store/operation-log-store.service.ts`          | IndexedDB wrapper for SUP_OPS          |
| `op-log/persistence/operation-log-hydrator.service.ts` | Startup hydration                      |
| `op-log/processing/operation-applier.service.ts`       | Replays operations to NgRx             |
| `features/time-tracking/archive.service.ts`            | Archive write logic                    |
