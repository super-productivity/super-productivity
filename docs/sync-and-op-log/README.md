# Operation Log & Sync Documentation

The Operation Log is the **single sync system** for all providers (SuperSync,
WebDAV, Dropbox, LocalFile). It is an event-sourced persistence + sync layer:
the log is the source of truth, current state is derived by replaying it, and
vector clocks detect concurrent edits.

```
                         User Action
                              │
                              ▼
                         NgRx Store  (runtime source of truth)
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   │                   ▼
    OpLogEffects              │             Other Effects
          │                   │
          ├──► SUP_OPS ◄───────┘   (local persistence — IndexedDB)
          │
          └──► Sync Providers
               ├── SuperSync   (operation-based, real-time)
               └── WebDAV / Dropbox / LocalFile  (file-based, single sync-data.json)
```

## Start here

| You want to…                                                | Read                                                                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Write an effect/reducer/bulk-dispatch correctly             | **[contributor-sync-model.md](./contributor-sync-model.md)** — the one invariant, enforced by lint   |
| Understand the whole architecture + why it's built this way | [operation-log-architecture.md](./operation-log-architecture.md) — Parts A–F + rejected alternatives |
| See it visually                                             | [diagrams/](./diagrams/) — 8 topic diagrams                                                          |

## Reference docs

| Document                                                                       | Scope                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [operation-log-architecture.md](./operation-log-architecture.md)               | Authoritative architecture: Local Persistence (A), File-Based Sync (B), Server Sync (C), Validation & Repair (D), Smart Archive (E), Atomic State Consistency (F), and **Why this architecture: rejected alternatives** |
| [contributor-sync-model.md](./contributor-sync-model.md)                       | The single sync invariant for contributors (one intent = one op; replayed/remote ops must not re-trigger effects)                                                                                                       |
| [operation-rules.md](./operation-rules.md)                                     | Design rules and guidelines for operations                                                                                                                                                                              |
| [package-boundaries.md](./package-boundaries.md)                               | Dependency/ownership boundaries for `@sp/sync-core`, `@sp/sync-providers`, app wiring                                                                                                                                   |
| [vector-clocks.md](./vector-clocks.md)                                         | Vector clock implementation, pruning, history                                                                                                                                                                           |
| [supersync-encryption-architecture.md](./supersync-encryption-architecture.md) | End-to-end encryption (AES-256-GCM + Argon2id)                                                                                                                                                                          |
| [diagrams/](./diagrams/)                                                       | Mermaid diagrams split by topic                                                                                                                                                                                         |

## Scenario catalogs (expected behavior)

| Document                                                               | Scope                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------- |
| [supersync-scenarios.md](./supersync-scenarios.md)                     | Concrete SuperSync scenarios A–G with expected behavior |
| [supersync-scenarios-flowchart.md](./supersync-scenarios-flowchart.md) | Visual decision tree for the SuperSync scenarios        |
| [file-based-sync-flowchart.md](./file-based-sync-flowchart.md)         | Visual decision tree for file-based providers           |

## Related

| Location                                                         | Content                             |
| ---------------------------------------------------------------- | ----------------------------------- |
| [packages/super-sync-server/](../../packages/super-sync-server/) | SuperSync server implementation     |
| [ARCHITECTURE-DECISIONS.md](../../ARCHITECTURE-DECISIONS.md)     | Load-bearing product/data decisions |

> Historical design notes and superseded plans are not kept as docs; they live
> in git history (reference the relevant commit if you need the rationale).
