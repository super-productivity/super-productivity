# Project completion experience

**Date:** 2026-06-05 (rev. after multi-agent review)
**Status:** ✅ Implemented on `feat/completing-projects-48eeb4` — state layer, stats util, service, celebration + resolve dialogs, menu wiring, trophy badge on the archived page, translations, wiki. Verified: unit tests (reducer 34, selectors 4, stats 6) + existing specs (menu 10, service 12, page 5) green; dev build exit 0; eslint + int:test clean.
**Branch:** `feat/completing-projects-48eeb4`
**Scope:** Give projects a rewarding "done" state. The **append/merge** half ("fold a project's tasks into another") was split out to issue **#8032** after review (YAGNI-adjacent + materially heavier than first scoped).

## Problem

Two real friction points drive this:

1. **A complex chunk of work has no good home.** Today the options are a heavyweight permanent project, or a "mega task" with an ever-growing subtask list. The mega task feels bad: the parent is one perpetually-unchecked item hanging over you, and progress is buried inside it instead of visible as moving pieces.
2. **Finishing big work isn't rewarding.** The only end-state for a project is `isArchived` (`project.model.ts:15`, even marked `// TODO remove maybe`). Archiving is _"shove it out of sight"_ — semantically the opposite of celebrating a finish.

### Key insight — no nesting, no new entity

Both pains are about **a container you can _finish_**, not about hierarchy. Nesting projects-in-projects works against pain #2 (a sub-project inside a never-ending parent still leaves the parent hanging) and drags in aggregation/cascade/sync cost for little benefit. The lightweight "dump space" people want **is just a regular `Project`** with a missing lifecycle operation: **complete** it → reward + a place to look back. Grouping of related projects is already covered by the menu-tree **folders**; small breakdowns by nested subtasks. So this plan adds **one operation on the existing entity**, not a new type.

## Non-goals

