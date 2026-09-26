# S5 conflict journal retirement — review handoff

Status: Phase B implementation, validation and independent review are complete.
The user has now authorized committing, pushing this task branch and creating a
PR. Merge and full scheduled provider validation remain outstanding. Earlier
handoff sections below record the authority and checks at those checkpoints.

## Baseline and authority

- Starting branch: `task/sync-s5-retire-conflict-journal-93cd24`.
- Starting HEAD: `9177c3afed6429934632b23de936cda8c6603fde`.
- Zero task-owned commits at receipt; only the runtime-injected `AGENTS.md`
  differed. Its change remains preserved and excluded from commits.
- Empty-range rebase, with autostash, onto the assignment's published baseline:
  `git rebase --autostash --onto c292e32a98ee2d1fbfdc70d8c021e5f6e97ccc19 9177c3afed6429934632b23de936cda8c6603fde`.
- Phase A tested production baseline: `c292e32a98ee2d1fbfdc70d8c021e5f6e97ccc19`.
- Initial fresh `gh api repos/super-productivity/super-productivity/pulls/10284`
  returned `state: open`, `merged: false`, `merged_at: null`, head
  `dbc2dfb4170f8b35b8af5d2d484b44665e1fef15`. The API's non-null
  `merge_commit_sha` while open is not proof of integration.
- Read the assignment and accepted decision/context (§5 and §7), root/E2E
  guidance, documentation/review guides, architecture decisions, contributor
  sync model, journal/review and local recovery-point contracts, relevant op-log
  architecture sections and severity guidance. Initial preparation performed no
  delegation or external writes.

## Removal inventory at the tested baseline

Consumer searches: `rg -l 'ConflictJournal|conflict-journal|sync-conflict-review|sync-conflicts|disableConflictJournal' src e2e packages angular.json`,
plus searches for `SyncConflictBanner`, `CONFLICT_REVIEW`,
`SyncConflictsAutoResolved`, `buildMergedFieldDiffs` and `NOISE_FIELDS`.
The broad search adds two important shared consumers to the assignment's leads:
`superseded-operation-resolver.service.ts` and `core/banner/banner.model.ts`.
No journal database owner or application consumer was found in packages or
build configuration; package script references to OS journals are unrelated.

