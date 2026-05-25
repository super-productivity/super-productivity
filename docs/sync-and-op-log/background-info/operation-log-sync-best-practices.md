# Best Practices for Operation Log Sync Server

This document outlines industry best practices for designing and implementing a robust, offline-first synchronization server based on an operation log (event sourcing) architecture.

## 1. Core Architectural Principles

### 1.1. Event Sourcing (The "Truth" is the Log)

Instead of mutating the current state directly, the system records every change as an immutable event (operation).

- **Benefit:** Provides a complete audit trail, allows time-travel debugging, and enables different state representations (projections) to be built from the same data.
- **Best Practice:** The server's primary responsibility is to persist this log in a strict linear order. The "current state" is merely a derivative of this log.

### 1.2. Centralized Serialization (The "Star" Topology)

In a client-server model, the server acts as the linearization point.

- **Logical Clocks:** The server assigns a strictly monotonic **Sequence Number** (or Global Revision ID) to every accepted operation.
- **Ordering:** This sequence number defines the absolute order of events. If two clients send operations simultaneously, the server arbitrarily processes one first, assigning it `Seq N`, and the second gets `Seq N+1`.
- **Simplicity:** This avoids the complexity of mesh-topology vector clocks for the global ordering, although clients may still use vector clocks for local branch management.

### 1.3. "Dumb" Server, "Smart" Client

For end-to-end encrypted or complex domain applications, the server should ideally treat operation payloads as opaque blobs (or just minimal validation).

- **Conflict Resolution:** Logic resides on the client. When a client downloads new operations from the server, it re-bases its local pending operations on top of them (similar to `git rebase`).
- **Validation:** Server validates authentication, authorization, and schema structure, but typically not business rules (which might depend on client-side state).

## 2. Data Storage & Database Choice

### 2.1. SQLite vs. PostgreSQL

| Feature         | SQLite                          | PostgreSQL                                 |
| :-------------- | :------------------------------ | :----------------------------------------- |
| **Use Case**    | Personal, Self-Hosted, Embedded | Multi-tenant, Enterprise, High Concurrency |
| **Concurrency** | Single-writer (WAL mode helps)  | MVCC (Multi-Version Concurrency Control)   |
| **Maintenance** | Zero (single file)              | Moderate (requires service management)     |

- **Recommendation:** For a personal productivity tool (like Super Productivity), **SQLite** is the ideal default for self-hosting due to its zero-maintenance nature. However, the data access layer should use a query builder (e.g., Kysely, Knex) to support **PostgreSQL** for larger deployments or hosted services.

### 2.2. Immutable Log Storage

- **Append-Only:** The `operations` table should be effectively append-only.
- **Idempotency Keys:** Use client-generated UUIDs (v7 recommended for time-sorting) as the primary key to prevent duplicate processing of the same operation during network retries.

### 2.3. Tombstones

- **Deleting Data:** You cannot simply `DELETE` rows in an offline-first system, or other devices won't know an item was removed.
- **Implementation:** Create a `tombstones` table or a specific `DEL` operation type.
- **Cleanup:** Use a "Time-to-Live" (e.g., 90 days) after which tombstones are hard-deleted (the "horizon" for sync).

## 3. Synchronization Protocol

### 3.1. The Push-Pull Cycle

1.  **Push:** Client sends a batch of `pending` operations.
    - _Payload:_ `[Op1, Op2]`, `lastKnownServerSeq: 100`.
2.  **Server Handling:**
    - Checks strictly monotonic sequence.
    - Assigns new `serverSeq` (101, 102).
    - Stores ops.
    - _Conflict Detection:_ If `lastKnownServerSeq` < `CurrentServerSeq` (e.g., 105), the server _could_ reject (Optimistic Locking) OR accept and let the client resolve later (Eventual Consistency). For "Dumb Server" models, accepting and letting the client merge is often smoother for UX.
