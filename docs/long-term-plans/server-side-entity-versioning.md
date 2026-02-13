# Plan: Server-Side Entity Versioning (Optimistic Concurrency Control)

> **STATUS: PROPOSED**
>
> Long-term architectural change to eliminate vector clock pruning as a source of sync conflicts.

---

## Problem

Vector clocks grow linearly with the number of participating clients. Pruning to `MAX_VECTOR_CLOCK_SIZE=20` loses causal information, though at MAX=20 this requires 21+ unique client IDs — extremely rare for a personal productivity app. A same-client check handles the edge case where pruning causes false concurrency for the import client's own ops, but the fundamental issue remains:

The fundamental issue: vector clocks were designed for peer-to-peer systems where no node is authoritative. Super Productivity has a central server -- the server can define ordering authoritatively, making vector clocks unnecessary for online conflict detection.

## Industry Precedent

Every major production system with a central server converged on this pattern:

| System                | Mechanism                                | Details                                          |
| --------------------- | ---------------------------------------- | ------------------------------------------------ |
| **DynamoDB** (modern) | Multi-Paxos, single leader per partition | Abandoned original Dynamo vector clocks entirely |
| **Figma**             | Server-ordered property-level LWW        | Server receipt order defines total ordering      |
| **Linear**            | Monotonic `syncId` counter               | Single integer per transaction                   |
| **EventStoreDB**      | `expectedVersion` per stream             | Append rejected if version mismatch              |
| **CouchDB**           | `_rev` per document                      | Server assigns new revision on acceptance        |
| **Cosmos DB**         | `_etag` per item                         | Conditional updates via `If-Match` header        |

The pattern is **Optimistic Concurrency Control (OCC)**: the server tracks an authoritative version per entity, clients include the expected version when writing, and the server rejects stale writes.

## Approach

Add a **server-assigned monotonic version number per entity**. Use this as the primary conflict detection mechanism. Keep vector clocks as secondary metadata for offline causality reasoning and as a migration fallback.

### Why This Solves the Pruning Problem

- Conflict detection uses a single integer comparison (`expectedVersion === currentVersion`), not vector clock comparison
- No pruning needed for the primary conflict detection path
- Vector clocks become informational metadata, not critical for correctness
- The sync loop is impossible: a rejected operation gets the current version, retries with the correct version, and succeeds

## Changes

### Phase 1: Server Schema and Version Tracking

**File:** `packages/super-sync-server/prisma/schema.prisma`

```prisma
model EntityVersion {
  id         String   @id @default(uuid())
  userId     String
  entityType String
  entityId   String
  version    Int      @default(0)   // Monotonically increasing
  updatedAt  DateTime @updatedAt

  @@unique([userId, entityType, entityId])
  @@index([userId, entityType, entityId])
}
```

**File:** `packages/super-sync-server/src/sync/sync.service.ts`

When processing an uploaded operation:

```typescript
async processOperation(userId: string, op: Operation): Promise<UploadResult> {
  const entityKey = { userId, entityType: op.entityType, entityId: op.entityId };

  // Get or create entity version
  const entity = await this.getOrCreateEntityVersion(entityKey);

  if (op.entityVersion !== undefined) {
    // New-style client: uses entity versioning
    if (op.entityVersion !== entity.version) {
      return {
        status: 'CONFLICT',
        reason: op.entityVersion < entity.version
          ? 'CONFLICT_SUPERSEDED'
          : 'CONFLICT_VERSION_MISMATCH',
        currentVersion: entity.version,
        existingClock: entity.clock,  // Still provided for backward compat
      };
    }
  } else {
    // Legacy client: fall back to vector clock comparison
    const conflict = await this.detectConflictByVectorClock(entityKey, op.vectorClock);
    if (conflict.hasConflict) {
      return {
        status: 'CONFLICT',
        reason: conflict.reason,
        currentVersion: entity.version,  // Include version even for legacy clients
        existingClock: conflict.existingClock,
      };
    }
  }

  // Accept: increment entity version, assign server sequence
  const newVersion = entity.version + 1;
  await this.updateEntityVersion(entityKey, newVersion);

  const seq = await this.allocateSequence(userId);
  await this.storeOperation(op, seq, userId);

  return { status: 'OK', serverSeq: seq, entityVersion: newVersion };
}
```

