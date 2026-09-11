# Operation Log & Sync Documentation

The Operation Log is the **single client sync pipeline** for SuperSync and file
providers. Persistent NgRx actions update the live projection and are captured
as durable operations; restart uses a structurally screened snapshot plus the
retained operation tail. Vector clocks detect causal order and concurrent edits.

```
                    Persistent NgRx action
                     ┌────────┴────────┐
                     ▼                 ▼
               NgRx reducers     operation capture
                     │                 │
                     ▼                 ▼
            runtime projection      SUP_OPS
                                  (ops, clocks,
                               checkpoints, snapshot)
                                           │
                                           ▼
                                    Sync Providers
                       ┌───────────────────┴──────────────────┐
                       ▼                                      ▼
                   SuperSync                       File providers
               (ordered op API)           (shared v2 or v3 envelopes)
```

The v2/v3 envelopes are common adapter formats, not a common physical write
guarantee. Dropbox and OneDrive can enforce API compare-and-swap (CAS), while
WebDAV/Nextcloud is atomic only when the server supplies strong ETags; weak or
missing ETags fall back to a best-effort check. LocalFile likewise has a
best-effort read/check/write race and is single-writer/backup-only.

## Start here

Current mechanics live in the executable owners linked by these documents.
Overview and history documents explain the model but do not override code,
tests, or a focused contract.

| You want to…                                           | Read                                                                                                                                                  |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build a five-minute whole-system mental model          | **[sync-architecture.html](./sync-architecture.html)** — standalone maintainer field guide; open the local file in a browser                          |
| Write an effect/reducer/bulk-dispatch correctly        | **[contributor-sync-model.md](./contributor-sync-model.md)** — the one invariant, drop-vs-defer selector rule, and lint boundaries                    |
| Compare SuperSync and file v2/v3                       | [field guide: transports](./sync-architecture.html#transport)                                                                                         |
| Trace remote apply, conflicts, or restart recovery     | [remote apply](./sync-architecture.html#remote-apply), [causality](./sync-architecture.html#causality), [restart](./sync-architecture.html#restart)   |
| Change SECTION conflict/recovery behavior              | [section-conflict-replay.md](./section-conflict-replay.md) — narrow commutativity, state-projected replay, and released-client compatibility contract |
| Find executable coverage for a SuperSync scenario      | [supersync-scenarios.md](./supersync-scenarios.md) — scenario-to-test index, not a prose specification                                                |
| Research rejected alternatives or cross-version policy | [operation-log-architecture.md](./operation-log-architecture.md) — deep rationale and history plus the **normative A.7.11 schema-bump policy**        |
| Decode an `InvalidFilePrefixError` from a log export   | [diagnosing-invalid-file-prefix.md](./diagnosing-invalid-file-prefix.md) — `headShape`/`prefixAt` decode table (#9627)                                |
| Judge whether a sync bug is real and how severe        | [sync-severity-triage.md](./sync-severity-triage.md) — triage rules: what ships from master, proving a commit is released, verifying audit findings   |

## Reference docs

| Status   | Document                                                                       | Scope                                                                                                                                             |
| -------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview | [sync-architecture.html](./sync-architecture.html)                             | High-level maintainer map: local intent, transports, crash-safe apply, causality, exceptional boundaries, restart recovery, and executable owners |
| Contract | [contributor-sync-model.md](./contributor-sync-model.md)                       | Contributor invariant: one replay-atomic transition = one op; replayed/remote ops must not re-trigger effects                                     |
| Contract | [section-conflict-replay.md](./section-conflict-replay.md)                     | SECTION conflict commutativity, state-projected semantic replay, atomic replacement, and released-client compensation                             |
| Contract | [package-boundaries.md](./package-boundaries.md)                               | Dependency/ownership boundaries for `@sp/sync-core`, `@sp/sync-providers`, app wiring                                                             |
| Contract | [conflict-journal-and-review.md](./conflict-journal-and-review.md)             | Disjoint-field auto-merge plus the dormant device-local journal/review capability and its security boundary                                       |
| Contract | [persisted-model-fields.md](./persisted-model-fields.md)                       | Adding fields to persisted models: optional-plus-default invariant, heal paths, and the latent hydration-validation failure (#8965)               |
| Contract | [local-recovery-points.md](./local-recovery-points.md)                         | Device-local snapshot ring before any full-state replacement, the backups list, and the shrink banner                                             |
| Contract | [vector-clocks.md](./vector-clocks.md)                                         | Vector-clock implementation, storage/pruning ownership, and history                                                                               |
| Contract | [supersync-encryption-architecture.md](./supersync-encryption-architecture.md) | End-to-end encryption wire format, key lifecycle, integrity boundary, and known limitations                                                       |
| Mixed    | [operation-log-architecture.md](./operation-log-architecture.md)               | Deep rationale and implementation history plus the normative A.7.11 cross-version/schema-bump contract; use executable owners for volatile detail |
| Triage   | [diagnosing-invalid-file-prefix.md](./diagnosing-invalid-file-prefix.md)       | Decode table for the `InvalidFilePrefixError` log diagnostics (`headShape`, `prefixAt`)                                                           |
| Triage   | [sync-severity-triage.md](./sync-severity-triage.md)                           | Severity triage for sync/data-loss reports: release-channel reality, shipped-or-not proof, user vocabulary, audit-finding handling                |

## Executable scenario index

| Document                                           | Scope                                                                  |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| [supersync-scenarios.md](./supersync-scenarios.md) | Representative scenario-to-test routing; executable tests own behavior |

## Active plans

| Document                                     | Scope                                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| [sqlite-migration.md](./sqlite-migration.md) | Current native SQLite durability rationale, landed foundation, remaining rollout gates |

## Related

| Location                                                                                                 | Content                                      |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [packages/super-sync-server/docs/architecture.md](../../packages/super-sync-server/docs/architecture.md) | SuperSync server-only architecture reference |
| [packages/super-sync-server/](../../packages/super-sync-server/)                                         | SuperSync server implementation              |
| [ARCHITECTURE-DECISIONS.md](../../ARCHITECTURE-DECISIONS.md)                                             | Load-bearing product/data decisions          |

Retired diagram filenames remain as small forwarding stubs so historical links
continue to resolve. `operation-rules.md` is also a compatibility pointer; it is
not an independent source of current behavior or status.
