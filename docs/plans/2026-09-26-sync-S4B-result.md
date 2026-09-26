# S4B — shared-internals audit and store cleanup

**The independent three-method store cleanup is implemented and validated.**
Adapter/resolver work and public-contract decisions remain deferred. The preflight
below records the original audit at `c24c5e7ef5`; the implementation and its own
validation are recorded in the final section. Full S4B cleanup is not complete.

Starting HEAD was `9177c3afed6429934632b23de936cda8c6603fde`. The branch had zero
task commits, an empty index, no product changes, and only the injected
`AGENTS.md` block. After checking these preconditions, an empty-range
`git rebase --autostash --onto c24c5e7ef5a320b376efc34958a8670b3727aa6b 9177c3afed6429934632b23de936cda8c6603fde`
moved it to the **audited baseline `c24c5e7ef5a320b376efc34958a8670b3727aa6b`**.
The runtime block reapplied unchanged and remains uncommitted. No parent planning
commits were replayed. The final report commit SHA is supplied with the handoff.

Inputs: `/tmp/sync-s4b-architecture-review-20260926.md` (Phase 1),
`/tmp/sync-s4b-work-sessions-20260926.md` (S4), and the assignment's newer dependency
facts. Read the repository guidance, feature review guide, contributor sync model,
sync index, package boundaries, recovery contract and S7 repair follow-up.
S4A's report/change `ec3a75fbe10156a87c5c69721c511bf5648a1dd8` was inspected;
its four compiled pfapi files and the Project/Tag/SimpleCounter wrappers/tests
are excluded. No other worktree or test resource was changed.

## Dependency gates

These are pinned local-source findings and supplied PR identities, not refreshed
GitHub status or a review of the fixes themselves.

