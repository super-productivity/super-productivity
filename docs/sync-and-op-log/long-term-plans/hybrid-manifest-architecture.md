# Hybrid Manifest & Snapshot Architecture for File-Based Sync

**Status:** ✅ Implemented (December 2025)
**Context:** Optimizing WebDAV/Dropbox sync for the Operation Log architecture.
**Related:** [Operation Log Architecture](./operation-log-architecture.md)

> **Implementation Note:** This architecture is fully implemented in `OperationLogManifestService`, `OperationLogUploadService`, and `OperationLogDownloadService`. The embedded operations buffer, overflow file creation, and snapshot support are all operational.

---

## 1. The Problem

The current `OperationLogSyncService` fallback for file-based providers (WebDAV, Dropbox) is inefficient for frequent, small updates.

**Current Workflow (Naive Fallback):**

1.  **Write Operation File:** Upload `ops/ops_CLIENT_TIMESTAMP.json`.
2.  **Read Manifest:** Download `ops/manifest.json` to get current list.
3.  **Update Manifest:** Upload new `ops/manifest.json` with the new filename added.

**Issues:**

- **High Request Count:** Minimum 3 HTTP requests per sync cycle.
- **File Proliferation:** Rapidly creates thousands of small files, degrading WebDAV directory listing performance.
- **Latency:** On slow connections (standard WebDAV), this makes sync feel sluggish.

---

## 2. Proposed Solution: Hybrid Manifest

Instead of treating the manifest solely as an _index_ of files, we treat it as a **buffer** for recent operations.

### 2.1. Concept

- **Embedded Operations:** Small batches of operations are stored directly inside `manifest.json`.
- **Lazy Flush:** New operation files (`ops_*.json`) are only created when the manifest buffer fills up.
- **Snapshots:** A "base state" file allows us to delete old operation files and clear the manifest history.

### 2.2. Data Structures

**Updated Manifest:**

```typescript
interface HybridManifest {
  version: 2;

  // The baseline state (snapshot). If present, clients load this first.
  lastSnapshot?: SnapshotReference;

  // Ops stored directly in the manifest (The Buffer)
  // Limit: ~50 ops or 100KB payload size
  embeddedOperations: EmbeddedOperation[];

  // References to external operation files (The Overflow)
  // Older ops that were flushed out of the buffer
  operationFiles: OperationFileReference[];

  // Merged vector clock from all embedded operations
  // Used for quick conflict detection without parsing all ops
  frontierClock: VectorClock;

  // Last modification timestamp (for ETag-like cache invalidation)
  lastModified: number;
}

interface SnapshotReference {
  fileName: string; // e.g. "snapshots/snap_1701234567890.json"
  schemaVersion: number; // Schema version of the snapshot
  vectorClock: VectorClock; // Clock state at snapshot time
  timestamp: number; // When snapshot was created
}

interface OperationFileReference {
  fileName: string; // e.g. "ops/overflow_1701234567890.json"
  opCount: number; // Number of operations in file (for progress estimation)
  minSeq: number; // First operation's logical sequence in this file
  maxSeq: number; // Last operation's logical sequence
}

// Embedded operations are lightweight - full Operation minus redundant fields
interface EmbeddedOperation {
  id: string;
  actionType: string;
  opType: OpType;
  entityType: EntityType;
  entityId?: string;
  entityIds?: string[];
  payload: unknown;
  clientId: string;
  vectorClock: VectorClock;
  timestamp: number;
  schemaVersion: number;
}
```

**Snapshot File Format:**

```typescript
interface SnapshotFile {
  version: 1;
  schemaVersion: number; // App schema version
  vectorClock: VectorClock; // Merged clock at snapshot time
  timestamp: number;
  data: AppDataComplete; // Full application state
  checksum?: string; // Optional SHA-256 for integrity verification
}
```

---

## 3. Workflows

### 3.1. Upload (Write Path)

When a client has local pending operations to sync:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Upload Flow                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  1. Download manifest.json    │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  2. Detect remote changes     │
              │  (compare frontierClock)      │
              └───────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
     Remote has new ops?              No remote changes
              │                               │
              ▼                               │
     Download & apply first           ◄───────┘
              │
              ▼
              ┌───────────────────────────────┐
              │  3. Check buffer capacity     │
              │  embedded.length + pending    │
              └───────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
     < BUFFER_LIMIT (50)            >= BUFFER_LIMIT
              │                               │
              ▼                               ▼
     Append to embedded            Flush embedded to file
              │                    + add pending to empty buffer
              │                               │
              └───────────────┬───────────────┘
                              ▼
              ┌───────────────────────────────┐
              │  4. Check snapshot trigger    │
              │  (operationFiles > 50 OR      │
              │   total ops > 5000)           │
              └───────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
     Trigger snapshot              No snapshot needed
              │                               │
              └───────────────┬───────────────┘
                              ▼
              ┌───────────────────────────────┐
              │  5. Upload manifest.json      │
              └───────────────────────────────┘
