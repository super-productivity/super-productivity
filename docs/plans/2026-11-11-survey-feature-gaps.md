# Survey 2026: open feature gaps from the first-week answers

> **Status: Decided 2026-11-11.** Three small builds and one already-decided
> piece go ahead; everything else is declined or handed to the clarity work.
> Nothing in this note is built yet.
>
> **Owner / tracking:** #11694 (detach action), #10853 (deadline card),
> #9402 / #6252 / #5614 (tray), #11695 (overlap report).
>
> **Last verified against the code:** 2026-11-11 (`7438162574`, v20.0.0)
>
> **Removal condition:** delete once each build below has an issue or a merged
> PR that records its decision.

The 2026 user survey (241 responses, 27 Oct – 10 Nov 2026) asked what was hard
in the first week. The wording, tooltip and wiki fixes are a separate piece of
work. This note covers the twelve answers that describe a missing feature.

Respondents are cited as `Rn`, the 1-based data row of the survey export.
[`2026-10-28-survey-planner-schedule.md`](2026-10-28-survey-planner-schedule.md)
counts the same rows 0-based, so its `#36` is `R37` here. Answers are
paraphrased; the survey text is not copied into the repository.

## Decisions

| Gap                                                    | Asked by         | Decision                                                                                            |
| ------------------------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------- |
| 1 Undo / Ctrl+Z for task actions                       | R148, R169, R184 | Stays declined; survey numbers recorded on #8554                                                    |
| 2 Links or attachments on recurring tasks              | R126, R186       | Earlier decision stands: nothing built, links go into Default notes                                 |
| 3 Monthly rules (weekday units, offsets)               | R65, R224        | #10903 stays "later"; offset rules declined                                                         |
| 4 Repeat count                                         | R53, R78, R193   | Declined; the end date covers it                                                                    |
| 5 Deleting a recurring copy                            | R36, R140        | No build; wording only                                                                              |
| 6 Moving or editing one future recurring occurrence    | R113, R122, R193 | **Build:** a detach action (see [Gap 6](#gap-6-detach-one-future-occurrence))                       |
| 7 Completed subtasks reset on the next copy            | R145, R153       | Declined; by design                                                                                 |
| 8 Untimed tasks overlap calendar events in Schedule    | R37, R208        | 2026-10-28 decision stands; **build** overdue tasks in the day panel first, then wireframe the tray |
| 9 Getting project tasks into Planner or Schedule       | R135, R117       | Same work as the tray of gap 8                                                                      |
| 10 Deadline-only tasks cannot be edited in the Planner | R113             | **Build:** a click on the deadline card opens the task                                              |
| 11 Finding archived tasks done on a day or in a period | R59, R138, R234  | No build; History and Search already do it                                                          |
| 12 Clearing done tasks on Today without Finish day     | R84              | Declined; the button stays hidden on Today while Finish day is on                                   |

Build order: gap 10, overdue tasks in the day panel (gap 8), gap 6, then the
tray (gaps 8 and 9).

## Builds

### Gap 10: deadline card opens the task

A deadline-only task shows in the Planner as a card whose only action opens
the deadline dialog (`planner-deadline-task.component.html:1`). The task
cannot be opened or edited from there. Other Planner cards select the task and
offer the context menu (`planner-task.component.ts:188-237`).

Decision: a click opens the task like any other Planner card; the deadline is
edited from the task. No sync or persisted-model change.

#10853 asks for something else, dragging the card to plan work sessions. It
has no reactions besides its author and stays open until someone else asks.

### Gap 8: overdue tasks in the Schedule day panel

Part of option A in the 2026-10-28 note. Its other half, dragging a Planner
card onto the day panel, shipped in v20.0.0 (`4403b170c0`). No sync or
persisted-model change.

### Gap 6: detach one future occurrence

Future occurrences of a recurring task are previews, not tasks. They cannot be
dragged in the Planner (`planner-day.component.html:77-80`) or the Schedule
(`is-schedule-types-type.ts:34-42`), and they cannot be edited one at a time.
A click opens the repeat dialog for that date, which offers "Skip for date".
One respondent calls this a dealbreaker and already works around it with a
normal task plus a skip.

Decision: one action on the preview, next to "Skip for date", that does the
same two steps. It adds the date to `deletedInstanceDates` and then creates a
normal task for that day. From then on the task is moved and edited like any
other.

Two rules for the build:

- **The new task has no `repeatCfgId`.** A linked copy would be moved back by
  `rescheduleTaskOnRepeatCfgUpdate$` on the next rule edit
  (`task-repeat-cfg.effects.ts:308-352`), would block a "wait for completion"
  series (`task-repeat-cfg.service.ts:262-275`) and could be removed by the
  duplicate cleanup (`task-repeat-cleanup.effects.ts:218-234`).
- **Two existing ops, skip first.** The skip is the existing
  `deleteTaskRepeatCfgInstance`, the task a plain `addTask`. A new combined
  action was rejected: a released client does not know the action type, applies
  neither half and later creates the occurrence itself. With the skip first, an
  interrupted detach loses an occurrence instead of duplicating one.

What this adds to the sync surface: no field, no action type, no schema bump.
Each detach adds one date to `deletedInstanceDates`.

Open before building:

- `deletedInstanceDates` is never pruned. Dates behind the cursor look dead,
  but moving the start date earlier rewinds the cursor
  (`task-repeat-cfg.effects.ts:352-369`), so pruning them can bring a skipped
  occurrence back.
- Two devices skipping different dates of one series at the same time may lose
  one of the two entries. Not verified; "Skip for date" has the same exposure
  today.
- `createRepeatableTask` cannot create the task, because it advances the
  cursor and would skip the occurrences in between.

Prior art, checked 2026-11 from vendor documentation:

| App             | Behaviour                                        | Take / deliberately don't                    |
| --------------- | ------------------------------------------------ | -------------------------------------------- |
| Todoist         | Rescheduling moves only the next occurrence      | Take: one concrete copy moves                |
| Things 3        | Edit the current copy; "Create Next Copy"        | Take: an explicit detach                     |
| Google Tasks    | Changes apply to the next instance               | –                                            |
| Google Calendar | "This event", "this and following", "all events" | Don't: an override model and a three-way ask |

### Gaps 8 and 9: the tray

Unchanged from the 2026-10-28 note (§ 11): a setting "Tasks without a time",
placed automatically or kept in a tray with a capacity line, one optional
`ScheduleConfig` field, wireframe first. The closed survey added one more
voice for it (R208). The tray also answers gap 9 and the request to drag from
a task list into the plan (R117).

The overlap itself is not reproduced. By the code, calendar events block the
automatic placement (`create-sorted-blocker-blocks.ts:301-345`).

## Declined, and why

- **Gap 1, undo.** Declined three times (#7133, #10863, #8821). Three
  respondents do not change that. A shortcut that triggers only the visible
  Undo snackbar was considered and rejected: it would still do nothing after
  marking a task done, and the #8554 design requires a "Can't undo" answer
  instead of silence.
- **Gap 2, links on recurring tasks.** Both respondents ask for links, which
  the repeat's Default notes carry over
  ([recurring-tasks plan § 6](2026-10-20-recurring-tasks-polish.md)). The
  survey is not the demand for file attachments that plan waits for.
- **Gap 3, monthly rules.** "Last Friday" and "last day" exist. Weekday units
  stay in #10903. An offset rule ("the day before the first Thursday") was
  found in no other app. A new rule value is also read differently by released
  clients, and occurrence ids are derived from the date.
- **Gap 4, repeat count.** All three respondents accept an end date, which
  shipped in v19.3.0. If a count is asked for again, build it as a calculator
  in the dialog that writes the end date. No new field.
- **Gap 5, deleting a recurring copy.** One respondent says the problem went
  away, the other finds the dialog unclear. #7859 describes the opposite case
  (a deleted copy that does not come back) and is not survey-driven.
- **Gap 7, subtasks reset.** A new copy starts from the subtask templates with
  nothing ticked (`task-repeat-cfg.service.ts:371-398`). Things 3 does the
  same; Todoist resets only on request.
- **Gap 11, archived tasks by day.** History lists the tasks done on a day,
  and Search includes archived tasks and jumps to that day. Filtering stays in
  #7897.
- **Gap 12, archive on Today.** "Move done to archive" is hidden on Today
  while Finish day is on (`work-view.component.html:388`). Finish day stays
  the one way to clear Today. Turning Finish day off shows the button.

## For the clarity work

These are answers to give, not features to build:

- Turning Finish day off shows "Move done to archive" on Today (gap 12).
- Links for a recurring task belong in the repeat's Default notes (gap 2).
- A repeat can end on a date (gap 4).
- What deleting one recurring copy does (gap 5).
- Subtasks start unticked on each copy; "wait for completion" keeps one copy
  until it is done (gap 7).
- History shows the tasks done on a day; Search includes archived tasks
  (gap 11).

## Recorded on issues

Posted 2026-11-11:

- **#8554:** the survey's demand for undo (three respondents, two of them for
  any action), with no change of plan.
- **#10853:** the survey respondent asked to edit the deadline task from the
  Planner, not to drag it.

## Also in the same answers

Not part of the twelve and not decided:

- A click on a task replaces the Schedule side panel and loses the place
  (R135).
- The plugin and MCP APIs cannot read or set repeat configs (R193).
- #11645 reports tracked time on recurring copies being overwritten by a
  second device. It needs a reproduction before anything else.