| Ownership                        | Verified removal / preservation boundary                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Journal-only storage             | `op-log/sync/conflict-journal.service.ts`, `conflict-journal.model.ts`: independent database `SUP_CONFLICT_JOURNAL`, version 1; store `conflicts`, key path `id`, indexes `by-status` → `status` and `by-resolvedAt` → `resolvedAt`; marker `SUP_CONFLICT_JOURNAL_CLEARED_BEFORE` in localStorage. Remove store service, journal shapes/retention constants and exclusive service tests.                                                                         |
| Journal-only emission and review | `conflict-journal-emission.util.ts`, `sync-conflict-review.util.ts`, `sync-conflict-ui.service.ts`, `sync-conflict-banner.service.ts` and exclusive tests including `conflict-journal-hook.integration.spec.ts`. Keep/flip and journal-summary banner disappear.                                                                                                                                                                                                 |
| Review page and entry points     | `pages/sync-conflicts-page/` and its tests/styles, `app.routes.ts` route, `routes/pages.routes.ts` export, Settings link in `config-page.component.html`, sync-button badge/description and associated injection in `main-header.component.*`. Preserve sync error/offline/progress states and button behavior.                                                                                                                                                  |
| Resolver observation hooks       | `conflict-resolution.service.ts`: journal/banner injections, `disableConflictJournal`, successful-resolution journal loops, `_journalResolution`, `_journalMergedResolution`, journal-only corruption WeakSet tagging, journal REVIEW action. Preserve actual clock-corruption adjustment, winner selection, merged-op persistence/application, safe multi-entity plans and meaningful integration assertions.                                                   |
| Additional caller                | `superseded-operation-resolver.service.ts` injects the summary-banner service and calls it after writing replacements. Drop that observation hook only; preserve transactional replacement/rejection, S2 reorder projection and discarded-change notices.                                                                                                                                                                                                        |
| Production flag                  | `remote-ops-processing.service.ts` is the production caller passing `disableConflictJournal: true`. Remove obsolete option/comment without disabling disjoint merging or changing processing.                                                                                                                                                                                                                                                                    |
| Dataset replacement cleanup      | `backup/backup.service.ts` and `sync/operation-log-sync.service.ts` inject the journal and call `clearAll()`. Remove journal-only hooks and setup/assertions; retain recovery capture, restore identity checks, pending-op handling and atomic persistence.                                                                                                                                                                                                      |
| Startup                          | `src/main.ts` has a dedicated fire-and-forget journal `APP_INITIALIZER`. Replace this smallest existing hook with retirement, without instantiating a removed service or awaiting blocked deletion. Adjacent local-draft initializer stays. No existing production `deleteDatabase`/`deleteDB` cleanup framework was found; one narrowly named delete request is enough.                                                                                         |
| Shared algorithm                 | `conflict-disjoint-merge.util.ts` uses `NOISE_FIELDS` for eligibility/synthesis, and the resolver uses it for live no-pending conflict logic. Move that constant minimally into the surviving merge utility. `buildMergedFieldDiffs` and its `ConflictJournalFieldDiff` result are journal-only presentation (production caller is emission utility); remove them and their exclusive spec section while retaining merge extraction/eligibility/synthesis tests. |
| Banner identity and strings      | `core/banner/banner.model.ts` has journal-only `SyncConflictsAutoResolved` and a separate active `SyncConflictContentResolved`. Remove only the former and its priority. Preserve active content-loss warning, failed-sync/safety and recovery banners. Remove English `F.SYNC.CONFLICT_REVIEW` and regenerate the corresponding `t.const.ts` surface; other locales remain untouched.                                                                           |
| Docs                             | Update the journal contract while preserving its active disjoint-merge/composition explanation and inbound anchors; remove current capability claims in sync docs/architecture HTML, wiki `3.06-User-Data.md` and `4.23-Managing-Your-Data.md`. Preserve historical plans as history.                                                                                                                                                                            |

Shared specs requiring journal-only setup/assertion edits after the gate:
resolver service/disjoint-merge/persistence specs, remote-processing,
operation-log-sync, backup and main-header specs; integration specs for
archive conflicts, round-time resolution/convergence, restore-task, Today
planning, unsupported multi-entity conflicts, no-pending crossing convergence,
and S2 reorder conflicts. Keep state/convergence/error assertions.

## Seeded browser coverage

The only new test file is
`e2e/tests/sync/conflict-journal-retirement.spec.ts`. It uses the regular isolated
browser fixture, task/import page objects and existing recovery-ring reader.
There is no provider dependency, mock deletion seam, new production API or
shared test infrastructure.

The browser creates a task, exports its real complete backup, then imports that
file through the existing UI. This captures a real `LOCAL_IMPORT` recovery-ring
snapshot containing that task. A second app-created task generates a genuine
local unsynced operation after the backup. The test waits for that operation in
`SUP_OPS/ops`, accepting the existing compact/full stored formats, and preserves
the complete pending rows and snapshot as comparison witnesses.

The legacy journal seed uses native IndexedDB and the exact version-1 store and
index schema. It writes two full schema-shaped rows, one before the clear marker
and one fresh unreviewed row after it, then reads them back and verifies schema,
values and marker. Both seed connections close before reload. After startup,
both tasks are visible, every pre-reload pending row is still present verbatim,
the backup snapshot is unchanged and the ring metadata is unchanged.

Two tests share this preparation:

1. Fixture validity additionally restores the snapshot through Browse backups →
   Restore. The original task returns and the later task disappears, proving
   the retained backup is usable by the real restore path.
2. Upgrade retirement asserts the journal database is absent via
   `indexedDB.databases()` (never opens it to check absence), then asserts the
   obsolete marker is absent. Expected baseline failure is database presence,
   after all preservation checks and witness attachment have passed.

An initial authoring run failed because IndexedDB returns rows in key order,
not insertion order. The assertion now checks exact row count and unordered
contents. That fixture failure is not counted as the required red regression.

## Completed retirement cases

