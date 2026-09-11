# SuperSync Executable Scenario Index

**Status:** Routing index, not a prose specification.

Executable tests and their implementation owners define current behavior. This
page points maintainers to representative coverage for each durable scenario
family; it does not attempt to enumerate every timing interleaving or duplicate
test names in prose.

For the complete inventory, search
[`e2e/tests/sync/`](../../e2e/tests/sync/),
[`src/app/op-log/`](../../src/app/op-log/), and
[`packages/super-sync-server/tests/`](../../packages/super-sync-server/tests/).

## End-to-end scenarios

| Scenario family                                                      | Representative executable contracts                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Baseline create, update, delete, multi-client convergence            | [`supersync.spec.ts`](../../e2e/tests/sync/supersync.spec.ts)                                                                                                                                                                                                                                                                                                                                                                                    |
| No-op cursor advancement and realtime delivery                       | [`supersync-no-op-sync.spec.ts`](../../e2e/tests/sync/supersync-no-op-sync.spec.ts), [`supersync-realtime-push.spec.ts`](../../e2e/tests/sync/supersync-realtime-push.spec.ts), [`supersync-lastseq-preservation.spec.ts`](../../e2e/tests/sync/supersync-lastseq-preservation.spec.ts)                                                                                                                                                          |
| LWW conflicts, disjoint-field merge, multi-client winner convergence | [`supersync-lww-conflict.spec.ts`](../../e2e/tests/sync/supersync-lww-conflict.spec.ts), [`supersync.spec.ts`](../../e2e/tests/sync/supersync.spec.ts)                                                                                                                                                                                                                                                                                           |
| Delete-wins and ordered relationship conflicts                       | [`supersync-project-delete-conflict.spec.ts`](../../e2e/tests/sync/supersync-project-delete-conflict.spec.ts), [`supersync-concurrent-delete-reorder.spec.ts`](../../e2e/tests/sync/supersync-concurrent-delete-reorder.spec.ts), [`supersync-task-ordering.spec.ts`](../../e2e/tests/sync/supersync-task-ordering.spec.ts)                                                                                                                      |
| SECTION move/removal/reorder semantic replay                         | [`supersync-section-convergence.spec.ts`](../../e2e/tests/sync/supersync-section-convergence.spec.ts) and the [SECTION replay contract](./section-conflict-replay.md)                                                                                                                                                                                                                                                                            |
| SYNC_IMPORT clean slate, concurrent imports, late operations         | [`supersync-import-clean-slate.spec.ts`](../../e2e/tests/sync/supersync-import-clean-slate.spec.ts), [`supersync-concurrent-import.spec.ts`](../../e2e/tests/sync/supersync-concurrent-import.spec.ts), [`supersync-import-other-client-ops.spec.ts`](../../e2e/tests/sync/supersync-import-other-client-ops.spec.ts)                                                                                                                            |
| Empty/reset server migration and abort safety                        | [`supersync-server-migration.spec.ts`](../../e2e/tests/sync/supersync-server-migration.spec.ts), [`supersync-server-migration-abort.spec.ts`](../../e2e/tests/sync/supersync-server-migration-abort.spec.ts), [`supersync-account-reset.spec.ts`](../../e2e/tests/sync/supersync-account-reset.spec.ts)                                                                                                                                          |
| Backup/replacement recovery and crash resume                         | [`supersync-backup-recovery.spec.ts`](../../e2e/tests/sync/supersync-backup-recovery.spec.ts), [`supersync-use-remote-crash-resume.spec.ts`](../../e2e/tests/sync/supersync-use-remote-crash-resume.spec.ts), [`supersync-server-backup-revert.spec.ts`](../../e2e/tests/sync/supersync-server-backup-revert.spec.ts)                                                                                                                            |
| Encryption, password lifecycle, downgrade/decrypt failures           | [`supersync-encryption.spec.ts`](../../e2e/tests/sync/supersync-encryption.spec.ts), [`supersync-encryption-password-change.spec.ts`](../../e2e/tests/sync/supersync-encryption-password-change.spec.ts), [`supersync-wrong-password-error.spec.ts`](../../e2e/tests/sync/supersync-wrong-password-error.spec.ts), [`supersync-final-page-decrypt-failure-9256.spec.ts`](../../e2e/tests/sync/supersync-final-page-decrypt-failure-9256.spec.ts) |
| Retry, transient download, constraint, and network failure           | [`supersync-rejected-ops-transient-download-8331.spec.ts`](../../e2e/tests/sync/supersync-rejected-ops-transient-download-8331.spec.ts), [`supersync-constraint-error-recovery.spec.ts`](../../e2e/tests/sync/supersync-constraint-error-recovery.spec.ts), [`supersync-network-failure.spec.ts`](../../e2e/tests/sync/supersync-network-failure.spec.ts)                                                                                        |
| Compaction, snapshot clocks, and vector-clock pruning                | [`supersync-compaction.spec.ts`](../../e2e/tests/sync/supersync-compaction.spec.ts), [`supersync-snapshot-vector-clock.spec.ts`](../../e2e/tests/sync/supersync-snapshot-vector-clock.spec.ts), [`supersync-vector-clock-pruning.spec.ts`](../../e2e/tests/sync/supersync-vector-clock-pruning.spec.ts), [`supersync-vector-clock-max-size.spec.ts`](../../e2e/tests/sync/supersync-vector-clock-max-size.spec.ts)                               |
| Archive and multi-entity cascade behavior                            | [`supersync-archive-data-sync.spec.ts`](../../e2e/tests/sync/supersync-archive-data-sync.spec.ts), [`supersync-archive-conflict.spec.ts`](../../e2e/tests/sync/supersync-archive-conflict.spec.ts), [`supersync-cascade-delete.spec.ts`](../../e2e/tests/sync/supersync-cascade-delete.spec.ts), [`supersync-cross-entity.spec.ts`](../../e2e/tests/sync/supersync-cross-entity.spec.ts)                                                         |
| Provider/account switch and late join                                | [`supersync-provider-switch.spec.ts`](../../e2e/tests/sync/supersync-provider-switch.spec.ts), [`supersync-reenable-and-account-switch.spec.ts`](../../e2e/tests/sync/supersync-reenable-and-account-switch.spec.ts), [`supersync-late-join.spec.ts`](../../e2e/tests/sync/supersync-late-join.spec.ts), [`webdav-provider-switch.spec.ts`](../../e2e/tests/sync/webdav-provider-switch.spec.ts)                                                 |
| Schema and legacy-provider migration                                 | [`supersync-legacy-migration-sync.spec.ts`](../../e2e/tests/sync/supersync-legacy-migration-sync.spec.ts), [`webdav-legacy-migration-sync.spec.ts`](../../e2e/tests/sync/webdav-legacy-migration-sync.spec.ts)                                                                                                                                                                                                                                   |

