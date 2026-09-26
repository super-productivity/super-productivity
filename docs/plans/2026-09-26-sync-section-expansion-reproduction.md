# Section expansion versus reorder: real UI reproduction

**Verdict:** concurrent section-header dragging and named-section expansion changes
reach the multi-entity safety stop on `db3549b114`. Manual sync opens **Sync:
Conflicting Data** and cancellation leaves sync unresolved. This investigation
demonstrates blocked sync, not silent data loss. No production fix is included.

## Baseline and scope

- Inherited task HEAD: `9177c3afed6429934632b23de936cda8c6603fde`.
- Tested app and isolated SuperSync build:
  `db3549b114ed3954f70add9cf8388af676cb2bfb` (#10288).
- The saved `git ls-remote origin refs/heads/master` result returned that tested
  SHA on 2026-09-26. `git tag --contains db3549b114` returned no local tags; no
  released app was exercised. This does not establish that released clients are
  unaffected. Master also ships to internal/edge channels; see
  [severity policy](../sync-and-op-log/sync-severity-triage.md).
- The older remaining-actions audit at local commit
  `78b8a580f8f8aa9491bf77e7bac6338c3f9e3777`, file
  `docs/plans/2026-09-26-sync-remaining-conflict-actions-audit.md`, supplied the
  hypothesis. This task rechecked the UI, captured operations and resolver.
- Only this report is committed. The red spec, patch, logs and traces are retained
  under `/tmp/section-expansion-repro-20260926/`. No failing spec or permanent skip
  is added to the normal suite. No persisted model, wire format, public/plugin API,
  dependency or production source changes are made.

## What the reproduction does

Two isolated Chromium contexts share one encrypted, test-only SuperSync account.
Fixture actions create Today sections Alpha, Beta and Untouched, each with a task,
plus an Inbox section between Alpha and Beta in the global section IDs. The Inbox
witness contains the Alpha task in its other valid work context. Tasks themselves
are created through the UI, with real Today scheduling data.

After both clients reach the same baseline with no pending operations, A and B
each rename a different unrelated task. One client then drags Beta's actual
section header above Alpha; the other clicks Alpha's actual expand/collapse
control. Only initial section seeding is dispatched directly. The test observes
the drag preview, resulting section order, expansion value and task visibility.

The normal SuperSync setup helper disables background uploads/downloads and
WebSocket push. Subsequent syncs use a local strict helper that requires a
successful operations GET and a settled completion indicator; it never invokes
`syncAndWait()`, which can choose a whole-dataset winner. B uploads first; A then
downloads while retaining its local section operation and unrelated task rename.
Captured timestamps and vector clocks prove the selected order and concurrency.

| A's pending section action | B's incoming action | Incoming timestamp | Result on A                |
| -------------------------- | ------------------- | ------------------ | -------------------------- |
| Reorder                    | Collapse Alpha      | Newer              | Safety stop, `side=local`  |
| Reorder                    | Expand Alpha        | Older              | Safety stop, `side=local`  |
| Collapse Alpha             | Reorder             | Newer              | Safety stop, `side=remote` |
| Expand Alpha               | Reorder             | Older              | Safety stop, `side=remote` |

The diagnostic is
`UnsupportedMultiEntityConflictError: SYNC_MULTI_ENTITY_UNSUPPORTED side=local|remote actionType=[Section] Update Section Order entityCount=3`.
The completed matrix ran in 184 seconds: four intended assertion failures,
zero skipped cases and zero retries. Every failure was expected `in-sync`,
received `conflict-dialog`, after the safety-preservation assertions below.

Before the final deliberately red assertion, each case checks that both clients'
section/task snapshots remain unchanged by the failed attempt, A's two pending
rows remain identical, cancellation preserves them, and retry opens the same
dialog again. No new `REPAIR`, `SYNC_IMPORT` or `BACKUP_IMPORT` operations appear
after the shared baseline. Neither Keep local nor Keep remote is selected.
The dialog warns that either choice replaces a whole dataset; that loss path was
not exercised.

## Captured operation evidence

The first matrix case captured these two local, unsynced SECTION rows (IDs below
are shortened to their fixture names; full rows are in `concurrent.json`):

| Field                           | A: drag                                                 | B: collapse                                                  |
| ------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------ |
| Compact action / operation type | `S4` / `MOV`                                            | `S3` / `UPD`                                                 |
| Entity ID                       | Beta                                                    | Alpha                                                        |
| Declared entity IDs             | Beta, Alpha, Untouched                                  | Alpha                                                        |
| Timestamp                       | `1790452310974`                                         | `1790452311130`                                              |
| Vector clock                    | `{ B_aZdBOD: 12 }`                                      | `{ B_aZdBOD: 10, B_e5j5vE: 3 }`                              |
| Action payload                  | `{ contextId: "TODAY", ids: [Beta, Alpha, Untouched] }` | `{ section: { id: Alpha, changes: { isExpanded: false } } }` |

Both rows use schema 4 and the existing `{ actionPayload, entityChanges: [] }`
envelope. The target Alpha is an overlapping declared ID even though the reorder's
primary ID is Beta. Neither clock dominates the other. The unrelated task rename
is a second pending row on each client before B uploads.

## Why this path stops

The [named-section template][template] calls `updateSection(id, { isExpanded })`;
the [header drop handler][drop] calls `updateSectionOrder(contextId, ids)`.
[Action metadata][actions] declares a single SECTION update versus a plural-ID
SECTION move. These are distinct from the built-in collapsibles' local settings.

The [reorder/content predicate][predicate] admits SECTION title changes only.
The [section placement predicate][placement] does not admit expansion updates.
Consequently the [concurrent-operation shortcut][detection] does not apply and
the [multi-entity preflight][preflight] throws before reconciliation or apply,
regardless of which timestamp would win. The [sync wrapper][wrapper] routes this
error to the whole-dataset conflict dialog. The E2E stack trace identifies this
preflight, rather than the later server-rejection recovery path.

## Re-run and evidence

The task uses Compose project `section-expansion-repro-141327`, SuperSync
`127.0.0.1:1946`, and frontend `127.0.0.1:4386`. Other tasks' services are separate.
From this worktree, restore the opt-in spec and start the retained isolated stack:

```bash
git apply /tmp/section-expansion-repro-20260926/reproduction.patch
docker compose -p section-expansion-repro-141327 -f /tmp/section-expansion-repro-20260926/compose.yml up -d --build
npm run startFrontend -- --host 127.0.0.1 --port 4386
```

Once the frontend and `/health` on port 1946 respond, use another terminal:

```bash
E2E_REQUIRE_SUPERSYNC=true SUPERSYNC_E2E_URL=http://127.0.0.1:1946 TZ=Europe/Berlin node_modules/.bin/playwright test --config /tmp/section-expansion-repro-20260926/playwright.config.cjs --retries=0
```

This intentionally exits 1 on the unfixed baseline. The standalone config pins one
worker and this spec only; its absolute worktree paths must be updated if moved.
Move the restored spec out of `e2e/tests/` again after using it. Stop only this
Compose project and the frontend process you started.

All artifact paths below are relative to `/tmp/section-expansion-repro-20260926/`:

| Artifact                                                                  | Purpose                                                   |
| ------------------------------------------------------------------------- | --------------------------------------------------------- |
| `reproduction.patch`, `supersync-section-expansion-repro.spec.ts`         | Opt-in red regression candidate, outside normal discovery |
| `baseline.txt`, `published-master.txt`, `server-build.log`                | Baseline and build provenance                             |
| `compose.yml`, `playwright.config.cjs`                                    | Isolated service and browser configuration                |
| `run-resumed.log`, `results.json`                                         | Complete matrix command output and Playwright results     |
| `results/<case>/baseline.json`, `concurrent.json`, `remote-uploaded.json` | Shared state, captured rows and B's upload                |
| `results/<case>/outcome.json`, `retry.json`                               | Safety-stop state, pending rows and dialog text           |
| `results/<case>/console.log`, `requests.log`, `safety-stop.png`           | Diagnostic, HTTP statuses and dialog screenshot           |
| `results/<case>/trace-A.zip`, `trace-B.zip`                               | Real UI flow and browser traces                           |
| `check-file-resumed.log`                                                  | Required formatting/lint check: passed                    |

`git apply --check reproduction.patch` passed after the spec was moved out of the
suite. An independent comparison of the saved snapshots and rows also passed for
all four cases (`evidence-check.json`). The report passed Prettier and the scoped
documentation-link check.

The earlier single-case run also reproduced the same safety stop. A prior matrix
attempt was interrupted; `initial-*` and `run.log` are not the final matrix result.
The resumed frontend and checkFile commands initially hit sandbox restrictions;
both ran successfully after escalation. No unrelated timeout or startup error is
counted as a reproduction.

## Smallest follow-up

Investigate recognizing the captured `{ isExpanded: boolean }` SECTION update in
the existing narrow [reorder/content predicate][predicate]. Reuse its identity and
metadata checks, [causal server-rejection proof][recovery], and state-based
projection; do not bypass the general multi-entity safety stop or synthesize a
whole-section LWW replacement. The [section reducer][reducer] updates expansion
independently of the context-slot reorder, which motivates this candidate but does
not prove the entire recovery history correct.

Before a fix ships, turn this red candidate green in all four cases and verify
exact order `[Beta, Inbox witness, Alpha, Untouched]`, the expansion value,
unchanged section/task membership, unique IDs, both unrelated task edits, empty
pending queues and no full-state replacement. Add restart/history replay checks
and test released-client consumption of replacement operations, including the
older-client-first limitation. Those checks and fixed-green evidence are **not
completed by this investigation**. Preserve malformed/unproven pair exclusions;
no schema bump or new persisted field is suggested.

[template]: https://github.com/super-productivity/super-productivity/blob/db3549b114ed3954f70add9cf8388af676cb2bfb/src/app/features/work-view/work-view.component.html#L192-L208
[drop]: https://github.com/super-productivity/super-productivity/blob/db3549b114ed3954f70add9cf8388af676cb2bfb/src/app/features/work-view/work-view.component.ts#L629-L636
[actions]: https://github.com/super-productivity/super-productivity/blob/db3549b114ed3954f70add9cf8388af676cb2bfb/src/app/features/section/store/section.actions.ts#L34-L60
[predicate]: https://github.com/super-productivity/super-productivity/blob/db3549b114ed3954f70add9cf8388af676cb2bfb/src/app/op-log/sync/reorder-conflict.util.ts#L109-L115
[placement]: https://github.com/super-productivity/super-productivity/blob/db3549b114ed3954f70add9cf8388af676cb2bfb/src/app/op-log/sync/section-conflict-commutativity.util.ts#L202-L251
[detection]: https://github.com/super-productivity/super-productivity/blob/db3549b114ed3954f70add9cf8388af676cb2bfb/src/app/op-log/sync/conflict-resolution.service.ts#L4253-L4264
[preflight]: https://github.com/super-productivity/super-productivity/blob/db3549b114ed3954f70add9cf8388af676cb2bfb/src/app/op-log/sync/conflict-resolution.service.ts#L2434-L2469
[wrapper]: https://github.com/super-productivity/super-productivity/blob/db3549b114ed3954f70add9cf8388af676cb2bfb/src/app/imex/sync/sync-wrapper.service.ts#L1137-L1166
[recovery]: https://github.com/super-productivity/super-productivity/blob/db3549b114ed3954f70add9cf8388af676cb2bfb/src/app/op-log/sync/superseded-operation-resolver.service.ts#L209-L258
[reducer]: https://github.com/super-productivity/super-productivity/blob/db3549b114ed3954f70add9cf8388af676cb2bfb/src/app/features/section/store/section.reducer.ts#L45-L109
