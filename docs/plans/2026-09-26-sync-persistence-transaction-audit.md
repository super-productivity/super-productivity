# S7: persistence replacement transaction audit

**Date:** 2026-09-26. **Audited starting/source SHA:**
`9177c3afed6429934632b23de936cda8c6603fde`.
**Status:** the original documentation-only audit was committed as `b47603be1a`.
A subsequently authorized adversarial review reproduced two P7 defects and led
to a narrow repair-persistence fix; see the follow-up below. A general replacement
refactor remains unsupported.

The inputs were the exact `/tmp/sync-architecture-orchestration-20260926-9177c3afed/`
`review.md` and `work-sessions.md` snapshots, particularly “Persistence — Audit
now” and S7, rather than the older committed review. S1/S2 changes in other
worktrees are outside this baseline. The eleven-flow tables and their source links describe that baseline; the
follow-up records the implementation and executed evidence separately.

**Evidence standard:** “confirmed” means verified control flow/store membership
in source, not a crash experiment performed in this session. The original coverage inventory lists inspected tests, not executed results.
The follow-up distinguishes the subsequently reproduced failures and test runs
from the original hypotheses; it does not claim user-data loss was observed.

## Actual callers and durable boundaries

Enumeration started from the four named store methods, then searched every
production `loadAllData`, full-state operation conversion, cache write and log
clear. There are **five direct production call sites of the four named methods**:
one file-baseline caller, one remote-replacement caller, two destructive callers,
and one rejected-repair caller. Expanding their entry flows and other writers
produces the **eleven rows below**, with file/server raw rebuild separated because
their follow-up commits differ. This is an explicit counting convention, not
confirmation of the review's estimate of six paths. Startup/checkpoint paths are
listed separately afterward.

Notation: all stores named here are in `SUP_OPS`: **O** = `ops`, **S** =
`state_cache`, **V** = `vector_clock`, **M** = `meta`, **A** = both archive stores,
**I** = `client_id`, **B** = import-backup stores. “Tx” means one IndexedDB
transaction, whose adapter awaits `tx.done` and aborts on a thrown error
([adapter][idb-tx]). The [production factory][factory] selects IndexedDB on every
platform; the uncalled SQLite migration is not an additional live replacement
path. **L** = `OPERATION_LOG`, **A-lock** = `TASK_ARCHIVE`. Locks serialize
participating writers; they do not make NgRx, localStorage or separate databases
part of the IDB transaction. The [fallback mutex][locks] only protects one process.

