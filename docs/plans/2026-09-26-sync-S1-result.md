# S1 result: stale v2 snapshots (#10256)

**Status:** implemented and verified locally; prepared for draft PR review.
Full scheduled CI remains outstanding; no integration or format rollout.

- Starting SHA: `9177c3afed6429934632b23de936cda8c6603fde`.
- Validated final implementation SHA: `7cd8d48c9a79bd70b2b612e0a5f2be13db07b655`.
  Final checks ran against these contents before committing; the subsequent
  report commit changes documentation only. Initial implementation:
  `b917fd9610d09b7ecb2958f2ac68652652c5ea73`. The provider-package result is retained
  from that initial run; its package source remains unchanged.
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
`UploadRevToMatchMismatchAPIError` while a downloaded baseline is still pending
application, or when it has neither an applied download cache nor a matching,
non-empty, already-applied revision. It refuses before either the backup or
primary write and does not cache or commit an upload-side read.
The ordinary next sync downloads first, applies the peer's operations, and
uploads the original pending work with a consistent snapshot. No new retry
loop, snapshot metadata, wire fields, persisted fields, or schema version.
Retry is sufficient here; adding snapshot metadata would also require handling
old writers that omit it and old readers that ignore it.

Only `file-based-sync-adapter.service.ts` changes production behavior. The larger
test diff comprises the three-client browser regressions, two revision cases,
re-enabled seeds 2/14, and fixtures that formerly uploaded unseen operations
directly. Those fixtures now download and explicitly commit the apply boundary
before uploading, or assert refusal and retry. The #10119 cursor test retains
v3's original path and checks v2's refusal before its cursor advances.
No mock applier establishes convergence; the browser test provides that evidence.

The service stays at its respective baseline size: 3,292 physical lines in the
original task and 3,285 on the newer PR base. No overlap with
S2's conflict-resolution implementation, package manifests, v3 defaults,
journal, SQLite, or agent-control files. The pre-existing injected `AGENTS.md`
working-tree change is excluded from all commits.

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

### Independent review follow-up

The requested subagent review found one P1 hole in the initial fix: cache
presence alone does not prove application. During first sync against an empty
folder, B's upload can wait while A seeds the folder. B's pre-upload migration
probe then caches A's operations without applying them. The initial guard
accepted that cache and could still publish B's stale snapshot.

The added real-WebDAV variant reproduced this on `d007f430e9`: C restarted with
**1 task instead of 2**, while v3 passed. The correction reuses the existing
`_pendingExpectedSyncVersions` marker to refuse uploads until the downloaded
baseline is committed through `setLastServerSeq`. No new tracking state.
The final independent review found no remaining concrete defect and judged
this correction minimal.

The first-sync test records both pending IDs after setup: the original task
and the config operation that setup captures. One normal retry reaches the
existing first-contact conflict dialog. Cancelling must leave both pending IDs
and B's local task intact through restart, with zero PUTs across refusal and
cancellation. C must still hydrate only A's unchanged remote task after restart.
This preserves the existing user choice; automatic convergence of independent
first-contact datasets is not promised. Its v3 control retains the original
convergence expectation. Existing adapter-only fixtures now explicitly commit
the apply boundary; the shared harness was not changed to auto-acknowledge downloads.

The `.bak` healing fixture now contains a retained operation and commits its
download. A deliberate removal of the cache exemption produced **2 failing
tests** (backup healing and the empty-revision retry), with 147 passing. The
source was automatically restored and its SHA-256 matched the saved copy.
The restored adapter suite passed all 149 tests.

Confidence is high for the two reproduced windows and the narrow correction:
one adapter guard uses existing apply/commit, cache, revision, and retry behavior.
The compatibility limits and outstanding CI gate below bound that assessment.

### Requested Claude review

The regular Claude CLI independently reviewed `9177c3afed..1ac23b5ebb` with
read/search tools only. It found no confirmed actionable defect and assessed
minimality and the scoped WebDAV correction with high confidence. I rechecked
the guard, retry handler, and provider revision paths against the source. Its
one new question concerns OneDrive's different revision sources, detailed below;
confidence for that provider remains medium. No production or test changes
resulted from this pass, so the recorded implementation SHA and test results
remain applicable. Claude did not run tests; no authenticated OneDrive check
or full scheduled CI run is claimed.

