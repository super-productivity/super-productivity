# `src/app` — layer map

Where things live and which way the dependencies point. This is a **routing table, not a specification**: code, tests, and [`ARCHITECTURE-DECISIONS.md`](../../ARCHITECTURE-DECISIONS.md) override anything written here. For the sync subsystem in depth, start at [`docs/sync-and-op-log/README.md`](../../docs/sync-and-op-log/README.md).

## One user intent, end to end

Operation capture is **Phase 1 of the meta-reducer registry — the outermost wrapper**, so it reads state _before_ any reducer mutates it. It is not a step after the reducers; it brackets them.

```
             persistent NgRx action
                       │
        ┌──────────────┴──────────────┐
        ▼                             ▼
  root-store/meta                op-log/capture
  phases 2 … 8                   (phase 1, outermost:
  shared/domain                   reads pre-mutation state)
  meta-reducers                         │
        │                               ▼
        ▼                        op-log/persistence
  feature reducers               OperationLogStoreService
        │                               │
        ▼                    OP_LOG_DB_ADAPTER_FACTORY
  live projection                ┌──────┴──────┐
  (what the UI renders)          ▼             ▼
                             IndexedDB      SQLite
                                      │
                                      ▼
                    op-log/sync → op-log/sync-providers
                          (SuperSync | file-based)
```

A **remote** operation runs this in reverse: `op-log/apply` converts it back into actions and replays them through the identical reducers. That is why effects must inject `LOCAL_ACTIONS` and not `Actions` — otherwise a replayed remote change re-fires local side effects (sync rule 1).

## Start here

| You want to…                                          | Start at                                                                                                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Change one feature's behavior                         | `features/<name>/` — `tasks/` is the hot core                                                                                                                   |
| Change state spanning more than one entity type       | `root-store/meta/task-shared-meta-reducers/` — one reducer pass = one op (sync rule 3)                                                                          |
| Understand or reorder meta-reducers                   | [`root-store/meta/meta-reducer-registry.ts`](root-store/meta/meta-reducer-registry.ts) — documents phases 1, 2, 2.5, 3, 3.5, 4–8 and throws in dev on violation |
| Know how a change becomes durable and syncable        | `op-log/capture/`, then `op-log/persistence/operation-log-store.service.ts`                                                                                     |
| Trace how a remote change is applied                  | `op-log/apply/operation-applier.service.ts`                                                                                                                     |
| Change where bytes actually land                      | `op-log/persistence/` — `indexed-db-op-log-adapter.ts` / `sqlite-op-log-adapter.ts`, both behind `op-log-db-adapter.token.ts`                                   |
| Work on sync transport, conflicts, or a provider      | `op-log/sync/`, `op-log/sync-providers/`, plus `packages/sync-core` and `packages/sync-providers`                                                               |
| Change import/export, backup, or the sync setup UI    | `imex/`                                                                                                                                                         |
| Add a reusable, feature-agnostic widget               | `ui/`                                                                                                                                                           |
| Change app chrome (header, nav, layout, shortcuts)    | `core-ui/`                                                                                                                                                      |
| Add a cross-cutting service (platform, theme, notify) | `core/`                                                                                                                                                         |
| Add a route or a top-level screen                     | `routes/`, `pages/`, `config/`                                                                                                                                  |
| Work on the plugin API                                | `plugins/` plus `packages/plugin-api`                                                                                                                           |
| Add a pure helper                                     | `util/`                                                                                                                                                         |

## Which way the arrows point

```
core-ui/ · pages/ · routes/     the shell — composes features
            │
            ▼
        features/               domain logic
            │
            ▼
  core/ · ui/ · util/           shared services, widgets, helpers
```

**Enforced:** nothing in `core/`, `ui/`, or `util/` may import from `features/`, statically or via dynamic `import()`. See the rule and its reasoning in [`eslint.config.js`](../../eslint.config.js) (search `FEATURE_LAYER_FENCE`).

**What "enforced" does and does not mean.** A new violation fails CI everywhere in those three directories **except** the files listed in that config block, which warn instead. Grandfathering is keyed by file, so a listed file can accumulate further feature imports without failing. That list may only shrink — it is at 36 and has already come down from 38.

**Not enforced, and currently untrue — do not read the diagram as a guarantee.** The bottom row is one box because its members are entangled, not because they are peers:

- `core/` and `ui/` are mutually dependent: 22 files `ui → core`, 4 files `core → ui`.
- `util/` is not a leaf: it imports upward in ~29 non-spec files (19 → `core/`, 4 → `op-log/`, 1 → `ui/`, plus the 5 `→ features/` now fenced).
- `core/` reaches up into `core-ui/` in 2 files and into `op-log/` in 7.

## Legacy

`pfapi/` is dead code, not a live layer. It is four compiled `.js` files from the pre-op-log sync system, its own header reads `LEGACY CODE — do not modify`, and **nothing imports it** — every `pfapi` mention in `.ts` sources is a comment or a string describing the legacy on-disk `__meta_` format written by v16.x clients. It cannot even load (`api/index.js` requires modules absent from the tree) and is excluded from the TS build, so it ships in no bundle. Despite the name it is **not** the current persistence layer; that is `op-log/persistence/`.

Note that `core/persistence/legacy-pf-db.service.ts` is unrelated to it — that service reads the legacy `pf` IndexedDB directly and is live migration code.
