# Speak to plan: an optional AI command plugin

Oct 31, 2026 · rev. 3 · status: **proposal**, nothing implemented · branch
`claude/ai-plan-today`

**Related:** generative views, parked (`docs/plans/2026-10-30-generative-views.md`
on `claude/generative-ui-todo-app-h4o6e8`) · agent endpoint / MCP plan
(`docs/plans/2026-09-16-work-api-mcp-and-headless-device.md` on
`claude/sp-executable-data-model-gewi7j`) · [market target](../market/README.md)
(daily planning is _must be best_, AI is an _open decision_) ·
[contributor sync model](../sync-and-op-log/contributor-sync-model.md).

**Revisions:** rev. 1 was a one-shot "Help me plan today" button. Rev. 2 fixed
review findings. Rev. 3 follows the maintainer's direction (2026-10-31): many
users don't want AI, so it stays an optional plugin; and instead of one
button, a shortcut opens a box you speak or type into, to add or change tasks
or to see a temporary selection ("top 10 for today"). Planning the day is one
of those commands.

## Summary

- **What:** press a shortcut (or a button), speak or type one request, see the
  result, press **Apply**. Three kinds of result:
  - **Changes:** "add call mom tomorrow, 15 minutes, to Home", "mark the
    invoice tasks done", "move everything from Work on Today to Monday".
    Shown as a change list; nothing changes before **Apply**.
  - **A temporary selection:** "what should I focus on today, top 10", "show
    what's overdue in Work". A list with a reason per task, gone when the
    panel closes. Rows have the usual done, track and open actions.
  - **A day plan:** "plan my day". The rev. 2 planner: what to pull in, what
    to move to tomorrow, fitted to today's free time.
- **Not:** a chat, a companion, nudges, check-ins, "you're behind", streaks,
  praise, background runs, or time-blocking. Each request stands alone; the
  only memory is the selection on screen ("move these to tomorrow").
- **Where:** a first-party plugin listed in the plugin directory (one-click
  install, not bundled), with the user's own Anthropic API key. **v1 needs no
  plugin API, core or sync change.**
- **Voice in v1:** the system's own dictation into the box (macOS, Windows,
  phone keyboards). A true push-to-talk microphone needs a host speech service
  and is Phase 3 (§ 5).
- **Gate:** an offline eval of realistic requests runs first (no app code).
- **Cost to the user:** about US$0.003–0.12 per request depending on model
  (estimate, § 6.6).

