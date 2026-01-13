# Operation Log Architecture Diagrams

**Last Updated:** January 2026

This directory contains visual diagrams explaining the Operation Log sync architecture.

## Diagram Index

| Diagram                                                          | Description                                               | Status      |
| ---------------------------------------------------------------- | --------------------------------------------------------- | ----------- |
| [01-local-persistence.md](./01-local-persistence.md)             | Local IndexedDB persistence, hydration, compaction        | Implemented |
| [02-server-sync.md](./02-server-sync.md)                         | SuperSync server API, PostgreSQL, upload/download flows   | Implemented |
| [03-conflict-resolution.md](./03-conflict-resolution.md)         | LWW auto-resolution, SYNC_IMPORT filtering, vector clocks | Implemented |
| [04-file-based-sync.md](./04-file-based-sync.md)                 | WebDAV/Dropbox/LocalFile sync via single sync-data.json   | Implemented |
| [05-meta-reducers.md](./05-meta-reducers.md)                     | Atomic multi-entity operations, state consistency         | Implemented |
| [06-archive-operations.md](./06-archive-operations.md)           | Archive side effects, dual-database architecture          | Implemented |
| [07-supersync-vs-file-based.md](./07-supersync-vs-file-based.md) | Comparison of SuperSync and file-based sync providers     | Implemented |
| [08-sync-flow-explained.md](./08-sync-flow-explained.md)         | Simple explanation of how sync works                      | Implemented |

## Quick Navigation

### By Topic

**Getting Started:**

- Start with [01-local-persistence.md](./01-local-persistence.md) to understand how data is stored locally
- Then [04-file-based-sync.md](./04-file-based-sync.md) or [02-server-sync.md](./02-server-sync.md) depending on your sync provider

**Understanding Conflicts:**

- [03-conflict-resolution.md](./03-conflict-resolution.md) explains how concurrent edits are resolved

**Advanced Topics:**

- [05-meta-reducers.md](./05-meta-reducers.md) for atomic multi-entity operations
- [06-archive-operations.md](./06-archive-operations.md) for archive-specific handling

**Comparisons & Overviews:**

- [07-supersync-vs-file-based.md](./07-supersync-vs-file-based.md) compares the two sync approaches
- [08-sync-flow-explained.md](./08-sync-flow-explained.md) simple step-by-step sync explanation

### By Sync Provider

| Provider  | Primary Diagram                                  |
| --------- | ------------------------------------------------ |
| SuperSync | [02-server-sync.md](./02-server-sync.md)         |
| WebDAV    | [04-file-based-sync.md](./04-file-based-sync.md) |
| Dropbox   | [04-file-based-sync.md](./04-file-based-sync.md) |
| LocalFile | [04-file-based-sync.md](./04-file-based-sync.md) |

## Related Documentation

| Document                                                             | Description                          |
| -------------------------------------------------------------------- | ------------------------------------ |
| [../operation-log-architecture.md](../operation-log-architecture.md) | Comprehensive architecture reference |
| [../operation-rules.md](../operation-rules.md)                       | Design rules and guidelines          |
| [../vector-clocks.md](../vector-clocks.md)                           | Vector clock implementation details  |
| [../quick-reference.md](../quick-reference.md)                       | Quick lookup for common patterns     |

## Diagram Conventions

All diagrams use Mermaid syntax and follow these conventions:

| Color              | Meaning                                       |
| ------------------ | --------------------------------------------- |
| Green (`#e8f5e9`)  | Success paths, valid states, local operations |
| Blue (`#e3f2fd`)   | Server/API operations, remote operations      |
| Orange (`#fff3e0`) | Storage, file operations, warnings            |
| Red (`#ffebee`)    | Errors, conflicts, filtered operations        |
| Purple (`#f3e5f5`) | Results, outputs, final states                |