- **Fresh/repeated startup:** an isolated context starts, creates a real task,
  and reloads twice. Each start leaves the journal absent; the task survives.
- **Blocked deletion:** a second same-origin page holds a real legacy database
  connection open and deliberately retains it on `versionchange`. The app
  reloads, retains all upgrade witnesses, removes the marker and creates another
  usable persisted task while deletion remains blocked. Closing that connection
  completes deletion without another restart. This is a native IndexedDB request,
  with no deletion mock or production polling service.
- **UI:** Settings has no retired review entry, Browse backups remains available,
  and the obsolete route takes the existing app fallback. Real backup Restore
  works in the fixture-validity case. Resolver specs keep the content-loss warning
  and assert its removed review action; header tests retain active sync controls.

## Risk boundary

Accepted loss is old journal rows only, without export. Removal may never
delete `SUP_OPS`, tasks, pending operations, snapshots/archives or backups.
Startup retirement must be fire-and-forget and narrowly target the exact old
database and marker. Journal schema is device-local, excluded from backup and
sync; no schema/wire bump or released-client LWW/replay change is required.
Keep disjoint-field merging, LWW readers/creation, delete-wins, historical action
replay and S2 reorder behavior. The removal changes no persisted application-model field, schema version,
operation shape, winner rule, dependency or public/plugin API.

## Phase A verification and gate transition

- `npm run checkFile e2e/tests/sync/conflict-journal-retirement.spec.ts` passed.
- Focused strict typecheck passed:
  `node_modules/.bin/tsc --noEmit --target ESNext --module ESNext --moduleResolution node --esModuleInterop --skipLibCheck --strict --resolveJsonModule --lib ESNext,DOM --types @playwright/test e2e/tests/sync/conflict-journal-retirement.spec.ts`.
- `node_modules/.bin/tsc --project e2e/tsconfig.json --noEmit` fails upstream
  with TS2307 in `compact-operation.types.ts:1` (`src/app/core/util/vector-clock`
  unresolved). Reproduced with the new spec excluded using
  `node_modules/.bin/tsc --project .tmp/s5-e2e-baseline-tsconfig.json --noEmit`;
  the temporary config extends the original E2E config, includes existing E2E
  files and excludes only the new spec. No unrelated typecheck fix was made.
- Final baseline run:
  `npm run e2e:file e2e/tests/sync/conflict-journal-retirement.spec.ts -- --retries=0 --workers=1`:
  **1 passed, 1 expected failure, 0 skipped**. Failure is a direct database
  presence assertion, with no timeout: received names include
  `SUP_CONFLICT_JOURNAL`. Both tests recorded two schema-shaped journal rows,
  two pending rows before/after and the unchanged real backup snapshot/ring.
- Artifacts preserved outside the worktree at
  `/tmp/sync-s5-phase-a-c292e32a98ee/test-results/`: retirement directory
  `sync-conflict-journal-reti-f7b6f-ration-and-backup-witnesses-chromium`
  contains `upgrade-witnesses.json`, `app-created-backup.json`,
  `error-context.md`, screenshot and `trace.zip`. Fixture-validity directory
  `sync-conflict-journal-reti-58f3c-rations-and-a-usable-backup-chromium`
  contains its backup and preservation witnesses.
- A redirected rerun failed to start Playwright's webServer (exit 127).
  The normal command above was rerun successfully to the expected assertion;
  the startup failure is not red evidence.
- Gate rechecked at 2026-09-26 17:11 UTC: #10284 is now merged (merged at
  17:05:28 UTC), merge SHA `f84259fcaa66a9bb9512d1c048a299d230740c04`.
  `git fetch origin master` fetched that exact master HEAD;
  `git merge-base --is-ancestor f84259fcaa66a9bb9512d1c048a299d230740c04 origin/master`
  passed. Phase B is now authorized after preparation rebase and repeated red.

## Verified integrated baseline

