# Market position

Where Super Productivity has to be the best app on the market, which apps we
measure against, and how the comparison is kept current. The data lives in
[scorecard.md](scorecard.md); this page holds the target and the method.

Only the maintainer changes this page. The monthly refresh edits only the
scorecard and proposes changes to this page in its PR description.

The product principles in [AGENTS.md](../../AGENTS.md#product-principles) rank
above this page and the scorecard. A dimension where SP loses is a prompt to look,
not an instruction to build: every gap still has to pass
[Does it earn its place?](../feature-review-guide.md#does-it-earn-its-place)
before anyone works on it.

## Target

**The best app for focused individual work: tasks, time and daily planning in one
place, private and offline.**

"Best" is judged per group, not across every feature:

| Group                   | Meaning                                                                                            | Dimensions                                                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Must be best**        | Better than every app in the competitor set, the specialists included                              | Time tracking · Focus and breaks · Daily planning and time-blocking · Developer integrations · Offline, privacy, ownership · Price                      |
| **Must not lose badly** | Close to the best general todo app, because users who give up here never reach the strengths above | Quick capture · Organization · Calendar · Reminders · Platforms and widgets · Mobile polish · Sync reliability · First run                              |
| **Won't compete**       | A recorded decision; the refresh only reports new evidence against it                              | Collaboration (declined in #10830; sharing goes through Plainspace) · Habits beyond the existing simple counters, and gamification (product principles) |
| **Open decision**       | Not decided yet                                                                                    | AI: a built-in assistant, or only external assistants connecting through MCP                                                                            |
| **Tracked**             | Recorded for context, no target                                                                    | Recurrence · Views · Notes · Consumer integrations · Extensibility · Customization                                                                      |

## Competitor set

Keep the set fixed between refreshes so results stay comparable; change it only
here. Per-feature [Prior art](../feature-review-guide.md#prior-art) sections pick
their own apps for the problem at hand. There are four groups, one scorecard
section each:

- **General todo apps**, scored on every dimension: what most people choose
  instead of SP. TickTick, Todoist, and To Do List by Splend Apps
  (`com.splendapps.splendo`, the most-reviewed dedicated to-do app on Google Play,
  used as the mass-market Android baseline).
- **Specialists**, which lead on a must-be-best dimension. They are scored on the
  must-be-best dimensions where they have something to compare, plus Calendar for
  the daily planners:
  - Time trackers: Toggl Track, Clockify
  - Daily planners (planning, time-blocking, developer integrations): Sunsama,
    Akiflow, Motion
  - Privacy-first (offline, privacy, ownership): Tasks.org, Vikunja, Things 3

## Dimensions

| #   | Dimension                        | Group               | What is compared                                                              |
| --- | -------------------------------- | ------------------- | ----------------------------------------------------------------------------- |
| 1   | Quick capture                    | Must not lose badly | Add-task syntax, voice, share sheet, email, assistants; desktop and phone     |
| 2   | Organization                     | Must not lose badly | Projects, subtask depth, tags, sections, saved filters, search                |
| 3   | Recurrence                       | Tracked             | Repeat rules, repeat from completion, end conditions                          |
| 4   | Calendar                         | Must not lose badly | Calendar views; which calendars sync, and in which direction                  |
| 5   | Daily planning and time-blocking | Must be best        | Planning flow, capacity, time-blocking, end-of-day review                     |
| 6   | Reminders                        | Must not lose badly | Reminders per task, alarm style, location, reliability on Android and iOS     |
| 7   | Time tracking                    | Must be best        | Timers, manual entries, worklogs, personal reports, export, idle handling     |
| 8   | Focus and breaks                 | Must be best        | Pomodoro and other modes, break enforcement, focus statistics                 |
| 9   | Views                            | Tracked             | List, board, Eisenhower matrix, timeline                                      |
| 10  | Habits                           | Won't compete       | Habit tracking and gamification                                               |
| 11  | Notes                            | Tracked             | Task notes, note lists, markdown                                              |
| 12  | Collaboration                    | Won't compete       | Shared lists, assignees, comments                                             |
| 13  | Developer integrations           | Must be best        | Jira, GitHub, GitLab, Linear and similar: import, two-way fields, worklogs    |
| 14  | Consumer integrations            | Tracked             | Zapier, email to task, voice assistants, browser extensions                   |
| 15  | Extensibility                    | Tracked             | Plugin API, REST API, MCP, open source                                        |
| 16  | Platforms and widgets            | Must not lose badly | Desktop, web, Android, iOS, watches, widgets, app shortcuts                   |
| 17  | Mobile polish                    | Must not lose badly | Density, tap targets, gestures, consistency on phones                         |
| 18  | Sync reliability                 | Must not lose badly | Setup effort, conflicts, data-loss reports                                    |
| 19  | Offline, privacy, ownership      | Must be best        | Account requirement, offline use, telemetry, encryption, export, self-hosting |
| 20  | Price                            | Must be best        | What is free, paid tiers, ads                                                 |
| 21  | AI                               | Open decision       | Built-in AI features                                                          |
| 22  | Customization                    | Tracked             | Themes, shortcuts, feature toggles                                            |
| 23  | First run                        | Must not lose badly | Time to first task, learning curve, onboarding                                |

Each scorecard cell is written from SP's side: **Better**, **Tie**, **Worse** or
**Mixed** (it depends on platform or use), optionally narrowed with "slightly",
"by far" or a scope such as "on phones". **—** means not scored. Each competitor
section ends with a **Sources** line that gives the month checked and a
confidence; a fact that differs says so inline:

- **read**: the vendor page, store listing or our code was read directly
- **snippet**: only a search-result excerpt was available, for example because the
  host was blocked
- **unverified**: a single weak or conflicting source

Never raise a confidence level without reading the source directly. Score SP on
its latest release and list unreleased changes on `master` separately. After
`git fetch --tags`, the latest release is
`git tag --list 'v[0-9]*' --sort=-v:refname | grep -v -- - | head -1` (the `grep`
drops pre-release tags).

## Speed benchmark

Feature lists hide how fast a job gets done, and the biggest losses in the 2026-10
comparison (capture, mobile polish, first run) are about speed. Each job counts
taps or keystrokes, plus seconds, from the stated start to the stated end:

| Job                  | Start → end                                                           | Platform |
| -------------------- | --------------------------------------------------------------------- | -------- |
| Capture with date    | Home screen → "Call Anna tomorrow 3pm" saved with date and time       | Phone    |
| Snooze a reminder    | Reminder fires → snoozed one hour                                     | Phone    |
| Plan tomorrow        | Six open tasks, two calendar meetings → all six placed on tomorrow    | Desktop  |
| Log time on an issue | Jira or GitLab issue → time tracked and worklog sent                  | Desktop  |
| Second-device sync   | Fresh install on a second device → first device's tasks visible       | Both     |
| Offline conflict     | Same task edited on two offline devices → reconnected; record outcome | Both     |
| First run            | First launch → first task completed                                   | Phone    |
| Leave with your data | Settings → all data exported in an importable format                  | Desktop  |

Every job is measured by hand, competitors' too. Re-measure a competitor's job
when its changelog says the job changed. A proposal, not yet built: E2E tests with
a step budget per job on SP's side, so CI fails when a job gets slower.

## Monthly refresh

A scheduled Claude Code session runs this procedure early each month. It edits
only `scorecard.md`, never this page.

The snapshot line under the scorecard's title names the month, the latest SP
release and the `master` commit that was read. It is the starting point of the
next run.

1. **Read** this page, [scorecard.md](scorecard.md) and the product principles in
   AGENTS.md.
2. **SP side.**
   - If `git rev-parse --is-shallow-repository` prints `true`, run
     `git fetch --unshallow --tags`; otherwise `git fetch --tags`.
   - List the changes since the snapshot with
     `git log --oneline <snapshot commit>..origin/master`. The releases among them
     are `git tag --contains <snapshot commit>`.
   - Re-check every dimension those changes touch against the code. Released
     changes go into the SP baseline, the rest under "Unreleased on master".
     If a new release contains the snapshot commit, everything already listed
     under "Unreleased on master" has shipped too: move it into the baseline.
     Don't carry an SP fact forward from memory.
3. **Competitor side.** For each app, read its changelog or "what's new" page,
   pricing page and store listings for changes since the snapshot. Run subagents in
   parallel: one for SP and one per competitor group (general todo apps, time
   trackers, daily planners, privacy-first). If a host is blocked, use search
   snippets, mark them **snippet** and name the host in the PR. Never fill a
   number from memory.
4. **Update the scorecard.**
   - Change only the cells and facts that moved. Set the month on the Sources
     line of each section you re-checked.
   - Keep the summary and the gap list in step with the tables.
   - The gap list has one row per gap where SP misses its group's bar: not better
     on a must-be-best dimension, or worse on a must-not-lose-badly one. Each row
     links its open issues or says "none". For a gap without an issue, search
     closed issues first (a declined idea needs new evidence), then list it under
     "proposed issues" in the PR description. Don't create issues.
   - A row's status is the furthest step its linked work has reached, with the
     link: **—** (nothing beyond the issue), **Proposal** (a plan or design doc),
     **PR open**, **On master** (merged, not released) or **Released vX.Y.Z**.
     Prefix "Partly" when the work covers only part of the row. Re-check every
     linked issue and PR. Once a release closes a gap, re-score the dimension and
     remove the row.
   - Update the snapshot line.
5. **Public claims.** Compare the comparison pages on super-productivity.com, if
   reachable, against the scorecard and list contradictions in the PR description.
6. **Format and open the PR.** Run
   `npx prettier --write docs/market/scorecard.md`, then open one PR
   titled `docs(market): scorecard refresh YYYY-MM`. Its description lists:
   - verdict changes
   - notable competitor releases and price changes
   - gaps opened, moved or closed
   - proposed issues
   - proposed changes to this page
   - sources that were blocked
   - speed-benchmark jobs to re-measure

   If nothing but the months would change, open no PR and end with a short
   summary.

**Maintainer review of each refresh PR:**

- Merge it, or correct the verdicts.
- Pick at most three gaps to look into next; each still has to pass Does it earn
  its place?
- Decide whether the target or the competitor set should change, and edit this
  page if so.
