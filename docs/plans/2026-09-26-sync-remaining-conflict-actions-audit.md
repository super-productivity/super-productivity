# Remaining multi-entity conflict actions after S2

**Verdict:** investigate **habit-grid count edits versus habit reordering** next.
The grid emits `COUNTER_SET_FOR_DATE`, including for today's cell; S2 recognizes
only `COUNTER_SET_TODAY`. This is a current UI path into the surviving safety
stop, supported by source, **not yet an end-to-end reproduction**. Extending the
existing narrow habit path, if reproduced, is smaller than supporting another
ordering family or arbitrary bulk updates. Keep the safety stops meanwhile.

## Baseline and scope

- Inherited HEAD: `9177c3afed6429934632b23de936cda8c6603fde`.
- Audited source: `f84259fcaa66a9bb9512d1c048a299d230740c04`, read from a separate
  `git archive` snapshot; the task branch was not refreshed or merged.
- On 2026-09-26, `git ls-remote origin refs/heads/master` returned the audited
  SHA. GitHub's PR API confirmed [S2 #10275][pr-s2] merged as
  `e6740269af3fc95f874a124f257eb3b2cbfaf94c` (also checked as an ancestor), and
  [S4B3 #10284][pr-s4b3] merged as the audited HEAD. [S5 #10287][pr-s5] remained
  open at `162d8bac5b136e6d63393018ffa979a6e14d370e`; its changes are excluded.
- This completes the inventory requested by [Phase 2, item 2][plan]. S6B setup,
  S5 journal retirement, content recovery, trigger consolidation and the less
  destructive fallback question remain separate. No implementation is proposed
  as already authorized. Source links below pin the audited SHA.

## What actually reaches the stop

[Capture][capture] copies the action's declared IDs, choosing the first as
`entityId`, and normally stores `entityChanges: []`; it does not derive a reducer
write set ([extractor][extractor]). [Multi-entity detection][ids] is the
deduplicated union of `entityId` and `entityIds` having more than one member,
not `isBulk` and not the number of state objects a reducer writes.

The fresh enumeration found **26 creator bodies declaring plural IDs**: 15 in
feature action files and 11 in `task-shared.actions.ts`. Ten have explicit broad
admission paths; the remaining sixteen comprise **eight with current production
callers, seven with no current dispatch route found, and one verified legacy
caller shape**. Four of the eight are S2 reorder families with partial coverage;
section placement also has an existing specialized path. These are creator
counts, not sixteen distinct current bugs or a count of all possible histories.

For every live blocked crossing below, use two devices with a shared baseline,
concurrent clocks, a pending local operation, an overlapping declared ID and
more than one ID on the multi-entity side. **L/R** means both local-multi versus
remote-edit and local-edit versus remote-multi. The [detector][detect] applies
the exact commuting predicates first. Other crossings reach the
[preflight][gate], which rejects the remote or local multi-entity row
[before disjoint merging][preflight-call], reconciliation, rejection or application, irrespective of
which timestamp would win. Single-ID forms do not hit this gate merely because
their reducer has cross-entity side effects.

### Current callers: handled subsets and live blocked crossings

“Source” below establishes a caller-to-gate path, not a passing or failing E2E.
“Integration” is qualified separately in the validation section.

| Action / capture footprint                                                                                                           | Current caller and reducer-written state                                                                                                                                                                                                                                                                                                                                                                                                                | Coverage and surviving crossing                                                                                                                                                                                                                                                                      | Classification / evidence                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `updateSimpleCounterOrder`: `SIMPLE_COUNTER`, Move, displayed IDs ([actions][counter-actions])                                       | [Habit grid drag][habit-grid] → `SimpleCounterService.updateOrder`. [Reducer][counter-reducer] rearranges listed slots of `simpleCounter.ids`, retaining unlisted/disabled slots.                                                                                                                                                                                                                                                                       | S2 handles `COUNTER_SET_TODAY`. **L/R with `COUNTER_SET_FOR_DATE`** from `onCellClick` → `setCounterForDate` writes `countOnDay[date]` but is absent from [S2's predicate][reorder]. Also excluded: `updateSimpleCounter` settings, stopwatch `syncSimpleCounterTime`, deletes and competing orders. | **Handled / live blocked. Recommended investigation.** Source; S2's [E2E fixture][reorder-e2e] explicitly dispatches Set Today, not the grid's For Date action.                                                    |
| `sortIssueProvidersFirst`: `ISSUE_PROVIDER`, Move, displayed IDs ([actions][provider-actions])                                       | [Issue panel tab drag][provider-panel]; [reducer][provider-reducer] prefixes `issueProvider.ids` with the requested IDs and retains unlisted IDs.                                                                                                                                                                                                                                                                                                       | **L/R with `updateIssueProvider` on a listed provider**, e.g. toggle enabled in the [edit dialog][provider-dialog]. The dialog sends its full model, not just `isEnabled`. No commuting or broad admission path; ordinary single-provider updates remain single-entity.                              | **Live blocked**, source. No focused conflict regression located.                                                                                                                                                  |
| `TaskSharedActions.updateTasks`: `TASK`, Update, update IDs ([metadata][task-meta])                                                  | [Start-of-day setting change][config-effect] dispatches due-day updates when the logical date changes; [repeat-instance editing][repeat-effect] and [moving a repeating family][repeat-move] call `updateArchiveTasks`. Active [task reducer][task-reducer] uses `updateMany`; [archive service][archive-service] writes young/old archive tasks before capture; [remote archive handler][archive-handler] repeats the archive writes without dispatch. | **L/R with `updateTask` title/notes on any listed task** (archive case: edit the same occurrence on the other device). No decomposable-bulk admission; simple-looking deltas and empty `entityChanges` do not establish safe partial rejection.                                                      | **Live blocked**, source plus [mocked-store/applier integration][unsupported-test] for local archived bulk update versus remote title. Active due-day and reverse crossings lack an inspected real-app regression. |
| `TaskSharedActions.updateTask` **with** `projectMoveSubTaskIds`: `TASK`, Update, root plus captured children ([metadata][task-meta]) | [TaskService.update][task-service] captures children for a root `projectId` update. Current producers include [Electron REST PATCH][rest] and the [navigation repair re-home][navigation]. [CRUD meta-reducer][crud] writes root/child projects and project task/backlog lists; [section meta-reducer][section-meta] cleans old memberships.                                                                                                            | **L/R with a title edit of the root or a captured child**. No broad admission, even though LWW helpers know how to carry a project-move footprint. Ordinary UI/plugin `moveToOtherProject` declares only the root and is a different shape.                                                          | **Live blocked**, source. No focused real-app conflict regression located for this plural-ID shape.                                                                                                                |
| `updateNoteOrder`: `NOTE`, Move, note IDs ([actions][note-actions])                                                                  | [Notes drag][notes-ui] → [NoteService][note-service]; [project reducer][project-reducer] writes `project.noteIds`, or [note reducer][note-reducer] writes `note.todayOrder`.                                                                                                                                                                                                                                                                            | S2 handles `updateNote` with only `content`/`modified`. **L/R with pin/unpin or lock edits, `moveNoteToOtherProject`, deletion, or another overlapping reorder** remain outside its predicate. [Note UI][note-ui] supplies those edits; pinning also changes Today ordering.                         | **Handled / live blocked**. Real-app evidence for S2's supported content crossing; real-store integration negative cases for pinning and competing order; other exclusions source-backed.                          |
| `sortBoards`: `BOARD`, Move, board IDs ([actions][board-actions])                                                                    | [Boards drag][boards-ui]; [reducer][board-reducer] reorders `boardCfgs`, preserving configs and unlisted boards.                                                                                                                                                                                                                                                                                                                                        | S2 handles identity-preserving `updateBoard` with the actual editor's `id/title/cols/panels`. **L/R with `removeBoard` on a listed board or a competing sort** has no admission. Panel actions declare panel IDs, so do not count them as board-ID conflicts without proving overlap.                | **Handled / live blocked**, source for exclusions; S2 E2E uses the real board editor for the supported case.                                                                                                       |
| `updateSectionOrder`: `SECTION`, Move, section IDs ([actions][section-actions])                                                      | [Work view drag][work-view] → [SectionService][section-service]; [reducer][section-reducer] reorders matching-context slots in `section.ids`.                                                                                                                                                                                                                                                                                                           | S2 handles title-only `updateSection`; [section predicate][section-predicate] handles order versus placement/removal. **L/R with `updateSection({ isExpanded })`**, dispatched by the [work-view template][work-view-html], deletion, or competing order remains blocked.                            | **Handled / live blocked**, source. The integration's `contextId` negative fixture proves exclusion, but no current context-changing UI caller was found; it is not evidence of that user flow.                    |
| `addTaskToSection` **across two sections**: `SECTION`, Move, source/destination IDs ([actions][section-actions])                     | [Task-list drop][task-list] → `SectionService.addTaskToSection`; [section reducer][section-reducer] moves membership/anchor order; [section meta-reducer][section-meta] handles associated membership constraints. Same-section/from-unsectioned forms declare one ID.                                                                                                                                                                                  | Existing predicate handles order versus placement and moving/removing the **same** task from its source. **L/R with a title/expanded edit of source or destination**, or overlapping moves not matching that predicate, still fails preflight.                                                       | **Handled / live blocked**, source for exclusions. [Section E2E][section-e2e] exercises the specialized move/removal/order path, not all section conflicts.                                                        |

The plugin audit does not turn unused creators into live callers:
[raw plugin dispatch][plugin-allow] allows none of these multi-entity creators.
[Plugin task updates][plugin-bridge] route `projectId` through
`TaskService.moveToProject` → single-ID `moveToOtherProject`; plugin task order
uses single-project/task updates. Allowed global-config dispatch can indirectly
reach the due-day bulk-update effect. No in-repository plugin caller for that
particular setting change was found; this is API capability, not demonstrated
plugin demand.

### No current dispatch route found: preserve replay contracts

“Unreachable” here means no production UI/plugin call chain found in the audited
repository, not proof that historical logs or external older clients cannot
contain the action. These shapes would still fail L/R preflight with plural
IDs and an overlapping concurrent operation; do not remove their reducers,
action strings or replay support as part of conflict triage.

| Action / metadata                                                                                | Caller finding and reducer behavior                                                                                                                                                                                                                  | Classification / evidence                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `addTagToTask`: `TASK`, `[taskId, tagId]` ([metadata][task-meta])                                | Current tag editing uses `updateTask(tagIds)`. Historical action writes task tag membership; the tag ID is also declared as a TASK conflict key.                                                                                                     | **Legacy-only**. [Unsupported integration][unsupported-test] records the caller removal at `6bb0472549` and pins captured local legacy action rejection; no current caller found. |
| `__updateMultipleTaskSimple`: `TASK`, update IDs ([actions][task-actions])                       | No dispatcher found; [task reducer][task-reducer] still applies `updateMany`.                                                                                                                                                                        | **Unreachable currently**; retained replay shape.                                                                                                                                 |
| `updateTaskRepeatCfgs`: `TASK_REPEAT_CFG`, IDs ([actions][repeat-actions])                       | [Service wrapper][repeat-service] has no caller (one commented-out lead); [reducer][repeat-reducer] applies shared changes to listed configs.                                                                                                        | **Unreachable currently**.                                                                                                                                                        |
| `updateAllSimpleCounters`: `SIMPLE_COUNTER`, item IDs ([actions][counter-actions])               | `SimpleCounterService.updateAll` has no caller. [Reducer][counter-reducer] removes omitted counters, upserts items and replaces order: not merely independent updates.                                                                               | **Unreachable currently**; payload shape does not justify generic admission.                                                                                                      |
| `updateProjectOrder`: `PROJECT`, IDs ([actions][project-actions])                                | [ProjectService.updateOrder][project-service] has no caller; [reducer][project-reducer] writes project IDs ordering.                                                                                                                                 | **Unreachable currently**; not the current sidebar's ordering action.                                                                                                             |
| `updateTagOrder`: `TAG`, IDs ([actions][tag-actions])                                            | `TagService.updateOrder` has no caller; [reducer][tag-reducer] writes tag IDs ordering.                                                                                                                                                              | **Unreachable currently**.                                                                                                                                                        |
| `TaskSharedActions.removeTagsForAllTasks`: `TAG`, removed tag IDs ([metadata][task-meta])        | `TaskService.removeTagsForAllTask` has no caller. Archive cleanup calls the action only through `_execActionBoth`, which reduces/saves archives without store dispatch or capture. [Tag meta-reducer][tag-meta] removes task tag references.         | **Unreachable as a new captured conflict action**; the local archive helper is live.                                                                                              |
| `TaskSharedActions.deleteIssueProviders`: `ISSUE_PROVIDER`, provider IDs ([metadata][task-meta]) | No dispatcher found. [Provider reducer][provider-reducer] removes providers, [shared reducer][provider-meta] unlinks active tasks, and [archive handler][archive-handler] unlinks archived tasks. Current dialog deletion emits the singular action. | **Unreachable currently**; not one of the four independent bulk-delete admissions.                                                                                                |

### Already admitted, and history-dependent stops

The other ten plural-ID creators must not be counted as newly unsupported:

| Actions                                                                     | Caller / write set / live coverage                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deleteTasks`, `deleteTags`, `deleteTaskRepeatCfgs`, `deleteSimpleCounters` | [Task][task-service], [tag][tag-service], [repeat][repeat-service] and [counter][counter-service] services dispatch deletes. Entity removal and established relationship/archive cleanup remain atomic; [preflight and scoped-delete preservation][gate] explicitly admit these four, not every Delete action.                                                       |
| `moveToArchive`                                                             | [TaskService][task-service] archives task trees; active task removal plus archive writes. Dedicated archive-win recreation, mixed winners and partial archive preservation. [Archive E2E][archive-e2e] covers ordinary archive/edit and overlapping cross-device archives.                                                                                           |
| `planTasksForToday`, `planDeadlineTasksForToday`                            | [Due effects][due-effects] and task/planner UI; [scheduling reducer][scheduling] writes due fields and lists. [Scoped plan replacement][plan-preservation] and remote mixed-winner compensation are explicit paths; [Today E2E][today-e2e] covers planner preservation.                                                                                              |
| `moveTaskInTodayTagList`, `removeTasksFromTodayTag`                         | Planner drag/work-context UI; [scheduling][scheduling] and [task][task-reducer] reducers write ordering, not Today membership. Existing ordering-only admission; [Today integration][today-test] is narrower evidence than a claim about all reorders.                                                                                                               |
| `roundTimeSpentForDay`                                                      | [TaskService][task-service] finish-day rounding plus archive service. Task time values and derived parent totals; local reconciliation and validated remote mixed-winner replay. [Round-time E2E][round-e2e] covers the real flow. Remote payload/declared-ID mismatch remains blocked; existing comments document bounded time divergence, not perfect convergence. |

Additional surviving conditions are not new creator families:

- **Live history, integration evidence only:** two distinct pending bulk archives
  sharing a conflicted task (archive → restore → re-archive), or a local bulk
  archive overlapping a local bulk delete, then a remote edit of that task.
  [Preflight][gate] rejects the **local** compound history. This is not the
  already-handled one-archive-per-device crossing; swapping which device holds
  the compound history still leaves the stop on that device. The negative
  [archive integration][archive-test] mocks store/applier; no exact real-app
  regression for these histories was located.
- **Demonstrated real-app safety behavior:** an S2 reorder, or a pending
  `COUNTER_SET_TODAY`, without the unique retained/applied commuting remote row
  needed for causal replacement. The [superseded resolver][superseded] throws
  before its append/reject transaction, including for a single-ID count edit.
  S2's real-server interruption/compaction tests retain pending work over
  cancelled retries. This intentional safeguard is not a request to weaken
  evidence requirements or redesign retention.
- **Unverified secondary shapes:** synthetic TASK LWW operations can carry plural
  `projectMoveFootprint` IDs ([superseded producer][superseded], lines 600–617).
  A subsequent overlapping conflict is not broadly exempt. Other unsupported
  semantic operations can fall through the superseded resolver's primary-ID
  grouping (lines 500–570). That is not proof of safe generic coverage, nor a
  reproduced data-loss report. Historical/malformed ID-payload combinations
  outside predicates remain excluded. Investigate a concrete history before
  adding any guard or new recovery path.

## Smallest next step: reproduce the actual habit-grid crossing

The gap is precise: [grid `onCellClick`][habit-grid] always calls
`setCounterForDate` for click/repeated-countdown counters, and the
[count editor][counter-editor] also uses it. [Actions][counter-actions] and
[reducers][counter-reducer] show `COUNTER_SET_FOR_DATE` and
`COUNTER_SET_TODAY` both update one dated count, but
[S2][reorder] matches/projects only the latter. The existing habit E2E's direct
Set Today dispatch therefore does not cover the grid. No matching user report
was established; this recommendation rests on the current caller, not demand
inferred from #10264.

Changing only the current dispatcher to Set Today would be a smaller diff, but
would leave pending and old-client For Date rows blocked. It would not meet the
historical-operation requirement.

1. **Reproduction first:** extend the existing reorder E2E with two enabled
   click-counter habits, an unedited sibling and a disabled habit. Sync two real
   clients; isolate their edits. A drags the enabled habits; B clicks a real grid
   cell, first for today and then for a past date. Assert the captured edit is
   `[Simple Counter] Set SimpleCounter Counter For Date` with payload fields
   `id`, `date`, `newVal`, and that the order row lists at least two actual IDs. Upload B
   before A. Repeat with pending local count versus incoming reorder, and both
   timestamp orders. Use the existing strict sync helper: fail on the safety
   dialog, never auto-select Keep remote. Record baseline failure before any
   production change; inability to reproduce is a reason to revisit the claim.
2. **Conditional implementation boundary:** the first task can own only the
   focused E2E/integration reproduction. If it fails as predicted, a separate
   bounded fix should inspect `reorder-conflict.util.ts`, its two resolver callers
   and the existing reorder specs. Prefer extending the existing exact
   order/count predicate and dated-count projection over a new abstraction.
   Preserve the For Date action and `date` payload on reissue; do not rewrite it
   as “today,” admit all counter updates, or change capture metadata. No reducer,
   package, schema, protocol, journal or persistence redesign is justified here.
3. **Preservation and convergence:** both clients must retain the edited day's
   value, other dates, every habit setting and `type`, unedited siblings,
   disabled-habit state/slots and unique membership, and agree on an ordering.
   Either converged enabled order is acceptable; do not assert a stronger order
   policy. Validate both local/remote directions and timestamp winners, pending
   operation retirement and no new REPAIR/SYNC_IMPORT/BACKUP_IMPORT. Ordinary
   habit configuration, competing reorders and unrelated counter deltas remain
   separate crossings.
4. **Replay and missing evidence:** reload both established clients and a fresh
   client replaying accepted history; integration must also replay rejected
   originals followed by their replacements. Extend S2's interrupted-upload /
   compaction scenario to the new count action, including a StopWatch count
   edited through its real dialog, to expose `type` loss rather than letting
   default-field repair mask it. Reproduce any additional safety guard before
   adding it; without causal proof preserve pending intent across cancelled
   retries. This is not permission to reconstruct missing history.
5. **Released clients:** exercise both histories with an unmodified released
   client that actually emits For Date; record artifact provenance. The current
   resolver must emit an existing action/envelope that old receivers replay
   correctly, with no version bump. Cover receiving after restart and document
   the old-client-resolves-first limitation. S2's released-client execution was
   for notes, so it is not habit compatibility evidence. An E2E exception does
   not apply: this flow is directly reachable in the app.

Issue-provider order versus a full provider-dialog update is another clear
source-backed case, but adds an ordering family. Bulk task/section cases involve
archive or relationship preservation. Neither should enlarge this next task.

## Severity, evidence and validation

This is a **sync availability failure with a data-preserving safety stop** on the
inspected preflight paths, not demonstrated silent loss for the proposed habit
crossing. The [wrapper][wrapper] surfaces an error/Resolve action on background
sync and the dataset-conflict dialog on manual sync. Choosing a whole-dataset
winner can discard the other side's independent work; designing that fallback
is Phase 2 item 3, not this audit. Do not downgrade a reachable case because it
is found by audit or is on master ([severity guide][severity]).

`git tag --contains 5e754d355` returned release tags from v18.15.0 through
v19.1.0, establishing release presence of the **gate only**. This report makes
no release-containment claim for each residual crossing. [#9405][issue-9405]
and its discussion identify a real Today-planning stop subsequently fixed;
the original recurring-task report never established `updateTasks` as its cause.
It is not evidence that the archive integration reproduces that user's failure.

- **Inspected existing evidence, not rerun:** [S2 result][s2-result] records 19
  real-server E2Es, 49 focused integrations and 402 resolver/rejection-handler
  checks on its final source commit. Read the current E2E and
  [real-store integration][reorder-integration]: positive crossings, three
  exclusion cases, compaction and note
  compatibility. Their existence/recorded results do not validate For Date.
- **Evidence limits:** `unsupported-multi-entity-conflict.integration.spec.ts`
  uses real archive/capture/IndexedDB/resolution but mocked Store and applier.
  The overlapping-history archive negatives also mock them. The S2 negative
  integration uses real reducers/applier/storage, but constructed operations
  rather than a browser/server user flow. None is promoted to a new E2E finding.
- **Checks for this report:** audited-source ID enumeration and caller searches;
  upstream PR/ancestry verification; pinned source-path/line-reference checks;
  targeted Markdown link and Prettier checks; `git diff --check`. No application
  unit, integration or provider suite was launched for this documentation inventory;
  runtime behavior of the new candidate remains unverified.
- **Open questions:** does the real grid crossing fail exactly as the call graph
  predicts in both directions, and can the existing causal projection preserve
  it through compaction and released-client replay? These gate the next fix.

[pr-s2]: https://github.com/super-productivity/super-productivity/pull/10275
[pr-s4b3]: https://github.com/super-productivity/super-productivity/pull/10284
[pr-s5]: https://github.com/super-productivity/super-productivity/pull/10287
[issue-9405]: https://github.com/super-productivity/super-productivity/issues/9405
[plan]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/docs/plans/2026-09-26-sync-architecture-review.md#phase-2--close-the-fail-closed-surface-locally-option-e
[s2-result]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/docs/plans/2026-09-26-sync-S2-result.md
[severity]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/docs/sync-and-op-log/sync-severity-triage.md
[capture]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/op-log/capture/operation-log.effects.ts#L297-L339
[extractor]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/op-log/capture/operation-capture.service.ts#L24-L33
[ids]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/op-log/util/get-op-entity-ids.util.ts#L1-L28
[detect]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/op-log/sync/conflict-resolution.service.ts#L4274-L4451
[gate]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/op-log/sync/conflict-resolution.service.ts#L2484-L2594
[preflight-call]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/op-log/sync/conflict-resolution.service.ts#L2068-L2098
[reorder]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/op-log/sync/reorder-conflict.util.ts
[superseded]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/op-log/sync/superseded-operation-resolver.service.ts
[section-predicate]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/op-log/sync/section-conflict-commutativity.util.ts#L218-L251
[task-meta]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/root-store/meta/task-shared.actions.ts
[task-actions]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/tasks/store/task.actions.ts
[task-service]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/tasks/task.service.ts
[task-reducer]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/tasks/store/task.reducer.ts
[config-effect]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/config/store/global-config.effects.ts#L157-L203
[repeat-effect]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/task-repeat-cfg/store/task-repeat-cfg.effects.ts#L748-L800
[repeat-move]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/tasks/task-move-to-project.service.ts#L72-L110
[archive-service]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/archive/task-archive.service.ts
[archive-handler]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/op-log/apply/archive-operation-handler.service.ts
[rest]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/core/electron/local-rest-api-handler.service.ts#L903-L958
[navigation]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/core-ui/navigate-to-task/navigate-to-task.service.ts#L274-L303
[crud]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/root-store/meta/task-shared-meta-reducers/task-shared-crud.reducer.ts#L799-L934
[section-meta]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/root-store/meta/task-shared-meta-reducers/section-shared.reducer.ts
[counter-actions]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/simple-counter/store/simple-counter.actions.ts
[counter-reducer]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/simple-counter/store/simple-counter.reducer.ts#L114-L183
[counter-service]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/simple-counter/simple-counter.service.ts
[counter-editor]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/simple-counter/dialog-simple-counter-edit/dialog-simple-counter-edit.component.ts#L234-L252
[habit-grid]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/simple-counter/habit-tracker/habit-tracker.component.ts#L112-L166
[provider-actions]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/issue/store/issue-provider.actions.ts
[provider-panel]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/issue-panel/issue-panel.component.ts#L121-L144
[provider-dialog]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/issue/dialog-edit-issue-provider/dialog-edit-issue-provider.component.ts#L241-L264
[provider-reducer]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/issue/store/issue-provider.reducer.ts#L192-L226
[provider-meta]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/root-store/meta/task-shared-meta-reducers/issue-provider-shared.reducer.ts#L16-L71
[note-actions]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/note/store/note.actions.ts
[notes-ui]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/note/notes/notes.component.ts#L87-L105
[note-ui]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/note/note/note.component.ts
[note-service]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/note/note.service.ts#L62-L104
[note-reducer]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/note/store/note.reducer.ts#L78-L129
[project-actions]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/project/store/project.actions.ts#L64-L77
[project-service]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/project/project.service.ts#L447-L449
[project-reducer]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/project/store/project.reducer.ts
[board-actions]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/boards/store/boards.actions.ts
[boards-ui]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/boards/boards.component.ts#L103-L167
[board-reducer]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/boards/store/boards.reducer.ts#L139-L230
[section-actions]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/section/store/section.actions.ts
[section-reducer]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/section/store/section.reducer.ts
[section-service]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/section/section.service.ts#L65-L94
[work-view]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/work-view/work-view.component.ts#L627-L637
[work-view-html]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/work-view/work-view.component.html#L200-L209
[task-list]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/tasks/task-list/task-list.component.ts#L606-L631
[plugin-allow]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/plugins/allowed-plugin-actions.const.ts
[plugin-bridge]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/plugins/plugin-bridge.service.ts#L881-L944
[repeat-actions]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/task-repeat-cfg/store/task-repeat-cfg.actions.ts
[repeat-service]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/task-repeat-cfg/task-repeat-cfg.service.ts#L113-L133
[repeat-reducer]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/task-repeat-cfg/store/task-repeat-cfg.reducer.ts#L83-L88
[tag-actions]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/tag/store/tag.actions.ts
[tag-service]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/tag/tag.service.ts#L86-L94
[tag-reducer]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/tag/store/tag.reducer.ts#L360-L389
[tag-meta]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/root-store/meta/task-shared-meta-reducers/tag-shared.reducer.ts#L330-L377
[due-effects]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/features/tasks/store/task-due.effects.ts#L277-L303
[scheduling]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/root-store/meta/task-shared-meta-reducers/task-shared-scheduling.reducer.ts#L349-L414
[plan-preservation]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/op-log/sync/preserve-partial-bulk-plan.util.ts
[wrapper]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/imex/sync/sync-wrapper.service.ts#L1137-L1172
[reorder-e2e]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/e2e/tests/sync/supersync-reorder-conflict-wedge.spec.ts
[reorder-integration]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/op-log/testing/integration/reorder-conflict-wedge.integration.spec.ts
[unsupported-test]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/op-log/testing/integration/unsupported-multi-entity-conflict.integration.spec.ts
[archive-test]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/op-log/testing/integration/archive-conflict-resolution.integration.spec.ts#L1305-L1400
[archive-e2e]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/e2e/tests/sync/supersync-archive-conflict.spec.ts
[section-e2e]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/e2e/tests/sync/supersync-section-convergence.spec.ts
[today-e2e]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/e2e/tests/sync/supersync-today-plan-mixed-winner.spec.ts
[today-test]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/src/app/op-log/testing/integration/today-plan-conflict-resolution.integration.spec.ts
[round-e2e]: https://github.com/super-productivity/super-productivity/blob/f84259fcaa66a9bb9512d1c048a299d230740c04/e2e/tests/sync/supersync-round-time-conflict.spec.ts