| Path and actual trigger/call chain                                                                                                                                                                                                                                                                            | Durable stores, locks and tail checks                                                                                                                                                                                                                                                                                                                      | Archives, identity and existing local work                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **P1 — automatic file bootstrap/gap.** `_handleDownloadResult` → `_hydrateSnapshotExclusive` → `hydrateFromRemoteSync` → `commitFileSnapshotBaseline` ([sync][file-flow], [exclusive window][file-window], [hydration][hydrate], [commit][file-commit]).                                                      | Flush→L→pending-write recheck; remote-apply window and late-durable-op conflict check. Commit takes A-lock; one Tx writes O/S/V, M if included ops contain a full-state op, and each supplied archive store. In-Tx tail must equal captured `lastAppliedOpSeq`. Included rows and rejection of the captured unsynced set commit with the cache.            | Replaces supplied archive partitions; omitted ones survive. Keeps I (may initialize a missing identity). No new `SYNC_IMPORT`; retained remote rows are marked applied because the snapshot represents them. Earlier pending local ops are rejected only with successful replacement; actions arriving during hydration are drained, replayed over the new state, and have archive effects restored. Timer batch is flushed after the baseline commit. |
| **P2 — file USE_REMOTE/raw-rebuild resume.** `forceDownloadRemoteState` → `runRemoteStateReplacement` → `hydrateFromRemoteSync` → `appendSnapshotIncludedOps` → suffix processing ([rebuild][rebuild-file], [replacement Tx][remote-commit]).                                                                 | Download/preflight first; flush→L→recheck. First A-locked Tx clears O, replaces S/V/A, resets full-state M and writes raw-rebuild M; reads the backup identity in the same Tx. Then P1's baseline helper runs **without included rows**; a separate O/S/(M) Tx records included rows and verifies cache frontier = log tail ([included append][included]). | I unchanged. Snapshot archives or defaults replace both stores. Original pending work is intentionally relinquished to the chosen remote state and retained in the safety snapshot, not as uploadable ops. Resume merges marker-carried local ops with current unsynced ops by ID, re-appends/replays them after the remote baseline. Capture races retry phase 2, bounded to three attempts.                                                          |
| **P3 — SuperSync USE_REMOTE/raw-rebuild resume.** Same initial entry, then defaults reset and complete raw history replay ([rebuild][rebuild-server]).                                                                                                                                                        | Same first replacement Tx as P2. Raw download includes own/already-known ops; replay runs under L with conflict detection bypassed and its own pending/checkpoint/archive transactions (P6). Capture check before cursor/completion. No file-baseline Tx.                                                                                                  | I unchanged; A reset to defaults, then replay rebuilds it. Original pending work and post-interruption work have the distinct P2 policies. `_restorePreservedLocalOps` keeps restored entries local/unsynced and explicitly runs their archive effects ([restore tail][restore-tail]).                                                                                                                                                                 |
| **P4 — JSON/native/local/recovery-ring/SuperSync-backup restore.** All funnel into `BackupService.importCompleteBackup` → `_persistImportToOperationLog` → `runDestructiveStateReplacement` ([file import][backup-callers], [entry][backup-entry], [commit caller][backup-commit], [Tx][destructive-commit]). | Validate/repair input; flush then L (not the flush→lock→recheck wrapper). Pre-import backup must succeed, unless restoring the verified current recovery slot. A-locked Tx clears O, writes one **`BACKUP_IMPORT`**, S/V/I/M and supplied A; optionally checks B identity. No numeric tail assertion.                                                      | Rotates I and starts its clock at 1; replaces supplied A. Old pending ops are deliberately discarded with the old log; timer accumulator cleared. Do not infer the op type from the helper's stale “both callers pass SYNC_IMPORT” comment.                                                                                                                                                                                                            |
| **P5 — encryption password clean slate.** `EncryptionPasswordChangeService` → `CleanSlateService.createCleanSlate` → same destructive helper ([caller][clean-trigger], [body][clean]).                                                                                                                        | Flush timer/capture, then L; capture archive-inclusive current state; A-locked O/S/V/I/M Tx. No numeric tail assertion; no A arguments.                                                                                                                                                                                                                    | Rotates I; carries the current state as one pending **`SYNC_IMPORT`**. Existing local effects are represented by that snapshot, not kept as individual rows. A stores remain as-is; no NgRx replacement dispatch. Timer deltas arriving later are projected out of the baseline and become tail ops.                                                                                                                                                   |
| **P6 — incoming `SYNC_IMPORT`/`BACKUP_IMPORT`/`REPAIR`.** Downloads/piggyback/raw rebuild → `RemoteOpsProcessingService.processRemoteOps` → core `applyRemoteOperations` ([orchestration][remote-flow], [core][remote-core]).                                                                                 | Normally UPLOAD→flush→L→recheck; reuses L when caller owns it. Local-action hold and final conflict gate. O/(M) pending append Tx; V pre-merge; reducer outcome + V/M checkpoint Tx; separate A-locked archive Tx; O applied status; old full-state cleanup. No state-cache replacement Tx is required: full-state row is the replay anchor.               | I unchanged. Import/backup semantics discard causally obsolete/concurrent work; repair normally preserves concurrent work, with `repairBaseServerSeq` handling ([filter][filter]). Deferred new local actions drain after apply. Archive handler preserves a missing partition and refuses empty `SYNC_IMPORT`/`REPAIR` over nonempty A; explicit `BACKUP_IMPORT` may empty it ([archive handler][archive-load]).                                      |
| **P7 — ordinary post-apply repair.** `validateAndRepairCurrentState` → `createRepairOperation` → repaired `loadAllData` ([validator][validate], [writer][repair], [append Tx][mixed]).                                                                                                                        | L acquired or inherited; archive-inclusive projected snapshot after active-state validation fails. O/V/M mixed-source append Tx rebases clock on durable V, then **separate S put**, then dispatch. No tail compare.                                                                                                                                       | I unchanged; old rows retained. Repair carries full A in its payload/cache, but this originating path writes no A stores. Remote-marked dispatch suppresses local effects; ordinary local `loadAllData` archive handling also returns early. See hypothesis H1 below.                                                                                                                                                                                  |
| **P8 — rejected stale repair rebase.** `RejectedOpsHandlerService` downloads missing suffix → `rebaseStaleRepair` → `replaceRejectedRepair` ([rejection flow][rejected], [writer][repair], [Tx][repair-replace]).                                                                                             | L; reads current archive-inclusive state. One O/V/M/S Tx verifies stale row exists, rejects it, appends replacement, rebases V against durable V, and anchors S at replacement seq. No tail compare; no A-lock in this writer.                                                                                                                             | I/A unchanged; other rows and pending work retained. It snapshots the state after download, rather than re-running `dataRepair` or dispatching another replacement. The stale repair's rejection is atomic with its replacement **inside this helper**; do not generalize that to every upstream stale-repair retirement path.                                                                                                                         |
| **P9 — seed empty/reset server or USE_LOCAL.** `handleServerMigration` (also called by force-upload coordinator); repaired-state branch dispatches `loadAllData` ([migration][server-migration]).                                                                                                             | Flush→L→recheck and pending-server-migration recheck; creates local `SYNC_IMPORT` using ordinary `append` ([O/M Tx][plain-append]), not a cache helper; it does not update durable V. If validation repaired state, dispatch occurs **before** client-ID lookup and durable append.                                                                        | I unchanged; existing rows kept, earlier effects represented in the full-state op. A is read into payload, not replaced locally. New captures append after the cutoff. A pre-append crash leaves the old durable baseline, not the repaired live projection.                                                                                                                                                                                           |
| **P10 — legacy pf genesis migration.** Startup without cache → `checkAndMigrate` → `_performMigration` → `appendOperationAndSnapshot` ([migration][legacy]).                                                                                                                                                  | L and legacy migration lock; rechecks cache/first row. If legacy data exists and first row is not genesis, “orphan” O rows are cleared **in an earlier Tx**. O/S/V genesis anchor Tx rebases onto durable clock; validation/backup/identity writes are outside it.                                                                                         | Legacy ID copied or initialized separately; no destructive rotation. Archive migration separately copies missing A partitions from pf ([archive migration][archive-migrate]). Earlier non-genesis rows can be discarded; this is a different precondition from P11's strict emptiness rule. pf remains available; backup download is best effort.                                                                                                      |
| **P11 — legacy disaster recovery.** Hydrator catch/recovery → `attemptRecovery` → `recoverFromLegacyData` → `appendRecoveryOperationAndSnapshot` ([recovery][legacy-recover], [anchor][anchor]).                                                                                                              | L; refuses unless both S and O are absent and inspection succeeds; validate real legacy state. One O/S/V Tx installs `RECOVERY` genesis and exact clock, then dispatch. No in-Tx emptiness recheck; relies on callers honoring L.                                                                                                                          | Existing I required, unchanged; no A writes in anchor Tx (startup archive migration is separate). No local O may exist; no new import-backup marker. pf is the preserved source on an aborted anchor write.                                                                                                                                                                                                                                            |

### Recovery, provider metadata and per-tab state

“Cache invalidation” below concerns this service instance, not a broadcast to all
tabs. [Applied IDs][ids] are derived from O, while [tab frontier][frontier]
tracks a tab's projection. Plain appends observe their seq; a baseline install
can establish it and clear sticky divergence. A zero baseline remains
unestablished/default-open. None of these calls synchronizes another tab's NgRx.