**Sections:** [1. Demand and fit](#1-demand-and-fit) ·
[2. Prior art](#2-prior-art) · [3. What the user does](#3-what-the-user-does) ·
[4. Where it lives](#4-where-it-lives-core-or-plugin) · [5. Voice](#5-voice) ·
[6. Model layer](#6-model-layer) ·
[7. What v1 can and cannot change](#7-what-v1-can-and-cannot-change) ·
[8. Applying changes and sync](#8-applying-changes-and-sync) ·
[9. Built-in vs external assistants](#9-built-in-vs-external-assistants) ·
[10. Evaluating quality without telemetry](#10-evaluating-quality-without-telemetry) ·
[11. Phases](#11-phases) · [12. Risks and open questions](#12-risks-and-open-questions) ·
[Review](#review)

## 1. Demand and fit

Searched 2026-10-31: about 40 terms over all issues (titles and bodies) and all
1,423 discussions (titles and bodies, not comments). Counts are reactions; the
main items were spot-checked against the API.

| Bucket                                  | Items                                                                                                                                                                                                                     | Reactions                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **AI plans my day**                     | #4718 "How to integrate AI?" (closed; maintainer: a plugin with your own key or a local model) · #4885 LLM turns a goal into a plan (closed; maintainer: paste a chatbot's list) · two lines in wishlist discussion #3812 | 0 · 0 · 2                    |
| **Rule-based auto-scheduling**          | Discussion #6051, community **AutoPlan** plugin ("as if it was an AI, but it isn't"), already one-click in the plugin directory · #10824 reuse today's plan for tomorrow (open) · discussion #5278                        | 6 · 0 · 1                    |
| **External assistants (MCP, API, CLI)** | #7056 API/CLI so AI agents can control SP (closed, local REST API shipped) · #11246 official CLI and MCP (open) · discussions #4770, #7256, #7895, #8385, #9704, #11350                                                   | 14 · 0 · ≤ 3 each, ~19 total |
| **Against AI**                          | #5952 remove default plugins, "I strongly prefer to not have any AI related tools" (open) · discussion #9120 how to disable auto-scheduling                                                                               | 0 · 0                        |

**What this says:**

- Nobody asks for a built-in AI planner. The two asks were answered "use a
  plugin with your own key", which is this plan.
- AI interest concentrates on **external** assistants controlling SP (#7056,
  14 reactions): the agent endpoint and desktop MCP path (§ 9).
- **Voice capture** is a listed scorecard gap (TickTick, Todoist and To Do List
  have it) with no SP issue ([gaps](../market/scorecard.md#gaps)).
- Many users don't want AI (survey Q8, per the maintainer) and #5952 objects to
  AI shipped by default. **Maintainer decision, 2026-10-31:** fine as an
  optional plugin.

**Does it earn its place?** Not on issue demand. It rests on two market gaps
(one-key planning, voice capture) and on being removable: a directory plugin
costs non-users nothing, and core stays AI-free. The eval comes first, and the
deterministic planning facts (step 2 of the agreed order) are not delayed by
it.

## 2. Prior art

Checked 2026-10 from vendor docs, release notes and review sites (no hands-on
use; review-site claims are secondhand).

| App                | What it does with AI                                                                                       | How the user accepts                                                          | Complaints                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------- |
| **Todoist Ramble** | Speech braindump → several tasks with dates, priorities, projects. Raw audio to Gemini, no transcript step | Tasks shown first, then added; free plan limited, each dictation is a session | —                                                       |
| **TickTick**       | AI voice input splits one input into several tasks (paid); "AI Assistant" organizes lists; MCP support     | Unclear whether existing tasks can be edited by voice                         | —                                                       |
| **Akiflow (Aki)**  | Moves items when asked, chat or voice (beta)                                                               | Chat                                                                          | Chat is slow for a daily habit; price                   |
| **Sunsama**        | Guided planning ritual; AI only suggests estimates and channels from history                               | Prefilled, edited inline; "overcommitted" warning                             | Ritual becomes a chore; price                           |
| **Motion**         | Puts every task on the calendar, continuously                                                              | Applied directly, no preview; reshuffles                                      | "Schedule changed three times by 3 pm"; too-tight days  |
| **Reclaim**        | Tasks and habits into calendar slots                                                                       | Writes the calendar directly                                                  | Hundreds of events it created; repeated override clicks |

Sources: [Ramble help](https://www.todoist.com/help/articles/dictate-to-add-tasks-with-ramble-P1Raq7vVF) ·
[Ramble launch (TechCrunch)](https://techcrunch.com/2026/01/21/todoists-app-now-lets-you-add-tasks-to-your-to-do-list-by-speaking-to-its-ai/) ·
[Building Ramble (Product Talk)](https://www.producttalk.org/building-todoist-ramble-how-doist-turned-voice-braindumps-into-real-time-task-capture/) ·
[TickTick release notes](https://releasebot.io/updates/ticktick) ·
[Akiflow features](https://akiflow.com/features) ·
[Sunsama AI](https://sunsama.com/features/ai) ·
[Motion auto-scheduling](https://www.usemotion.com/help/time-management/auto-scheduling/concept-auto-scheduling) ·
[Motion reviews (saner.ai)](https://blog.saner.ai/motion-reviews) ·
[Reclaim AI disclosure](https://help.reclaim.ai/en/articles/13178785-reclaim-ai-disclosure) ·
[Reclaim on Google Workspace Marketplace](https://workspace.google.com/u/0/marketplace/app/reclaimai/950518663892).

**Take:** show the result before anything changes (Ramble, against Motion and
Reclaim); several tasks from one utterance (Ramble, TickTick); reasons from
the user's own facts ("overdue 3 days", "deadline Monday"); propose less than
the day holds; bring your own key.

**Deliberately don't:** send audio to a cloud model (Ramble does; audio is
more sensitive than text and ties us to one provider); continuous re-planning;
writing calendar events; a chat thread; a daily ritual prompt.

## 3. What the user does

1. **Turn it on.** Settings → Plugins → install from the directory. A one-time
   notice (§ 6.1), then the API key. The plugin registers a shortcut (the user
   binds the key in the keyboard settings) and a side-panel button.
2. **Ask.** The shortcut opens the side panel with the input focused. Speak
   (system dictation, § 5) or type, then Enter. The panel can stay open next to
   the Planner or Today.
3. **See the result**, as it streams in:
   - **Changes:** grouped _Add_, _Change_, _Delete_, one row each with a
     checkbox and what changes ("Tomorrow → Mon", "+ tag Errands"). Deletes
     are listed last and say "goes to Recently deleted".
   - **Selection:** a titled list ("Focus today, top 10") with a reason per
     row. Each row has done, start tracking and open. These are the user's own
     clicks, through existing API calls, not AI actions.
   - **Day plan:** _Pull in_ and _Move to tomorrow_ groups plus a local summary
     line ("Today: 7 tasks, 4 h 50 min of 5 h 30 min free").
   - **A sentence** when there is nothing to do or the request is unclear ("Two
     tasks match 'report'"), together with a selection to pick from.
4. **Apply** (button or Ctrl+Enter) applies the ticked rows. Esc discards.
5. **Follow up.** A new request sees the selection on screen as "these" ("move
   these to tomorrow", "only the Work ones"). Nothing else carries over.

## 4. Where it lives: core or plugin

|                    | Core feature                                                       | Plugin (**recommended**: first-party, in the plugin directory, not bundled)      |
| ------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| AI decision (open) | Puts an LLM client and API key handling in core; hard to take back | Core stays AI-free; the plugin can be unlisted without a migration               |
| UI                 | Could render inside the Planner and task lists                     | Side panel next to the Planner or Today; not inline                              |
| Settings           | New global config section (persisted model, synced)                | Plugin config and secret storage; nothing in `GlobalConfig`                      |
| API key            | Needs new local-only storage                                       | `setSecret`/`getSecret`: local, never synced or exported                         |
| Network            | New HTTP path in core                                              | `request()` with `"http"` permission and `allowedHosts: ["api.anthropic.com"]`   |
| Shortcut           | Core keyboard config                                               | `registerShortcut` (user-bindable) exists                                        |
| Reading data       | Selectors directly                                                 | `getTasks`, `getAppState`, `getAllProjects`, `getAllTags`, `getDayContext`       |
| Writing            | Existing actions directly                                          | `addTask`, `updateTask`, `deleteTask`, `startTracking`, `selectTask` exist (§ 7) |
| Long-term cost     | Core code and a config slice forever                               | None in core for v1                                                              |

**Recommendation: a first-party plugin, listed in the plugin directory
(`src/assets/community-plugins.json`), not bundled.** Source in
`packages/plugin-dev/ai-command` (name open). One-click install needs a release
zip, its `downloadUrl` and sha256, published like the Ridonculous plugins
(#11367). Why not bundled and off by default: bundled plugins ship in every
install and show in the plugin list; #5952 objects to exactly that.

**Reuse from the prototype** (`packages/plugin-dev/ai-view-builder` on the
generative-views branch): the Anthropic streaming client, per-tool-call
application with an agent loop of at most 4 rounds, the API key in secret
storage, the eval runner. Not reused: persisted views and their spec. A
selection here is the smallest possible generative view: one list, never
saved.

**Challenge to "the proposal appears in the Planner".** A plugin cannot draw
inside the Planner. The panel sits next to it, and the Planner updates on
Apply. A core preview is worth building only when a second source needs it.

## 5. Voice

The Claude Messages API takes text, not audio, so speech becomes text before it
leaves the device.

**v1: system dictation, no host code.** The input box works with the dictation
every platform already has: macOS (press the dictation key or Fn twice),
Windows (Win+H), and the microphone key on Android and iOS keyboards. Most of
these run on the device. The flow is: shortcut, dictation key, speak, Enter.
Linux desktops mostly lack built-in dictation; they type.

**Why not a real push-to-talk microphone in v1:** Electron denies the
microphone for the whole app (`electron/main-window.ts:331`, only
`notifications` is allowed). The generative-views plan found Chromium's cloud
recognizer unavailable in Electron and no working `SpeechRecognition` in the
Android WebView.

**Phase 3, only if v1 shows people speak to it:** a host speech service
(`PluginAPI.listen()`, partial and final transcripts). Its checklist, from the
generative-views plan: an Electron permission handler for audio only; the macOS
audio entitlement and usage string; Snap and Flatpak audio; Android
`RECORD_AUDIO` and iOS usage strings; F-Droid builds without Google services;
and on desktop an on-device model (Whisper class, about 40 MB, opt-in
download), which is a new dependency that needs its own case. That is a large,
cross-platform host change and a permanent plugin API; it should not ride on
this plugin's first release.

## 6. Model layer

### 6.1 What is sent

The one-time notice lists exactly this, with a **Show what would be sent**
button that renders the next request's JSON from the user's own data:

- **Your request** as text (never audio).
- **The day:** date, weekday, free minutes today (§ 6.4).
- **Names** of your projects and tags (so "move to Home" can resolve).
- **Tasks on the radar:** open tasks on Today, overdue, or with a deadline in
  the next 7 days (up to 80), plus the selection on screen, plus up to 30 tasks
  per search the model runs (at most 4 searches per request). For each: title,
  estimate, time spent, whether it is on Today, overdue or later, due date,
  deadline, priority, whether it repeats, whether it has a fixed time or
  reminder, project and tags.
- **Not sent:** task ids (replaced by `t1`, `t2`…), notes, subtasks' contents
  unless found by search, attachments, calendar events, worklogs, audio.

Ids are replaced by aliases and mapped back locally, so the model can only
refer to tasks it was shown. About 60 tokens per task.

### 6.2 Tools

`tool_choice` is `auto` (forced choice returns a 400 on Opus 5.5 and Sonnet
5.5); each tool has `strict: true`. A tool call is applied to the panel when
its block completes, so rows appear as they stream.

| Tool          | Input                                                                     | Effect                                                     |
| ------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `find_tasks`  | `{ text?, project?, tag?, where?, includeDone?, limit ≤ 30 }`             | Runs **locally** over the user's tasks, returns rows       |
| `add_task`    | `{ ref, title, project?, tags?, day?, estimateMin?, parent?, note? }`     | Proposed _Add_ row (`ref` lets a later add be its subtask) |
| `update_task` | `{ id, title?, day?, estimateMin?, done?, project?, tags?, appendNote? }` | Proposed _Change_ row                                      |
| `delete_task` | `{ id }`                                                                  | Proposed _Delete_ row                                      |
| `show_tasks`  | `{ title, items: [{ id, reason }] }`, ≤ 20 items                          | Replaces the on-screen selection                           |
| `say`         | `{ text }`                                                                | One sentence, `aria-live`                                  |

A day plan is `update_task` calls with `day` plus a `say`; the panel recognises
an all-`day` change set and shows the plan summary line.

Agent loop: when a turn ends with tool calls, the plugin answers each (`ok`,
search rows, or the validation error) and continues, at most 4 rounds. No
conversation history is kept between requests.

### 6.3 One validator

Used by the app and the eval alike. A proposed row is dropped, with a note, if:

1. it names an id the model was not shown, or the same task twice;
2. it sets `day` on a task with a fixed time or reminder (§ 7);
3. it names a project or tag that doesn't exist (v1 doesn't create them);
4. `day` is before today;
5. a moved-to-tomorrow task has a deadline today or earlier;
6. a title is empty or over 500 characters, or a reason is over 100
   characters (all text rendered with `textContent`);
7. the request proposes more than 50 changes. Then nothing is shown except
   "That would change 50+ tasks; narrow it down."

### 6.4 Planning the day

From rev. 2, unchanged in substance:

- **Free minutes:** with work hours set, from now (or work start) to work end,
  minus lunch still ahead; without, 8 h (the Planner's `DEFAULT_WORK_HOURS`)
  minus time tracked today. Minus the estimates of timed tasks still ahead.
- **Known gap:** plugins can't read calendar events, so a day of meetings looks
  free. Measured in the eval; the fix, if needed, is one read-only number from
  the planning-facts work.
- **Pull in** = not on Today and overdue or deadline within 7 days. **Move to
  tomorrow** = on Today or overdue. Fit to the day is shown ("over by 40 min"),
  not enforced. About 15% slack.
- **Baseline:** a rule-based draft (keep fixed and deadline-today tasks, pull
  in overdue, add by priority and age until full, move the rest), from planning
  facts if they produce one, otherwise written inside the eval harness.

### 6.5 Prompt and untrusted text

A fixed, cached system prompt plus tool definitions; the day, names, radar and
request after the cache breakpoint. It says: do only what was asked; never
guess between several matching tasks, show them instead; reasons use only the
given facts. Task titles can come from GitHub or Jira issues and are data, not
instructions. A hostile title can at worst steer proposals among the user's
own tasks, which the user sees before Apply; it cannot reach the network or
other tools.

### 6.6 Latency, failures, cost

- **Latency target:** first row or sentence within 3 s for a simple add,
  complete within 10 s typical, 20 s worst. Measured in the eval.
- **Timeout** 30 s; **offline, no key, 401, 429, refusal:** a plain message,
  nothing changed. Invalid tool input is returned to the model as an error;
  after 4 rounds, what is valid is shown.
- **Stale rows:** on Apply the plugin re-reads each target task and drops rows
  whose task changed since the proposal (`dueDay`, `dueWithTime`, `remindAt`,
  `isDone`, title, estimate, project, tags). A `dayChange` discards day plans.

Cost per request (estimate; ~2 rounds × ~8k input with the prefix cached, ~1k
output plus thinking at `low` effort, prices from the Claude API reference
cached 2026-10-06):

| Model      | $/MTok in / out | Per request | 10 requests a day, a month |
| ---------- | --------------- | ----------- | -------------------------- |
| Haiku 5.5  | 0.10 / 0.50     | ~$0.003     | ~$1                        |
| Sonnet 5.5 | 2 / 10          | ~$0.06      | ~$18                       |
| Opus 5.5   | 4 / 20          | ~$0.12      | ~$36                       |

Heavy use on the larger models adds up, and voice wants speed. **Default:** the
cheapest model that meets the eval bar; Opus 5.5 at `low` is the quality
reference. The only setting is a model picker.

**Provider:** Anthropic only in v1. A local model would fit "privacy first"
best, but `request()` blocks private networks for plugins other than bundled
issue providers (`plugin-bridge.service.ts:499`); opening that is a security
decision (§ 12).

## 7. What v1 can and cannot change

Everything goes through existing plugin API calls; the plugin adds no new
write path.

| Request                                   | v1  | How / why not                                                                                                                                                                                                                  |
| ----------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Add tasks, several at once, with subtasks | Yes | `addTask` (project, tags, estimate, `dueDay`, `parentId`)                                                                                                                                                                      |
| Rename, estimate, add a note              | Yes | `updateTask`; notes are appended, never read                                                                                                                                                                                   |
| Plan for a day, move to tomorrow, unplan  | Yes | `updateTask({ dueDay })`, which already keeps planner days and Today in step (`task-shared-crud.reducer.ts:966-1020`)                                                                                                          |
| Mark done / undone                        | Yes | `updateTask({ isDone })`; Phase 1 checks it matches the UI's done path                                                                                                                                                         |
| Move to a project, change tags            | Yes | `updateTask`: project moves go through the UI's move service; tags are validated                                                                                                                                               |
| Delete                                    | Yes | `deleteTask`; recoverable from Recently deleted (#10912)                                                                                                                                                                       |
| Start tracking, open a task               | Yes | `startTracking`, `selectTask`, only from the user's click on a selection row                                                                                                                                                   |
| Set a time or reminder; deadlines         | No  | `updateTask` would bypass the scheduling reducer's time/day exclusivity; needs a `scheduleTask`-style API wrapping the existing action. Tasks that already have a time or reminder are not moved (their reminders stay intact) |
| Repeat rules, time entries                | No  | No plugin write API; low value by voice                                                                                                                                                                                        |
| Create projects or tags                   | No  | `addProject`/`addTag` exist, but a typo would create clutter; v1 asks the user to pick an existing one                                                                                                                         |
| Reorder Today                             | No  | Pairwise moves on the shared Today order are the most conflict-prone write, for little gain                                                                                                                                    |

## 8. Applying changes and sync

Apply runs the ticked rows in order: adds (parents before subtasks), changes,
deletes. Each row is one existing plugin call, so one existing action:
`addTask` and `updateTask` dispatch the same actions as the UI, `deleteTask`
the same delete (to Recently deleted).

- **Ops.** One op per changed task (a project move may touch its subtasks, as
  in the UI). "Move these 8 to tomorrow" is 8 independent `updateTask` ops: the
  atomicity rule asks for one op per replay-atomic transition, not per UI
  workflow; a crash midway leaves a valid state; each keeps its own per-task
  conflict boundary. Rule 6 allows the loop without yields. The 50-change cap
  bounds it.
- **No new sync surface.** No new action, op code, entity, persisted field,
  plugin API or schema bump.
- **Selections are not data.** They live in the panel's memory, are never
  persisted or synced, and vanish on close.
- **No effects on replay.** The plugin acts only on the user's Apply or click.
  Its `dayChange` handler only discards a day plan. Two devices with the
  plugin never act on each other's changes.
- **Logical day.** "Today" and "tomorrow" come from `getDayContext()`
  (rule 4), never `new Date()`.
- **Conflicts.** A concurrent edit to the same task elsewhere resolves like any
  manual edit. Phase 2 adds one E2E: apply on A while B edits one of the
  tasks; both converge.
- **No undo in v1.** Restoring "the previous state" would overwrite edits other
  devices made after Apply. The preview is the safeguard; deletes are
  recoverable from Recently deleted.

## 9. Built-in vs external assistants

The agent endpoint plan lets assistants read the day and plan; the desktop MCP
endpoint on master has read and create tools (`electron/mcp/mcp-tools.ts`).
Claude, ChatGPT and Gemini apps already have voice, so a user with one of them
can speak to SP that way today, for capture.

- **External:** people who plan in conversation with their own assistant and
  subscription. Most AI demand points here (§ 1).
- **Built-in:** one shortcut inside SP, no chat, results previewed in place.

They share nothing in v1 and neither blocks the other. If both grow, they
should share the tool definitions (`find_tasks`, `add_task`, `update_task`…)
and the validator, so the two paths can't drift in what they allow.

## 10. Evaluating quality without telemetry

No analytics. An offline eval, plus what users choose to share.

**Offline eval** (`packages/plugin-dev/ai-command/eval/`, the prototype's
`scripts/eval.js` pattern). Each fixture is a task state, a request and the
expected result:

- **Capture:** one task; a braindump of five with dates, estimates and
  projects; a subtask list; non-English; dictation errors ("by milk").
- **Edits:** by title, by "these", by filter ("all Work tasks on Today");
  done; delete; a project that doesn't exist; a time ("at 3 pm"), which must
  be declined with a sentence.
- **Ambiguity:** two tasks match: must show both, not guess.
- **Selections:** "top 10 for today" with must-include and must-not-include
  sets; "what's overdue in Work".
- **Day plans:** overfull day, empty day, after a holiday, weekend, meeting day
  (the calendar gap), no estimates, 80 tasks.
- **Hostile:** a title that tries prompt injection; a request to change 200
  tasks.

**Hard:** the § 6.3 validator passes on every fixture, for every model offered.
**Soft:** match with the expected changes or selection; for day plans, compared
with the rule-based draft. **Ship bar:** hard 100%; soft high enough to trust
(set after the first run); day plans clearly above the draft; latency targets
met. Run by hand (about 60 fixtures × $0.12 on Opus), not in CI; CI runs the
validator and alias map on recorded responses.

**Opt-in feedback:** a GitHub discussion after release. Users can paste the
"Show what would be sent" JSON, with titles edited, into an issue; good cases
become fixtures. Nothing is counted on the device or sent anywhere.

## 11. Phases

| Phase                             | Scope                                                                                                   | Exit                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **0. Eval first** (no app change) | Fixtures, prompt, tools, validator, rule-based draft; Haiku, Sonnet and Opus 5.5                        | Bar met → Phase 1. Not met → record why, stop                                 |
| **1. Plugin, desktop + web**      | Shortcut, panel, typed and dictated requests, changes + Apply, selections, day plans; directory listing | Works end to end; unit tests for validator, alias map, free time, stale check |
| **2. Mobile + E2E**               | Android and iOS (`request()` vs the prototype's `CapacitorWebFetch` client); concurrent-edit E2E        | E2E green on SuperSync                                                        |
| **3. Push-to-talk** (on evidence) | Host speech service and its plugin API (§ 5)                                                            | Separate plan                                                                 |
| **Later, on evidence**            | Times and reminders via a `scheduleTask`-style API; calendar busy minutes; local model                  | A user request                                                                |

**Smallest useful version:** Phase 0 + 1, with system dictation as the voice.

**Not planned:** chat history, automatic or scheduled runs, time-blocking,
reordering Today, saved views, undo.

## 12. Risks and open questions

**Risks**

- **Wrong change applied.** Preview of every change, ticked rows only,
  ambiguity shown instead of guessed, deletes recoverable, a 50-change cap.
- **More data leaves the device** than in rev. 2: project and tag names and
  searched titles. The notice lists every field and shows a real example; the
  plugin is never installed by default; the key is per device.
- **Cost surprise** on Sonnet or Opus with heavy use. The panel shows the
  model; the default is the cheapest model that passes.
- **"Voice" feels half-done** without push-to-talk. Accepted for v1: two keys
  instead of one, no host change. Phase 3 only if used.
- **Prompt injection via issue titles.** Bounded to proposals over the user's
  own tasks, previewed.
- **Scope creep into a chat app.** Guarded by design: no history, no persona,
  no proactive messages; one request, one result.

**Open questions for the maintainer**

1. Name and entry point: one shortcut for both speaking and typing, plus a
   side-panel button? Any preferred default key?
2. Is "two keys" (shortcut, then system dictation) good enough for v1, or is
   push-to-talk the point of the feature? If the latter, Phase 3 becomes the
   first step and needs its own plan.
3. Should deletes be ticked by default in the preview (recoverable) or
   unticked?
4. Local models: open the private-network guard for this plugin, or leave
   local models to the external-assistant path?

## Review

### Rev. 2 (fresh-context review of rev. 1)

A fresh-context subagent reviewed rev. 1 against `docs/feature-review-guide.md`,
the product principles and the sync rules, checking claims against the code.

| #   | Finding                                                                                                                                                                      | Severity | Outcome                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------- |
| 1   | The reason for a new `planTasksForDay` API was false: `updateTask({ dueDay })` already updates planner days and `TODAY_TAG.taskIds` (`task-shared-crud.reducer.ts:966-1020`) | High     | **Fixed.** No new API; `updateTask` applies plans        |
| 2   | One `planTasksForToday` for "keep + pull in" would clear reminders on timed tasks on Today (setting a time clears `dueDay`)                                                  | High     | **Fixed.** Tasks with a time or reminder are never moved |
| 3   | Undo was lossy and could overwrite later edits from other devices                                                                                                            | High     | **Fixed** by cutting undo from v1                        |
| 4   | The privacy notice didn't match the fields sent                                                                                                                              | High     | **Fixed.** The notice lists every field (§ 6.1)          |
| 5   | "Pull in" defined three ways                                                                                                                                                 | Medium   | **Fixed.** One definition (§ 6.4)                        |
| 6   | Capacity wrong: `availableHours` undefined without work hours; committed time subtracted twice                                                                               | Medium   | **Fixed.** Free minutes defined once (§ 6.4)             |
| 7   | `dataChanged` has no payload and fires on tracking ticks                                                                                                                     | Medium   | **Fixed.** Stale check compares named fields on Apply    |
| 8   | App validator and eval hard checks differed                                                                                                                                  | Medium   | **Fixed.** One validator (§ 6.3)                         |
| 9   | Manifest needs `http` and `allowedHosts`; one-click install needs zip, `downloadUrl`, sha256                                                                                 | Low      | **Fixed** (§ 4)                                          |
| 10  | Token and cost numbers low; a slack setting contradicted "no other knobs"                                                                                                    | Low      | **Fixed**                                                |
| 11  | The gate committed another plan's deliverable                                                                                                                                | Low      | **Fixed**                                                |
| 12  | Over-scoped: offline fallback, anonymized-example UI, long assistant section, duplicate question                                                                             | Low      | **Fixed**                                                |

### Rev. 3

REVIEW3_PLACEHOLDER