| Dependency                                                                                          | Audited revision and disposition                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S3                                                                                                  | Integrated at `c24c5e7ef5a320b376efc34958a8670b3727aa6b`; SQLite removal is included in this audit.                                                                                                                                        |
| S7 / [#10269](https://github.com/super-productivity/super-productivity/pull/10269)                  | `532456b8e3bbe53fa98d4149766b668014454156` is an ancestor of the baseline. The repair-persistence change, including the store transaction changes, is included.                                                                            |
| S8                                                                                                  | Notice commit `cff09e9ee85d17d14f08f740a7b675b37db1494c` is an ancestor. This does not authorize runtime migration retirement.                                                                                                             |
| S1 / [#10270](https://github.com/super-productivity/super-productivity/pull/10270)                  | `a59e9496a72ab9fcb83e0a36f88365197daceea6` is not integrated. It changes the file adapter, its spec and file-sync integrations. Require integration and re-audit before adapter/package deletions.                                         |
| Unseen-revision fix / [#10272](https://github.com/super-productivity/super-productivity/pull/10272) | `e1eedbcb96e230b6c83d35f7fdea36561594f1cb` is not integrated. It overlaps S1 in the adapter, adapter spec and file-sync integrations; its final reconciled implementation is also a gate.                                                  |
| S2                                                                                                  | Product `50b5879c03e79b6407b3571f54d83c672c80ed1d`, report `b9d2f7f8f6f92958498fb233af4840c9435f5c32`; neither is an ancestor. Resolver deletion requires S2 integration and a fresh caller audit. The active S2 checkout was not changed. |

All twelve candidate names below were searched as whole words in tracked files at
master, S1, S2 and #10272. Comparing each fix with its merge base found no added or
removed candidate-reference lines. None of the three fixes changes the store,
the three stale-spy specs listed below, `OperationLogSyncService`, or the provider
package. This supports the independent store subset; it does not lift the
adapter/resolver integration gates.

The older pending trees still contain a SQLite mixed-store test calling
`clearFullStateOps` and SQLite batch tests replaced by S3's IndexedDB concurrency
suite. These are baseline differences, not new consumers introduced by S1/S2/#10272.
Do not resurrect them or use those older trees as the deletion baseline.

## Consumer evidence and disposition

Source links below pin the audited master and this table records the preflight
decisions. **Remove** identified the three candidates implemented in the final
section. **Defer** means leave unchanged pending the named gate or preservation
of existing coverage.

| Candidate                        | Production and test consumers                                                                                                                                                                                                                                                                                                                                         | Build/export/dynamic contract; decision                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_tryConcurrentSnapshotMerge`    | Defined in [OperationLogSyncService:1785][sync]; sole call at :899 requires the `merge` result from :1746. The only flag-enabling test helper is [sync spec:4649][sync-spec], used by cases (d) and (e); case (c) at :4664 checks the live dialog behavior.                                                                                                           | Internal app method, not a file-adapter method. **Defer — S1 and #10272 integration/re-audit.** Later remove only the unreachable branch/helper, its classifier plumbing and exclusively enabled tests; retain causality/dialog and target-invalidation coverage.                                                                                 |
| `AUTO_MERGE_CONCURRENT_SNAPSHOT` | Literal `false` at [file-based-sync-data:233][constants]; only production read is sync service :878. Provider-types spec :146 pins false. Adapter :432 and target-invalidation spec :16 mention it only in comments.                                                                                                                                                  | Exported through [file-based barrel:1][file-barrel] and emitted by the provider package. **Defer — adapter gates plus export compatibility decision.** Removing the app branch need not withdraw this exported property; retain it if consumer compatibility remains uncertain. No production flag mutation was found.                            |
| `clearFullStateOps`              | [Store:1699][store] only wraps `clearFullStateOpsExcept([])`. No live caller or direct test at master. Three specs have stale spy declarations/setup: [remote processing:107,133][remote-spec], [sync:155,183][sync-spec], [upload piggyback:161,177][piggyback-spec].                                                                                                | Internal app service method; no supported package/plugin or dynamic consumer found. **Remove candidate — S3/S7 integrated.** Remove only this wrapper and those spy entries, keeping the specs and the live `clearFullStateOpsExcept` contract/call at [remote-apply:35,327][remote-apply].                                                       |
| `clearUnsyncedOps`               | [Store:1893][store]; no live caller. Six calls, all in its exclusive [store spec:5021–5152][store-spec] describe block.                                                                                                                                                                                                                                               | Internal app service method. **Remove candidate — S3/S7 integrated.** Its six method-only cases can go; keep `getUnsynced`, `markRejected`, cache invalidation and the actual replacement transactions.                                                                                                                                           |
| `filterNewOps`                   | [Store:1569][store]; no live caller. Four direct tests at [store spec:509][store-spec], plus two calls in retained `appendBatch` ConstraintError recovery regressions at :1468 and :1491. E2E/upload-spec mentions are historical comments, not calls.                                                                                                                | Internal app service method. **Defer.** Do not discard/rewrite meaningful batch-recovery coverage merely to remove this small helper. Live deduplication uses `appendBatchSkipDuplicates` at [remote-apply:109][remote-apply].                                                                                                                    |
| `loadStateCacheBackup`           | [Store:2209][store]; declaration only, no test caller. Recovery reads the backup directly via `hasStateCacheBackup`/`restoreStateCacheFromBackup`, called by [hydrator:141,156][hydrator] and [snapshot:218–287][snapshot].                                                                                                                                           | Internal app service method. **Remove candidate — S3/S7 integrated.** Keep backup keys/data and save/has/restore/clear methods; no persisted reader used by recovery is removed.                                                                                                                                                                  |
| `incrementCompactionCounter`     | [Store:2288][store]; no live caller. Store unit regressions and six calls in [compaction integration:518–668][compaction-spec] seed/reset counters and check that an empty projection cannot overwrite a good cache.                                                                                                                                                  | Internal app service method. **Defer.** Counter get/reset remain live at [capture:417][capture] / [compaction:295][compaction]. Preserve those readers, null-state cache handling and these regressions; deleting the writer is not permission to remove persisted-counter plumbing.                                                              |
| `appendBatch`                    | [Store:905][store] is used by [SimulatedClient.createLocalOpsBatch:97–115][simulated], large-batch and error-recovery integration tests; also direct archive-conflict, tab-frontier, IndexedDB concurrency and store tests.                                                                                                                                           | Test infrastructure with real transaction/duplicate-error/frontier behavior; a lint-rule fixture also uses the name. **Retain.** Do not replace batching with per-op appends or weaken the harness for a deletion count.                                                                                                                          |
| `_deepEqual`                     | [Resolver:960][resolver]; only calls are through the helper in [resolver spec:5734][resolver-spec].                                                                                                                                                                                                                                                                   | Private app wrapper. **Defer — S2.** Core `deepEqual` is exported and also called directly by live resolver code at :880–882; keep it and its import.                                                                                                                                                                                             |
| `_extractEntityFromPayload`      | [Resolver:4201][resolver]; only five direct spec calls in [resolver spec:8404][resolver-spec].                                                                                                                                                                                                                                                                        | Private app wrapper. **Defer — S2.** Keep live `extractEntityFromPayloadCore` at :3601 and `_resolvePayloadKey`; both survive wrapper removal.                                                                                                                                                                                                    |
| `_extractUpdateChanges`          | [Resolver:4213][resolver]; only five direct spec calls in [resolver spec:8446][resolver-spec].                                                                                                                                                                                                                                                                        | Private app wrapper. **Defer — S2.** Its wrapper-only import may then qualify; the exported sync-core helper and its consumers are not deletion candidates.                                                                                                                                                                                       |
| `listFiles`                      | No top-level app sync caller. Implementations/delegation remain in [Dropbox:276][dropbox], [OneDrive:267][onedrive], [WebDAV base:190][webdav], [LocalFile base:57][local-file]; WebDAV/Nextcloud and Electron/Android inherit these capabilities. Package WebDAV/LocalFile specs, app OneDrive pagination/security specs and the mock provider consume/implement it. | Optional exported [FileSyncProvider:79][provider-types] and [FileAdapter:6][file-adapter] capability, plus exported provider classes. **Defer deletion; retain capability.** Absence of an app caller does not establish absence of supported external consumers. Android SAF currently throws; that does not justify deleting working providers. |

Build/contract inspection covered the [app TS inputs][app-config],
[spec inputs][spec-config], provider [package exports][provider-package] and
[tsup entries/declarations][provider-build], tracked tooling/templates/CI, and
[PluginBridgeService.createBoundMethods:240][plugin-bridge]. The bridge exposes
explicit operations, not these service instances. No method-name reflection or
supported public export was found for the store/resolver candidates; their
string-named spies/private spec calls are included above. Provider contracts,
in contrast, are explicit emitted API. In-repository searches cannot certify
unknown external package consumers.

## Approved preflight plan

Propose **only `clearFullStateOps`, `clearUnsyncedOps`, and
`loadStateCacheBackup`** for the first independent implementation: one production
file, the store spec's six exclusive cases, and the three stale spy setups.
S3/S7 are integrated and none of the pinned pending fixes adds a caller or touches
these files relative to its own base. Recheck on the actual implementation base.
Do not include the adapter, resolver, provider exports, batch harness, compaction
plumbing, S4A files, persisted actions/reducers, migration/import support, schemas
or dependencies. There is no deletion quota.

For that later change, run `checkFile` on every modified TS/SCSS file, app/spec
type checks, and focused store, remote-processing, sync, upload-piggyback,
hydrator/snapshot recovery and IndexedDB concurrency checks. Confirm the surviving
cleanup and recovery paths are unchanged. Re-audit and separately validate the
adapter/resolver candidates only after their integrated fixes; preserve meaningful
default-behavior tests. This preflight is not evidence of runtime equivalence.

Preflight commit `7372e981d40d4a93a711b8531f2d64298d20d14b` changed this report
only. It verified caller/contracts, ancestry/diffs, 28 pinned source links,
formatting and whitespace; it did not run runtime tests or builds.

## Store-only implementation and validation

The follow-up started at `7372e981d40d4a93a711b8531f2d64298d20d14b`, with only
the original injected `AGENTS.md` block uncommitted. Local master remained
`c24c5e7ef5a320b376efc34958a8670b3727aa6b`; S3/S7 were integrated. Rechecked the
three methods' tracked callers and export evidence on this actual baseline before
editing. No rebase or pending-PR integration was needed.

Exact changed files (relative to the preflight commit):

| File                                                                         | Change                                                                                                                                                                                         |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/op-log/persistence/operation-log-store.service.ts`                  | Remove only `clearFullStateOps`, `clearUnsyncedOps` and `loadStateCacheBackup`, including their exclusive comments: **50 production lines removed**, none added; 3,203 → 3,153 physical lines. |
| `src/app/op-log/persistence/operation-log-store.service.spec.ts`             | Remove the six exclusive `clearUnsyncedOps` cases: 134 lines.                                                                                                                                  |
| `src/app/op-log/sync/remote-ops-processing.service.spec.ts`                  | Remove the stale `clearFullStateOps` spy, setup and comment: 3 lines.                                                                                                                          |
| `src/app/op-log/sync/operation-log-sync.service.spec.ts`                     | Remove the stale spy and setup: 2 lines.                                                                                                                                                       |
| `src/app/op-log/sync/operation-log-upload-piggyback-seq.integration.spec.ts` | Remove the stale spy and setup: 2 lines.                                                                                                                                                       |
| `eslint.config.js`                                                           | Lower the existing store size limit from 3,203 to 3,153, as the existing ratchet requires. This one-line tooling update was missing from the preflight plan.                                   |
| `docs/plans/2026-09-26-sync-S4B-result.md`                                   | Update status and record this implementation/validation.                                                                                                                                       |

Review confirms all **99 surviving store members** and every module-level
statement are textually identical to the starting commit, using the TypeScript
parser to compare members. No removed method references remain in production,
tests or tooling. `clearFullStateOpsExcept`, recovery readers/writers and backup
data, all replacement transactions, batch/compaction behavior, persisted
actions/reducers, schema/wire contracts, migration/import and provider APIs are
unchanged. The larger test deletion consists only of the six now-inapplicable
method tests; meaningful regression suites remain. This removes unreachable code,
not a reproduced sync bug, so no artificial failing E2E or replacement test was
added.

Validation on the final product diff:

- `npm run checkFile <path>` — passed for all five changed TypeScript files.
- `node /home/johannes/www/super-productivity/node_modules/typescript/bin/tsc -p
src/tsconfig.app.json --noEmit` and the same command with
  `src/tsconfig.spec.json` — both passed.
- `npm run test:file -- '<focused glob>' --karma-config=<temporary config>
--source-map=false` — **670 passed, zero skipped/failed**. The installed Angular
  Karma runner's `findTests` discovered exactly nine files: the store, remote
  processing, sync, upload-piggyback and snapshot specs; hydrator service, retry and
  failed-op-boot specs; and IndexedDB store concurrency. The temporary config calls
  the repository config and changes only its source base path and verified-free
  Karma/debug ports to **9883/9233**. The first sandboxed run failed to bind; the
  elevated rerun completed successfully. Existing Chrome 107 Browserslist warning.
- The size limit rejects a one-line increase supplied in memory; no source file
  was changed for this check. The read-only member comparison needed elevation
  after the sandbox blocked Node's Git subprocess.
- Report/config formatting, pinned source links, `git diff --check`, and final
  scope review passed. The tested TS/config file hashes are recorded alongside the
  test log and checked against the committed result. No other task's tests are
  claimed and no shared service was stopped.

The exact test command, discovery list, isolated config, log and tested-file
hashes are in `/home/johannes/tmp/sync-s4b-store-20260926-_j28em65/` (`focused.log`,
`discovered-specs.json`, `karma.cjs`, `tested-file-hashes.json`). The final commit
SHA is supplied in the handoff; its product files match this validated tree.

Remaining gates (updated from the parent's follow-up, not polled): S1
[#10270](https://github.com/super-productivity/super-productivity/pull/10270)
at `a59e9496a7`, overlapping adapter fix
[#10272](https://github.com/super-productivity/super-productivity/pull/10272)
at `e1eedbcb96`, and S2
[#10275](https://github.com/super-productivity/super-productivity/pull/10275)
at `7d88866e91563a979149df7cade257d61ba4fd18` are open. S4A is separately owned in
[#10274](https://github.com/super-productivity/super-productivity/pull/10274)
at `42bdf11c15d1aaa41b36fbb431e7ec1c8e7b8ce7`. Adapter/resolver deletion still
requires integration and re-audit; public-contract and meaningful-test consumers
remain deferred/retained. The parent's #10267 download/rejection-handler fix does
not overlap this subset. S5/S6 are outside this follow-up. Completion requests
review of this store-only implementation, not approval or completion of full S4B.

[sync]: https://github.com/super-productivity/super-productivity/blob/c24c5e7ef5a320b376efc34958a8670b3727aa6b/src/app/op-log/sync/operation-log-sync.service.ts#L1785
[sync-spec]: https://github.com/super-productivity/super-productivity/blob/c24c5e7ef5a320b376efc34958a8670b3727aa6b/src/app/op-log/sync/operation-log-sync.service.spec.ts#L4649
[constants]: https://github.com/super-productivity/super-productivity/blob/c24c5e7ef5a320b376efc34958a8670b3727aa6b/packages/sync-providers/src/file-based-sync-data.ts#L233
[file-barrel]: https://github.com/super-productivity/super-productivity/blob/c24c5e7ef5a320b376efc34958a8670b3727aa6b/packages/sync-providers/src/file-based.ts#L1
[store]: https://github.com/super-productivity/super-productivity/blob/c24c5e7ef5a320b376efc34958a8670b3727aa6b/src/app/op-log/persistence/operation-log-store.service.ts
[store-spec]: https://github.com/super-productivity/super-productivity/blob/c24c5e7ef5a320b376efc34958a8670b3727aa6b/src/app/op-log/persistence/operation-log-store.service.spec.ts
[remote-spec]: https://github.com/super-productivity/super-productivity/blob/c24c5e7ef5a320b376efc34958a8670b3727aa6b/src/app/op-log/sync/remote-ops-processing.service.spec.ts#L107
[piggyback-spec]: https://github.com/super-productivity/super-productivity/blob/c24c5e7ef5a320b376efc34958a8670b3727aa6b/src/app/op-log/sync/operation-log-upload-piggyback-seq.integration.spec.ts#L161
[remote-apply]: https://github.com/super-productivity/super-productivity/blob/c24c5e7ef5a320b376efc34958a8670b3727aa6b/packages/sync-core/src/remote-apply.ts#L327
[hydrator]: https://github.com/super-productivity/super-productivity/blob/c24c5e7ef5a320b376efc34958a8670b3727aa6b/src/app/op-log/persistence/operation-log-hydrator.service.ts#L141
[snapshot]: https://github.com/super-productivity/super-productivity/blob/c24c5e7ef5a320b376efc34958a8670b3727aa6b/src/app/op-log/persistence/operation-log-snapshot.service.ts#L218
[compaction-spec]: https://github.com/super-productivity/super-productivity/blob/c24c5e7ef5a320b376efc34958a8670b3727aa6b/src/app/op-log/testing/integration/compaction.integration.spec.ts#L518
[capture]: https://github.com/super-productivity/super-productivity/blob/c24c5e7ef5a320b376efc34958a8670b3727aa6b/src/app/op-log/capture/operation-log.effects.ts#L417
[compaction]: https://github.com/super-productivity/super-productivity/blob/c24c5e7ef5a320b376efc34958a8670b3727aa6b/src/app/op-log/persistence/operation-log-compaction.service.ts#L295
[simulated]: https://github.com/super-productivity/super-productivity/blob/c24c5e7ef5a320b376efc34958a8670b3727aa6b/src/app/op-log/testing/integration/helpers/simulated-client.helper.ts#L97
[resolver]: https://github.com/super-productivity/super-productivity/blob/c24c5e7ef5a320b376efc34958a8670b3727aa6b/src/app/op-log/sync/conflict-resolution.service.ts
[resolver-spec]: https://github.com/super-productivity/super-productivity/blob/c24c5e7ef5a320b376efc34958a8670b3727aa6b/src/app/op-log/sync/conflict-resolution.service.spec.ts
[dropbox]: https://github.com/super-productivity/super-productivity/blob/c24c5e7ef5a320b376efc34958a8670b3727aa6b/packages/sync-providers/src/file-based/dropbox/dropbox.ts#L276
[onedrive]: https://github.com/super-productivity/super-productivity/blob/c24c5e7ef5a320b376efc34958a8670b3727aa6b/packages/sync-providers/src/file-based/onedrive/onedrive.ts#L267
[webdav]: https://github.com/super-productivity/super-productivity/blob/c24c5e7ef5a320b376efc34958a8670b3727aa6b/packages/sync-providers/src/file-based/webdav/webdav-base-provider.ts#L190
[local-file]: https://github.com/super-productivity/super-productivity/blob/c24c5e7ef5a320b376efc34958a8670b3727aa6b/packages/sync-providers/src/file-based/local-file/local-file-sync-base.ts#L57
[provider-types]: https://github.com/super-productivity/super-productivity/blob/c24c5e7ef5a320b376efc34958a8670b3727aa6b/packages/sync-providers/src/provider-types.ts#L79
[file-adapter]: https://github.com/super-productivity/super-productivity/blob/c24c5e7ef5a320b376efc34958a8670b3727aa6b/packages/sync-providers/src/file-adapter.ts#L6
[app-config]: https://github.com/super-productivity/super-productivity/blob/c24c5e7ef5a320b376efc34958a8670b3727aa6b/src/tsconfig.app.json
[spec-config]: https://github.com/super-productivity/super-productivity/blob/c24c5e7ef5a320b376efc34958a8670b3727aa6b/src/tsconfig.spec.json
[provider-package]: https://github.com/super-productivity/super-productivity/blob/c24c5e7ef5a320b376efc34958a8670b3727aa6b/packages/sync-providers/package.json
[provider-build]: https://github.com/super-productivity/super-productivity/blob/c24c5e7ef5a320b376efc34958a8670b3727aa6b/packages/sync-providers/tsup.config.ts
[plugin-bridge]: https://github.com/super-productivity/super-productivity/blob/c24c5e7ef5a320b376efc34958a8670b3727aa6b/src/app/plugins/plugin-bridge.service.ts#L240
