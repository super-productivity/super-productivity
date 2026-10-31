# Help me plan today: an optional AI day planner

Oct 31, 2026 · rev. 2 after review · status: **proposal**, nothing implemented · branch `claude/ai-plan-today`

**Related:** generative views, parked (`docs/plans/2026-10-30-generative-views.md`
on `claude/generative-ui-todo-app-h4o6e8`) · agent endpoint / MCP plan
(`docs/plans/2026-09-16-work-api-mcp-and-headless-device.md` on
`claude/sp-executable-data-model-gewi7j`) · [market target](../market/README.md)
(daily planning is _must be best_, AI is an _open decision_) ·
[contributor sync model](../sync-and-op-log/contributor-sync-model.md) ·
[survey: Planner and Schedule](2026-10-28-survey-planner-schedule.md).

## Summary

- **What:** one button, **Help me plan today**. SP sends the tasks already on
  the radar (on Today, overdue, deadline within 7 days: titles, estimates,
  dates) and today's free minutes to a model. A proposal comes back: what to
  pull in and what to move to tomorrow, one short reason each. The user
  unticks what they don't want and presses **Apply**. Nothing changes before
  that.
- **Not:** a chat, a companion, nudges, check-ins, "you're behind", streaks,
  praise, background re-planning, or time-blocking.
- **Where:** a first-party plugin listed in the plugin directory (one-click
  install, not bundled), using the user's own Anthropic API key. **v1 needs no
  plugin API or core change**: it applies the plan with the existing
  `updateTask({ dueDay })`.
- **Demand is weak** (§ 1): two AI-planning issues in eight years, 0 reactions
  each. The case rests on the market target, not on requests.
- **Gate:** an offline eval runs first (no app code). If the model doesn't
  clearly beat a plain rule-based draft on realistic days, stop.
- **Cost to the user:** about US$0.002–0.07 per run depending on model
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
planning facts are the higher-value step either way; this plan must not delay
them.

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
- Reasons come from the user's own facts ("overdue 3 days", "deadline Monday",
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
`claude/planning-facts-evaluation`) was not on the remote when this was
written. This plan needs none of it and uses what survives:

