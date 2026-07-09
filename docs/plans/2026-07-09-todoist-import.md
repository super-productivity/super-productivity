# Todoist → Super Productivity migration

Status: **revised & verified against code** · 2026-07-09

Goal: let a Todoist user bring their **active** projects, tasks, sub-tasks, labels,
due dates and time estimates into Super Productivity in one pass, non-destructively,
without adding permanent weight to the core app.

## Product framing

- Migration runs **once per user** and is then dead weight. Per the manifesto (avoid
  feature creep; new UI/settings are permanent costs), it lives at the edge, not in
  core hot paths.
- It must be **additive**, never destructive — most people evaluating SP already have
  some data. The existing `importCompleteBackup` path (wipes all state) is the wrong tool.
- It is a **one-time import**, not a live integration. The issue-provider framework
  (`src/app/features/issue/`) is built for ongoing polling + remote-linked tasks and is
  deliberately **not** used here.

## Chosen approach

**A bundled plugin does all the work; core gets only a launcher row.**

- Front-end + parsing + mapping + preview UI = a **bundled plugin**
  (`packages/plugin-dev/todoist-import/`, built into `src/assets/bundled-plugins/`).
  Matches the maintainers' direction (Trello / Linear / ClickUp / Azure moved _out_ of
  core into plugins); fully replaceable / community-extensible.
- Landing the data uses only existing plugin-API methods — **zero new core API**:
  - `addProject` / `addTag` for containers,
  - **`batchUpdateForProject`** for all task creation (see below — this was missed in
    the first draft and changes the op-log story),
  - `updateTask` follow-ups only for fields the batch op doesn't carry
    (`dueDay`, `dueWithTime`, `tagIds`).
- The plugin ships `isSkipMenuEntry: true` — no permanent menu noise for a one-time
  tool. **Discoverability** comes from a single launcher row in the Import/Export
  settings screen (`src/app/imex/file-imex/`): `PluginService.activatePlugin(id, true)`
  then navigate to the existing `plugins/:pluginId/index` route. Deliberately the
  **in-memory** enable (plugin-management additionally persists via
  `setPluginEnabled`): after a restart the importer is dormant again — zero standing
  weight; relaunching from the same row re-activates it.

### Key correction #1: use `batchUpdateForProject`, not per-task `addTask`

Verified in `plugin-bridge.service.ts:1209` + `task-shared-meta-reducers/task-batch-update.reducer.ts`:

