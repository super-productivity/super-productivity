# Help me plan today: an optional AI day planner

Oct 31, 2026 · status: **proposal**, nothing implemented · branch `claude/ai-plan-today`

**Related:** generative views, parked (`docs/plans/2026-10-30-generative-views.md`
on `claude/generative-ui-todo-app-h4o6e8`) · agent endpoint / MCP plan
(`docs/plans/2026-09-16-work-api-mcp-and-headless-device.md` on
`claude/sp-executable-data-model-gewi7j`) · [market target](../market/README.md)
(daily planning is _must be best_, AI is an _open decision_) ·
[contributor sync model](../sync-and-op-log/contributor-sync-model.md) ·
[survey: Planner and Schedule](2026-10-28-survey-planner-schedule.md).

## Summary

- **What:** one button, **Help me plan today**. SP sends a short list of
  today's candidate tasks (ids, titles, estimates, dates) and the day's free
  time to a model. A proposal comes back: what to keep today, what to pull in
  (overdue), what to push to tomorrow, one short reason each. The user ticks or
  unticks items, then presses **Apply**. Nothing changes before that.
- **Not:** a chat, a companion, nudges, check-ins, "you're behind", streaks,
  praise, background re-planning, or time-blocking.
- **Where:** a first-party plugin listed in the community plugin directory
  (one-click install, not bundled), using the user's own Anthropic API key.
  Two small plugin API methods that wrap existing planner actions. No new NgRx
  action, op type, persisted model or sync-wire change.
- **Demand is weak** (§ 1): two AI-planning issues in eight years, 0 reactions
  each. The case rests on the market target, not on requests. So the order is:
  eval first, ship only if it clearly beats rules, and stay removable.
- **Gate:** before any app code, an offline eval must show the model beats a
  plain rule-based draft on realistic day fixtures. If it doesn't, we ship the
  rule-based draft (from the planning-facts work) and stop here.
- **Cost to the user:** about US$0.002–0.06 per run depending on model
  (estimate, § 6.5).