| Input                  | v1 source (plugin can read it today)                                                                                                                                                                                | Better if planning facts ship     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **Free minutes today** | `getAppState().globalConfig` schedule: work hours from now to work end, minus lunch ahead; 8 h minus time tracked today when work hours are off (the Planner's `DEFAULT_WORK_HOURS`). Minus timed tasks still ahead | includes calendar events          |
| Estimate accuracy      | —                                                                                                                                                                                                                   | tracked ÷ estimated, last 30 days |
| Times a task was moved | —                                                                                                                                                                                                                   | per task                          |

**Known v1 gap:** calendar events are not readable by plugins, so a day full
of meetings looks free. The eval has meeting-heavy fixtures to measure how much
that hurts. If it matters, the fix is one read-only number (busy minutes from
calendar events), ideally from the planning-facts work rather than a second
API.

The eval's baseline is a **rule-based draft**: keep what has a time or a
reminder, keep what has a deadline today or earlier, pull in overdue, then add
by priority and age until the free time is used, move the rest to tomorrow.
If planning facts produce such a draft, the eval uses theirs; otherwise
Phase 0 writes this one inside the eval harness. It is not shipped by this
plan.

## 4. Where it lives: core or plugin

|                    | Core feature                                                       | Plugin (**recommended**: first-party, in the plugin directory, not bundled)            |
| ------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| AI decision (open) | Puts an LLM client and API key handling in core; hard to take back | Core stays AI-free; the plugin can be unlisted without a migration                     |
| UI                 | Can render inside the Planner                                      | Own side panel, which can stay open next to the Planner; not inline                    |
| Settings           | New global config section (persisted model, synced)                | Plugin config and secret storage; nothing in `GlobalConfig`                            |
| API key            | Needs new local-only storage                                       | `setSecret`/`getSecret`: local, never synced or exported                               |
| Network            | New HTTP path in core                                              | `request()` with `"http"` permission and `allowedHosts: ["api.anthropic.com"]`         |
| Reading data       | Selectors directly                                                 | `getTasks`, `getAppState`, `getDayContext`; no calendar events (§ 3)                   |
| Applying a plan    | Existing actions directly                                          | `updateTask(id, { dueDay })`, which already keeps planner days and Today in step (§ 7) |
| Long-term cost     | Core code and a config slice forever                               | None in core for v1                                                                    |

**Recommendation: a first-party plugin, listed in the plugin directory
(`src/assets/community-plugins.json`), not bundled.** Source in
`packages/plugin-dev/ai-day-planner`; one-click install needs a release zip,
its `downloadUrl` and sha256, published like the Ridonculous plugins (#11367).
If the eval or users say no, we unlist it.

Why not bundled and off by default: bundled plugins start disabled but ship in
every install and show in the plugin list. #5952 objects to exactly that for
the existing AI Prompts plugin.

**Challenge to the agreed shape.** "The proposal appears in the normal
Planner" needs a core preview surface; a plugin cannot draw inside the
Planner. For v1 the side panel sits beside the Planner, and the Planner
updates when the user presses Apply. A core "proposed changes" preview is worth
building only when a second source needs it (the rule-based draft, or an
external assistant's `propose_day_plan`); then one preview serves all.

**Plugin API changes:** none in v1. Later, only on evidence: busy minutes from
calendar events (§ 3), and adding `priority` and `deadlineDay` to the plugin
`Task` type (sent at runtime already, missing from `types.ts`; also proposed in
the generative-views plan).

## 5. User flow

1. **Turn it on.** Settings → Plugins → install _Help me plan today_ from the
   directory. First open shows a one-time notice, then asks for an API key:

   > When you press **Help me plan today**, Super Productivity sends this to
   > Anthropic, and nothing else:
   >
   > - for each task on Today, overdue, or with a deadline in the next 7 days
   >   (up to 80): its title, estimate, time spent, whether it is on Today or
   >   overdue, due date, deadline, priority, whether it repeats, and whether
   >   it has a fixed time or reminder;
   > - for the day: the date, the weekday and your free minutes.
   >
   > Not sent: task ids, notes, subtasks, attachments, project and tag names,
   > calendar events. Your key stays on this device. [Show what would be sent]

   "Show what would be sent" renders the exact JSON of the next request from
   the user's own data. If planning facts later add fields, the notice lists
   them before they are sent.

2. **Ask.** The side panel's **Help me plan today** button. One request, a
   spinner with **Cancel**. Never runs on its own.

3. **Review.** A summary line computed locally ("Today: 7 tasks, 4 h 50 min of
   5 h 30 min free"), then two groups, each row with a checkbox and a reason:
   - **Pull in:** not on Today yet (overdue, or deadline within 7 days)
   - **Move to tomorrow:** on Today or overdue

   Tasks that stay as they are are not listed. Unticking a row drops that
   change and updates the summary.

4. **Apply.** One button, then a plain snack "Plan applied". No undo in v1
   (§ 7); every change is an ordinary planner move the user can drag back.

5. **Done.** No follow-up, no score, no "great job".

## 6. Model layer

### 6.1 Input

Built by the plugin. Ids are replaced with short aliases (`t1`, `t2`…) and
mapped back locally, so real ids never leave the device and the model can only
answer with ids from this list.

```json
{
  "date": "2026-10-31",
  "weekday": "Saturday",
  "freeMin": 330,
  "tasks": [
    {
      "id": "t1",
      "title": "Review PR 812",
      "estMin": 30,
      "spentMin": 0,
      "where": "today",
      "due": "2026-10-31",
      "deadline": "2026-11-02",
      "priority": 1,
      "repeats": false,
      "fixed": false
    }
  ]
}
```

- **Tasks:** open, top-level tasks that are on Today, overdue (`dueDay` before
  today), or have a deadline within 7 days. Capped at 80, earliest dates first.
  No backlog in v1: the model triages what the user already put on the radar.
- `where`: `today`, `overdue` or `later`.
- `fixed: true` for tasks with a time (`dueWithTime`) or a reminder
  (`remindAt`). They are never moved, so their reminders are never touched.
  Fixed tasks today are already subtracted from `freeMin`.
- Planning facts, when they exist, add optional `estimateRatio` and `moved`
  (§ 3) and the notice grows with them.
- About 60 tokens per task: 80 tasks plus instructions ≈ 6k input tokens.

### 6.2 Output

Structured output (`output_config.format` with a JSON schema). Forced
`tool_choice` returns a 400 on Opus 5.5 and Sonnet 5.5, so a forced tool call
is not the way to get the shape. The model returns only changes:

```json
{
  "pullIn": [{ "id": "t9", "reason": "Overdue 3 days, 20 min" }],
  "tomorrow": [{ "id": "t7", "reason": "No deadline; today is full" }]
}
```

**One validator**, used by the app and the eval alike. A proposal fails if:

1. an id is not in the input, or appears twice;
2. a `fixed` task is in either list;
3. `pullIn` holds a task already on Today, or `tomorrow` holds a task with
   `where: later`;
4. `tomorrow` holds a task with a deadline today or earlier;
5. a reason is not plain text or is over 100 characters.

Failed items are dropped with a note; if the JSON doesn't parse or match the
schema, one retry, then an error and no changes. Reasons are rendered with
`textContent`.

**Fit to the day** is checked, not enforced: the summary line shows "over by
40 min" when kept + pulled-in estimates exceed `freeMin`.

The model cannot create tasks, edit titles, change estimates or touch tasks
outside the input. The alias map enforces that, not the prompt.

### 6.3 Prompt

A fixed, cached system prompt: fit the free time with about 15% slack, keep
hard dates, prefer finishing over starting, short reasons that use only the
given facts. Task titles go in the user turn as data. Titles can come from
GitHub or Jira issues, so they are untrusted; the worst a hostile title can do
is skew which of the user's own tasks are picked, and the user sees the result
before applying.

### 6.4 Latency and failures

- **Target:** under 5 s typical, 15 s worst; measured in the eval (§ 9). Not
  streamed: the result is shown whole.
- **Timeout** 30 s, then "Took too long. Try again." Nothing changed.
- **Offline, no key, 401, 429, refusal:** a plain message. Nothing changed.
- **Stale proposal:** on Apply the plugin re-reads the tasks and drops rows
  whose `dueDay`, `dueWithTime`, `remindAt`, `isDone` or estimate changed since
  the proposal, and says so. A `dayChange` discards the proposal. (`dataChanged`
  has no payload and fires on every tracking tick, so it is not used per row.)

### 6.5 Model and cost

Prices from the Claude API reference (cached 2026-10-06). Per run: ~6k input,
~0.5k output plus thinking at `low` effort (assumed ~1.5k). Estimates, to be
replaced by eval measurements.

| Model      | $/MTok in / out | Per run (est.) | One run a day for a month |
| ---------- | --------------- | -------------- | ------------------------- |
| Haiku 5.5  | 0.10 / 0.50     | ~$0.002        | ~$0.05                    |
| Sonnet 5.5 | 2 / 10          | ~$0.03         | ~$1                       |
| Opus 5.5   | 4 / 20          | ~$0.07         | ~$2                       |

**Default:** the cheapest model that meets the eval bar. Opus 5.5 at `low`
effort is the quality reference. The only setting is a model picker.

**Provider:** Anthropic only in v1. A local model (Ollama, LM Studio) would
fit "privacy first" best, but `request()` blocks private networks for plugins
other than bundled issue providers (`plugin-bridge.service.ts:499`); opening
that is a security decision (§ 11).

## 7. Applying the plan and sync

Apply calls `updateTask(id, { dueDay })` once per ticked row: today's date for
**Pull in**, tomorrow's for **Move to tomorrow**, both from
`getDayContext()` (logical day, rule 4).

What that already does, in the task update meta-reducer
(`task-shared-crud.reducer.ts:966-1020`): removes the task from its old planner
day, adds it to the new one (unless it is today), and adds it to or removes it
from `TODAY_TAG.taskIds`, which only orders (rule 5). Pulled-in tasks land at
the end of Today. This is the same path a two-way issue sync takes.

Why not the Planner's own actions:

- `TaskSharedActions.planTasksForToday` is one bulk op, but it also picks up
  timed tasks on Today (setting a time clears `dueDay`,
  `task-shared-scheduling.reducer.ts:81-85`) and clears their reminders. It
  also needs a new plugin API method.
- `PlannerActions.planTaskForDay` clears `remindAt` and `dueWithTime`. Not
  needed when fixed tasks are never moved.

Why this is safe:

- **Ops.** One `updateTask` op per moved task, each on one entity. Typical
  apply: 3–15 ops. The atomicity rule asks for one op per replay-atomic
  transition, not per UI workflow: moving A and moving B are independent, a
  crash between them leaves a valid state, and each keeps its own per-task
  conflict boundary. Rule 6 allows the loop without yields.
- **No new sync surface.** No new action, op code, entity, persisted field,
  plugin API or schema bump. Released clients already replay `updateTask`.
- **No effects on replay.** The plugin acts only on a button press. Its
  `dayChange` handler only discards the panel's proposal. Two devices with the
  plugin never re-plan each other's changes.
- **Conflicts.** A concurrent edit to the same task on another device resolves
  like any other `dueDay` edit (field-level LWW). Phase 2 adds one E2E: apply
  on A while B edits one of the tasks; both converge.
- **No undo in v1.** Replaying "the previous day" would lose order and would
  overwrite edits other devices made after Apply. The preview is the
  safeguard; a wrong move is one drag in the Planner.

## 8. Built-in vs external assistants

The agent endpoint plan (on `claude/sp-executable-data-model-gewi7j`) lets
assistants read the day and `plan_for_today`; the desktop MCP endpoint on
master has read and create tools only (`electron/mcp/mcp-tools.ts`).

- **External** is for people who plan in conversation with their own
  assistant and subscription. Demand points here (§ 1).
- **Built-in** is for people who want one button in SP and no chat.

They share nothing in v1 and neither blocks the other. If both grow, they
should share one host "plan these tasks for day X" function and the free-time
numbers, so planning logic lives in one place.

## 9. Evaluating quality without telemetry

No analytics. Quality comes from an offline eval and from what users choose to
share.

**Offline eval** (`packages/plugin-dev/ai-day-planner/eval/`, the prototype's
`scripts/eval.js` pattern):

- 40 hand-written day fixtures: overfull day, empty day, all overdue after a
  holiday, weekend, a day of meetings with 1 h free, many repeat tasks, no
  estimates, 80 tasks, non-English titles, a prompt-injection title, a task
  overdue for weeks.
- **Hard:** the § 6.2 validator passes on every fixture, for every model
  offered.
- **Soft** (labelled by the maintainer per fixture): an "acceptable Today" set
  and a "must not move" set; score = overlap. The fit to free time is reported.
  Both are compared with the rule-based draft (§ 3).
- **Ship bar:** hard 100%; soft score clearly above the draft (margin set after
  the first run); p95 latency under 15 s.
- Run by hand (about 40 × $0.07 on Opus), not in CI. CI runs the validator and
  alias map on recorded responses.

**Opt-in feedback:** a GitHub discussion after release, and the survey's Q8.
Users can paste the "Show what would be sent" JSON, with titles edited, into
an issue; good cases become fixtures. Nothing is counted on the device or sent
anywhere.

## 10. Phases

| Phase                             | Scope                                                                                            | Exit                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| **0. Eval first** (no app change) | Fixtures, prompt, validator, rule-based draft, runs on Haiku, Sonnet and Opus 5.5                | Bar met → Phase 1. Not met → record why, stop                           |
| **1. Plugin, desktop + web**      | Plugin: notice, key, side panel, Apply; directory listing                                        | Works end to end; unit tests for validator, free-time calc, stale check |
| **2. Mobile + E2E**               | Android and iOS (`request()` vs the prototype's `CapacitorWebFetch` client); concurrent-edit E2E | E2E green on SuperSync                                                  |
| **Later, on evidence only**       | Calendar busy minutes; core Planner preview; backlog pull; local model                           | A user request or a second consumer                                     |

**Smallest useful version:** Phase 0 + 1. Triage of what is already on the
radar: pull in, move to tomorrow, with reasons.

**Not planned:** time-blocking, reordering Today, undo, chat, automatic or
scheduled runs, weekly plans.

## 11. Risks and open questions

**Risks**

- **The model doesn't beat the rules.** Likely for small days. Then it adds
  cost and a privacy notice for nothing. Phase 0 finds out before app code.
- **Meeting-heavy days look free** (§ 3). Measured in the eval.
- **Trust after one bad plan.** Preview, unticking, and never acting without a
  press.
- **Privacy expectations.** Titles leave the device. The notice lists every
  field and shows a real example; the plugin is not installed by default; the
  key is per device.
- **Prompt injection via issue titles.** Bounded: the output is a selection
  over the user's own tasks and is previewed.

**Open questions for the maintainer**

1. Survey: how many picked "I don't want AI in my task app" (Q8) and "Connect
   to AI assistants" (Q10)? A large "don't want" share argues for not shipping.
2. Directory-listed (recommended) or bundled and off by default? Bundled is
   easier to find; #5952 asks for the opposite.
3. Project names in the input help ("Work" on a Saturday) but are more data.
   Leave out (v1) or add behind the notice?
4. Local models: open the private-network guard for this plugin, or leave
   local models to the external-assistant path?

## Review

A fresh-context subagent reviewed rev. 1 (2026-10-31) against
`docs/feature-review-guide.md`, the product principles and the sync rules,
checking claims against the code. Findings, and what rev. 2 did:

| #   | Finding                                                                                                                                                                      | Severity | Outcome                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | The reason for a new `planTasksForDay` API was false: `updateTask({ dueDay })` already updates planner days and `TODAY_TAG.taskIds` (`task-shared-crud.reducer.ts:966-1020`) | High     | **Fixed.** Both API methods dropped; v1 applies with `updateTask` (§ 4, § 7)                                               |
| 2   | One `planTasksForToday` for "keep + pull in" would clear reminders on timed tasks on Today (setting a time clears `dueDay`)                                                  | High     | **Fixed.** Not used; only pull-in and tomorrow rows are written; tasks with a time or reminder are `fixed` and never moved |
| 3   | Undo was lossy (reminders, Today order, past planner days) and could overwrite later edits from other devices                                                                | High     | **Fixed** by cutting undo from v1; the preview is the safeguard (§ 7)                                                      |
| 4   | The privacy notice didn't match the fields sent                                                                                                                              | High     | **Fixed.** Notice lists every § 6.1 field; `committedMin`, `draft` and planning-facts fields removed from v1 input         |
| 5   | "Pull in" defined three ways                                                                                                                                                 | Medium   | **Fixed.** One definition: not on Today, overdue or deadline within 7 days                                                 |
| 6   | Capacity wrong: `availableHours` is undefined without work hours, covers the whole day, committed time subtracted twice                                                      | Medium   | **Fixed.** `freeMin` defined once (§ 3), checked once (§ 6.2)                                                              |
| 7   | `dataChanged` has no payload and fires on tracking ticks                                                                                                                     | Medium   | **Fixed.** Stale check compares named fields on Apply (§ 6.4)                                                              |
| 8   | App validator and eval hard checks differed; "quotes only given facts" isn't checkable                                                                                       | Medium   | **Fixed.** One validator list (§ 6.2), used by both                                                                        |
| 9   | Manifest needs `http` and `allowedHosts`; one-click install needs zip, `downloadUrl`, sha256                                                                                 | Low      | **Fixed** (§ 4)                                                                                                            |
| 10  | Token and cost numbers low; "no other knobs" vs a slack setting                                                                                                              | Low      | **Fixed.** ~60 tokens per task, costs recomputed; slack fixed at 15%                                                       |
| 11  | The gate committed another plan's deliverable                                                                                                                                | Low      | **Fixed.** Gate says only "stop"                                                                                           |
| 12  | Over-scoped: offline rule-based fallback, anonymized-example UI, long § 8, duplicate open question                                                                           | Low      | **Fixed.** All cut or shortened                                                                                            |

Not verified by the review: model prices and the forced-`tool_choice` 400
(both taken from the Claude API reference, cached 2026-10-06).

Not fixed, by choice: calendar events stay invisible to v1 (§ 3); it is
recorded as a gap and measured in the eval instead of adding a plugin API up
front.
