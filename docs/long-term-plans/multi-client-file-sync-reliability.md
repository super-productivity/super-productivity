# Making File-Based Sync Reliable with Multiple Concurrent Clients

## Current Vulnerabilities

The single-file approach (`sync-data.json`) has these specific weaknesses when multiple clients sync simultaneously:

### 1. Single retry on upload conflict

`_uploadWithRetry()` (`file-based-sync-adapter.service.ts:474`) retries **exactly once** on rev mismatch. With 3+ clients syncing at similar intervals, the retry can also fail — the second upload attempt has no fallback.

### 2. Wide race window

The upload cycle is: download → read state snapshot → merge ops → encrypt → compress → upload. This can take seconds (especially with large state + archives). Any other client uploading during that window causes a conflict.

### 3. Full state on every upload

Every upload includes the **complete application state** (line 452: `getStateSnapshot()`), both archives, and 500 recent ops. This makes the file large and the upload slow, widening the race window.

### 4. WebDAV revision tracking is coarse

WebDAV uses `lastmod` (seconds resolution) as the revision. Two uploads within the same second can't be distinguished. The `syncVersion` counter inside the file compensates, but only if the file is actually re-downloaded between attempts.

### 5. No atomic CAS for LocalFile

For local file sync (Electron/Android), there's no server-side compare-and-swap. The rev is an MD5 hash computed client-side, but the read-modify-write is not atomic.

## How Bad Is It in Practice?

**It works reasonably well for 2 clients** because:

- The piggybacking mechanism merges concurrent uploads on the retry
- Vector clocks + LWW correctly resolve entity-level conflicts
- The 500-op buffer is generous enough to catch concurrent changes
- Sync intervals (e.g., 5 minutes) usually provide enough separation

**It gets fragile with 3+ clients** or short sync intervals because the single retry isn't enough, and the large file size makes uploads slow.

---

## Three Levels of Improvement

### Level 1: Harden the Single-File Approach (Small Change)

**What**: Fix the most obvious weaknesses without changing the storage model.

**Changes to `file-based-sync-adapter.service.ts`:**

1. **Retry loop with exponential backoff** instead of single retry
   - Replace `_uploadWithRetry()` with a loop: attempt up to 3-5 times
   - Add randomized backoff (200ms, 400ms, 800ms + jitter) between retries
   - Each retry re-downloads, re-merges, re-uploads
   - ~30 lines changed

2. **Lock file before upload** (optional, for providers that support it)
   - Write a `sync.lock` file with client ID + timestamp before uploading
   - Other clients check the lock and skip/wait if it's recent (< 30s)
   - Delete lock after upload
   - Already have precedent: `migration.lock` in the codebase
   - ~50 lines added

3. **WebDAV: use ETag headers** instead of `lastmod` for revision
   - More precise conflict detection
   - Requires checking WebDAV provider implementation

**Pros**: Minimal code change, backward compatible, no migration needed
**Cons**: Still fundamentally limited — single file remains the bottleneck
**Reliability improvement**: Good enough for 3-4 clients with reasonable sync intervals (2+ minutes)

---

### Level 2: Separate Operations from State (Medium Change)

**What**: Split into two files — a **state snapshot** (updated infrequently) and an **operations log** (updated every sync). This reduces contention because most sync cycles only touch the ops file.

**Storage structure:**

```
sync-data.json          → state snapshot (updated every Nth sync or on demand)
sync-ops.jsonl          → append-only operation log (updated every sync)
sync-meta.json          → vector clock + syncVersion + metadata
```

**How it works:**

- **Upload ops**: Append new operations to `sync-ops.jsonl`. This is smaller and faster than rewriting the full state.
- **Download ops**: Read `sync-ops.jsonl`, filter to new ops. Fast because it's just the ops, not the full state.
- **Snapshot update**: Periodically (every 10th sync, or when ops file gets large), rewrite `sync-data.json` with current state and reset `sync-ops.jsonl`.
- **Conflict**: `sync-meta.json` has the `syncVersion` counter. Only contested during uploads, and the file is tiny (fast upload → small race window).

