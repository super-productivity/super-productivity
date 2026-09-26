# S1 result: stale v2 snapshots (#10256)

**Status:** implemented and verified locally; ready for user review. No push,
public post, merge, or format rollout. Full scheduled CI remains outstanding.

- Starting SHA: `9177c3afed6429934632b23de936cda8c6603fde`.
- Validated implementation SHA: `b917fd9610d09b7ecb2958f2ac68652652c5ea73`.
  The commands below ran against the implementation in this worktree before
  its commit; the subsequent report commit changes documentation only.
- Used the current review and S1 brief from
  `/tmp/sync-architecture-orchestration-20260926-9177c3afed/`, not the older
  committed review. Neither shared document nor the parent ledger was edited.
- [#10256](https://github.com/super-productivity/super-productivity/issues/10256)
  was open when checked through the GitHub API on 2026-09-26. The related merged
  PR #10249 explicitly left this bug and its disabled seeds unresolved.

## Change and scope

A v2 upload whose cache has expired can read another writer's newer operations
and embed them in `recentOps`, while its local snapshot lacks their changes.
Seq-0 hydration then treats those operations as already included and loses them.

The adapter now refuses that op-bearing upload with the existing retryable
`UploadRevToMatchMismatchAPIError` unless it has this cycle's download cache or
a matching, non-empty, already-applied revision. It refuses before either the
backup or primary write and does not cache or commit the newly read revision.
The ordinary next sync downloads first, applies the peer's operations, and
uploads the original pending work with a consistent snapshot. No new retry
loop, snapshot metadata, wire fields, persisted fields, or schema version.
Retry is sufficient here; adding snapshot metadata would also require handling
old writers that omit it and old readers that ignore it.

Only `file-based-sync-adapter.service.ts` changes production behavior. The larger
test diff comprises the three-client browser regression, two revision cases,
re-enabled seeds 2/14, and fixtures that formerly uploaded unseen operations
directly. Those fixtures now download before uploading or assert refusal and
retry explicitly. The #10119 cursor test retains v3's original path and checks
v2's refusal before its cursor advances. No mock applier establishes convergence;
the browser test provides that evidence.

The service remains 3,292 physical lines, its baseline size. No overlap with
S2's conflict-resolution implementation, package manifests, v3 defaults,
journal, SQLite, or agent-control files. The pre-existing injected `AGENTS.md`
working-tree change is excluded from both commits.

## Reproduction and results

The new WebDAV test creates three isolated browser contexts. A uploads a shared
baseline and B downloads it. B creates a pending task. Holding the real
`sp_op_log_upload` Web Lock lets B finish its normal download before A uploads
another task. Advancing B's `Date.now()` by over 30 seconds, without firing
timers, expires the real adapter cache. Releasing the lock forces B's upload-side
GET against the real WebDAV service. No adapter, reducer, or hydration method is
replaced by a mock.

On the unfixed baseline B publishes a monolith whose retained operations include
A's new task but whose snapshot omits it. C joins from sequence zero and restarts
with **2 tasks instead of 3**. The v3 control passes the same interleaving.

With the fix, B makes **zero PUTs** during the refused cycle, retains the same
pending operation ID and visible local task, and succeeds after **one** normal
retry. C retains all three tasks after restart; both writers then sync, restart,
and retain exactly the same three tasks. The v3 control succeeds without that
extra refusal.

| Check                                                           | Baseline                                                          | Final result                        |
| --------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------- |
| Three-client WebDAV, v2 + v3                                    | v2 fails after C restart; v3 passes                               | 2 pass                              |
| Enabled convergence seeds, 40 per split/encryption combination  | seeds 2 and 14 fail in both v2 encryption modes: 4 fail, 152 pass | included in passing focused suite   |
| Adapter, file-provider integrations, gap/provider specs, #10119 | not claimed as a complete baseline run                            | 464 pass, 8 existing skips          |
| Sync-provider package tests and typecheck                       | not rerun on baseline                                             | 450 pass; typecheck passes          |
| `checkFile`                                                     | new E2E checked before fix                                        | all 9 changed TypeScript files pass |
| `git diff --check`                                              | —                                                                 | passes                              |

The eight existing skips are seed 32 for #10258 across four variants and the
two #10239 counter-regression cases in both formats. No new skips were added.
The focused suite includes existing `.bak` recovery, conditional-write,
encryption, replacement, split-format, pruning, and cancellation coverage.

Exact test commands, from this worktree:

```sh
# Baseline and final browser runs; separate logs retained.
E2E_BASE_URL=http://localhost:4341 E2E_REQUIRE_WEBDAV=true npm run e2e:file -- tests/sync/webdav-stale-monolith.spec.ts --retries=0 --workers=1

# Baseline with stale-monolith seeds enabled, before the production fix.
npm run test:file -- src/app/op-log/testing/integration/file-based-sync/replacement-convergence.integration.spec.ts --karma-config=.tmp/sync-S1/karma.conf.cjs --no-progress

# Final focused adapter/integration coverage.
npm run test:file -- 'src/app/op-log/testing/integration/file-based-sync/**/*.spec.ts' --include='src/app/op-log/sync-providers/file-based/**/*.spec.ts' --include=src/app/op-log/testing/integration/file-based-redelivered-pruned-op.issue-10119.integration.spec.ts --karma-config=.tmp/sync-S1/karma.conf.cjs --no-progress

npm test --prefix packages/sync-providers
npm run checkFile <each changed .ts path>
git diff --check
```

The ignored Karma config delegates to `src/karma.conf.js`, using port 9877 and
an ephemeral Chrome debugging port. Frontend: `npm run startFrontend --
--port=4341`. WebDAV: `docker compose -p sync-s1-10256 up -d webdav`.
Dependencies were installed locally with `HUSKY=0 npm ci --cache
/tmp/sync-s1-npm-cache` because the initial linked tree was incomplete; manifests
and other worktrees were not changed. No full-project lint/hook run is claimed.

Retained evidence is under ignored `.tmp/sync-S1/`: `e2e-baseline.log`,
`baseline-artifacts/` (trace/screenshots), `baseline-v2-remote.json`,
`seeds-baseline.log`, `file-provider-final.log`, `e2e-final.log`,
`sync-providers.log`, and `check-files.log`. The final two `checkFile` calls
(adapter and #10119 spec) also passed in the session tool output.

## Compatibility and remaining limits

- **Old readers:** the v2 envelope and snapshot/recent-op semantics are unchanged.
  Files produced after the successful retry contain both writers' data for those
  readers too. This is a code/format assessment, not an unmodified released-app
  browser run. `git tag --contains 2864a39c85c` confirms the affected reader code
  is in released tags including v18.15.0 and v19.1.0.
- **Old writers:** they can still publish the original inconsistent monolith.
  Updated receivers do not reconstruct operations already misdeclared as included
  by those writers. Update all writers to prevent recurrence; existing corrupted
  snapshots are not repaired by this change.
- **Revision reliability:** equality of a non-empty revision assumes it identifies
  the same downloaded contents. The observed OneDrive `eTag || ''` paths return
  an empty string when no ETag exists. The new unit cases prove that `''` cannot
  authorize a cache-less write, even after it has been recorded; the next ordinary
  download supplies the cache and the retry terminates. OneDrive has no app E2E
  harness, so its empty-token contract is tested at the adapter. Provider CAS and
  read-to-write races, including servers that ignore preconditions, are unchanged.
- **Snapshot replacements / #10258:** the new check concerns retained operations.
  Empty buffers remain under the existing snapshot-base guard. An initially
  broader revision refusal changed an empty-snapshot first-contact history and
  exposed #10258 in seed 39: an upgrade-restarted client without a recorded clock
  consumed a replacement's tail without hydrating its base. The final guard stays
  within #10256; seed 39 passes without an added skip. The diagnostic trace remains
  in `seed39-trace.log`. This does not fix #10258 or claim general convergence
  across unrecognized replacements.
- **Retry:** there is no in-call retry loop. A stable remote needs one subsequent
  normal sync in the reproduced window; continued competing writes can defer more
  cycles while leaving the local operation pending.
- **Remaining gate:** full SuperSync/WebDAV scheduled GitHub Actions were not
  dispatched for this unpublished branch. No push was authorized. Their absence
  is not a pass, and this local result does not authorize integration or release.

## Draft PR description

**Title:** `fix(sync): retry v2 uploads that read unseen remote operations`

Fixes #10256. A cache-less v2 upload could retain another writer's operations
while embedding a snapshot that lacked them, silently losing that writer's
tasks on fresh-client hydration. Defer op-bearing uploads of an unseen revision
until the normal download/apply cycle runs, preserving pending local edits.

Adds a real three-client WebDAV reproduction that fails on the recorded baseline
and passes after restart/convergence, plus a v3 control and empty-revision retry
coverage. Re-enables the existing stale-monolith seeds. Validation: 464 focused
adapter/integration tests, 450 provider tests plus typecheck, both WebDAV cases,
and per-file formatting/lint pass. Eight pre-existing unrelated cases remain
skipped; full scheduled CI is outstanding. No schema/format changes. Old writers
and already-inconsistent snapshots remain a compatibility limit.