```

**Detailed Steps:**

1.  **Download Manifest:** Fetch `manifest.json` (or create empty v2 manifest if not found).
2.  **Detect Remote Changes:**
    - Compare `manifest.frontierClock` with local `lastSyncedClock`.
    - If remote has unseen changes → download and apply before uploading (prevents lost updates).
3.  **Evaluate Buffer:**
    - `BUFFER_LIMIT = 50` operations (configurable)
    - `BUFFER_SIZE_LIMIT = 100KB` payload size (prevents manifest bloat)
4.  **Strategy Selection:**
    - **Scenario A (Append):** If `embedded.length + pending.length < BUFFER_LIMIT`:
      - Append `pendingOps` to `manifest.embeddedOperations`.
      - Update `manifest.frontierClock` with merged clocks.
      - **Result:** 1 Write (manifest). Fast path.
    - **Scenario B (Overflow):** If buffer would exceed limit:
      - Upload `manifest.embeddedOperations` to new file `ops/overflow_TIMESTAMP.json`.
      - Add file reference to `manifest.operationFiles`.
      - Place `pendingOps` into now-empty `manifest.embeddedOperations`.
      - **Result:** 1 Upload (overflow file) + 1 Write (manifest).
5.  **Upload Manifest:** Write updated `manifest.json`.

### 3.2. Download (Read Path)

When a client checks for updates:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Download Flow                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  1. Download manifest.json    │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  2. Quick-check: any changes? │
              │  Compare frontierClock        │
              └───────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
     No changes (clocks equal)        Changes detected
              │                               │
              ▼                               ▼
           Done                  ┌────────────────────────┐
                                 │ 3. Need snapshot?      │
                                 │ (local behind snapshot)│
                                 └────────────────────────┘
                                              │
                              ┌───────────────┴───────────────┐
                              ▼                               ▼
                     Download snapshot            Skip to ops
                     + apply as base                    │
                              │                               │
                              └───────────────┬───────────────┘
                                              ▼
                                 ┌────────────────────────┐
                                 │ 4. Download new op     │
                                 │ files (filter seen)    │
                                 └────────────────────────┘
                                              │
                                              ▼
                                 ┌────────────────────────┐
                                 │ 5. Apply embedded ops  │
                                 │ (filter by op.id)      │
                                 └────────────────────────┘
                                              │
                                              ▼
                                 ┌────────────────────────┐
                                 │ 6. Update local        │
                                 │ lastSyncedClock        │
                                 └────────────────────────┘
```

**Detailed Steps:**

1.  **Download Manifest:** Fetch `manifest.json`.
2.  **Quick-Check Changes:**
    - Compare `manifest.frontierClock` against local `lastSyncedClock`.
    - If clocks are equal → no changes, done.
3.  **Check Snapshot Needed:**
    - If local state is older than `manifest.lastSnapshot.vectorClock` → download snapshot first.
    - Apply snapshot as base state (replaces local state).
4.  **Download Operation Files:**
    - Filter `manifest.operationFiles` to only files with `maxSeq > localLastAppliedSeq`.
    - Download and parse each file.
    - Collect all operations.
5.  **Apply Embedded Operations:**
    - Filter `manifest.embeddedOperations` by `op.id` (skip already-applied).
    - Add to collected operations.
6.  **Apply All Operations:**
    - Sort by `vectorClock` (causal order).
    - Detect conflicts using existing `detectConflicts()` logic.
    - Apply non-conflicting ops; present conflicts to user.
7.  **Update Tracking:**
    - Set `localLastSyncedClock = manifest.frontierClock`.

---

## 4. Snapshotting (Compaction)

To prevent unbounded growth of operation files, any client can trigger a snapshot.

### 4.1. Triggers

| Condition                       | Threshold | Rationale                              |
| ------------------------------- | --------- | -------------------------------------- |
| External `operationFiles` count | > 50      | Prevent WebDAV directory bloat         |
| Total operations since snapshot | > 5000    | Bound replay time for fresh installs   |
| Time since last snapshot        | > 7 days  | Ensure periodic cleanup                |
| Manifest size                   | > 500KB   | Prevent manifest from becoming too big |

### 4.2. Process

```
┌─────────────────────────────────────────────────────────────────┐
│                    Snapshot Flow                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  1. Ensure full sync complete │
              │  (no pending local/remote)    │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  2. Read current state from   │
              │  NgRx (authoritative)         │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  3. Generate snapshot file    │
              │  + compute checksum           │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  4. Upload snapshot file      │
              │  (atomic, verify success)     │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  5. Update manifest           │
              │  - Set lastSnapshot           │
              │  - Clear operationFiles       │
              │  - Clear embeddedOperations   │
              │  - Reset frontierClock        │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  6. Upload manifest           │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  7. Cleanup (async, best-     │
              │  effort): delete old files    │
              └───────────────────────────────┘
```