**The key insight**: Most sync cycles don't need to touch the large state file at all. Ops are small. Conflicts on a small file are rare and fast to resolve.

**Pros**: Significantly less contention, smaller uploads, backward-compatible migration path
**Cons**: Three files to manage instead of one; append-only JSONL needs periodic compaction; providers that don't support append (Dropbox) would need to re-upload the ops file
**Reliability improvement**: Handles 4-5+ concurrent clients well

**Files to modify:**

- `file-based-sync-adapter.service.ts` — split upload/download into ops-only and snapshot paths
- `file-based-sync.types.ts` — add new file type constants, ops file format
- Provider interfaces — possibly add `appendFile()` method (or just re-upload the ops file for providers that don't support append)

---

### Level 3: Per-Client Files (Large Change, Most Robust)

**What**: Each client writes only to its own files. Other clients only read. **Zero write conflicts by design.**

**Storage structure:**

```
sp-sync/
  clients/
    <client-id-A>/
      manifest.json                 # Batch list + vector clock (unencrypted)
      ops/
        <timestamp>-<seq>.jsonl     # Immutable operation batch files
      snapshot.json                  # This client's state snapshot (encrypted)
      snapshot-archive-young.json
      snapshot-archive-old.json
    <client-id-B>/
      manifest.json
      ops/
        ...
```

**How it works:**

- **Upload**: Write a new batch file to `clients/<myId>/ops/`, update `manifest.json`. Never modify another client's files.
- **Download**: For each known peer, read `manifest.json` → download new batch files by exact path.
- **Bootstrap**: New client reads any peer's `snapshot.json` for initial state, then catches up with batch files.
- **GC**: Client deletes its own old batch files once all peers' vector clocks show they've advanced past them.

**Why it eliminates conflicts:**

- No two clients ever write the same file
- Batch files are immutable once written (append-only model)
- `manifest.json` is the only mutable file per client, and only the owning client writes it
- Works with ANY file storage: WebDAV, Dropbox, LocalFile, **and** Syncthing/Resilio

**Implementation**: This would be a **new provider** (not modifying existing file-based sync), implementing `OperationSyncCapable` directly. The existing `FileBasedSyncAdapterService` stays unchanged for users who don't need multi-client reliability.

**Pros**: Zero contention, scales to any number of clients, works with folder sync tools
**Cons**: More files to manage, needs directory listing support, biggest implementation effort, needs migration path
**Reliability improvement**: Handles unlimited concurrent clients reliably

**New files:**

- `src/app/op-log/sync-providers/file-based/multi-client/multi-client-sync-adapter.service.ts`
- `src/app/op-log/sync-providers/file-based/multi-client/multi-client-sync.types.ts`
- `src/app/op-log/sync-providers/file-based/multi-client/multi-client-gc.service.ts`

**Modified files:**

- `provider.const.ts` — new provider ID (or config flag on existing providers)
- `provider-manager.service.ts` — register new provider
- `global-config.model.ts` — config for multi-client mode
- `sync-form.const.ts` — UI toggle or separate provider option

---

## Recommendation

**Level 1** (retry + backoff) is a quick win worth doing regardless — it's a small change that makes the current system more robust.

**Level 3** (per-client files) is the correct long-term solution if multi-client reliability is a priority. It also naturally enables Syncthing compatibility as a side effect. Level 2 is a half-measure that adds complexity without fully solving the problem.

The question is whether to go **1 → 3** (quick fix now, proper solution later) or **straight to 3**.

---

## Level 3 Coordination Design

### Do we need `listFiles()`?

**Yes, but only for peer discovery** — and it can be minimized with a manifest approach.

Level 3 needs `listFiles()` for two things:

1. **Discover peers**: List `clients/` directory to find other client IDs
2. **Find batch files**: List `clients/<peerId>/ops/` to find new operation batches

We can eliminate need #2 entirely with **per-client manifest files**. Each client updates its own `manifest.json` with the list of its batch files. Other clients read the manifest by exact path (`clients/<peerId>/manifest.json`) — no directory listing needed.

This reduces `listFiles()` to **just peer discovery** (listing `clients/` once to find new peers). Known peers are cached locally.

### Coordination flow (minimal `listFiles()`)

**First sync / peer discovery** (needs `listFiles()` once):

1. `listFiles('clients/')` → discover peer directories
2. Store known peer IDs locally (localStorage)
3. Read each peer's `manifest.json` → get their batch files + vector clock
4. Download batch files by exact path → apply operations
5. If bootstrapping: read any peer's `snapshot.json` for initial state

**Normal sync cycle** (no `listFiles()` needed):

1. **Upload**: Write new batch file → update own `manifest.json`
2. **Download**: For each known peer, read `manifest.json` → download new batch files
3. **Periodic discovery**: `listFiles('clients/')` occasionally (every Nth cycle) to find new peers

### Can we avoid `listFiles()` entirely?

**Alternatives considered:**

1. **User-configured peers**: User manually enters device IDs. Works for 2-3 devices but bad UX.
2. **Registration file per client**: Each client writes `register/<myId>.json`. Still needs listing `register/` to find peers.
3. **Shared registry file**: One `peers.json` listing all peers. Creates the shared-mutable-file problem we're trying to avoid.

**Verdict**: `listFiles()` is the cleanest solution. The missing implementations are trivial:

- **Electron**: Add `ipcMain.handle(IPC_FILE_SYNC_LIST_FILES, ...)` with `fs.readdirSync()` — ~10 lines
- **Android SAF**: Call `DocumentFile.listFiles()` in Capacitor plugin — natural SAF capability

Implementing `listFiles()` is much simpler than designing a discovery mechanism that avoids it.

### Directory creation requirements

Level 3 needs `clients/<id>/ops/` directories to exist:

- **WebDAV**: Auto-creates parent directories via MKCOL on upload (already implemented)
- **Dropbox**: `create_folder_v2` API (already available in the Dropbox API)
- **Electron**: `fs.mkdirSync(path, { recursive: true })` — add to IPC handler
- **Android SAF**: `DocumentFile.createDirectory()` — add to Capacitor plugin

### Level 3 prerequisites by provider

| Prerequisite                  | WebDAV       | Dropbox                  | Electron                          | Android                        |
| ----------------------------- | ------------ | ------------------------ | --------------------------------- | ------------------------------ |
| `listFiles()`                 | exists       | exists                   | **needs IPC handler** (~10 lines) | **needs implementation**       |
| Directory creation            | auto (MKCOL) | needs `createDir()` call | needs `mkdirSync()` call          | needs `createDirectory()` call |
| `uploadFile()` to subdirs     | works        | works                    | works                             | works                          |
| `downloadFile()` from subdirs | works        | works                    | works                             | works                          |

---

## Additional Findings

### Pre-existing bug: Stale piggyback after retry

In `_uploadOps()` (line 662), `_collectPiggybackedOps()` uses `existingOps` captured _before_ the retry in `_uploadWithRetry()`. If the retry downloads fresh data containing new remote ops from a third client, those ops are never piggybacked to the caller. This is a data loss vector that gets **worse with more retries** — should be fixed alongside Level 1.

### Unused checksum field

`FileBasedSyncData` already has an unused `checksum?: string` field (line 83 in `file-based-sync.types.ts`). Could be leveraged for integrity verification in any level of improvement.

### Confirmed in the wild

Recent commit `87d884ed17` ("fix(sync): prevent recurring task duplication across clients") confirms multi-client sync issues are a real problem users hit, not just theoretical.

### Electron LocalFile also missing `listFiles()`

The IPC event `FILE_SYNC_LIST_FILES` is defined in `ipc-events.const.ts:46` and exposed in `preload.ts:47-48`, but there is **no `ipcMain.handle()` implementation** in the Electron main process. So `listFiles()` is missing on both Android SAF and Electron LocalFile.

### Directory creation varies by provider

- **WebDAV**: Auto-creates parent directories via MKCOL on upload (lines 314-345 in `webdav-api.ts`)
- **Dropbox & LocalFile**: Do NOT auto-create directories — uploads fail if parent doesn't exist