Fresh GitHub metadata confirmed #10284 merged at `2026-09-26T17:05:28Z` as
`f84259fcaa66a9bb9512d1c048a299d230740c04`. Refreshed `origin/master` was exactly
that commit, and its ancestry check passed. The empty task's Phase A commit was
rebased with `git rebase --autostash --onto f84259fcaa66a9bb9512d1c048a299d230740c04 c292e32a98ee2d1fbfdc70d8c021e5f6e97ccc19`,
replaying only this task's preparation commit, now `8c687017fe`. Injected
`AGENTS.md` remained intact and uncommitted. `git merge-base --is-ancestor
f84259fcaa66a9bb9512d1c048a299d230740c04 HEAD` passed before production edits.

Before touching production or existing specs, repeated the regression:

```bash
npm run e2e:file e2e/tests/sync/conflict-journal-retirement.spec.ts -- --retries=0 --workers=1 --grep 'seeded upgrade'
```

It failed directly because `SUP_CONFLICT_JOURNAL` remained, after all task,
pending-operation and backup comparisons passed. Integrated-baseline red log and
screenshots, error context, trace, app-created backup and upgrade witnesses are
preserved in `/tmp/sync-s5-integrated-f84259fcaa66-red/`.

## Implemented scope and consumer check

Removed the journal-only services/models/emission/review helpers, exclusive specs,
page/styles, route/export, Settings entry, header badge, summary-banner identity
and English review strings. Removed observation/clear hooks only from resolver,
remote processing, superseded resolution, sync and backup owners. The surviving
merge utility now owns the unchanged `NOISE_FIELDS`; journal presentation diffs
are gone. Meaningful shared algorithm/state/error tests remain; tests that relied
only on journal entries now check emitted LWW payloads or rejection/application.

The existing startup hook now removes only the obsolete clear marker and requests
`indexedDB.deleteDatabase('SUP_CONFLICT_JOURNAL')`. It returns immediately and
logs blocked/storage errors without rejecting bootstrap. It does not open or wipe
`SUP_OPS`, `pf`, credentials, archives, backups or any other database.

Updated current capability claims in the focused conflict contract, sync index,
architecture documentation/HTML, local-recovery contract and data-management
wiki. The historical conflict-contract filename and active composition anchors
remain usable. Historical plans and other locales remain untouched. S6B's file
format selection/setup and WebDAV rollout remain outside this task.

Final production consumer searches for `ConflictJournal`, `SyncConflictBanner`,
`disableConflictJournal`, `sync-conflicts`, `CONFLICT_REVIEW`,
`SyncConflictsAutoResolved` and `buildMergedFieldDiffs` find no active consumers
(excluding inert untranslated locale keys). The exact old database/marker names
appear only in the targeted startup retirement. Additional shared consumers
beyond the assignment's listed leads were the superseded resolver and banner enum;
only their journal code changed. Broad deletion scope is required by exclusive
journal ownership; it removes thousands of lines and adds no cleanup framework.

## Phase B validation

The tested work is based on integrated SHA `f84259fcaa66a9bb9512d1c048a299d230740c04`
plus preparation `8c687017fe` and the final retirement diff.

```bash
npm run e2e:file e2e/tests/sync/conflict-journal-retirement.spec.ts -- --retries=0 --workers=1
```

**5 passed, 0 skipped, no retries**: valid/usable backup, seeded upgrade,
fresh/repeated startup, real blocked connection/eventual deletion, removed UI and
fallback route. Green witness/backup attachments for the upgrade, restore and
blocked cases are preserved in `/tmp/sync-s5-f84259fcaa66-green/test-results/`.

Applicable provider regressions, using the isolated required-provider stack:

```bash
SUPERSYNC_E2E_URL=http://localhost:1915 E2E_REQUIRE_SUPERSYNC=true npm run e2e:file e2e/tests/sync/supersync-lww-conflict.spec.ts e2e/tests/sync/supersync-reorder-conflict-wedge.spec.ts -- --retries=0 --workers=1 --grep 'Remote wins when remote timestamp|Local wins when local timestamp|project notes: (local|remote) reorder preserves content and order'
```

**4 passed, 0 skipped, no retries**: local and remote LWW winners propagate,
and local/remote project-note reorder conflicts preserve content and ordering,
including fresh-client replay. The successful runner metadata is preserved in
`/tmp/sync-s5-supersync-green/test-results/`. Only this task's isolated containers
were stopped afterward. Across new and applicable existing E2E files, **12 pass**.

