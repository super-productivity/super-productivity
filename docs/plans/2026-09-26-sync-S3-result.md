# S3 result: park the inactive SQLite operation-log backend

Date: 2026-09-26. Starting SHA:
`9177c3afed6429934632b23de936cda8c6603fde`.

## Decision and scope

Implemented the approved removal of the dormant SQLite foundation. This is
source/test/dependency removal, not a user storage migration. No database
migration/deletion, schema bump, new dependency, runtime guard, or replacement
abstraction was added. Reopen only for confirmed eviction loss not covered by
native backups; the old proposal's motivation alone is insufficient.

The live adapter port, factory, IndexedDB implementation, schema, operation-log
store, archive store, conflict resolver, and file-sync adapter are unchanged.
The legacy pfapi/v16 migration and Android/iOS/Electron backups are unchanged.
No read-only production file needed a dead-import adjustment.

## Consumer evidence

Before deletion, repository-wide searches (including hidden build/CI/tooling
files, excluding `.git` and installed dependencies) covered file names, static
and dynamic import targets, factory overrides, exports and exported symbols,
`sql.js`, `initSqlJs`, and WASM configuration.

- `op-log-db-adapter.token.ts` supplies
  `factory: () => () => new IndexedDbOpLogAdapter()` without a platform branch.
  Its only production consumers are `OperationLogStoreService` and
  `ArchiveStoreService`. All provider overrides were in specs; no application
  configuration selects SQLite.
- `sqlite-op-log-adapter.ts` was consumed by its own spec, the backend-migration
  spec, `sql-js-db.test-helper.ts`, and SQLite cases in the store and two
  integration specs. Its SQL-planning exports had no other consumers.
- `migrateOpLogBackend`, its result type, and error class had no production
  callers or barrel exports. The only importing file was its SQLite migration
  spec. This helper is distinct from the retained
  `operation-log-migration.service.ts` and legacy pfapi migration.
- `sql.js` had one root devDependency and one dependency-free lockfile package
  entry. Its only loader was the test helper, using the global script and WASM
  proxy in `src/karma.conf.js`. No `@types/sql.js` dependency existed.
- Android's `KeyValStore.kt` uses the separate `SupKeyValStore` database for
  native backups. It does not consume the removed TypeScript adapter or sql.js.
- After deletion there are no live imports, exports, loader entries, package
  references, or factory overrides pointing to removed code. Full app/spec
  TypeScript checks also resolve successfully.

