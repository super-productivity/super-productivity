# SuperSync Synchronization Scenarios

Comprehensive spec of all scenarios that can occur during SuperSync synchronization, and the expected behavior for each.

---

## A. Normal Sync

### A.1: Standard Incremental Sync (no conflicts)

**Trigger:** Automatic 1-minute timer or manual sync

**Expected:**
1. Download new remote ops since `lastServerSeq`
2. Schema-migrate each op (receiver-side)
3. Filter ops invalidated by any SYNC_IMPORT (vector clock comparison)
4. Detect conflicts via vector clocks against local entity frontier
5. No conflicts → apply ops to NgRx store
6. Upload pending local ops (encrypted if encryption enabled, batched at 25 per request)
7. Process piggybacked ops from upload response
8. Handle any rejections
9. Status → `IN_SYNC`

**User sees:** Sync indicator briefly shows syncing, then double-checkmark.

### A.2: Sync with Piggybacked Ops

**Trigger:** Upload response includes ops from other clients

**Expected:**
1. Upload local ops
2. Server returns piggybacked ops in response
3. Piggybacked ops processed **before** marking rejected ops (critical ordering for correct conflict detection)
4. If no conflicts → apply directly
5. If conflicts → LWW auto-resolution

**User sees:** Seamless merge, no dialog.

### A.3: No Changes on Either Side

**Trigger:** Sync fires but no new ops anywhere

**Expected:**
1. Download → 0 new ops
2. Upload → 0 pending ops
3. `lastServerSeq` updated even with no ops (keeps client in sync with server)
4. Status → `IN_SYNC`

**User sees:** Quick sync, double-checkmark.

---

## B. Conflict Scenarios

### B.1: Concurrent Modification — LWW Auto-Resolution

**Trigger:** Two clients edit the same entity between syncs

**Expected:**
1. Download remote ops
2. Conflict detection: op's vectorClock is `CONCURRENT` with local entity frontier
3. `ConflictResolutionService.autoResolveConflictsLWW()`:
   - Compare timestamps → later write wins
   - Create merged op with winning data + merged vector clock
4. Merged op applied to store, marked as pending
5. On next sync, merged op uploaded
6. Other client downloads merged op — no further conflict (merged clock dominates both)

**User sees:** No dialog. One client's change silently wins based on timestamp.

### B.2: Server Rejects Op — CONFLICT_CONCURRENT

**Trigger:** Server already has a conflicting op for the same entity

**Expected:**
1. Upload op → server rejects with `CONFLICT_CONCURRENT`
2. Piggybacked ops processed first (may contain the winning remote version)
3. `RejectedOpsHandlerService`:
   - Trigger download to get the conflicting op
   - If new ops found: conflict detection resolves it
   - If no new ops: create merged op with current state + merged vector clock
4. Merged op marked pending, uploaded on next sync

**User sees:** Sync completes normally (auto-resolved). Possible brief delay.

### B.3: Permanent Rejection (VALIDATION_ERROR)

**Trigger:** Op has invalid data the server won't accept