### Phase 2: Wire Protocol Changes

**File:** `packages/shared-schema/src/operation.types.ts` (or equivalent shared types)

Add optional fields to `Operation`:

```typescript
interface Operation {
  // ... existing fields ...

  // Server-assigned entity version at time of acceptance (returned in download)
  entityVersion?: number;
}
```

**File:** Upload result types

Add `currentVersion` and `entityVersion` to upload results:

```typescript
interface UploadResult {
  // ... existing fields ...

  // Current entity version (returned on conflict for retry)
  currentVersion?: number;

  // Assigned entity version (returned on success)
  entityVersion?: number;
}
```

### Phase 3: Client-Side Integration

**File:** `src/app/op-log/sync/vector-clock.service.ts` (or new service)

Track entity versions locally:

```typescript
// Store entity versions received from server
// Key: "ENTITY_TYPE:entityId", Value: version number
private entityVersions = new Map<string, number>();

async getEntityVersion(entityType: string, entityId: string): Promise<number | undefined> {
  const key = `${entityType}:${entityId}`;
  // Check in-memory cache first, then IndexedDB
  return this.entityVersions.get(key) ?? await this.loadFromStore(key);
}

async updateEntityVersion(entityType: string, entityId: string, version: number): Promise<void> {
  const key = `${entityType}:${entityId}`;
  this.entityVersions.set(key, version);
  await this.persistToStore(key, version);
}
```

**File:** `src/app/op-log/sync/upload.service.ts` (or equivalent)

When creating operations for upload, attach the entity version:

```typescript
// Before uploading an operation
const entityVersion = await this.vectorClockService.getEntityVersion(
  op.entityType,
  op.entityId,
);
if (entityVersion !== undefined) {
  op.entityVersion = entityVersion;
}
```

When processing upload results:

```typescript
// On successful upload
if (result.entityVersion !== undefined) {
  await this.vectorClockService.updateEntityVersion(
    op.entityType,
    op.entityId,
    result.entityVersion,
  );
}

// On conflict
if (result.currentVersion !== undefined) {
  await this.vectorClockService.updateEntityVersion(
    op.entityType,
    op.entityId,
    result.currentVersion,
  );
}
```

**File:** `src/app/op-log/sync/superseded-operation-resolver.service.ts`

When creating replacement operations, use the entity version from the rejection:

```typescript
// The server returns currentVersion in the rejection
// Use it as the expectedVersion for the replacement op
replacementOp.entityVersion = rejectedOpInfo.currentVersion;
```

This eliminates the sync loop entirely: the replacement op has the correct version, so the server accepts it on the next attempt. No vector clock comparison needed.

### Phase 4: Download Integration

When downloading operations from the server, each operation should include its `entityVersion`. The client stores this as the latest known version for that entity:

```typescript
// During download processing
for (const downloadedOp of ops) {
  if (downloadedOp.entityVersion !== undefined) {
    await this.vectorClockService.updateEntityVersion(
      downloadedOp.entityType,
      downloadedOp.entityId,
      downloadedOp.entityVersion,
    );
  }
}
```

### Phase 5: Persistence for Entity Versions

**File:** `src/app/op-log/persistence/operation-log-store.service.ts`

Add a new IndexedDB object store for entity versions:

```typescript
// In the database schema (SUP_OPS)
// New store: 'entity_versions'
// Key: string (entityType:entityId)
// Value: number (version)
```

This must survive app restarts. On first sync after app restart, the client may not have versions for all entities -- in that case, it falls back to vector clock comparison (the server handles both paths).

## Migration Strategy

### Server Backward Compatibility

The server accepts both old-style (vector clock only) and new-style (entity version) operations:

