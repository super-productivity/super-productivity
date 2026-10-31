# Speak to plan: an optional AI command plugin

Oct 31, 2026 · rev. 5 · status: **proposal**, nothing implemented · branch
`claude/ai-plan-today`

**Related:** generative views, parked (`docs/plans/2026-10-30-generative-views.md`
on `claude/generative-ui-todo-app-h4o6e8`) · agent endpoint / MCP plan
(`docs/plans/2026-09-16-work-api-mcp-and-headless-device.md` on
`claude/sp-executable-data-model-gewi7j`) · [market target](../market/README.md)
(daily planning is _must be best_, AI is an _open decision_) ·
[contributor sync model](../sync-and-op-log/contributor-sync-model.md).

**Revisions:** rev. 1 was a one-shot "Help me plan today" button. Rev. 2 and
rev. 4 fixed review findings. Rev. 5 adds extensive prior art, the maintainer's decisions on voice and
local models, and one model call per request instead of an agent loop. Rev. 3
followed the maintainer's direction (2026-10-31): many
users don't want AI, so it stays an optional plugin; and instead of one
button, a shortcut opens a box you speak or type into, to add or change tasks
or to see a temporary selection ("top 10 for today"). Planning the day is one
of those commands.

## Summary

- **What:** press a shortcut (or a button), speak or type one request, see the
  result, press **Apply**. Three kinds of result, plus a one-line answer when
  there is nothing to do:
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
  install, not bundled), with the user's own Anthropic API key. No core or sync
  change; **two small, optional plugin API additions** (§ 4.1): open the
  plugin's panel from its shortcut, and add tasks without parsing `#tag` and
  `@date` out of titles.
- **Voice in v1:** the system's own dictation into the box (macOS, Windows,
  phone keyboards): two keys, no microphone code. Push-to-talk needs a host
  speech service and comes later, on evidence (§ 5).
- **One model call per request:** the plugin searches tasks on the device
  first, so small local models can do it too. Local models (Ollama, LM Studio)
  come after the first release through a scoped local-network permission.
- **Gate:** an offline eval of realistic requests runs first (no app code).
  Capture and changes ship first; selections and day plans follow when their
  part of the eval passes (§ 11).
- **Cost to the user:** about US$0.002–0.08 per request depending on model
  (estimate, § 6.6); free with a local model.

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

Checked 2026-10-31 by a research subagent from vendor docs, changelogs and
review sites; no hands-on use. **(2nd)** = secondhand or aggregator only. The
Ollama endpoint and SP issue numbers were re-checked directly.

### 2.1 Voice and natural-language task apps

| App                          | Capture · edit · bulk                                                     | How changes are confirmed                                                                              | Speech                                                           |
| ---------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| **Todoist Ramble** (2026-01) | Capture; edits only the cards of the current session                      | Live preview cards, corrected by voice ("remove that"), then Done                                      | Raw audio to Gemini 2.5 Flash Live; online only                  |
| **TickTick AI**              | Capture splits items; assistant plans, reorganises, deletes; official MCP | Help center tells users to _ask_ for confirmation in the prompt; "deleted content cannot be recovered" | Cloud                                                            |
| **Sunsama Sunny**            | Create, edit, move, delete, complete, batch                               | On by default (verified); one-click undo "receipts" per its changelog (2nd, not confirmed)             | Voice experimental (2nd)                                         |
| **Akiflow Aki**              | Create, edit, reschedule, complete; "Plan" pulls in overdue (2nd)         | Preview before saving; vendor admits replies are slow                                                  | Cloud transcription                                              |
| **Morgen AI Planner**        | Day plan from tasks and calendar                                          | Pulsing preview blocks: accept, edit or regenerate; "never… without your approval"                     | —                                                                |
| **Google Tasks + Gemini**    | Add, edit, show; no bulk (2nd)                                            | Applied directly, undo in the notification; reports of false "created" confirmations (2nd)             | Cloud                                                            |
| **Notion Agent**             | Pages and databases, bulk                                                 | Undo any change; plan-then-confirm for bulk (2nd)                                                      | Cloud                                                            |
| **Apple Reminders** (iOS 26) | Capture suggestions from the share sheet                                  | Per-item "Add" or "Include All"                                                                        | Apple Intelligence                                               |
| **MS Planner agent**         | Create, update, draft several tasks                                       | Drafts                                                                                                 | Cloud                                                            |
| **Tiimo**, **Superlist**     | Brain dump to day plan (Tiimo); record-to-tasks (Superlist)               | Editable proposal (Tiimo); created on tick (Superlist)                                                 | Cloud                                                            |
| **Motion**                   | AI chat creates and updates; continuous auto-scheduling                   | Applied directly, reshuffles                                                                           | Cloud                                                            |
| **Raycast AI**               | Acts through extensions (e.g. Todoist)                                    | Preview of what will be performed                                                                      | BYO key and Ollama; calls Ollama tool calling "a bit unreliable" |
| **Things 3**                 | No in-app AI; iOS 27 Siri can create and amend one to-do                  | —                                                                                                      | Siri                                                             |

