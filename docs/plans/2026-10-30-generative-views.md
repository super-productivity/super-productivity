# Generative views: say what you want, watch the view rearrange

Oct 30, 2026 · rev. 2 (after independent review, § Review) · status: Phase 1
implemented on branch `claude/generative-ui-todo-app-h4o6e8`; latency and
step validity not yet measured (needs an API key, §8).

People will increasingly shape their own to-do tools instead of adapting to one.
The goal is that they do it inside Super Productivity (SP): say or type what
they want, and the view changes in front of them, with their real tasks, while
nothing leaves the device except the request itself. This plan picks the
representation, the edit loop, voice input, placement and the plugin API
changes, and says which part ships now.

**Decision.**

1. A view is **data, not code**: a small, versioned _view spec_ (components by
   id, named queries) whose concepts map one-to-one onto SP's native building
   blocks (board panels, task lists, the work-view customizer). The model only
   ever edits the spec; only user gestures change tasks.
2. The **end state is host-native rendering**: SP renders specs with its own
   task rows and board panels, and plugins supply the intelligence. Phase 1
   renders in the plugin as a deliberately small bridge so the loop can be
   proven before the spec becomes a host contract.
3. Edits are **atomic steps by id** (put or remove a component or query), sent
   as tool calls, validated as they arrive and animated one by one (FLIP). The
   view saves once per request; Stop or an error rolls back.
4. **Voice**: in Phase 1, text plus the system's own dictation everywhere, and
   in-app push-to-talk on the web build only. Phase 2 adds a host speech
   service with on-device engines and the platform permissions it needs.
5. **Plugin API**: a sync-aware `dataChanged` hook, `getDayContext()` with a
   `dayChange` hook, typed tracking methods, and the priority and deadline
   fields on `Task`. They fix real gaps for every plugin, not only this one.
6. Stays a **bundled plugin, off by default**.

---

## 1. Demand and fit

