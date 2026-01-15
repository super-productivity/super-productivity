# Vector Clocks in Super Productivity Sync

**Last Updated:** December 2025

## Overview

Super Productivity uses vector clocks to provide accurate conflict detection and resolution in its synchronization system. This document explains how vector clocks work, why they're used, and how they integrate with both the legacy PFAPI sync and the newer Operation Log sync infrastructure.

> **Related Documentation:**
>
> - [Operation Log Architecture](/docs/sync-and-op-log/operation-log-architecture.md) - How vector clocks are used in the operation log
> - [Operation Log Diagrams](/docs/sync-and-op-log/operation-log-architecture-diagrams.md) - Visual diagrams including conflict detection

## Table of Contents

1. [What are Vector Clocks?](#what-are-vector-clocks)
2. [Why Vector Clocks?](#why-vector-clocks)
3. [Implementation Details](#implementation-details)
4. [Migration from Lamport Timestamps](#migration-from-lamport-timestamps)
5. [API Reference](#api-reference)
6. [Examples](#examples)

## What are Vector Clocks?

A vector clock is a data structure used in distributed systems to determine the partial ordering of events and detect causality violations. Each client/device maintains its own component in the vector, incrementing it on local updates.

### Structure

```typescript
interface VectorClock {
  [clientId: string]: number;
}

// Example:
{
  "desktop_1234": 5,
  "mobile_5678": 3,
  "web_9012": 7
}
```

### Comparison Results

Vector clocks can have four relationships:

1. **EQUAL**: Same values for all components
2. **LESS_THAN**: A happened before B (all components of A ≤ B)
3. **GREATER_THAN**: B happened before A (all components of B ≤ A)
4. **CONCURRENT**: Neither happened before the other (true conflict)

## Why Vector Clocks?

### Problem with Lamport Timestamps

Lamport timestamps provide a total ordering but can't distinguish between:

- Changes made after syncing (sequential)
- Changes made independently (concurrent)

This leads to false conflicts where user intervention is required even though one device is clearly ahead.

### Benefits of Vector Clocks

1. **Accurate Conflict Detection**: Only reports conflicts for truly concurrent changes
2. **Automatic Resolution**: Can auto-merge when one vector dominates another
3. **Device Tracking**: Maintains history of which device made which changes
4. **Reduced User Interruptions**: Fewer false conflicts mean better UX

## Implementation Details

### File Structure

```
src/app/
├── sync/                        # Sync providers and utilities
│   ├── util/
│   │   └── vector-clock.ts      # Core vector clock operations
│   └── providers/               # WebDAV, Dropbox, SuperSync, etc.
└── op-log/                      # Operation log system
    └── sync/
        └── vector-clock.service.ts  # Vector clock management for op-log
```

### Core Operations

#### 1. Increment on Local Change

```typescript
// When user modifies data
const newVectorClock = incrementVectorClock(currentVectorClock, clientId);
```

#### 2. Merge on Sync

```typescript
// When downloading remote changes
const mergedClock = mergeVectorClocks(localVector, remoteVector);
```

#### 3. Compare for Conflicts

```typescript
const comparison = compareVectorClocks(localVector, remoteVector);
if (comparison === VectorClockComparison.CONCURRENT) {
  // True conflict - user must resolve
}
```

### Integration Points

1. **MetaModelCtrl**: Increments vector clock on every local change
2. **SyncService**: Merges vector clocks during download, includes in upload
3. **getSyncStatusFromMetaFiles**: Uses vector clocks for conflict detection

## Vector Clock Implementation

The system uses vector clocks exclusively for conflict detection:

### How It Works

- Each client maintains its own counter in the vector clock
- Counters increment on local changes only
- Vector clocks are compared to detect concurrent changes
- No false conflicts from timestamp-based comparisons

### Current Fields

| Field                   | Purpose                          |
| ----------------------- | -------------------------------- |
| `vectorClock`           | Track changes across all clients |
| `lastSyncedVectorClock` | Track last synced state          |

## API Reference

### Core Functions

#### `initializeVectorClock(clientId: string, initialValue?: number): VectorClock`

Creates a new vector clock for a client.

#### `compareVectorClocks(a: VectorClock, b: VectorClock): VectorClockComparison`

Determines the relationship between two vector clocks.

#### `incrementVectorClock(clock: VectorClock, clientId: string): VectorClock`

Increments the client's component in the vector clock.

#### `mergeVectorClocks(a: VectorClock, b: VectorClock): VectorClock`

Merges two vector clocks by taking the maximum of each component.

#### `hasVectorClockChanges(current: VectorClock, reference: VectorClock): boolean`

Checks if current has any changes compared to reference.

### Helper Functions

#### `vectorClockToString(clock: VectorClock): string`

Returns human-readable representation for debugging.

#### `lamportToVectorClock(lamport: number, clientId: string): VectorClock`

Converts Lamport timestamp to vector clock for migration.

## Examples

### Example 1: Simple Sequential Updates

```typescript
// Device A makes a change
deviceA.vectorClock = { A: 1 };

// Device A syncs to cloud
cloud.vectorClock = { A: 1 };

// Device B downloads
deviceB.vectorClock = { A: 1 };

// Device B makes a change
deviceB.vectorClock = { A: 1, B: 1 };

// When A tries to sync, vector clock shows B is ahead
// Result: A downloads B's changes (no conflict)
```

### Example 2: Concurrent Updates (True Conflict)

```typescript
// Both devices start synced
deviceA.vectorClock = { A: 1, B: 1 };
deviceB.vectorClock = { A: 1, B: 1 };

// Both make changes before syncing
deviceA.vectorClock = { A: 2, B: 1 }; // A incremented
deviceB.vectorClock = { A: 1, B: 2 }; // B incremented

// Comparison shows CONCURRENT - neither dominates
// Result: User must resolve conflict
```

### Example 3: Complex Multi-Device Scenario

```typescript
// Three devices with different states
desktop.vectorClock = { desktop: 5, mobile: 3, web: 2 };
mobile.vectorClock = { desktop: 4, mobile: 3, web: 2 };
web.vectorClock = { desktop: 4, mobile: 3, web: 7 };

// Desktop vs Mobile: Desktop is ahead (5 > 4)
// Desktop vs Web: Concurrent (desktop has 5 vs 4, but web has 7 vs 2)
// Mobile vs Web: Web is ahead (7 > 2, everything else equal)
```

### Example 4: Vector Clock Dominance (SYNC_IMPORT Handling)

When a client receives a full state import (SYNC_IMPORT), it must replay local synced operations that happened "after" the import. Vector clock comparison determines which ops are "dominated" (happened-before) vs "not dominated" (happened-after or concurrent).

```typescript
// Client receives SYNC_IMPORT with this vector clock:
const syncImportClock = { clientA: 10, clientB: 5 };

// Local synced operations to evaluate:
const op1 = { vectorClock: { clientB: 1 } }; // LESS_THAN - dominated
const op2 = { vectorClock: { clientA: 5, clientB: 3 } }; // LESS_THAN - dominated
const op3 = { vectorClock: { clientB: 6 } }; // GREATER_THAN - NOT dominated
const op4 = { vectorClock: { clientA: 10, clientB: 5, clientC: 1 } }; // CONCURRENT - NOT dominated

// Only op3 and op4 should be replayed
// op1 and op2 are dominated - their state is already in the SYNC_IMPORT

// Comparison logic:
const comparison = compareVectorClocks(op.vectorClock, syncImportClock);
if (comparison === VectorClockComparison.LESS_THAN) {
  // Op is dominated - skip (state already captured in SYNC_IMPORT)
  return false;
}
// EQUAL, GREATER_THAN, or CONCURRENT - replay the op
return true;
```

**Why This Matters:**

- **LESS_THAN** (dominated): The op's changes are already reflected in the SYNC_IMPORT snapshot. Replaying would be redundant or cause issues.
- **GREATER_THAN**: The op happened after the SYNC_IMPORT was created. Must replay to preserve local work.
- **CONCURRENT**: The op happened independently of the SYNC_IMPORT. Must replay because it may contain unique changes not in the snapshot.
- **EQUAL**: Edge case where clocks match exactly. Safe to replay.

See the operation log architecture docs for detailed diagrams of this late-joiner replay scenario.

## Debugging

### Enable Verbose Logging

```typescript
// In op-log/util/log.ts, set log level to 2 or higher
opLog(2, 'Vector clock comparison', {
  localVector: vectorClockToString(localVector),
  remoteVector: vectorClockToString(remoteVector),
  result: comparison,
});
```

### Common Issues

1. **Clock Drift**: Ensure client IDs are stable and unique
2. **Migration Issues**: Check both vector clock and Lamport fields during transition
3. **Overflow Protection**: Clocks reset to 1 when approaching MAX_SAFE_INTEGER

## Best Practices

1. **Always increment** on local changes
2. **Always merge** when receiving remote data
3. **Never modify** vector clocks directly
4. **Use backwards-compat** helpers during migration period
5. **Log vector states** when debugging sync issues

## Current Implementation Status

| Feature                         | Status         | Notes                                  |
| ------------------------------- | -------------- | -------------------------------------- |
| Vector clock conflict detection | ✅ Implemented | Used by both PFAPI and Operation Log   |
| Entity-level conflict detection | ✅ Implemented | Operation Log tracks per-entity clocks |
| User conflict resolution UI     | ✅ Implemented | `DialogConflictResolutionComponent`    |
| Client pruning (max 50 entries) | ✅ Implemented | `limitVectorClockSize()`               |
| Overflow protection             | ✅ Implemented | Clocks reset at MAX_SAFE_INTEGER       |

## Future Improvements

1. **Automatic Resolution**: Field-level LWW for non-critical fields
2. **Visualization**: Add UI to show vector clock states for debugging
3. **Performance**: Optimize comparison for very large clocks

## Operation Log Integration

The Operation Log system uses vector clocks in several ways:

1. **Per-Operation Clocks**: Each operation carries a vector clock for causality tracking
2. **Entity Frontier**: `VectorClockService` tracks the "frontier" clock per entity
3. **Conflict Detection**: `detectConflicts()` compares clocks between pending local ops and remote ops
4. **SYNC_IMPORT Handling**: Vector clock dominance filtering determines which ops to replay after full state imports

For detailed information, see [Operation Log Architecture - Part C: Server Sync](/docs/sync-and-op-log/operation-log-architecture.md#part-c-server-sync).