## Focused client contracts

Use the smaller suite first when changing one mechanism:

| Mechanism                                       | Focused owner/test                                                                                                                                                                                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Download paging, gaps, and cursor plans         | [`operation-log-download.service.spec.ts`](../../src/app/op-log/sync/operation-log-download.service.spec.ts)                                                                                                                                             |
| Import filtering and clean-slate classification | [`sync-import-filter.service.spec.ts`](../../src/app/op-log/sync/sync-import-filter.service.spec.ts)                                                                                                                                                     |
| Remote conflict/apply orchestration             | [`remote-ops-processing.service.spec.ts`](../../src/app/op-log/sync/remote-ops-processing.service.spec.ts)                                                                                                                                               |
| Superseded-op replacement and SECTION replay    | [`superseded-operation-resolver.service.spec.ts`](../../src/app/op-log/sync/superseded-operation-resolver.service.spec.ts)                                                                                                                               |
| Decrypted payload/metadata integrity            | [`verify-decrypted-op-integrity.spec.ts`](../../src/app/op-log/sync/verify-decrypted-op-integrity.spec.ts)                                                                                                                                               |
| Crash-safe apply/store behavior                 | [`service-logic.integration.spec.ts`](../../src/app/op-log/testing/integration/service-logic.integration.spec.ts), [`remote-apply-store-port.integration.spec.ts`](../../src/app/op-log/testing/integration/remote-apply-store-port.integration.spec.ts) |

## Server contracts

| Mechanism                                       | Focused owner/test                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conflict detection and multi-entity lookup      | [`conflict-detection.spec.ts`](../../packages/super-sync-server/tests/conflict-detection.spec.ts), [`conflict-entity-lookup-plan.pglite.spec.ts`](../../packages/super-sync-server/tests/conflict-entity-lookup-plan.pglite.spec.ts)                                                                       |
| Atomic clean-slate replacement                  | [`clean-slate-atomicity-sql.integration.spec.ts`](../../packages/super-sync-server/tests/integration/clean-slate-atomicity-sql.integration.spec.ts)                                                                                                                                                        |
| Gap/reset detection                             | [`gap-detection.spec.ts`](../../packages/super-sync-server/tests/gap-detection.spec.ts)                                                                                                                                                                                                                    |
| Snapshot clock and skip optimization            | [`snapshot-vector-clock-sql.integration.spec.ts`](../../packages/super-sync-server/tests/integration/snapshot-vector-clock-sql.integration.spec.ts), [`snapshot-skip-optimization.integration.spec.ts`](../../packages/super-sync-server/tests/integration/snapshot-skip-optimization.integration.spec.ts) |
| Validation, payload limits, and server security | [`validation.service.spec.ts`](../../packages/super-sync-server/tests/validation.service.spec.ts), [`server-security.spec.ts`](../../packages/super-sync-server/tests/server-security.spec.ts)                                                                                                             |

## Running and extending coverage

Run a focused client spec with:

```bash
npm run test:file src/app/op-log/sync/<file>.spec.ts
```

For SuperSync and WebDAV E2E, prefer manually dispatching
[`E2E Tests (Scheduled)`](../../.github/workflows/e2e-scheduled.yml) for the
branch. It provides the dedicated services and sharded SuperSync jobs. See
[`e2e/CLAUDE.md`](../../e2e/CLAUDE.md) for focused local commands.

Every sync fix must begin with a reproducible failure against real operation or
state shapes. Add the narrow focused test first, then add or extend E2E when the
contract spans clients, persistence/restart, transport, or released-version
compatibility. Update this index only when a durable scenario family gains or
changes its executable owner.