| Path    | Backup/marker and provider cursor                                                                                                                                                                                                                                                      | Cache/frontier; crash and restart semantics                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1**  | No recovery-ring capture or raw-rebuild marker in this flow. Downloaded file version/clock/revision stay staged; promote only after baseline, deferred work and post-snapshot suffix succeed.                                                                                          | File commit clears applied/unsynced caches, updates V cache, establishes frontier. Failure inside Tx leaves old state **and uploadable pending ops**. After Tx/before dispatch, restart reads committed snapshot + tail. After apply/before cursor, retry re-downloads; a zero cursor can request the full snapshot again, so this is not merely an ID-dedup case.                                                                                      |
| **P2**  | Mandatory FORCE_DOWNLOAD safety capture on first attempt; verify token in replacement Tx. `rawRebuildIncomplete` includes preserved ops and backup reference. Cursor promoted after included/suffix/local replay; completion swaps marker for recovery token ([completion][complete]). | Clear applied/unsynced caches, replace V cache, reset frontier at initial replacement; re-establish after completed replay. Any crash after first Tx retains marker, forcing another raw seq-0 download even if cursor was already promoted. Original backup is reused, not overwritten with partial rebuilt data. File's intermediate commits are covered by this marker.                                                                              |
| **P3**  | Same marker/backup policy as P2; cursor after raw replay, then marker completion. Resume runs before normal download/upload ([gate][resume]).                                                                                                                                          | Same reset/re-establish policy. An offline restart can display the partial/default durable baseline; finishing needs remote access. Safety backup/Undo remains the recovery route if replay cannot finish. Do not describe the workflow as one transaction.                                                                                                                                                                                             |
| **P4**  | Pre-import recovery ring or identity-checked restoration slot. Tx clears interrupted/completed raw-rebuild markers. **After commit**, `_resetAllLastServerSeqs` removes only `super_sync_last_server_seq_*`; file adapter metadata is not reset here ([reset][backup-commit]).         | Destructive commit clears applied/unsynced caches, updates V cache/frontier, invalidates client-ID cache. Tx abort preserves old ID/O/S/V/A. Crash after commit/before cursor reset loads the imported state and pending `BACKUP_IMPORT`, with old provider cursor still possible; later snapshot upload/filtering must resolve it. No dedicated reset-resume marker. End-to-end coverage of that precise interval was not established.                 |
| **P5**  | No recovery-ring capture or replacement marker; destructive Tx clears raw-rebuild markers. No provider cursor change here; subsequent full-state upload owns acknowledgement.                                                                                                          | Same destructive cache/identity handling. Abort leaves prior baseline; committed crash boots current-state snapshot with one pending `SYNC_IMPORT`. No local state rollback is intended. Remote upload/encryption workflow is outside this Tx.                                                                                                                                                                                                          |
| **P6**  | Meaningful pre-state captured as REMOTE_IMPORT before a new full-state apply (skipped by raw rebuild, which already owns a backup). Per-row `pending`→`archive_pending`/`failed`→`applied` is the recovery protocol. Cursor stays behind a thrown/incompatible/incomplete apply.       | Appends observe frontier; V cache changes with durable clock commits; full-state cleanup invalidates relevant row caches. Restart reconstructs reducers from snapshot + retained tail, then retries only unfinished archive work. Crash after A commit/before `applied` repeats archive work, so idempotence is required; no general exactly-once transaction spans reducer/A/cursor.                                                                   |
| **P7**  | No recovery-ring capture or dedicated marker in repair creation. `repairBaseServerSeq` is payload/server causal context, **not** a provider-cursor write.                                                                                                                              | Mixed append updates V cache and observes seq; its new tail refreshes row caches on read; S success establishes frontier. The full-state REPAIR remains available after a failed S write, but a later stale snapshot can hide it if the repaired live state was never installed. The original unconditional recovery claim was disproved by the follow-up. Crash after a successful S write uses repaired cache. Originating A persistence is H1 below. |
| **P8**  | No new backup/marker. Uses downloaded base cursor in replacement payload; download has its own acknowledgement order.                                                                                                                                                                  | Updates V/unsynced cache and establishes frontier. Aborted Tx retains pre-call rows/cache; committed Tx has replacement anchor and rejected predecessor. Further upload failure leaves replacement pending for retry. A is outside this Tx.                                                                                                                                                                                                             |
| **P9**  | No recovery ring/marker or cursor write in this method. Caller uploads the full-state op; prior rows remain until normal upload bookkeeping.                                                                                                                                           | Ordinary append observes seq; its new tail refreshes row caches on read; it does not update V cache; no S/frontier establishment here. Pre-append repair can disappear on restart; post-append restart loads/replays full-state op. Whether subsequent failed-append processing can persist the repaired live projection needs a separate reproduction.                                                                                                 |
| **P10** | Best-effort downloaded legacy backup and retained pf; legacy lock/skip marker belong to legacy owner. No provider metadata write.                                                                                                                                                      | Clear-O resets row caches/frontier; successful anchor updates V/unsynced cache and establishes frontier. Crash before anchor retries migration, but an earlier orphan-clear/ID write is already durable. Crash after anchor has matching O/S/V. Concurrent edits after genesis remain tail.                                                                                                                                                             |
| **P11** | No provider metadata or extra recovery marker. pf retained.                                                                                                                                                                                                                            | Successful anchor updates V/unsynced cache and establishes frontier; aborted O/S/V Tx leaves recovery retryable. Present/corrupt cache or nonempty O blocks legacy overwrite, even if recovery would otherwise be convenient.                                                                                                                                                                                                                           |

### Startup and checkpoint paths are not additional remote imports