- The batch API is **backed by a meta-reducer**: one dispatched chunk (≤ 50 ops,
  `MAX_BATCH_OPERATIONS_SIZE`) = **one action = one op-log entry** (sync rule #3).
  A 1000-task import ≈ 20 ops for structure instead of 1000+.
- It handles **parent references via temp IDs** (bridge pre-generates real IDs and
  returns the mapping) and preserves creation order — root tasks land in
  `project.taskIds` in array order (verified in
  `validate-and-fix-data-consistency-after-batch-update.ts`). No reorder op needed for
  freshly created projects.
- Per-task `addTask` would additionally **reverse ordering** (bridge hardcodes
  `isAddToBottom: false`, i.e. prepend) — another reason the first draft's approach
  was wrong.
- Batch create data carries `title / notes / isDone / parentId / timeEstimate` only;
  `dueDay`, `dueWithTime` and `tagIds` are applied with one `updateTask` per task that
  has them. Ops ≈ `ceil(tasks/50) per project + dated/labelled tasks` — a tolerable
  one-time burst, and it removes the main driver for a v2 `importData` core primitive.
- **Hard constraints found in review** (the reducer enforces these silently):
  - temp IDs **must** be `temp-`/`temp_`-prefixed — anything else leaves children with
    dangling `parentId`s that the consistency pass **deletes** as orphans;
  - a parent's create op must sit at a **lower index than its children's** — the bridge
    chunks at 50 ops/action and the roots-first sort is per-chunk only;
  - the plugin **chunks its own calls at ≤ 50 ops and awaits each** — every iframe call
    is its own postMessage round-trip, so this keeps one dispatch per tick (sync rule
    #6) even for 5k-task projects, where the bridge's internal `forEach` chunking would
    dispatch 100 actions in one tick;
  - the result is fire-and-forget (`success: true` always, `errors` never populated) —
    the **post-import summary re-reads state** (`getTasks`) and counts what actually
    landed instead of trusting the return value.

### Key correction #2: what the plugin API actually can't do (verified)

1. **No `TaskRepeatCfg` creation** — `PluginTaskRepeatCfg` is read-only. v1 degrades:
   keep next due date + append `Repeats: <string>` to notes.
2. **SP _does_ have a Section entity now** (`src/app/features/section/`) — the first
   draft claimed it didn't. But there is **no plugin API / allowed action** to create
   sections, so v1 still drops Todoist sections (task order within the project is
   preserved; flagged as lossy). v2 candidate: expose section creation to plugins.
3. **No ProjectFolder creation API** (`Project.folderId` exists, but nothing creates
   folders) — the first draft's `parent_id → folderId` mapping is unworkable. v1
   **flattens nested projects**; when two projects collide on title, the child is
   disambiguated as `Parent / Child`. Flagged as lossy.
4. **Subtasks can't hold tags** (bridge forces `tagIds: []` for subtasks — SP model)
   → labels on Todoist sub-tasks are dropped, flagged in the summary.

### v2 (only if v1 validates demand)

`addTaskRepeatCfg` and/or plugin-visible section/folder creation. Deferring is
deliberate (YAGNI): public plugin-API surface is hard to reverse. The bulk-import
primitive from the first draft is **no longer needed** — `batchUpdateForProject`
already folds structure into few ops.

## Input source

**API token only in v1.** The user pastes a Todoist personal token (Settings →
Integrations → Developer); the plugin makes one
`POST https://api.todoist.com/api/v1/sync` with `sync_token=*`,
`resource_types=["projects","items","labels","sections","notes"]` (`notes` = task
comments, folded into SP task notes) via the gated `PluginAPI.request`
(`permissions:["http"]` + `allowedHosts:["api.todoist.com"]`). The old Sync **v9**
endpoint is deprecated — use unified **v1**.

**Token privacy (hard rule):** the token lives in iframe memory for the session only —
never `persistDataSynced` (that syncs!), not even `setSecret`. Password-type input; UI
states "sent only to api.todoist.com, never stored".

**CSV fallback: cut from v1 (YAGNI, folded review verdict).** It is a second parser +
fixture suite + multi-file UI for strictly worse fidelity (no labels, no comments, no
tz fidelity, one tedious export per project) — and its `DATE` column holds _localized
natural-language_ strings ("every day", "5 août") that cannot be parsed faithfully.
Named contingency if the web CORS check fails or users already closed their account;
fast-follow, not v1.

Completed-task history is out of scope for v1 (the sync endpoint returns only active
items by default — nothing extra to do).

## Mapping

| Todoist                                       | → Super Productivity                                          | Notes                                                                                                                                                                                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| project                                       | Project                                                       | hierarchy **flattened** (no folder API, see correction #2); `Parent / Child` title only on collision                                                                                                                                                                       |
| Inbox project (`inbox_project`)               | Project `Inbox (Todoist)`                                     | never merged into SP's own Inbox — additive & reviewable                                                                                                                                                                                                                   |
| section                                       | —                                                             | **v1: ignore** (no plugin API to create SP sections); flagged lossy. Sibling order key = `(section.section_order, item.child_order)` — sync items arrive unordered!                                                                                                        |
| label                                         | Tag                                                           | item `labels` are **names** in unified v1; match existing SP tags by title (case-insensitive), else `addTag`; only labels actually used by imported top-level tasks (SP subtasks can't hold tags — dropped + counted; the plugin must enforce this itself, the host won't) |
| item content                                  | task `title`                                                  |                                                                                                                                                                                                                                                                            |
| item description                              | task `notes`                                                  | markdown passes through                                                                                                                                                                                                                                                    |
| comments (sync `notes`)                       | appended to task `notes`                                      | same sync call; file attachments → keep the URL line, flag files as not imported                                                                                                                                                                                           |
| priority (API `4`=p1 … `1`=p4)                | —                                                             | **inverted vs UI!** Opt-in map to `p1`…`p3` **Tags**, default **off**, top-level only; **never tag API priority 1** (p4 is Todoist's default on every task)                                                                                                                |
| due (all-day, `YYYY-MM-DD`)                   | `dueDay`                                                      | via `updateTask` after batch create                                                                                                                                                                                                                                        |
| due (floating, `YYYY-MM-DDTHH:MM:SS`)         | `dueWithTime` (unix ms)                                       | parse as **local** time                                                                                                                                                                                                                                                    |
| due (fixed-tz, trailing `Z`)                  | `dueWithTime` (unix ms)                                       | parse as **UTC instant** — parsing as local shifts every fixed-time task                                                                                                                                                                                                   |
| deadline                                      | `dueDay` if no due; else `Deadline: <date>` appended to notes | nothing silently dropped                                                                                                                                                                                                                                                   |
| duration `minute`                             | `timeEstimate` (ms)                                           |                                                                                                                                                                                                                                                                            |
| duration `day`                                | —                                                             | **skip + count in summary** — fabricating 8h would corrupt time-tracking stats                                                                                                                                                                                             |
| sub-task (`parent_id`)                        | sub-task (2 levels)                                           | SP nests **2 levels only** — depth ≥ 2 re-parents to the depth-0 ancestor in reading (DFS) order, demotion counted                                                                                                                                                         |
| assignee (`responsible_uid`)                  | —                                                             | imported like any task; "N tasks had collaborator assignees" in summary                                                                                                                                                                                                    |
| recurring (`due.is_recurring` + `due.string`) | keep next due + append verbatim `Repeats: <string>` to notes  | verbatim preserves `every!` (recur-from-completion) semantics; real `TaskRepeatCfg` only with v2 core work. Imported timed tasks get **no reminder** (`updateTask` bypasses `scheduleTaskWithTime`) — noted, acceptable: Todoist reminders aren't imported anyway          |
| completed items                               | —                                                             | skip v1                                                                                                                                                                                                                                                                    |

## Architecture / file layout (v1)

```
packages/plugin-dev/todoist-import/
  package.json             # esbuild + jest, modeled on sync-md (no framework)
  scripts/build.js         # bundle ui/main.ts, INLINE bundle into index.html, copy manifest/icon
  src/
    manifest.json          # iFrame:true, isSkipMenuEntry:true, permissions incl. "http",
                           # allowedHosts:["api.todoist.com"], hooks:[]
    plugin.js              # stub (all logic lives in the iframe UI)
    ui/index.html          # minimal shell; built JS inlined (iframe uses srcdoc →
                           # the document must be fully self-contained, verified in
                           # plugin-iframe.util.ts)
    ui/main.ts             # wizard: token → preview (per-project checkboxes) → import → summary
    parse/from-api.ts      # unified-v1 sync JSON → normalized model (pure)
    parse/normalized-model.ts
    map/plan-import.ts     # normalized model → batch ops + follow-up updates (pure)
    map/run-import.ts      # executes the plan via PluginAPI, per-project failure boundary
  *.spec.ts                # jest over fixtures: due shapes, depth-3 nesting, section order,
                           # labels, priority inversion, duration units, deadline, comments
```

UI wizard specifics (trust items from review):

- **Preview = per-project checkboxes** with task/subtask counts; projects whose title
  already exists in SP are flagged "already exists — possibly from a previous import"
  and default **unchecked** (re-run safety without rollback machinery). Lossy items
  listed up front (sections, demotions, day-durations, subtask labels, assignees).
- **Import runs project-by-project** (batch + follow-ups per project before the next),
  so an abort leaves whole projects, and the summary can say "4/6 imported, failed at
  'Errands'".
- Post-import summary counts from re-read state, names everything dropped.

- Register in `packages/plugin-dev/scripts/build-all.js` and
  `src/app/plugins/plugin.service.ts` bundled list.
- Core touch (discoverability only): one launcher button in
  `src/app/imex/file-imex/` + one `en.json` key.

## Milestones (each with its check)

- **M0 · Spike — ✅ DONE, verdict GREEN.** Token path viable on web, Electron, mobile
  via gated `PluginAPI.request` (`plugin-bridge.service.ts:508`); app CSP is
  `connect-src *`; Electron injects ACAO:*. → *residual (web only):\* Todoist must
  answer the CORS preflight for the `Authorization` header; confirm with one live
  web-build call during M3. Electron/mobile need no confirm.
- **M1 · Parse + normalize.** Sync-v1 JSON → normalized model. → _verify:_ jest
  fixtures: parent chains incl. depth 3+, the three `due.date` shapes, deadline,
  recurring strings, durations (minute/day), priority inversion, section ordering,
  comments incl. attachments, Inbox, assignees.
- **M2 · Plan + create.** Pure op-builder (normalized model → project/tag creates,
  ≤50-op batch chunks parent-before-child with `temp-` IDs, follow-up updates) +
  executor. → _verify:_ unit tests on the op-builder; manual import of a fixture into
  a scratch profile: counts, nesting, order, due dates.
- **M3 · UI + preview + summary.** Token input, per-project preview, import progress,
  honest summary. → _verify:_ manual run web + Electron incl. the live CORS check.
- **M4 · Discoverability + docs.** Launcher row in Import/Export
  (`activatePlugin` + route to `plugins/todoist-import/index`); "Switch from Todoist"
  docs page (search is how the day-they-quit-Todoist persona finds this — no
  onboarding banners, per the manifesto). → _verify:_ new user completes an import
  from a cold start.

## Risks & open decisions

- **Partial import on failure** — additive, not transactional; per-project execution
  bounds the blast radius to whole projects and the summary names what landed.
  Accepted for v1 (KISS) — no rollback machinery.
- **Web CORS preflight** (M0 residual) — if Todoist blocks browser calls, web users
  get a clear error pointing at the desktop app (or the CSV fast-follow).
- **Follow-up `updateTask` volume** — one per dated/labelled task; bounded by the
  batch op for structure; acceptable one-time burst. Watch 5k+ item accounts.
- **Todoist API drift** — unified v1 is current (v9 deprecated); parser is defensive
  (unknown fields ignored, missing fields defaulted) and covered by fixtures.
- **Decided during review:** CSV cut from v1 · priority→tag default off (and API
  priority 1 never tagged) · duration `day` skipped, not 8h · Inbox → "Inbox
  (Todoist)" · collision projects default-unchecked in preview.