**Expected:**
1. Upload op → server rejects with `VALIDATION_ERROR`
2. Op marked as rejected in IndexedDB (won't retry)
3. `permanentRejectionCount > 0` → status set to `ERROR`

**User sees:** Error indicator. Op is lost (won't retry).

### B.4: Payload Too Large

**Trigger:** Single op or batch exceeds server size limit

**Expected:**
1. Server returns 413 or error mentioning "Payload too large/complex"
2. `alertDialog()` shown (maximum visibility)
3. Status → `ERROR`
4. Return `HANDLED_ERROR`

**User sees:** Alert dialog explaining the issue. Sync stops.

### B.5: Infinite Conflict Loop Prevention

**Trigger:** Same entity keeps getting rejected due to vector clock pruning artifacts

**Expected:**
1. After `MAX_CONCURRENT_RESOLUTION_ATTEMPTS` (configurable) retries for the same entity
2. Give up: mark op as permanently rejected
3. Clear attempt counter

**User sees:** Snackbar warning. Op permanently rejected.

---

## C. Fresh / New Client Scenarios

### C.1: Fresh Client — No Local Data

**Trigger:** Brand new client (no op history, no meaningful store data) syncs for first time

**Expected:**
1. `isWhollyFreshClient()` = true
2. `_hasMeaningfulLocalData()` = false
3. Show native `confirmDialog()`: "Initial Sync — This appears to be a fresh installation. Remote data with X changes was found. Do you want to download and overwrite your local data with it?"
4. If confirmed → download and apply all remote ops
5. If cancelled → snackbar "Sync cancelled", no data applied

**User sees:** Simple OK/Cancel confirmation.

### C.2: Fresh Client — Has Local Data (pre-op-log era)

**Trigger:** Client has tasks/projects/tags in NgRx but no operation log history

**Expected:**
1. `isWhollyFreshClient()` = true
2. `_hasMeaningfulLocalData()` = true (checks for tasks, non-INBOX projects, non-system tags, notes)
3. Throw `LocalDataConflictError`
4. Show full conflict dialog: USE_LOCAL / USE_REMOTE / CANCEL
5. USE_LOCAL → `forceUploadLocalState()` (creates SYNC_IMPORT)
6. USE_REMOTE → `forceDownloadRemoteState()` (clears local ops)

**User sees:** Full conflict resolution dialog.

### C.3: Fresh Client — Has Pending Ops with Meaningful User Data (File-Based Sync Only)

**Trigger:** Client has unsynced ops containing task/project/tag/note create/update actions, receiving a snapshot from a file-based provider

**Expected:**
1. Download detects remote snapshot (file-based sync path)
2. Check unsynced ops for meaningful user data: TASK/PROJECT/TAG/NOTE CREATE/UPDATE ops, or any full-state op (SYNC_IMPORT/BACKUP_IMPORT/REPAIR)
3. If meaningful → throw `LocalDataConflictError` → full conflict dialog
4. If only config/system ops → proceed without dialog

**Note:** This op-content check only applies to the file-based snapshot path. For SuperSync (incremental ops path), the fresh client check uses `_hasMeaningfulLocalData()` (store-based check) instead.

**User sees:** Conflict dialog only when real user data would be lost.

---

## D. SYNC_IMPORT Scenarios

### D.1: Incoming Remote SYNC_IMPORT — No Local Pending Ops

**Trigger:** Another client uploaded a SYNC_IMPORT (file import, encryption enable, etc.)

**Expected:**
1. Download batch contains SYNC_IMPORT/BACKUP_IMPORT/REPAIR
2. Check pending local ops → 0
3. `processRemoteOps()` applies the full-state op (replaces NgRx store)
4. No conflict detection (full-state ops skip it)
5. Other ops in the batch filtered by vector clock comparison against the import

**User sees:** Data replaced seamlessly. No dialog.

### D.2: Incoming Remote SYNC_IMPORT — Has Local Pending Ops

**Trigger:** Another client uploaded SYNC_IMPORT while this client has unsynced local ops

**Expected:**
1. Download batch contains SYNC_IMPORT
2. Check pending local ops → N > 0
3. **Show conflict dialog BEFORE processing** (prevents silent data loss)
4. USE_LOCAL → `forceUploadLocalState()` (overrides remote with local data)
5. USE_REMOTE → `forceDownloadRemoteState()` (clears local ops, downloads from seq 0)
6. CANCEL → return with `cancelled: true`, skip upload phase

**User sees:** Conflict dialog explaining remote import detected with local changes at risk.

### D.3: Remote Ops Filtered by Stored Local SYNC_IMPORT

**Trigger:** This client created a SYNC_IMPORT (e.g., file import, enableEncryption). Later, ops from other clients arrive that are `CONCURRENT` with the import.

**Expected:**
1. `SyncImportFilterService` filters incoming remote ops against stored local import
2. Vector clock comparison: `CONCURRENT` or `LESS_THAN` → filtered
3. `isLocalUnsyncedImport` = true (import source is 'local')
4. **Show conflict dialog** (this client created the import, user should decide about other clients' data)
5. USE_LOCAL → `forceUploadLocalState()`
6. USE_REMOTE → `forceDownloadRemoteState()`

**User sees:** Conflict dialog. Prevents silent data loss from other clients.

### D.4: Remote Ops Filtered by Stored Remote SYNC_IMPORT

**Trigger:** A previously-downloaded remote SYNC_IMPORT filters subsequent remote ops

**Expected:**
1. `SyncImportFilterService` filters incoming remote ops against stored remote import
2. `isLocalUnsyncedImport` = false (import source is 'remote')
3. **Silent filter** — no dialog
4. Log: "N remote ops silently filtered by remote SYNC_IMPORT"

**User sees:** Nothing. This is correct — the import was already accepted from the remote source. Old concurrent ops are intentionally discarded (clean slate semantics).

### D.5: Same-Client Ops After SYNC_IMPORT (Pruning Artifact)

**Trigger:** Ops from the same client that created the SYNC_IMPORT appear `CONCURRENT` due to vector clock pruning

**Expected:**
1. Vector clock comparison returns `CONCURRENT`
2. Special check: `op.clientId === import.clientId && op.vectorClock[op.clientId] > importClock[op.clientId]`
3. Keep the op (a client can't create ops concurrent with its own import)

**User sees:** Nothing. Ops applied normally.

---

## E. Encryption Scenarios

### E.1: Enable Encryption

**Trigger:** User clicks "Enable Encryption" in sync settings or initial setup prompt

**Expected:**
1. Check WebCrypto availability (fail early on Android/insecure context)
2. `runWithSyncBlocked()` blocks concurrent syncs
3. Delete all server data (`deleteAllData()`)
4. Update local config: `isEncryptionEnabled=true, encryptKey=key`
5. Encrypt state snapshot
6. Upload encrypted snapshot via snapshot endpoint
7. Update `lastServerSeq`
8. Unblock sync
9. If upload fails after delete: **revert config**, show error with recovery instructions

**User sees:** Encryption dialog → "Encrypting..." → success snackbar. Lock icon appears.

**Other clients:** Next sync gets `DecryptNoPasswordError` → password dialog.

### E.2: Disable Encryption

**Trigger:** User clicks "Disable Encryption" in sync settings

**Expected:**
1. Confirmation dialog required
2. `runWithSyncBlocked()`
3. Delete all server data
4. Upload unencrypted snapshot
5. Update config: `isEncryptionEnabled=false, encryptKey=undefined`
6. Clear wrapper cache

**User sees:** Confirmation → "Disabling..." → success snackbar. Lock icon disappears.

**Other clients:** Auto-detect unencrypted data → automatically disable local encryption → snackbar warning.

### E.3: Change Encryption Password

**Trigger:** User enters new password in "Enter Encryption Password" dialog with "Use Local Data" option

**Expected:**
1. `runWithSyncBlocked()`
2. Check for unsynced ops (error unless `allowUnsyncedOps=true`)
3. `CleanSlateService.createCleanSlate()`:
   - Generate new client ID
   - Clear all local op history
   - Create fresh SYNC_IMPORT operation
4. Update config: `encryptKey = newPassword`
5. Clear derived key cache
6. Upload SYNC_IMPORT with `isCleanSlate=true` (server deletes all existing data)

**User sees:** Confirmation → "Changing password..." → success.

**Other clients:** Decryption fails with old password → password dialog.

### E.4: Wrong/Missing Encryption Password During Download

**Trigger:** Server has encrypted data but client has no/wrong password

**Expected:**
1. Download encrypted ops → decryption fails
2. Throw `DecryptError` or `DecryptNoPasswordError`
3. Set status → `ERROR`
4. Open `DialogEnterEncryptionPasswordComponent`:
   - **"Save & Sync"**: save password → retry sync
   - **"Use Local Data"**: `changePassword(enteredPassword, {allowUnsyncedOps: true})` → overwrite server with local encrypted data
   - **Cancel**: close dialog, status stays `UNKNOWN_OR_CHANGED`

**User sees:** Error icon → password dialog with two options.

### E.5: Encryption State Mismatch (Remote Disabled)

**Trigger:** Another client disabled encryption; this client still has encryption enabled

**Expected:**
1. Download/upload response: `serverHasOnlyUnencryptedData = true`
2. Local config has `encryptKey` set
3. Auto-update config: `isEncryptionEnabled=false, encryptKey=undefined`
4. Show snackbar: "Encryption disabled on another device"
5. Next sync uses unencrypted mode

**User sees:** Warning snackbar. Lock icon disappears.

### E.6: Encryption Prompt After Every Successful SuperSync Sync (Until Encrypted)

**Trigger:** SuperSync active without encryption, sync completes successfully

**Expected:**
1. After `sync()` returns `InSync`
2. Check: provider is SuperSync AND encryption not enabled AND not already showing dialog
3. Open `DialogEnableEncryptionComponent` in `initialSetup` mode with `disableClose: true`
4. User MUST set password → `enableEncryption()` flow (E.1)
5. OR user clicks Cancel → **sync is disabled entirely** (`disableSuperSync()` sets `isEnabled: false`)
6. Dialog closes → if encryption was set, `sync()` fires again to re-sync with encryption

**User sees:** Encryption dialog after every sync until encryption is enabled. The only escape is to disable sync. There is no "skip" option — encryption is effectively mandatory for SuperSync.

### E.7: Encryption Operation Blocks Concurrent Sync

**Trigger:** Sync fires while password change/enable/disable in progress

**Expected:**
1. `_isEncryptionOperationInProgress` = true
2. `sync()` checks flag → return `HANDLED_ERROR` immediately
3. Log: "Sync blocked: encryption operation in progress"
4. After encryption operation completes → flag cleared → next sync proceeds

**User sees:** Sync silently skipped. Resumes automatically.

### E.8: File Import Preserves Encryption State

**Trigger:** User imports data from file while encryption is enabled

**Expected:**
1. `loadAllData` reducer preserves `isEncryptionEnabled` as local-only setting (not overwritten by imported config)
2. `ImportEncryptionHandlerService`: if import would disable encryption → skip
3. Encryption stays enabled after import

**User sees:** Data imported, encryption unchanged.

---

## F. Server Migration

### F.1: Client Reconnects to New/Empty Server

**Trigger:** `lastServerSeq === 0` AND server empty AND client has previously synced ops

**Expected:**
1. Detect during upload via `ServerMigrationService.checkAndHandleMigration()`
2. Double-check server is still empty
3. Create SYNC_IMPORT with full current state + merged vector clocks from all local ops
4. Upload SYNC_IMPORT as snapshot
5. Other clients download SYNC_IMPORT on their next sync

**User sees:** Upload takes slightly longer (full state). No dialog.

### F.2: Migration Aborted — Server No Longer Empty

**Trigger:** Another client uploaded between the download check and the upload check

**Expected:**
1. Fresh server check finds data (`latestSeq !== 0`)
2. Abort migration (don't create SYNC_IMPORT)
3. Continue with normal upload of pending ops

**User sees:** Normal sync. No migration needed.

---

## G. Error / Edge Cases

### G.1: Network Timeout

**Expected:** Snackbar warning. Ops remain pending. Retry on next sync.

### G.2: CORS Error

**Expected:** Snackbar with detailed error message (12s duration). Status `HANDLED_ERROR`.

### G.3: Authentication Failure

**Expected:**
1. Clear stale credentials
2. Snackbar with "CONFIGURE" action button
3. User re-enters credentials via dialog

### G.4: Transient Server Error (INTERNAL_ERROR)

**Expected:** Op stays pending (not marked rejected). Silent retry on next sync.

### G.5: Duplicate Operation

**Expected:** Server rejects as duplicate → client marks op as synced. No error shown.

### G.6: Storage Quota Exceeded

**Expected:** Alert dialog (maximum visibility). Ops stay pending. Needs admin intervention.

### G.7: Version Mismatch (Schema Too New)

**Expected:** Log warning ("Remote model version newer than local — app update may be required"). Returns `HANDLED_ERROR`. No alert shown to user. User needs to update app.

### G.8: Operation Migration Failure

**Expected:** Failed ops skipped. Snackbar shown once per session. Other ops applied normally.

### G.9: Concurrent Sync Attempts

**Expected:** Second attempt returns immediately. "Sync already in progress" logged.

### G.10: App Closes During Sync

**Expected:** Pending ops preserved in IndexedDB. Sync resumes on next app open.

---

## H. Multi-Client Interaction Scenarios

### H.1: Client A Enables Encryption, Client B Has Pending Ops

**Expected flow:**
1. Client A: `enableEncryption()` → deletes server, uploads encrypted SYNC_IMPORT
2. Client B syncs: downloads SYNC_IMPORT
3. Client B has pending local ops → **conflict dialog shown**
4. USE_LOCAL: force upload local state (encrypted with the password Client B has)
5. USE_REMOTE: `forceDownloadRemoteState()` → resets to seq 0, re-downloads encrypted data → if Client B has no password, fails with `DecryptNoPasswordError` → password dialog → user enters password → re-sync
6. CANCEL: skip sync, status stays `UNKNOWN_OR_CHANGED`

**Previously broken:** Client B's ops were silently discarded → deadlock.

### H.2: Client A Changes Password, Client B Uses Old Password

**Expected flow:**
1. Client A: `changePassword()` → clean slate, new SYNC_IMPORT encrypted with new password
2. Client B syncs: decryption fails (old password)
3. Password dialog shown
4. User enters new password → sync resumes
5. If user doesn't know new password → "Use Local Data" option overwrites server

### H.3: Client A Imports File, Client B Has Changes

**Expected flow:**
1. Client A: file import → creates local SYNC_IMPORT (unsynced)
2. Client A syncs: uploads SYNC_IMPORT
3. Client B syncs: downloads SYNC_IMPORT
4. Client B has pending ops → conflict dialog
5. Client B chooses USE_LOCAL or USE_REMOTE

### H.4: Both Clients Import/Force-Upload Simultaneously

**Expected flow:**
1. Client A uploads SYNC_IMPORT first → server accepts
2. Client B uploads SYNC_IMPORT → server rejects (or accepts with higher seq)
3. Resolution depends on server behavior:
   - If rejected: Client B downloads A's import, conflict dialog
   - If accepted: last-write-wins at the server level

### H.5: Three Clients, Normal Concurrent Edits

**Expected flow:**
1. Each client edits different entities → no conflicts, all merge cleanly
2. Each client edits same entity → LWW auto-resolution, last timestamp wins
3. Vector clocks ensure causal ordering across all clients

---

## I. Setup & Provider-Switching Scenarios

### I.1: First-Time SuperSync Setup — Brand New User (No Existing Data)

**Trigger:** User opens sync settings for the first time, selects SuperSync, enters access token

**Expected:**
1. `DialogSyncInitialCfgComponent` opens
2. `_isInitialSetup = true` → hides encryption button/warning in form (handled separately)
3. User fills in SuperSync access token
4. `save()` → strip `_isInitialSetup` flag → save config → auth if needed
5. Check: SuperSync selected AND encryption not enabled → open `DialogEnableEncryptionComponent` with `initialSetup: true`
6. User sets password → `enableEncryption()`:
   - Check WebCrypto → delete server (empty, no-op) → update config → encrypt snapshot → upload
7. OR user clicks Cancel → `disableSuperSync()` disables sync entirely (no "skip" option exists)
8. Dialog closes → `sync()` fires (if sync is still enabled)
9. `isWhollyFreshClient()` = true → nothing to download from empty server
10. Status → `IN_SYNC`

**User sees:** Setup dialog → encryption prompt → done. Fresh start.

### I.2: First-Time SuperSync Setup — User Has Existing Local Data (Pre-Sync Era)

**Trigger:** User has been using Super Productivity offline, then sets up SuperSync for the first time

**Expected:**
1. Same setup flow as I.1 (config + encryption prompt)
2. `sync()` fires → download from server
3. Server is empty → `isWhollyFreshClient()` checks:
   - Op log empty (no snapshot, lastSeq=0) → true
   - BUT `_hasMeaningfulLocalData()` = true (tasks/projects/tags exist)
4. No remote ops to conflict with → upload phase starts
5. `isWhollyFreshClient()` = true → **upload blocked** ("download first")
6. Server migration check: `lastServerSeq === 0` AND server empty AND client has ops = false (fresh client has no ops)
7. **Gap: fresh client with store data but no ops can't upload**
8. Next sync: server still empty, same situation

**Confirmed gap:** A pre-op-log client with data but empty op log gets stuck:
- `isWhollyFreshClient()` = true → upload blocked
- `ServerMigrationService` requires `hasSyncedOps() = true` → migration not triggered for fresh clients
- Empty server → no remote ops → no conflict dialog
- Result: client is stuck in a loop — data exists in NgRx store but can't reach the server

This scenario mainly affects users upgrading from a pre-op-log version of the app who set up SuperSync for the first time.

### I.3: First-Time SuperSync Setup — Server Already Has Data (Second Client)

**Trigger:** User already uses SuperSync on Client A, now sets up Client B

**Expected:**
1. Client B: setup dialog → encryption prompt
2. If Client A has encryption: Client B either sets same password or cancels (disabling sync)
3. `sync()` fires → download remote ops
4. Two paths depending on whether server sends snapshot or incremental ops:
   - **Snapshot path (file-based):** `isWhollyFreshClient()` = true → show `confirmDialog` with count=1 ("Remote data with 1 changes was found")
   - **Incremental ops path (SuperSync):** `isWhollyFreshClient()` = true → show `confirmDialog` with actual op count ("Remote data with N changes was found")
5. `_hasMeaningfulLocalData()` = false (brand new client) → simple confirmation, not conflict dialog
6. If confirmed → apply all remote ops → upload phase (nothing to upload) → `IN_SYNC`
7. If cancelled → snackbar "Sync cancelled"
8. If encryption mismatch (server encrypted, client has no password):
   - Download fails with `DecryptNoPasswordError` → password dialog
   - User enters password → retry sync → works

**User sees:** Confirmation dialog → data appears. If encrypted: password prompt first.

### I.4: First-Time SuperSync Setup — Server Has Data AND Client Has Local Data

**Trigger:** Client B has offline data, Client A already syncs to SuperSync

**Expected:**
1. Client B: setup → encryption prompt → `sync()`
2. Download remote ops → `isWhollyFreshClient()` = true (empty op log)
3. `_hasMeaningfulLocalData()` = true (has tasks/projects/tags)
4. Throw `LocalDataConflictError` → full conflict dialog: USE_LOCAL / USE_REMOTE / CANCEL
5. USE_LOCAL → `forceUploadLocalState()` → creates SYNC_IMPORT, overwrites server
6. USE_REMOTE → `forceDownloadRemoteState()` → clears local, downloads everything
7. CANCEL → sync cancelled, data unchanged

**User sees:** Full conflict resolution dialog. Critical — prevents silent data loss.

### I.5: Re-Enabling SuperSync After Disabling

**Trigger:** User had SuperSync, disabled sync, then re-enables with same SuperSync account

**Expected:**
1. Open sync settings → re-enable SuperSync
2. Provider-specific config still exists in storage (credentials preserved)
3. `lastServerSeq` still in localStorage (per-account hash key)
4. Local op log preserved (provider-agnostic)
5. `sync()` fires → download ops since stored `lastServerSeq`
6. If server data unchanged since disable: quick sync, no new ops
7. If other clients pushed ops while disabled: download and merge normally
8. Upload any local ops created while offline
9. Status → `IN_SYNC`

**User sees:** Seamless resume. All local changes sync up.

**Edge case:** If server was reset/migrated while disabled, `lastServerSeq` may be ahead of server's actual data. Server returns ops from available seq; client adjusts.

### I.6: Switching SuperSync Accounts (Different Token/Server)

**Trigger:** User changes SuperSync access token or base URL

**Expected:**
1. Save new config → new `accessToken` and/or `baseUrl`
2. `lastServerSeq` key changes (hash of `baseUrl|accessToken`), computed dynamically on each sync call
3. New account starts with `lastServerSeq = 0` → downloads everything from new server
4. Local op log is **preserved** (provider-agnostic)
5. **Important:** `syncedAt` is a global field, not per-provider/account. Ops previously synced to the old account remain marked as synced and will NOT re-upload individually.
6. First sync to new server:
   - Download: gets all ops from new server (if any)
   - If new server empty AND `hasSyncedOps() = true`: server migration creates SYNC_IMPORT with full current state → complete data transfers to new server
   - If new server has data: download and merge remote ops. Only locally unsynced ops upload (ops synced to old account are skipped). Full data integrity depends on the downloaded remote ops.
   - Client is NOT "fresh" (has snapshot + ops) → no fresh-client checks

**User sees:** Brief re-sync. Data transfers to new server via SYNC_IMPORT if server is empty.

**Key details:**
- Encryption state is per-provider-config. Switching accounts may change encryption state.
- Switching to an empty server works well (server migration covers full state).
- Switching to a non-empty server with different data: old account's ops don't re-upload, only SYNC_IMPORT-level transfer or new ops.

---

### Provider-Switching Scenarios

### I.7: Switching from File-Based Sync (WebDAV/Dropbox/LocalFile) to SuperSync

**Trigger:** User currently syncs via WebDAV, switches to SuperSync in settings

**Expected:**
1. Config updated: `syncProvider = SuperSync`, credentials saved
2. Encryption prompt (SuperSync-specific, initialSetup mode if first time)
3. Op log preserved — all operations stay in IndexedDB
4. Vector clocks preserved — causality tracking continues
5. Client ID preserved — same device identifier
6. `lastServerSeq` for SuperSync = 0 (never synced to this SuperSync server)
7. First SuperSync sync:
   - Download: empty server → no remote ops
   - Server migration: `hasSyncedOps()` = true (ops synced to WebDAV have `syncedAt` set) → creates SYNC_IMPORT with full current state
   - Uploads SYNC_IMPORT to SuperSync server — **this is how complete data transfers, since individual ops won't re-upload** (they're globally marked as synced)
8. File-based sync provider's data remains on old server (WebDAV/Dropbox/local) — not deleted

**User sees:** Setup → encryption prompt → sync. Data migrates to SuperSync server via SYNC_IMPORT.

**Preserved across switch:**
- All tasks, projects, tags, notes (via SYNC_IMPORT full state)
- Vector clocks
- Client ID

**NOT preserved:**
- Individual op sync status (ops synced to WebDAV stay marked synced, server migration handles data transfer via SYNC_IMPORT instead)
- `lastServerSeq` (reset for new provider)
- File-based sync lock files / rev maps (irrelevant for SuperSync)
- Encryption key (SuperSync has own encryption config in privateCfg)

### I.8: Switching from SuperSync to File-Based Sync (WebDAV/Dropbox/LocalFile)

**Trigger:** User currently syncs via SuperSync, switches to WebDAV in settings

**Expected:**
1. Config updated: `syncProvider = WebDAV`, credentials saved
2. Op log preserved
3. Vector clocks synced to `pf.META_MODEL` (bridge for legacy sync — `_syncVectorClockToPfapi()`)
4. File-based sync writes full state snapshot to file on first sync
5. SuperSync server data remains (not deleted) — user can switch back
6. SuperSync `lastServerSeq` preserved in localStorage for future re-switch

**User sees:** Configure WebDAV → sync. Data uploads to WebDAV.

**Important:** File-based providers use `_syncVectorClockToPfapi()` before each sync to bridge the vector clock from the op-log store (SUP_OPS) to the legacy persistence layer (pf.META_MODEL). SuperSync doesn't need this bridge.

### I.9: Switching from SuperSync (Encrypted) to File-Based Sync

**Trigger:** User has SuperSync with encryption, switches to WebDAV

**Expected:**
1. Config updated: `syncProvider = WebDAV`
2. SuperSync encryption state (`isEncryptionEnabled`, `encryptKey`) stored in SuperSync's privateCfg — **not shared** with WebDAV
3. WebDAV has its own `encryptKey` in its privateCfg (initially empty)
4. User must separately configure encryption for WebDAV if desired (via form field, not dialog)
5. Data uploaded to WebDAV **unencrypted** unless WebDAV encryption key is set

**User sees:** Switch provider → data syncs without encryption to WebDAV.

**Key distinction:** SuperSync manages encryption via dedicated dialogs and `isEncryptionEnabled` flag. File-based providers manage encryption via the form's `encryptKey` field. They are independent.

### I.10: Switching from File-Based Sync (Encrypted) to SuperSync

**Trigger:** User has WebDAV with encryption key set, switches to SuperSync

**Expected:**
1. Config updated: `syncProvider = SuperSync`
2. WebDAV's `encryptKey` stays in WebDAV privateCfg
3. SuperSync starts with `isEncryptionEnabled = false` (unless previously configured)
4. Encryption prompt shows after first sync (initialSetup mode)
5. User sets new password for SuperSync (can be different from WebDAV password)
6. Old WebDAV file remains encrypted on WebDAV server

**User sees:** Switch → sync → encryption prompt → set password.

### I.11: Rapid Provider Switching (Back and Forth)

**Trigger:** User switches SuperSync → WebDAV → SuperSync quickly

**Expected:**
1. Each switch preserves op log, vector clocks, client ID
2. Each provider has independent `lastServerSeq` / rev tracking
3. SuperSync's per-account `lastServerSeq` key survives the round-trip (stored in localStorage)
4. On return to SuperSync:
   - Resume from stored `lastServerSeq`
   - Download any ops pushed by other clients while away
   - Only ops created AFTER the WebDAV sync period that weren't synced to WebDAV will upload
5. Data integrity maintained at the full-state level

**User sees:** Seamless transitions. Data intact.

**Important nuance:** `syncedAt` is global — ops synced to WebDAV during the away period are marked synced and won't re-upload to SuperSync individually. However, this is typically fine because:
- SuperSync already had the data before the switch (it was synced there first)
- Any new ops created during WebDAV period that weren't yet synced to WebDAV will upload to SuperSync
- If SuperSync data was lost during the away period, server migration (SYNC_IMPORT) would recreate it from full state

### I.12: Disabling Sync Entirely, Then Re-Enabling with Different Provider

**Trigger:** User disables sync, creates data offline, then enables with a new provider

**Expected:**
1. Disable: config `isEnabled = false`, no sync fires
2. User creates tasks/projects offline → ops logged to IndexedDB
3. Re-enable with new provider (e.g., SuperSync)
4. If new server is empty: server migration → SYNC_IMPORT from local state
5. If new server has data: depends on `isWhollyFreshClient()`:
   - If op log is non-empty (was syncing before): NOT fresh → normal sync, upload pending ops
   - If op log is empty (never synced): fresh client checks apply (I.3 or I.4)

**User sees:** Enable sync → data uploads to new provider.

---

### Setup with Encryption — Detailed Flows

### I.13: Initial Setup → User Sets Encryption Password

**Trigger:** First-time SuperSync setup, user enters password in encryption dialog

**Expected:**
1. `DialogSyncInitialCfgComponent.save()` completes config save
2. Opens `DialogEnableEncryptionComponent` with `initialSetup: true`
3. User enters password → component calls `enableEncryption(password)`
4. `enableEncryption()` inside `runWithSyncBlocked()`:
   - Check WebCrypto available
   - Gather snapshot data
   - Delete server data (empty server → no-op)
   - Update config: `isEncryptionEnabled=true, encryptKey=password`
   - Encrypt snapshot → upload
5. Dialog closes with `{ success: true }`
6. `save()` continues → `this._matDialogRef.close()` → `sync()`
7. `sync()` completes → `_promptSuperSyncEncryptionIfNeeded()`:
   - Checks encryption → already enabled → no additional prompt

**User sees:** Setup → password dialog → encrypted sync starts.

### I.14: Initial Setup → User Cancels Encryption Dialog

**Trigger:** First-time SuperSync setup, user doesn't want to set a password

**Expected:**
1. Config saved, encryption dialog opens with `initialSetup: true` and `disableClose: true`
2. User's only options are:
   - **Set password** → encryption enabled, dialog closes with `{ success: true }`
   - **Cancel** → calls `disableSuperSync()` which sets `sync.isEnabled = false`, dialog closes with `{ success: false }`
3. There is NO "skip" or "continue without encryption" button — the plan described adding one with an "I understand" checkbox, but the current implementation only offers Cancel (which disables sync entirely)
4. After cancel: `save()` continues → `this._matDialogRef.close()` → `sync()` fires but sync is now disabled → fails silently

**Current behavior:** SuperSync without encryption is effectively impossible. Cancel disables sync entirely. The `_promptSuperSyncEncryptionIfNeeded()` post-sync hook reinforces this — if somehow SuperSync runs without encryption, it re-opens the same dialog with `disableClose: true` after every successful sync.

**User sees:** Encryption dialog. Must set password or cancel (which disables sync).

### I.15: Initial Setup → Encryption Fails (WebCrypto Unavailable)

**Trigger:** Android/insecure context, user tries to set encryption password

**Expected:**
1. `enableEncryption()` called → `isCryptoSubtleAvailable()` returns false
2. Throw `WebCryptoNotAvailableError` → caught by dialog's try/catch
3. Dialog shows error snackbar: "Failed to enable encryption: ..."
4. Dialog stays open — user can try again or click Cancel (which disables sync entirely)
5. No way to proceed with unencrypted SuperSync from this dialog

**User sees:** Error message. Must either retry or cancel (disabling sync).

**Note:** This effectively means SuperSync is unusable on platforms without WebCrypto (e.g., Android Capacitor with insecure context). The `_promptSuperSyncEncryptionIfNeeded()` post-sync hook would also catch this if encryption was somehow bypassed.

### I.16: Re-Opening Settings Dialog for Existing SuperSync Config

**Trigger:** User already has SuperSync configured, opens sync settings to modify

**Expected:**
1. `DialogSyncInitialCfgComponent` opens, `isWasEnabled = true`
2. `_isInitialSetup = true` still set (always set in this dialog)
3. Existing provider config loaded: access token, encryption state populated from privateCfg
4. If already encrypted: `isEncryptionEnabled = true` in model → encryption button hidden (hideExpression)
5. On save: encryption check — already enabled → skip encryption dialog
6. Normal config save → sync

**User sees:** Settings with existing values. No encryption prompt (already set).

**Edge case:** If user switches from SuperSync to WebDAV and back within the dialog (using provider dropdown), the `ngAfterViewInit` listener reloads provider-specific config including encryption state.

---

## Key Invariants

1. **No silent data loss:** Every scenario where user data could be lost MUST show a dialog
2. **Clean slate semantics:** SYNC_IMPORT replaces ALL state; concurrent ops are dropped
3. **Vector clocks for causality:** Never use wall-clock time for conflict decisions
4. **Encryption is atomic:** Server never has mixed encrypted/unencrypted data
5. **Download before upload:** Always get remote state first to detect conflicts early
6. **Effects use LOCAL_ACTIONS:** NgRx effects never fire for remote sync operations
7. **`lastServerSeq` monotonically increases:** Client never re-downloads same ops
8. **Pending ops survive crashes:** IndexedDB is the source of truth for unsynced ops
9. **Op log is provider-agnostic:** Switching providers preserves all operations, vector clocks, and client ID
10. **Per-account `lastServerSeq`:** SuperSync tracks sequence numbers per `hash(baseUrl|accessToken)`, not globally
11. **Encryption is per-provider:** SuperSync and file-based providers have independent encryption configs in their privateCfg
12. **`_isInitialSetup` is ephemeral:** Set during setup dialog, stripped before config save, never persisted

---

## Known Issues / Open Questions

1. **Fresh client with pre-op-log data on empty server (I.2):** A client with data in NgRx but empty op log (`isWhollyFreshClient() = true`) faces the upload blocker AND server migration won't trigger (`hasSyncedOps() = false`). With an empty server, there are no remote ops to conflict with, so no dialog appears either. Result: client is stuck — data exists locally but can't reach the server. This scenario mainly affects users upgrading from a pre-op-log version of the app.

2. **`syncedAt` is global, not per-provider (I.6, I.7, I.11):** Operations have a single `syncedAt` timestamp, not per-provider tracking. When switching providers, ops previously synced to the old provider remain marked synced and won't re-upload individually. This is mitigated by server migration creating a SYNC_IMPORT with full state when connecting to an empty server, but switching to a non-empty server with different data could result in incomplete state.

3. **Encryption state leaking across providers (I.9):** When switching from encrypted SuperSync to WebDAV, the global `isEncryptionEnabled` may still be `true` (set by `SyncConfigService.updateSettingsFromForm()` for SuperSync). File-based providers derive encryption from `!!encryptKey`, so this shouldn't cause issues, but the global config may show misleading state.

4. **No "skip encryption" option for SuperSync (I.14):** The encryption dialog's Cancel button disables sync entirely — there's no way to use SuperSync without encryption. This is by design (encryption is effectively mandatory) but may surprise users who want to test without encryption first.