### 4.3. Snapshot Atomicity

**Problem:** If the client crashes between uploading snapshot and updating manifest, other clients won't see the new snapshot.

**Solution:** Snapshot files are immutable and safe to leave orphaned. The manifest is the source of truth. Cleanup is best-effort.

**Invariant:** Never delete the current `lastSnapshot` file until a new snapshot is confirmed.

---

## 5. Conflict Handling

The hybrid manifest doesn't change conflict detection - it still uses vector clocks. However, the `frontierClock` in the manifest enables **early conflict detection**.

### 5.1. Early Conflict Detection

Before downloading all operations, compare clocks:

```typescript
const comparison = compareVectorClocks(localFrontierClock, manifest.frontierClock);

switch (comparison) {
  case VectorClockComparison.LESS_THAN:
    // Remote is ahead - safe to download
    break;
  case VectorClockComparison.GREATER_THAN:
    // Local is ahead - upload our changes
    break;
  case VectorClockComparison.CONCURRENT:
    // Potential conflicts - download ops for detailed analysis
    break;
  case VectorClockComparison.EQUAL:
    // No changes - skip download
    break;
}
```

### 5.2. Conflict Resolution

When conflicts are detected at the operation level, the existing `ConflictResolutionService` handles them. The hybrid manifest doesn't change this flow.

---

## 6. Edge Cases & Failure Modes

### 6.1. Concurrent Uploads (Race Condition)

**Scenario:** Two clients download the manifest simultaneously, both append ops, both upload.

**Problem:** Second upload overwrites first client's operations.

**Solution:** Use provider-specific mechanisms:

| Provider    | Mechanism                                   |
| ----------- | ------------------------------------------- |
| **Dropbox** | Use `update` mode with `rev` parameter      |
| **WebDAV**  | Use `If-Match` header with ETag             |
| **Local**   | File locking (already implemented in PFAPI) |

**Implementation:**

```typescript
interface HybridManifest {
  // ... existing fields

  // Optimistic concurrency control
  etag?: string; // Server-assigned revision (Dropbox rev, WebDAV ETag)
}

async uploadManifest(manifest: HybridManifest, expectedEtag?: string): Promise<void> {
  // If expectedEtag provided, use conditional upload
  // On conflict (412 Precondition Failed), re-download and retry
}
```

### 6.2. Manifest Corruption

**Scenario:** Manifest JSON is invalid (partial write, encoding issue).

**Recovery Strategy:**

1. Attempt to parse manifest.
2. On parse failure, check for backup manifest (`manifest.json.bak`).
3. If no backup, reconstruct from operation files using `listFiles()`.
4. If reconstruction fails, fall back to snapshot-only state.

```typescript
async loadManifestWithRecovery(): Promise<HybridManifest> {
  try {
    return await this._loadRemoteManifest();
  } catch (parseError) {
    PFLog.warn('Manifest corrupted, attempting recovery...');

    // Try backup
    try {
      return await this._loadBackupManifest();
    } catch {
      // Reconstruct from files
      return await this._reconstructManifestFromFiles();
    }
  }
}
```

### 6.3. Snapshot File Missing

**Scenario:** Manifest references a snapshot that doesn't exist on the server.

**Recovery Strategy:**

1. Log error and notify user.
2. Fall back to replaying all available operation files.
3. If operation files also reference missing ops, show data loss warning.

### 6.4. Schema Version Mismatch

**Scenario:** Snapshot was created with schema version 3, but local app is version 2.

**Handling:**

- If `snapshot.schemaVersion > CURRENT_SCHEMA_VERSION + MAX_VERSION_SKIP`:
  - Reject snapshot, prompt user to update app.
- If `snapshot.schemaVersion > CURRENT_SCHEMA_VERSION`:
  - Load with warning (some fields may be stripped by Typia).
- If `snapshot.schemaVersion < CURRENT_SCHEMA_VERSION`:
  - Run migrations on loaded state.

### 6.5. Large Pending Operations

**Scenario:** User was offline for a week, has 500 pending operations.

**Handling:**

- Don't try to embed all 500 in manifest.
- Batch into multiple overflow files (100 ops each).
- Upload files first, then update manifest once.

```typescript
const BATCH_SIZE = 100;
const chunks = chunkArray(pendingOps, BATCH_SIZE);

for (const chunk of chunks) {
  await this._uploadOverflowFile(chunk);
}

// Single manifest update at the end
await this._uploadManifest(manifest);
```

---

## 7. Advantages Summary

