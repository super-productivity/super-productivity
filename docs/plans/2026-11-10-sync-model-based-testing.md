# Sync model-based testing: what to add to the fuzz harness, and whether to gate on it

> **Status: In progress.** M1–M5 were decided on 2026-11-10 (see
> [Decisions](#decisions)). Phase 1, the task-move slice, is implemented on the
> branch that carries this note; phases 2–5 are open.
>
> **Owner:** @johannesjo. **Tracking:** sync tracker
> [#10393](https://github.com/super-productivity/super-productivity/issues/10393).
>
> **Last verified against the code:** 2026-11-10 (master `954256d`, app v20.0.0).
>
> **Completion or removal condition:** delete this note when M1–M4 below are
> decided and either the first slice has merged (move what remains true into
> `src/app/op-log/testing/integration/sync-fuzz/README.md`) or M2 is answered
> "no".

**Short answer.** Extend the harness, in small mixes, starting with a second
project and a task-move intent. A scratch spike of that one intent (100 lines,
not committed) left all 120 baseline seeds unchanged. 22 of its 30 new seeds
show a signature that needs the new intent or oracle, among them a task that no
project lists, a task missing after an automatic REPAIR, and tracked time lost.
None of these is triaged, and the oracle was not taught what a move is. Do not
port the harness to the file adapter yet: the port pays only with a split sync
and a stale writer, and a randomized file check already runs in the unit test
job. Do not make "a newly failing seed" a required check yet: the tool is
deterministic, but by its own contract a new entry needs a human judgement, and
two merged fixes were accepted with new entries.

Every figure below is marked **measured** (run or counted for this note) or
**estimated** (from reading code and commit messages). Paths are relative to
the repository root; `sync-fuzz/` stands for
`src/app/op-log/testing/integration/sync-fuzz/`.

## What was read and measured

### The harness as it is

| Fact                                                                                                                                                                                                                                                                                                         | Source                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| 16 intents plus 3 state replacements; a trace is a JSON list of steps                                                                                                                                                                                                                                        | `sync-fuzz/sync-fuzz-actions.ts`, the `Intent` union                      |
| Entities touched: TASK, NOTE, SIMPLE_COUNTER (plus TIME_TRACKING through the track intent) of 18 registered types                                                                                                                                                                                            | `src/app/op-log/core/entity-registry.ts`                                  |
| One project (`INBOX_PROJECT`) and Today; no subtask, regular tag, section, planner day, repeat config, board or issue provider                                                                                                                                                                               | `SETUP_INTENTS`, `viewOf` in `sync-fuzz-actions.ts`                       |
| Every synced feature reducer and the registered meta-reducers are already in the test module, so a new intent needs no harness wiring                                                                                                                                                                        | `sync-fuzz/sync-fuzz-harness.ts`, `_configure`                            |
| No feature effect is registered; only `OperationLogEffects` and `ArchiveOperationHandlerEffects`                                                                                                                                                                                                             | same file, the class comment ("Known gaps")                               |
| A device's transport is one `OperationSyncCapable` object (`device.client`); `_syncBody` calls `downloadRemoteOps`, `uploadPendingOps` and the bounded re-upload on it                                                                                                                                       | `sync-fuzz-harness.ts`, `sync` and `_syncBody`                            |
| Three devices plus a fresh observer; a sync is atomic (download, upload, re-upload in one step)                                                                                                                                                                                                              | `sync-fuzz/sync-fuzz-runner.ts`, `runFuzz`                                |
| Oracles: sync events (stops, errors), nothing pending, no unexplained full-state op, Today notes, convergence with a fresh device, preservation (ledger), restart                                                                                                                                            | `runFuzz`, `checkPreservation`, `checkLatestWrite`                        |
| `diffPaths` compares arrays index by index, so order and membership share one signature                                                                                                                                                                                                                      | `sync-fuzz-runner.ts`, `diffPaths`                                        |
| The generator draws one task, one note and one habit before it looks at the intent kind. A new intent must draw its extra targets inside its own `case`, or every existing trace changes                                                                                                                     | `generateIntent` in `sync-fuzz-actions.ts`                                |
| 60 pinned traces, 2 to 8 steps each; 17 carry failure signatures (known bugs or kept-by-design outcomes), 43 are regression or coverage pins. They run in the Unit Tests job of `ci.yml` (**measured**, counted); whether that job is a required check is a branch-protection setting outside the repository | `sync-fuzz/sync-fuzz-pinned-traces.json`, `sync-fuzz-pinned…spec.ts`      |
| `sync-fuzz:compare` copies the head's report benchmark and `sync-fuzz-profiles.ts` into the base worktree. A profile that names an intent the base's `Intent` union lacks, or a benchmark that passes a `runFuzz` option the base lacks, will not compile there (**estimated**, from the script)             | `tools/sync-fuzz-compare.js`, `SHARED_FILES`                              |
| The CI job "Sync Fuzz Compare" runs only when client sync code changed and is in no gate                                                                                                                                                                                                                     | `.github/workflows/e2e-sync-pr.yml`                                       |
| The fake server is checked against the real one                                                                                                                                                                                                                                                              | `packages/super-sync-server/tests/sync-fuzz-server-parity.pglite.spec.ts` |

### Baseline on `954256d` (measured)

`sync-fuzz-signature-report.benchmark.ts`, the standard 120 seeds (mixes all,
noReorder, tasks, replace × seeds 20725000–029, 30 steps, 3 devices), TZ
Europe/Berlin, run twice in this environment.

| Measure                                                                     | Result                                                     |
| --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Seeds with any signature                                                    | **91** of 120 (all 24, noReorder 28, tasks 20, replace 19) |
| Wall time per revision, build included                                      | 194 s and 194 s                                            |
| Seeds identical between the two runs (steps hash, signatures, final values) | **120 of 120**                                             |

Families, seeds of 120 (a seed counts once per family, rows overlap):

| Family            | Seeds |
| ----------------- | ----- |
| `divergence`      | 73    |
| `field-reverted`  | 21    |
| `restart-changed` | 13    |
| `stop`            | 12    |
| `time-loss`       | 11    |
| `older-write-won` | 10    |
| `field-unwritten` | 6     |
| `recreated`       | 4     |

The 12 stops are the two kept reorder stops (10 remote habit order, 2 local
note order). The families are the tracked classes of
[protocol-change-options.md](../sync-and-op-log/protocol-change-options.md)
and
[order-and-membership-options.md](../sync-and-op-log/order-and-membership-options.md);
no new family appeared.

### Fixes the harness could not see (measured, counted from `git log`)

`git log 6169df9e9..HEAD` (2026-09-26 to 2026-11-10, 801 commits).

- **Conflict fixes outside the vocabulary:** sections (#11141, #11014), tag
  delete (#11505), habit delete and restore (#11474, #11504), repeat config
  (#10958, PR #10986) and issue-provider reorder (#10294). Seven commits,
  6,119 inserted lines in total, tests included.
- **File adapter:** 19 commits with a `fix` subject touch
  `src/app/op-log/sync-providers/file-based/`. One is a revert (#11168) and one
  its re-land (#11171), so 18 without the revert. Two more `fix` commits
  touch only the provider package (`packages/sync-providers/src/file-based`).

### The file adapter already has a randomized check (measured, read)

"No model-based test" needs a qualification.
`src/app/op-log/testing/integration/file-based-sync/replacement-convergence.integration.spec.ts`
(#9170) runs 40 seeds × 40 steps in four variants (v2 and v3 × encryption on
and off) against the real `FileBasedSyncAdapterService` and a shared
`MockFileProvider`. It splits download and upload, expires the cycle cache,
restarts (also as an upgrade that drops the recorded clocks), and answers
"Keep local". Its 160 seeded cases run in the Unit Tests job. Commit
`cd2757b9` (#10459) cites a 200-seed run of it.

Its limits are what a port would remove:

- The client is a hand-written mirror of `OperationLogSyncService`'s file
  contract ("Each device mirrors…", the spec's header), not the real
  download, upload, conflict and hydration services. This is the mocked seam
  the sync rules warn about: the mirror can drift from the app.
- The data model is a set of task ids that only grows. No field, no delete, no
  conflict between two edits, no content to preserve.
- The oracle is "same id set on every device". It has no ledger.

Two other specs show that the real services run against the real adapter in
one test module: `file-repair-base-convergence.integration.spec.ts` and
`file-based-redelivered-pruned-op.issue-10119.integration.spec.ts` create one
adapter instance per device with `runInInjectionContext(injector, () => new
FileBasedSyncAdapterService())`. Both replace NgRx with a hand-kept state.

### Spike: a second project and a task-move intent (measured, not committed)

Time-boxed scratch patch in a separate worktree: 100 added lines in three
files (`git diff --stat`), about one hour including two runs.

- Intents `['addProject', id]` and `['moveTask', taskId, projectId]`. The move
  dispatches `TaskSharedActions.moveToOtherProject`, as
  `TaskService.moveToProject` does.
- A fifth mix `move`: the task intents plus `moveTask` (weight 4). Two extra
  projects are created in setup **only for this mix**.
- The ledger records `task.projectId`. One new oracle: every top-level task is
  listed in its own project's `taskIds` or `backlogTaskIds`, once, and in no
  other project.

Results on the 150-seed report (227 s):

| Measure                                                                                  | Result                                            |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Baseline seeds identical to the unmodified run (steps hash, signatures, final values)    | **120 of 120**                                    |
| `move` seeds with any signature                                                          | **30 of 30**                                      |
| `move` seeds with a signature that needs the new intent or oracle                        | 22                                                |
| – `task.projectId` differs between devices                                               | 4                                                 |
| – a task that no project lists (`unlisted-in-own-project`)                               | 2                                                 |
| – dev error "Missing task data for project"                                              | 4 (1 more after restart)                          |
| – an automatic REPAIR (`full-state-op:REPAIR`)                                           | 3; one of these seeds also has `lost-entity:task` |
| – `older-write-won:task.projectId` / `field-reverted` / `field-unwritten` on `projectId` | 9 / 6 / 3                                         |
| `move` seeds with `time-loss:task`                                                       | 26 (the `tasks` mix: 8 of 30, measured)           |

Read with care:

- **Nothing is triaged.** A signature is not a bug. The ledger was not taught
  what `moveToOtherProject` is, so the three `projectId` preservation rows may
  be oracle model gaps (a move may resolve as a whole-entity side). The
  divergence, unlisted-task, dev-error, REPAIR and lost-entity rows come from
  oracles that need no model, so they are the ones to read first.
- Sample details: seed 20725002 ends with `t1.projectId` `p1` on B and `p2` on
  a fresh device; seed 20725006 ends with `t13` in INBOX on C and listed
  nowhere; seed 20725014 ends with a REPAIR and task `t11` gone though it was
  never deleted; seed 20725000 tracked 3000 ms and converged on 2000.
- All 30 `move` seeds show some signature. That says little, because 91 of the
  120 baseline seeds do too; the 22 are the figure to read.
- Released status, rule 15 standing and a real-app reproduction are all open.
  By the fix-intake rule these become issues with their seeds, not PRs.
- What the spike shows for this note: the estimate ("a mix-scoped intent is
  cheap and does not move the baseline") holds, and task moves produce
  signatures in oracles that need no model of a move.

### CI record of the compare job (measured)

GitHub Actions, the 400 most recent completed runs of `e2e-sync-pr.yml`
(2026-11-03 to 2026-11-10):

| Measure                                                | Result                                                   |
| ------------------------------------------------------ | -------------------------------------------------------- |
| Job executed to completion                             | 48 (47 success, 1 failure); 251 skipped                  |
| Duration                                               | min 3.2, median 7.9, max 17.0 minutes; no timeout        |
| The one failure                                        | the PR's own code did not compile; no signature mismatch |
| Failures from infrastructure or setup                  | 0                                                        |
| Same commit run twice with different outcomes          | 0 (3 commits were re-run, all success both times)        |
| Same commit skipped in one run and executed in another | 10 commits                                               |

In this window the job never reported a newly failing seed, so the record
says nothing about how often such a report is wrong.

## Options

### Vocabulary

Rule for every addition, confirmed by the spike: **a new mix, with its own
setup**. A new intent joins no existing mix, its setup entities are created
only for its mix, and the generator draws its extra targets inside its own
`case`. Then existing traces, pins and the 120-seed baseline stay byte-equal,
and a new mix starts its own baseline of 30 seeds.

Costs that apply to the first addition only:

- `tools/sync-fuzz-compare.js` must compare the mixes both revisions know.
  Today it copies the head's profiles into the base, which fails to compile
  once a profile names a new intent (**estimated**, 0.5 day, with a tool test).
- `pathSignature` strips ids by prefix (`t`, `n`, `h`) and `eventSignature`
  also `b`; new id prefixes must be added there.
- A replayed pin carries no mix, so the per-mix setup must follow from the
  steps (as `replaces` does in `runFuzz`), or `move` pins cannot replay.
- The report's `FIELDS` list lacks `projectId`, so "same final values" in the
  compare output says nothing about moves until it is added.

Effort is **estimated** in working days for one PR, including the oracle specs
with deliberately corrupted outcomes that the harness README asks for, and a
first triage of the new mix into classes and pins.

| #   | Addition                                                                                                                                          | Measures                                                                                                                                                                                                                                                                                           | Oracle and ledger change                                                                                                                                                                                     | Effect on pins and baseline                                                                                                                    | Effort |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| V1  | Second project, `moveTask`, mix `move`                                                                                                            | order-and-membership "Missing evidence", last item ("more than one project"); recommendation 4 there (project membership stays stored); the undeclared `project.taskIds` write of a move. Spike: 22 of 30 seeds with a move-specific signature, including an unlisted task and a REPAIR, untriaged | Ledger: `task.projectId`, and how a move resolves (whole-entity or patch) before the `projectId` rows can be trusted. New oracle: project membership follows `task.projectId`. Lists check for every project | None (measured: 120/120 identical). New 30-seed baseline                                                                                       | 2–3    |
| V1b | Task reorder in Today and in a project list (`moveTaskInTodayList` and the project list moves of `work-context-meta.actions.ts`), mix `taskOrder` | order-and-membership "Missing evidence", first item: concurrent explicit reorders, the case that separates option (B) from (C) and (D). The fuzz reorders only notes and habits today. Not spiked                                                                                                  | Ledger: none for content; reorders are order-only. Whether a task reorder can reach the stop is read from the admission sets first. Needs no second project                                                  | None with its own mix                                                                                                                          | 1–2    |
| V2  | Report order apart from membership (`visible:*` beside the stored comparison, which stays)                                                        | Reporting only. O1 and O2 measured continuously instead of by a scratch classifier. Splits the 73 `divergence` seeds into order-only and content, which a gate needs (order-only is not rule 15 harm). It does not decide O4, which is conditional on option (B)                                   | No intent. Commit the classifier of order-and-membership-options ("Reproducing the numbers") as a second signature family. No ledger change                                                                  | Traces unchanged. Adds signatures to every mix, so the PR that adds it shows every affected seed as newly failing once; announce it in that PR | 2      |
| V3  | Habit delete and `setCounterForDate`, mix `habits`                                                                                                | #11474/#11504 class (delete against update, restore); the audit's own next step, a habit reorder against `COUNTER_SET_FOR_DATE`, which still reaches the stop by code reading                                                                                                                      | Ledger: habit delete and existence (the task delete rules apply). Counts stay opaque (decision 6)                                                                                                            | None with its own mix                                                                                                                          | 1–2    |
| V4  | A per-seed split of `field-reverted`/`field-unwritten` by producer                                                                                | protocol-change-options "Missing evidence", third item                                                                                                                                                                                                                                             | Report only: `LedgerEntry.opaque` and the winning side's action type are already known to the runner                                                                                                         | None                                                                                                                                           | 0.5–1  |
| V5  | Regular tag: add, assign (`updateTask(tagIds)`), rename, delete; mix `tags`                                                                       | #11505 class (tag delete against a tag edit); regular `tag.taskIds`, whose membership is derived; O4's "regular tags" part                                                                                                                                                                         | Ledger: `task.tagIds` as a set-valued field (the field oracle compares scalars today), tag existence. Oracle: a deleted tag is in no `task.tagIds`                                                           | None with its own mix                                                                                                                          | 2–3    |
| V6  | Subtasks: add, move between parents, convert, delete or archive a parent                                                                          | `task.subTaskIds` (stored list, child fact `parentId`); parent time derived from children; the audit's live blocked shape `updateTask` with `projectMoveSubTaskIds` (needs V1). The track intent states "there are no subtasks"                                                                    | Largest ledger change: parent totals, cascade on delete and archive, existence of children. `deleteTask` must send real `subTasks`                                                                           | None with its own mix. The existing `deleteTask` and `archiveTask` code paths must keep their behaviour for tasks without children             | 3–5    |
| V7  | Sections: add, rename, collapse, order, add task to section, cross-section move                                                                   | #11141/#11014 class; the audit's remaining section stops (`isExpanded` against order, title against a cross-section move); `section.taskIds` has no child fact                                                                                                                                     | Ledger: section fields; membership is stored only, so the oracle is "a task is in at most one section of its project". Needs project tasks, better after V1                                                  | None with its own mix                                                                                                                          | 3      |
| V8  | Planner and scheduling: `dueWithTime`, plan for another day, planner day order                                                                    | `planner.days`, a singleton entity (PLANNER); crossings with `planTasksForToday`                                                                                                                                                                                                                   | Ledger: `dueWithTime` (already a written field), a singleton's whole-entity semantics. The harness clock never crosses midnight, so day change stays out                                                     | None with its own mix                                                                                                                          | 3–4    |
| V9  | Repeat configs                                                                                                                                    | #10958 class                                                                                                                                                                                                                                                                                       | Instance generation is effect- and date-driven; the harness registers no feature effect and fixes the day                                                                                                    | —                                                                                                                                              | 5+     |
| V10 | Boards, issue providers, deleting a project                                                                                                       | #10294 class; board order is derived                                                                                                                                                                                                                                                               | Small each, but no open decision or tracked loss class waits on them. Project delete is a large cascade                                                                                                      | —                                                                                                                                              | 1–4    |
| V11 | Feature effects (TODAY repair effects and others)                                                                                                 | order-and-membership "Missing evidence", third item                                                                                                                                                                                                                                                | Effects are selector-driven and asynchronous; they threaten the determinism measured above, and the shared-field check of the harness                                                                        | Likely changes existing traces                                                                                                                 | 5+     |

### A file-provider port

**The seam exists.** `FileBasedSyncAdapterService.createAdapter(provider, cfg,
key)` returns an `OperationSyncCapable<'fileSnapshotOps'>`.
`FakeSuperSyncClient` implements the same base interface in the other provider
mode (`'superSyncOps'`), and `FuzzDevice.client` is typed as the concrete
fake. `MockFileProvider`
(`src/app/op-log/testing/integration/helpers/mock-file-provider.helper.ts`)
is an in-memory `FileSyncProvider` that enforces `revToMatch`. The `FileAdapter`
port in `packages/sync-providers/src/file-adapter.ts` is one level lower: it is
the disk interface of `LocalFileSyncBase`, which checks the revision by
reading before writing ("best-effort", its own comment). A harness that runs
one device at a time makes that read-then-write atomic, so it behaves like
compare-and-swap there. The variant without compare-and-swap is therefore
`MockFileProvider` with the check switched off, driven by a stale-writer step.

**What the port needs** (all **estimated**, from reading):

| Work                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Days |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| A remote interface for the runner. It reads `harness.server` directly for `latestSeq` (settle), `rows` (`lastReplacement`, the dump) and `rejections` (pins); the actions call `device.client.setLastServerSeq`; `FuzzDevice.client` is typed as the fake                                                                                                                                                                                                                                                                       | 1–2  |
| Per-device adapter state. The service is a root singleton with 13 in-memory fields and one `localStorage` state key (plus three legacy keys it migrates once). Use one instance per device as the two existing specs do, swap the key in `as()`, and make a restart a new instance that reloads it. The harness's unlisted-field check will name anything missed                                                                                                                                                                | 1–2  |
| File-mode error mapping and dialog answers in the harness's `_syncBody`. Snapshot hydration, the first-sync decision and keep-pending (#10972) are inside `OperationLogSyncService`, the gap re-download inside the download service, and REPAIR_STALE inside the upload service, all below the calls the harness already makes. Missing are the catches `SyncWrapperService` has for `LocalDataConflictError`, `OwnUploadsMissingConflictError` (#10916) and `UploadRevToMatchMismatchAPIError`, and an answer for each dialog | 1–2  |
| Format and provider variants: `isUseSplitSyncFiles` through the real config slice (v2, v3), CAS on and off                                                                                                                                                                                                                                                                                                                                                                                                                      | 1    |
| Two new step events, without which the variants cannot differ: a sync split into download and upload so another device can write in between, and a stale write by an outside writer (a folder-sync tool, a server that ignores `If-Match`)                                                                                                                                                                                                                                                                                      | 2    |
| Oracle changes: `isKeptBy` reads replacements from server rows; in file mode they come from the snapshot and the devices' logs. The 30 s cycle cache needs a clock rule                                                                                                                                                                                                                                                                                                                                                         | 1–2  |
| Own baseline and pins. The 60 pins assert SuperSync outcomes including server rejections, so they do not transfer. Triage of the first file baseline                                                                                                                                                                                                                                                                                                                                                                            | 2–3  |
| **Total**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 9–14 |

Runtime: one variant costs about what the SuperSync report costs (194 s
measured for 120 seeds). Four variants on all four mixes would be about 13
minutes per revision and 26 for a comparison (**estimated**); one mix per
variant brings it back to about 3.5.

**Would it have caught the fixes?** Eight of the 19 commits, chosen to span
the kinds of cause (replacement detection, upload baseline, an outside writer,
buffer caps, REPAIR, provider HTTP) and not at random. Judged from their
messages, tests and the code (**estimated**; none was replayed):

| Fix                                                                | What it needed                                                                                                                                                                                      | Plain port (atomic sync, CAS, 30 steps)                        | With the two step events                                                                                     |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| #10249 masked "Keep local" replacement (`592dacea`)                | a replacement, then a tail op from the same device. Its other parts (an upload onto an unseen replacement after a skipped download, the WebDAV ETag pre-check) need a split sync or a real provider | Partly: the `replace` mix and `k: 'L'` reach the headline case | Partly                                                                                                       |
| #10459 v2 upload over an unapplied snapshot-only file (`cd2757b9`) | a seed written between a device's **first, empty** download and its upload                                                                                                                          | No: a sync is atomic                                           | No without a setup change: in the fuzz setup A seeds the remote and every device joins before the first step |
| #10497 applied baseline before v3 uploads (`df22e55d`)             | an upload without an applied download on v3, after the cycle cache expired (the commit has no body; read from its diff)                                                                             | No                                                             | Possible                                                                                                     |
| #10916 remote lost own uploads (`5f12e9ee`, PR #11115)             | another writer replacing the file from a stale copy                                                                                                                                                 | No                                                             | Likely, as `lost-entity` or `field-reverted`                                                                 |
| #10973 trim inside a batch (`0278b1e5`, PR #10984)                 | more than `MAX_RECENT_OPS` (2000) remote ops for a lagging device                                                                                                                                   | No                                                             | No: the caps are package constants with no test seam                                                         |
| #10972 keep pending on a catch-up snapshot (`17c6227b`)            | the same cap; and the harm was an unnecessary dialog, which the oracles see only as a stop answer                                                                                                   | No                                                             | No                                                                                                           |
| #11483 stale pending REPAIR (`aa4f7547`, PR #11488)                | a REPAIR whose upload fails, then a download. The spike shows REPAIRs occur with task moves                                                                                                         | No: no upload fails                                            | Possible: a writer between the download and the upload fails the upload by revision mismatch                 |
| #10495 OneDrive write without an ETag (`dd28cb02`)                 | the provider's HTTP conditional write                                                                                                                                                               | No: the in-memory provider replaces that code                  | No                                                                                                           |

The plain port reaches part of one of the eight. With the two events one more
is likely and two are possible; a late-joining device in setup would add a
fourth. The sample is small and hand-picked, so these are not rates. The split
sync is what the existing randomized spec already has for its id-set model,
and #10916 has a dedicated E2E. The cap-bound and provider-bound fixes stay
out of reach.

A cheaper alternative, **F2**: keep the existing spec and give it content.
Replace its add-only id set with a small entity (two fields, delete) and add
the stale-writer event. It keeps the hand-written client mirror, so it
measures the adapter and not resolution, but it costs 2–3 days (**estimated**)
and already runs in the Unit Tests job.

### Gating

What a required "Sync Fuzz Compare" would block, and how often wrongly:

- **Flakiness: none found.** Locally, two runs agreed on 120 of 120 seeds
  (measured). In CI, 48 executions in seven days had no infrastructure failure
  and no differing outcome on a re-run commit (measured). The harness seeds
  its random source and its clock.
- **Runtime: acceptable.** Median 7.9 minutes, maximum 17.0 in CI (measured),
  against a 40-minute timeout. Each new 30-seed mix adds about a quarter of
  the fuzz time (**estimated** from 227 s for 150 seeds against 194 s for 120).
- **False positives: structural, and unmeasured in CI.** A fix changes what an
  op does, so later steps of the same seed act on a different state, and the
  seed can show a signature the base did not show without being worse. The
  tool's own text says so: a new entry "is a regression until its original
  seed shows otherwise" and must be judged by its executed steps and final
  values. Two merged, intended fixes carried accepted new entries: #10448 (7
  seeds) and #10443 (11 entries on 7 seeds), which is criterion (B) of
  protocol-change-options. A hard gate would have blocked both. In the
  seven-day CI window no run reported a new entry at all.
- **The gate cannot see most of the baseline.** 73 of 91 failing seeds carry
  `divergence`, and index-by-index list comparison makes any order change a
  possible new signature. Until order is reported apart (V2), a new entry is
  as likely an order shuffle as a loss.
- **A skipped required check must still report.** The job is skipped when no
  client sync file changed, and ten commits were skipped in one run and
  executed in another (measured; probably a moved PR base, not examined). A
  required check needs an always-running gate job, as "SuperSync E2E Gate"
  has.

The options: (G0) informational, as today; (G1) required, with an override
only the maintainer can set (a label; a block in the PR body would be
editable by the author, which rule 16 excludes); (G2) required with no override.

### Comparison

| Option                                     | Decision value                                                                                             | Effort (estimated) | Risk                                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------- |
| V1 task move                               | High: multi-project lists are unmeasured, and the spike shows signatures in model-free oracles (untriaged) | 2–3 d (+0.5 tool)  | Low: baseline measured unchanged                                              |
| V1b task reorder                           | High for the order-merge design (O2), which defaults to "build nothing"; so no fix waits on it             | 1–2 d              | Low; not spiked                                                               |
| V2 order apart from membership             | High: a precondition for any gate                                                                          | 2 d                | Low; one noisy compare                                                        |
| V3 habit delete                            | Medium to high: the cheapest intent; the audit's named next step and two fresh fixes                       | 1–2 d              | Low                                                                           |
| V4 split by producer                       | Medium: closes a "missing evidence" line                                                                   | 0.5–1 d            | None                                                                          |
| V5 tags, V6 subtasks, V7 sections          | Medium: each covers a fixed class and audited stops; no open decision waits on them                        | 2–5 d each         | Ledger complexity grows with each; V6 most                                    |
| V8–V11                                     | Low now                                                                                                    | 3–5+ d each        | V9 and V11 threaten determinism                                               |
| File port, plain                           | Low: part of 1 of 8 sampled fixes                                                                          | 7–12 d             | A second sync-body mirror to maintain                                         |
| File port with split sync and stale writer | Medium: 1 likely and 2 possible of 8; the only way to measure "two file resolvers of one crossing"         | 9–14 d             | Same, plus a second baseline and pin set                                      |
| F2 content in the existing file spec       | Medium for the adapter, none for resolution                                                                | 2–3 d              | Keeps the hand-written client                                                 |
| G0 informational                           | —                                                                                                          | 0                  | A regression merges if nobody reads the job (it caught two by hand in #10398) |
| G1 required with maintainer override       | Stops unread regressions                                                                                   | 1 d                | Every intended behaviour change needs the override; rate unknown              |
| G2 required, no override                   | —                                                                                                          | 0.5 d              | Blocks intended fixes (two known cases)                                       |

## Recommendation

1. **Build V1 first, as one PR** (the first slice below). It is the one
   addition with a spike behind it: the baseline stayed unchanged, and oracles
   that need no model of a move reported an unlisted task, a REPAIR and a lost
   task. Those are untriaged; finding out what they are is the point.
2. **Then V1b and V3**, the two cheapest intents. V1b gives the order-merge
   design its missing number. Because O2's default is to build nothing, it
   informs a decision and not a fix, which is why it follows V1. V3 is the
   audit's own next step.
3. **Then V2 and V4.** They add no intent and change no trace. V2 makes the
   baseline readable (order apart from loss) and is the precondition for a
   gate; V4 closes an evidence gap for decision 6. V5–V7 only when a fix or a
   decision in that area is next in the queue. The reason to add vocabulary is
   a pending decision or a class that produced fixes; "18 entity types, 3
   covered" is not a target.
4. **Do not port to the file adapter now.** The plain port reaches part of
   one of eight sampled fixes; the useful port is 9–14 days and adds a second
   sync-body mirror, baseline and pin set. Revisit it when an apply-time change
   for file providers is actually planned (D7), because "two file resolvers of
   one crossing" can be measured no other way. Until then, F2 is the better
   price if a file fix needs a wider net.
5. **Gate in two steps.** Keep the pins in the Unit Tests job. Leave the
   compare job informational until V2 has merged and at least ten new entries
   have been judged and recorded in PRs, so a false-positive rate exists; then
   make it required with a maintainer label as override (G1). Do not
   choose G2.
6. **Treat the spike's findings by the fix-intake rule.** File the
   task-move seeds as issues with their traces once V1 can replay them; a fix
   needs a real-app reproduction and its rule 15 category first.

### First slice (one PR, estimated 2.5–3.5 days)

- `sync-fuzz-actions.ts`: intents `addProject` and `moveTask`; the move draws
  its target project inside its own `case`. A `MOVE_WEIGHTS` mix and its setup
  intents.
- `sync-fuzz-runner.ts`: per-mix setup; `task.projectId` in the ledger with
  the resolution shape of a move decided from the code, not assumed; the
  project-membership oracle; the duplicate-list check for every project.
- `sync-fuzz-profiles.ts`: the `move` mix. `tools/sync-fuzz-compare.js`:
  compare only the mixes both revisions know (the `move` mix is then not
  compared in its first PR), with a test in
  `tools/sync-fuzz-compare.test.js`.
- Specs: corrupted real outcomes for the new oracle (a task removed from its
  project list, a task listed twice), as the README requires.
- Proof in the PR: the 120 baseline seeds identical on steps hash, signatures
  and final values (expected from the spike); the 30 `move` seeds classified;
  pins added only for traces that fail 3 of 3 replays.
- Also: per-mix setup derived from a trace's steps, so pins replay; and
  `projectId` in the report's `FIELDS`.
- Not in the slice: any fix, task reorder (V1b), subtasks, backlog moves, a
  move concurrent with a project delete.

### First slice: result (measured, 2026-11-10)

Implemented as described above. The 150-seed report on the slice:

| Measure                                                                               | Result         |
| ------------------------------------------------------------------------------------- | -------------- |
| Baseline seeds identical to master (steps hash, signatures, final values)             | **120 of 120** |
| `move` seeds with any signature                                                       | 30 of 30       |
| `move` seeds with a move-specific signature                                           | 21             |
| – of these, from oracles that need no ledger (divergence, membership, REPAIR, errors) | 11             |
| Focused suite (`sync-fuzz/*.spec.ts`)                                                 | 151 of 151     |

The ledger now treats a move as a whole-entity side, because
`moveToOtherProject` carries the flat pre-move task (`isChangesShapedOp` in
`conflict-field-patch.util.ts`). That removed 12 of the spike's 21
`older-write-won` seeds in the mix as model gaps; 9 remain.

Every class shrank to a trace that fails 3 of 3 replays, and each is pinned as
current behaviour (class names as in `sync-fuzz-pinned-traces.json`):

| Class                  | Minimal trace (devices A, B, C; settle syncs all)                        | Outcome                                                                                           |
| ---------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `move-loses-to-edit`   | C moves `t2` to `p2`; A renames `t2`                                     | The move is undone on every device but C, which keeps `p2`: `projectId` and project lists diverge |
| `move-loses-to-edit`   | B moves `t1` to `p1`; C tracks `t1`                                      | The move is undone everywhere (converged)                                                         |
| `move-drops-time`      | C tracks 1 s on `t2`; B moves `t2`                                       | The time is 0 on every device but C, which keeps it: `timeSpent` diverges                         |
| `move-crossing-repair` | B moves `t1`; A tracks `t1`; B deletes `t1`                              | Dev error "Missing task data for project" and an automatic REPAIR                                 |
| `move-crossing-repair` | 8 steps: two moves of `t2` crossing two deletes and a track, then an add | REPAIR, and task `t11`, added afterwards and never deleted, is gone                               |
| `concurrent-moves`     | C moves `t3` to `p2`; B moves `t3` to `p1`; A edits its notes            | The task stays in INBOX: neither move survives                                                    |
| `concurrent-moves`     | 5 steps: two moves of `t1` beside time deltas and a notes edit           | The older move wins, the newer mover keeps its own project, and 1 s of time is lost               |
| `unlisted-task`        | 8 steps: a delete-versus-delta crossing on `t1`, a move of `t2`, an add  | On the adding device the new task is in no project list. It may not need the move (see below)     |

These are harness outcomes on the fake SuperSync server. By M4 they become
issues after the slice merges, each needing a real-app reproduction and its
rule 15 category before any fix. Read from the traces, not verified further:
the first three rows are a whole-entity winner whose snapshot predates the
move or the time; `unlisted-task` resembles the tracked delete-versus-delta
recreate (#10380/#10381), and only the new oracle makes it visible.

### Phases

| Phase                   | Content                                             | Effort (estimated) | Exit                                                                       |
| ----------------------- | --------------------------------------------------- | ------------------ | -------------------------------------------------------------------------- |
| 1 (done on this branch) | V1, the first slice                                 | 2.5–3.5 d          | `move` baseline recorded; issues filed for its content classes             |
| 2                       | V1b and V3                                          | 2–4 d              | Two more baselines; the task-reorder number posted to the order-merge note |
| 3                       | V2 and V4                                           | 2.5–3 d            | Baseline split into order-only and content; producer split posted          |
| 4                       | G1, if M3 says so                                   | 1 d                | Required gate job with a label override, after ten judged new entries      |
| 5                       | V5, V6, V7 on demand                                | 2–5 d each         | One mix and one baseline per addition                                      |
| 6                       | File port with both step events, only if M2 changes | 9–14 d             | A v2 and a v3 baseline; the sampled rows above replayed                    |

### What not to model

- The UI, feature effects, snacks and dialogs beyond the two already
  answered. E2E owns them.
- Real HTTP providers (Dropbox, OneDrive, WebDAV quirks such as ETags behind
  `mod_deflate`), encryption and compression. Provider unit specs and the
  provider E2E suites own them.
- Released client bundles in a mixed fleet. The E2E runs against the released
  bundle do that; the fleet floor belongs to a sibling evaluation.
- The 2000-op buffer caps, unless a test seam for them is wanted for its own
  reason.
- Day change, time zones and start-of-day offsets (the harness clock is fixed
  at noon on purpose).
- Plugins, GLOBAL_CONFIG, METRIC, REMINDER, MENU_TREE, PLUGIN_USER_DATA and
  PLUGIN_METADATA.
- More than three devices, or traces longer than 30 steps, as a default.
- A conflict-policy table or version checkpoints: sibling sessions evaluate
  those.

## Decisions

@johannesjo answered the recommendation on 2026-11-10 in the evaluation
session: "Do as recommend". Each row below is therefore decided as its
default.

| #   | Question                                                  | Default                                                                                                                                                           |
| --- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Extend the vocabulary, starting with the task-move slice? | Yes: V1 as one PR, then V1b and V3, then V2 and V4. Further mixes only when a fix or decision in their area is next                                               |
| M2  | Port the harness to the file adapter?                     | Not now. Revisit when a file-format or apply-time change is planned (D7). If a wider file net is wanted earlier, give the existing randomized spec content (F2)   |
| M3  | Should a newly failing seed block a sync PR?              | Not yet. After V2 and ten judged new entries, make the job required with a maintainer-only label as override (G1). Never without an override                      |
| M4  | What happens to the spike's task-move signatures?         | Issues with traces after V1 merges; no fix without a real-app reproduction and a rule 15 category. They do not count against the five-PR limit until they are PRs |
| M5  | May a new mix go uncompared in the PR that adds it?       | Yes: the base has no such mix. The PR states the new mix's signatures instead, and the V2 PR may show its new signature family as new entries once                |

## Review

One fresh-context subagent read the draft and tried to refute its claims
against the code, without the session's reasoning. It confirmed the harness
wiring, the generator's draw order, the compare tool's shared files, the pin
counts, the description of the existing randomized file spec, the commit
counts and the gating citations. What changed after it:

- **Vocabulary ranking.** The order-merge note's "task moves" are reorders
  within a list, not moves between projects. V1 no longer claims that line;
  V1b (task reorder) was added, and V3 moved ahead of V2 and V4.
- **V2 and O4.** V2 is reporting only and does not decide O4.
- **Spike wording.** The lead figure is 22 of 30, not 30 of 30, and
  "content-level signatures in a default-settings flow" was removed.
- **File port.** The "file-mode `_syncBody`" item fell from 3–4 days to 1–2:
  the listed behaviours live below the calls the harness already makes. The
  total fell from 11–16 to 9–14 days. `LocalFileSyncBase` was dropped as the
  variant without compare-and-swap. "Same interface" became "same base
  interface, other provider mode".
- **Sampled fixes.** #10459 flipped from likely to no (the fuzz setup has no
  empty first download), #11483 from no to possible, #10497 and #10249 were
  weakened, and the "1 of 8, 4 of 8" tallies were replaced by a statement
  that the sample is hand-picked.
- **Counts.** Provider-package-only fix commits: two, not three.
- **Gating.** "They gate today" became "run in the Unit Tests job"; the
  override is a label only; "30 days" became "ten judged new entries".
- **First slice.** Added pin replay of per-mix setup, `projectId` in the
  report's `FIELDS`, and the benchmark's exposure in the compare tool. M5 was
  reworded: a new mix is not compared in its first PR.

Not changed: the reviewer could not repeat the spike or the CI statistics and
took them as given.

## Missing evidence

- Whether the pinned `move` classes occur in the app: each trace fails 3 of 3
  replays in the harness, but none was reproduced with an E2E, on a file
  provider, or against a released client.
- Whether `unlisted-task` needs a move at all. The membership oracle runs only
  in runs that move tasks, and the shrink kept a move for that reason.
- The mechanism behind each class was read from its trace, not from an op-log
  dump.
- The false-positive rate of the compare job: no CI run in the window
  reported a new entry, and history before 2026-11-03 was not examined.
- Why ten commits had the compare job skipped in one run and executed in
  another.
- V1b has no spike: its effort and whether a task reorder reaches the stop
  are from reading.
- The eight file-fix judgements are from reading. None was replayed against a
  port, because no port exists.
- File-port effort has no spike behind it. Its items were sized from
  reading, not from an attempt.
- Runtime of the compare job after several new mixes, on CI hardware.
