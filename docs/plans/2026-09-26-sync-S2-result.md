# S2 — Reorder conflicts (#10264)

Starting commit: `9177c3afed6429934632b23de936cda8c6603fde`.
Implementation commit: `14a2a74fd87b8c5e6bb3b54cf5d07801285d5155`.
Review corrections / final tested code: `50b5879c03e79b6407b3571f54d83c672c80ed1d`.
Scope: conflict resolution, its two existing reproduction specs and matching
documentation. No journal,
file-provider, schema, dependency, or agent-control changes belong to this result.

## Change and limits

The resolver now recognizes a narrow set of commuting crossings: note reorder
against content/modified edits, habit reorder against setting a day's count,
board reorder against identity-preserving editor configuration updates, and
section reorder against title edits. Notes cover both `project.noteIds`
and `note.todayOrder`. Both directions preserve the content and converge on an
order without replacing either dataset.

Applying the remote action alone is insufficient: the server still rejects the
pending concurrent clock. The existing SECTION causal-recovery mechanism now
also reissues these actions from a stable, durably represented state snapshot.
It requires the exact retained, applied remote conflict row, merges its clock,
and atomically appends the replacement while rejecting the original. Reorders
carry the current owner list; content replacements carry only the originally
changed fields, using current values. Both are local no-ops and remain safe when
hydration replays rejected originals. Existing SECTION projection is reused.

This is three production files: two small service integrations and a 240-line
pure helper. Most of the diff replaces mocked/disabled reproductions with real
store/application coverage and adds the required real-server matrix. The large
conflict service shrinks from 4,817 to 4,815 lines.

The safety gate remains for other crossings, including note pinning/moving,
competing reorders, habit configuration edits on a reordered habit, and
section context changes. This is **not** a general multi-entity conflict fix.
The original ordering-only allowlist is unchanged.

Sync remains high-risk. In particular, causal recovery depends on the retained
server conflict row and stable durable frontier; this change does not broaden
recovery when that evidence is unavailable. Recognized reorders and habit count
edits now remain pending with the existing conflict dialog in that case; an
entity replacement cannot preserve their semantics. This also blocks other
habit count recoveries whose generic fallback would lose `SimpleCounter.type`.
Unmodified older clients resolving first still run their original safety gate.
No operation type, envelope, schema version, persisted model, or released reader
is changed.

## Reproduction and validation

Issue #10264 was open and no matching open PR was found when checked. Locally,
`git tag --contains 5e754d355` confirms the safety gate shipped in v18.15.0
through v19.1.0. The current review/session snapshots supplied in `/tmp` were
used rather than the older committed review.

Before changing production code, the expanded real-server E2E failed all ten
crossings with `UnsupportedMultiEntityConflictError`/the safety dialog. This
included a remote reorder crossing a pending local content edit. The real-store
integration matrix also failed all twenty direction/timestamp permutations.
These runs used the starting commit's product code with the new reproductions.
Baseline logs:

- `/tmp/sync-s2-baseline-remote-valid.log`: first reverse-note reproduction.
- `/tmp/sync-s2-baseline-matrix.log`: 10 failed, all five scopes/both directions.
- `/tmp/sync-s2-integration-baseline.log`: 20 failed with the safety gate.

An earlier baseline launch without Typia's required compiler transform was
invalid and is excluded. Locked dependencies were installed locally and the
repository postinstall/prepare steps restored the compiler transform.

Commands (from the worktree root):

