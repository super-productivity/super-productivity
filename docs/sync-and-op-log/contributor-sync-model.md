# The Contributor Sync Model

**The one thing to understand before writing any effect, reducer, or bulk
dispatch that touches synced state.**

Super Productivity syncs by replaying an operation log. Almost every sync
correctness rule you will hit is a facet of a **single invariant**:

> ## Each replay-atomic transition (normally one persistent action) = exactly one operation. Replayed and remote operations must never re-trigger effects.

“Intent” here means the transition that must remain indivisible during replay,
not necessarily an entire multi-step UI workflow. A workflow may deliberately
compose independent persistent actions when their normal local side effects and
per-entity conflict boundaries are part of the required behavior.

Reducers **must** run for remote/replayed operations (that is how state is
rebuilt). Effects **must not** — the UI side effect (snack, sound, navigation)
already happened on the originating client, and every persistent transition the
workflow deliberately emitted already has its own entry in the operation log.
Re-running effects on replay duplicates side effects and emits phantom
operations that conflict with sync.

Everything below is that invariant applied at three points.

**Sections:** [Boundary 1 — The action boundary](#boundary-1--the-action-boundary) · [Boundary 2 — The selector boundary](#boundary-2--the-selector-boundary) · [The atomicity rule — one replay-atomic transition, one op](#the-atomicity-rule--one-replay-atomic-transition-one-op) · [Conflict resolution — stay on generic paths](#conflict-resolution--stay-on-generic-paths) · [Fix intake — evidence before a fix](#fix-intake--evidence-before-a-fix) · Clearing a field — `undefined` does not survive the wire (#9776) · [Decision table — "I'm writing an effect"](#decision-table--im-writing-an-effect) · [The sync-epoch fence (#9074)](#the-sync-epoch-fence-9074) · [Why (deeper)](#why-deeper)

Line numbers: `rg -n '^#{1,3} ' <this file>`, then read one section with `sed -n`.

---

## Boundary 1 — The action boundary

**Effects inject `LOCAL_ACTIONS`, never `inject(Actions)`.**

`LOCAL_ACTIONS` is the standard actions stream with `meta.isRemote` filtered
out (`src/app/util/local-actions.token.ts`). Remote/replayed operations are
applied as one `bulkApplyOperations` action; `LOCAL_ACTIONS` ensures your effect
only sees genuine local user intent.

- Default for **all** effects: `private _actions$ = inject(LOCAL_ACTIONS);`
- The only legitimate exceptions use `ALL_ACTIONS`: `operation-log.effects.ts`
  (captures/persists every action, handles `isRemote` itself) and
  `reducer-failure-snack.effects.ts` (surfaces rejected actions, which
  `LOCAL_ACTIONS` hides by design, #10195). You are almost certainly not adding
  a third.
- Remote **archive** side effects are _not_ an `ALL_ACTIONS` case:
  `archive-operation-handler.effects.ts` itself uses `LOCAL_ACTIONS`; the
  remote-client archive writes/deletes are driven separately by
  `OperationApplierService` → `ArchiveOperationHandler`.

✅ **Enforced by `local-rules/no-actions-in-effects`** — you cannot get this
wrong; the linter rejects `inject(Actions)` / `Actions` imports in
`*.effects.ts`.

**A reducer throw on a local action is boxed, marked, not captured, and not
fed to `LOCAL_ACTIONS` (#10195).** `reducerFailureGuardMetaReducer` (index 0 of
`META_REDUCERS`) catches the throw, returns the previous state, marks the
action instance rejected, and reports via `devError`. Without it the throw
escapes the NgRx `State` scan and silently freezes the store: every later
dispatch — including bulk-applied remote ops the op log already marks applied —
is dropped until restart. Capture builds operations from action payloads, so
`persistOperation$` and `LOCAL_ACTIONS` both skip rejected actions
(`isReducerRejectedAction`): no op is uploaded for a state change that never
happened, and no `ofType` effect runs side effects for it. Nothing is retried;
the user sees an error and state stays consistent. Do not rely on the box as a
correctness tool — a reducer that can throw on a stale UI-held id
(`getTaskById` after a remote archive) should still guard and return state.

Because the app now survives that throw, **a meta-reducer that writes
module-level state must commit it last — after the inner reducer and anything
else that can throw, `devError` included (it throws in dev builds when
confirmed).** Writing first leaves the module describing a rejected action:
`undoTaskDeleteMetaReducer` once captured `lastDeletePayload` before the delete
reducer, so a rejected delete made an open undo snack restore a task that was
never deleted — a synced write.

**The reducer-side mirror: a reducer handling a _non-persistent_ action must
not write synced entity fields.** Capture builds operations from action
payloads, not from state diffs, so such a write never becomes an op — the local
device drifts from every other device with no conflict to detect, and
`getPhantomChangeRisk()` cannot see it either. Not lint-enforced. If a
UI-pointer action (`setCurrentTask`, `setSelectedTask`, …) needs to change task
data, dispatch a persistent action from a `LOCAL_ACTIONS` effect instead
(`TaskInternalEffects.reopenStartedDoneTask$`, #9904).

## Boundary 2 — The selector boundary

**Selector-driven mutating effects must guard the sync window. Choose whether
the source may be dropped or must be deferred.**

An effect that reacts to a _selector_ (store state) instead of a specific
_action_ bypasses Boundary 1 entirely — it fires on every store change,
including hydration and sync replay. Two timing gaps (initial startup before
first sync; the post-sync re-evaluation window) make such effects emit
operations with stale vector clocks that immediately conflict.

- Use `skipDuringSyncWindow()` only for a **level/repeating** source whose next
  emission safely retries the work. It deliberately drops emissions.
- Use `waitForSyncWindow()` for a **sparse or edge-triggered** source when a
  dropped emission cannot be recovered. A store selector normally ends in
  `distinctUntilChanged()`, so the value that changed during sync may never
  re-emit after the window closes.
- **`waitForSyncWindow()` does not gate initial sync.** It observes only
  `HydrationStateService.isInSyncWindow()`, so it passes immediately when that
  window is closed even if the initial-sync gate has not opened.
  `skipDuringSyncWindow()` is different: it also checks
  `SyncTriggerService.isInitialSyncDoneSync()`. A sparse mutating effect that
  must wait for startup sync therefore needs both gates:

  ```typescript
  return this._syncTriggerService.afterInitialSyncDoneStrict$.pipe(
    first(),
    switchMap(() =>
      sparseSource$.pipe(
        // Capture all state required by the edge before deferring it.
        map((edge) => captureRequiredState(edge)),
        waitForSyncWindow(this._hydrationState, 'MyEffects:mutatingEffect$'),
        // ...perform the mutation
      ),
    ),
  );
  ```

  This is the established composition used by
  `TaskDueEffects.createRepeatableTasksAndAddDueToday$` and
  `TaskRepeatCleanupEffects.cleanupDuplicateRepeatInstances$`. Use
  `afterInitialSyncDoneAndDataLoadedInitially$` instead only when its
  non-strict UI-readiness semantics are intentional; neither gate is proof
  stronger than the failsafes documented by `SyncTriggerService`.

- Before waiting, combine/map the edge with every piece of state needed to
  handle it. Process that captured snapshot after the window closes; do not
  wait and then reconstruct an already-passed edge from unrelated live state.
  `waitForSyncWindow()` keeps only the latest pending value, so it is not the
  right operator when every individual emission must be preserved.
- `waitForSyncWindow()` is fail-open after 30 seconds: it logs the timeout and
  emits even if the sync window is still active. It prevents a sparse trigger
  from being lost during ordinary short syncs, but it is **not** a hard
  mutual-exclusion boundary. If a mutation must never overlap replay, prefer a
  `LOCAL_ACTIONS`-driven effect or redesign it around a fail-closed boundary
  rather than relying on this operator.
- The narrower `skipWhileApplyingRemoteOps()` /
  `HydrationStateService.isApplyingRemoteOps()` exist for finer control.
- **Prefer action-based effects.** A selector-based effect is the
  intuitive-but-usually-wrong choice; reach for it only when there is no
  action to key off.

✅ **Enforced by `local-rules/require-hydration-guard`** (existing rule).

## The atomicity rule — one replay-atomic transition, one op

**Multi-entity changes are meta-reducers, not effects. Bulk dispatch loops need no yield.**

- A transition that must replay atomically and touches more than one entity
  (e.g. deleting a tag also removing it from every task) must be **one reducer
  pass** so it becomes **one operation**. Put it in
  `src/app/root-store/meta/task-shared-meta-reducers/`, not in an effect that
  dispatches a fan-out of follow-up actions. An effect-based fan-out emits N
  operations for one atomic transition _and_ re-runs on replay (a restatement
  of Boundary 1).
- Do not collapse a broader UI workflow merely because it starts with one user
  gesture. Independent actions are appropriate when their normal local effects and
  entity-specific conflict boundaries matter. Project completion intentionally
  resolves tasks through ordinary per-task actions before flipping the project
  flag, accepting an unbounded N+1 operation count and a brief intermediate state.
  That is a known scalability residual for this rare semantic exception, not a
  precedent for new bulk fan-out; see
  [ADR #5: Project Completion](../../ARCHITECTURE-DECISIONS.md#5-project-completion-decoupled-resolution-over-atomic-multi-entity-op).
- `store.dispatch()`, NgRx reducers and op capture run synchronously; only
  the op-log write is asynchronous, and it takes its vector clock under the
  operation-log lock in dispatch order (`concatMap`). A loop of dispatches
  therefore needs no post-loop `await new Promise((r) => setTimeout(r, 0))`:
  with the yields removed, no op among 50, 200 or 500 dispatches was lost,
  reordered or left unpersisted through the real store, IndexedDB op log,
  restart and a SuperSync round trip (measured 2026-10 in a single tab without
  lock timeouts, #10441). A yield never chunked reducer work, never reduced the
  N+1 upload amplification, and never waited for writes. Existing yields are
  harmless; remove one only in a change that already touches that loop and
  its tests. In new
  code, prefer one meta-reducer action (no loop), or, where a loop is
  unavoidable and a follow-up depends on its ops, await
  `OperationWriteFlushService.flushPendingWrites()`, which resolves once every
  captured op's write attempt has completed (do not call it while holding the
  operation-log lock).

⚠️ `local-rules/no-multi-entity-effect` (`warn`) flags this heuristically — it
catches the array-literal fan-out shape (`map(() => [a(), b()])`), not every
multi-entity dispatch (e.g. a `of(a(), b())` varargs fan-out slips past). The
blessed pattern is a `task-shared-meta-reducers/` reducer.

---

## Conflict resolution — stay on generic paths

Operations are replayed intents, but conflicts are detected and resolved per
**declared** entity (`getOpEntityIds`). That mismatch fails in two ways:

- **Undeclared writes.** Conflict detection never sees a write the op does not
  declare (a parent's list, a sibling, another entity type), and entity-level
  LWW cannot restore it. Each such write that can meet a concurrent edit needs
  hand-written compensation, or the devices diverge silently.
- **The fail-closed stop.** An op that declares more than one entity id is a
  multi-entity op (`isMultiEntityOperation`). When it meets a concurrent edit
  of a declared entity and no resolution path admits it,
  `_assertMultiEntityPlansAreSafe` throws `UnsupportedMultiEntityConflictError`.
  Sync stops until the user picks a side in the whole-dataset "Keep local /
  Keep remote" dialog.

Multi-entity and intent conflict resolution is the largest root-cause category
of sync fix code: 51 fixes, ~7.4k net production lines and ~23.9k test lines
added (measured 2026-09 in
[the architecture review](../plans/2026-09-26-sync-architecture-review.md)
§2.2; an upper bound, as the category also caught generic LWW fixes).

1. **Prefer a generic resolution path.** Route a conflict fix through an
   existing generic mechanism: the field patch
   (`conflict-field-patch.util.ts`), derived membership, or an admission set
   that `_assertMultiEntityPlansAreSafe` checks, when the action meets the
   set's documented contract (e.g. `SCOPED_PLAN_MULTI_ACTIONS`). Per-action
   resolution logic (an `ActionType` branch, predicate or projection written
   for one action, as in `reorder-conflict.util.ts`) is the last resort. Use
   it only when no generic path fits, as the smallest safe change, including
   what released clients do with the ops you emit
   ([ADR #8](../../ARCHITECTURE-DECISIONS.md#8-additive-data-model-evolution-over-schema-bumps)),
   and say in the PR why none fits. Whatever the path, prove convergence and
   content preservation in **both** conflict directions (the change pending
   locally against the remote edit, and the reverse) with an E2E, and check
   both timestamp winners. Also run `npm run sync-fuzz:compare` and put its
   output in the PR. A seed that newly shows a failure signature against the
   base is a regression until its original seed shows otherwise: first
   compare that seed's executed steps and final field values on both
   revisions (the tool prints both for every newly failing seed). The values
   cover one device's live tasks, notes and habits, not the other devices or
   the archive: the same steps reaching the same values clears an entry only
   when its signature is about those fields on that state. A divergence,
   restart, time or archive entry still needs its original seed compared on
   both revisions, and different values are the change's effect and need an
   explanation. Use a shrunk trace
   only to diagnose: shrinking can remove the interaction that made the seed
   worse, so a shrunk trace that fails the same way on the base does not clear
   the entry. The pinned traces miss a known failure that becomes more
   frequent (#10398).
   Admitting an action or removing a safety stop without that proof is not a
   fix (#10264). The `max-lines` cap on
   `conflict-resolution.service.ts` in `eslint.config.js` only goes down, but
   its `*.util.ts` helpers are uncapped.
2. **Don't add denormalized lists or undeclared cross-entity writes.** Store
   the fact on the child (`task.dueDay`, `task.parentId`, `note.projectId`) and
   derive the list, as `TODAY_TAG` does
   ([ADR #2](../../ARCHITECTURE-DECISIONS.md#2-today_tag-virtual-tag-pattern)).
   A new child field must be [optional](./persisted-model-fields.md). A new
   list on a parent turns every child edit into a potential multi-entity
   conflict. Existing lists stay, because released clients read and write
   them: a child field that shadows one goes stale (review §4.2), and a new
   action that must update one should reuse the action that already maintains
   it. True multi-entity transitions that no child fact can express, such as a
   delete cascade, still follow the atomicity rule above. One recorded
   exception: an LWW recreate of a NOTE re-adds it to `project.noteIds` and,
   when pinned, `note.todayOrder` without declaring PROJECT, the inverse of
   `deleteNote`'s own undeclared write, as the TASK recreate does for
   `project.taskIds` (#10380, decided on #10393).
3. **No new crossing may reach the fail-closed stop.** A PR that adds a
   multi-entity action, or changes what one declares or writes, names the path
   that resolves its conflicts with concurrent edits of every entity it
   declares, and covers it with an E2E. If a new action has no such path,
   change its shape (one declared entity, the fact on the child) instead of
   compensating for it. Check new edits too: editing a reordered note outside
   the commuting predicate in `reorder-conflict.util.ts` stops sync against a
   pending `updateNoteOrder`. Specs that pin today's stops:
   `src/app/op-log/testing/integration/unsupported-multi-entity-conflict.integration.spec.ts`
   and, for reorders,
   `src/app/op-log/testing/integration/reorder-conflict-wedge.integration.spec.ts`.
   [The remaining-actions audit](../plans/2026-09-26-sync-remaining-conflict-actions-audit.md)
   inventories the known stops as of 2026-09-26; #10294 and #10295 have since
   resolved two of the crossings it lists.

---

## Fix intake — evidence before a fix

Most sync fix code has come from our own audits, not from users. Of the 45
largest sync fixes between the op-log merge (2026-01-11) and 2026-09-26, 27
(+10.9k production lines) came from audit findings and hardening passes and 11
(+4.0k) from user reports (measured 2026-09 in
[the architecture review](../plans/2026-09-26-sync-architecture-review.md)
§2.2). A fix in this area tends to reveal the next edge case, so fixing
everything an analysis can find keeps the fix rate high without evidence that
users are harmed.

A sync fix lands only for one of:

- **A user report** of the problem.
- **A regression on unreleased master** (`git tag --contains <commit>` prints
  nothing). Revert the change that introduced it first, unless the revert
  brings back a bug that a released version has; then fix forward with the
  narrowest change.
- **Data loss, a sync stop, or permanent content divergence** on a path that
  released clients or default settings take, shown by a reproduction: an E2E,
  or a fuzz seed that fails on every replay. Order-only differences, and
  disagreement that the next sync repairs, do not qualify.

Everything else found by audits, reviews, fuzzing or reading code becomes an
issue with the reproduction and the affected path, not a PR. Among fixes that
qualify, prefer the one that removes a special case or adds the least ongoing
machinery, and say in the PR which category the fix meets.

**Flow limit.** At most five sync PRs are open at a time (raised from three
by the maintainer on 2026-09-30, #10393), so the next fix is not built on a
pile of unchecked ones. Further work waits as a draft PR or an issue.

- A contributor's sync PR counts toward the cap only once it is ready: no
  "needs work" label and CI green.
- The maintainer may exclude individual PRs that do not touch sync logic
  (on 2026-09-30: a Docker build change and two server-config PRs, #10218,
  #10297 and #10301).

**Review and improve.** Before a sync PR is marked ready, the work session
runs a review-and-improve subagent with fresh context:

- It gets only the branch, the diff, the tracker issue and
  [the feature review guide](../feature-review-guide.md), not the session's
  reasoning, so it checks the PR rather than the author's argument for it.
- It verifies the PR's claims by running the tests and checks the PR cites,
  and fixes on the branch what makes sense.
- It reports every finding as **fixed** or **not fixed** (with a reason).
- The outcome goes in a "Review" section of the PR body. Do not post it as
  review comments on the PR.

An agent session does not approve its own sync PR.

---

## Clearing a field — `undefined` does not survive the wire (#9776)

**Never rely on `changes: { someField: undefined }` reaching another device.**
`JSON.stringify` drops undefined-valued keys from the op payload (SuperSync
HTTP/E2EE, file-based providers, the SQLite op-log — everything except the
IndexedDB structured clone), so a reducer that applies `changes` verbatim
replays the clear as a no-op remotely. The local device looks correct, which is
exactly why this class of bug survives testing.

Safe patterns, in order of preference:

1. **Set the `undefined` inside a reducer/meta-reducer** keyed off a dedicated
   action whose payload carries only ids (e.g.
   `TaskSharedActions.dismissReminderOnly` → `remindAt: undefined` in the
   reducer). Deterministic on replay; nothing to serialize.
2. **Rebuild `changes` from destructured payload fields** — a dropped key
   destructures back to `undefined` identically (e.g. `scheduleTaskWithTime`).
3. For generic `Update<T>` actions, **list cleared keys out-of-band**: the
   action creator adds `clearedFields` via `clearedFieldsProps()` and the
   reducer restores them with `applyClearedFields()`
   (`src/app/util/cleared-update-fields.ts`; used by `updateTaskUi` and
   `updateTaskRepeatCfg`). Old clients ignore the extra prop, so the clear
   degrades to a no-op there instead of corrupting state — no schema bump.

On the conflict-resolution side, `createLWWUpdateOp` never lists
`clearedFields` unless the call site opts in via `listClearedFields` — today
only field patches do (conflict-field-patch.util.ts): the resolution patch
re-declares clears the conflicting ops themselves carried, and the superseded
and surviving-field patches read live state for exactly the fields the local
ops wrote, so an absent one there is a clear those ops declared. (`asPatchSnapshotIfTypeShadowed` separately sends a whole
habit snapshot as a patch, so released receivers keep their **own** `type`
instead of dropping it; every optional field missing from a full snapshot is a
real clear, so it lists them. v18.15.0–v18.21.1 ignore `clearedFields`.)
Partial patch payloads built from **live state** (e.g.
`taskRelationshipPatch`) materialize accidental `undefined` keys — every root
task's `parentId` — and must never opt in: listing those would broadcast a
real clear to receivers (pinned by tests (a0c) in
`conflict-resolution.disjoint-merge.spec.ts` and the relationship follow-up
pin in `conflict-resolution.service.spec.ts`).

Do **not** invent in-band sentinels (`null`, `0`, marker strings): remote
reducers apply payload values verbatim, so released clients would persist the
sentinel and fail typia state validation.

---

## Decision table — "I'm writing an effect"

| Question                                                        | Answer                                                                                                    | Linter                                           |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Does it inject the actions stream?                              | Use `LOCAL_ACTIONS` (not `Actions`)                                                                       | ✅ `no-actions-in-effects` (error)               |
| Can a selector emission be safely retried by the next emission? | Drop it with `skipDuringSyncWindow()`                                                                     | ✅ `require-hydration-guard` (error)             |
| Is the selector emission a sparse/unrecoverable edge?           | Enter through the required initial-sync gate, capture its state, then defer it with `waitForSyncWindow()` | ✅ window guard only; initial gate is convention |
| Does one replay-atomic transition change **>1 entity**?         | Make it a meta-reducer, not an effect                                                                     | ⚠️ `no-multi-entity-effect` (warn)               |
| Does it dispatch in a **loop of 50+**?                          | Yield once afterward for capture ordering; it is not batching                                             | — (convention)                                   |

Two of the three are mechanically enforced — you do not need to memorize them,
only understand _why_ (the invariant at the top).

---

## The sync-epoch fence (#9074)

A sync cycle spans many `await`s; a destructive config change (provider/account
switch, folder move, encryption enable/disable/password change) can land in any
of those gaps. A stale cycle must not apply, upload, acknowledge, or advance the
cursor against the new target/epoch afterwards.

- `SyncProviderManager.syncEpoch` is a monotonic counter, bumped **after** each
  such change completes (and at `runWithSyncBlocked` entry, which additionally
  blocks new cycles first and then drains running ones, bounded). First-time
  setup (no previous config / first provider activation) does NOT bump — there
  is no old target to fence, and the bump would race the fresh config's first
  sync into a spurious abort.
- Every cycle reads the **(provider, epoch) pair in one synchronous block**
  (a switch swaps the object and bumps the epoch in one synchronous block on
  its side, so a same-block read is always consistent) and threads the epoch
  as `fenceEpoch`. Capturing earlier — e.g. at the cycle claim — lets a switch
  complete in the awaits between and hands the cycle the new provider with a
  stale epoch: a spurious abort of the first post-switch sync.
- Provider I/O is fenced in one place: `getOperationSyncCapable(provider,
{ fenceEpoch })` returns a per-cycle delegate that re-asserts the epoch before
  every provider call. Local writes (apply inside the lock closures, ack
  persists, hydration, migration appends, rejected-ops handling, rebuild resume)
  re-assert via `assertSyncEpochUnchanged` at the call site.
- A failed assert throws `SyncEpochChangedError`, handled at every entry point
  as a **benign abort** (no error snack, `UNKNOWN_OR_CHANGED`) — each abort
  point is crash-equivalent by design (deferred acks re-upload, a behind cursor
  re-downloads with dedup).

**An unthreaded flow is an UNFENCED flow**: `fenceEpoch: undefined` disables the
assert. When adding a new sync entry point, capture and thread the epoch; when
adding a new local write inside a cycle, add an assert before it. Deliberately
unthreaded today: `forceUploadLocalState` / the USE_LOCAL/USE_REMOTE
conflict-resolution flows (covered by the encryption flag + cycle guard), and
key-recovery config writes (content-only, must NOT bump).

---

## Why (deeper)

- **Contributor rules:** this document; the old
  [`operation-rules.md`](./operation-rules.md) path is now a compatibility
  pointer.
- **Architecture tour:**
  [`sync-architecture.html#local-intent`](./sync-architecture.html#local-intent),
  [`sync-architecture.html#remote-apply`](./sync-architecture.html#remote-apply)
- **Deep rationale:**
  [`operation-log-architecture.md`](./operation-log-architecture.md)
- **Source of truth:** `src/app/util/local-actions.token.ts`,
  `src/app/util/skip-during-sync-window.operator.ts`,
  `src/app/util/wait-for-sync-window.operator.ts`,
  `src/app/imex/sync/sync-trigger.service.ts`,
  `src/app/op-log/apply/hydration-state.service.ts`