- No nested/parent-child projects, no roll-up of time/progress from children.
- No new "mini project" entity or UI concept.
- No append/merge (→ #8032).
- No change to how archiving itself works — completion piggybacks on the `isArchived` flag for menu-hiding, but `isDone` stays a distinct flag so a celebrated finish ≠ a quiet archive.

## ⚠️ Correction from review — what archiving actually does

The first draft assumed completing→auto-archiving would run the `ArchiveOperationHandler` and move done tasks into the archive store. **That is false** and was verified against source:

- `archiveProject` is a pure `isArchived: true` flag flip (`project.reducer.ts:166-177`); the project archive _effects_ are commented out (`project.effects.ts:72`, "CURRENTLY NOT IMPLEMENTED").
- `archiveProject` is **not** in `ARCHIVE_AFFECTING_ACTION_TYPES` (`archive-operation-handler.service.ts:40-54`). Only `moveToArchive` / `deleteProject` etc. move tasks to IndexedDB.

**Implications that shape this plan:**

- A completed project's tasks **stay live** in the NgRx store. Archiving only hides the project from the active menu (via the `!isArchived` filters).
- ⇒ **Stats can be computed live** from the still-live tasks; no snapshot needed (decision below).
- ⇒ **Reopen is trivially safe** — tasks never left, so un-archiving fully restores the project. No archive-restore logic.
- ⚠️ Done tasks of a completed project remain visible in worklog/search/metrics. Acceptable (they're history), but noted.

## Resolved decisions

| # | Decision | Resolution |
| --- | --- | --- |
| Q1 | Auto-archive on complete | **Yes** — `completeProject` also sets `isArchived: true` ("complete and out of the way"). This is a flag flip only — menu-hiding, **no** task cleanup (see correction above). |
| Q2 | Unfinished tasks | **Prompt** (a plain confirm), default **Move to Inbox** with the count shown; plus "Mark them done" / "Cancel". |
| Q3 | Stats live vs. snapshot | **Compute live** — no `completionStats` field. The "mandatory snapshot" reason was based on the false archive premise. |
| Q4 | Completion surface | **Split:** `DialogConfirm` for the unfinished-task resolve step, then a **separate** celebration component. |
| Q5 | Trophy view | **No new page.** Add a "Completed on X" badge + live stats + **Reopen** to completed rows of the existing archived-projects page, and improve that page. |
| Q6 | Append/merge | **Deferred → #8032.** |

### Done vs. Archived — selector wiring (review-critical)

`isDone` ⇒ also `isArchived`. **Do NOT narrow `selectArchivedProjects`.** It feeds task-list filtering — `selectArchivedProjectIds` is consumed by `task.selectors.ts:104,181` (`selectTaskEntitiesInActiveProjects`, `selectAllTasksInActiveProjects` → Today/Overdue). Narrowing it to `isArchived && !isDone` would **leak completed projects' tasks back into Today/Overdue** (incl. done tasks still carrying `dueDay`/`dueWithTime`, Rule #5). Instead:

- **Keep** `selectArchivedProjects` = `isArchived` (covers completed too) → task filtering + menu-hiding stay correct, unchanged.
- **Add** `selectCompletedProjects` = `isDone` → highlights/filters completed rows on the trophy page.
- **Add** `selectPlainArchivedProjects` = `isArchived && !isDone` → page-only, if we want to visually separate "finished" from "shelved".
- **Reopen** clears `isDone` + `doneOn` **and** `isArchived: false` (returns to the active menu).

### Data model

Add to `ProjectBasicCfg` (`src/app/features/project/project.model.ts`), mirroring `Task` (`isDone` + `doneOn`):

```ts
export interface ProjectBasicCfg {
  title: string;
  isArchived?: boolean;
  isDone?: boolean; // NEW — completed (also implies isArchived)
  doneOn?: number | null; // NEW — completion timestamp (ms)
  isHiddenFromMenu?: boolean;
  // ...
}
```

Both new fields **optional** → forward-compatible for sync (typia accepts missing optional fields; only new _required_ fields / literal-union members break old clients; verified `createValidate` does not reject excess props). Default in `DEFAULT_PROJECT` (`project.const.ts:11`): `isDone: false, doneOn: null`. `INBOX_PROJECT` can never be completed (guard like archive). **plugin-api note:** `ProjectCopy` extends the plugin-api `Project`; the new fields live on the app-side `ProjectBasicCfg` and compile fine without touching `packages/plugin-api`. Plugins won't see completion state — intentional (matches non-goals); revisit only if a plugin needs it.

### Sync-correctness (CLAUDE.md rules)

- **`completeProject` / `reopenProject` are plain project Updates** (`OpType.Update`, `entityType:'PROJECT'`), modeled exactly like `archiveProject` (`project.actions.ts:76-100`) → captured by the op-log capture effect automatically via `meta`. **Add `ActionType` enum entries** (`action-types.enum.ts`, section P) — the immutable wire format (review caught this omission).
- **Must NOT** be added to `ARCHIVE_AFFECTING_ACTION_TYPES`.
- **The celebration effect injects `LOCAL_ACTIONS`** (Rule #1) → a remote/replayed `completeProject` never pops a dialog / fires confetti on another device.
- **`doneOn` is computed at the call site** (via `DateService`) and passed as a prop — never `Date.now()` in the reducer (Rule #4).
- **LWW note (accept):** a concurrent remote `updateProject` (e.g. rename) vs local `completeProject` resolves by coarse whole-entity LWW — same as `archiveProject` today; completion has no archive-win protection, so it _can_ be lost to a concurrent unrelated edit. Not a regression; documented.

---

## Implementation

### 1. State + actions

- `project.actions.ts`: add `completeProject({ id, doneOn })` and `reopenProject({ id })` (mirror archive, `OpType.Update`). Add matching `ActionType` enum entries.
- `project.reducer.ts` (next to archive cases `:166-189`):
  - `completeProject` → `{ isDone: true, doneOn, isArchived: true }`.
  - `reopenProject` → `{ isDone: false, doneOn: null, isArchived: false }`.
  - Guard `INBOX_PROJECT`.
- `project.selectors.ts`: add `selectCompletedProjects` + `selectPlainArchivedProjects` (see selector wiring above). **Leave `selectArchivedProjects` unchanged.**
- `project.service.ts`: `complete(id)` / `reopen(id)` wrappers (mirror `archive()`/`unarchive()` `:145`).

### 2. Completion flow

Trigger: a "Complete project" item in the project context menu (`work-context-menu.component.{ts,html}:79-111`), beside Archive. Order/group it and add microcopy so "Complete" vs "Archive" is legible (both end up `isArchived`; only one celebrates).

1. **Resolve unfinished tasks** (only if any undone tasks across `taskIds` + `backlogTaskIds`, incl. subtasks). Open a `DialogConfirmComponent`-style prompt showing **the count**, with:
   - **Move to Inbox** _(default)_ — safe carry-forward.
   - **Mark them done** — "close enough."
   - **Cancel.**
   - _Bulk mechanic:_ no bulk action exists today. For Part 1, loop the existing per-task action (`moveToOtherProject` / `updateTask isDone`) and apply the **Rule #6 flush** (`await new Promise(r => setTimeout(r, 0))`) after the loop. (A single bulk meta-reducer action is the cleaner upgrade — deferred; note the op-count.)
2. `ProjectService.complete(id)` dispatches `completeProject` (reducer sets done + archived).
3. **Celebrate** (section 3).
4. If the completed project was active, navigate to `/` (archive already does this; also clear any selected-task/detail-panel pointing at the now-hidden project — cf. recent fix `d44cb1138d`).
5. **Undo:** show a snack with **Undo** → `reopenProject` (accidental/instant-regret escape, since the project otherwise vanishes from the menu).

### 3. Celebration (separate component)

A small `ProjectCompleteCelebrationComponent` (dialog), reusing the layout language of `focus-mode/focus-mode-session-done` and the "summary-point" grid of `daily-summary`:

- **Confetti** via `ConfettiService.createConfetti()` — gate on **both** `isDisableAnimations` and `isDisableCelebration` (no confetti → dialog still shows).
- "🎉 Project complete" + project title + the **stats grid** (section 4).
- Primary **Done**; secondary **View completed projects** → the archived page (trophy section).
- Reopen is offered via the post-complete snack (step 2.5) and on the trophy page, not here.

### 4. Stats (computed live)

Computed on demand for the celebration and the trophy rows, from the still-live tasks:

- **Tasks done / total** — count project tasks (`taskIds` + `backlogTaskIds`; decide subtask inclusion, state it consistently) by `isDone`.
- **Hours worked** — sum `task.timeSpent` over the project's **parent** tasks only (a parent's `timeSpent` already includes subtasks — `task.reducer.util.ts:53-72`; summing both double-counts). Alternatively read `TimeTrackingState.project[projectId]`.
- **Days worked** — distinct `timeSpentOnDay` keys across tasks.
- **Finished in N days** — `startedOn`→`doneOn` calendar span. `startedOn` = earliest `timeSpentOnDay` key, fallback `project.created`. **This is the one stat that works with time-tracking off** — feature it.
- `worklog/util/get-time-spent-for-day.util.ts` aggregates per-day; reuse.

**Degrade gracefully:** many users don't track time. When `timeSpent === 0`, **hide** hours/days rows (don't show "0h over 0 days" — demotivating). Drop "avg per day" (vanity, prone to "0.4h/day").

### 5. Trophy view (improve the archived page)

Completed projects already land on `/archived-projects` (they're `isArchived`). Rather than a new page:

- On completed rows (`selectCompletedProjects`), show a **trophy/badge + "Completed on `doneOn`"** + the live stats, and offer **Reopen** (`reopenProject`) instead of Unarchive.
- **Improve the page** generally (it's currently a bare list): clearer layout, the stat readout, sort by `doneOn`, and make it more discoverable (the celebration's "View completed projects" links here; consider a findable entry rather than only the visibility menu).
- Optionally use `selectPlainArchivedProjects` to visually separate "Finished" from "Shelved".

### 6. Testing

- Reducer: `completeProject` sets `isDone`+`doneOn`+`isArchived:true`; `reopenProject` clears all three; INBOX guarded.
- **Regression (review-critical):** completing a project keeps its (done, `dueDay`-carrying) tasks **out of** Today/Overdue — i.e. `selectArchivedProjects` still includes completed projects and the task-filtering selectors are unchanged. Add an explicit test.
- Selector: `selectCompletedProjects` = `isDone`; `selectPlainArchivedProjects` = `isArchived && !isDone`.
- Stats: live math — no double-count of parent+subtask time; `finished in N days` with time-tracking off.
- Effect: celebration effect uses `LOCAL_ACTIONS` (no confetti/dialog on replayed/remote `completeProject`).
- Translations: `en.json` only, via `T`. User-facing → update docs per `docs/documentation-guide.md`.

## Risks

- **Selector leak (mitigated):** the §"Done vs Archived" wiring + the regression test exist specifically to prevent completed tasks reappearing in Today/Overdue. Audit all `selectArchivedProjects`/`selectArchivedProjectIds` consumers (`project.service.ts:83`, `magic-nav-config.service.ts:85`, `archived-projects-page.component.ts:52`, `task.selectors.ts:104,181`, `task-repeat-cfg.selectors.ts:22`).
- **Discoverability:** auto-archive makes a completed project vanish instantly; the reward is a one-shot unless the trophy page is findable. Undo snack + an improved, reachable trophy page mitigate.
- **Inbox flood:** "Move to Inbox" on a big dump-space project can dump many tasks into Inbox — hence showing the count, and offering "Mark done".
- **Live-stat drift (accepted):** if tasks are later deleted/manually-archived, recomputed stats shift. Acceptable for a retrospective view; this is the cost of choosing live-compute over a snapshot.

## Open items

- Trophy-page improvement scope (how far to take the redesign).
- Unfinished-task default — confirm Inbox vs. mark-done after seeing it in use.
- Subtask inclusion in tasks-done count (product call).

## Key files

| Area | File |
| --- | --- |
| Model / defaults | `src/app/features/project/project.model.ts`, `project.const.ts` |
| Actions / reducer / selectors | `src/app/features/project/store/project.actions.ts`, `project.reducer.ts`, `project.selectors.ts`; `action-types.enum.ts` |
| Service | `src/app/features/project/project.service.ts` |
| Context menu / trigger | `src/app/core-ui/work-context-menu/work-context-menu.component.{ts,html}` |
| Trophy page | `src/app/pages/archived-projects-page/` (enhance) |
| Reward | `src/app/core/confetti/confetti.service.ts`; ref `features/focus-mode/focus-mode-session-done/`, `pages/daily-summary/` |
| Stats | `src/app/features/tasks/store/task.reducer.util.ts` (rollup caveat), `features/time-tracking/time-tracking.model.ts`, `features/worklog/util/get-time-spent-for-day.util.ts` |
| Resolve dialog | `src/app/ui/dialog-confirm/dialog-confirm.component.ts` |
| Append/merge (deferred) | issue **#8032** |