```sh
E2E_BASE_URL=http://localhost:4342 SUPERSYNC_E2E_URL=http://127.0.0.1:1912 E2E_REQUIRE_SUPERSYNC=true COMPAT_OLD_ASSETS=/tmp/sync-s2-release-v19.1.0/assets/public node_modules/.bin/playwright test --config e2e/playwright.config.ts e2e/tests/sync/supersync-reorder-conflict-wedge.spec.ts --workers=2 --retries=0 --max-failures=0

npm run test:file 'src/app/op-log/testing/integration/{reorder-conflict-wedge,unsupported-multi-entity-conflict,today-plan-conflict-resolution,round-time-conflict-convergence}.integration.spec.ts' -- --karma-config=.tmp/karma-s2.cjs

npm run test:file 'src/app/op-log/sync/{conflict-resolution*,superseded-operation-resolver.service}.spec.ts' -- --karma-config=.tmp/karma-s2.cjs

npm run checkFile e2e/tests/sync/supersync-reorder-conflict-wedge.spec.ts
npm run checkFile src/app/op-log/testing/integration/reorder-conflict-wedge.integration.spec.ts
npm run checkFile src/app/op-log/sync/reorder-conflict.util.ts
npm run checkFile src/app/op-log/sync/conflict-resolution.service.ts
npm run checkFile src/app/op-log/sync/superseded-operation-resolver.service.ts
git diff --check
npm run lint
```

The baseline E2E command omitted `COMPAT_OLD_ASSETS` because released-client
cases were added subsequently. Karma's ignored wrapper uses the normal config
with port 9878 and Chrome debugging port 9224 to avoid other tasks. Frontend
4342 is isolated. The existing test-mode SuperSync server on 1912 was reused
without restarting Docker: image `pr10252-review-supersync`, image ID
`sha256:30759be1602d5fb722edd5a2d37705a60e4a71567cca6806aa39cedd1834bd55`.

| Check                                        | Outcome                                                  | Evidence                                          |
| -------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------- |
| Full focused E2E at `14a2a74fd8`             | 12 passed, no retries (5.7 minutes)                      | `/tmp/sync-s2-e2e-committed.log`                  |
| Released-client cases alone                  | 2 passed, no retries                                     | `/tmp/sync-s2-released-verified.log`              |
| Focused integration suites                   | 42 passed (23 reorder cases plus 19 related regressions) | `/tmp/sync-s2-integration-final.log`              |
| Existing conflict/superseded resolver suites | 360 passed                                               | `/tmp/sync-s2-existing-resolvers.log`             |
| All five `checkFile` commands                | Passed                                                   | `/tmp/sync-s2-check-final.log` and command output |
| Full `npm run lint`                          | Passed, including lint-rule/tool/icon tests              | `/tmp/sync-s2-lint.log`                           |
| `git diff --check`                           | Passed                                                   | Command output                                    |

The unit/integration and individual released-client runs verified the source
tree committed as `14a2a74fd8`; the combined E2E and full lint ran after that
commit. The following report commit changes documentation only.

The E2E refuses the conflict dialog instead of choosing Keep remote. It checks
all seeded entity fields, untouched siblings, unique membership, the other note
ordering scope, and absence of new REPAIR/SYNC_IMPORT/BACKUP_IMPORT operations.
Both note scopes/directions cover restart of both clients and a fresh client.
The integration matrix uses actual reducers, the actual bulk applier and
IndexedDB; it exercises both timestamp winners, both directions, rejected-row
hydration and accepted-history replay. Three negative cases retain pending work
and unchanged state when the safety gate fires.

## Adversarial review corrections

The first independent subagent review found that interruption followed by normal
log compaction can remove the applied remote conflict row while keeping the local
reorder pending. Snapshot/cursor filtering then skips that row on re-download.
The generic entity LWW fallback retired the reorder without representing its
optimistic list write, leaving clients divergent. Five new real-server E2Es
failed before the correction, one for each supported ordering scope:
`/tmp/sync-s2-compaction-baseline-matrix.log`. The corresponding real-store
matrix failed five tests: `/tmp/sync-s2-compaction-integration-baseline.log`.

The requested second subagent review found the reverse habit case. With a pending
count edit and a compacted remote reorder, fallback replacement loses the
counter's required `type` during action conversion. The real-server reproduction
showed a `StopWatch` becoming `ClickCounter` after the receiver's default-field
repair: `/tmp/sync-s2-compaction-reverse-baseline-stopwatch.log`. The real-store
pending-operation regression also failed:
`/tmp/sync-s2-compaction-reverse-integration-baseline.log`.