3.  **Pull:** Client requests "all ops since `serverSeq: 100`".
4.  **Ack:** Client confirms it has processed ops up to `serverSeq: 102`.

### 3.2. Batching & Compression

- **Batching:** Always group operations. Overhead of HTTP/WS setup is high.
- **Compression:** Use `gzip` or `Brotli` for HTTP responses. For the payload itself, if JSON is verbose, consider a binary format (Protobuf/MsgPack) or just compressed JSON blobs if storage space is a concern.

### 3.3. Snapshotting (Bootstrapping)

Replaying 100,000 operations to build the initial state is slow.

- **Snapshots:** Periodically (e.g., every 1,000 ops), generating a full state snapshot.
- **Hybrid Sync:** New devices download the latest Snapshot + any Operations occurring _after_ that snapshot.

## 4. Client-Side Optimization: Coalescing & Batching

### 4.1. Write Coalescing (Squashing)

Coalescing is the practice of merging multiple granular updates to the same entity into a single operation _before_ it is synced to the server.

- **When to use:**
  - **Rapid Text Entry:** If a user types "Hello" (5 ops), squash into 1 op ("Hello") after a debounce period (e.g., 500ms).
  - **Slider/Drag Adjustments:** If a user drags a progress bar from 0% to 50%, typically only the final value (50%) matters.
- **Benefits:**
  - Reduces server storage growth.
  - Speeds up replay/initial sync for other clients.
  - Reduces network overhead.
- **Risks:**
  - **History Loss:** You lose the detailed audit trail of intermediate keystrokes. (Usually acceptable).
  - **Conflict Complexity:** If two users edit the same field simultaneously, coalesced ops can make "Character-level" merging (OT/CRDT) harder if you are relying on simple LWW. But for field-level LWW, it is actually helpful.

### 4.2. Logical Batching

A "Batch" operation is a container for multiple distinct actions that should be treated atomically.

- **Use Case:** "Create Task" + "Add Tag" + "Move to Project X".
- **Implementation:** The client sends a single `BATCH` op containing an array of sub-operations.
- **Benefit:** Ensures database consistency. If the network fails, the task isn't created without its tag.

## 5. Conflict Resolution Strategies

### 5.1. Detection

- **Server-side:** "I received an update for Entity X based on v1, but I am already at v2."
- **Client-side:** "I downloaded Op A (ServerSeq 50) which modifies Task 1, but I have a local pending Op B that also modifies Task 1."

### 5.2. Resolution Models

1.  **Last-Write-Wins (LWW):** Simple, robust, but data loss is possible. Uses wall-clock timestamps.
2.  **Three-Way Merge:** If the payload is diff-able (e.g., JSON Patch), try to merge.
3.  **Manual:** Flag the conflict and ask the user (complex UI).
4.  **Hybrid:** LWW for simple fields (Title), Merge for collections (Tags), Append for logs (Time tracking).

## 6. Security & Reliability

### 6.1. Authentication

- **Token-Based:** JWTs are standard.
- **Scope:** Tokens should restrict access to specific `user_id` partitions.

### 6.2. Encryption

- **Transport:** HTTPS/WSS is mandatory.
- **At Rest:** If the server is untrusted, clients should encrypt the `payload` field before sending. The server syncs encrypted blobs. (End-to-End Encryption - E2EE).

### 6.3. Rate Limiting

- Essential to prevent a single malfunctioning client from flooding the log.

## 7. Summary Checklist

- [ ] **Database:** SQLite (Start) / Postgres (Scale).
- [ ] **ID Generation:** UUID v7 (Time-ordered).
- [ ] **Protocol:** HTTP (Reliable) + WebSocket (Notify).
- [ ] **Optimization:** Coalesce rapid local edits; Batch atomic actions.
- [ ] **Conflict:** Server assigns order; Client reconciles.
- [ ] **Safety:** Tombstones for deletions, Snapshots for speed.