- **Demand**: a maintainer bet, not an issue count. The [market
  target](../market/README.md#target) lists AI as an open decision. Generative
  views are a third answer between "built-in assistant" and "external
  assistants only": the user's own model edits _how they see_ their data, never
  the data itself, and the data never leaves the device. Measure demand without
  telemetry: a "Share this request" link that opens a prefilled GitHub
  discussion with the utterance (never the spec or data), plus discussion
  replies.
- **Principles**: off by default; no alerts; push-to-talk only; works offline
  once a view exists; user's own key; prompts and spec only go out.

## 2. What "magical" means, measurably

| Moment                         | Target                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------- |
| Speaking (web build)           | Words appear while speaking; the request sends itself at the end             |
| Request → first visible change | ≤ 2 s at p50 for edits ("group by project", "hide done")                     |
| New view                       | First component ≤ 3 s, complete ≤ 8 s                                        |
| How a change looks             | Items glide to their new place; nothing reloads or flashes                   |
| During edits                   | Scroll position survives; tasks stay clickable                               |
| Undo                           | Instant, local, no model call                                                |
| Changes from elsewhere         | Edits in the Planner, another view or another device show up within a second |

Unmeasured: this session has no API key. §8 ships an eval harness so the first
person with a key can measure time-to-first-step and validity per model and
effort, and pick the defaults from that.

## 3. Where the prototype stands

The prototype has the model write a full HTML document per request and runs it
in a nested opaque-origin sandbox. It is safely isolated but cannot feel
magical: every edit regenerates the whole document (up to 32k output tokens) and
reloads it, saved views carry their own rendering that app changes never reach,
and nested opaque iframes may not paint on Windows (#8467). What carries over:
key handling, the streaming client, synced storage, the E2E harness, the
privacy model. The sandbox returns in Phase 2 as an escape-hatch block.

## 4. Prior art

Checked 2026-10 from vendor docs and search summaries; the in-repo rows from the
code.

| Product                 | Representation                                                              | How AI or edits apply                                      | Notes                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| SP Boards (in repo)     | `BoardCfg`: panels with tag include/exclude, project, done, scheduled, sort | User edits panels; drop adds/removes tags                  | `src/app/features/boards/`; ships Eisenhower and Kanban                                                                         |
| SP work-view customizer | Sort, group, filter by priority, deadline, schedule, tag, project           | User picks options                                         | `src/app/features/task-view-customizer/`                                                                                        |
| Todoist Filter Assist   | Filter query language                                                       | Plain-language request → generated filter, preview, refine | [Todoist help](https://www.todoist.com/help/articles/introduction-to-todoist-assist-KgPP22q5O)                                  |
| Obsidian Bases          | YAML: filters, formulas, several views over the same data                   | User or file edits                                         | [Obsidian help](https://help.obsidian.md/bases/syntax)                                                                          |
| Notion database views   | Fixed layouts over one data model with filter, sort, group                  | "Build with AI" picks a layout                             | [Notion API](https://developers.notion.com/guides/data-apis/working-with-views)                                                 |
| Google A2UI             | JSON components with ids, a client catalog, data bindings                   | Agent sends incremental updates by id                      | [github.com/google/A2UI](https://github.com/google/A2UI); pre-1.0                                                               |
| MCP Apps (SEP-1865)     | HTML resource                                                               | Tools; app re-reads data                                   | [SEP-1865](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp); sandboxed iframe + JSON-RPC |

**Take**

- Views as configuration over one fixed data model (Boards, customizer, Notion,
  Bases): no schema builder; SP's task model is the model.
- A generated query with a preview the user refines (Todoist): the spec is the
  thing the user refines, by voice.
- Components by id with a trusted client catalog and incremental updates
  (A2UI): small, safe, streamable edits with stable identity for animation.
- SP's own board semantics for drops (Boards): add the column's tags, remove its
  excluded tags; no new semantics to learn.
- Sandboxed iframe plus postMessage RPC for code (MCP Apps): the shape of the
  Phase 2 escape hatch.

**Deliberately don't**

- Let the model change tasks. It edits the view; the user changes data.
- Adopt A2UI wholesale: pre-1.0, general-purpose, and its data bindings assume
  the agent supplies data. SP data must never come from the model. Keep an
  export path open instead.
- Custom properties or formulas (Notion, Bases): feature creep against SP's
  task model.
- Always-listening voice.

## 5. Options

| Option                                                         | Edit latency | Look and feel           | Durability                                                    | Cost now |
| -------------------------------------------------------------- | ------------ | ----------------------- | ------------------------------------------------------------- | -------- |
| A. Generated code (prototype)                                  | Slow         | Own, drifts from SP     | Low                                                           | Done     |
| B. Spec, rendered by the plugin                                | Fast         | Close to SP, not native | Spec high, renderer disposable                                | Medium   |
| C. Spec, rendered by the host with native task rows and panels | Fast         | Native                  | High                                                          | High     |
| D. The model writes native `BoardCfg`s                         | Fast         | Native                  | High, but boards only, and every streamed step is a synced op | Low      |

**Path: B now, C next.** B proves the loop (spec shape, step protocol, model
reliability, latency) with no new host contract for the spec. C then reuses the
spec unchanged; `board-panel` (`panelCfg` input) and `task-list` (`tasks` input)
are already input-driven. D is rejected as the main path because live editing
would write a synced op per step, against "one user intent = one op".

## 6. Design

### 6.1 Invariant

**The model edits the view spec, never app data.** Tasks change only through
user gestures in the view (check, drag, start tracking), each one plugin API
call. View undo covers the spec; data writes use the app's own behavior.

### 6.2 View spec v1

```json
{
  "specVersion": 1,
  "title": "Kanban",
  "root": "board",
  "components": {
    "board": {
      "type": "board",
      "query": "open",
      "columns": [
        { "id": "todo", "title": "To do", "notTags": ["Doing"], "isDone": false },
        { "id": "doing", "title": "Doing", "tags": ["Doing"], "isDone": false },
        { "id": "done", "title": "Done", "isDone": true }
      ]
    }
  },
  "queries": {
    "open": { "scope": "@current", "due": "any" }
  }
}
```

- **Components (Phase 1 catalog)**: `stack` and `columns` (layout, optional
  title, `children` ids); `taskList` (query, `fields`, `groupBy`, `limit`,
  `emptyText`); `board` (base query plus columns; a column is a predicate of
  `tags`, `notTags`, `isDone`, the same semantics as a native board panel, and
  `columnsPerRow` for grids such as Eisenhower); `metric` (query plus `count`,
  `timeSpentToday`, `timeSpent`, `estimate` or `remaining`); `text`.
- **Queries**: `scope` (`@current` = the open project or tag, `all`, or a
  project or tag name), `isDone`, `due` (`today`, `tomorrow`, `overdue`,
  `thisWeek`, `none`, `any`), `doneOn` (`today`, `thisWeek`), `tags` with
  `tagsMatch`, `notTags`, `priority`, `hasEstimate`, `parentsOnly` (default
  true), `text`, `includeArchived`, `sort` (`context` = the project's or Today's
  own order, `due`, `deadline`, `priority`, `created`, `title`, `estimate`),
  `sortDir`, `limit`.
- **Dates** resolve against `getDayContext()` (logical day,
  `startOfNextDayDiffMs`, first day of week). "Today" follows ARCHITECTURE
  Decision #2: `dueDay` is today's logical date or `dueWithTime` falls in it.
- **Names**: projects and tags are referenced by name, matched
  case-insensitively on the device. A missing or ambiguous name shows inline in
  the component instead of silently matching nothing. Pinning ids is a known
  gap (renames break a reference visibly) for a later additive field.
- **Forward compatibility**: the validator keeps unknown fields and component
  types; the renderer shows an unknown type as a quiet placeholder. Edits merge
  into components (below), so an older device never strips a newer device's
  fields. A higher `specVersion` opens read-only.
- **Versioning**: additive changes need no bump; a breaking change bumps
  `specVersion` with a pure, fixture-tested migration.

### 6.3 Edit protocol: steps as tool calls

Tools, each one atomic step:

| Tool               | Input               | Semantics                                                                                 |
| ------------------ | ------------------- | ----------------------------------------------------------------------------------------- |
| `put_component`    | `{ id, props }`     | Create (needs `type`) or merge into an existing component; a `null` value removes a field |
| `remove_component` | `{ id }`            | Remove it and its id from every `children` list                                           |
| `put_query`        | `{ id, props }`     | Create or merge                                                                           |
| `remove_query`     | `{ id }`            |                                                                                           |
| `set_view`         | `{ title?, root? }` |                                                                                           |
| `say`              | `{ text }`          | One sentence for the user, announced via `aria-live`                                      |

- Each `tool_use` block is applied when it completes (its `content_block_stop`),
  so every step is complete JSON and becomes one animation. Two-level
  validation: the step's own shape on arrival, the whole spec at the end.
  Children not yet defined render as placeholders. An invalid step is skipped
  and reported back to the model as an error `tool_result`.
- A short agent loop: when the turn ends with `tool_use`, the plugin answers
  every call (`ok` or the validation error) and continues, at most 4 rounds. So
  the model can batch steps in one turn or fix its own mistakes.
- `tool_choice` stays `auto` (forced choice is a 400 on Opus 5.5 and Sonnet
  5.5); a reply with only text is shown as a message.
- Working copy: steps apply to a copy; a clean end saves once (one synced
  write); Stop, an error or a whole-spec validation failure rolls back to the
  saved spec, animated.
- Merge-by-id steps are also why concurrent edits stay simple: the request
  starts from the latest saved spec, and a view is last-writer-wins per key.
- The request carries the system prompt and tool definitions (cached), then the
  current spec, the selected component id (click a component to select it, so
  "make this one a board" works) and the utterance. No task data.

### 6.4 Rendering in Phase 1

- Plain DOM rendering keyed by component id and task id; each step or data
  change re-renders and **FLIP**-animates moved items with the Web Animations
  API (visible items only, one batch per step). View Transitions were checked to
  work in a same-origin srcdoc iframe in Electron 44 (Chrome 152), but one task
  shown in two components would duplicate a transition name and abort, and iOS
  16/17 WebViews lack them; FLIP has neither problem. `prefers-reduced-motion`
  turns animations off.
- Task cards: done checkbox, title (opens the task's detail panel), tracking
  button, optional fields. Board drag and drop with pointer events (works on
  touch), plus Alt+Left/Right on a focused card for keyboard users. A drop is
  one `updateTask` call with the column's tag and done changes.
- Live data: the new `dataChanged` hook, which covers sync and every action;
  `dayChange` re-resolves dates after midnight or the configured start of day.

### 6.5 Voice

- **Phase 1**: the prompt box accepts the system's dictation everywhere (macOS
  Fn Fn, Windows Win+H, mobile keyboards; the box shows the hint). On the web
  build, a push-to-talk mic uses the Web Speech API in the app language; when
  `SpeechRecognition.available({ processLocally: true })` reports on-device
  support it runs on the device, otherwise a one-time notice says the browser
  vendor processes the audio. The request sends itself on the final result.
- **Not in Phase 1, and why**: Electron denies the microphone permission
  (`electron/main-window.ts`) and Chromium's cloud recognizer fails there anyway
  (verified: `available()` reports on-device `unavailable` in Electron 44);
  Android WebView has no working `SpeechRecognition`; iOS needs usage strings.
- **Phase 2, host speech service** (`PluginAPI.listen()`, partial and final
  transcripts as events). Checklist: Electron permission handler for audio only;
  macOS `audio-input` entitlement and `NSMicrophoneUsageDescription`; Snap
  `audio-record` and Flatpak audio; Mac App Store review; an on-device desktop
  model (Moonshine or Whisper, ≈40 MB quantized, opt-in download; a new
  dependency, which needs its own justification); native recognizers on Android
  (`RECORD_AUDIO`) and iOS (usage strings); F-Droid builds without Google
  services.

### 6.6 Model layer

One `runEdit(spec, selection, utterance, signal)` loop over the Anthropic
Messages API, streaming, with the prototype's client (direct streaming fetch,
`CapacitorWebFetch` on mobile, server-side fallbacks). Defaults: Claude Opus 5.5
with effort `low` for edits and `medium` for new views; Sonnet 5.5 and Haiku 5.5
selectable for speed. The defaults are revisited with the eval numbers (§2).
The system prompt and tools sit before the cache breakpoint; the spec and the
utterance after it.

### 6.7 Placement

Views open in the plugin's own page and **inside any project or tag** through a
work-context header button (the doc-mode pattern: `showInWorkContext`). A query
scoped to `@current` then works in every project, so one "my board" view serves
them all.

### 6.8 Plugin API additions (Phase 1)

| Addition                                                                 | Why                                                                                                         |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Hook `dataChanged`                                                       | `anyTaskUpdate` sees only local actions from a short list; views go stale after sync, planning or archiving |
| `getDayContext()` → `{ todayStr, startOfNextDayDiffMs, firstDayOfWeek }` | Correct "today", "overdue", "this week" against the logical day                                             |
| Hook `dayChange`                                                         | Re-resolve dates when the logical day rolls over                                                            |
| `getCurrentTaskId()`, `startTracking(id)`, `stopTracking()`              | Replace dispatching an internal action string; the tracking state on load                                   |
| `Task.priority`, `deadlineDay`, `deadlineWithTime` (types)               | Already passed at runtime, missing from the type                                                            |

All are read-only or wrap an existing user action. They live in a new bridge
service: `plugin-bridge.service.ts` sits 17 lines under its pinned `max-lines`
cap, so moving the work-context methods out with them lowers the cap. Each goes
through `packages/plugin-api` types, the plugin-side `PluginAPI` class, the
iframe allowlist and method map, `docs/plugin-development.md` and the API wiki
note.

### 6.9 Code and build

The plugin moves to TypeScript, bundled with esbuild into `index.html` like
doc-mode, typed against `@super-productivity/plugin-api`. One module defines the
spec types; the validator, tool schemas and prompt catalog derive from it.

### 6.10 Storage and sync

| Key         | Content                          | Bound                                               |
| ----------- | -------------------------------- | --------------------------------------------------- |
| `view:<id>` | spec + title + recent utterances | ≤ 64 KB; typical < 10 KB; one per user-created view |
| `settings`  | model, voice choices             | fixed                                               |

Plugin user data only: no new persisted app model, action or entity and no
sync-wire change. Undo history stays on the device.

### 6.11 Security and privacy

- No generated code runs in Phase 1. The renderer is trusted code using
  `textContent`; actions are a fixed set.
- Sent to Anthropic: system prompt, tools, the current spec, the utterance. Never
  task data, project or tag lists, or notes.
- The key stays in plugin secret storage on the device.

## 7. Phases

| Phase   | Scope                                                                                                                                                                                                                                          |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 (now) | Host API additions (§6.8); plugin in TS: spec v1, validator, query engine, renderer with FLIP and board drops, step loop with rollback and undo, text plus dictation hint, web push-to-talk, work-context placement, eval harness, docs, tests |
| 2       | Host speech service with its packaging checklist; escape-hatch code block (prototype sandbox, own storage key); `agenda`, `bar`, `focus`, `addTask` components                                                                                 |
| 3       | Host-native renderer of the same specs (ADR first): real task rows, board panels, customizer semantics                                                                                                                                         |
| Later   | Pinned ids for names; local model provider; A2UI export; sharing a view as a file                                                                                                                                                              |

## 8. Testing

- Plugin unit tests: validator (keeps unknown fields), step application
  (merge, null removal, child cleanup), query engine (logical day, `@current`,
  names, archive), board drop writes, stream parser for tool-call events, local
  commands (undo).
- Host unit tests: the new bridge service, the `dataChanged` and `dayChange`
  effects, iframe allowlist.
- E2E in the app with a recorded tool-call stream: a request builds a board from
  real tasks; dragging a card writes the tag; undo restores the spec; the
  request contains no task titles; a task planned in the Planner appears without
  a reload.
- Eval harness (`eval/`): 20 utterances with expected outcomes and a script
  that needs `ANTHROPIC_API_KEY` and reports time to first step, total time,
  invalid-step rate and outcome per model and effort.

## 9. Risks and open questions

1. Latency and step validity are unmeasured until the eval runs.
2. Desktop voice waits for Phase 2; system dictation is the bridge.
3. The plugin renderer is disposable by design; keep it small so Phase 3 has
   less to replace.
4. Name references break on rename until ids are pinned.
5. Large views: queries cap at 200 items by default.

## Review

Independent review of rev. 1 (fresh-context agent, Oct 30, 2026). Findings and
what changed:

| Finding                                                                           | Outcome                                                                                                                                                  |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ignores SP's Boards, customizer, Planner; plugin-drawn cards worse than native    | Fixed: host-native rendering is the end state (§5, Phase 3); spec maps onto board semantics                                                              |
| `anyTaskUpdate` is local-only and misses many actions                             | Fixed: `dataChanged` hook (§6.8); verified `LOCAL_ACTIONS` in `plugin-hooks.effects.ts`                                                                  |
| RFC 6902 patches drop interdependent ops, shift indices                           | Fixed: merge-by-id steps as tool calls with an error-feedback loop (§6.3)                                                                                |
| Phase 1 voice only works on web                                                   | Fixed: Phase 1 voice scoped to web plus dictation; Phase 2 packaging checklist (§6.5). Verified the Electron permission handler and `available()` result |
| 2 s target vs Opus default with thinking always on                                | Partly: effort `low` for edits, eval harness to choose defaults; default stays Opus 5.5 until measured                                                   |
| Query gaps: archive, day context, priority and deadline, order, names             | Fixed except id pinning (open, §9)                                                                                                                       |
| View Transitions fragile; accessibility missing                                   | Fixed: FLIP, keyboard moves, pointer drag, `aria-live`                                                                                                   |
| Drop semantics can damage data (tags, recurring project moves, Today)             | Fixed: board drops use native tag semantics; no project moves by drop in Phase 1; model never writes data (§6.1)                                         |
| Views only on the plugin route                                                    | Fixed: work-context placement and `@current` scope (§6.7)                                                                                                |
| Single-file plain JS for a permanent contract; validator must keep unknown fields | Fixed: TypeScript and esbuild; merge semantics keep unknown fields (§6.2, §6.9)                                                                          |
| No demand section; prior art missing domain apps and in-repo features             | Fixed (§1, §4)                                                                                                                                           |
| Typed tracking methods instead of an internal action string                       | Fixed (§6.8)                                                                                                                                             |
| Code blocks in Phase 1                                                            | Deferred to Phase 2 as suggested                                                                                                                         |