| Metric                  | Current (v1)                         | Hybrid Manifest (v2)                                  |
| :---------------------- | :----------------------------------- | :---------------------------------------------------- |
| **Requests per Sync**   | 3 (Upload Op + Read Man + Write Man) | **1-2** (Read Man, optional Write)                    |
| **Files on Server**     | Unbounded growth                     | **Bounded** (1 Manifest + 0-50 Op Files + 1 Snapshot) |
| **Fresh Install Speed** | O(n) - replay all ops                | **O(1)** - load snapshot + small delta                |
| **Conflict Detection**  | Must parse all ops                   | **Quick check** via frontierClock                     |
| **Bandwidth per Sync**  | ~2KB (op file) + manifest overhead   | **~1KB** (manifest only for small changes)            |
| **Offline Resilience**  | Good                                 | **Same** (operations buffered locally)                |

---

## 8. Implementation Status

All phases have been implemented as of December 2025:

### ✅ Phase 1: Core Infrastructure (Complete)

1.  **Types** (`operation.types.ts`):
    - `HybridManifest`, `SnapshotReference`, `OperationFileReference` interfaces defined
    - Backward compatibility maintained with existing `OperationLogManifest`

2.  **Manifest Handling** (`operation-log-manifest.service.ts`):
    - `loadManifest()` handles v1 and v2 formats
    - Automatic v1 to v2 migration on first write
    - Buffer/overflow logic in upload services

3.  **FrontierClock Tracking**:
    - Vector clocks merged when adding embedded operations
    - `lastSyncedFrontierClock` stored locally for quick-check

### ✅ Phase 2: Snapshot Support (Complete)

4.  **Snapshot Operations** (in `operation-log-upload.service.ts` and `operation-log-download.service.ts`):
    - Snapshot generation with current state serialization
    - Upload with retry logic
    - Download + validate + apply

5.  **Snapshot Triggers**:
    - Automatic triggers based on file count and operation count
    - Remote file cleanup after 14 days (`REMOTE_OP_FILE_RETENTION_MS`)

### ✅ Phase 3: Robustness (Complete)

6.  **Concurrency Control**:
    - Provider-specific revision checking (Dropbox rev, WebDAV ETag)
    - Retry-on-conflict logic implemented

7.  **Recovery Logic**:
    - Manifest corruption recovery with file listing fallback
    - Missing file handling with graceful degradation

### ✅ Phase 4: Testing (Complete)

8.  **Tests**:
    - Unit tests in `operation-log-manifest.service.spec.ts`
    - Integration tests in `sync-scenarios.integration.spec.ts`
    - E2E tests in `supersync.spec.ts`

### Key Implementation Files

| File                                | Purpose                                     |
| ----------------------------------- | ------------------------------------------- |
| `operation-log-manifest.service.ts` | Manifest loading, saving, buffer management |
| `operation-log-upload.service.ts`   | Upload with buffer/overflow logic           |
| `operation-log-download.service.ts` | Download with snapshot support              |
| `operation.types.ts`                | Type definitions                            |

---

## 9. Configuration Constants

```typescript
// Buffer limits
const EMBEDDED_OP_LIMIT = 50; // Max operations in manifest buffer
const EMBEDDED_SIZE_LIMIT_KB = 100; // Max payload size in KB

// Snapshot triggers
const SNAPSHOT_FILE_THRESHOLD = 50; // Trigger when operationFiles exceeds this
const SNAPSHOT_OP_THRESHOLD = 5000; // Trigger when total ops exceed this
const SNAPSHOT_AGE_DAYS = 7; // Trigger if no snapshot in N days

// Batching
const UPLOAD_BATCH_SIZE = 100; // Ops per overflow file

// Retry
const MAX_UPLOAD_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
```

---

## 10. Resolved Design Questions

The following questions were resolved during implementation:

1. **Encryption:** Snapshots use the same encryption as operation files (via `EncryptAndCompressHandlerService`).

2. **Compression:** Snapshots are compressed using the same compression scheme as other sync files.

3. **Checksum Verification:** Currently using timestamp-based validation; checksums can be added if needed.

4. **Clock Drift:** Vector clocks handle ordering; timestamps are informational only.

---

## 11. File Reference

### Remote Storage Layout (v2)

```
/                              (or /DEV/ in development)
├── manifest.json              # HybridManifest (buffer + references)
├── ops/
│   ├── ops_CLIENT1_170123.json    # Flushed operations
│   └── ops_CLIENT2_170456.json
└── snapshots/
    └── snap_170789.json           # Full state snapshot (if present)
```

### Code Files

```
src/app/op-log/
├── operation.types.ts                   # HybridManifest, SnapshotReference types
├── store/
│   └── operation-log-manifest.service.ts    # Manifest management
├── sync/
│   ├── operation-log-upload.service.ts      # Upload with buffer/overflow
│   └── operation-log-download.service.ts    # Download with snapshot support
└── docs/
    └── hybrid-manifest-architecture.md      # This document
```