Both corrections use the existing `UnsupportedMultiEntityConflictError` before
the append/rejection transaction. The caller already rolls back resolution
attempts on that error. No compaction, download, generic LWW, model, schema or
retry-budget code changes were needed. The new E2Es interrupt an actual upload,
age only the applied row's retention timestamp, trigger the production compactor
through 500 ordinary task edits, restart, and retry four times. They cancel the
dialog and require pending work and content to survive. The stopwatch case also
checks the receiving type, so automatic default-field repair cannot mask loss.
This preserves work when evidence is gone; automatic convergence in that case
is explicitly outside the delivered claim.

Additional validation commands for the corrections:

```sh
E2E_BASE_URL=http://localhost:4342 SUPERSYNC_E2E_URL=http://127.0.0.1:1912 E2E_REQUIRE_SUPERSYNC=true node_modules/.bin/playwright test --config e2e/playwright.config.ts e2e/tests/sync/supersync-reorder-conflict-wedge.spec.ts --workers=2 --retries=0 --grep 'keeps the reorder pending'

E2E_BASE_URL=http://localhost:4342 SUPERSYNC_E2E_URL=http://127.0.0.1:1912 E2E_REQUIRE_SUPERSYNC=true node_modules/.bin/playwright test --config e2e/playwright.config.ts e2e/tests/sync/supersync-reorder-conflict-wedge.spec.ts --workers=1 --retries=0 --grep 'keeps the content pending'

CHROME_BIN=/home/johannes/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome npm run test:file src/app/op-log/testing/integration/reorder-conflict-wedge.integration.spec.ts -- --karma-config=.tmp/karma-adversarial.cjs

CHROME_BIN=/home/johannes/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome npm run test:file 'src/app/op-log/testing/integration/{reorder-conflict-wedge,unsupported-multi-entity-conflict,today-plan-conflict-resolution,round-time-conflict-convergence}.integration.spec.ts' -- --karma-config=.tmp/karma-adversarial.cjs

CHROME_BIN=/home/johannes/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome npm run test:file 'src/app/op-log/sync/{conflict-resolution*,superseded-operation-resolver.service,rejected-ops-handler.service}.spec.ts' -- --karma-config=.tmp/karma-adversarial.cjs
```

The final Karma wrapper loads `src/karma.conf.js`, uses port 9890, and launches
the explicit Chrome binary with `--headless --no-sandbox --disable-dev-shm-usage`
without a fixed debugging port. Baseline repros preceded their corresponding
production guards. The five reorder E2Es then passed
(`/tmp/sync-s2-compaction-fixed.log`). Final focused integration tests passed
48/48 (`/tmp/sync-s2-final-integration.log`), including 29 reorder cases. Existing
resolver/rejection-handler tests passed 402/402
(`/tmp/sync-s2-final-resolvers.log`). The three modified TypeScript file checks
and final full lint also passed (`/tmp/sync-s2-final-lint.log`).

Before the subsequent Claude corrections, the full E2E command above was rerun
with the compaction corrections and released assets:
18/18 passed without retries in 9.7 minutes (`/tmp/sync-s2-final-e2e.log`). This
includes the original ten crossings, six compaction regressions, and both
unmodified released-client histories. The verified source-file digests are in
`/tmp/sync-s2-final-files.sha256`. Those board cases still used title-only fixtures;
they were insufficient evidence for the actual board editor.

The requested regular Claude CLI review completed with `claude-opus-5-5`
(`/tmp/sync-s2-claude-review.json`, read-only tools, no permission denials). It
identified two further actionable gaps:

- The board editor emits its full `{ id, title, cols, panels }` configuration.
  The original title-only predicate did not admit that real UI action. Both
  directions failed through the real editor before correction:
  `/tmp/sync-s2-board-ui-baseline-form.log`. Earlier runs that timed out locating
  form fields are excluded. Identity-preserving configuration writes now commute
  with board order; the replacement still projects only the original fields.
