# Recurring tasks: repeat dialog polish — concept

**Status:** Revision 3 (2026-10-20), after a product/UX and a logic/sync adversarial review of earlier drafts (findings and actions in §9). Decisions in §8. Implemented as one PR with one commit per step in §7 (Steps 1–3); dead code and housekeeping separate.
**Research basis (2026-10):** 97 recurring-task issues/PRs, a map of the current implementation, and vendor docs of other apps as surfaced by web search (direct page fetches were blocked, so single cells in §2 are approximate).

**Addresses:** #5388 (the maintainer's own after-completion design, June 2026; bumped 2026-10-15), #5326, #8026, #6508/#9411 (discoverability), #3589 (pause, stale-closed).
**Not duplicated (in flight):** #10959 (#9488), #10090, #9798, #8925, #10851.
**Answered, not built:** #10812 → duplicate of #8931 (declined twice).

---

## 1. Problem

The engine is broadly complete. The pain is that people can't find or understand what exists.

- **After completion** is buried. It sits in Advanced, Custom only, with hard-coded English labels (`task-repeat-cfg-form.const.ts:282-302`). Weekly + after completion still demands a weekday. The dialog has the wrong shape for it: weekday and monthly anchors stay visible.
- **After completion doesn't wait.** A second copy still appears N days later while the first is open (`get-effective-repeat-start-date.util.ts:3-6`, `get-newest-possible-due-date.util.ts:51-66`). Users must also find and tick "Only create next task after completion".
- **Falling behind is controlled by two checkboxes whose names don't say what they do.**
  - `skipOverdue` skips missed dates even when nothing is open (service:266-285). Its reaper only removes copies you haven't touched (cleanup:106-127).
  - `waitForCompletion` combines with it in a way you can't see (service:253-285).
- **The rule is never stated back for custom schedules.** `getTaskRepeatInfoText` returns "Custom recur config" for weekly every-N. `EVERY_X_MONTHLY` reads "Every 2 month".
- **Pause works but has no UI.** It also leaks: completing a paused wait-for-completion copy creates the next one, because `_getActionsForTaskRepeatCfg` has no `isPaused` check (effects:725-730).

## 2. Prior art

Checked 2026-10 via vendor docs surfaced by search. Page fetches were blocked, so cells are approximate.

| Sub-question                                  | Things 3                                           | TickTick                                        | OmniFocus 4              | Todoist                   | Google Calendar |
| --------------------------------------------- | -------------------------------------------------- | ----------------------------------------------- | ------------------------ | ------------------------- | --------------- |
| How fixed vs after-completion is chosen       | top-level "After completion" next to Daily/Weekly… | "Repeat type: By due date / By completion date" | schedule type select     | `every` vs `every!`       | fixed only      |
| After-completion = pure interval, no weekdays | yes                                                | yes                                             | yes                      | yes                       | –               |
| Does after-completion wait for done           | yes, one copy                                      | yes                                             | yes                      | yes (single rolling task) | –               |
| Falling behind on fixed                       | (old) pauses after N copies                        | –                                               | "Catch up automatically" | jumps to next future date | –               |
| Rule summary shown                            | –                                                  | –                                               | summary when not editing | date text is the summary  | sentence        |

**Take:**

- After-completion as a visible top-level choice that waits by construction and is a pure interval.
- A catch-up policy for fixed schedules, named by outcome.
- A rule summary only where the preset label doesn't already say it.

**Deliberately don't:**

