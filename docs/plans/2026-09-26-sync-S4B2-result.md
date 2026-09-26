# S4B2 — remove disabled snapshot auto-merge

The remaining application-only S4B deletion is complete. Concurrent snapshots
still use the existing conflict dialog; no live conflict policy was changed.

## Baseline and independence

- Starting HEAD: `9177c3afed6429934632b23de936cda8c6603fde`. Verified zero task
  commits, an empty index, no product edits, and only the injected `AGENTS.md`
  block. An authorized empty-range rebase with autostash moved this child to
  **`069d07a0ad7aba4dd339a33f498aabcf231d4791`** without replaying planning commits.
  That published baseline includes S1, S7 and merged #10277. The injected block
  remains unchanged and excluded from the commit.
- Before editing, the 2026-09-26 GitHub check found no matching open S4B2 PR
  among 105 open PRs. #10277 was confirmed merged at the baseline above.
- Rechecked both assigned pending heads and the newer #10272 head. Compared
  each with its merge base against the baseline; none changes this service,
  its spec, the flag definition, or its mutation/caller set.

| Pending PR                                                                                      | Inspected head                             |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------ |
| [#10272](https://github.com/super-productivity/super-productivity/pull/10272), assigned         | `ad845f5a27dbb33515814330f5ef53a7127e095d` |
| #10272, current at preflight                                                                    | `00674f7b89d41a4d5b2314bdf9324de3657d7a5b` |
| [#10275](https://github.com/super-productivity/super-productivity/pull/10275), assigned/current | `3e7292e4f85e2747032eb12f5f3d6fe6bac18ab3` |

The older [S4B report](2026-09-26-sync-S4B-result.md) remains historical evidence.
The new assignment narrows its adapter gate only for this application deletion.
No pending fix was merged or modified; #10272's ESLint change concerns a different
service entry.

## Reachability and compatibility evidence

At the pinned baseline, the [sole call at service line 899][baseline-service]
requires `gate === 'merge'`. `_classifySnapshotConflict` (line 1746) returns that
value only when its third argument is true. Its only caller passes
`FILE_BASED_SYNC_CONSTANTS.AUTO_MERGE_CONCURRENT_SNAPSHOT`, a literal false in
the [provider constants, line 233][baseline-constants]. Tracked-symbol and
whole-constant-use searches found no production mutation or alternate/dynamic
caller. The only enabling writes are the spec's `withAutoMergeEnabled` helper,
used by two tests. The same evidence holds at all three pending heads above.

The constant is exported by `packages/sync-providers/src/file-based.ts`, emitted
by the package's `file-based` build entry, and re-exported by the app's
`file-based-sync.types.ts`. Its property, literal value and types are retained;
only the adjacent obsolete comment changes. The existing provider-types test
still pins false. No persisted model, schema, wire format, public API, dependency,
adapter, resolver, journal, recovery storage or active safety UI changes.

## Exact change

| File                                                     | Scope                                                                                                                                                                                         |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/op-log/sync/operation-log-sync.service.ts`      | Remove the unreachable branch/helper, flag import and merge-only classifier plumbing: 119 lines removed, 3 added; 2704 → 2588 physical lines.                                                 |
| `src/app/op-log/sync/operation-log-sync.service.spec.ts` | Remove only the enabled-success test and flag-toggling helper. Retain the concurrent-dialog test and convert the compacted-gap case to production mode: one fewer test, 71 net lines removed. |
| `packages/sync-providers/src/file-based-sync-data.ts`    | Replace only the adjacent comment; retain the exported false property.                                                                                                                        |
| `eslint.config.js`                                       | Lower only this service's size ratchet from 2704 to 2588.                                                                                                                                     |
| This report                                              | Record evidence, validation and limits.                                                                                                                                                       |

The classifier still applies an ahead/equal snapshot, keeps an ahead local
clock, and opens the dialog for concurrent or missing/empty clock history.
Startup/meaningful-data classification, hydration, cursor promotion, pending
local operations, repair and conflict recovery are unchanged. Live LWW and
disjoint-field merge code elsewhere remains intact.

## Validation

Tested tree: the baseline SHA above plus this change; final commit SHA is supplied
in the handoff. All checks below passed:

- `npm run checkFile` on all three changed TypeScript files, including the
  provider comment file (actually covered by root ESLint).
- `tsc -p src/tsconfig.app.json --noEmit` and
  `tsc -p src/tsconfig.spec.json --noEmit`.
- Current `npm run test:file` runner: **364 passed, four pre-existing known-gap
  cases skipped**, across exactly five specs confirmed by Angular's discovery:
  `operation-log-sync.service.spec.ts`, `file-based-sync-adapter.service.spec.ts`,
  `file-based-sync/target-invalidation.integration.spec.ts`,
  `file-based-sync/conflict-resolution.integration.spec.ts`, and
  `file-based-redelivered-pruned-op.issue-10119.integration.spec.ts`.
  This includes target invalidation, revision/cache-expiry checks, real adapter
  integration, concurrent-dialog and compacted-base coverage. The four skipped
  cases concern regressed author counters, not this deletion.
- `npm run sync-providers:build`; package test typecheck and
  `npm --prefix packages/sync-providers test -- tests/provider-types.spec.ts`:
  **6 passed**, including the exported false value.
- AST comparison: 53 other service members unchanged; `_processDownloadResult`
  changes only by removal of the dead branch and flag argument. Package AST is
  unchanged after removing comments. Final diff reviewed for live semantics.
- Size ratchet negative control rejects an in-memory 2589th line. Formatting
  and whitespace checks passed; no control files are staged.

Artifacts: `/tmp/sync-s4b2-20260926-eym5_v2s/` contains reference searches,
pending diffs, discovery list, isolated Karma config, logs and source comparison.
Ports 9897/9247 were verified free; shared services were untouched. The first
sandboxed Karma launch could not bind; the elevated rerun passed. The existing
Chrome 107 Browserslist warning remains.

## Independent review

A fresh GPT-6 Astra subagent reviewed commit `d1c34728153dc544ed4085df682fca13e25f4755`
against the pinned baseline, assignment, caller/export evidence and test coverage.
It found no introduced defects or necessary code changes. The primary agent
also verified the discovery/results and that all four tested code/config hashes
still match the commit. No additional runtime changes or test reruns were needed.
Confidence is high for this bounded deletion, subject to the limits below.

## Residual risk and integration gates

This is unreachable-code removal, not a sync bug fix; no artificial E2E failure
was manufactured. Sync remains data-sensitive: wrong reachability assumptions
could remove behavior. The caller/mutation audit and retained regressions bound
that risk. Full provider E2E, released-client runs, and combined pending-PR
behavior were not tested; existing skipped cases are not claimed as coverage.
User review is required before integration. Pending adapter/resolver fixes and
their integration checks remain independently owned; broader S4 cleanup stays
deferred. No push, merge, workflow dispatch or next task is part of this result.

[baseline-service]: https://github.com/super-productivity/super-productivity/blob/069d07a0ad7aba4dd339a33f498aabcf231d4791/src/app/op-log/sync/operation-log-sync.service.ts#L899
[baseline-constants]: https://github.com/super-productivity/super-productivity/blob/069d07a0ad7aba4dd339a33f498aabcf231d4791/packages/sync-providers/src/file-based-sync-data.ts#L233