- A reissued habit order included disabled habits absent from the original drag.
  A real third-client UI enable action on such a habit then hit a false conflict:
  `/tmp/sync-s2-habit-footprint-baseline.log`. Recovery now takes the current
  subsequence of the original IDs. The reducer preserves all unlisted slots,
  keeping replay a local no-op without expanding the conflict footprint.

The real-store matrix failed five cases before these corrections
(`/tmp/sync-s2-claude-findings-integration-baseline.log`). Afterward, 49 focused
integration tests passed (`/tmp/sync-s2-reviewed-final-integration.log`). The
independent subagent checked both corrections against their reducers and found
no additional defect. It did not launch tests; panel-edit permutations beyond
the exercised board form were assessed from source.

Claude's remaining observations are limits, not broadened implementation scope:
missing, ambiguous or non-concurrent causal proof also triggers the safety stop;
this is not specific to compaction. Cancelled retries can repeat the existing
force download from sequence zero. Legacy SECTION diagnostics and the existing
multi-entity error name are reused, including for single-counter edits. Generic
retry/transport/diagnostic redesign remains outside S2.

The existing cap for successive genuine concurrent rejections can still mark
operations rejected; it is unchanged and was not newly reproduced here. This
diff does not claim to solve perpetual competing edits. The four cancelled
safety-error retries tested here preserve pending work without consuming that cap.

Final verification of the code committed as `50b5879c03`:

| Check                                      | Result                                | Evidence                                                  |
| ------------------------------------------ | ------------------------------------- | --------------------------------------------------------- |
| Full focused E2E, same command above       | 19 passed, no retries, 9.3 minutes    | `/tmp/sync-s2-reviewed-final-e2e.log`                     |
| Focused integration suites                 | 49 passed, including 30 reorder cases | `/tmp/sync-s2-reviewed-final-integration.log`             |
| Existing resolver/rejection-handler suites | 402 passed                            | `/tmp/sync-s2-reviewed-final-resolvers.log`               |
| Every modified TypeScript `checkFile`      | Passed                                | Command output                                            |
| Full lint and `git diff --check`           | Passed                                | `/tmp/sync-s2-reviewed-final-lint.log` and command output |

These checks ran before the code commit; afterward, all five source/spec digests
were verified unchanged against `/tmp/sync-s2-reviewed-final-files.sha256`.
The following report commit changes documentation only. Final E2E coverage uses
the real board editor, includes the third-client disabled-habit case, and reruns
both released-client histories after the final production corrections.

## Released-client evidence

