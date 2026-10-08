# Issue-provider reorder/settings sync-stop reproduction

**Follow-up:** This branch now includes provider-independent reorder/settings
recovery and its regression suite. The report below records the original
reproduction-only assignment and failing baseline; its original scope restrictions
are historical.
See [fix validation](#fix-validation) for the initial GitLab fix and
[provider-independent recovery](#provider-independent-recovery) for its follow-up.

## Original reproduction

Evidence deliverable only; no production fix. Rechecked on published master
`db3549b114ed3954f70add9cf8388af676cb2bfb` (2026-09-26), after S5 retirement
and #10288. The empty task branch was refreshed from `9177c3afed` without a
merge, preserving its injected guidance. The earlier audit is commit
`78b8a580f8f8aa9491bf77e7bac6338c3f9e3777`,
`docs/plans/2026-09-26-sync-remaining-conflict-actions-audit.md`, whose source
baseline was `f84259fcaa`.

## Finding

The source-backed crossing is reachable in two real browser clients: dragging
configured issue-provider tabs on one device while disabling one of those
providers in the other device's edit dialog reaches
`UnsupportedMultiEntityConflictError`. Manual sync opens **Sync: Conflicting
Data**, offering whole-dataset replacement or Cancel. This is a sync
availability failure. No silent loss was observed: Cancel and restart retain
pending local work. No matching user incident was established by this task.

The regression's desired outcome remains successful sync, preserved settings,
identity, membership and independent work, with one converged unique provider
order and no full-state replacement. The reproduction intentionally asserts
that outcome and is **red/reproduction-only, not independently integration-ready**.
Only this report belongs in the commit; the spec stays outside the normal suite.

## Current source chain

All references describe `db3549b114`, not the older audit checkout.

- [Panel drag](../../src/app/features/issue-panel/issue-panel.component.ts)
  `drop()` uses `issueProvidersMapped()` and dispatches
  `[IssueProvider/API] Sort IssueProviders First`. The
  [template](../../src/app/features/issue-panel/issue-panel.component.html)
  connects actual CDK tab dragging to this handler. The
  [selector](../../src/app/features/issue/store/issue-provider.selectors.ts)
  includes disabled providers after enabled providers; they are not omitted
  from the displayed order's declared IDs.
- [Action metadata](../../src/app/features/issue/store/issue-provider.actions.ts):
  order is `ISSUE_PROVIDER`, `MOV`, `entityIds: ids`, `isBulk: true`.
  Update is `ISSUE_PROVIDER`, `UPD`, one `issueProvider.id`.
  [Capture](../../src/app/op-log/capture/operation-log.effects.ts) uses the
  first order ID as `entityId`, and wraps the original payload with
  `entityChanges: []`; a singular update also receives a one-element
  `entityIds` array. Compact action codes are `IS` and `IU`.
- [Edit dialog](../../src/app/features/issue/dialog-edit-issue-provider/dialog-edit-issue-provider.component.ts):
  the model starts with the configured provider. `changeEnabled()` creates a
  model with the new flag and calls `submit(true)` immediately. `submit()`
  dispatches `updateIssueProvider({ issueProvider: { id, changes: this.model } })`.
  Closing with Cancel after toggling prevents an extra Save operation; it does
  not undo the already-submitted toggle.
- [Provider reducer](../../src/app/features/issue/store/issue-provider.reducer.ts):
  order writes `ids: [...action.ids, ...unlistedExistingIds]`; update calls
  `adapter.updateOne`. These actual shapes preserve provider identity in this
  reproduction. Arbitrary updates need not: an `id` change can alter membership.
  The [shared provider reducer](../../src/app/root-store/meta/task-shared-meta-reducers/issue-provider-shared.reducer.ts)
  handles deletion/unlinking, not this reorder/update crossing.
- [Conflict detection and preflight](../../src/app/op-log/sync/conflict-resolution.service.ts):
  `_checkEntityForConflict()` checks exact commuting predicates for concurrent
  pending operations. `reorder-conflict.util.ts` admits notes, counters, boards
  and sections, not issue providers. `_resolveConflictsWithLWW()` invokes
  `_assertMultiEntityPlansAreSafe()` before reconciliation, disjoint merging,
  rejection or application. The plural provider order matches neither the local
  nor remote admission paths, so preflight throws for either direction.
  [Multi-entity detection](../../src/app/op-log/util/get-op-entity-ids.util.ts)
  counts the unique union of declared IDs, not reducer writes or `isBulk`.
- [Sync wrapper](../../src/app/imex/sync/sync-wrapper.service.ts) handles this
  exact error, sets ERROR status, and opens the dataset conflict dialog for a
  manual sync. An automatic sync instead offers an error snack/Resolve action;
  only the manual path was exercised here.

## Fixture and captured shape

Two independent Chromium contexts use one new test-mode SuperSync account per
case, real encrypted transport, PostgreSQL, app capture, IndexedDB, reducers
and resolver. No sync/resolver behavior is mocked. The task owns app port 4372,
SuperSync port 1942 and Compose project `issue-provider-repro-8d7982`; the
database has no published host port. No other task's service is used.

Three valid synthetic GitLab providers are seeded through the existing E2E
store-dispatch pattern: two enabled providers and an unedited disabled witness.
The only provider origin is `https://issues.example.invalid/`; the spec supplies
controlled HTTP 200 `[]` responses. Tokens and all other values are synthetic;
there are no external provider accounts. Automatic issue polling is disabled.
The normal panel and editor still execute.

Starting stored order is `[a, b, witness]`. A real mouse drag produces
`[b, a, witness]`. The real Enabled switch on provider `a` produces one full
update. Both action codes, entity type, IDs, payloads, unequal timestamps and
concurrent vector clocks are asserted before attempting the crossing. Crucially,
the edited provider `a` is a **non-primary** ID of the order (`entityId` is `b`).

The observed update is exactly the pre-edit provider with `isEnabled: false`.
Its `changes` has all 18 keys below, not a fabricated one-field delta:

```text
id, issueProviderKey, isEnabled, isAutoPoll, isAutoAddToBacklog,
isIntegratedAddTaskBar, defaultProjectId, pinnedSearch, pollingMode,
defaultTagIds, defaultNote, project, gitlabBaseUrl, token, filterUsername,
scope, filter, isEnableTimeTracking
```

Both operations use schema 4 and the payload envelope
`{ actionPayload: ..., entityChanges: [] }`. The update carries
`issueProvider: { id: a, changes: <full model> }`; the order carries only `ids`.
The full persisted compact rows, including clocks, timestamps and statuses,
are saved in each case's `evidence.json`, with synthetic data only.

A common baseline task, one independently created task per device, and
independent configuration edits (`misc.isDisableAnimations` on A,
`evaluation.isHideEvaluationSheet` on B) act as preservation witnesses.
After common-baseline sync, auto-sync is blocked using the established E2E flag.
Client B uploads first; client A resolves while its own operations are pending.
The strict helper requires a successful real download and fails on a safety
dialog/error; it never calls `syncAndWait()` or selects Keep local/remote during
the crossing. The existing setup helper is used only before concurrent edits.

## Execution evidence

The recorded bounded run executed all three cases, with zero skips/retries:
**3 expected failures at the desired success assertion**, each receiving
`conflict-dialog` instead of `in-sync`. None failed on setup, action capture,
payload/clock checks, or preservation assertions.

The final handoff rerun repeated all three cases with the same result and zero
skips/retries after tightening the success-path check to require the exact
reordered stored IDs. Pending operations and state preservation were checked
again, including Cancel and restart. Formatting/lint and strict TypeScript
checks passed again. Successful convergence assertions remain unexecuted on
this failing baseline. The rerun evidence is indexed in
`resumed-evidence-summary.json`; `matrix-resumed-verified.log` records the run.
The earlier sandbox-blocked Chromium attempt is excluded from this evidence.

| Pending on A / incoming from B | Newer timestamp | Order / edit timestamps (ms)      | Diagnostic side | Artifact directory token |
| ------------------------------ | --------------- | --------------------------------- | --------------- | ------------------------ |
| Order / edit                   | Remote edit     | `1790451258649` / `1790451259548` | `local`         | `37981`                  |
| Edit / order                   | Remote order    | `1790451314661` / `1790451313336` | `remote`        | `460fd`                  |
| Order / edit                   | Local order     | `1790451372253` / `1790451371369` | `local`         | `06278`                  |

Each diagnostic is exactly:

```text
UnsupportedMultiEntityConflictError: SYNC_MULTI_ENTITY_UNSUPPORTED side=<local|remote> actionType=[IssueProvider/API] Sort IssueProviders First entityCount=3
```

The stack enters `_assertMultiEntityPlansAreSafe()` from
`_resolveConflictsWithLWW()`. A's three pending rows (task, config, provider
operation) are identical as parsed JSON objects before sync, after the
stop, after Cancel, and after restart. Both devices' provider/task/config
snapshots remain unchanged at the stop; A's also remains unchanged after
restart. B has zero pending rows after its successful upload. The sets of
REPAIR/SYNC_IMPORT/BACKUP_IMPORT IDs do not change. The unchanged snapshots
mean each device retains its own edits; convergence has **not** occurred.

For example, the first case's persisted order is
`01a0df36-1529-7528-9777-842d2960957d`, clock `{B_hvEFc4: 8}`;
its update is `01a0df36-18aa-7a04-bfcd-91e2466a16aa`, clock
`{B_hvEFc4: 5, B_qVgGSO: 4}`. The other cases' exact rows and the checked
preservation summary are retained in the artifacts.

Environment: app package version 19.1.0; host Node 22.18.0; Playwright 1.61.1;
Chromium 149.0.7827.55; PostgreSQL 15.15; server Node 22.23.2. The task-built SuperSync image
`issue-provider-repro:db3549b114` is
`sha256:38147255fae49931e6abb2ed87561756a6eda306ebeeb5961e4550e0b2057747`.
Its build used the baseline Dockerfile and was fully cached; the frontend was
compiled from this worktree's baseline source, including its local package paths.

Validation actually run:

- Task-isolated Playwright matrix, command below; exit 1 solely for the three
  desired regression assertions. An earlier focused run also reproduced the
  local-order/remote-newer stop. Earlier attempts with duplicate trace setup,
  a wrong snapshot slice, or UI timing failures are excluded from the evidence.
- `npm run checkFile e2e/tests/sync/supersync-issue-provider-reorder-conflict.spec.ts`:
  passed after fixing fixture lint issues. The sandbox initially blocked child
  processes; the required check was rerun with permission.
- `node_modules/.bin/tsc --noEmit --target ESNext --module ESNext --moduleResolution node --esModuleInterop --skipLibCheck --strict --baseUrl . --types @playwright/test e2e/tests/sync/supersync-issue-provider-reorder-conflict.spec.ts`:
  passed. The first invocation omitted `--baseUrl .` and could not resolve the
  repository's `src/` import; that invocation is not counted as a pass.
- Report Prettier check, local source-link validation, and `git diff --check`:
  passed. Tracked product source remains byte-identical to the baseline.

The dev checkout logged missing bundled-plugin asset 404s; no runtime page error
caused a final failure. Both baseline sync and intended UI actions completed.
No full suites, GitHub Actions dispatch, WebDAV, unit/integration resolver tests,
released-client execution or successful fresh-client replay were run. There is
no fix to validate. `git tag --contains db3549b114ed3954f70add9cf8388af676cb2bfb`
returned no tags locally; this does not downgrade a published-master failure or
establish that the provider crossing is absent from released clients.

## Rerun and artifact locations

Artifacts are local to this task, under `/tmp/issue-provider-repro-20260926/`:

- `supersync-issue-provider-reorder-conflict.spec.ts` and matching `.patch`:
  runnable red reproduction; restore only to its original `e2e/tests/sync/` path.
- `matrix-final.spec.ts`: exact spec used for the original recorded matrix;
  the handoff spec strengthens only its later success-path order assertion.
- `playwright.config.cjs`, `compose.yaml`: isolated runner and services.
- `results/`: per-case `evidence.json`, `browser.log`, `safety-stop.png`,
  Playwright `trace.zip`, failure screenshots and error context.
- `evidence-summary.json`, `SHA256SUMS`: checked case summary and artifact hashes.
- `reruns/`, `resumed-evidence-summary.json`, `matrix-resumed-verified.log`:
  final handoff rerun, preserving the original `results/` evidence. The runner
  uses fresh timestamped output directories; the summary identifies each case.
- `checkFile-resumed-verified.log`, `typecheck-resumed.log`, `app-resumed.log`:
  final handoff checks and frontend build output.
- `matrix-final.log`, `server-build.log`, `server.log`, `app.log`, `checkFile.log`,
  `typecheck.log`: commands' captured output.
- `attempt-1.log`, `attempt-2.log`, `attempt-3.log`, `matrix.log` and
  `first-reproduction/`, `fixture-matrix-results/`: earlier fixture iterations and the first valid stop.
  Startup/helper failures are not counted as issue reproductions.

These `/tmp` artifacts are not committed or guaranteed to survive host cleanup.
Keep them with the handoff before cleaning this task. No failing or skipped test
is added to regular CI.

From a checkout of the baseline with dependencies installed, first confirm that
4372/1942 are free (or change both artifact configurations consistently):

```bash
cp /tmp/issue-provider-repro-20260926/supersync-issue-provider-reorder-conflict.spec.ts e2e/tests/sync/
docker build -f packages/super-sync-server/Dockerfile.test -t issue-provider-repro:db3549b114 .
docker compose -p issue-provider-repro-8d7982 -f /tmp/issue-provider-repro-20260926/compose.yaml up -d
curl -fsS http://127.0.0.1:1942/health
npm run env
node_modules/.bin/ng serve --host 127.0.0.1 --port 4372
# In another terminal, from the same checkout:
SUPERSYNC_E2E_URL=http://127.0.0.1:1942 E2E_REQUIRE_SUPERSYNC=true \
  node_modules/.bin/playwright test \
  --config /tmp/issue-provider-repro-20260926/playwright.config.cjs
```

The runner fixes one worker, zero retries and only this spec; add
`--grep 'local-order / remote-newer'` for one case. A nonzero exit at the desired
`in-sync` assertion is expected on this baseline. A timeout or setup failure is
not equivalent. Stop only the app process launched here and the named Compose
project after testing. Move the red spec back out of `e2e/tests` before integration.

## Separately sequenced fix handoff

The habit follow-up owns shared resolver work. Sequence any provider change
after it; this task authorizes no implementation or shared-helper edit.

The smallest existing pattern to assess is the exact order/content predicate
and current-state replay projection in
[reorder-conflict.util.ts](../../src/app/op-log/sync/reorder-conflict.util.ts),
with its conflict-detection caller and the retained-causal-proof/reissue path in
[superseded-operation-resolver.service.ts](../../src/app/op-log/sync/superseded-operation-resolver.service.ts).
Do not merely exempt provider orders from preflight: a rejected plural order
must retain its list intent, overlapping non-primary IDs and current membership.
Do not add a generic full-provider-update admission based on this one UI case.

A later fix must preserve these observed contracts and supply its own evidence:

- Consume the actual full-model update, preserving provider ID/key, settings,
  project/tag references, unedited and disabled siblings, and unique membership.
  A settings change also affects the panel's enabled/disabled presentation
  partition; that is distinct from stored `issueProvider.ids`. The reducer
  retains IDs omitted by an order; a replay must not recreate deleted providers
  or erase newly configured ones. Deletes and competing orders are separate cases.
- Exercise both pending-local directions and timestamp winners. Require
  convergence, pending retirement, both devices' independent tasks/configuration,
  and no new REPAIR/SYNC_IMPORT/BACKUP_IMPORT. Keep the failure assertion red
  before the fix and green afterward.
- Reload both clients, replay accepted history in a fresh client, and exercise
  status-blind replay of rejected originals plus replacements. Include interrupted
  upload/retry and compaction/missing causal evidence; preserve pending intent
  if evidence is insufficient. This task's restart check proves preservation
  after the stop, not successful replay or recovery.
- Run an unmodified released client with pinned artifact provenance, covering
  receipt/restart in both histories and old-client-resolves-first limitations.
  Current action names/envelopes must replay correctly without a schema bump.
  Do not infer provider compatibility from the earlier note/habit tests.

No production, shared-helper, habit/WebDAV-spec, model/action/schema/wire,
dependency or agent-control change is part of this deliverable. No new resolver
allowlist, generic fallback or recovery storage is proposed.

## Fix validation

The initial fix (`d00bb723cde9c448553a03ad529101fe232ba5b5`) admits only the
reproduced identity-preserving GitLab editor shape through the existing
order/content commutativity and retained-evidence
checks. Rejected provider operations are projected against durable current
state: a reorder carries the complete current provider list, while an update
carries current values of its original fields. This preserves later additions,
deletions and settings changes without recreating a deleted provider.

Production changes are confined to `reorder-conflict.util.ts` and the resolver's
snapshot selection. There is no schema bump, new persisted field, action,
dependency or public API. Other provider kinds, competing reorders, unknown
settings fields and identity-changing updates remain outside this exception.

The checked-in regression is
[`supersync-issue-provider-reorder-conflict.spec.ts`](../../e2e/tests/sync/supersync-issue-provider-reorder-conflict.spec.ts).
Its matrix covers both pending-local directions and timestamp winners,
interrupted upload/restart/retry, compaction that removes the causal proof,
fresh-client replay, and both released-client replacement histories. Compaction
intentionally retains the unsupported pending reorder and the recovery dialog;
it does not silently acknowledge it or replace the dataset.

Released-client checks use unmodified v19.1.0 assets from the official
[`app-play-release.apk`](https://github.com/super-productivity/super-productivity/releases/download/v19.1.0/app-play-release.apk).
SHA-256 is `127af90995763d88a502eae428af9dc395dcdf17d3f8f1be498f56dfa4aab9dc`,
matching the GitHub release asset digest. All 1,229 extracted `assets/public`
files match the APK bytes, with no extra files. The released asset server uses
an ephemeral port so separate compatibility specs can run concurrently.

The fixed client must own conflict resolution. A released client encountering
the crossing first still opens its safety dialog; the matrix verifies pending
work, provider state and visible tabs/tasks survive Cancel and restart. This is
a compatibility limit, not successful convergence on an unchanged old client.

Checks completed on 2026-09-26:

- `npm run test:file src/app/op-log/testing/integration/reorder-conflict-wedge.integration.spec.ts`:
  **46 passed**, including status-blind replay and later provider mutations.
- `npm run test:file src/app/op-log/sync/superseded-operation-resolver.service.spec.ts`:
  **67 passed**.
- `npm run test:file src/app/op-log/sync/conflict-resolution.service.spec.ts`:
  **242 passed**.
- All **11 browser scenarios verified**, with zero skips/retries. The full
  matrix initially passed 10; the last old-client case observed the error icon
  before its asynchronous dialog. Its failure screenshot already showed the
  expected dialog. After changing that assertion to wait for the visible
  dialog, both old-client-first cases passed in the focused rerun.
- Negative control: restoring both production files from the pre-fix `HEAD`
  (`15340ac3e8f`, identical here to `db3549b114`) made the unchanged
  `local-order / remote-newer` regression fail at its desired success assertion
  with `UnsupportedMultiEntityConflictError`. The reviewed source bytes were
  restored automatically and the fixed app rebuilt afterward.
- `npm run checkFile` passed for all five changed TypeScript files; strict
  standalone E2E TypeScript checking, documentation links, Markdown formatting
  and `git diff --check` passed.

The browser run used the same task-isolated server and runner as the original
reproduction, with the fixed source and released assets:

```bash
SUPERSYNC_E2E_URL=http://127.0.0.1:1942 E2E_REQUIRE_SUPERSYNC=true \
  COMPAT_OLD_ASSETS=/tmp/sync-s2-release-v19.1.0/assets/public \
  node_modules/.bin/playwright test \
  --config /tmp/issue-provider-repro-20260926/playwright.config.cjs
# The focused assertion rerun used the same command plus:
# --grep 'old resolves first'
```

Follow-up logs are under `/tmp/issue-provider-repro-20260926/`:
`integration-pr-review.log`, `resolver-pr-review.log`,
`conflict-resolution-pr-review.log`, `e2e-pr-review.log`,
`released-first-pr-review.log`, `baseline-pr-review.log`, `typecheck-pr-review.log` and
`docs-links-pr-review.log`. The full matrix's traces/evidence are in
`reruns/1790455814116/`, the focused rerun is in `reruns/1790457081252/`, and
the negative control is in `reruns/1790457230349/`.
Sandbox-blocked launch attempts and the initially incomplete test-state type
are excluded from passing validation. No full provider suite or WebDAV run is
claimed.

## Provider-independent recovery

The GitLab-specific restriction in `d00bb723cde9` was a coverage boundary, not a
provider-specific conflict. The follow-up adds real UI reproductions for the
Jira editor's full model and GitLab's partial pinned-search update. Jira keeps
its nested `transitionConfig` and `availableTransitions`; pinning emits only
`{ pinnedSearch: 'synthetic search' }`, without `changes.id`. Both cross a
three-provider reorder whose primary ID is not the edited provider's ID.

`ISSUE_PROVIDER_UPDATE` reaches the shared unsorted entity adapter's
`updateOne`. It leaves the ordered IDs unchanged unless `changes.id` changes
identity. The fix therefore removes the provider-name/settings allowlist and
requires a nonempty changes object whose `id` is absent or matches the declared
provider. Existing action metadata, single-update footprint and retained causal
proof checks still apply. Deletions, competing reorders, malformed changes and
identity changes remain unsupported. Replacement projection is unchanged.

The same browser harness now covers Jira in both pending directions and both
timestamp orders, pinned search in both pending directions, and both Jira
replacement histories consumed by unmodified v19.1.0. Every successful case
checks settings, membership, disabled siblings, independent tasks/configuration,
pending retirement, restart and fresh replay without dataset replacement.
The original GitLab retry, compaction and old-client-first cases remain in the
matrix. Real-store tests also cover optional settings and a valid GitHub plugin
provider with nested `pluginConfig`; plugin behavior has integration coverage,
not real-plugin UI coverage.

Validation on 2026-09-26–27 (Europe/Berlin), starting from `d00bb723cde9`:

- Before changing production code, both new UI cases failed at the desired
  successful-sync assertion with `UnsupportedMultiEntityConflictError`. Jira
  emitted its complete 32-field model; the pinned-search case emitted one field.
  Both retained all three pending local operations and the exact local state
  through restart. The earlier launch while the app was still starting produced
  browser runtime errors and was excluded; the clean red rerun is the evidence.
- The expanded real-store integration suite passed **63 tests**. The two shared
  resolver suites passed **309 tests** (67 superseded-operation and 242 conflict
  resolution tests), for **372 focused Angular tests** in total.
- The complete **19-scenario browser matrix passed** in 12.3 minutes, with zero
  skips and retries, including all six unmodified v19.1.0 cases.
- `npm run checkFile` passed for all three TypeScript files changed in this
  follow-up. Strict standalone E2E type-checking, documentation links, Markdown
  formatting and `git diff --check` passed. `tested-source.json` records the
  tested TypeScript hashes; the production predicate is smaller by 18 lines.

New artifacts are separate from the original reproduction in
`/tmp/issue-provider-generalize-20260926/`: `red-ready.log`, `integration.log`,
`resolvers.log`, `green.log`, and `docs-links.log`. The clean red traces and
captured rows are in `reruns/1790458903950/` (Jira) and
`reruns/1790458903996/` (pinned search). Rerun the expanded suite with the same
task-isolated server and verified release assets:

```bash
SUPERSYNC_E2E_URL=http://127.0.0.1:1942 E2E_REQUIRE_SUPERSYNC=true \
  COMPAT_OLD_ASSETS=/tmp/sync-s2-release-v19.1.0/assets/public \
  node_modules/.bin/playwright test \
  --config /tmp/issue-provider-generalize-20260926/playwright.config.cjs --workers=3
# The clean negative control used the same runner on d00bb723cde9 plus:
# --grep 'local-order / remote-newer / (JIRA|pinned search)$' --workers=2
```

The released-client limit is unchanged: a fixed client must resolve the crossing;
an old resolver can still stop safely. Compacted causal history also retains the
pending operation instead of guessing. No full provider-suite or WebDAV run is
claimed for this follow-up.

## Rebase with dated-habit recovery

On 2026-09-27, PR #10294 head `85571104ddf89471950dacfcd51f4937635e92a1`
was rebased locally onto master `f936a3db13dbb00d4a9720e0856a2c0821bda919`,
which includes dated-habit recovery from #10295. The two production files combine
without changing either recovery rule. Documentation and integration-test conflicts
retain both families, including habit safety stops, dated replacements and provider
identity checks. The provider scenario loop renamed `family` to `scenario.family`;
two dated-habit assertions needed that same change. The first focused compile caught
those references, and its failure log is retained.

Fresh validation of the combined source:

- **386 focused Angular tests passed**: 77 reorder integration, 67 superseded-operation
  resolver and 242 conflict-resolution tests.
- **32 browser scenarios passed** in 13.5 minutes, with zero retries or skips: all
  19 provider cases and 13 Today/For-Date habit cases, including unmodified v19.1.0
  receivers, interrupted upload, compaction, restart and fresh replay.
- `npm run checkFile` passed for all five TypeScript files in the provider PR.
  Strict focused E2E TypeScript checking, documentation links, Markdown formatting
  and `git diff --check` passed.

The isolated clone is `/tmp/sync-pr-10294-repair-20260927`; logs, traces, runner
configuration and `tested-source.json` are in
`/tmp/sync-pr-10294-repair-20260927-artifacts/`. The app used port 4394, Karma 9894,
and the private Compose project `sync-pr-10294-repair-20260927` used SuperSync port
1964 with an unexposed fresh PostgreSQL database. The server was rebuilt from this
rebased checkout, including master's WebSocket fix, as image
`sha256:cf7af31ec4509155a89bc3e383c0105f1bd911569939b050f768af93f755dd4b`.
The earlier provider image was replaced before browser testing.

The browser command used the saved runner and the same verified release assets:

```bash
SUPERSYNC_E2E_URL=http://127.0.0.1:1964 E2E_REQUIRE_SUPERSYNC=true \
  COMPAT_OLD_ASSETS=/tmp/sync-s2-release-v19.1.0/assets/public \
  node_modules/.bin/playwright test \
  --config /tmp/sync-pr-10294-repair-20260927-artifacts/playwright.config.cjs \
  --workers=3 --grep 'issue.provider|dated habit|habits:'
```

This is conflict reconciliation, not a new sync behavior change; the original red
reproductions remain the baseline evidence. Released clients resolving first can
still stop safely, and provider reorder recovery still requires retained causal
proof. No full WebDAV or unrelated browser-suite run is claimed for this rebase.
