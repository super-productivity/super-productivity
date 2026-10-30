# Generative views: say what you want, watch the view rearrange

Oct 30, 2026 · rev. 1 (draft for review) · builds on the AI View Builder
prototype (commit `8c1a83f`, branch `claude/generative-ui-todo-app-h4o6e8`).

People will increasingly shape their own to-do tools instead of adapting to one.
The goal is that they do it inside Super Productivity (SP): describe a view by
voice or text, and the view changes in front of them, using their real tasks,
with nothing leaving the device except the request itself. This plan picks the
representation, the edit loop, voice input and the plugin API changes that make
that feel immediate and keep working for years.

**Decision (proposed).**

1. A view is **data, not code**: a versioned, renderer-agnostic _view spec_ (a
   flat map of components with ids, plus named task queries). Trusted plugin code
   renders it. Generated code survives only as an escape-hatch block.
2. Edits are **streamed JSON Patch operations** applied one by one, each animated
   with the View Transitions API, so the view visibly rearranges while the model
   is still answering. No full regeneration per edit.
3. **Push-to-talk voice** with a live transcript, through a small speech
   interface. Phase 1 uses the Web Speech API where it works (on-device first);
   Phase 2 moves speech into the host behind the plugin API, with on-device
   engines on every platform.
4. Two small, read-only **plugin API additions** (`getTodayStr`,
   `getCurrentTaskId`) so views get logical-day and time-tracking state right.
5. Stays a **bundled plugin, off by default**. A host-native renderer can come
   later without migrating anyone's views.

---

## 1. What "magical" means, measurably

| Moment                          | Target                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------- |
| Speaking                        | Words appear as they are spoken (partial transcript)                          |
| End of utterance → first change | ≤ 2 s at p50 for an edit ("group by project", "hide done tasks")              |
| New view from scratch           | First components on screen ≤ 3 s, complete ≤ 8 s                              |
| How a change looks              | Existing items move to their new place (animated), nothing reloads or flashes |
| State during edits              | Scroll position, open inputs and per-view settings survive an edit            |
| Undo                            | "Undo" by voice or button reverts instantly, without a model call             |
| Offline                         | Saved views work fully offline; only creating or changing one needs network   |

The latency targets are unmeasured: this session has no API key. They are design
targets that drive the representation choice (small outputs), and the first
thing to measure with a key (§9).

## 2. Where the prototype stands

The prototype (`packages/plugin-dev/ai-view-builder/`) has Claude write a full
HTML document per request and runs it in a nested opaque-origin sandbox with a
small `sp` API. It works and is well isolated, but it cannot feel magical:

- **Every edit regenerates the whole document** (up to 32k output tokens).
  Expected tens of seconds per change, and cost grows with view size.
- **Every edit reloads the view**: scroll, inputs and in-memory state are lost,
  and nothing animates.
- **Code is brittle over time**: each view hard-codes its own rendering, so app
  changes (new task fields, theming) do not reach saved views, and a breaking
  `sp` change breaks them.
