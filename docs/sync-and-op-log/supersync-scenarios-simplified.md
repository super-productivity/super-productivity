# SuperSync Scenarios — Simplified

Condensed reference for all SuperSync synchronization scenarios. For full details see [supersync-scenarios.md](./supersync-scenarios.md).

---

## A. Normal Sync

- **Incremental sync**: Download remote ops → detect conflicts → apply → upload local ops → done
- **Piggybacked ops**: Upload response includes other clients' ops, processed inline
- **No changes**: Quick round-trip, seq updated, status IN_SYNC

## B. Conflicts

- **Concurrent edits**: Auto-resolved via Last-Writer-Wins (timestamp comparison). No dialog.
- **Server rejects (CONFLICT_CONCURRENT)**: Re-download, auto-resolve, retry next sync
- **Validation error**: Op permanently rejected, status ERROR
- **Payload too large**: Alert dialog, sync stops
- **Infinite loop**: After max retries, op permanently rejected

## C. Fresh Client

- **No local data**: Confirm dialog → download all remote ops
- **Has local data (pre-op-log)**: Full conflict dialog (USE_LOCAL / USE_REMOTE / CANCEL)
- **Has meaningful pending ops (file-based only)**: Conflict dialog if real user data at risk

## D. SYNC_IMPORT (full state replacement)

- **No local pending, has meaningful data**: Conflict dialog with import reason shown, "Use Server Data" recommended
- **No local pending, no meaningful data**: Apply silently (no dialog)
- **Has local pending**: Conflict dialog before processing (regardless of meaningful data)
- **Piggybacked SYNC_IMPORT**: Same conflict dialog as download path — prevents silent state replacement
- **Local import filters remote ops**: Conflict dialog (local created the import)
- **Remote import filters remote ops**: Silent filter (import already accepted)
- **Same-client pruning artifact**: Ops kept (can't conflict with own import)

## E. Encryption

- **Enable**: Delete server → upload encrypted snapshot. Other clients get password prompt.
- **Disable**: Delete server → upload unencrypted. Other clients auto-detect.
- **Change password**: Clean slate → new SYNC_IMPORT encrypted with new key
- **Wrong password**: Error → password dialog (Save & Sync / Use Local Data)
- **Mismatch (remote disabled)**: Auto-disable local encryption + snackbar
- **Mandatory prompt**: After every unencrypted SuperSync sync until password set or sync disabled
- **Blocks concurrent sync**: Encryption ops lock out sync until complete
- **File import**: Preserves encryption state

## F. Server Migration

- **Empty server detected**: Auto-create SYNC_IMPORT from local state
- **Race condition**: If server no longer empty, abort migration, sync normally

## G. Errors

- Network timeout → retry next sync
- CORS → snackbar with details
- Auth failure → clear creds, prompt reconfigure
- Server error → silent retry
- Duplicate op → mark synced silently
- Storage quota → alert dialog
- Schema too new → log warning, HANDLED_ERROR
- Migration failure → skip failed ops, snackbar
- Concurrent sync → second attempt blocked
- App closes mid-sync → pending ops survive in IndexedDB

## H. Multi-Client

- **A encrypts, B has pending**: B gets conflict dialog (was previously broken — silent discard)
- **A changes password, B has old**: B gets password dialog
- **A imports file, B has changes**: B gets conflict dialog
- **Both force-upload**: Last-write-wins at server level
- **Three clients, normal edits**: LWW for same entity, clean merge for different entities

## I. Setup & Provider Switching

- **New user, empty server**: Setup → probe server (empty) → create-password prompt → done
- **Existing local data, empty server**: Auto-create SYNC_IMPORT from local state (pre-op-log client fix)
- **Second client, server has encrypted data**: Setup → probe server → enter-password prompt → download all
- **Second client, server has unencrypted data**: Setup → probe server → create-password prompt → download all
- **Second client with local data**: Full conflict dialog
- **Re-enable after disable**: Seamless resume from stored lastServerSeq
- **Switch accounts**: New lastServerSeq=0, server migration if empty server
- **File-based → SuperSync**: Server migration uploads SYNC_IMPORT
- **SuperSync → File-based**: Full state snapshot written to file
- **Encrypted SuperSync → File-based**: Encryption is per-provider, WebDAV starts unencrypted
- **Rapid switching**: Op log + vector clocks + client ID preserved across all switches

---

## Known Issues

1. `syncedAt` is per-operation, not per-provider — ops won't re-upload after switching
2. Encryption state may show misleading global config after provider switch
3. No "skip encryption" for SuperSync — Cancel disables sync entirely