Focused Karma commands (all relevant shared specs retained):

```bash
npm run test:file src/app/op-log/sync/conflict-resolution.disjoint-merge.spec.ts -- --include=src/app/op-log/sync/conflict-disjoint-merge.util.spec.ts --include=src/app/op-log/sync/conflict-resolution.service.spec.ts --include=src/app/op-log/testing/integration/reorder-conflict-wedge.integration.spec.ts --include=src/app/op-log/sync/conflict-resolution-persistence.integration.spec.ts
npm run test:file src/app/op-log/backup/backup.service.spec.ts -- --include=src/app/core-ui/main-header/main-header.component.spec.ts --include=src/app/op-log/sync/operation-log-sync.service.spec.ts --include=src/app/op-log/sync/remote-ops-processing.service.spec.ts --include=src/app/op-log/sync/superseded-operation-resolver.service.spec.ts --include=src/app/op-log/testing/integration/archive-conflict-resolution.integration.spec.ts --include=src/app/op-log/testing/integration/no-pending-crossing-convergence.integration.spec.ts --include=src/app/op-log/testing/integration/restore-task-conflict.integration.spec.ts --include=src/app/op-log/testing/integration/round-time-conflict-convergence.integration.spec.ts --include=src/app/op-log/testing/integration/round-time-conflict-resolution.integration.spec.ts --include=src/app/op-log/testing/integration/today-plan-conflict-resolution.integration.spec.ts --include=src/app/op-log/testing/integration/unsupported-multi-entity-conflict.integration.spec.ts
```

**347 + 491 = 838 passed.** Coverage includes disjoint/LWW/delete/archive winners,
S2 reorder, failed merge/persistence, deferred actions, crossing convergence,
unsupported multi-entity safety, restore, clock adjustment, backup and header.

- Every added/modified non-generated TS file passed `npm run checkFile <file>`.
  The retired SCSS file is deleted; no surviving SCSS changed.
- `src/app/t.const.ts`: ran the required checkFile, which correctly rejects it as
  root-ESLint-ignored; this is not recorded as a lint pass. Regenerated through
  `npm run int`, then formatted with Prettier. Excluded the unrelated existing
  `F.IOS_SHARE` generation drift so its final diff removes only review keys.
  App/spec typechecks and template compilation validate consumers.
- `node_modules/.bin/tsc --project src/tsconfig.app.json --noEmit` passed.
- `node_modules/.bin/tsc --project src/tsconfig.spec.json --noEmit` passed.
- Focused strict E2E typecheck shown in Phase A passed again for the final spec.
- `npm run buildFrontend:dev` passed (log `/tmp/sync-s5-build-dev.log`).
- `npm run lint:ts` passed (log `/tmp/sync-s5-lint-ts-final.log`), after
  checkFile formatted the three initially flagged touched lines.
- Prettier checks passed for changed Markdown, JSON, templates and generated T.
  A structural comparison verifies T equals its baseline minus only
  `F.SYNC.CONFLICT_REVIEW`, and every retained constant maps to an English key.
- `git diff --check` passed.
- `npm run e2e:file e2e/tests/import-export/archive-import-persistence.spec.ts -- --retries=0 --workers=1`: **3 passed, 0 skipped**. Real imports retain both
  archive tiers and time tracking across reload.
- Full E2E typecheck's separately reproduced upstream TS2307 remains as documented
  above; no unrelated fix was added. Full scheduled provider suites remain a later
  coordinator publication gate.
- Node child-process spawning under sandbox returned EPERM for checkFile; reran
  the required checks with explicit tool escalation and they passed. A redirected
  archive E2E run hit the same webServer exit-127 startup issue noted in Phase A;
  the ordinary command was rerun. Neither startup failure counts as test evidence.
- The first required-provider LWW/reorder run on the shared port 1901 was
  interrupted after the initially healthy service disappeared during client setup
  (`ERR_CONNECTION_REFUSED`; Docker status confirmed no SuperSync container).
  Its artifacts are preserved in `/tmp/sync-s5-supersync-interrupted/`. It is not
  counted as regression evidence. Rebuilt an isolated Compose project
  `sync-s5-retirement` on loopback port 1915 using an ignored task-only override;
  no other worker's server or repository files were changed.

