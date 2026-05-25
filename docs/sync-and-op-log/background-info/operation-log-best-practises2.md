# Operation Log Sync Server: Best Practices Research

**Status:** Research Complete
**Date:** December 2, 2025
**Purpose:** Inform the design of Super Productivity's server sync architecture

---

## Executive Summary

This document synthesizes best practices from industry leaders (Figma, Linear, Replicache) and academic research on operation-based synchronization systems. Key findings inform our architecture decisions for transitioning from file-based to operation-based sync.

---

## 1. Architecture Patterns

### 1.1 Server-Authoritative vs. Peer-to-Peer

| Pattern                  | Use Case                      | Examples           |
| ------------------------ | ----------------------------- | ------------------ |
| **Server-authoritative** | Single source of truth needed | Linear, Replicache |
| **Peer-to-peer**         | No central server required    | CRDTs, Local-first |
| **Hybrid**               | Server for ordering, peers ok | Figma multiplayer  |

**Recommendation for Super Productivity:** Server-authoritative pattern. The server assigns monotonic sequence numbers, providing total ordering while clients handle optimistic updates.

**Source:** [Replicache - How It Works](https://doc.replicache.dev/concepts/how-it-works)

### 1.2 Push/Pull Protocol (Replicache Pattern)

The most robust pattern uses separate push and pull phases:

```
┌─────────┐                    ┌─────────┐
│  Client │                    │  Server │
└────┬────┘                    └────┬────┘
     │                              │
     │  PUSH: mutations[]           │
     │─────────────────────────────►│
     │                              │ Execute mutations
     │                              │ Update lastMutationID
     │                              │
     │  PULL: since cookie          │
     │─────────────────────────────►│
     │                              │
     │  Response: patch, cookie,    │
     │  lastMutationIDChanges       │
     │◄─────────────────────────────│
     │                              │
     │  Rebase local state          │
     │                              │
```

**Key insight:** The server re-executes client mutations rather than simply storing them. This allows server-side validation, side effects, and authoritative conflict resolution.

**Source:** [Replicache Push/Pull Reference](https://doc.replicache.dev/reference/server-push)

### 1.3 Linear Sync Engine Pattern

Linear uses a transaction-based model with delta broadcasting:

1. **Transactions** execute exclusively on the server
2. **Delta packets** broadcast to all clients (including originator)
3. Each action has a **sync ID** (monotonic sequence)
4. Transactions are cached in IndexedDB if offline
5. Automatic retry on reconnection

**Key insight:** Delta packets may differ from original transactions because the server performs side effects (e.g., generating history, enforcing constraints).

**Source:** [Reverse Engineering Linear's Sync Engine](https://github.com/wzhudev/reverse-linear-sync-engine)

---

## 2. Causality & Ordering

### 2.1 Vector Clocks

Vector clocks track causal relationships between events:

```typescript
type VectorClock = Record<string, number>; // { clientId: sequenceNumber }

// Comparison results:
// - BEFORE: a happened-before b
// - AFTER: a happened-after b
// - EQUAL: same logical time
// - CONCURRENT: conflict - neither ordered
```

**Properties:**

- Detect concurrent updates (conflicts)
- Preserve causal chains (answer never before question)
- Partial ordering only (no total order without server)

**Limitation:** Vector clocks grow with the number of clients. Pruning strategies needed for long-lived systems.

**Source:** [Vector Clocks and Conflicting Data](https://www.designgurus.io/course-play/grokking-the-advanced-system-design-interview/doc/vector-clocks-and-conflicting-data)

### 2.2 Hybrid Logical Clocks (HLC)

HLC combines physical and logical clocks, addressing vector clock limitations:

```typescript
interface HLC {
  wallTime: number; // Physical clock component
  logical: number; // Logical counter for same wallTime
  nodeId: string; // For tiebreaking
}
```

**Advantages:**

- Fits in 64 bits (vs. unbounded vector clocks)
- Close to NTP time (human-readable)
- Used by MongoDB, CockroachDB, YugabyteDB

**Best Practices:**

- Sync nodes with NTP
- Set reasonable error bounds (250-500ms default)
- Validate client timestamps aren't too far from server time
- Allow 20s-1min clock drift tolerance in production

**Source:** [Hybrid Logical Clocks in Depth](https://medium.com/geekculture/all-things-clock-time-and-order-in-distributed-systems-hybrid-logical-clock-in-depth-7c645eb03682)

### 2.3 Server-Assigned Sequence Numbers

The simplest approach for server-authoritative systems:

```sql
-- Per-user monotonic sequence
UPDATE user_sync_state
SET last_seq = last_seq + 1
WHERE user_id = ?
RETURNING last_seq;
```

**Trade-off:** Requires server connectivity for total ordering, but simplifies conflict detection to sequence comparison.

---

## 3. Conflict Resolution Strategies

### 3.1 Strategy Matrix

| Strategy              | Use Case                    | Complexity | User Friction |
| --------------------- | --------------------------- | ---------- | ------------- |
| **Last-Write-Wins**   | Low-stakes, non-collab      | Low        | Medium        |
| **Object Versioning** | Git-like history needed     | Medium     | High          |
| **CRDTs**             | Math-guaranteed convergence | High       | Low           |
| **Server Aggregate**  | Simplified client           | Medium     | Low           |
| **Application Logic** | Custom per-field rules      | Medium     | Low           |

**Source:** [Hasura Offline-First Design Guide](https://hasura.io/blog/design-guide-to-offline-first-apps)

### 3.2 Operation-Based CRDT Requirements

For operation-based CRDTs (relevant to our op-log approach):

1. **Commutativity:** Operations can apply in any order
2. **Idempotency:** Same operation applied twice = same result
3. **Reliable Causal Broadcast (RCB):** All updates eventually reach all nodes

```typescript
// CRDT interface pattern
interface OperationCRDT<State, Op> {
  empty(): State;
  query(state: State): unknown;
  prepare(state: State, command: unknown): Op;
  effect(state: State, op: Op): State;
}
```

**Source:** [Operation-Based CRDTs Protocol](https://www.bartoszsypytkowski.com/operation-based-crdts-protocol/)

### 3.3 Replicache's Rebase Strategy

Instead of applying patches directly, Replicache uses git-like rebase:

1. Rewind to last confirmed server state
2. Apply server patch
3. Replay pending local mutations
4. Atomically reveal result

**Key insight:** Mutators are arbitrary code that can express any conflict resolution policy. The application defines merge semantics, not the sync engine.

**Source:** [Replicache Concepts](https://doc.replicache.dev/concepts/how-it-works)

### 3.4 Field-Level Resolution

Modern systems apply different strategies per field:

| Field Type   | Strategy         | Rationale               |
| ------------ | ---------------- | ----------------------- |
| Single value | LWW              | User expects latest     |
| Set/Tags     | Union            | Additive, no data loss  |
| Counter/Time | Sum deltas       | Mathematically correct  |
| Ordered list | LCS + interleave | Preserve both orderings |
| Rich text    | OT or CRDT       | Character-level merge   |

---

## 4. Tombstone & Deletion Handling

### 4.1 Why Tombstones Are Required

In eventually consistent systems, deletions must be tracked:

```
Without tombstones:
  Node A: DELETE item-123
  Node B: (offline, has item-123)
  Node B: (comes online) → "Node A is missing item-123, let me sync it!"
  Result: Deleted item resurrects
```

**Source:** [Tombstones in Distributed Systems](<https://en.wikipedia.org/wiki/Tombstone_(data_store)>)

### 4.2 Best Practices

| Practice                 | Recommendation                           |
| ------------------------ | ---------------------------------------- |
| **Grace period**         | 90 days minimum (Cassandra default: 10d) |
| **Repair before expiry** | All nodes must see tombstone before GC   |
| **Soft delete flag**     | Better for frequent un-deletes           |
| **Tombstone table**      | Better for audit trails                  |
| **Avoid mass deletions** | Creates tombstone storms                 |

**Cleanup safety rule:** Only garbage-collect tombstones after:

1. Grace period expired AND
2. All devices have acknowledged seeing the deletion

**Source:** [Cassandra Tombstones](https://thelastpickle.com/blog/2016/07/27/about-deletes-and-tombstones.html)

---

## 5. Log Compaction & Garbage Collection

### 5.1 When to Compact

Operations become garbage when superseded by newer operations on the same entity:

```
Op 1: CREATE task-123 {title: "Buy milk"}     → GARBAGE after Op 2
Op 2: UPDATE task-123 {title: "Buy groceries"} → GARBAGE after Op 3
Op 3: DELETE task-123                          → LIVE (until tombstone expires)
```

**Source:** [Apache Geode Log Compaction](https://geode.apache.org/docs/guide/114/managing/disk_storage/compacting_disk_stores.html)

### 5.2 Compaction Strategies

**Live Key Identification (FASTER pattern):**

1. Scan segment for keys
2. Check if newer value exists in later segments
3. If no newer value, key is "live" - reinsert at tail
4. Delete segment after reinsertion

**Trigger Conditions:**

- Garbage ratio exceeds threshold (e.g., 50%)
- Total disk usage exceeds limit
- Time-based (e.g., daily)

**Source:** [Microsoft FASTER Compaction](https://github.com/microsoft/FASTER/issues/70)

### 5.3 Safe Compaction Rules

```typescript
interface CompactionConfig {
  // Never delete operations that haven't been:
  // 1. Acknowledged by all devices
  // 2. Past the retention period

  minRetentionDays: 90;
  requireAllDevicesAcked: true;

  // Snapshot before compacting
  createSnapshotBeforeCompaction: true;
}
```

---

## 6. Real-Time Delivery

### 6.1 Figma LiveGraph Pattern

Figma uses PostgreSQL's Write-Ahead Log (WAL) for real-time updates:

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│  PostgreSQL │─WAL─►│    Kafka    │─────►│  LiveGraph  │
│  (primary)  │      │             │      │  (servers)  │
└─────────────┘      └─────────────┘      └──────┬──────┘
                                                  │
                                           WebSocket
                                                  │
                                          ┌───────▼───────┐
                                          │    Clients    │
                                          └───────────────┘
```

**Key insight:** Rather than polling, subscribe to the database replication stream. This provides millisecond-level updates without polling overhead.

**Source:** [Figma LiveGraph](https://www.figma.com/blog/livegraph-real-time-data-fetching-at-figma/)

### 6.2 Poke Pattern (Replicache)

Instead of pushing full data, send lightweight "poke" hints:

```typescript
// Server → Client
interface Poke {
  type: 'poke';
  // No data payload - just a hint to pull
}

// Client receives poke → triggers pull
```

**Benefits:**

- Reduces server complexity (no need to track client state)
- Client always pulls full consistent view
- Works well with CDN caching

**Source:** [Replicache Poke Mechanism](https://doc.replicache.dev/concepts/how-it-works)

---

## 7. Offline Handling

### 7.1 Operation Queue Pattern

```typescript
interface OfflineQueue {
  // Operations stored in IndexedDB
  pendingOps: Operation[];

  // Metadata
  lastSyncedAt: number;
  lastServerSeq: number;

  // On reconnect
  async flush(): Promise<void> {
    for (const op of this.pendingOps) {
      await this.push(op);
    }
  }
}
```

### 7.2 Extended Offline Recovery

When offline duration is long (days/weeks):

| Pending Ops | Duration | Recommended Action             |
| ----------- | -------- | ------------------------------ |
| < 100       | < 1 day  | Normal sync                    |
| 100-500     | 1-7 days | Show warning, proceed          |
| 500-2000    | > 7 days | Offer recovery options         |
| > 2000      | Any      | Force snapshot upload/download |

**Source:** [Hasura Offline-First Guide](https://hasura.io/blog/design-guide-to-offline-first-apps)

---

## 8. Database & Infrastructure

### 8.1 PowerSync/ElectricSQL Pattern

Both use PostgreSQL logical replication:

```
┌─────────────┐                    ┌─────────────┐
│  PostgreSQL │───logical repl────►│ Sync Server │
│  (source)   │                    │             │
└─────────────┘                    └──────┬──────┘
                                          │
                                    Delta stream
                                          │
                                   ┌──────▼──────┐
                                   │   SQLite    │
                                   │  (client)   │
                                   └─────────────┘
```

**PowerSync approach:** Writes go through application backend (custom logic, validation)
**ElectricSQL approach:** Direct writes to Postgres with CRDT merge

**Source:** [PowerSync vs ElectricSQL](https://www.powersync.com/blog/electricsql-vs-powersync)

### 8.2 Scaling Considerations

From Figma LiveGraph 100x:

1. **Stateless API servers** - horizontal scaling
2. **Read-through cache** - sharded by query hash
3. **Query decomposition** - break complex queries into subqueries
4. **Invalidation routing** - probabilistic filters for efficient cache invalidation

**Source:** [Figma LiveGraph 100x](https://www.figma.com/blog/livegraph-real-time-data-at-scale/)

---

## 9. Recommendations for Super Productivity

Based on this research, key recommendations:

### Architecture

1. **Use server-authoritative pattern** with monotonic sequence numbers
2. **Implement push/pull protocol** (not just WebSocket streaming)
3. **Support offline queuing** with IndexedDB persistence
4. **Use poke pattern** for real-time hints (client pulls full state)

### Ordering & Causality

1. **Start with server-assigned sequences** (simpler than vector clocks)
2. **Keep vector clocks for conflict detection** between pending local ops
3. **Consider HLC** if we need human-readable timestamps with ordering

### Conflict Resolution

1. **Field-level strategies** (LWW for most, union for tags, sum for time)
2. **Server re-executes mutations** (not just stores them)
3. **Rebase pattern** for pending local changes

### Tombstones

1. **90-day retention** minimum
2. **Track device acknowledgments** before garbage collection
3. **Soft delete with tombstone table** (for audit trail)

### Compaction

1. **Snapshot before compacting**
2. **Only compact acknowledged operations**
3. **Trigger on garbage ratio** (50%) or time (daily)

---

## References

### Industry Sources

- [Figma LiveGraph](https://www.figma.com/blog/livegraph-real-time-data-fetching-at-figma/)
- [Figma Multiplayer](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)
- [Linear Sync Engine (Reverse Engineered)](https://github.com/wzhudev/reverse-linear-sync-engine)
- [Replicache Documentation](https://doc.replicache.dev/)
- [PowerSync](https://www.powersync.com/)
- [ElectricSQL](https://electric-sql.com/)

### Academic & Technical

- [Operation-Based CRDTs Protocol](https://www.bartoszsypytkowski.com/operation-based-crdts-protocol/)
- [Hybrid Logical Clocks](https://cse.buffalo.edu/tech-reports/2014-04.pdf)
- [Vector Clocks Explained](https://www.waitingforcode.com/big-data-algorithms/conflict-resolution-distributed-applications-vector-clocks/read)

### Design Guides

- [Hasura Offline-First Guide](https://hasura.io/blog/design-guide-to-offline-first-apps)
- [Akka Replicated Event Sourcing](https://doc.akka.io/libraries/akka-core/current/typed/replicated-eventsourcing.html)
- [Cassandra Tombstones](https://thelastpickle.com/blog/2016/07/27/about-deletes-and-tombstones.html)