### PR branch validation

Prepared `fix/sync-stale-v2-snapshots-10256` from current `master`,
`b9c3c4f6473f2a4a03a150a30d3c05403b35db8d`. Only the five S1 commits were copied;
`git range-diff` confirms unchanged patches. The PR excludes the inherited
architecture-review material and S2 reproductions. The original task branch
and other tasks' worktrees remain untouched.

Tested PR SHA: `fd7b7c9f88950b1f7c38a1c7e7857b700470fdc2`. The same focused
adapter/integration command below passed **469 tests with 8 existing skips**;
the extra cases come from the newer base. All ten `checkFile` commands and
`git diff --check origin/master...HEAD` passed. The ignored Karma config used
port 9891 because 9877 was occupied. The provider package is unchanged from the
recorded 450-test/typecheck run.

At the user's instruction, the local WebDAV rerun was stopped and further E2E
validation is assigned to CI. That interrupted run (one interrupted case,
three not run) is not a pass. The previous four passing WebDAV cases remain
evidence on the original tested implementation; the full scheduled suites must
validate the PR branch. Only the S1 frontend and S1-owned WebDAV container were
stopped. PR preparation evidence is in `.tmp/sync-S1/pr-{focused,check-files,webdav}.log`
inside the isolated PR worktree. Subsequent report changes are documentation only.

The following table records the original task-branch validation; the PR-base
rerun results are above.

| Check                                                           | Baseline                                                          | Final result                         |
| --------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------ |
| WebDAV cache expiry, v2 + v3                                    | v2 fails after C restart; v3 passes                               | 2 pass                               |
| WebDAV migration probe, v2 + v3                                 | initial fix still loses A on C; v3 passes                         | 2 pass                               |
| Enabled convergence seeds, 40 per split/encryption combination  | seeds 2 and 14 fail in both v2 encryption modes: 4 fail, 152 pass | included in passing focused suite    |
| Adapter, file-provider integrations, gap/provider specs, #10119 | not claimed as a complete baseline run                            | 464 pass, 8 existing skips           |
| Sync-provider package tests and typecheck                       | not rerun on baseline                                             | 450 pass; typecheck passes           |
| `checkFile`                                                     | new E2E checked before fix                                        | all 10 changed TypeScript files pass |
| `git diff --check`                                              | —                                                                 | passes                               |

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
npm run checkFile e2e/tests/sync/webdav-stale-monolith.spec.ts
npm run checkFile src/app/op-log/sync-providers/file-based/file-based-sync-adapter.service.ts
npm run checkFile src/app/op-log/sync-providers/file-based/file-based-sync-adapter.service.spec.ts
npm run checkFile src/app/op-log/testing/integration/file-based-redelivered-pruned-op.issue-10119.integration.spec.ts
npm run checkFile src/app/op-log/testing/integration/file-based-sync/basic-sync-flows.integration.spec.ts
npm run checkFile src/app/op-log/testing/integration/file-based-sync/conflict-resolution.integration.spec.ts
npm run checkFile src/app/op-log/testing/integration/file-based-sync/edge-cases.integration.spec.ts
npm run checkFile src/app/op-log/testing/integration/file-based-sync/multi-client-convergence.integration.spec.ts
npm run checkFile src/app/op-log/testing/integration/file-based-sync/replacement-convergence.integration.spec.ts
npm run checkFile src/app/op-log/testing/integration/file-based-sync/use-local-tail-mask.integration.spec.ts
git diff --check

# Review reproduction against the initially committed fix.
E2E_BASE_URL=http://localhost:4341 E2E_REQUIRE_WEBDAV=true npm run e2e:file -- tests/sync/webdav-stale-monolith.spec.ts --grep 'migration probe' --retries=0 --workers=1

# Deliberate cache-exemption mutation, with automatic restoration.
bash .tmp/sync-S1/check-cache-exemption.sh