Unmodified `assets/public` from the official
[v19.1.0 APK](https://github.com/super-productivity/super-productivity/releases/download/v19.1.0/app-play-release.apk)
is served through `e2e/utils/released-client-assets.ts` on port 4249. Tag commit:
`42ded9f31a132bf92633b0c78ad4ebf1d87c0f71`. APK SHA-256:
`127af90995763d88a502eae428af9dc395dcdf17d3f8f1be498f56dfa4aab9dc`.
The APK provenance file reports `NO_SUPPORTED_VCS_FOUND`; the release URL/tag
and exact downloaded artifact digest are recorded rather than claiming embedded
build provenance. Requests assert `appVersion=19.1.0`.

The released producer edits through its editor or performs an actual CDK drag.
It uploads first; the current client resolves; the released client consumes and
restarts. The two emitted histories are an accepted note reorder (`NO`) and an
accepted note content update (`NU`). No test store or modified bundle is injected
into the released client. The drag waits for its drop animation and durable
operation, then verifies upload before letting the new client sync.

## Remaining gates

Full SuperSync/WebDAV scheduled GitHub Actions suites remain an explicit
integration/release gate, not a claimed pass. Earlier validation kept the branch
unpublished; the maintainer subsequently authorized pushing after final review.
Publication and scheduled workflow dispatch follow the completion commit.
No merge or public review posting was performed. No overlap outside S2 production
ownership was required.

## Completion review

A fresh local review and an independent GPT-6 Astra subagent review found no
additional concrete production defect. The independent review checked the real
reducers and editor payloads, stable-state projection, exact retained-row proof,
atomic replacement/rejection, missing-history safety stops and released payload
compatibility. It was read-only and did not run additional tests.

The main E2E matrix requires content preservation, equal ordering and unchanged
membership; the integration matrix also requires the precise projected order.
This satisfies the maintainer's acceptance of either converged order. Released
client execution covers notes; compatibility of the other families was reviewed
from source.

Completion changes update the active replay contract and sync reference wiki to
describe the delivered behavior and safety limits. Product code and both specs
remain byte-identical to `50b5879c03`, verified against the recorded digests.

Fresh validation: all 19 real-server E2Es passed without retries in 9.3 minutes,
including both unmodified released-client histories
(`/tmp/sync-s2-completion-e2e.log`). Also passed: 49 focused integration tests,
402 resolver/rejection-handler tests and all five TypeScript file checks. Logs are
`/tmp/sync-s2-completion-integration.log`,
`/tmp/sync-s2-completion-resolvers.log` and
`/tmp/sync-s2-completion-checkfiles.log`. Documentation links, formatting of the
contract/wiki edits and `git diff --check` passed. The optional local wiki
Markdown linter is not installed; its CI check remains applicable.

## PR #10275 reconciliation with master

Reconciled the final S2 changes with `master` at
`1142bc9e0aad12e0da162d4366c3263845670a1c`. The original pending reproduction
files and architecture review already exist on master, so the resulting diff
contains only the S2 implementation, enabled reproductions and its documentation.

Preserved master's broader `isCommutingTimeDeltaCrossing` handling alongside the
reorder exemption, and its live `restoreTask` recovery alongside the reorder
projection imports. No new action, schema or persisted-model changes were needed.
The helper and both reorder specs remain identical to the original PR head
`7d88866e91563a979149df7cade257d61ba4fd18`.

Both project-note direction tests were run against unchanged master resolvers
and failed with the expected conflict dialog. The reconciled resolvers were then
restored; baseline evidence is `/tmp/fix-pr-10275-baseline.log`. An earlier test
setup failure before browser execution is excluded.

Fresh verification passed 116 focused integration tests (including archive,
restore, round-time and unsupported multi-entity crossings), 418 resolver and
rejection-handler tests, all five TypeScript file checks, full repository lint,
documentation links and formatting. All 24 real-server E2Es passed without retries
in 8.9 minutes: the original 19 S2 cases plus two archive-restore cases, two
timer-delta/rename crossings and the existing section-convergence scenario.
Both unmodified v19.1.0 note histories passed. Final logs are
`/tmp/fix-pr-10275-e2e.log`, `/tmp/fix-pr-10275-resolvers.log` and
`/tmp/fix-pr-10275-lint.log`.

The isolated Karma configuration uses port 9902; the frontend uses port 4355 and
the same test-mode SuperSync server on 1912 recorded above.

The original PR head's full [scheduled workflow](https://github.com/super-productivity/super-productivity/actions/runs/36240302848)
completed successfully, including all six SuperSync shards and WebDAV. A fresh
scheduled run is required for the reconciled head.

## Draft PR description

When one device reorders notes, habits, boards or sections while another makes
one of the supported content edits, sync currently stops at the multi-entity
safety gate. Preserve both intents and converge ordering by applying the
commuting remote write and reissuing the rejected local action through the
existing causal-recovery transaction. Unsupported crossings retain the gate.
If compaction has removed the evidence needed to recover a reorder or habit
count edit safely, retain it as pending and surface the existing conflict dialog
instead of silently discarding ordering or corrupting the habit type.

Validation: 19 real-server E2Es, 49 integration tests, 402 resolver/rejection-handler
tests, all modified TypeScript file checks, and full repository lint passed.
Coverage includes baseline-failing direction/timestamp and compaction cases,
four cancelled recovery retries, restart/fresh-client replay, and both
resolution histories consumed by unmodified v19.1.0. Old clients that
resolve first retain their existing behavior; full scheduled suites remain
pending on the intended integration branch.