| Path/source                                                                                                                     | Stores, locks, local work and recovery                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **H2 — startup hydration, terminal full-state shortcut and fallback** ([hydrator][boot], [tail][tail], [archive retry][retry]). | Reads trusted S plus `seq > lastAppliedOpSeq` O; restores V separately; no global L around the entire boot. Hydration-in-progress fences compaction. Structural screening, schema migration and matching-version trust are distinct. Replay includes ordinary rejected rows (their effects may have entered state), excluding `reducerRejectedAt`; pending reducers disable terminal full-state shortcut. Establishes covered frontier, then archive-only retry uses the durable checkpoint. I/provider cursors unchanged; archive migration/retries are separate. Migration/reducer fallback preserves intact S and disables replacement-cache/compaction writes. Retained-log fallback after pruning is degraded recovery, **not proof the entire history can be rebuilt from zero offline**. |
| **H3 — cache schema migration/rollback** ([snapshot migration][cache-migration], [backup restore][cache-backup]).               | S.current→S.backup, migrate/validate, S.current put, backup delete are separate operations; no L/tail recheck in this helper. Original seq retained. Backup presence on boot restores original S then retries migration; crash after new S/before backup deletion rolls back and migrates again. Invalid migrated state can hydrate unpersisted; failed migration keeps original cache. No O/A/I/provider change; frontier comes from subsequent hydration.                                                                                                                                                                                                                                                                                                                                     |
| **H4 — live-state snapshot refresh and compaction** ([snapshot writer][cache-write], [compaction][compact]).                    | Flush→L→recheck, pending/deferred/failed-capture and tab-frontier guards; compaction additionally guards hydration and pending remote reducer work. S written before separate counter reset and terminal-row pruning; abort before prune leaves more history, not a missing anchor. Compaction deletes only covered, old, synced/rejected terminal rows. No archive replacement, identity rotation, recovery ring or provider acknowledgement. Existing local unsynced work survives pruning; pending timer deltas are [projected out][time-project] of the state snapshot.                                                                                                                                                                                                                     |

## Cursor lag and deduplication: what the source actually guarantees

The required invariant is **an acknowledgement must not claim work beyond durable
recoverable state**. Cursor lag is acceptable only with a working retry path.
SuperSync's cursor is [localStorage-backed][super-cursor]. File sync promotes
staged version/clock/revision with its seq and writes them as [one localStorage
value][file-metadata]; [persistence failure][file-storage] is logged/swallowed, leaving restart
metadata behind the in-memory values. Moving either owner into IDB is unnecessary
to express the ordering requirement.

The current recovery mechanisms are narrower than “exactly once”:

1. [Download filtering][download-filter] skips retained IDs from O. The set
   includes pending, failed and rejected rows, despite its `getAppliedOpIds`
   name. Those rows are not proof their effects finished; startup recovery and
   the [incomplete-remote gate][resume] must finish them before ordinary sync.
   The append transaction also checks the unique ID index. A cursor that lags
   fully committed, still-retained work therefore causes transport redelivery,
   not a second normal reducer application.