Untouched comments and documentation outside S3 still contain historical SQLite
references (including the port/factory comments, `src/app/README.md`, the sync
README, and the transaction lint rule's rationale). They are not executable
consumers. The authoritative SQLite plan now explicitly records the parked
status and pins the historical implementation. The transaction lint rule and
its tests remain: removing transaction-boundary enforcement is outside S3.

## Exact file changes

Deleted:

- `src/app/op-log/persistence/sqlite-op-log-adapter.ts`
- `src/app/op-log/persistence/sqlite-op-log-adapter.spec.ts`
- `src/app/op-log/persistence/op-log-backend-migration.ts`
- `src/app/op-log/persistence/op-log-backend-migration.spec.ts`
- `src/app/op-log/persistence/sql-js-db.test-helper.ts`

Removed SQLite-only cases while preserving IndexedDB coverage:

- `src/app/op-log/persistence/operation-log-store.service.spec.ts`: removed
  three SQLite metadata tests and their imports; existing IndexedDB metadata
  and adapter-contract tests remain.
- `src/app/op-log/testing/integration/remote-apply-store-port.integration.spec.ts`:
  removed the SQLite pass and unwrapped the IndexedDB suite. Its composed
  apply/checkpoint/clock assertions remain. De-indentation accounts for much
  of this file's apparent diff.
- `src/app/op-log/testing/integration/sqlite-shared-connection.integration.spec.ts`
  became `src/app/op-log/testing/integration/indexed-db-store-concurrency.integration.spec.ts`:
  kept all three IndexedDB cases; removed the SQLite pass, SQL row-counter test,
  and SQLite-specific fixtures. The retained cases cover concurrent writes,
  isolated archive rollback, and `hasSyncedOps()` index semantics.

Configuration and documentation:

- `src/karma.conf.js`: removed only the sql.js script/WASM serving configuration.
- `package.json` and `package-lock.json`: removed only sql.js.
- `docs/sync-and-op-log/sqlite-migration.md`: parked status, reopening criterion,
  historical context, and last implementation commit.
- `docs/plans/2026-09-26-sync-S3-result.md`: this evidence and local issue draft.

No agent-control files, parent review/ledger, or S8 documentation were edited.
The pre-existing app-injected `AGENTS.md` change is excluded from the commit.
No agents were spawned and no shared services were stopped or restarted.

## Parallel work checked

Read-only GitHub API inspection on 2026-09-26 found both PRs open:

- S1 #10270 at `a59e9496a72ab9fcb83e0a36f88365197daceea6`: file-sync adapter and
  related tests/docs; no overlap with S3 files.
- S7 #10269 at `0bb6e5ac662a0dc2ab9e38a482583d00e4ace45b`: operation-log store,
  clock utility, repair/validation code, lint config and tests/docs. Those
  production files and lint config remain untouched here.

S2 reorder conflict resolution and S8 migration-notice documentation were
reserved and left untouched. Pending PRs were inspected, not merged or tested
in combination with this branch.

## Validation

- PASS: `tsc -p src/tsconfig.app.json --noEmit`.
- PASS: `tsc -p src/tsconfig.spec.json --noEmit`.
- PASS: `npm run checkFile` for all three remaining modified/new TypeScript
  specs above and `src/karma.conf.js`.
- PASS: parsed manifest/lockfile equality for dependency sections. Comparing
  the lockfile with the starting commit after removing exactly sql.js's root
  entry and package record yields identical JSON; no transitive churn.
- PASS: post-removal consumer scan and `git diff --check`.
- PASS: focused Karma suite, **323/323 tests**, covering
  `indexed-db-op-log-adapter.spec.ts`, `operation-log-store.service.spec.ts`,
  `archive-store.service.spec.ts`, `op-log-db-schema.spec.ts`,
  `db-upgrade.spec.ts`, `remote-apply-store-port.integration.spec.ts`, and
  `indexed-db-store-concurrency.integration.spec.ts`.

The configured Husky hook launcher (`.husky/_/pre-commit`) is absent in this
worktree, so `npm run lint` was invoked explicitly. TypeScript lint, SCSS lint,
CSS-variable checks, and all seven lint-rule spec files passed. The chain
stopped at two unrelated CLI tooling suites whose stderr was empty in the
sandbox (`check-css-vars.test.js`, `strip-service-worker-assets.test.js`).
`npm run test:tools` passed outside the sandbox (all six suites), and
`npm run test:mac-icon` passed separately. Thus every lint-chain stage passed,
with the tooling stage requiring an escalated rerun. Changed-file formatting
was checked separately. Logs: `/tmp/s3-lint.log`,
`/tmp/s3-tools-escalated.log`.

Karma uses a local, uncommitted config inheriting `src/karma.conf.js`, port 9879
(checked free before launch), and an OS-assigned Chrome debugging port. The
sandbox initially rejected binding 9879 with `EPERM`; the same command was
rerun with escalation. Test logs are `/tmp/s3-persistence-tests.log`;
compile logs are `/tmp/s3-app-compile.log` and `/tmp/s3-spec-compile.log`.

Limits: the standard Karma setup uses `fake-indexeddb`, so these checks do not
prove native device lifecycle behavior or browser eviction recovery. No new
sync behavior or bug fix is introduced; no E2E was invented for unreachable
code deletion. Full SuperSync/WebDAV suites and native builds were not run.
The main removal risk was overlooking a live consumer or deleting shared
IndexedDB coverage; the factory/import audit, compile checks, retained tests,
and final diff review address those risks. No separate runtime bug was found.

## Local draft for issue #7931 — not posted

The native SQLite op-log plan is parked by maintainer decision (2026-09-26).
IndexedDB remains the active op-log backend on every platform. The inactive
adapter, backend-copy helper, SQLite-only tests and sql.js test dependency have
been removed; the persistence port, IndexedDB backend, legacy pfapi/v16
migration and native backups remain in place. This change does not migrate or
delete user databases.

The last commit containing the removed implementation is
`9177c3afed6429934632b23de936cda8c6603fde`. The updated
`docs/sync-and-op-log/sqlite-migration.md` preserves the historical context.
Reopen the plan only for a confirmed eviction loss not covered by native
backups. The previous proposal alone is not evidence to build a replacement.