## Residual risks and review boundary

This is a high-risk sync/startup deletion. Accepted irreversible loss is only the
old journal rows, without export. Real upgrade witnesses prove task data, actual
pending operations and the recovery snapshot survive; the real Restore flow proves
that snapshot usable. Direct algorithm tests and convergence E2E cover preserved
resolution/replay behavior. No journal DB data was ever in the sync wire or backups,
so mixed-client resolution semantics do not change.

An older running tab can postpone deletion indefinitely, or an older client can
recreate the retired journal; a later new-client startup requests deletion again.
Browser storage failures log and retry only on another startup. No guarantee is
made for cleanup while every old connection remains open. No new persisted marker,
registry, timeout, broad wipe or polling service is introduced.

Only S5 files are included in local commits. Injected `AGENTS.md` is preserved and
excluded; the initial Parallel Code `signal_done` succeeded. Integration awaits
user review.

## Parent coordination checkpoint

The resumed parent checkpoint introduces no runtime change or new assignment.
Branch remains `task/sync-s5-retire-conflict-journal-93cd24`.

- Original inherited baseline: `9177c3afed6429934632b23de936cda8c6603fde`.
- Verified integrated baseline: `f84259fcaa66a9bb9512d1c048a299d230740c04`.
- Preparation commit: `8c687017fed68f4ae43c1e7afda8d1de50889778`.
- Committed, tested runtime and HEAD entering this checkpoint:
  `b2b1f78d2e13d0331a909cdb88edf3cb00759a53`.
- Integrated merge ancestry was rechecked successfully at this checkpoint.
  The only pre-existing working-tree change is injected `AGENTS.md`, preserved
  uncommitted. This follow-up commit updates only this result artifact.

The seeded-upgrade red remains the direct journal-presence failure on the
integrated baseline; its machine runner metadata still reports failed. The five
retirement cases and four focused provider cases still have saved passed runner
metadata with empty failure lists. Exact commands, artifacts, the additional three
archive E2E passes, 838 unit/integration passes and compilation/lint/build checks
are recorded above. No runtime file changed since those checks, so this checkpoint
requires only Markdown formatting and diff validation.

There is no remaining local S5 implementation blocker. Parent actions remain:

- Review the local commits before authorizing integration. No push, PR, merge or
  publication is performed or authorized by the coordination resume.
- Run the full scheduled SuperSync and WebDAV suites at the later publication
  gate described in the assignment. These are outstanding parent validation,
  separate from the completed local checks.
- Retain the separately reproduced upstream full-E2E typecheck TS2307 as an
  explicit unresolved validation limitation; S5's strict focused typecheck passes.

S6B continues to own file-format selection/setup and WebDAV rollout tests. This
checkpoint adds no work in that scope and does not reopen the accepted journal
data-loss decision or the documented blocked-deletion limitations.

## Independent review and PR handoff

At the user's request, one read-only sub-agent reviewed
`f84259fcaa66a9bb9512d1c048a299d230740c04..ac5f7a2ec28d0fa50c4d0928f8ca65a85f9b70ea`
and found no concrete defects. It independently passed the app/spec and focused
E2E typechecks, ancestry and diff checks, verified the saved red/green evidence
and absence of stale runtime consumers, and reproduced the upstream full-E2E
TS2307 with and without the new spec. It did not rerun all 838 unit/integration
and 12 E2E cases. Confidence in the scoped S5 change is high; full provider suites
and platform coverage beyond the tested Chromium browser remain validation limits.

The subsequent user request explicitly authorizes a branch push and PR creation.
This changes publication authority only; it introduces no runtime edits and
does not authorize merging or manually dispatching the scheduled suites. The PR
must disclose the accepted loss of journal entries, blocked/storage cleanup
limitations, passing local checks and outstanding full provider/typecheck gates.
Injected `AGENTS.md` remains uncommitted, and S6B retains its separate scope.