2. After pruning removes an ID, file downloads (and explicit SuperSync
   redelivery retries) require **both** cursor coverage and local author-clock
   coverage to suppress it. Seq-0/raw rebuild disables that second filter.
   File synthetic versions can advance on upload while merging unseen ops;
   they are not a universal applied frontier. The paired filter itself has
   counter-regression [pending regression tests][redelivery-tests].
   [#10239](https://github.com/super-productivity/super-productivity/issues/10239)
   was still open when checked through GitHub API on 2026-09-26. Thus the
   no-leading-acknowledgement invariant is a requirement, **not a blanket
   correctness claim about today's file cursor**.
3. A trusted file snapshot must actually contain every op recorded as included.
   v2 treats returned recent ops as included; v3 partitions them at the validated
   snapshot reference and replays the suffix ([v3 boundary][split]).
   [#10256](https://github.com/super-productivity/super-productivity/issues/10256)
   remained open on the same API check and is owned by S1. Atomic installation
   cannot repair a stale snapshot produced upstream. P1/P2 restart claims are
   conditional on that snapshot contract.
4. Archive retry is at least once: checkpointed rows run with reducer dispatch
   disabled, and retry may repeat an already committed archive write. Full-state
   replacement uses the archive handler's existing empty/missing policies.
   P2/P3 go further: their marker intentionally redoes the baseline and whole
   raw history, then restores preserved local ops by stable ID. Test the final
   state and additive totals; counting network calls or op rows is insufficient.

## Existing evidence and limits

These are **coverage locations, not passing results from this session**. Store
tests exercise IndexedDB transactions; a service spy assertion cannot establish
real reducer convergence. No full-suite, released-client, or crash matrix was run.

| Paths   | Inspected tests and what they cover                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1/P2   | [Store baseline tests][test-file] cover included frontier, tail mismatch, atomic baseline rollback and atomic local rejection. [Hydration second-tab test][test-hydrate] covers an append/restart clock case. [Adapter tests][test-adapter] cover staged cursor handling; [cancellation][test-adapter-cancel] and [snapshot partitioning][test-adapter-partition] have separate cases. These do not establish the entire baseline→suffix→cursor crash matrix with additive edits. |
| P2/P3   | [Store remote-replacement tests][test-rebuild] cover marker, backup identity, preserved ops, archive rollback and recovery token. [USE_REMOTE E2E][test-rebuild-e2e] pauses after replacement, reloads, resumes and preserves original Undo. [Recovery-point integration][test-backup-point] uses real persistence/orchestration but mocks state application. File-specific multi-commit restart equivalence is not proven by that SuperSync E2E.                                 |
| P4/P5   | [Destructive store tests][test-destructive] cover archive/identity rollback and cache invalidation; [clean-slate interruption][test-clean] drives the real IDB abort seam with a supplied snapshot. [Backup E2E][test-backup-e2e] exercises restore with an existing server import. No exact post-commit/pre-cursor-reset crash proof identified.                                                                                                                                 |
| P6      | [Failed-op boot integration][test-boot] covers once-per-boot reducer reconstruction with snapshot before/after failure or absent. [Pending full-state integration][test-pending] retains a failed full-state row until a healthy boot. [Recovery-ring E2E][test-ring] covers remote wipe, restore and peer/fresh-client sync.                                                                                                                                                     |
| P7/P8   | [Repair unit tests][test-repair] check writer/clock/cache calls; [replacement Tx tests][test-repair-tx] cover durable clock rebase and missing predecessor. [Repair lifecycle E2E][test-repair-e2e] covers stale rebase/reload and offline pending work. [Archive roundtrip][test-archive] explicitly tests receiver archive handling, **not originating `validateAndRepairCurrentState`**; it uses a mock NgRx store.                                                            |
| P9      | [Server-migration integration][test-server-migration] simulates gap/reset and re-upload through test clients. The [barrier unit test][test-server-unit] checks spy call order; [abort E2E][test-server-abort] checks normal joining of a nonempty server. None establishes an archive-changing repair followed by append failure/restart.                                                                                                                                         |
| P10/P11 | [Legacy migration E2E][test-legacy], [recovery unit tests][test-recovery] and [anchor Tx rollback tests][test-anchor] cover migration, strict empty-DB recovery preconditions, and snapshot/clock write failure. Orphan clear and legacy identity writes remain separate boundaries.                                                                                                                                                                                              |
| H2–H4   | [Fallback E2E][test-fallback], [snapshot migration unit tests][test-cache] and [multi-tab frontier integration][test-frontier] cover fallback, backup rollback and refusal to cache another tab's unseen ops. The frontier suite has real shared persistence and controlled state, not independent live-browser convergence.                                                                                                                                                      |

## Decision and smallest next step

**Do not consolidate the replacements now.** Their shared storage mechanics
already use the adapter transaction wrapper. Their differing policies earn their
place: exact file-tail check, raw-rebuild continuation, destructive identity
rotation, strict-empty legacy recovery, and stale-repair replacement are not
interchangeable. A universal helper would need policy switches without removing
these invariants. The proposed 3–4k-line saving remains unvalidated. The original claim that the
REPAIR append/cache split was harmless was too strong: retained data alone does
not prevent a later snapshot from hiding it. The follow-up fixes the failed-cache
control flow without consolidating all replacement transactions.

**H1 — original hypothesis, subsequently reproduced:** an originating repair can change archive
partitions: [`dataRepair` removes duplicate archived entities][repair-archives].
P7 commits that repaired archive image inside O/S but does not write A, and boot's
direct full-state shortcut only dispatches NgRx. The [archive effect][archive-effect]
cannot fill that gap: it consumes local actions, while sync repair dispatch is
remote-marked; the handler skips local `loadAllData` too. This was a source-level boundary
to exercise; the follow-up supplies the reproduction. P1 also commits the originally
downloaded archives even when validation supplies repaired `dataToLoad`; include
that as a later follow-up, not another implementation in the first task.

The original recommendation was **one reproduction-only task for P7** after rebasing onto reviewed S1/S2
and any intervening persistence changes. Use a real app/IndexedDB fixture with
an active/archive duplicate **and an active-state validation error** (archive-only
corruption does not trigger the cheap validation gate). Trigger normal remote
processing/automatic repair, then compare originating archive stores, repair
payload, peer state and state after two offline reloads. Preserve an unrelated
pending edit and a known additive time delta. Do not call a mocked applier or
silently choose Keep remote. Reuse the repair-lifecycle E2E setup; read
`e2e/CLAUDE.md` before editing it.

The task's invariants and failure cases are:

- Repair's intended active/archive result must agree live, after restart and on
  peers; concurrent user work and unrelated archive content survive. Existing
  empty-archive policy is explicit test input, not silently changed.
- Interrupt after repair append/before S, after S/before dispatch, and after
  durable work/before provider acknowledgement. Inject write failure at each
  relevant persistence boundary. Assert either prior complete state or a
  replayable repair, no duplicate additive delta, and retryable pending work.
- Verify a behind cursor re-downloads safely; do not advance it past incomplete
  work. Repeat restart to detect recurring repair or archive resurrection.
- Record baseline failure if observed. If the candidate passes, record that
  result and stop; it does not justify new guards. A demonstrated defect earns
  a separate narrow implementation task using existing persistence mechanisms,
  with its E2E failing before and passing after. No `commitBaseline()` design,
  cursor-storage move, snapshot-production replacement or local-only repair
  semantics are selected by this audit.

## Original audit validation record and draft PR description

**Original audit scope:** only this document. No product/test/config/schema/dependency or
agent-control-file edits. Starting and source-validated SHA is
`9177c3afed6429934632b23de936cda8c6603fde`; the audit commit changes no executable
source. Existing fixes in local history include atomic destructive identity
rotation, recovery-ring preservation and the tab-frontier guard; this report
describes those mechanisms rather than re-proposing them. Current issue reads
were read-only; no remote fetch, push, public post or integration was performed.

Checks (exact commands; validation output retained under `/tmp/sync-s7-audit/`):

```sh
git rev-parse HEAD
rg -n 'commitFileSnapshotBaseline|runRemoteStateReplacement|runDestructiveStateReplacement|replaceRejectedRepair' src packages e2e --glob '!*.spec.ts'
rg -n 'loadAllData\(|appendOperationAndSnapshot\(|appendRecoveryOperationAndSnapshot\(|saveStateCache\(|restoreStateCacheFromBackup\(|clearAllOperations\(' src/app --glob '!*.spec.ts'
git log -10 --oneline -- src/app/op-log/persistence/operation-log-store.service.ts
gh api repos/super-productivity/super-productivity/issues/10256 --jq '{number,title,state,closed_at,html_url}'
gh api repos/super-productivity/super-productivity/issues/10239 --jq '{number,title,state,closed_at,html_url}'
python3 /tmp/sync-s7-audit/validate-links.py
node_modules/.bin/prettier --check docs/plans/2026-09-26-sync-persistence-transaction-audit.md
git diff --check
git diff --cached --check
```

Link validation passed for **79 pinned links across 53 unchanged source files**:
SHA, tracked file existence, line bounds, reference resolution and checkout
content all match. Its negative control rejected an unresolved reference.
Markdown formatting and working/staged diff checks passed. **Baseline/fixed runtime results: not applicable**
to this read-only deliverable; listed tests were not executed and no runtime fix
is claimed. No `.ts`/`.scss` changed, so `checkFile` is inapplicable. Scheduled
SuperSync/WebDAV, released-client and new failure tests remain gates for any
future product implementation, not missing audit validation.

**Draft PR:** `docs(sync): audit persistence replacement transaction boundaries`

Document the actual replacement callers, transaction/store boundaries, recovery
protocols and cursor/deduplication limits at the recorded SHA. Preserve the
distinct existing policies and propose one real-app repair/archive reproduction
before considering a refactor. Validation: source/link audit, Markdown formatting
and diff checks; no runtime behavior or compatibility surface changed. Remaining
limits: source inspection cannot prove crash convergence; S1 and subsequent
changes require rechecking the affected rows before implementation.

## Follow-up: adversarial review and implementation

After the documentation-only audit, the user requested adversarial review and
implementation of justified changes. The eleven-flow inventory remains scoped
to the original SHA. This follow-up changes P7 only; it does not select a common
replacement abstraction. The implementation was first committed as
`3afd6013b465258b465b65239cb33d1f5c08fc7b`, based on audit commit
`b47603be1a8a99b01541fbfe39b8217d7a83fc2c` (unchanged product source from
`9177c3afed6429934632b23de936cda8c6603fde`).

For PR preparation, the three task commits were rebased onto
`master` at `0a909ad3b60bee08089925bd7ef23b0d7b184446`, after the parent PR
was squash-merged. The current implementation SHA is
`38868ab6ac47cdd22a26fbd2120b628df5d91d9c`; the fixed-source links below use
that revision. The product fix is unchanged, and the E2E retains master's
`APIResponse` type correction.

| Adversarial finding                                                                                                        | Executed evidence and disposition                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Originating repair omitted durable archives.** The repaired payload/cache alone did not update A.                        | The new real-app E2E failed against unchanged baseline product code: duplicate active-task IDs remained in both archive partitions after repair. Persist accepted partitions with the REPAIR row.                                                                                                                              |
| **Cache failure could hide a durable repair.** The audit's unconditional “harmless split” reasoning was incorrect.         | With the archive fix but the original cache-error behavior, a one-shot S-write failure prevented repaired live-state installation. After offline reload the ghost tag remained; diagnostic reads found cache seq 7 and the REPAIR at seq 7. Finish live repair after durable commit even when this optional cache write fails. |
| **Empty-partition handling must match existing receivers.** Unconditionally replacing A in the first draft changed policy. | The empty-partition E2E failed against that draft. The final implementation leaves empty incoming REPAIR partitions untouched, matching the [existing handler][archive-load]. `git tag --contains cabf266574c5` confirms this receiver policy in `v18.11.0` and later local tags.                                              |
| **P9 transaction inventory overstated V persistence.**                                                                     | Source inspection confirms ordinary `append` writes O/M, not V; its cache does not update V either. The baseline tables are corrected. No P9 failure was reproduced and no P9 code changed.                                                                                                                                    |

The [validator][fixed-validator] acquires L then A-lock and holds A-lock from the
archive-inclusive snapshot through repair, durable commit and live dispatch.
The [existing mixed-source append][fixed-mixed] commits O/V/M and each supplied
nonempty archive partition in one Tx. The [repair writer][fixed-repair] then
attempts S; a failed optional cache write is logged without preventing live
repair. If S remains unavailable, restart can recover the retained REPAIR tail.
Other pending rows remain uploadable. The two new [real-IDB failure tests][fixed-rollback]
throw after each archive partition's actual put and verify rollback of O/V/M/A,
unchanged S, and a successful retry without consuming a clock counter.

This uses the existing append transaction, not a new baseline service. To comply
with the service-size ratchet, the unchanged pure clock-rebase function moved
into a [small utility][fixed-clock]; clock pruning stays in the store. The store's
physical size and lint allowance decrease from 3212 to 3203 lines. Most added
lines are real-app fixtures and failure tests.

**Compatibility limits:** no wire, schema, persisted-model, client-ID, provider
cursor, backup or rejected-repair behavior changes. Empty REPAIR partitions still
cannot clear a nonempty archive; the new empty-partition case deliberately
preserves that policy. Archive-only corruption still does not trigger P7's cheap
active-state validation gate. These tests exercise current clients and inspect
released receiver behavior; no released binary was executed. They do not prove
every crash boundary or exactly-once delivery. The original cursor invariant
remains: acknowledgement may lag durable work but must not lead it.

### Executed validation

The [repair lifecycle E2E][fixed-e2e] uses two real browser clients, app-created
task shapes, actual archive IndexedDB stores and a real SuperSync server. Four
new cases cover ordinary origin repair, a one-shot cache failure, cache failure
until reload, and the empty-partition policy. They check both archives, retained
unrelated work, an additive time delta of exactly 5000 ms, peer convergence and
two offline reloads per client. The two existing stale-repair/offline-client
cases also pass. No mocked applier is used.

| Gate                                                  | Result                                                                                                                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline origin-archive E2E, before product edits     | **Failed**, duplicate IDs still in both archives; `repair-e2e-baseline.log` and `repair-e2e-baseline-trace.zip`.                                                     |
| One-shot cache interruption, before cache-error fix   | **Failed** on intermediate archive-only fix; ghost tag survived offline reload at the cached REPAIR seq; `repair-e2e-boundaries.log`.                                |
| Empty-partition policy, before draft correction       | **Failed** on the intermediate unconditional-archive-write draft; `repair-e2e-empty-baseline.log`. This is a caught draft regression, not a baseline product defect. |
| Final focused unit/integration run                    | **387 passed**, including both new archive transaction rollback tests; `repair-unit-final.log`.                                                                      |
| Final whole repair-lifecycle E2E file                 | **6 passed**, one worker, zero retries, 7.7 minutes; `repair-e2e-final.log`.                                                                                         |
| All seven edited `.ts` files                          | Required `npm run checkFile` passed. `eslint.config.js` also passed its file check.                                                                                  |
| Audit formatting, pinned source links and diff checks | Passed; commands below. The original coverage inventory remains inspected evidence, not newly executed tests.                                                        |

All logs above are under `/tmp/sync-s7-audit/`. Runtime verification used the
implementation committed as `3afd6013b465258b465b65239cb33d1f5c08fc7b`; only
comments were clarified afterward, with affected file checks repeated. The local
app used port 4517, the isolated server used 1917 and PostgreSQL used 55477.
The task-built server image used unchanged server source. An ignored Karma
wrapper used port 9847 and an automatically allocated Chrome debug port.

**PR revalidation:** after rebasing, both runtime commands below were repeated on
`38868ab6ac47cdd22a26fbd2120b628df5d91d9c`: **387 unit/integration tests passed**
and **6 E2Es passed** (8.3 minutes, one worker, zero retries). Logs:
`/tmp/sync-s7-audit/pr-repair-unit.log` and
`/tmp/sync-s7-audit/pr-repair-e2e.log`. The E2E file's required file check was
repeated after master's type correction; the other edited source/test files are
byte-identical to the previously checked implementation. Source-link, formatting
and diff checks also passed again.

Exact final runtime commands:

```sh
npm run test:file -- src/app/op-log/persistence/operation-log-store.service.spec.ts \
  --include src/app/op-log/validation/repair-operation.service.spec.ts \
  --include src/app/op-log/validation/repair-operation.clock-derivation.integration.spec.ts \
  --include src/app/op-log/validation/validate-state.service.spec.ts \
  --include src/app/op-log/validation/sync-repair-non-blocking.integration.spec.ts \
  --include src/app/op-log/apply/archive-operation-handler.service.spec.ts \
  --karma-config .tmp/s7/karma.conf.cjs

E2E_BASE_URL=http://127.0.0.1:4517 SUPERSYNC_E2E_URL=http://127.0.0.1:1917 \
  E2E_REQUIRE_SUPERSYNC=true node_modules/.bin/playwright test \
  --config e2e/playwright.config.ts e2e/tests/sync/supersync-repair-lifecycle.spec.ts \
  --workers=1 --retries=0 --reporter=line
```

The baseline origin-archive run used that Playwright command with
`--grep 'persists repaired archives'`, while only the new reproduction existed.
Required file/document checks:

```sh
npm run checkFile src/app/op-log/persistence/operation-log-store.service.ts
npm run checkFile src/app/op-log/persistence/operation-log-clock.util.ts
npm run checkFile src/app/op-log/validation/repair-operation.service.ts
npm run checkFile src/app/op-log/validation/validate-state.service.ts
npm run checkFile src/app/op-log/validation/repair-operation.service.spec.ts
npm run checkFile src/app/op-log/validation/repair-operation.clock-derivation.integration.spec.ts
npm run checkFile e2e/tests/sync/supersync-repair-lifecycle.spec.ts
npm run checkFile eslint.config.js
python3 /tmp/sync-s7-audit/validate-followup-links.py
node_modules/.bin/prettier --check docs/plans/2026-09-26-sync-persistence-transaction-audit.md
git diff --check
git diff --cached --check
```

The follow-up link validator resolves every reference against its own pinned
Git revision, checks tracked files/line bounds and verifies fixed-source links
against the checkout. Its negative control must reject an unresolved reference.
It replaces the original validator's assumption that all source remains at the
starting SHA. **Not run:** full scheduled SuperSync/WebDAV suites, a released
binary compatibility run, and broader crash/cursor fault matrices. The original
implementation session used local verification; PR publication was authorized
subsequently. Integration with intervening S1/S2 changes requires
review and focused retesting of the resulting tree; the general refactor remains
unjustified.

**Draft PR:** `fix(sync): persist originating repair archives safely`

Automatic repair could leave the originating client's archives unchanged and,
after a cache-write failure, leave unrepaired live state eligible for a later
snapshot. Commit accepted archive partitions with the REPAIR operation under
the existing locks, and finish live repair when the optional cache write fails.
Preserve released receivers' empty-partition policy and existing repair format.
Validation: baseline real-app failure, six passing repair lifecycle E2Es, 387
focused unit/integration tests, and file/document checks. Full scheduled suites
and released-binary verification remain unrun.

[fixed-validator]: https://github.com/super-productivity/super-productivity/blob/38868ab6ac47cdd22a26fbd2120b628df5d91d9c/src/app/op-log/validation/validate-state.service.ts#L98-L213
[fixed-mixed]: https://github.com/super-productivity/super-productivity/blob/38868ab6ac47cdd22a26fbd2120b628df5d91d9c/src/app/op-log/persistence/operation-log-store.service.ts#L1242-L1404
[fixed-repair]: https://github.com/super-productivity/super-productivity/blob/38868ab6ac47cdd22a26fbd2120b628df5d91d9c/src/app/op-log/validation/repair-operation.service.ts#L57-L164
[fixed-rollback]: https://github.com/super-productivity/super-productivity/blob/38868ab6ac47cdd22a26fbd2120b628df5d91d9c/src/app/op-log/validation/repair-operation.clock-derivation.integration.spec.ts#L121-L198
[fixed-clock]: https://github.com/super-productivity/super-productivity/blob/38868ab6ac47cdd22a26fbd2120b628df5d91d9c/src/app/op-log/persistence/operation-log-clock.util.ts#L1-L22
[fixed-e2e]: https://github.com/super-productivity/super-productivity/blob/38868ab6ac47cdd22a26fbd2120b628df5d91d9c/e2e/tests/sync/supersync-repair-lifecycle.spec.ts#L272-L490
[idb-tx]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/indexed-db-op-log-adapter.ts#L368-L388
[factory]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/op-log-db-adapter.token.ts#L15-L30
[locks]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/sync/lock.service.ts#L30-L77
[file-flow]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/sync/operation-log-sync.service.ts#L1010-L1060
[file-window]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/sync/operation-log-sync.service.ts#L1534-L1679
[hydrate]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/sync-hydration.service.ts#L86-L308
[file-commit]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/operation-log-store.service.ts#L1011-L1158
[remote-commit]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/operation-log-store.service.ts#L2473-L2572
[destructive-commit]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/operation-log-store.service.ts#L3076-L3207
[rebuild-file]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/sync/operation-log-sync.service.ts#L1917-L2223
[rebuild-server]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/sync/operation-log-sync.service.ts#L2225-L2303
[included]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/operation-log-store.service.ts#L1161-L1265
[restore-tail]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/sync/operation-log-sync.service.ts#L2447-L2480
[backup-entry]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/backup/backup.service.ts#L104-L265
[backup-commit]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/backup/backup.service.ts#L414-L515
[backup-callers]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/imex/file-imex/file-imex.component.ts#L232-L247
[clean-trigger]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/imex/sync/encryption-password-change.service.ts#L72-L110
[clean]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/clean-slate/clean-slate.service.ts#L68-L154
[remote-flow]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/sync/remote-ops-processing.service.ts#L291-L401
[remote-core]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/packages/sync-core/src/remote-apply.ts#L94-L343
[filter]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/sync/sync-import-filter.service.ts#L1-L240
[archive-load]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/apply/archive-operation-handler.service.ts#L468-L579
[validate]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/validation/validate-state.service.ts#L95-L200
[repair]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/validation/repair-operation.service.ts#L69-L203
[mixed]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/operation-log-store.service.ts#L1281-L1407
[rejected]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/sync/rejected-ops-handler.service.ts#L190-L317
[repair-replace]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/operation-log-store.service.ts#L2982-L3052
[server-migration]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/sync/server-migration.service.ts#L206-L365
[legacy]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/operation-log-migration.service.ts#L68-L383
[archive-migrate]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/archive-migration.service.ts#L28-L70
[legacy-recover]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/operation-log-recovery.service.ts#L55-L189
[anchor]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/operation-log-store.service.ts#L817-L930
[ids]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/operation-log-store.service.ts#L1831-L1862
[frontier]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/tab-seq-frontier.service.ts#L59-L121
[complete]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/operation-log-store.service.ts#L2620-L2649
[resume]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/sync/operation-log-sync.service.ts#L2335-L2439
[boot]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/operation-log-hydrator.service.ts#L127-L320
[tail]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/operation-log-hydrator.service.ts#L486-L708
[retry]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/operation-log-hydrator.service.ts#L1031-L1123
[cache-migration]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/operation-log-snapshot.service.ts#L212-L306
[cache-backup]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/operation-log-store.service.ts#L2192-L2261
[cache-write]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/operation-log-snapshot.service.ts#L119-L196
[compact]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/operation-log-compaction.service.ts#L134-L314
[time-project]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/backup/state-snapshot.service.ts#L127-L135
[super-cursor]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/sync-providers/super-sync/super-sync.ts#L62-L74
[file-metadata]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/sync-providers/file-based/file-based-sync-adapter.service.ts#L595-L618
[file-storage]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/sync-providers/file-based/file-based-sync-adapter.service.ts#L240-L327
[download-filter]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/sync/operation-log-download.service.ts#L216-L445
[redelivery-tests]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/testing/integration/file-based-redelivered-pruned-op.issue-10119.integration.spec.ts#L388-L549
[split]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/sync-providers/file-based/file-based-sync-adapter.service.ts#L2621-L2684
[repair-archives]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/validation/data-repair.ts#L382-L455
[archive-effect]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/apply/archive-operation-handler.effects.ts#L59-L88
[test-file]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/operation-log-store.service.spec.ts#L1704-L1915
[test-hydrate]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/sync-hydration.service.spec.ts#L1239-L1297
[test-adapter]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/sync-providers/file-based/file-based-sync-adapter.service.spec.ts#L3397-L3478
[test-rebuild]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/operation-log-store.service.spec.ts#L3547-L3845
[test-rebuild-e2e]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/e2e/tests/sync/supersync-use-remote-crash-resume.spec.ts#L35-L187
[test-backup-point]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/testing/integration/force-download-recovery-point.integration.spec.ts#L53-L68
[test-destructive]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/operation-log-store.service.spec.ts#L3282-L3545
[test-clean]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/testing/integration/clean-slate-interrupt.integration.spec.ts#L102-L175
[test-backup-e2e]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/e2e/tests/sync/supersync-backup-recovery.spec.ts#L243-L349
[test-boot]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/operation-log-hydrator.failed-op-boot.integration.spec.ts#L269-L352
[test-pending]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/operation-log-hydrator.retry.integration.spec.ts#L277-L340
[test-ring]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/e2e/tests/sync/supersync-local-recovery-point.spec.ts#L28-L143
[test-repair]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/validation/repair-operation.service.spec.ts#L130-L305
[test-repair-tx]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/operation-log-store.service.spec.ts#L3990-L4076
[test-repair-e2e]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/e2e/tests/sync/supersync-repair-lifecycle.spec.ts#L269-L625
[test-archive]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/testing/integration/archive-repair-roundtrip.integration.spec.ts#L16-L148
[test-server-migration]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/testing/integration/server-migration.integration.spec.ts#L102-L168
[test-server-unit]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/sync/server-migration.service.spec.ts#L716-L754
[test-server-abort]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/e2e/tests/sync/supersync-server-migration-abort.spec.ts#L28-L115
[test-legacy]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/e2e/tests/migration/legacy-data-migration.spec.ts#L1-L90
[test-recovery]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/operation-log-recovery.service.spec.ts#L72-L152
[test-anchor]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/operation-log-store.service.spec.ts#L374-L495
[test-fallback]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/e2e/tests/migration/hydration-fallback-recovery.spec.ts#L96-L153
[test-cache]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/operation-log-snapshot.service.spec.ts#L499-L730
[test-frontier]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/testing/integration/multi-tab-frontier-guard.integration.spec.ts#L123-L233
[test-adapter-cancel]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/sync-providers/file-based/file-based-sync-adapter.service.spec.ts#L3860-L3893
[test-adapter-partition]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/sync-providers/file-based/file-based-sync-adapter.service.spec.ts#L3700-L3840
[plain-append]: https://github.com/super-productivity/super-productivity/blob/9177c3afed6429934632b23de936cda8c6603fde/src/app/op-log/persistence/operation-log-store.service.ts#L782-L808