- `every!` symbols.
- An NL parser beyond today's short syntax.
- Edit-scope dialogs.
- Calendar-grid or wheel pickers.
- COUNT (declined #10091).
- Streaks (#8060).
- Pre-generation or an RRULE engine.
- Completion toasts.

## 3. Goals and non-goals

**Goals**

1. "Every 2 weeks after I finish it" is reachable from the preset select in one step, behaves the way the label says, and works on every released client.
2. What happens when you fall behind is one control, named by outcome.
3. Custom rules are stated back in a sentence, with the dates they fall on.
4. Pause has a UI and doesn't leak.
5. **No new persisted fields, no new enum literals, no engine changes, except the pause guard.**

**Non-goals (with reason)**

- **Sections (#10812):** declined twice.
- **Attachments (#10706):** waiting on your A/B decision (§6). 0–1 👍.
- **Context-menu Skip/Edit:** "Won't do" (#10708, on master) already does skip, and works better: it unblocks wait-for-completion and re-anchors after-completion. Edit is 2 interactions away via Schedule.
- **Completion snack:** noise; it fires per bulk-completed task.
- **"Next" date on the row chip:** an occurrence scan on the task hot path (`tag-list.component.ts:154-167`).
- **Pause buttons on panel rows:** nested interactive content and noise. The paused icon already shows.
- **Weekday toggle restyle:** would need a forbidden Material override; the checkboxes work.
- **`isIgnoreShortSyntax` for generated titles:** a behaviour change without a report.
- **Monthly/yearly after-completion as intervals, the 31st hint, and the yearly month-name label:** later, if asked.

## 4. Design

### 4.1 Preset select: one new entry

```
Repeats [ Every week on Tuesday              ▾ ]
          Every day
          Every Monday through Friday
          Every week on Tuesday
          Every month on the day 20
          Every month on the first day
          Every month on the last day
          Every month on the third Tuesday
          Every year on 20/10
          ─────────────
          After I complete it…          ← NEW
          Custom…
```

- All existing values stay selectable. The select is `required`, so removing one would break editing a saved config.
- "After I complete it…" is **UI-only**. It persists `quickSetting: 'CUSTOM'` + `repeatFromCompletionDate: true`. A new `RepeatQuickSetting` literal would fail typia on released clients (`validation-fn.ts:41`). On re-open, `CUSTOM && repeatFromCompletionDate` maps back to this entry.
  - **How:** the select needs a distinct option value. Use a dialog-only sentinel (`AFTER_COMPLETION`) that exists only in the form model and is translated at the load and save boundaries, next to `_normalizeMonthlyAnchor`.
  - Every `quickSetting === 'CUSTOM'` check in the dialog must treat the sentinel as CUSTOM:
    - the custom block's `hideExpression` (form const:52);
    - `isWeekdaySelectionInvalid` (ts:260);
    - the non-CUSTOM branch in `save()` (ts:546-558), which would otherwise pass the sentinel to `getQuickSettingUpdates`.
  - A unit test asserts the sentinel never reaches `updateTaskRepeatCfg` or `addTaskRepeatCfgToTask`.

### 4.2 Custom / after-completion block

```
Schedule type   (•) Fixed schedule   ( ) After I complete it     ← formly radio, translated, count-free
Every [ 2 ] [ weeks ▾ ]                                          ← visible at interval 1 (#5388 bug)
On    ☑ Mon ☐ Tue ☑ Wed ☐ Thu ☐ Fri ☐ Sat ☐ Sun                  ← fixed + weekly only
Monthly pattern [ Day of month ▾ ]                               ← fixed + monthly only
```

In after-completion mode:

- Weekday and monthly anchors are hidden. The start date relabels to "First one on".
- Weekday validation only applies to fixed + weekly.
- **Units map to days on save.** "N weeks" saves as `repeatCycle: 'DAILY'`, `repeatEvery: 7·N`, so released clients compute the same dates with no engine change. The user workaround on #5388 already does this.
  - On re-open, `DAILY` with `repeatEvery % 7 === 0` displays as weeks. This is display-only and the dates are identical.
  - Months and years stay as they are today.
- **`waitForCompletion: true` is written for new after-completion configs** and when the user switches to after completion. That keeps exactly one open copy, as the label promises.
- **What the dialog shows is what Save writes (decided).** An existing after-completion config, saved in the new dialog for any reason, is written in the shape the dialog displays: weeks as DAILY×7N, waiting on.
  - For configs that had a weekday, this fixes the "every 2 weeks = 5 days later" dates. "Next Monday, but only after I've finished" stays available as fixed + "Wait until the current one is done".
  - Opening and cancelling changes nothing. There is no background migration and no schema bump.
  - The diff for the update is taken between the stored shape of the initial config and the stored shape of the final one. So an untouched config that is already DAILY×7N + wait produces no changes and no reschedule.

### 4.3 "If you fall behind" (fixed schedules only)

This is one formly `select` inside the collapsible, renamed from "Advanced configuration" to "Options". It replaces the two checkboxes:

| Option                             | Writes                                         | Hint                                                                                                                      |
| ---------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Keep every copy                    | `skipOverdue=false`, `waitForCompletion=false` | A new copy is added on each date, even if earlier ones are still open.                                                    |
| Only keep the latest               | `skipOverdue=true`, `waitForCompletion=false`  | Dates missed while the app was closed are skipped. Older copies you haven't touched are removed when a newer one appears. |
| Wait until the current one is done | `waitForCompletion=true`, `skipOverdue=false`  | The next copy is added once you finish the current one or mark it won't do.                                               |

- Existing configs with both flags true show "Wait" and are **left untouched until the user changes the control**. A unit test pins this.
- **"Wait" deliberately writes `skipOverdue=false` (decided).** Wait means nothing silently disappears and at most one copy is open. With skip on, a date missed while the app was closed would yield nothing until the next scheduled date, which is surprising under a "wait" label. People who want missed dates dropped pick "Only keep the latest".
- The default stays `getDefaultSkipOverdue`. It now re-seeds live while the control is untouched, because the value is visible.
- A non-default value shows in the summary line ("· only the latest is kept"), so it can be found without opening Options.

### 4.4 Summary and rule preview (custom and after-completion only)

```
↻ Every 2 weeks on Monday and Wednesday · until 31 Dec
  Falls on: Mon 26 Oct · Wed 28 Oct · Mon 9 Nov
```

- **Shown only when it adds something** beyond the preset label: Custom, after completion, an end date, a non-default fall-behind policy, or paused. Simple presets keep today's "Next new instance" line only.
- **Placement (decided):** directly below the schedule controls, as plain text with a small repeat icon. No tinted card. It reads as the result of the controls.
- **"Falls on" is a rule preview, not a creation forecast.** It runs only for fixed, unpaused schedules that are not plain daily. It is computed after preset expansion, with `getFirstRepeatOccurrence` for new configs and the logical day (`DateService`). It loops over `deletedInstanceDates` and is capped at 3.
- **After completion:** "Then every 2 weeks after you complete it."
- **Paused:** "Paused: no new copies until resumed."
- **One pure function** feeds the line, shared with the save path so the two can't disagree. Unit tests cover every edge case from review M4/M6 before any UI work.
- **Strings:**
  - New count-bearing keys use `getPluralKey` (`.ONE/.OTHER`; #10952), added in `en.json` only.
  - Fix `EVERY_X_MONTHLY`.
  - Weekly every-N gets a real sentence instead of "Custom recur config".
  - `aria-live="polite"`, updated on change/blur, not per keystroke.

### 4.5 Pause

- **UI:** a single "Paused" toggle in the dialog's Options. It writes only `isPaused`, with no cursor write.
- **Guard:** an `isPaused` check in `_getActionsForTaskRepeatCfg`, which fixes the wait-for-completion leak.
- **After a local resume:** call `addAllDueToday()` (#7768 precedent). Otherwise nothing appears until the next day change, while the planner already shows it.
- **E2E first:** resume after 10 days, with and without skip-overdue, fixed and after-completion. The v1 cursor rewrite is dropped: it could move the cursor backwards and re-create an archived or skipped copy, and it re-phases after-completion series.

## 5. Sync and persisted-model review

- **No new fields, enum values or op types.** Everything maps to existing fields through existing `updateTaskRepeatCfg` changes-only patches (verified: non-strict `createValidate`, unknown fields survive).
- **DAILY×7N:** a shape every released client already handles identically.
- **The `isPaused` guard** only removes creations. Remote ops don't trigger creation (`LOCAL_ACTIONS`).
- **Old clients editing a migrated config:** they see "Every 14 days, after completion" in their old dialog. That is truthful and the dates are equal.
- **Existing after-completion configs:** they stay as they are until they are saved in the new dialog. Then they are written as displayed (§4.2): DAILY×7N, waiting on.
  - This uses the existing changes-only patch.
  - `repeatCycle` and `repeatEvery` are schedule-affecting, so `rescheduleTaskOnRepeatCfgUpdate$` runs. Its after-completion skip (effects:311-319) must be covered by the Step 1 E2E: the open copy must not move.
- **No divergence path found** in completion re-anchoring. The one concurrent cursor race converges; at most an issue, per rule 15.

## 6. Attachments (#10706): decided, nothing built for now

**Answer #10706 with "put the link in Default notes".**

- New copies get the config's notes (`task-repeat-cfg.service.ts:405`).
- Notes are Markdown, and links are clickable in both renderers (`marked-options-factory.ts:157`, `live-markdown-extension.ts:124`).
- The reports (#10706, #8745) are about links. This costs no code and no persisted field.

If file attachments (local files, images) later get demand, use **B in the subtask-template shape**: optional `attachmentTemplates?` on the cfg.

- Seed it when the task becomes repeatable.
- Snapshot it from the newest instance with the same "inherit" switch subtasks use, so users keep adding links on the task as they do in #8745/#10706.
- Use deterministic ids `<instanceId>_att_<i>`.
- The reaper must compare against the templates.

B beats A: A would load the archive on most creations and could give different payloads per device. Cost: one optional persisted field.

## 7. Steps to get there

Steps 1–3 ship as **one PR**: they rewrite the same dialog files, and separate PRs would ship throwaway intermediate dialogs. Each step is its own commit (green on its own), so a partial revert stays possible. No step changes a persisted shape. The repo rules apply throughout: `npm run checkFile` on touched files, `npm run test:affected`, and translations in `en.json` only.

### Step 0: housekeeping (no code, ~30 min)

- Close as satisfied: #5309 (end date), #6040 and #7728 (nth weekday), #5570 (single instance via wait-for-completion).
- #10812: reply that it is the same need as #8931, which was declined twice. Describe the leanest shape in case demand grows: at creation, insert into the section of the newest live instance of the same project — derived, no new field, but a cross-entity write that must follow sync rules 3/13/14, and close it as a duplicate. This releases the two contributors who claimed it.
- #10706 and #8745: answer with "put the link in Default notes" (§6).
- #10202: re-triage as "skip-overdue keeps copies you've edited" (reaper rules), not as discoverability.
- Review PR #10959 (#9488 start-date anchoring). It touches the same dialog, so land or decline it before this PR to avoid conflicts.

### Step 1: "After I complete it" (#5388 Phase 1)

**Files:**

- `dialog-edit-task-repeat-cfg/task-repeat-cfg-form.const.ts`
- `build-repeat-quick-setting-options.ts`
- `dialog-edit-task-repeat-cfg.component.{ts,html}`
- a new pure helper `after-completion-form-mapping.ts` (+ spec)
- `en.json` / `t.const.ts`

**Steps:**

1. **The pure helper first, with specs:**
   - `toFormModel(cfg)` maps `CUSTOM + repeatFromCompletionDate` → sentinel `AFTER_COMPLETION`, and `DAILY` with `repeatEvery % 7 === 0` → weeks.
   - `toStoredCfg(model)` maps the sentinel → `CUSTOM` + `repeatFromCompletionDate: true` + `waitForCompletion: true`, and weeks → `DAILY × 7N`. It leaves months and years unchanged.
   - Round-trip specs:
     - `toStored(toForm(x)) === x` for an already-normalized x.
     - A legacy weekly-with-weekday after-completion config → DAILY×7N.
     - The sentinel never survives `toStoredCfg`.
2. **Preset option:** add "After I complete it…" to `buildRepeatQuickSettingOptions`, just before Custom, with a new key `Q_AFTER_COMPLETION`.
3. **Custom block:**
   - Its `hideExpression` shows the block for CUSTOM or the sentinel.
   - Move `repeatFromCompletionDate` to the top of the block as a formly `radio`. It is visible at every interval (the #5388 bug) and labelled with the new count-free keys `SCHEDULE_TYPE_FIXED` / `SCHEDULE_TYPE_AFTER_COMPLETION`. This deletes the hard-coded English (form const:282-302).
   - The radio and the preset stay in sync: choosing After sets the sentinel; choosing Fixed sets CUSTOM.
4. **Hide in after-completion mode:**
   - the weekday checkboxes (keep the #8025 CSS-class approach, not `hideExpression`);
   - the monthly anchor group;
   - the advanced `waitForCompletion` checkbox (implied).

   Relabel the start date "First one on". Add the "after I complete it" suffix next to the unit.

5. **Validation:** `isWeekdaySelectionInvalid` applies only to fixed + weekly, with the sentinel excluded.
6. **Boundaries:**
   - On load, run `toFormModel` where the dialog builds its model (ts ~399-446).
   - In `save()`, call `toStoredCfg` before `_normalizeMonthlyAnchor`.
   - Treat the sentinel as CUSTOM in the non-CUSTOM preset branch (ts:546).
   - Diff `toStoredCfg(initial)` against the final config in `getTaskRepeatCfgChanges`, so a no-op save stays a no-op.
7. **Small wins in the same PR, all string-only:**
   - Dialog title "Edit recurring task" / "Make task recurring".
   - "Recur until (optional)" → "Ends on (optional)" with the hint "The last day is included."
   - Move Remove to the left of the action row.
8. **Tests:**
   - Component spec: preset ↔ radio sync; fields hidden in after mode; Save enabled with no weekday in after mode; the sentinel is not persisted.
   - **E2E** `e2e/tests/recurring/repeat-after-completion-weeks-5388.spec.ts`, using `page.clock.setSystemTime` with a moving clock, as in `repeat-timed-cold-reopen-day-change.spec.ts`:
     - Create a task and choose "After I complete it…", every 2 weeks, without touching any weekday. Save.
     - Advance 15 days with the copy open: no second copy (waiting).
     - Complete it on day 15. Advance 14 days: exactly one new copy.
     - Edit a legacy after-completion config (seeded through the store) without changing anything: its open copy does not move.
9. **PR text:** closes #5388 and #5326. State the long-term-cost check: no new fields or enum values, released clients read DAILY×7N natively.

### Step 2: "If you fall behind" + Pause

1. **Pure mapping helper + spec first:** `toFallBehind(cfg)` and `fromFallBehind(choice)`, with both-true preserved until touched and Wait writing `skipOverdue=false`.
2. **Replace the two checkboxes** with one formly `select` in the collapsible, renamed "Options". Its header shows the current value. Re-seed live from `getDefaultSkipOverdue` while untouched. Hide it in after-completion mode.
3. **Pause:**
   - **E2E first** (resume after 10 days × skip on/off × fixed/after) to record today's behaviour.
   - Add an `isPaused` guard in `_getActionsForTaskRepeatCfg`, with a unit test for the leak: completing a paused wait-for-completion copy creates nothing.
   - Add the "Paused" checkbox in Options.
   - After a local resume, call `addAllDueToday()`. Never in a reducer or on remote ops (`LOCAL_ACTIONS`).
4. **Wording:** the three option labels and hints from §4.3. New keys go in `en.json`.

### Step 3: summary + rule preview

1. **Pure `describeRepeatRule(cfg, logicalToday, locale)` + `getRuleDates(cfg, n=3)` first,** with specs for:
   - preset expansion;
   - the first occurrence of new configs;
   - `deletedInstanceDates`;
   - `repeatUntilDay`;
   - paused;
   - after completion;
   - wait;
   - large `repeatEvery`;
   - the day-boundary offset.
2. **Strings:** count strings go through `getPluralKey`. Fix `EVERY_X_MONTHLY`. Weekly every-N gets a real sentence in `getTaskRepeatInfoText`, which also improves the existing chip and overview text at no hot-path cost (it is the same function).
3. **UI:** the plain line below the schedule controls (§4.4), with `aria-live="polite"` on change.

### Step 4: dead code (tiny PR, any time)

- `addAllDueTomorrow`
- `TaskComponent.isRepeatTaskCreatedToday` (task hot path)
- `TaskComponent.editTaskRepeatCfg`
- the duplicate reducer `on(deleteTaskRepeatCfg)`

### Later, only on demand

- Yearly preset label with the month name (via `textLocale()`).
- The 29th–31st hint.
- Monthly/yearly after-completion as pure intervals.
- Attachment templates (§6).
- #10903 rule families.

## 8. Decisions (2026-10-20)

1. **Fall behind:** one three-option select. "Wait" writes `skipOverdue=false`. Both-true legacy configs are preserved until touched.
2. **Existing after-completion configs:** written as the dialog shows them (DAILY×7N, waiting on) when saved in the new dialog. No background migration.
3. **Attachments:** nothing built. Point to Default notes. Template-shape B only on future demand for files.
4. **Mockup changes:**
   - summary below the controls as plain text;
   - Options collapsed by default, with the current values in its header;
   - "Ends on (optional)" plus the "last day is included" hint;
   - the plainer dialog title;
   - Remove on the left.

## 9. Changes

### v2 → v3

- The four open questions are decided (§8).
- Concrete steps (§7) replace the phasing list. They include the dialog-only `AFTER_COMPLETION` sentinel, the stored-shape diffing, and the files and tests per step.
- Attachments: answered with Default notes instead of building option B.
- Summary placement and the mockup polish are folded in.

### v1 → v2 (review → action)

- **Weekly with no weekday:** v1 dropped the weekday requirement first and changed the engine later. Released clients would go silent and dead configs would ship (product B1, logic B2). Replaced by DAILY×7N, and §5.1 is removed.
- **"After completion implies waiting":** false (product B2, logic M1). New after-completion configs now write `waitForCompletion`.
- **Resume cursor rewrite:** could move the cursor backwards (logic B1, M9; product M9). Dropped; the leak guard and `addAllDueToday` are added instead.
- **The fall-behind radio:** wrong wording and hidden semantics, and too visible (product M1–M3, logic M2). Now a select in Options with outcome wording, and Wait writes `skipOverdue=false`.
- **The live next-3-dates line:** wrong in about 8 cases (product M4, logic M6). Now a separate rule preview with a shared pure function and tests first.
- **The summary:** strings were missing and plurals ignored (product M5). Shown only when it adds information; plural keys added.
- **"Skip this one":** misdescribed delete and duplicated Won't do (product M6, logic M3). Cut.
- **Preset list:** would have broken saved configs and needed ordinals (product M8). All values kept; one UI-only entry added.
- **Pause buttons on rows:** cut (product M9). Toggle in the dialog only.
- **Attachments:** v1 picked B with a separate editor (product M7, logic M8). Deferred; template-shape B recommended.
- **Other cuts:** the completion snack, the chip "next" text, the overview refactor, `isIgnoreShortSyntax`, the toggle chips, Ends ▾ (product m2–m9).
- **Phasing:** smallest-win PR first (product M10).

## 10. As built (deviations from §4–§8)

- **Existing after-completion configs (§8 Q2):** their schedule fields, including a legacy fixed preset next to the flag, are converted (weeks as days, monthly anchors cleared, `CUSTOM`) only once the user edits the schedule in the dialog. An unrelated save keeps them as stored: rewriting schedule-affecting fields makes `rescheduleTaskOnRepeatCfgUpdate$` move the open copy, e.g. an overdue one into the future. Waiting for completion is still written on any save, since it moves nothing (`keepUneditedAfterCompletionSchedule`).
- **Resume (§4.5):** the E2E reproduced a backfill. The first app start after resuming created the newest date missed while paused as an overdue copy. So resuming a fixed schedule moves the creation cursor to the logical yesterday, in the same update as `isPaused: false` (`getResumeCursorChanges`). This is the safe form of v1's idea: it never moves the cursor back, and it skips after-completion schedules, where the cursor is the anchor. Resuming on a scheduled day creates that day's copy right away (local only, next to the #7768 call).
- **Pause guard:** `_getActionsForTaskRepeatCfg` returns early for a paused config, which fixes the wait-for-completion leak.
- **Add-task bar:** the "After I complete it…" entry is dialog-only. The bar's repeat menu shares the option builder but turns presets straight into configs.
- **Layout:** the dialog reads top to bottom: title and rule, start date with "Ends on" beside it, then the result as caption lines ("Falls on" plus any non-default policy, then the existing "Next new copy", which keeps its saved-config meaning), then Options (how the series behaves, then what new copies get) and Activity. The custom fields sit flush with the rest, and the rule sentence is read to screen readers only where the fields already say it. Collapsible headers show their titles only. Remove and Skip sit at the left of the buttons.
- **Plurals:** the new count strings follow the helper's existing convention (a singular key plus an "X" key), not `getPluralKey`. The helper has no `TranslateStore`, and #10952 applies to all of these keys alike.
- **No schedule type radio:** the "After I complete it…" preset is the one switch. The §4.1 radio repeated it inside Custom and invited "which one wins?", so it was dropped after the UX review; `syncAfterCompletionMode` only follows preset changes.
- **Unused keys:** `WAIT_FOR_COMPLETION*` and `SKIP_OVERDUE*` are no longer referenced; they are left for `npm run int:unused` so the other languages are cleaned in one pass.
