# Implementation Plan: Unified Op-Log Sync for File-Based Providers

> **STATUS: COMPLETED (January 2026)**
>
> This plan has been fully implemented. PFAPI has been completely eliminated.
> All sync providers now use the unified operation log system.
>
> **Current Implementation:**
>
> - File-based adapter: `src/app/op-log/sync-providers/file-based/file-based-sync-adapter.service.ts`
> - Sync providers: `src/app/op-log/sync-providers/`

## Original Goal

Replace PFAPI's model-per-file sync with operation-log sync for ALL providers (WebDAV, Dropbox, LocalFile), enabling full PFAPI deprecation and reducing codebase complexity.

## Background (Historical)

**State Before Implementation:**

- PFAPI (~13,200 LOC): Model-level sync for WebDAV/Dropbox/LocalFile
- Op-Log (~23,000 LOC, 85% generic): Operation-level sync for SuperSync only
- Two parallel systems with duplicate concepts

**Final State (Achieved):**

- Single op-log sync system for ALL providers
- File-based providers use simplified single-file approach
- PFAPI completely deleted (~83 files, 2.0 MB removed)

---

## Why This Is Better Than PFAPI (Conflict Resolution)

**PFAPI (current) - Model-level conflicts:**

```
Client A: Modifies Task 1 → uploads task.json
Client B: Modifies Task 2 → uploads task.json
Result: One overwrites the other. Loser's change is LOST.
```

**With operations - Entity-level conflicts:**

```
Client A: Modifies Task 1 → uploads snapshot + ops[modify Task 1]
Client B: Modifies Task 2 → detects conflict (syncVersion mismatch)
         → downloads A's file, sees ops[modify Task 1]
         → merges: Task 1 from A + Task 2 from self
         → uploads merged snapshot + ops[modify Task 1, modify Task 2]
Result: BOTH changes preserved.
```

| Conflict Type                 | PFAPI (current)             | With Operations   |
| ----------------------------- | --------------------------- | ----------------- |
| Different entities            | Last write wins (data loss) | Both merged       |
| Same entity, different fields | Last write wins (data loss) | LWW per field     |
| Same entity, same field       | Last write wins             | LWW (intentional) |

---

## Implementation Summary

### Phase 1: Core Services (COMPLETED)

#### 1.1 FileBasedSyncData Types

**File:** `src/app/op-log/sync/providers/file-based/file-based-sync.types.ts`

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

**Remote Storage:**

```
/superProductivity/
├── sync-data.json       # Single file: state + recent ops (encrypted + compressed)
└── sync-data.json.bak   # Previous version for recovery
```

**Why single file instead of snapshot + ops files?**

| Single File (chosen)           | Two Files (considered)            |
| ------------------------------ | --------------------------------- |
| ✅ Atomic updates              | ❌ Partial upload risk            |
| ✅ One version to track        | ❌ Version coordination needed    |
| ✅ Simple conflict resolution  | ❌ Handle conflicts in two places |
| ✅ Easy recovery               | ❌ Inconsistent state possible    |
| ❌ Upload full state each time | ✅ Often just ops file            |

The bandwidth cost is acceptable: JSON compresses ~90%, and sync is infrequent.

#### 1.2 FileBasedSyncAdapter Service

**File:** `src/app/op-log/sync/providers/file-based/file-based-sync-adapter.service.ts` (~300 LOC)

Implements `OperationSyncCapable` interface using file operations:

- `uploadOps()` - Downloads current file, merges ops, uploads with version increment
- `downloadOps()` - Downloads file, filters ops by sinceSeq
- `uploadSnapshot()` - Full state upload for SYNC_IMPORT/BACKUP_IMPORT
- Content-based optimistic locking via `syncVersion` counter

#### 1.3 PfapiMigrationService

**File:** `src/app/op-log/sync/providers/file-based/pfapi-migration.service.ts` (~150 LOC)

Handles migration from old PFAPI format to new op-log format:

- Checks for old PFAPI files (meta.json without sync-data.json)
- Acquires distributed lock to prevent concurrent migration
- Downloads PFAPI model files and creates initial sync-data.json
- Marks migration complete with marker file

### Phase 2: Provider Integration (COMPLETED)

#### 2.1 Extended Provider Interface

**File:** `src/app/pfapi/api/sync/sync-provider.interface.ts`

Added `FileBasedOperationSyncCapable` marker interface with type guard.

#### 2.2 Updated Providers

- `webdav.ts` - Added `supportsFileBasedOperationSync = true`
- `dropbox.ts` - Added `supportsFileBasedOperationSync = true`
- `local-file-sync-base.ts` - Added `supportsFileBasedOperationSync = true`

### Phase 3: Sync Service Integration (COMPLETED)

#### 3.1 Modified SyncService

**File:** `src/app/pfapi/api/sync/sync.service.ts`

Added logic to use `FileBasedSyncAdapter` when provider supports file-based op-log sync:

```typescript
if (isFileBasedOperationSyncCapable(provider)) {
  await this._pfapiMigrationService.migrateIfNeeded(
    provider,
    encryptAndCompressCfg,
    encryptKey,
  );
  const adapter = this._fileBasedSyncAdapterService.createAdapter(
    provider,
    encryptAndCompressCfg,
    encryptKey,
  );
  return this._syncViaOperationLog(adapter);
}
```

### Phase 4: Testing (COMPLETED)

#### Unit Tests (COMPLETED)