In this repo: the bundled **Brain Dump** plugin turns each pasted line into a
task, without AI, and **AI Productivity Prompts** copies prompts to any
chatbot. #4856 asks for an Android widget for voice task creation (open, 4
reactions).

**"What to focus on"** is rare: Morgen, Akiflow and Tiimo produce plans, a
Vikunja MCP has a "daily focus" tool. None found shows a reason per item.
Todoist dropped its 2016 Smart Schedule; Motion is criticised for moving
everything; Akiflow users ask for _lighter_ auto-scheduling.

### 2.2 Open source and local models

- **Obsidian:** an "AI Providers" plugin shares keys and endpoints across
  plugins (Anthropic, Ollama, LM Studio, OpenAI-compatible). Obsidian 1.11's
  SecretStorage moved keys out of plugin data. Smart Connections states plainly
  that switching to a cloud model sends note text.
- **Logseq, Joplin:** Ollama plugins exist; Joplin's Jarvis once broke custom
  endpoints in a release, so local endpoints need a test.
- **Endpoints:** Ollama (`/v1/messages`) and LM Studio (0.4.1+) both speak the
  Anthropic Messages format, with tools, but no `tool_choice` and no prompt
  caching. So one client covers Anthropic, Ollama and LM Studio.
- **Small models:** Qwen3/3.5 8–9B and Gemma 4 E4B are the most cited for
  tool calling; evidence is mostly self-reported. Multi-turn tool accuracy
  drops sharply on small models (BFCL).
- **Speed:** on llama.cpp an 8k-token prompt took about 16 s on an M3 Max and
  27 s on an M1 Max before generating (2024 benchmark), and ran out of memory on
  a base 8 GB M1. Expect 25–45 s per request on good laptops.

### 2.3 Failure modes users report

- Over-interpreting: Ramble _executed_ instead of capturing, mixed up dates and
  project names. Doist's fix: keep it simple and constrained; easy correction
  beats first-try accuracy (task creation success rose from about 40% to 62%).
- False success (Gemini says created, nothing saved), hallucinated summaries
  (Apple paused news summaries, 2025-01), prompt injection that leaked data
  (Notion agent, 2025-09).
- AI fatigue: Figma users ask for one switch to turn all AI off; a survey says
  64% would not use or would disable AI assistants (2nd).
- Cost and quotas (TickTick, Todoist free tier, Motion and Notion credits);
  slowness (Aki).

### 2.4 Take and deliberately don't

**Take:**

1. Every edit and delete is previewed and applied only on Apply (Morgen,
   Raycast, Aki; against TickTick, Gemini, Motion).
