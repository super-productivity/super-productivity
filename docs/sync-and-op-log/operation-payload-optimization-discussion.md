# Operation Payload Optimization Discussion

**Date:** December 5, 2025
**Context:** Analysis of operation payload sizes and optimization opportunities

---

## Initial Analysis

We analyzed the codebase for occasions when many or very large operations are produced.

### Issues Identified

| Issue                             | Severity | Impact                             |
| --------------------------------- | -------- | ---------------------------------- |
| Tag deletion cascade              | **High** | Creates N+1 operations for N tasks |
| Full payload storage              | **High** | Large payloads stored repeatedly   |
| batchUpdateForProject nesting     | Medium   | Single op contains nested array    |
| Archive operations                | Medium   | One bulk op for many tasks         |
| Single operations per bulk entity | Medium   | N operations instead of 1          |

### Fixes Implemented

1. **Payload size monitoring** - Added `LARGE_PAYLOAD_WARNING_THRESHOLD_BYTES` (10KB) and logging when exceeded
2. **Bulk task-repeat-cfg operations** - Tag deletion now uses bulk delete instead of N individual operations
3. **Batch operation chunking** - `batchUpdateForProject` now chunks large operations into batches of `MAX_BATCH_OPERATIONS_SIZE` (50)

---

## Archive Operation Deep Dive

The `moveToArchive` action was identified as having large payloads (~2KB per task). We explored multiple optimization approaches.

### The Core Problem

Two sync systems exist:

1. **Operation Log (SuperSync)** - Real-time operation sync
2. **PFAPI** - Model file sync (daily for archive files)

When Client A archives tasks:

- Operation syncs immediately
- `archiveYoung` model file syncs later (daily)

When Client B receives the operation:

- Must write tasks to local archive
- But tasks are deleted from originating client's state
- Archive file hasn't synced yet

**The operation must carry full task data.**

### Solutions Explored

#### Option A: Hybrid Payload with Private Field

```typescript
moveToArchive: {
  taskIds: string[],      // Persisted
  _tasks: TaskWithSubTasks[]  // Stripped before storage
}
```

**Problem:** Remote operations won't have `_tasks` - still need full data for sync.

#### Option B: Meta-Reducer Enrichment

Capture tasks from state before deletion, attach to action for effect.

**Why it seemed possible:**

- Dependency resolution ensures `addTask` ops applied before `moveToArchive`
- Tasks exist in remote client's state when operation arrives
- Meta-reducer runs before main reducer

**Problems:**

- Complex action mutation
- Meta-reducers should be pure
- Awkward async queue from sync reducer

#### Option C: Two-Phase Archive

Split into `writeToArchive` (full data) + `deleteTasks` (IDs only).

**Problem:** Same total payload size. Just added complexity without benefit.

#### Option D: Operation-Derived Archive Store

Archive becomes a separate IndexedDB store populated entirely by operations:

```typescript
archiveTask: { taskIds: string[] }  // IDs only
```

Meta-reducer moves task data from active state to archive before deletion.

**Benefits:**

- Tiny payloads
- Single source of truth
- No PFAPI archive sync needed

**Drawbacks:**

1. Migration complexity (years of existing archive data)
2. Initial sync must replay ALL archive ops (20K+ for heavy users)
3. Operation log growth (archive ops span years)
4. Compaction complexity (must preserve archive state)
5. Two storage systems to coordinate
6. PFAPI compatibility during transition
7. Query performance for 20K+ tasks

### The Scale Concern

> "There can be more than 20,000 archived tasks"

If archive was in NgRx store:

- Selectors iterate 20K+ entities
- Entity adapter operations slow down
- Memory bloat on app start
- DevTools unusable

This ruled out simple "add isArchived flag" approaches.

### Key Insight: Dependency Resolution

Operations have causal ordering. When remote client receives `moveToArchive`:

1. `addTask` operations already applied (dependency)
2. Task exists in remote client's active state
3. Could theoretically look up from state before deletion

But the effect runs AFTER the reducer deletes entities. The timing makes this approach impractical without complex meta-reducer side effects.

---

## Final Decision

**Keep the current full-payload approach.**

### Rationale

1. **It works correctly** - Already implemented, tested, documented
2. **Sync reliability** - No edge cases or timing issues
3. **Simplicity** - Single action, clear semantics
4. **Acceptable size** - ~100KB for 50 tasks is manageable
5. **Infrequent operation** - Archiving happens at end of day, not constantly

### Mitigation

For very large archives, chunk operations:

```typescript
const ARCHIVE_CHUNK_SIZE = 25;

async moveToArchive(tasks: TaskWithSubTasks[]): Promise<void> {
  const chunks = chunkArray(parentTasks, ARCHIVE_CHUNK_SIZE);
  for (const chunk of chunks) {
    this._store.dispatch(TaskSharedActions.moveToArchive({ tasks: chunk }));
  }
  await this._archiveService.moveTasksToArchiveAndFlushArchiveIfDue(parentTasks);
}
```

### Trade-off Summary

| Approach                  | Payload Size      | Complexity | Reliability |
| ------------------------- | ----------------- | ---------- | ----------- |
| Full payload (current)    | Large (~2KB/task) | Low        | High        |
| Meta-reducer enrichment   | Small             | High       | Medium      |
| Two-phase archive         | Same as current   | Higher     | High        |
| Operation-derived archive | Small             | Very High  | Medium      |

**The payload size reduction doesn't justify the added complexity.**

---

## Related Documentation

- `archive-operation-redesign.md` - Detailed analysis of archive options
- `code-audit.md` - Overall operation compliance audit
- `operation-size-analysis.md` - Initial payload size analysis

---

## Future Considerations

If payload size becomes a real problem (not theoretical), revisit Option D (operation-derived archive) with:

1. Proper migration plan for existing PFAPI data
2. Compaction strategy for long-lived archive operations
3. Performance testing with 20K+ tasks
4. PFAPI compatibility during transition

**Alternative Optimization:**

5. **Payload Compression**: Since task data (text/JSON) compresses extremely well (often >90%), we could compress the `_tasks` payload within the `moveToArchive` operation (e.g., using LZ-string or GZIP) before sending. This would solve the size concern without requiring the architectural overhaul of Option D.

Until then, current approach is the right balance.