**Sections:** [1. Demand and fit](#1-demand-and-fit) ·
[2. Prior art](#2-prior-art) · [3. Assumptions](#3-assumptions-about-planning-facts) ·
[4. Where it lives](#4-where-it-lives-core-or-plugin) ·
[5. User flow](#5-user-flow) · [6. Model layer](#6-model-layer) ·
[7. Applying the plan and sync](#7-applying-the-plan-and-sync) ·
[8. Built-in vs external assistants](#8-built-in-vs-external-assistants) ·
[9. Evaluating quality without telemetry](#9-evaluating-quality-without-telemetry) ·
[10. Phases](#10-phases) · [11. Risks and open questions](#11-risks-and-open-questions) ·
[Review](#review)

## 1. Demand and fit

Searched 2026-10-31: about 40 terms over all issues (titles and bodies) and all
1,423 discussions (titles and bodies, not comments). Counts are reactions;
the main items were spot-checked against the API.

| Bucket                                  | Items                                                                                                                                                                                                                     | Reactions                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **AI plans my day**                     | #4718 "How to integrate AI?" (closed; maintainer: a plugin with your own key or a local model) · #4885 LLM turns a goal into a plan (closed; maintainer: paste a chatbot's list) · two lines in wishlist discussion #3812 | 0 · 0 · 2                    |
| **Rule-based auto-scheduling**          | Discussion #6051, community **AutoPlan** plugin ("as if it was an AI, but it isn't"), already one-click in the plugin directory · #10824 reuse today's plan for tomorrow (open) · discussion #5278                        | 6 · 0 · 1                    |
| **External assistants (MCP, API, CLI)** | #7056 API/CLI so AI agents can control SP (closed, local REST API shipped) · #11246 official CLI and MCP (open) · discussions #4770, #7256, #7895, #8385, #9704, #11350                                                   | 14 · 0 · ≤ 3 each, ~19 total |
| **Against AI**                          | #5952 remove default plugins, "I strongly prefer to not have any AI related tools" (open) · discussion #9120 how to disable auto-scheduling                                                                               | 0 · 0                        |

**What this says:**

- Nobody is asking for a built-in AI day planner. The two asks were answered
  "use a plugin with your own key", which is this plan.
- Interest in AI concentrates on **external** assistants controlling SP (#7056,
  14 reactions). That is the agent endpoint and the desktop MCP endpoint
  (§ 8), not this plan.
- Rule-based auto-planning already exists as a community plugin with modest
  interest (6 reactions).
- One explicit objection to AI shipped by default (#5952), which argues
  against bundling.

**Does it earn its place?** Not on demand. What it has going for it:

- Daily planning is a _must be best_ dimension, and "one-key auto-scheduling"
  is listed as something Sunsama, Akiflow and Motion do better
  ([scorecard](../market/scorecard.md#daily-planners-sunsama-akiflow-motion)).
  A scorecard gap alone does not justify a feature, per the review guide.
- The AI decision is open, and a removable plugin is the cheapest way to learn
  without committing core.

Hence the shape: the eval runs first and needs no app code (Phase 0). App work
starts only if the model clearly beats a rule-based draft **and** the survey's
Q8/Q10 counts don't argue against it (open question 1). The deterministic
planning facts and their rule-based draft are the higher-value step either
way; this plan must not delay them.

## 2. Prior art

Checked 2026-10 from vendor docs and review sites (snippets and secondhand
reports, no hands-on use). No Reddit or HN threads were read directly.

| App                           | What it plans                                                                       | How the user accepts                                        | Main complaints                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Sunsama**                   | Guided ritual; the user picks. AI only suggests estimates and channels from history | Prefilled values, edited inline; warns "overcommitted"      | Ritual becomes a chore; backlog piles up after skipped days; price                |
| **Motion**                    | Every task onto the calendar, continuously                                          | Applied directly, no preview; reshuffles when things change | "Schedule changed three times by 3 pm"; days packed too tight; time correcting it |
| **Akiflow (Aki)**             | Moves items when asked (beta assistant)                                             | Chat or voice command                                       | Price; chat is slow for a daily habit                                             |
| **Reclaim**                   | Tasks and habits into free calendar slots                                           | Writes to the calendar directly                             | Hundreds of events it created; focus blocks displaced; repeated override clicks   |
| **Todoist Assist**            | No day planning. Filters from plain language, task breakdown, email to task         | Preview, then "Add filter"; off until set up                | (none found specific to planning)                                                 |
| **TickTick**, **Notion Cal.** | No AI day plan. TickTick's "Plan your day" is manual; Notion AI answers in chat     | —                                                           | —                                                                                 |

Sources: [Sunsama AI](https://sunsama.com/features/ai) ·
[Sunsama AI changelog](https://roadmap.sunsama.com/changelog/ai-planned-time-and-channel-recommendations) ·
[Motion auto-scheduling](https://www.usemotion.com/help/time-management/auto-scheduling/concept-auto-scheduling) ·
[Motion reviews (saner.ai)](https://blog.saner.ai/motion-reviews) ·
[Morgen: Sunsama vs Motion](https://www.morgen.so/blog-posts/sunsama-vs-motion) ·
[Akiflow features](https://akiflow.com/features) ·
[Reclaim AI disclosure](https://help.reclaim.ai/en/articles/13178785-reclaim-ai-disclosure) ·
[Reclaim on Google Workspace Marketplace](https://workspace.google.com/u/0/marketplace/app/reclaimai/950518663892) ·
[Todoist Assist](https://www.todoist.com/help/articles/introduction-to-todoist-assist-KgPP22q5O) ·
[TickTick blog](https://blog.ticktick.com/?p=1332) ·
[Notion AI connector](https://www.notion.com/integrations/notion-ai-connector-for-notion-calendar).
The scorecard ([daily planners](../market/scorecard.md#daily-planners-sunsama-akiflow-motion))
lists "one-key auto-scheduling" as something the planners do better.

**Take:**

- One proposal, made when asked, shown as a change list, applied only on
  **Apply** (the opposite of Motion and Reclaim).
- Propose less than the day holds, and say what was left out (Sunsama's
  "overcommitted" is its best-liked part).
- Overrides are checkboxes in the proposal, not a chat round trip.
- Reasons come from the user's own facts ("overdue 3 days", "pushed 4 times",
  "fits the 40 min left"), not generic tips.
- Bring your own key; no subscription.

**Deliberately don't:**

- Continuous or background re-planning (Motion, Reclaim).
- Writing calendar events or time blocks. v1 only changes the day a task is
  planned for.
- A chat assistant (Aki, Notion AI).
- A ritual that asks every morning (product principles: no nudges).

## 3. Assumptions about planning facts

Step 2 of the agreed order (deterministic planning facts, evaluated on
`claude/planning-facts-evaluation`) was not on the remote when this was written.
This plan works with any subset and states what it uses:

| Fact                                                  | Source if planning facts ship | Fallback if not                                                                                                 |
| ----------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Available time today                                  | planning facts                | `PlannerDay.availableHours` minus timed items (already computed by `selectPlannerDays`, `planner.selectors.ts`) |
| Time already committed (timed tasks, calendar events) | planning facts                | `PlannerDay.scheduledIItems` durations                                                                          |
| Estimate accuracy (tracked ÷ estimated)               | planning facts                | omitted; the model gets raw estimates                                                                           |
| Times a task was pushed                               | planning facts                | omitted                                                                                                         |

Only **available time** is required. Everything else is an optional field in
the model input (§ 6.1); the eval runs with and without it to show what each
fact is worth.

The planning-facts work should also produce a **rule-based draft** (keep due and
overdue, then by priority until the time is used). That draft is the baseline
the model has to beat (§ 9), and the model starts from it.

## 4. Where it lives: core or plugin

|                    | Core feature                                                       | Plugin (**recommended**: first-party, in the plugin directory, not bundled)                                              |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| AI decision (open) | Puts an LLM client and API key handling in core; hard to take back | Core stays AI-free; the plugin can be dropped without a migration                                                        |
| UI                 | Can render inside the Planner                                      | Own side panel, which can stay open next to the Planner; not inline                                                      |
| Settings surface   | New global config section (persisted model, synced)                | Plugin config and secret storage; nothing in `GlobalConfig`                                                              |
| API key            | Needs new local-only storage                                       | `setSecret`/`getSecret` exist: local, never synced or exported                                                           |
| Network            | New HTTP path in core                                              | `request()` bridge with `allowedHosts` exists; the prototype's streaming client exists                                   |
| Reading data       | Selectors directly                                                 | `getTasks`, `getDayContext` exist; **missing:** day capacity (§ 4.1)                                                     |
| Applying a plan    | Existing actions directly                                          | **Missing:** a planning method; `updateTask({ dueDay })` skips Today ordering, reminder clearing and planner-day cleanup |
| Long-term cost     | Core code and a config slice forever                               | Two plugin API methods forever (public contract)                                                                         |

**Recommendation: a first-party plugin, listed in the plugin directory
(`src/assets/community-plugins.json`, one-click install), not bundled.** The
model call, prompt, key and proposal UI live in
`packages/plugin-dev/ai-day-planner`. Core gains two plugin API methods that
wrap what the Planner already does. This keeps the market doc's open AI
decision open: if the eval or users say no, we unlist a plugin.

Why not bundled and off by default: bundled plugins start disabled, but they
ship in every install and show in the plugin list. #5952 objects to exactly
that for the existing AI Prompts plugin. Listing costs users who want it one
click and costs nobody else anything.

The planning method also serves the community AutoPlan plugin and any other
planner plugin: today a plugin can only set `dueDay` through `updateTask`,
which skips what the Planner does (row "Applying a plan"). That second
consumer is part of why the API addition is worth its permanent cost. (How
AutoPlan writes today was not checked.)

**Challenge to the agreed shape.** "The proposal appears in the normal Planner"
needs a core preview surface. A plugin cannot draw inside the Planner. For v1
the side panel sits beside the Planner, and the Planner updates the moment the
user presses Apply. A core "proposed changes" preview in the Planner is worth
building only if a second source needs it: the rule-based draft from planning
facts, or an external assistant's `propose_day_plan` (§ 8). Then one preview
serves all three, and the plugin feeds it through one more method (Phase 3).

### 4.1 Plugin API additions

Both wrap existing code. They go in a new `plugin-bridge-planning.service.ts`,
because `plugin-bridge.service.ts` is at its pinned `max-lines` cap (2307).

| Method                                                                             | Wraps                                                                                                                   | Notes                                                                            |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `getDayCapacity?(day: string)` → `{ availableMs, committedMs, plannedEstimateMs }` | `selectPlannerDays` for that day (`availableHours`, `scheduledIItems`, `timeEstimate`)                                  | Numbers only. Calendar event titles never reach the plugin.                      |
| `planTasksForDay?(taskIds: string[], day: string)`                                 | `day === todayStr` → `TaskSharedActions.planTasksForToday` (one op); otherwise `PlannerActions.planTaskForDay` per task | The same actions the Planner, Add-to-Today and the daily summary dispatch today. |

Both optional (`?`), so older hosts are detected at runtime. Manifest
permission `planTasks` for the write method. If planning facts ship a plugin
read method first, `getDayCapacity` folds into it.

Not added: unscheduling, reordering existing Today tasks, `dueWithTime` writes.

## 5. User flow

1. **Turn it on.** Settings → Plugins → install _Help me plan today_ from the
   directory.
   First open shows a one-time notice, then asks for an API key:

   > When you press **Help me plan today**, Super Productivity sends to
   > Anthropic: the titles, estimates, time spent, due dates and deadlines of
   > the tasks on Today, overdue or due in the next 7 days, plus how many
   > minutes you have free today. Not sent: notes, subtasks' notes,
   > attachments, project and tag names, calendar event titles, anything else.
   > Your key stays on this device. [Show an example of what is sent]

   "Show an example" renders the exact JSON of the next request from the
   user's own data.

2. **Ask.** A header button (or the side panel) → **Help me plan today**. One
   request, a spinner with **Cancel**. Never runs on its own.

3. **Review.** The side panel lists three groups, each row with a checkbox and
   a one-line reason:
   - **Today** (n tasks, 5 h 10 min of 5 h 30 min free)
   - **Pull in** (overdue or due today, not yet on Today)
   - **Move to tomorrow**

   Unchanged tasks are not listed. Unticking a row drops that change. The
   totals update locally.

4. **Apply.** One button. A snack: "Plan applied · Undo". Undo puts each
   changed task back on its previous day through the same method.

5. **Done.** No follow-up, no score, no "great job".

## 6. Model layer

### 6.1 Input

Built locally by the plugin from `getTasks()`, `getDayContext()` and
`getDayCapacity()`. Ids are replaced with short aliases (`t1`, `t2`…) and
mapped back locally, so real ids never leave the device and the model can only
answer with ids from this list.

```json
{
  "today": "2026-10-31",
  "weekday": "Saturday",
  "freeMin": 330,
  "committedMin": 90,
  "estimateRatio": 1.4,
  "candidates": [
    {
      "id": "t1",
      "title": "Review PR 812",
      "estMin": 30,
      "spentMin": 0,
      "on": "today",
      "due": null,
      "deadline": "2026-11-02",
      "priority": 1,
      "pushed": 3,
      "repeat": false,
      "fixed": false
    }
  ],
  "draft": { "today": ["t1", "t4"], "tomorrow": ["t7"] }
}
```

- **Candidates:** tasks on Today, overdue, and with a due date or deadline in
  the next 7 days; open, top-level, not done. Capped at 80 by date. No backlog
  in v1: the model triages what the user already put on the radar.
- `fixed: true` for tasks with a time (`dueWithTime`). They count toward
  committed time and cannot be moved.
- `estimateRatio`, `pushed`, `draft` are optional (§ 3).
- About 30 tokens per task; 80 tasks plus instructions ≈ 3–4k input tokens.

### 6.2 Output

Structured output (`output_config.format` with a JSON schema). Forced
`tool_choice` returns a 400 on Opus 5.5 and Sonnet 5.5, so a tool call is not
the way to force the shape.

```json
{
  "today": [{ "id": "t1", "reason": "Deadline Monday, 30 min" }],
  "pullIn": [{ "id": "t9", "reason": "Overdue 3 days" }],
  "tomorrow": [{ "id": "t7", "reason": "Pushed 4 times; no deadline; day is full" }]
}
```

**Local validation**, before anything is shown:

- Every id is a candidate; no id appears twice; `fixed` tasks only in `today`.
- `pullIn` only holds candidates not already on Today; `tomorrow` only holds
  candidates on Today or overdue.
- Reasons are plain text, ≤ 100 characters, rendered with `textContent`.
- Total estimate of `today` + `pullIn` + committed ≤ free time. If over, show
  the proposal with a visible "over by 40 min" line, don't fix it silently.
- Candidates the model didn't mention stay unchanged.

Invalid ids are dropped with a note. Invalid JSON or a schema mismatch: one
retry, then an error and no changes.

The model cannot create tasks, edit titles, change estimates or touch tasks
outside the candidate list. That is enforced by the alias map, not by the
prompt.

### 6.3 Prompt

A fixed system prompt (cached) describes the job: fit the free time, keep hard
dates, prefer finishing over starting, leave slack (about 15% unless the user
sets otherwise), push what was pushed often only with a reason, short reasons
using the given facts. Task titles go in the user turn as data. Titles can come
from GitHub or Jira issues, so they are untrusted; the worst a hostile title
can do is skew which of the user's own candidates get picked, and the user
sees the result before applying.

### 6.4 Latency and failures

- **Target:** proposal in under 5 s typical, 15 s worst. Measured in the eval
  (§ 9), not assumed. Not streamed: the result is shown whole.
- **Timeout** 30 s, then "Took too long. Try again." Nothing changed.
- **Offline / no key / 401 / 429 / refusal:** a plain message; the button
  stays usable. Offline, the panel offers the rule-based draft if planning
  facts ship it, labelled as such.
- **Day changed or tasks changed** between proposal and Apply (`dayChange` or
  `dataChanged` hook): rows for changed tasks are dropped and the panel says
  so; a day change discards the proposal.

### 6.5 Model and cost

Prices from the Claude API reference (cached 2026-10-06). Per run: ~4k input,
~0.5k output, plus thinking at `low` effort (assumed ~1.5k). Estimates, to be
replaced by eval measurements.

| Model      | $/MTok in / out | Per run (est.) | One run a day for a month |
| ---------- | --------------- | -------------- | ------------------------- |
| Haiku 5.5  | 0.10 / 0.50     | ~$0.0015       | ~$0.05                    |
| Sonnet 5.5 | 2 / 10          | ~$0.03         | ~$0.90                    |
| Opus 5.5   | 4 / 20          | ~$0.06         | ~$1.80                    |

**Default:** the cheapest model that meets the eval bar (§ 9). Opus 5.5 at
`low` effort is the quality reference. A model picker is in the plugin's
settings; no other knobs.

**Provider:** Anthropic only in v1 (the prototype's client, `CapacitorWebFetch`
on mobile). A local model (Ollama, LM Studio) would fit "privacy first" best,
but the plugin `request()` bridge blocks private networks for non-issue-provider
plugins; opening that is a security decision (§ 11).

## 7. Applying the plan and sync

What exists today:

| Path                                                                                                    | Action dispatched                                                               | Ops                               |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------- |
| Add to Today (context menu, multi-select `task-bulk-action.service.ts`, add-tasks-for-tomorrow service) | `TaskSharedActions.planTasksForToday({ taskIds, today, startOfNextDayDiffMs })` | 1 bulk op (`isBulk`, `entityIds`) |
| Planner drag to a day, schedule dialog                                                                  | `PlannerActions.planTaskForDay({ task, day })`                                  | 1 per task                        |
| Daily summary "plan all for tomorrow"                                                                   | loop of `PlannerActions.planTaskForDay`                                         | 1 per task                        |
| Reorder Today                                                                                           | `moveTaskInTodayList` / `moveTaskInTodayTagList`                                | 1 per move                        |

Apply maps onto these, adding no new action:

1. **Today + pull in** → one `planTasksForToday` with the ids in proposed
   order. Its meta-reducer sets `dueDay`, clears `remindAt` and stale
   `dueWithTime`, prepends to `TODAY_TAG.taskIds` (ordering only, rule 5), and
   removes the ids from planner days. Already on Today = no-op for that task.
2. **Move to tomorrow** → `planTaskForDay` per task, the same loop the daily
   summary runs. Tomorrow comes from `DateService` (logical day), not
   `new Date()`.
3. **Reordering existing Today tasks** → not in v1. It would be a pairwise move
   per task on the shared Today order, the most conflict-prone part, for little
   gain.

Why this is safe:

- **One intent, how many ops?** The atomicity rule asks for one op per
  _replay-atomic_ transition, not per UI workflow. Moving task A to tomorrow and
  task B to tomorrow are independent: a crash between them leaves a valid
  state, and each keeps its own per-task conflict boundary (rule 6 allows the
  loop; no yields needed). The "add to Today" half is already one bulk op.
- **No new sync surface.** No new action type, op code, entity, persisted field
  or schema bump. Released clients already replay both actions.
- **No effects on replay.** The plugin acts only on a button press; hooks fire
  for local actions, and `dataChanged`/`dayChange` handlers only refresh the
  panel (their documented contract). Two devices with the plugin never
  re-plan each other's changes.
- **Logical day.** `getDayContext().todayStr` for "today"; the host passes
  `today` and `startOfNextDayDiffMs` into `planTasksForToday` as the actions
  already require.
- **Conflicts.** A concurrent edit on another device resolves per task like any
  manual planner move. `planTasksForToday` declares several task ids; it is an
  existing action with an existing resolution path, so rule 14 adds nothing
  new. Confirm in Phase 2 with one E2E (apply on A while B edits one task).
- **Undo** replays the same two actions with each task's previous day (or
  `unscheduleTask` if it had none). The pre-image lives in memory only.

## 8. Built-in vs external assistants

The agent endpoint plan (on `claude/sp-executable-data-model-gewi7j`) gives
assistants `get_today_context`, `plan_for_today` and `schedule_task`, and parks
`propose_day_plan`. The desktop MCP endpoint on master has read and create
tools only (`electron/mcp/mcp-tools.ts`).

They serve different users:

- **External:** people who already live in Claude, ChatGPT or Gemini and plan
  in conversation. Their assistant, their subscription, their data policy.
- **Built-in:** people who want one button inside SP and no chat.

What they should share, so neither grows its own planning logic:

| Piece                                      | Owner                                      | Used by                                                    |
| ------------------------------------------ | ------------------------------------------ | ---------------------------------------------------------- |
| "Plan these tasks for day X" (§ 7 mapping) | one host function behind `planTasksForDay` | plugin API now; MCP `plan_for_today`/`schedule_task` later |
| Day capacity numbers                       | planning facts / `getDayCapacity`          | plugin; MCP `get_today_context`                            |
| Candidate list + validation of a proposal  | the plugin in v1                           | moves to core only if MCP `propose_day_plan` is built      |

The built-in planner does not need the agent endpoint, and the endpoint does
not need this plugin. Neither blocks the other.

## 9. Evaluating quality without telemetry

No analytics. Quality comes from an offline eval and from what users choose to
share.

**Offline eval** (`packages/plugin-dev/ai-day-planner/eval/`, reusing the
prototype's `scripts/eval.js` pattern):

- 40 day fixtures written by hand from realistic shapes: overfull day, empty
  day, all overdue after a holiday, weekend, a day of meetings with 1 h free,
  many repeat tasks, no estimates at all, 80 candidates, non-English titles,
  a title that tries prompt injection, a task pushed 10 times.
- **Hard checks** (code, must be 100%): valid ids only, no duplicates, fixed
  tasks not moved, nothing due today or with a deadline today pushed, total ≤
  free time (or flagged), reasons ≤ 100 characters and quoting only given
  facts.
- **Soft checks** (per fixture, labelled by the maintainer): an "acceptable"
  set of today tasks and a "must not push" set; score = overlap. Compared
  against the rule-based draft on the same fixtures.
- **Ship bar:** hard checks 100% on every model offered; soft score clearly
  above the draft (target: +15 points, to be set after the first run); p95
  latency under 15 s. If the model doesn't beat the draft, don't ship the
  model.
- Runs by hand (it costs money: ~40 × $0.06 on Opus), not in CI. CI runs the
  validator and alias-map unit tests on recorded responses.

**Opt-in feedback:**

- **Share an anonymized example:** a panel link copies the last input and
  output with titles replaced by "Task 1…", ready to paste into an issue. New
  fixtures come from these.
- The survey's Q8 ("I don't want AI in my task app") and a GitHub discussion
  after release. Nothing is counted on the device or sent anywhere.

## 10. Phases

| Phase                             | Scope                                                                                               | Exit                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **0. Eval first** (no app change) | Fixtures, prompt, validator, rule-based baseline, run on Haiku/Sonnet/Opus 5.5                      | Ship bar met → Phase 1. Not met → record why, stop.           |
| **1. Plugin, desktop + web**      | Directory-listed plugin, notice, key, side panel, Apply, Undo; `getDayCapacity` + `planTasksForDay` | Works end to end; unit tests for validator and bridge methods |
| **2. Mobile + E2E**               | Android/iOS via `CapacitorWebFetch`; E2E: apply on device A while B edits a task, both converge     | E2E green on SuperSync                                        |
| **3. On demand only**             | Core Planner preview shared with planning facts and MCP; backlog pull; local model                  | A second consumer or user requests                            |

**Smallest useful version:** Phase 0 + 1. Triage of Today: keep, pull in
overdue, push to tomorrow, with reasons.

**Not planned:** time-blocking (`dueWithTime`), reordering Today, chat,
automatic or scheduled runs, multi-day or weekly plans.

## 11. Risks and open questions

**Risks**

- **The model doesn't beat the rules.** Likely for small days. Then the AI
  adds cost and a privacy notice for nothing. Phase 0 exists to find out first.
- **Trust after one bad plan.** Mitigated by preview, unticking, Undo, and
  never acting without a press.
- **Privacy expectations.** Titles leave the device. The notice names exactly
  what, shows a real example, and the feature is off by default and per
  device (the key is not synced).
- **Plugin API is permanent.** Two optional methods. Wrap existing actions
  only, so their meaning can't drift from the Planner's.
- **Prompt injection via issue titles.** Bounded: output is a selection over
  the user's own candidates and is previewed.

**Open questions for the maintainer**

1. Survey results: how many picked "I don't want AI in my task app" (Q8) and
   "Connect to AI assistants" (Q10)? A large "don't want" share argues for
   keeping this a plugin forever, or not shipping it.
2. Directory-listed first-party plugin (recommended) or bundled and off by
   default? Bundling is easier to find; #5952 asks for the opposite.
3. Project names in the input: they help ("Work" on a Saturday) but are more
   data. v1 leaves them out. Add later behind the same notice?
4. Local models: open the `request()` private-network guard for this plugin, or
   leave local models to the external-assistant path?
5. Should the rule-based draft (planning facts) get the core Planner preview
   first, with this plugin feeding the same preview later?

## Review

REVIEW_PLACEHOLDER