2. Per-row opt-out (Apple's "Add" / "Include All").
3. Project and tag names and today's date in the prompt; no retrieval service.
4. Capture literally; to correct, edit the request and run it again (Ramble).
5. A reason per "focus" item, and the list is temporary. Nobody else shows
   reasons.
6. One validated proposal per request; no reliance on `tool_choice`; unknown
   ids rejected (works with Ollama too).
7. One client for Anthropic, Ollama and LM Studio; local models labelled
   slower, context trimmed to what's needed.
8. The key in secret storage, never in synced data; the notice lists exactly
   what is sent and says the user's provider terms apply.
9. OS dictation in v1; a speech model only later.
10. Keyboard-operable panel, visible labels matching accessible names (WCAG
    2.5.3), no hold-to-talk requirement.
11. An eval set of real typed and dictated requests.

**Deliberately don't:** send audio to a cloud model (Ramble); apply directly
or reshuffle continuously (Motion, Gemini); keep chat history (Ramble: "quick
capture, not conversation"); give the model any outbound channel such as URLs
or web tools (Notion's leak needed one); turn it on by default (Sunny).

**Sources:** [Ramble help](https://www.todoist.com/help/articles/use-ramble-to-add-tasks-by-voice-P1Raq7vVF) ·
[Ramble launch](https://techcrunch.com/2026/01/21/todoists-app-now-lets-you-add-tasks-to-your-to-do-list-by-speaking-to-its-ai/) ·
[Building Ramble](https://www.producttalk.org/building-todoist-ramble-how-doist-turned-voice-braindumps-into-real-time-task-capture/) ·
[TickTick AI](https://help.ticktick.com/articles/7444685542580551680) ·
[Sunny](https://help.sunsama.com/docs/usage-guides/sunny/) ·
[Sunsama changelog](https://roadmap.sunsama.com/changelog) ·
[Aki](https://product.akiflow.com/help/articles/9441910-meet-aki) ·
[Morgen AI Planner](https://www.morgen.so/guides/plan-your-day-using-the-ai-planner) ·
[Morgen FAQ](https://www.morgen.so/faq) ·
[Gemini + Tasks](https://support.google.com/gemini/answer/15230285) ·
[Notion Agent](https://www.notion.com/help/notion-agent) ·
[Apple Reminders](https://support.apple.com/124025) ·
[Planner agent](https://techcommunity.microsoft.com/t5/planner-blog/planner-agent-in-microsoft-365-copilot-is-now-generally/ba-p/4527629) ·
[Tiimo](https://www.tiimoapp.com/resource-hub/ai-planner) ·
[Superlist Talk](https://help.superlist.com/en/articles/224824-create-tasks-and-notes-with-your-voice-talk) ·
[Raycast AI extensions](https://manual.raycast.com/v1/ai-extensions) ·
[Raycast 1.100](https://www.raycast.com/changelog/1-100-0) ·
[Things 3.24](https://macrumors.com/2026/09/14/things-3-updated-for-ios-27) ·
[Obsidian AI Providers](https://community.obsidian.md/plugins/ai-providers) ·
[Obsidian SecretStorage](https://docs.obsidian.md/plugins/guides/secret-storage) ·
[Ollama Anthropic compatibility](https://docs.ollama.com/api/anthropic-compatibility) ·
[LM Studio Anthropic compatibility](https://lmstudio.ai/docs/developer/anthropic-compat) ·
[llama.cpp benchmarks](https://github.com/XiongjieDai/GPU-Benchmarks-on-LLM-Inference) ·
[Notion lethal trifecta](https://simonwillison.net/2025/Sep/19/notion-lethal-trifecta) ·
[Apple pauses summaries](https://www.siliconrepublic.com/business/apple-halt-ai-notification-summaries-backlash-features) ·
[Figma "human mode"](https://forum.figma.com/suggest-a-feature-11/human-mode-single-toggle-to-turn-off-all-ai-features-permanently-per-user-47577) ·
[Todoist Smart Schedule 2016](https://macrumors.com/2016/11/16/todoist-smart-schedule) ·
[WCAG 2.5.3](https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html).
Motion, Reclaim and earlier complaints: rev. 2 sources
([Motion](https://www.usemotion.com/help/time-management/auto-scheduling/concept-auto-scheduling),
[Motion reviews](https://blog.saner.ai/motion-reviews)).

## 3. What the user does

1. **Turn it on.** Settings → Plugins → install from the directory. A one-time
   notice (§ 6.1), then the API key. The plugin registers a shortcut (the user
   binds the key in the keyboard settings) and a side-panel button. The
   shortcut opening the panel needs § 4.1.
2. **Ask.** The shortcut opens the side panel with the input focused. Speak
   (system dictation, § 5) or type, then Enter. The panel can stay open next to
   the Planner or Today.
3. **See the result** (a spinner with Cancel until it arrives):
   - **Changes:** grouped _Add_, _Change_, _Delete_, one row each with a
     checkbox and what changes ("Tomorrow → Mon", "+ tag Errands"). Deletes
     are listed last, **unticked by default**, and say "kept in Recently
     deleted on this device for 30 days" (that store is local, never synced).
   - **Selection:** a titled list ("Focus today, top 10") with a reason per
     row. Each row has done, start tracking and open. These are the user's own
     clicks, through existing API calls, not AI actions.
   - **Day plan:** _Pull in_ and _Move to tomorrow_ groups plus a local summary
     line ("Today: 7 tasks, 4 h 50 min of 5 h 30 min free").
   - **A sentence** when there is nothing to do or the request is unclear ("Two
     tasks match 'report'"), together with a selection to pick from.
4. **Apply** (button or Ctrl+Enter) applies the ticked rows. Esc discards.
5. **Follow up.** A new request sees the ids of the selection on screen as
   "these" ("move these to tomorrow"). No earlier request, answer or sentence
   is sent: no conversation history, by design.

## 4. Where it lives: core or plugin

|                    | Core feature                                                       | Plugin (**recommended**: first-party, in the plugin directory, not bundled)                                  |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| AI decision (open) | Puts an LLM client and API key handling in core; hard to take back | Core stays AI-free; the plugin can be unlisted without a migration                                           |
| UI                 | Could render inside the Planner and task lists                     | Side panel next to the Planner or Today; not inline                                                          |
| Settings           | New global config section (persisted model, synced)                | Plugin config and secret storage; nothing in `GlobalConfig`                                                  |
| API key            | Needs new local-only storage                                       | `setSecret`/`getSecret`: local, never synced or exported                                                     |
| Network            | New HTTP path in core                                              | `request()` with `"http"` permission and `allowedHosts: ["api.anthropic.com"]`; whole response, no streaming |
| Shortcut           | Core keyboard config                                               | `registerShortcut` (user-bindable) exists; opening the panel from it does not (§ 4.1)                        |
| Reading data       | Selectors directly                                                 | `getTasks`, `getAppState`, `getAllProjects`, `getAllTags`, `getDayContext`                                   |
| Writing            | Existing actions directly                                          | `addTask`, `updateTask`, `deleteTask`, `startTracking`, `selectTask` exist (§ 7)                             |
| Long-term cost     | Core code and a config slice forever                               | Two optional plugin API additions (§ 4.1)                                                                    |

**Recommendation: a first-party plugin, listed in the plugin directory
(`src/assets/community-plugins.json`), not bundled.** Source in
`packages/plugin-dev/ai-command` (name open). One-click install needs a release
zip, its `downloadUrl` and sha256, published like the Ridonculous plugins
(#11367). Why not bundled and off by default: bundled plugins ship in every
install and show in the plugin list; #5952 objects to exactly that.

**Reuse from the prototype** (`packages/plugin-dev/ai-view-builder` on the
generative-views branch): the Anthropic client, tool schemas and validation
pattern, the API key in secret storage, the eval runner. Not its agent loop
(§ 6.2). Not its transport: it streams with direct
`fetch` and `CapacitorWebFetch`, which bypasses the plugin's `allowedHosts`
and `http` permission. v1 uses `request()` and shows the result whole. Not reused: persisted views and their spec. A
selection here is the smallest possible generative view: one list, never
saved.

### 4.1 Plugin API additions

Both optional, both small, both useful to other plugins (a third, the scoped
`localNetwork` permission, comes with local models, § 6.6):

| Addition                                                                  | Why                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `showPluginPanel` in `ALLOWED_PLUGIN_ACTIONS` (or a `showPanel()` method) | Only the host's side-panel button opens a plugin panel (`plugin-side-panel-btns.component.ts:129`); plugins may only hide it. A shortcut that opens the box is the core of the feature                                                                                                                                                                                                                                       |
| `isIgnoreShortSyntax?: boolean` on `addTask` data and `updateTask`        | Plugin `addTask` parses short syntax (`plugin-bridge.service.ts:991-996`; `short-syntax.effects.ts:60-75`), so "Call mom #errands 15m @3pm" would set tags, an estimate and a time, and may open the "create tags?" dialog. A title-only `updateTask` is parsed too. `TaskService.add` already has the flag for untrusted titles; the bridge only needs to pass it. Default unchanged, so Brain Dump and others keep parsing |

**Challenge to "the proposal appears in the Planner".** A plugin cannot draw
inside the Planner. The panel sits next to it, and the Planner updates on
Apply. A core preview is worth building only when a second source needs it.

## 5. Voice

**Decision (2026-10-31): two keys in v1.** The shortcut opens the box; the
system's own dictation fills it: macOS (dictation key or Fn twice), Windows
(Win+H), the microphone key on Android and iOS keyboards (one tap there). The
empty box shows the platform's dictation key as a hint. Most of these run on
the device. No microphone permission, no speech model, no plugin API. Most
Linux desktops have no built-in dictation; Linux users type for now.

The Claude Messages API takes text, not audio, so speech becomes text before
it leaves the device. We don't follow Ramble in sending raw audio to a cloud
model: audio is more sensitive and ties the feature to one provider.

**Why not push-to-talk in v1:**

- Electron denies the microphone for the whole app
  (`electron/main-window.ts:332`, only `notifications` is allowed).
- Chromium's Web Speech API throws a network error in Electron; its on-device
  mode (`processLocally`) depends on a Chrome-only component with no evidence
  it works in Electron. Android's "on-device" recognizer may still stream to a
  server, per its docs.

**Later, on evidence that people speak to it:** a host speech service
(`PluginAPI.listen()`, partial and final transcripts), with its own plan.
Checklist: an Electron permission handler for audio only; the macOS audio
entitlement and usage string; Snap and Flatpak audio; Android `RECORD_AUDIO`
and iOS usage strings; F-Droid builds without Google services. On-device
options: whisper.cpp (base 142 MiB, small 466 MiB; desktop, iOS, Android),
Moonshine (27–61M parameters, English, streaming), Vosk (40 MB small model),
iOS 26 SpeechAnalyzer. A bundled model is a new dependency and needs its own
case.

## 6. Model layer

### 6.1 What is sent

The one-time notice lists exactly this, with a **Show what would be sent**
button that renders the next request's JSON from the user's own data:

- **Your request** as text (never audio).
- **The day:** date, weekday, free minutes today (§ 6.4).
- **Names** of your projects and tags (so "move to Home" can resolve).
- **Tasks on the radar:** open tasks on Today, overdue, or with a deadline in
  the next 7 days (up to 80), plus the selection on screen, plus up to 30 tasks
  whose title, project or tag matches words in your request (searched on the
  device before the call, § 6.2). For each: title,
  done or not, estimate, time spent, whether it is on Today, overdue or later,
  due date, deadline, priority, whether it repeats, whether it has a fixed
  time or reminder, its parent (if it is a subtask), project and tags.
- **Not sent:** task ids (replaced by `t1`, `t2`…), notes, attachments,
  calendar events, worklogs, audio. Subtasks are sent only like any other task:
  when on the radar, selected or matched.

Names exclude the virtual Today and in-progress tags: setting them as tags
would put `TODAY` into `task.tagIds` (sync rule 5), and `getAllTags()` returns
them. Deadline and priority are read from fields the app passes at runtime but
the plugin `Task` type doesn't declare (`types.ts:352-385`).

Ids are replaced by aliases and mapped back locally, so the model can only
refer to tasks it was shown. About 60 tokens per task.

### 6.2 One call, output tools only

**Search happens on the device, before the call.** The plugin matches the
request's words against task titles, project names and tag names (plain text
match, no AI) and adds up to 30 matching open tasks to the context, next to
the radar and the on-screen selection. Then **one** model call returns the
whole proposal. No agent loop: half the requests, faster, and it works with
small local models, whose multi-turn tool use is weak (§ 2.2). If the task the
user meant wasn't found, the model says so and the user rephrases.

The model answers with these tools. `tool_choice` is `auto` (forced choice is a
400 on Opus 5.5 and Sonnet 5.5, and unsupported by Ollama); each tool has
`strict: true` where the provider supports it, and every input is validated
locally anyway.

| Tool          | Input                                                                     | Effect                                                     |
| ------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `add_task`    | `{ ref, title, project?, tags?, day?, estimateMin?, parent?, note? }`     | Proposed _Add_ row (`ref` lets a later add be its subtask) |
| `update_task` | `{ id, title?, day?, estimateMin?, done?, project?, tags?, appendNote? }` | Proposed _Change_ row                                      |
| `delete_task` | `{ id }`                                                                  | Proposed _Delete_ row                                      |
| `show_tasks`  | `{ title, items: [{ id, reason }] }`, ≤ 20 items                          | Replaces the on-screen selection                           |
| `say`         | `{ text }`                                                                | One sentence, `aria-live`                                  |

A day plan is `update_task` calls with `day` plus a `say`; the panel recognises
an all-`day` change set and shows the plan summary line.

If the proposal fails the schema, one retry with the error. No conversation
history is kept between requests.

### 6.3 One validator

Used by the app and the eval alike. A proposed row is dropped, with a note, if:

1. it names an id the model was not shown, or the same task twice;
2. it sets `day` on a task with a fixed time or reminder (§ 7);
3. it names a project or tag that doesn't exist (v1 doesn't create them), or
   a virtual tag (Today, in progress);
4. `day` is before today;
5. a moved-to-tomorrow task has a deadline today or earlier;
6. a title is empty or over 500 characters, or a reason is over 100
   characters (all text rendered with `textContent`; titles are written with
   short syntax off, § 4.1);
7. it changes the project of a repeating task (that moves the whole series,
   archived instances included, without asking; `task-move-to-project.service.ts:83-116`)
   or of a subtask (the bridge throws);
8. the request proposes more than 50 changes. Then nothing is shown except
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

- **Latency target:** the whole result within 5 s for a simple add, 10 s
  typical, 20 s worst, with a spinner and Cancel. Not streamed (§ 4). Measured
  in the eval.
- **Timeout** 30 s; **offline, no key, 401, 429, refusal:** a plain message,
  nothing changed. If the proposal fails the schema, one retry with the error;
  then what is valid is shown.
- **Stale rows:** on Apply the plugin re-reads each target task and drops rows
  whose task changed or was deleted since the proposal (`dueDay`,
  `dueWithTime`, `remindAt`, deadline, `isDone`, title, estimate, project,
  tags, `parentId`, `repeatCfgId`). A `dayChange` discards day plans.

Cost per request (estimate; one call, ~8k input with the fixed prefix cached,
~1k output plus thinking at `low` effort; prices from the Claude API reference
cached 2026-10-06):

| Model      | $/MTok in / out | Per request | 10 requests a day, a month |
| ---------- | --------------- | ----------- | -------------------------- |
| Haiku 5.5  | 0.10 / 0.50     | ~$0.002     | ~$0.60                     |
| Sonnet 5.5 | 2 / 10          | ~$0.04      | ~$12                       |
| Opus 5.5   | 4 / 20          | ~$0.08      | ~$24                       |
| Local      | —               | free        | free                       |

**Default:** the cheapest cloud model that meets the eval bar; Opus 5.5 at
`low` is the quality reference. The only setting is the model picker.

**Local models (decision 2026-10-31: yes, scoped).** Ollama and LM Studio
accept the Anthropic Messages format, so the same client works; only the base
URL and model name change. What blocks it today: `request()` refuses private
and loopback addresses for every plugin (`plugin-http.service.ts:429`); the
only way past is `allowPrivateNetwork`, honoured just for bundled issue
providers (`plugin-bridge.service.ts:499`). Rather than a special case for this
plugin id, a small general permission:

- the manifest declares `localNetwork`;
- honoured only for bundled plugins and for directory installs whose sha256
  matches the listing (not for uploaded zips);
- off until the user turns it on in the plugin's settings, and then only for
  the one base URL they enter (for example `http://localhost:11434`), not the
  whole local network; cloud metadata addresses stay blocked as today.

That is one more optional plugin API surface (§ 4.1 grows to three), built
after Phase 1a. In practice desktop only: on a phone, `localhost` is the
phone. Local models are labelled "slower" (25–45 s on good laptops, § 2.2)
and must pass the same eval; if none does, the option isn't offered.

## 7. What v1 can and cannot change

Everything goes through existing plugin API calls (titles written with short
syntax off, § 4.1); the plugin adds no new write path.

| Request                                   | v1  | How / why not                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add tasks, several at once, with subtasks | Yes | `addTask` (project, tags, estimate, `dueDay`, `parentId`)                                                                                                                                                                                                                                                                    |
| Rename, estimate, add a note              | Yes | `updateTask`; notes are appended, never read                                                                                                                                                                                                                                                                                 |
| Plan for a day, move to tomorrow, unplan  | Yes | `updateTask({ dueDay })`, which already keeps planner days and Today in step (`task-shared-crud.reducer.ts:966-1020`). Unplan sends `dueDay: null`: `undefined` is ignored by the reducer and dropped on the wire                                                                                                            |
| Mark done / undone                        | Yes | `updateTask({ isDone })`, which is what the UI's `setDone` does (`task.service.ts:1221-1231`)                                                                                                                                                                                                                                |
| Move to a project, change tags            | Yes | Project: the UI's move service, its own call (so a row with a project and other fields is 2 actions); not for repeating tasks or subtasks (§ 6.3). Tags: validated, virtual tags excluded                                                                                                                                    |
| Delete                                    | Yes | `deleteTask`; unticked by default; Recently deleted keeps it on this device for 30 days (#10912)                                                                                                                                                                                                                             |
| Start tracking, open a task               | Yes | `startTracking`, `selectTask`, only from the user's click on a selection row                                                                                                                                                                                                                                                 |
| Set a time or reminder; deadlines         | No  | Times: `updateTask` would bypass the scheduling reducer's time/day exclusivity. Deadlines have their own `setDeadline` action, and the plugin `Task` type has no deadline fields. Both need a small API wrapping the existing action. Tasks that already have a time or reminder are not moved (their reminders stay intact) |
| Repeat rules, time entries                | No  | No plugin write API; low value by voice                                                                                                                                                                                                                                                                                      |
| Create projects or tags                   | No  | `addProject`/`addTag` exist, but a typo would create clutter; v1 asks the user to pick an existing one                                                                                                                                                                                                                       |
| Reorder Today                             | No  | Pairwise moves on the shared Today order are the most conflict-prone write, for little gain                                                                                                                                                                                                                                  |

## 8. Applying changes and sync

Apply runs the ticked rows in order: adds (parents before subtasks), changes,
deletes. Each row is one existing plugin call, so one existing action:
`addTask` and `updateTask` dispatch the same actions as the UI, `deleteTask`
the same delete (to Recently deleted).

- **Ops.** One op per changed field group: a row is one `updateTask`, plus
  one project move when the project changes (it carries the task's subtasks,
  as in the UI). "Move these 8 to tomorrow" is 8 independent `updateTask` ops: the
  atomicity rule asks for one op per replay-atomic transition, not per UI
  workflow; a crash midway leaves a valid state; each keeps its own per-task
  conflict boundary. Rule 6 allows the loop without yields. The 50-change cap
  bounds it.
- **No new sync surface.** No new action, op code, entity, persisted field
  or schema bump. The two plugin API additions (§ 4.1) only open a panel and
  pass an existing flag.
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
- **No undo in v1.** Restoring "the previous state" blindly would overwrite
  edits other devices made after Apply. The preview is the safeguard; deletes
  are unticked by default and kept in Recently deleted on this device. Prior
  art favours a batch undo (Notion; Sunsama reportedly). A safe version only
  reverts a field if the task still holds the value the plugin wrote
  (compare-and-set), and needs a restore call for deleted tasks that the
  plugin API lacks. Candidate for Phase 2 if users ask.

## 9. Built-in vs external assistants

The agent endpoint plan lets assistants read the day and plan; the desktop MCP
endpoint on master has read and create tools (`electron/mcp/mcp-tools.ts`).
Claude, ChatGPT and Gemini apps already have voice, so a user with one of them
can speak to SP that way today, for capture.

- **External:** people who plan in conversation with their own assistant and
  subscription. Most AI demand points here (§ 1).
- **Built-in:** one shortcut inside SP, no chat, results previewed in place.

They share nothing in v1 and neither blocks the other. If both grow, they
should share the tool definitions (`add_task`, `update_task`…)
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
  tasks; spoken text with `#`, `@` or `+` in it; "move this repeating task to
  Work".

**Hard:** the § 6.3 validator passes on every fixture, for every model offered.
**Soft:** match with the expected changes or selection; for day plans, compared
with the rule-based draft. **Ship bar:** hard 100%; soft high enough to trust
(set after the first run); day plans clearly above the draft; latency targets
met. The same fixtures run against each local model offered. Soft scoring can
use an LLM judge against the labels. Run by hand (about 60 fixtures × $0.08
on Opus), not in CI; CI runs the
validator and alias map on recorded responses.

**Opt-in feedback:** a GitHub discussion after release. Users can paste the
"Show what would be sent" JSON, with titles edited, into an issue; good cases
become fixtures. Nothing is counted on the device or sent anywhere.

## 11. Phases

| Phase                                      | Scope                                                                                                                                     | Exit                                                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **0. Eval first** (no app change)          | Fixtures, prompt, tools, validator, rule-based draft; Haiku, Sonnet and Opus 5.5                                                          | Bar met → Phase 1. Not met → record why, stop                                                               |
| **1a. Capture and changes**, desktop + web | Shortcut, panel, typed and dictated requests, change list + Apply; § 4.1; directory listing. Covers the voice-capture gap                 | Eval capture and edit fixtures pass in the shipped plugin; unit tests for validator, alias map, stale check |
| **1b. Selections and day plans**           | `show_tasks`, row actions, day plans with free time; only once their eval fixtures pass                                                   | Selection and day-plan fixtures pass; day plans beat the draft                                              |
| **2. Mobile + E2E**                        | Android and iOS (check `request()` to the Anthropic API on both); concurrent-edit E2E                                                     | E2E green on SuperSync                                                                                      |
| **3. Push-to-talk** (on evidence)          | Host speech service and its plugin API (§ 5)                                                                                              | Separate plan                                                                                               |
| **2b. Local models**, desktop              | `localNetwork` permission (§ 6.6); Ollama or LM Studio through their Anthropic-compatible endpoint; a local model must pass the same eval | A local model passes; labelled "slower" in the picker                                                       |
| **Later, on evidence**                     | Times and reminders via a `scheduleTask`-style API; calendar busy minutes; batch undo                                                     | A user request                                                                                              |

**Smallest useful version:** Phase 0 + 1a, with system dictation as the voice.

**Not planned:** chat history, automatic or scheduled runs, time-blocking,
reordering Today, saved views, sending audio to a model.

## 12. Risks and open questions

**Risks**

- **Wrong change applied.** Preview of every change, ticked rows only,
  ambiguity shown instead of guessed, deletes recoverable, a 50-change cap.
- **Short syntax in titles** would turn spoken words into tags, dates and
  times. Fixed by § 4.1 and covered by eval fixtures.
- **More data leaves the device** than in rev. 2: project and tag names and
  titles that match the request. The notice lists every field and shows a real example; the
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

1. Name and default key for the shortcut.

**Decided (maintainer, 2026-10-31):**

- Two keys in v1 (shortcut, then system dictation); push-to-talk later, on
  evidence (§ 5).
- Local models: yes, through a scoped `localNetwork` permission rather than a
  special case for this plugin id (§ 6.6), after Phase 1a.

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

### Rev. 4 (fresh-context review of rev. 3)

A fresh-context subagent reviewed rev. 3 against the same guides and the code.

| #   | Finding                                                                                                                                                  | Severity | Outcome                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| 1   | A plugin shortcut can't open the plugin's panel; only the host button can (`plugin-side-panel-btns.component.ts:129`). "No plugin API change" was false  | High     | **Fixed.** § 4.1 adds `showPluginPanel` to the allowed actions                          |
| 2   | Plugin `addTask` and title-only `updateTask` parse short syntax: spoken "#errands 15m @3pm" would set tags, estimate and a time, bypassing the validator | High     | **Fixed.** § 4.1 passes `isIgnoreShortSyntax`; eval fixtures added                      |
| 3   | Project moves: a repeating task moves its whole series without asking; subtasks throw; a project change is a separate action                             | High     | **Fixed.** Validator rule 7; § 7 and § 8 corrected                                      |
| 4   | `request()` doesn't stream; the prototype's streaming transport bypasses `allowedHosts`                                                                  | Medium   | **Fixed.** `request()`, no streaming, latency target adjusted                           |
| 5   | `getAllTags()` returns the virtual Today tag; setting it breaks sync rule 5                                                                              | Medium   | **Fixed.** Excluded from names and validator                                            |
| 6   | "Unplan" needs `dueDay: null`; `undefined` is ignored and dropped on the wire                                                                            | Medium   | **Fixed** (§ 7)                                                                         |
| 7   | Recently deleted is device-local, 30 days                                                                                                                | Medium   | **Fixed.** Wording; deletes unticked by default; the open question removed              |
| 8   | Phase 1 too big; Brain Dump not mentioned                                                                                                                | Medium   | **Fixed.** Phase 1a capture and changes, 1b selections and day plans; Brain Dump in § 2 |
| 9   | Stale check missed deletion, parent, repeat, deadline                                                                                                    | Low      | **Fixed**                                                                               |
| 10  | § 6.1 missed done state and parent; subtask wording unclear                                                                                              | Low      | **Fixed**                                                                               |
| 11  | "Phase 1 checks done path" unnecessary: `setDone` is `update({ isDone: true })`                                                                          | Low      | **Fixed**                                                                               |
| 12  | Deadline reason wrong; deadline and priority read from untyped fields                                                                                    | Low      | **Fixed** (§ 6.1, § 7)                                                                  |
| 13  | Wrong line citations                                                                                                                                     | Low      | **Fixed**                                                                               |
| 14  | "Three kinds" vs four; untestable Phase 1 exit; `say` and "these" lean toward chat                                                                       | Low      | **Fixed.** No-history rule stated in § 3                                                |

Checked correct by the review: cost arithmetic and prices, the forced
`tool_choice` 400, `updateTask({ dueDay })` keeping planner days and Today in
step, `registerShortcut`, secrets, the directory listing, the desktop MCP
tools.

### Rev. 5

Prior art from a research subagent (§ 2). Re-checked directly: Ollama's
Anthropic-compatible `/v1/messages` (tools yes, `tool_choice` and caching no),
#4856, and Sunny being on by default. Not confirmed: Sunsama's undo
"receipts" (marked secondhand). Design changes from the research: one model
call with on-device search instead of an agent loop (§ 6.2), local models
through a scoped permission (§ 6.6), batch undo recorded as a later candidate
(§ 8). Rev. 5 was not given a separate fresh-context review.
