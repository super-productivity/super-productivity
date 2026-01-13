# Plan: Replace PFAPI with Operation Log Sync for All Providers

> **STATUS: COMPLETED (January 2026)**
>
> This plan has been fully implemented. The entire `src/app/pfapi/` directory has been deleted.
> All sync providers now use the unified operation log system via `FileBasedSyncAdapter`.
>
> **Current Implementation:**
>
> - Sync providers: `src/app/op-log/sync-providers/`
> - File-based adapter: `src/app/op-log/sync-providers/file-based/file-based-sync-adapter.service.ts`
> - Server migration: `src/app/op-log/sync/server-migration.service.ts`

---

## Original Goal

Simplify the codebase by removing PFAPI's model-by-model sync and using operation logs exclusively for **all sync providers** (WebDAV, Dropbox, LocalFile). Migration required for existing users; old PFAPI files kept as backup.

## What Was Implemented

### Phase 1: Enable Operation Log Sync (All Providers) - DONE

All providers now use operation log sync:

- WebDAV: `src/app/op-log/sync-providers/file-based/webdav/`
- Dropbox: `src/app/op-log/sync-providers/file-based/dropbox/`
- LocalFile: `src/app/op-log/sync-providers/file-based/local-file/`
- SuperSync: `src/app/op-log/sync-providers/super-sync/`

### Phase 2: Migration Logic - DONE

Migration from legacy PFAPI format is handled by `ServerMigrationService`:

- Checks for existing PFAPI metadata file on remote
- Downloads full state and creates SYNC_IMPORT operation
- Uploads initial snapshot via operation log

### Phase 3: PFAPI Code Removal - DONE

The entire `src/app/pfapi/` directory has been deleted (~83 files, 2.0 MB).

What was kept (moved to op-log):

- Provider implementations (WebDAV, Dropbox, LocalFile)
- Encryption/compression utilities
- Auth flows

### Phase 4: Testing & Cleanup - DONE

- Multi-device sync scenarios tested via E2E tests
- Migration testing completed
- Large operation log handling verified
- All tests pass

## Final Architecture

```
src/app/op-log/
├── sync-providers/
│   ├── super-sync/                 # Server-based sync
│   ├── file-based/                 # File-based providers
│   │   ├── file-based-sync-adapter.service.ts
│   │   ├── webdav/
│   │   ├── dropbox/
│   │   └── local-file/
│   ├── provider-manager.service.ts
│   └── wrapped-provider.service.ts
├── sync/
│   ├── operation-log-sync.service.ts
│   └── server-migration.service.ts
└── ...
```

## Key Decisions Made

- Single-file sync format (`sync-data.json`) with state snapshot + recent ops
- Content-based optimistic locking via `syncVersion` counter
- Piggybacking mechanism for concurrent sync handling
- Server migration service handles legacy PFAPI data migration