# Positive adapter rerun after restoration.
npm run test:file -- src/app/op-log/sync-providers/file-based/file-based-sync-adapter.service.spec.ts --karma-config=.tmp/sync-S1/karma.conf.cjs --no-progress
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
`sync-providers.log`, and `check-files.log`.
Review follow-up: `e2e-review-baseline.log`, `review-baseline-artifacts/`,
`file-provider-review-final.log`, `e2e-review-final.log`,
`backup-cache-mutation.log`, `adapter-review-restored.log`, and
`check-review-{files,adapter,e2e}.log`. Intermediate failures are retained too:
the shared WebDAV server stopped during one run, restarting the S1 container
needed recreation to restore its port mapping, and first-contact fixture
assertions were corrected for the setup config op and existing conflict policy.
Only S1's own container was restarted/recreated; no shared server was stopped.
The Claude review prompt, complete output and final review are retained as
`claude-review-prompt.txt`, `claude-review-online.jsonl`, and
`claude-review-result.md` in the same ignored evidence directory.

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
  authorize a cache-less write, even after it has been recorded. A subsequent
  committed download allows the adapter to attempt upload. The test now creates
  the adapter with the correct provider identity and returns a non-empty upload
  ETag, as real OneDrive requires. OneDrive has no app E2E harness: this verifies
  adapter behavior, not OneDrive convergence when reads continually omit ETags.
  OneDrive then uses `conflictBehavior=fail`, which can refuse replacing an
  existing file. Provider CAS and read-to-write races, including servers that
  ignore preconditions, are unchanged.
- **OneDrive revision-source equality (unverified):** `downloadFile` prefers the
  content response's ETag, while `getFileRev` and `uploadFile` return the metadata
  `eTag`. If those strings differ for the same file version, the cheap unchanged
  check could repeatedly skip downloading, followed by the new guard refusing
  the upload-side read. No captured same-version mismatch was found in the repo.
  Microsoft's [download API documentation](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0)
  describes the redirect to a content URL, and the
  [driveItem documentation](https://learn.microsoft.com/en-us/graph/api/resources/driveitem?view=graph-rest-1.0)
  distinguishes content `cTag` from item `eTag`; neither establishes equality of
  that response header and the metadata field. This remains a conditional risk,
  not an observed provider failure. Before claiming OneDrive retry termination,
  compare those tokens across two consecutive edit/sync cycles on the real
  provider in web, Electron and Android. The adapter fake does not prove this.
- **Snapshot replacements / #10258:** the new check concerns retained operations.
  Empty buffers remain under the existing snapshot-base guard. An initially
  broader revision refusal changed an empty-snapshot first-contact history and
  exposed #10258 in seed 39: an upgrade-restarted client without a recorded clock
  consumed a replacement's tail without hydrating its base. The final guard stays
  within #10256; seed 39 passes without an added skip. The diagnostic trace remains
  in `seed39-trace.log`. This does not fix #10258 or claim general convergence
  across unrecognized replacements.
- **Retry:** there is no in-call retry loop. A stable remote needs one subsequent
  normal sync in the reproduced shared-history window. Independent first-contact
  data reaches the existing conflict decision instead of silently overwriting.
  Continued competing writes can defer more cycles while leaving local work pending.
- **Remaining gate:** full SuperSync/WebDAV scheduled GitHub Actions were not
  dispatched for this unpublished branch. No push was authorized. Their absence
  is not a pass, and this local result does not authorize integration or release.

## Draft PR description

**Title:** `fix(sync): defer v2 snapshots until remote data is applied`

Fixes #10256. A v2 upload could retain another writer's operations while embedding
a snapshot that lacked them, silently losing tasks on fresh-client hydration.
This occurs after cache expiry or when a migration probe fills an unapplied cache.
Defer the upload until the normal download/apply cycle runs, preserving pending
local edits and the existing first-contact conflict decision.

Adds real three-client WebDAV regressions with v3 controls, empty-revision
adapter coverage, and a strengthened backup-healing test. Re-enables the existing
stale-monolith seeds. Validation: 469 focused adapter/integration tests on the PR
branch and per-file formatting/lint pass. Earlier evidence covers all four
WebDAV cases and 450 provider tests plus typecheck; the provider package is
unchanged. Eight pre-existing unrelated cases remain skipped. Further E2E runs
are assigned to CI; the full scheduled gate is outstanding.
No schema/format changes. Old writers and already-inconsistent snapshots remain
a compatibility limit. OneDrive revision-source equality remains unverified.
