# Conflict Resolution & SYNC_IMPORT Filtering

**Last Updated:** January 2026
**Status:** Implemented

This document covers LWW (Last-Write-Wins) conflict auto-resolution and SYNC_IMPORT filtering with clean slate semantics.

## LWW (Last-Write-Wins) Conflict Auto-Resolution

When two clients make concurrent changes to the same entity, a conflict occurs. Rather than interrupting the user with a dialog, the system automatically resolves conflicts using **Last-Write-Wins (LWW)** based on operation timestamps.

### What is a Conflict?

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

### LWW Resolution Algorithm

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

### Two Possible Outcomes

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

### Complete LWW Flow

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

### User Notification

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

### Key Implementation Details

| Aspect                 | Implementation                                                              |
| ---------------------- | --------------------------------------------------------------------------- |
| **Timestamp Source**   | `Math.max(...Object.values(vectorClock))` - max timestamp from vector clock |
| **Tie Breaker**        | Remote wins (ensures convergence across all clients)                        |
| **Safety Backup**      | Created via `BackupService` before any resolution                           |
| **Local Win Update**   | New `OpType.UPD` operation created with merged vector clock                 |
| **Vector Clock Merge** | `mergeVectorClocks(localClock, remoteClock)` for local-win ops              |
| **Entity State**       | Retrieved from NgRx store via entity-specific selectors                     |
| **Notification**       | Non-blocking snackbar showing count of resolved conflicts                   |

---

## SYNC_IMPORT Filtering with Clean Slate Semantics

When a SYNC_IMPORT or BACKUP_IMPORT operation is received, it represents an explicit user action to restore **all clients** to a specific point in time. Operations created without knowledge of the import are filtered out using vector clock comparison.

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

### Why Vector Clocks Instead of UUIDv7?

Vector clocks track **causality** - whether a client "knew about" the import when it created an operation. UUIDv7 timestamps only track wall-clock time, which is unreliable due to clock drift between devices. An operation created 5 seconds after an import (by timestamp) may still reference entities that no longer exist if the client hadn't seen the import yet.

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

## Key Files

| File                                                    | Purpose                           |
| ------------------------------------------------------- | --------------------------------- |
| `src/app/op-log/sync/conflict-resolution.service.ts`    | LWW conflict auto-resolution      |
| `src/app/op-log/sync/sync-import-filter.service.ts`     | SYNC_IMPORT filtering logic       |
| `src/app/op-log/sync/operation-log-download.service.ts` | Download and apply remote ops     |
| `src/app/op-log/sync/vector-clock.service.ts`           | Vector clock comparison utilities |
