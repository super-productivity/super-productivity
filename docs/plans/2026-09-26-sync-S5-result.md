# S5 conflict journal retirement — Phase A preparation

Status: preparation only. Production removal is gated on verified integration
of PR #10284. No production or existing shared test files have been edited.
The retirement regression is deliberately red until Phase B; do not publish
this preparation commit or treat it as full S5 completion.

## Baseline and authority

- Starting branch: `task/sync-s5-retire-conflict-journal-93cd24`.
- Starting HEAD: `9177c3afed6429934632b23de936cda8c6603fde`.
- Zero task-owned commits at receipt; only the runtime-injected `AGENTS.md`
  differed. Its change remains preserved and excluded from commits.
- Empty-range rebase, with autostash, onto the assignment's published baseline:
  `git rebase --autostash --onto c292e32a98ee2d1fbfdc70d8c021e5f6e97ccc19 9177c3afed6429934632b23de936cda8c6603fde`.
- Tested production baseline: `c292e32a98ee2d1fbfdc70d8c021e5f6e97ccc19`.
- Initial fresh `gh api repos/super-productivity/super-productivity/pulls/10284`
  returned `state: open`, `merged: false`, `merged_at: null`, head
  `dbc2dfb4170f8b35b8af5d2d484b44665e1fef15`. The API's non-null
  `merge_commit_sha` while open is not proof of integration.
- Read the assignment and accepted decision/context (§5 and §7), root/E2E
  guidance, documentation/review guides, architecture decisions, contributor
  sync model, journal/review and local recovery-point contracts, relevant op-log
  architecture sections and severity guidance. No delegation or external writes.

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

## Required remaining cases after integration

- **Fresh/repeated startup:** isolated empty context, wait for ready app, assert
  journal database absent without opening it; create a task, reload twice,
  assert task still visible and database/marker absent each time.
- **Blocked deletion:** reuse the upgrade seed and preservation witnesses.
  Open a second page at the same origin with a test-served empty HTML document;
  hold a real `indexedDB.open('SUP_CONFLICT_JOURNAL', 1)` connection there with
  a `versionchange` listener that records the event but deliberately does not
  close. Reload the app page, wait for usable tasks and create another task
  while the blocker remains open. Verify the versionchange event, retained
  pending ops/backup and marker cleanup. Close the blocker connection and poll
  `indexedDB.databases()` for disappearance without restarting the app. A native
  delete request remains pending until all connections close; an old running
  client can keep deletion blocked or later recreate its old DB. Report this
  limitation, without polling services or permanent migration flags.
- **UI:** Settings no longer links to `/sync-conflicts`; direct obsolete route
  uses established fallback behavior; no journal badge or summary REVIEW
  action. Keep error/offline/progress button behavior, content-loss warning,
  safety conflict controls and Browse backups/Restore working. Fixture-validity
  already exercises the real backup controls.
- **Integration gate:** recheck fresh PR metadata; only when `merged: true`,
  fetch master and prove returned merge SHA is an ancestor of refreshed master.
  Rebase only the preparation commits with unrelated/injected edits preserved.
  Record exact integrated baseline and rerun the red upgrade regression there
  before any production or existing-test edits. Never stack the open PR.
- **Phase B checks:** focused resolver/disjoint-merge/S2 reorder integration,
  affected superseded-resolver/backup/header/startup coverage, every changed
  TS/SCSS checkFile, app/spec/E2E typechecks and applicable lint/build checks;
  red/green new E2E without retries or skips and relevant route/backup E2E.
  Full scheduled provider suites remain a later coordinator publication gate.

## Risk boundary

Accepted loss is old journal rows only, without export. Removal may never
delete `SUP_OPS`, tasks, pending operations, snapshots/archives or backups.
Startup retirement must be fire-and-forget and narrowly target the exact old
database and marker. Journal schema is device-local, excluded from backup and
sync; no schema/wire bump or released-client LWW/replay change is required.
Keep disjoint-field merging, LWW readers/creation, delete-wins, historical action
replay and S2 reorder behavior. Phase A changes no runtime behavior and cannot
establish Phase B safety or completion.

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