1. If `op.entityVersion` is present: use OCC (integer comparison)
2. If `op.entityVersion` is absent: fall back to vector clock comparison

This allows gradual client rollout. Old clients continue to work without changes.

### Client Backward Compatibility

The client gracefully handles servers that don't return `entityVersion`:

1. If upload result includes `entityVersion`: store it, use OCC on next upload
2. If upload result lacks `entityVersion`: continue with vector clock only

### Backfill Entity Versions

New entities get version 0. Existing entities need backfilling:

```typescript
// Server migration: assign version 1 to all existing entities
// that have at least one operation
await prisma.entityVersion.createMany({
  data: existingEntities.map((e) => ({
    userId: e.userId,
    entityType: e.entityType,
    entityId: e.entityId,
    version: 1,
  })),
  skipDuplicates: true,
});
```

On first sync after migration, clients will receive `entityVersion: 1` and use it for subsequent uploads.

## What Happens to Vector Clocks

Vector clocks are **not removed**. They serve two remaining purposes:

1. **Offline causality reasoning**: When a client has been offline and accumulated multiple operations, vector clocks help determine which operations are causally related without server involvement
2. **Fallback for old clients**: Servers continue to accept vector-clock-only operations from clients that haven't been updated

Over time, as all clients update, vector clock comparison on the server becomes a dead code path. It can be removed in a future major version.

Vector clock pruning remains for bandwidth efficiency, but pruning errors no longer cause sync loops because the primary conflict detection uses entity versions.

## Risks

| Risk                                                  | Severity | Mitigation                                                                                              |
| ----------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| Entity version table grows with entity count          | Low      | One row per entity per user; bounded by user data                                                       |
| Client loses entity version (cleared storage)         | Low      | Falls back to vector clock comparison; server returns version on next interaction                       |
| Race condition between version check and update       | Medium   | Use database transaction with `REPEATABLE_READ` isolation (already used for current conflict detection) |
| Two clients upload same entity version simultaneously | Medium   | Only one succeeds (atomic increment); other retries with new version                                    |
| Offline client has stale entity version               | Low      | Server rejects; client downloads latest, creates replacement op with current version                    |
| Schema migration on server                            | Medium   | Additive change (new table, new optional fields); no breaking changes to existing data                  |

## Verification

### Unit Tests

- Server: OCC acceptance and rejection for matching/mismatched versions
- Server: Fallback to vector clock comparison when `entityVersion` absent
- Client: Entity version tracking through upload/download/rejection cycles
- Client: Replacement ops include correct entity version from rejection

### Integration Tests

- Full sync cycle with entity versioning: create, upload, download on second client, modify, upload
- Conflict scenario: two clients upload with same entity version, one succeeds, other retries
- Mixed clients: old client (vector clock only) and new client (entity version) modifying same entity
- Offline scenario: client accumulates ops offline, reconnects, resolves conflicts via entity version

### E2E Tests

- Sync loop regression test: ensure the sync loop scenario from the original bug is impossible with entity versioning

## Relationship to Other Plans

- **Builds on:** [Server-Side Prune-Aware Comparison](./server-side-prune-aware-comparison.md) -- can be implemented in either order; prune-aware comparison improves the vector clock fallback path
- **Related:** Current client-side fix (commit `f9be1c8500`) remains as defense-in-depth for the vector clock fallback path
- **Related:** [E2E Encryption Plan](../sync-and-op-log/long-term-plans/e2e-encryption-plan.md) -- entity versions are not sensitive data and do not need encryption

## Implementation Order

1. **Server: Add `EntityVersion` table and migration** (no client changes needed)
2. **Server: Track entity versions on operation acceptance** (alongside existing vector clock logic)
3. **Server: Return `entityVersion` in upload results and download payloads**
4. **Client: Store and track entity versions from server responses**
5. **Client: Include `entityVersion` in uploaded operations**
6. **Client: Use `currentVersion` from rejections in replacement operations**
7. **Backfill migration for existing entities**
8. **Integration and E2E tests**

Each step is independently deployable and backward compatible.
