# Sync model-based testing: what to add to the fuzz harness, and whether to gate on it

> **Status: Proposed.** Evaluation only. No production code, workflow or
> harness file changes with this note.
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
not committed) left all 120 baseline seeds unchanged and showed a failure
signature in 30 of 30 new seeds, among them a task that no project lists, a
task missing after an automatic REPAIR, and tracked time lost. None of these is
triaged. Do not port the harness to the file adapter yet: the port only pays
with two additions (split download and upload, and a stale writer), and a
randomized file check already gates today. Do not make "a newly failing seed"
a required check yet: the tool is deterministic, but by its own contract a new
entry needs a human judgement, and two merged fixes were accepted with new
entries.

Every figure below is marked **measured** (run or counted for this note) or
**estimated** (from reading code and commit messages). Paths are relative to
the repository root; `sync-fuzz/` stands for
`src/app/op-log/testing/integration/sync-fuzz/`.

## What was read and measured

### The harness as it is

| Fact                                                                                                                                                                                                                              | Source                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 16 intents plus 3 state replacements; a trace is a JSON list of steps                                                                                                                                                             | `sync-fuzz/sync-fuzz-actions.ts`, the `Intent` union                      |
| Entities touched: TASK, NOTE, SIMPLE_COUNTER (plus TIME_TRACKING through the track intent) of 18 registered types                                                                                                                 | `src/app/op-log/core/entity-registry.ts`                                  |
| One project (`INBOX_PROJECT`) and Today; no subtask, regular tag, section, planner day, repeat config, board or issue provider                                                                                                    | `SETUP_INTENTS`, `viewOf` in `sync-fuzz-actions.ts`                       |
| Every synced feature reducer and the registered meta-reducers are already in the test module, so a new intent needs no harness wiring                                                                                             | `sync-fuzz/sync-fuzz-harness.ts`, `_configure`                            |
| No feature effect is registered; only `OperationLogEffects` and `ArchiveOperationHandlerEffects`                                                                                                                                  | same file, the class comment ("Known gaps")                               |
| A device's transport is one `OperationSyncCapable` object (`device.client`); `_syncBody` calls `downloadRemoteOps`, `uploadPendingOps` and the bounded re-upload on it                                                            | `sync-fuzz-harness.ts`, `sync` and `_syncBody`                            |
| Three devices plus a fresh observer; a sync is atomic (download, upload, re-upload in one step)                                                                                                                                   | `sync-fuzz/sync-fuzz-runner.ts`, `runFuzz`                                |
| Oracles: sync events (stops, errors), nothing pending, no unexplained full-state op, Today notes, convergence with a fresh device, preservation (ledger), restart                                                                 | `runFuzz`, `checkPreservation`, `checkLatestWrite`                        |
| `diffPaths` compares arrays index by index, so order and membership share one signature                                                                                                                                           | `sync-fuzz-runner.ts`, `diffPaths`                                        |
| The generator draws one task, one note and one habit before it looks at the intent kind. A new intent must draw its extra targets inside its own `case`, or every existing trace changes                                          | `generateIntent` in `sync-fuzz-actions.ts`                                |
| 60 pinned traces, 2 to 8 steps each; 17 carry failure signatures (known bugs or kept-by-design outcomes), 43 are regression or coverage pins. They run in the normal unit test job, so they gate today (**measured**, counted)    | `sync-fuzz/sync-fuzz-pinned-traces.json`, `sync-fuzz-pinned…spec.ts`      |
| `sync-fuzz:compare` copies the head's report benchmark and `sync-fuzz-profiles.ts` into the base worktree. A profile that names an intent the base's `Intent` union lacks will not compile there (**estimated**, from the script) | `tools/sync-fuzz-compare.js`, `SHARED_FILES`                              |
| The CI job "Sync Fuzz Compare" runs only when client sync code changed and is in no gate                                                                                                                                          | `.github/workflows/e2e-sync-pr.yml`                                       |
| The fake server is checked against the real one                                                                                                                                                                                   | `packages/super-sync-server/tests/sync-fuzz-server-parity.pglite.spec.ts` |

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
  its re-land (#11171), so 18 without the revert. Three more `fix` commits
  touch only the provider package (`packages/sync-providers/src/file-based`).

### The file adapter already has a randomized check (measured, read)

"No model-based test" needs a qualification.
`src/app/op-log/testing/integration/file-based-sync/replacement-convergence.integration.spec.ts`
(#9170) runs 40 seeds × 40 steps in four variants (v2 and v3 × encryption on
and off) against the real `FileBasedSyncAdapterService` and a shared
`MockFileProvider`. It splits download and upload, expires the cycle cache,
restarts, and answers "Keep local". It runs in the normal test job: 160 seeded
cases gate today. Commit `cd2757b9` (#10459) cites a 200-seed run of it.

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
- Released status, rule 15 standing and a real-app reproduction are all open.
  By the fix-intake rule these become issues with their seeds, not PRs.
- What the spike shows for this note: the estimate ("a mix-scoped intent is
  cheap and does not move the baseline") holds, and task moves are not a quiet
  area.

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

Two costs apply to the first addition only:

- `tools/sync-fuzz-compare.js` must compare the mixes both revisions know.
  Today it copies the head's profiles into the base, which fails to compile
  once a profile names a new intent (**estimated**, 0.5 day, with a tool test).
- `pathSignature` and `eventSignature` strip ids by prefix (`t`, `n`, `h`,
  `b`); new id prefixes must be added there.

Effort is **estimated** in working days for one PR, including the oracle specs
with deliberately corrupted outcomes that the harness README asks for, and a
first triage of the new mix into classes and pins.

| #   | Addition                                                                        | Measures                                                                                                                                                                                                                                        | Oracle and ledger change                                                                                                                                                                                     | Effect on pins and baseline                                                                                                                    | Effort |
| --- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| V1  | Second project, `moveTask`, mix `move`                                          | order-and-membership "Missing evidence": concurrent explicit task moves, the case that separates options (B) and (C)/(D); recommendation 4 there (project membership stays stored). Spike: 30/30 seeds, including an unlisted task and a REPAIR | Ledger: `task.projectId`, and how a move resolves (whole-entity or patch) before the `projectId` rows can be trusted. New oracle: project membership follows `task.projectId`. Lists check for every project | None (measured: 120/120 identical). New 30-seed baseline                                                                                       | 2–3    |
| V2  | Report order apart from membership (`visible:*` beside the stored comparison)   | O4 directly; O1 and O2 continuously instead of by a scratch classifier. Splits the 73 `divergence` seeds into order-only and content, which a gate needs (order-only is not rule 15 harm)                                                       | No intent. Commit the classifier of order-and-membership-options ("Reproducing the numbers") as a second signature family. No ledger change                                                                  | Traces unchanged. Adds signatures to every mix, so the PR that adds it shows every affected seed as newly failing once; announce it in that PR | 2      |
| V3  | Habit delete and `setCounterForDate`, mix `habits`                              | #11474/#11504 class (delete against update, restore); the audit's "recommended investigation", a habit reorder against `COUNTER_SET_FOR_DATE`, which still reaches the stop by code reading                                                     | Ledger: habit delete and existence (the task delete rules apply). Counts stay opaque (decision 6)                                                                                                            | None with its own mix                                                                                                                          | 1–2    |
| V4  | A per-seed split of `field-reverted`/`field-unwritten` by producer              | protocol-change-options "Missing evidence", third item                                                                                                                                                                                          | Report only: `LedgerEntry.opaque` and the winning side's action type are already known to the runner                                                                                                         | None                                                                                                                                           | 0.5–1  |
| V5  | Regular tag: add, assign (`updateTask(tagIds)`), rename, delete; mix `tags`     | #11505 class (tag delete against a tag edit); regular `tag.taskIds`, whose membership is derived; O4's "regular tags" part                                                                                                                      | Ledger: `task.tagIds` as a set-valued field (the field oracle compares scalars today), tag existence. Oracle: a deleted tag is in no `task.tagIds`                                                           | None with its own mix                                                                                                                          | 2–3    |
| V6  | Subtasks: add, move between parents, convert, delete or archive a parent        | `task.subTaskIds` (stored list, child fact `parentId`); parent time derived from children; the audit's live blocked shape `updateTask` with `projectMoveSubTaskIds` (needs V1). The track intent states "there are no subtasks"                 | Largest ledger change: parent totals, cascade on delete and archive, existence of children. `deleteTask` must send real `subTasks`                                                                           | None with its own mix. The existing `deleteTask` and `archiveTask` code paths must keep their behaviour for tasks without children             | 3–5    |
| V7  | Sections: add, rename, collapse, order, add task to section, cross-section move | #11141/#11014 class; the audit's remaining section stops (`isExpanded` against order, title against a cross-section move); `section.taskIds` has no child fact                                                                                  | Ledger: section fields; membership is stored only, so the oracle is "a task is in at most one section of its project". Needs project tasks, better after V1                                                  | None with its own mix                                                                                                                          | 3      |
| V8  | Planner and scheduling: `dueWithTime`, plan for another day, planner day order  | `planner.days`, a singleton entity (PLANNER); crossings with `planTasksForToday`                                                                                                                                                                | Ledger: `dueWithTime` (already a written field), a singleton's whole-entity semantics. The harness clock never crosses midnight, so day change stays out                                                     | None with its own mix                                                                                                                          | 3–4    |
| V9  | Repeat configs                                                                  | #10958 class                                                                                                                                                                                                                                    | Instance generation is effect- and date-driven; the harness registers no feature effect and fixes the day                                                                                                    | —                                                                                                                                              | 5+     |
| V10 | Boards, issue providers, deleting a project                                     | #10294 class; board order is derived                                                                                                                                                                                                            | Small each, but no open decision or tracked loss class waits on them. Project delete is a large cascade                                                                                                      | —                                                                                                                                              | 1–4    |
| V11 | Feature effects (TODAY repair effects and others)                               | order-and-membership "Missing evidence", third item                                                                                                                                                                                             | Effects are selector-driven and asynchronous; they threaten the determinism measured above, and the shared-field check of the harness                                                                        | Likely changes existing traces                                                                                                                 | 5+     |

### A file-provider port

**The seam exists.** `FileBasedSyncAdapterService.createAdapter(provider, cfg,
key)` returns an `OperationSyncCapable<'fileSnapshotOps'>`, the same interface
as `FakeSuperSyncClient`. `MockFileProvider`
(`src/app/op-log/testing/integration/helpers/mock-file-provider.helper.ts`)
is an in-memory `FileSyncProvider` that enforces `revToMatch`. The `FileAdapter`
port in `packages/sync-providers/src/file-adapter.ts` is one level lower: it is
the disk interface of `LocalFileSyncBase`, which checks the revision by
reading before writing ("best-effort", its own comment). A variant without
compare-and-swap is therefore `LocalFileSyncBase` over an in-memory
`FileAdapter`, or `MockFileProvider` with the check switched off.

**What the port needs** (all **estimated**, from reading):

| Work                                                                                                                                                                                                                                                                                                                                                 | Days  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| A remote interface for the runner. It reads `harness.server` directly for `latestSeq` (settle), `rows` (`lastReplacement`, the dump) and `rejections` (pins); the actions call `device.client.setLastServerSeq`                                                                                                                                      | 1–2   |
| Per-device adapter state. The service is a root singleton with 13 in-memory fields and one global `localStorage` key. Use one instance per device as the two existing specs do, swap the `localStorage` key in `as()`, and make a restart a new instance that reloads it. The harness's unlisted-field check will name anything missed               | 1–2   |
| A file-mode `_syncBody`. The harness copies `SyncWrapperService._syncBody` for SuperSync. File mode adds snapshot hydration, the gap re-download, the first-sync decision, the keep-pending path (#10972), the own-uploads-missing dialog (#10916) and REPAIR_STALE. This is the largest item and the main risk: it is again a mirror of the wrapper | 3–4   |
| Format and provider variants: `isUseSplitSyncFiles` through the real config slice (v2, v3), CAS on and off                                                                                                                                                                                                                                           | 1     |
| Two new step events, without which the variants cannot differ: a sync split into download and upload so another device can write in between, and a stale write by an outside writer (a folder-sync tool, a server that ignores `If-Match`)                                                                                                           | 2     |
| Oracle changes: `isKeptBy` reads replacements from server rows; in file mode they come from the snapshot and the devices' logs. The 30 s cycle cache needs a clock rule                                                                                                                                                                              | 1–2   |
| Own baseline and pins. The 60 pins assert SuperSync outcomes including server rejections, so they do not transfer. Triage of the first file baseline                                                                                                                                                                                                 | 2–3   |
| **Total**                                                                                                                                                                                                                                                                                                                                            | 11–16 |

Runtime: one variant costs about what the SuperSync report costs (194 s
measured for 120 seeds). Four variants on all four mixes would be about 13
minutes per revision and 26 for a comparison (**estimated**); one mix per
variant brings it back to about 3.5.

**Would it have caught the fixes?** Eight of the 19 commits, judged from their
messages, tests and the code (**estimated**; none was replayed):

| Fix                                                                | What it needed                                                                                                           | Plain port (atomic sync, CAS, 30 steps)        | With the two step events                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------- |
| #10249 masked "Keep local" replacement (`592dacea`)                | a replacement, then a tail op from the same device                                                                       | Likely: the `replace` mix and `k: 'L'` do this | Likely                                                  |
| #10459 v2 upload over an unapplied snapshot-only file (`cd2757b9`) | a seed written between a device's empty download and its upload                                                          | No: a sync is atomic                           | Likely; the ledger would report the seed's data as lost |
| #10497 applied baseline before v3 uploads (`df22e55d`)             | the same shape on v3                                                                                                     | No                                             | Likely                                                  |
| #10916 remote lost own uploads (`5f12e9ee`, PR #11115)             | another writer replacing the file from a stale copy                                                                      | No                                             | Likely, as `lost-entity` or `field-reverted`            |
| #10973 trim inside a batch (`0278b1e5`, PR #10984)                 | more than `MAX_RECENT_OPS` (2000) remote ops for a lagging device                                                        | No                                             | No: the caps are package constants with no test seam    |
| #10972 keep pending on a catch-up snapshot (`17c6227b`)            | the same cap; and the harm was an unnecessary dialog, which the oracles see only as a stop answer                        | No                                             | No                                                      |
| #11483 stale pending REPAIR (`aa4f7547`, PR #11488)                | a REPAIR whose upload fails, then a download. The spike shows REPAIRs occur with task moves, but no step fails an upload | No                                             | No, without a third event (a failed upload)             |
| #10495 OneDrive write without an ETag (`dd28cb02`)                 | the provider's HTTP conditional write                                                                                    | No: the in-memory provider replaces that code  | No                                                      |

One of eight for the plain port, four of eight with the two events. The two
events are what the existing randomized spec already has for its id-set model
(split phases) or what #10916 added a dedicated E2E for (stale writer). The
cap-bound, provider-bound and failure-bound fixes stay out of reach.

A cheaper alternative, **F2**: keep the existing spec and give it content.
Replace its add-only id set with a small entity (two fields, delete) and add
the stale-writer event. It keeps the hand-written client mirror, so it
measures the adapter and not resolution, but it costs 2–3 days (**estimated**)
and already gates.

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
only the maintainer can set (a label, or an accepted-entries block in the PR
body that the gate job reads); (G2) required with no override.

### Comparison

| Option                                     | Decision value                                                                          | Effort (estimated) | Risk                                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------- |
| V1 task move                               | High: the one number the order merge design lacks; spike shows content-level signatures | 2–3 d (+0.5 tool)  | Low: baseline measured unchanged                                              |
| V2 order apart from membership             | High: O4, and a precondition for any gate                                               | 2 d                | Low; one noisy compare                                                        |
| V3 habit delete                            | Medium: a regression net for two fresh fixes and one audited stop                       | 1–2 d              | Low                                                                           |
| V4 split by producer                       | Medium: closes a "missing evidence" line                                                | 0.5–1 d            | None                                                                          |
| V5 tags, V6 subtasks, V7 sections          | Medium: each covers a fixed class and audited stops; no open decision waits on them     | 2–5 d each         | Ledger complexity grows with each; V6 most                                    |
| V8–V11                                     | Low now                                                                                 | 3–5+ d each        | V9 and V11 threaten determinism                                               |
| File port, plain                           | Low: 1 of 8 sampled fixes                                                               | 9–14 d             | A second mirror of the sync wrapper to maintain                               |
| File port with split sync and stale writer | Medium to high: 4 of 8; the only way to measure "two file resolvers of one crossing"    | 11–16 d            | Same, plus a second baseline and pin set                                      |
| F2 content in the existing file spec       | Medium for the adapter, none for resolution                                             | 2–3 d              | Keeps the hand-written client                                                 |
| G0 informational                           | —                                                                                       | 0                  | A regression merges if nobody reads the job (it caught two by hand in #10398) |
| G1 required with maintainer override       | Stops unread regressions                                                                | 1 d                | Every intended behaviour change needs the override; rate unknown              |
| G2 required, no override                   | —                                                                                       | 0.5 d              | Blocks intended fixes (two known cases)                                       |

## Recommendation

1. **Build V1 first, as one PR** (the first slice below). It is the cheapest
   addition, it answers a question two design notes list as unmeasured, and
   the spike found content-level signatures in a default-settings flow.
2. **Then V2 and V4.** They add no intent and change no trace. V2 makes the
   baseline readable (order apart from loss); V4 closes an evidence gap for
   decision 6.
3. **Then V3**, and V5–V7 only when a fix or a decision in that area is next
   in the queue. The reason to add vocabulary is a pending decision or a class
   that produced fixes; "18 entity types, 3 covered" is not a target.
4. **Do not port to the file adapter now.** The plain port would have caught
   one of eight sampled fixes; the useful port is 11–16 days and adds a second
   wrapper mirror, baseline and pin set. Revisit it when an apply-time change
   for file providers is actually planned (D7), because "two file resolvers of
   one crossing" can be measured no other way. Until then, F2 is the better
   price if a file fix needs a wider net.
5. **Gate in two steps.** Keep the pins as the hard gate they already are.
   Leave the compare job informational until V2 has merged and a record
   exists; then make it required with a maintainer override (G1). Do not
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
  compare only the mixes both revisions know, with a test in
  `tools/sync-fuzz-compare.test.js`.
- Specs: corrupted real outcomes for the new oracle (a task removed from its
  project list, a task listed twice), as the README requires.
- Proof in the PR: the 120 baseline seeds identical on steps hash, signatures
  and final values (expected from the spike); the 30 `move` seeds classified;
  pins added only for traces that fail 3 of 3 replays.
- Not in the slice: any fix, subtasks, backlog moves, a move concurrent with a
  project delete.

### Phases

| Phase | Content                                             | Effort (estimated) | Exit                                                              |
| ----- | --------------------------------------------------- | ------------------ | ----------------------------------------------------------------- |
| 1     | V1, the first slice                                 | 2.5–3.5 d          | `move` baseline recorded; issues filed for its content classes    |
| 2     | V2 and V4                                           | 2.5–3 d            | Baseline split into order-only and content; producer split posted |
| 3     | G1, if M3 says so                                   | 1 d                | Required gate job with override, after 30 days of record          |
| 4     | V3; then V5, V6, V7 on demand                       | 1–5 d each         | One mix and one baseline per addition                             |
| 5     | File port with both step events, only if M2 changes | 11–16 d            | A v2 and a v3 baseline; the four "likely" rows above replayed     |

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

## Decisions needed from @johannesjo

Each has the default this note proposes. None is decided.

| #   | Question                                                                       | Default                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Extend the vocabulary, starting with the task-move slice?                      | Yes: V1 as one PR, then V2 and V4. Further mixes only when a fix or decision in their area is next                                                                |
| M2  | Port the harness to the file adapter?                                          | Not now. Revisit when a file-format or apply-time change is planned (D7). If a wider file net is wanted earlier, give the existing randomized spec content (F2)   |
| M3  | Should a newly failing seed block a sync PR?                                   | Not yet. After V2 and 30 days of record, make the job required with a maintainer-only override (G1). Never without an override                                    |
| M4  | What happens to the spike's task-move signatures?                              | Issues with traces after V1 merges; no fix without a real-app reproduction and a rule 15 category. They do not count against the five-PR limit until they are PRs |
| M5  | May the first slice's PR show new compare entries from the tool change itself? | Yes, once, stated in the PR: the tool starts to compare per mix, and the `move` mix has no base                                                                   |

## Review

One fresh-context subagent challenged the draft's main claims against the
code. What changed is recorded here.

_Pending._

## Missing evidence

- Whether any spike signature is a bug: no trace was shrunk, replayed three
  times or reproduced in the app, and released clients were not checked.
- Whether a move resolves through the field patch or a whole-entity path. The
  three `projectId` preservation rows depend on it.
- Why `time-loss` appears in 26 of 30 `move` seeds. One seed's detail was
  read; the mechanism was not.
- The false-positive rate of the compare job: no CI run in the window
  reported a new entry, and history before 2026-11-03 was not examined.
- Why ten commits had the compare job skipped in one run and executed in
  another.
- The eight file-fix judgements are from reading. None was replayed against a
  port, because no port exists.
- File-port effort has no spike behind it. The largest item, a file-mode
  `_syncBody`, was sized from the list of branches, not from an attempt.
- Runtime of the compare job after several new mixes, on CI hardware.
