# Finish week: an optional weekly review on top of Finish day

Status: implemented (2026-10-29), without opening an issue first.

## Problem

SP has a daily ritual ("Finish day": review tasks → evaluate day → plan
tomorrow) but no weekly layer. The [market scorecard](../market/scorecard.md)
lists it as the open gap on a must-be-best dimension: "Daily planning: Sunsama
and Akiflow add weekly rituals" and "'Finish day' review. No weekly review."

**Why not "Routines"?** A routine (a set of tasks that recurs) is already
covered by repeating tasks and habits. A separate routine entity would duplicate
repeat configs and add synced state. The real gap is the weekly look back and
look ahead.

**Demand:** weak and indirect so far. There's no issue asking for a weekly review.
The adjacent requests are #8132 (completed tasks in Planner/Schedule, +7),
#9514 (week view, +6), #9350 (assign tasks to a week, +3) and #6449 (static
weekly planner, +3). The issue should collect direct demand before anyone
builds this.

## Prior art (vendor docs and changelogs, checked 2026-10)

| App      | Weekly review                                                                                                | Weekly planning                                                                                                     | Trigger                        |
| -------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Sunsama  | 3 steps: objectives progress, the week's completed or tracked work by day, a short journal ([changelog][s1]) | Set weekly objectives and carry unfinished ones forward ([help][s2])                                                | Scheduled day/time in settings |
| Akiflow  | "Weekly shutdown" ritual, since 2.45, Nov 2024 ([changelog][a1])                                             | Weekly planning ritual (2.45). 2.81 (Sep 10, 2026) added drag to "This week"/"This month" buckets ([changelog][a2]) | Ritual prompts                 |
| Todoist  | None native (per a third-party blog; not checked hands-on). Third-party Todolytics fills the gap             | None                                                                                                                | n/a                            |
| TickTick | None native                                                                                                  | None                                                                                                                | n/a                            |

Note: Akiflow's 2.81 is week/month **buckets** (that's #9350), not a review. Its
review ritual is two years old.

**Take:** review the week's work by day, a short written reflection, and moving
open tasks into next week. Sunsama shows all three are enough.
**Deliberately don't:** weekly objectives/goals (a new synced entity, and it
tips toward reporting), scheduled prompts or notifications (calm default),
streaks or week-over-week scores, or month planning.

## Proposal

On **Fridays**, Finish day turns week-aware by itself. There's no link, no setting
and no separate page:

1. **Review:** the existing week worklog moves above today's task table and is
   renamed "This week", so the look back is visible without scrolling. The
   component is unchanged; only its position differs. A week task table and
   week stats are left out on purpose: they lean toward reporting.
2. **Reflect:** the reflection note shows week prompts ("Wins? What pulled you
   off track? What changes next week?"). The text is saved as a normal
   reflection on today's metric entry, so there's no new model. The daily star
   and energy ratings stay as they are, because they still rate the day.
3. **Plan next week**, in place of "Plan tomorrow": next Monday to Friday as
   planner days, with this week's open tasks offered for planning. It uses the
   existing `planner-day` component and `PlannerActions.planTaskForDay`.
   "Open tasks" means unfinished one-off tasks due Monday to Friday of this
   week, overdue ones included. Repeating-task instances are left out, because
   next week creates its own and planning the old ones would duplicate them. On
   mobile the five days stack vertically, like the planner's mobile list.

The finish button reads "Finish the week" and does the same thing. Tab labels
stay the same, because the tabs have a fixed width and a longer label like
"Plan next week" is cut off on mobile.

**Why Friday and not a link:** on a Friday, "Plan tomorrow" plans Saturday, so
next week is the better default and costs no extra click. It shows up only
inside a ritual the user started, so it's not a nudge.

**Other days:** the same view is reachable by URL
(`/active/daily-summary?scope=week`) for people who review on the weekend. There's
no UI entry for it.

```ts
// shortcut: Friday hardcoded, since SP has no workdays setting and firstDayOfWeek
// is not the workweek (US weeks start on Sunday) — derive it from a workdays
// setting if Sun–Thu workweeks are reported
```

## Cost

- **Persisted model / sync wire / plugin API:** none. The scope is a date check
  plus a route param, and reflections reuse `MetricCopy.reflections`. Nothing new
  is synced, and released clients are unaffected.
- **Code:** a `isWeekScope(dayStr)` util (Friday check or route param, through
  `DateService` for the logical day), prompt text in the reflection note, and a
  plan-next-week variant of `plan-tasks-tomorrow`. The daily-summary component
  is 707 lines, so none of this goes into it beyond one input.
- **Docs:** one wiki section on Finish day.

## Out of scope

Week buckets (#9350, which is what Akiflow 2.81 shipped), weekly goals, week or
month stats, reminders and a workdays setting.

## Open questions

1. Should Saturday and Sunday also count as week scope when someone finishes a
   day then? The lean answer is no, but the URL covers it.
2. Should the Plan tab show next week's weekend days too? The lean answer is
   Monday to Friday, with the planner one click away for the rest.
3. Do people plan their next week on Friday, or on Sunday or Monday? The
   Friday trigger rests on this, so the issue asks it directly.

## Next step

Built directly (no issue). Watch feedback on the Friday trigger and on the
open-task definition before extending it.

[s1]: https://roadmap.sunsama.com/changelog/weekly-review-20
[s2]: https://help.sunsama.com/docs/weekly-planning
[a1]: https://product.akiflow.com/changelog/new-weekly-rituals-goals-ratings-and-quick-notes
[a2]: https://product.akiflow.com/changelog