- **Opaque-origin iframes did not paint on Windows desktop** (#8467); unverified
  for the nested case.

What carries over: the API-key handling (`plugin.js` secret), streaming client,
SSE parser, the sandbox and `sp` runtime (for escape-hatch blocks), synced
storage layout, the E2E harness and the privacy model.

## 3. Prior art

Checked 2026-10 from vendor docs and search summaries, not hands-on, except the
prototype.

| Product                  | View representation                                                                | How edits apply                                          | Rendering / safety                                    | Source                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Google A2UI              | JSON: flat list of components with id references, catalog                          | Incremental updates to the component list                | Client renders trusted native widgets; no code        | [github.com/google/A2UI](https://github.com/google/A2UI)                                           |
| MCP Apps (SEP-1865)      | HTML resource                                                                      | Tool calls; app reloads data                             | Mandatory sandboxed iframe, JSON-RPC over postMessage | [SEP-1865](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp) |
| Notion database views    | Fixed layouts (table, board, list, calendar, timeline, chart…) over one data model | User or "Build with AI" sets layout, filter, sort, group | Native                                                | [Notion API: views](https://developers.notion.com/guides/data-apis/working-with-views)             |
| SP prototype (`8c1a83f`) | Generated HTML + JS                                                                | Full regeneration                                        | Nested opaque sandbox, CSP without network            | hands-on, this branch                                                                              |

**Take**

- UI as data with a trusted component catalog (A2UI): safe, fast to generate,
  renderable by any future renderer.
- Flat components keyed by id (A2UI): small patches, streamable, stable identity
  for animation.
- Layouts over one data model with filter, sort and group (Notion): matches SP's
  fixed task model, so no schema builder is needed.
- Sandboxed iframe plus postMessage RPC for code (MCP Apps): our escape hatch
  already has this shape.

**Deliberately don't**

- Adopt A2UI wholesale now: it is pre-1.0, general-purpose and not data-bound.
  Keep an export path open (§5.1) instead of an external dependency.
- Notion-style custom properties: feature creep against SP's task model.
- Code generation as the primary path: slow, brittle, reloads on every change.
- Voice that is always listening: push-to-talk only (calm defaults, privacy).

## 4. Options

| Option                                                  | Edit latency       | Expressiveness     | Durability                                   | Native feel | Cost now    |
| ------------------------------------------------------- | ------------------ | ------------------ | -------------------------------------------- | ----------- | ----------- |
| A. Code generation only (prototype)                     | Slow               | Unlimited          | Low: code rots, API coupling                 | Medium      | Done        |
| B. Declarative spec only                                | Fast               | Bounded by catalog | High: versioned data, migratable             | High        | Medium      |
| **C. Spec first, sandboxed code block as escape hatch** | Fast (common case) | Unlimited          | High for the spec, code blocks isolated      | High        | Medium+     |
| D. Host-native "custom views" core feature now          | Fast               | Bounded            | High, but new persisted model + sync surface | Highest     | High, risky |

**Recommendation: C**, rendered in the plugin iframe now, with the spec kept
renderer-agnostic so D can come later as a second renderer of the same data
(real task rows, drag and drop, context menus) without touching saved views.

## 5. Design

### 5.1 View spec v1

```json
{
  "specVersion": 1,
  "title": "Today board",
  "root": "main",
  "components": {
    "main": { "type": "columns", "children": ["todo", "doing", "done"] },
    "todo": {
      "type": "taskList",
      "title": "To do",
      "query": "open",
      "fields": ["title", "estimate"]
    },
    "doing": {
      "type": "taskList",
      "title": "Doing",
      "query": "doing",
      "onDrop": { "addTag": "doing" }
    },
    "done": {
      "type": "taskList",
      "title": "Done",
      "query": "doneToday",
      "collapsed": true
    }
  },
  "queries": {
    "open": {
      "where": [{ "isDone": false }, { "due": "today" }, { "notTag": "doing" }],
      "sort": ["order"]
    },
    "doing": { "where": [{ "isDone": false }, { "tag": "doing" }] },
    "doneToday": { "where": [{ "doneOn": "today" }] }
  }
}
```

- **Components** (the catalog, v1): layout `stack`, `columns`, `section`;
  data `taskList` (fields, density, subtasks, `groupBy`), `board` (query plus a
  `groupBy` field; dropping a card writes that field), `agenda` (tasks by day
  over a range), `metric` (count or time sum over a query), `bar` (bar chart of a
  metric per group), `focus` (one task, large, with tracking controls),
  `addTask` (input with defaults), `text`; escape hatch `code` (§5.7).
- **Queries** reference projects and tags **by name**, resolved on the device,
  and dates by **relative tokens** (`today`, `tomorrow`, `thisWeek`, `overdue`,
  `none`), resolved against the logical day (`getTodayStr`). The spec therefore
  never contains task data, and the model never needs any.
- **Card actions** (fixed set): toggle done, start/stop tracking, open details,
  plan for today, delete (confirm). Drop targets write one field.
- **Forward compatibility**: an unknown component type renders as a quiet
  placeholder ("Needs a newer version of AI View Builder"); an unknown query
  operator matches nothing and is flagged; a higher `specVersion` opens
  read-only. Older clients that sync a newer spec never break it, because they
  only write it back when the user edits.
- **Versioning**: `specVersion` bumps only for breaking changes, with a pure
  migration function per step, tested with fixtures. Additive changes (new
  component types, fields) need no bump.
- **Validation**: one hand-written validator (no new dependency) shared by the
  renderer, the patch applier and the tests.

### 5.2 Edits: streamed JSON Patch

The model answers with **newline-delimited JSON Patch operations**
([RFC 6902](https://www.rfc-editor.org/rfc/rfc6902) subset: `add`, `replace`,
`remove`) against the spec, one per line, plus an optional final
`{"say": "…"}` line for a one-sentence summary:

```
{"op":"replace","path":"/components/main/type","value":"board"}
{"op":"add","path":"/components/main/groupBy","value":"project"}
{"say":"Grouped your tasks by project."}
```

- Each line is parsed when its newline arrives, validated against the spec, and
  applied to a **working copy**; the renderer updates after each valid op. An
  invalid op is skipped and reported, and the rest continue.
- On a clean end of stream the working copy is saved; on error, abort or Stop it
  is discarded and the view returns to the saved spec (with an animation).
- The request carries the system prompt (catalog, query language, examples),
  the current spec (a few KB) and the utterance. Outputs are typically tens to
  hundreds of tokens, which is what makes the latency target plausible.
- New views use the same channel: ops against an empty spec, so the first
  components appear while the rest streams in.

### 5.3 Live rearrangement

- Keyed rendering: components keyed by id, task cards keyed by task id. Each
  render after an op runs inside `document.startViewTransition()` with
  `view-transition-name` per component and per task, so a task visibly travels
  from a list into a board column.
- `prefers-reduced-motion` or no View Transitions support: the same updates
  apply instantly.
- Data changes from the app (hooks) re-run only the affected queries and
  re-render with the same keys, so edits elsewhere also animate in place.

### 5.4 Voice

- **Push-to-talk**: a mic button, plus holding a shortcut key while the plugin
  is focused. Never always-listening. The partial transcript shows live; on the
  final result the request is sent automatically, so speaking is the whole
  interaction.
- **Local commands** are handled without the model: "undo", "redo", "switch to
  <view name>", "new view".
- **Phase 1 engine ladder** behind one `SpeechInput` interface:
  1. Web Speech API with `processLocally` when the browser reports on-device
     support (Chrome 139+; MDN marks it experimental).
  2. Web Speech API in the cloud (Chrome, Edge, Safari), only after a one-time
     notice that the browser vendor processes the audio.
  3. Otherwise no mic button and a hint that the system dictation (macOS,
     Windows Win+H, mobile keyboards) types into the prompt box. This is the
     Electron case: Chromium's cloud recognizer fails there with a `network`
     error.
- **Phase 2**: a host speech service exposed as `PluginAPI.listen()` (partial
  and final transcripts as events) with on-device engines everywhere: native
  recognizers on Android and iOS, a downloaded Moonshine/Whisper model (≈40 MB
  quantized, opt-in) on desktop. Host-level because mobile engines are native
  and other features (quick add, brain dump) want the same thing.

### 5.5 Model layer

- One `generateOps(spec, utterance, signal)` async iterator; the Anthropic
  implementation reuses the prototype's streaming client (direct streaming
  fetch, `CapacitorWebFetch` on mobile, server-side fallbacks).
- Model and effort are settings with a speed-first default for edits; the system
  prompt is cached (`cache_control`). The interface leaves room for a local
  model provider later without touching the renderer.

### 5.6 Plugin API additions

| Method                                        | Why                                                                                     | Cost                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------- |
| `getTodayStr(): Promise<string>`              | Relative dates must follow the logical day (start-of-day offset), not the calendar date | Read-only, one line of contract |
| `getCurrentTaskId(): Promise<string \| null>` | Tracking controls need the current state on load (the hook only reports changes)        | Read-only                       |

Both go into a new small bridge service: `plugin-bridge.service.ts` is 17 lines
under its pinned `max-lines` cap and must not grow, so the work-context methods
move out with them. Both are added to the iframe allowlist, `PluginAPI` types,
`docs/plugin-development.md` and the API wiki note.

### 5.7 Code blocks (escape hatch)

A `code` component holds generated HTML and runs exactly like a prototype view:
nested opaque sandbox, CSP without network, the versioned `sp` runtime, its own
`data:<viewId>:<blockId>` storage. The model emits one only when the catalog
cannot express a request; a block is regenerated on its own, never the whole
view. Existing prototype views are unreleased, so no migration is needed.

### 5.8 Storage and sync

| Key                 | Content                                    | Bound                          |
| ------------------- | ------------------------------------------ | ------------------------------ |
| `view:<id>`         | spec + metadata (title, recent utterances) | ≤ 200 KB; typical spec < 10 KB |
| `data:<id>:<block>` | a code block's own data                    | ≤ 100 KB per block             |
| `settings`          | model, voice preferences                   | fixed                          |

Plugin user data only: no new persisted app model, action or entity, and no
sync-wire change. Concurrent edits of the same view resolve last-writer-wins
per view. Undo history stays on the device.

### 5.9 Security and privacy

- Spec views run no generated code at all: trusted renderer, `textContent`
  everywhere, a fixed action set.
- Code blocks keep the prototype's isolation (opaque origin, CSP, frame-src
  guard, per-render channel).
- Sent to Anthropic: the utterance, the current spec, a code block's source
  when editing it. Never task data. Audio goes nowhere in Phase 1's on-device
  path, to the browser vendor only after the notice in the cloud path.

## 6. Long-term cost

- **Persisted app model, sync wire**: none.
- **Plugin API**: two read-only methods, permanent contract.
- **View spec v1**: a new durable contract in synced user data. It must stay
  readable forever; this is why it is small, versioned and migration-tested.
- **Maintenance**: one renderer, one validator, one query engine in plain JS,
  covered by unit tests; no build step and no new dependency.

## 7. Phases

| Phase            | Scope                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 (this session) | Spec v1, validator, query engine, renderer with View Transitions, streamed patch edits, undo, voice ladder (Web Speech), the two API additions, code blocks reusing the prototype sandbox, docs, tests |
| 2                | Host speech service (`PluginAPI.listen()`): native mobile, local desktop model                                                                                                                         |
| 3                | Host-native renderer for the same specs (real task rows, drag and drop), if Phase 1 shows demand                                                                                                       |
| Later            | Local model provider; A2UI export; sharing a view as a file                                                                                                                                            |

## 8. Testing

- Unit (node): validator, patch applier (valid, invalid and partial streams),
  query engine (relative dates against a fixed logical day, name resolution),
  migrations, NDJSON stream parser, local voice commands.
- Browser harness: streamed ops morph the DOM without reloading; reduced motion;
  forward-compat placeholder.
- E2E in the app (mocked API, fake `SpeechRecognition`): spoken edit regroups
  real tasks; drop on a board column writes the field; undo; data never in the
  request.

## 9. Risks and open questions

1. **Latency is unmeasured.** Needs a key: time to first op and to last op per
   model and effort, for 10 typical edits. Pick the default from that.
2. **Model reliability with patches**: invalid paths or ops. Mitigated by the
   validator, few-shot examples and skip-and-continue; measure the invalid-op rate.
3. **Voice on desktop** stays text-plus-system-dictation until Phase 2.
4. **Catalog scope**: too small and code blocks dominate; too big and the
   contract is costly. Start with the list in §5.1 and grow from code-block
   requests users actually make.
5. **Windows rendering of code blocks** (#8467) still needs a manual check; spec
   views do not depend on it.
