# Operation Log Documentation

**Last Updated:** January 2026

This directory contains the architectural documentation for Super Productivity's Operation Log system - an event-sourced persistence and synchronization layer that handles ALL sync providers (SuperSync, WebDAV, Dropbox, LocalFile).

## Quick Start

| If you want to...                   | Read this                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| Understand the overall architecture | [operation-log-architecture.md](./operation-log-architecture.md)               |
| See visual diagrams                 | [diagrams/](./diagrams/) (split by topic)                                      |
| Learn the design rules              | [operation-rules.md](./operation-rules.md)                                     |
| Understand file-based sync          | [diagrams/04-file-based-sync.md](./diagrams/04-file-based-sync.md)             |
| Understand SuperSync encryption     | [supersync-encryption-architecture.md](./supersync-encryption-architecture.md) |

## Documentation Overview

### Core Documentation

| Document                                                         | Description                                                                                                                                                                         | Status |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [operation-log-architecture.md](./operation-log-architecture.md) | Comprehensive architecture reference covering Parts A-F: Local Persistence, File-Based Sync, Server Sync, Validation & Repair, Smart Archive Handling, and Atomic State Consistency | Active |
| [diagrams/](./diagrams/)                                         | Mermaid diagrams split by topic (local persistence, server sync, file-based sync, etc.)                                                                                             | Active |
| [operation-rules.md](./operation-rules.md)                       | Design rules and guidelines for the operation log store and operations                                                                                                              | Active |

### Sync Architecture

| Document                                                                       | Description                                                           | Status      |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ----------- |
| [diagrams/04-file-based-sync.md](./diagrams/04-file-based-sync.md)             | File-based sync with single sync-data.json (WebDAV/Dropbox/LocalFile) | Implemented |
| [diagrams/02-server-sync.md](./diagrams/02-server-sync.md)                     | SuperSync server sync architecture                                    | Implemented |
| [supersync-encryption-architecture.md](./supersync-encryption-architecture.md) | End-to-end encryption for SuperSync (AES-256-GCM + Argon2id)          | Implemented |

### Historical / Completed Plans

| Document                                                                               | Description                                              | Status                 |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------- |
| [replace-pfapi-with-oplog-plan.md](./long-term-plans/replace-pfapi-with-oplog-plan.md) | Plan to unify sync by replacing PFAPI with operation log | Completed (Jan 2026)   |
| [e2e-encryption-plan.md](./long-term-plans/e2e-encryption-plan.md)                     | Original E2EE design (see supersync-encryption for impl) | Implemented (Dec 2025) |

## Architecture at a Glance

The Operation Log system is the **single sync system** for all providers:

```
                         User Action
                              │
                              ▼
                         NgRx Store
                   (Runtime Source of Truth)
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   │                   ▼
    OpLogEffects              │             Other Effects
          │                   │
          ├──► SUP_OPS ◄──────┘
          │    (Local Persistence - IndexedDB)
          │
          └──► Sync Providers
               ├── SuperSync (operation-based, real-time)
               ├── WebDAV (file-based, single-file snapshot)
               ├── Dropbox (file-based, single-file snapshot)
               └── LocalFile (file-based, single-file snapshot)
```

### Sync Provider Types

| Provider Type    | Providers                  | How It Works                                                  |
| ---------------- | -------------------------- | ------------------------------------------------------------- |
| **Server-based** | SuperSync                  | Individual operations uploaded/downloaded via HTTP API        |
| **File-based**   | WebDAV, Dropbox, LocalFile | Single `sync-data.json` file with state snapshot + recent ops |

### The Core Parts

| Part                       | Purpose                     | Description                                                                   |
| -------------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| **A. Local Persistence**   | Fast writes, crash recovery | Operations stored in IndexedDB (`SUP_OPS`), with snapshots for fast hydration |
| **B. File-Based Sync**     | WebDAV/Dropbox/LocalFile    | Single-file sync with state snapshot and embedded operations buffer           |
| **C. Server Sync**         | Operation-based sync        | Upload/download individual operations via SuperSync server                    |
| **D. Validation & Repair** | Data integrity              | Checkpoint validation with automatic repair and REPAIR operations             |

Additional architectural patterns:

| Pattern                         | Purpose                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| **E. Smart Archive Handling**   | Deterministic archive operations synced via instructions, not data |
| **F. Atomic State Consistency** | Meta-reducers ensure multi-entity changes are atomic               |

## Key Concepts

### Event Sourcing

The Operation Log treats the database as a **timeline of events** rather than mutable state:

- **Source of Truth**: The log is truth; current state is derived by replaying the log
- **Immutability**: Operations are never modified, only appended
- **Snapshots**: Periodic snapshots speed up hydration (replay from snapshot + tail ops)

### Vector Clocks

Vector clocks track causality for conflict detection:

- Each client has its own counter in the vector clock
- Comparison reveals: `EQUAL`, `LESS_THAN`, `GREATER_THAN`, or `CONCURRENT`
- `CONCURRENT` indicates a true conflict requiring resolution

### LOCAL_ACTIONS Token

Effects that perform side effects (snacks, external APIs, UI) must use `LOCAL_ACTIONS` instead of `Actions`:

```typescript
private _actions$ = inject(LOCAL_ACTIONS); // Excludes remote operations
```

This prevents duplicate side effects when syncing operations from other clients.

## Key Files

### Sync Providers

```
src/app/op-log/sync-providers/
├── super-sync/                     # SuperSync server provider
├── file-based/                     # File-based providers
│   ├── file-based-sync-adapter.service.ts  # Unified adapter for file providers
│   ├── file-based-sync.types.ts    # FileBasedSyncData types
│   ├── webdav/                     # WebDAV provider
│   ├── dropbox/                    # Dropbox provider
│   └── local-file/                 # Local file sync provider
├── provider-manager.service.ts     # Provider activation/management
├── wrapped-provider.service.ts     # Provider wrapper with encryption
└── credential-store.service.ts     # OAuth/credential storage
```

### Core Operation Log

```
src/app/op-log/
├── core/                           # Core types and operations
├── persistence/                    # IndexedDB storage
├── sync/                           # Sync orchestration
└── validation/                     # Data validation and repair
```

## Related Documentation

| Location                                                         | Content                               |
| ---------------------------------------------------------------- | ------------------------------------- |
| [vector-clocks.md](./vector-clocks.md)                           | Vector clock implementation details   |
| [packages/super-sync-server/](../../packages/super-sync-server/) | SuperSync server implementation       |
| [background-info/](./background-info/)                           | Research and best practices documents |

## Implementation Status

| Component                    | Status                                           |
| ---------------------------- | ------------------------------------------------ |
| Local Persistence (Part A)   | Complete                                         |
| File-Based Sync (Part B)     | Complete (WebDAV, Dropbox, LocalFile)            |
| Server Sync (Part C)         | Complete (SuperSync)                             |
| Validation & Repair (Part D) | Complete                                         |
| End-to-End Encryption        | Complete (AES-256-GCM + Argon2id)                |
| PFAPI Elimination            | Complete (Jan 2026)                              |
| Cross-version Sync (A.7.11)  | Documented (not yet implemented)                 |
| Schema Migrations            | Infrastructure ready (no migrations defined yet) |

See [operation-log-architecture.md#implementation-status](./operation-log-architecture.md#implementation-status) for detailed status.