- `file-based-sync-adapter.service.spec.ts` - 26 tests
- `pfapi-migration.service.spec.ts` - 12 tests
- `sync.service.spec.ts` - 33 tests (updated)
- `server-migration.service.spec.ts` - 22 tests

#### E2E Tests (COMPLETED - 12/12 pass)

- `webdav-sync-full.spec.ts` ✅
- `webdav-sync-advanced.spec.ts` ✅
- `webdav-sync-tags.spec.ts` ✅
- `webdav-sync-task-order.spec.ts` ✅
- `webdav-sync-error-handling.spec.ts` ✅
- `webdav-sync-expansion.spec.ts` ✅

---

## Critical Risks and Mitigations

| Risk                                                      | Severity | Mitigation                                                 |
| --------------------------------------------------------- | -------- | ---------------------------------------------------------- |
| **Sync race condition** - Two devices sync simultaneously | CRITICAL | Content-based optimistic locking (syncVersion counter)     |
| **Concurrent multi-device migration**                     | HIGH     | Distributed lock file + "first migrator wins"              |
| **Cannot downgrade after migration**                      | HIGH     | Clear error message for old app versions                   |
| **Archive data handling**                                 | MEDIUM   | Archive ops in op-log, ArchiveOperationHandler writes data |

---

## LOC Estimates

| Component                                   | LOC                      |
| ------------------------------------------- | ------------------------ |
| New code (FileBasedSyncAdapter + Migration) | **~500 LOC**             |
| Deleted code (PFAPI sync, model-sync, meta) | **~4,000 LOC** (Phase 5) |
| **Net reduction**                           | **~3,500 LOC**           |

---

## Phase 5: PFAPI Deprecation (Future)

### Files to DELETE (~4,000 LOC)

```
src/app/pfapi/api/sync/
├── sync.service.ts              # DELETE - replaced by op-log sync
├── model-sync.service.ts        # DELETE - archives now use op-log too
├── meta-sync.service.ts         # DELETE - no longer needed

src/app/pfapi/api/model-ctrl/
├── meta-model-ctrl.ts           # DELETE - replaced by op-log vector clocks

src/app/pfapi/api/util/
├── get-sync-status-from-meta-files.ts    # DELETE
├── get-model-ids-to-update-from-rev-maps.ts  # DELETE
├── validate-rev-map.ts          # DELETE
├── validate-local-meta.ts       # DELETE
```

### Files to KEEP (Transport Layer Only)

```
src/app/pfapi/api/sync/
├── providers/                   # KEEP - transport layer
│   ├── webdav/
│   ├── dropbox/
│   ├── local-file-sync/
│   └── super-sync/
├── encrypt-and-compress-handler.service.ts  # KEEP - shared utility
└── sync-provider.interface.ts   # KEEP - provider interface
```

---

## Testing Checklist

### Critical Test Scenarios

- [x] **Race condition:** Two devices sync simultaneously (tested in webdav-sync-full.spec.ts)
- [ ] **Migration:** PFAPI → op-log on first sync
- [ ] **Concurrent migration:** Two devices migrate at same time
- [ ] **Recovery:** Sync interrupted mid-upload
- [ ] **Rollback:** Downgrade to old app version
- [ ] **Archive sync:** Archive data syncs correctly
- [ ] **Large state:** User with 10MB+ of data
- [ ] **Server variability:** Test on 3+ WebDAV servers

### E2E Tests

- [x] `webdav-sync-full.spec.ts`
- [x] `webdav-sync-advanced.spec.ts`
- [x] `webdav-sync-tags.spec.ts`
- [x] `webdav-sync-task-order.spec.ts`
- [x] `webdav-sync-error-handling.spec.ts`
- [x] `webdav-sync-expansion.spec.ts`

---

## Current Status

**Completed:**

1. ✅ FileBasedSyncData types and interfaces
2. ✅ FileBasedSyncAdapter service (with piggybacking)
3. ✅ PfapiMigrationService
4. ✅ Provider interface extension
5. ✅ Provider updates (WebDAV, Dropbox, LocalFile)
6. ✅ SyncService integration
7. ✅ Unit tests (26 tests)
8. ✅ E2E tests for WebDAV sync (12 tests pass)
9. ✅ Force sync methods for conflict resolution
   - `forceUploadLocalState()` - Creates SYNC_IMPORT with local state
   - `forceDownloadRemoteState()` - Clears local ops and downloads all remote

**Phase 5 Status (PFAPI Deprecation):**

- ✅ All sync now uses op-log path (no provider uses legacy PFAPI sync)
- ⏳ Legacy PFAPI sync code marked as dead code (kept as safety net)
- ⏳ Dead code removal deferred for future cleanup

## Key Implementation Details

### Piggybacking Mechanism

The adapter uses **piggybacking** to handle concurrent sync gracefully:

1. On upload, if another client synced (version mismatch), we **don't throw an error**
2. Instead, we find ops from other clients we haven't processed (`seq > lastProcessedSeq`)
3. These ops are returned as `newOps` in the upload response
4. The upload service processes them before advancing `lastServerSeq`

This ensures no ops are ever missed, even in concurrent sync scenarios.

### Sequence Counter Separation

Two separate counters prevent race conditions:

- `_expectedSyncVersions`: File's syncVersion - used to detect other clients syncing
- `_localSeqCounters`: Ops we've processed - updated only via `setLastServerSeq()` after processing
