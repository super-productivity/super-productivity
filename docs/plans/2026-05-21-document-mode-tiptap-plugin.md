# Document Mode → TipTap Plugin (POC)

**Status:** proposal, post-multi-review v2
**Date:** 2026-05-21
**Branch:** `feat/doc-mode4-2880bb`

## Goal

Reimplement the current in-tree document mode (`src/app/features/document-mode/`) as an opt-in iframe plugin using TipTap as the editor. Extend the plugin API to support a work-context-scoped header button, a `WORK_CONTEXT_CHANGE` hook, and embedding the plugin's view inside the work-view body (in place of the task list).

POC scope: no data migration, no removal of the existing in-tree feature, opt-in install only.

## Decisions locked in

| Question            | Decision                                                                                                                                           | Source                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Embed venue         | **Body-embed** (mirror today's `<document-view>` placement). No side-panel variant.                                                                | User                                                                                       |
| Visibility scope    | Host renders the button only when active context is project or TODAY tag, **but plugin still declares this** via a `showFor` field on registration | Reviewer push-back: hardcoded host filter is avoidable public-API debt                     |
| `taskRef` semantics | **Read-only chips** (atom node) — title + checkbox. Click on the chip opens the task panel for full edits. No inline title editing.                | Both reviewers flagged the race conditions of inline editing; POC ships cleanly without it |
| Persistence         | **Single existing blob, plugin-side `{[ctxId]: doc}` map**. No new persistence API for the POC.                                                    | Both reviewers recommended this — defers risky keyed-API design                            |
| Legacy data         | No migration                                                                                                                                       | User                                                                                       |
| Bundling            | Opt-in install, not bundled by default                                                                                                             | User                                                                                       |

## Plugin-API additions

```ts
// packages/plugin-api/src/types.ts
interface PluginAPI {
  // ...existing...
  getActiveWorkContext(): Promise<ActiveWorkContext | null>;
  registerWorkContextHeaderButton(
    cfg: Omit<PluginWorkContextHeaderBtnCfg, 'pluginId'>,
  ): void;
  showInWorkContext(): void;
  closeWorkContextView(): void;
}

interface ActiveWorkContext {
  id: string;
  type: 'PROJECT' | 'TAG';
  title: string;
  taskIds: string[];
}

interface PluginWorkContextHeaderBtnCfg {
  pluginId: string;
  label: string;
  icon?: string;
  onClick: (ctx: ActiveWorkContext) => void;
  /** Where to render the button. Default ['PROJECT']. 'TODAY' is the special TODAY tag. */
  showFor: ('PROJECT' | 'TAG' | 'TODAY')[];
}

enum PluginHooks {
  // ...existing...
  ANY_TASK_UPDATE, // ← already host-side, missing from iframe enum
  WORK_CONTEXT_CHANGE = 'workContextChange', // new
}
// WORK_CONTEXT_CHANGE payload: { id, type, title, taskIds } | null
// (full snapshot, not just id+type — see review finding #4)
```

No keyed persistence — POC reuses single blob.

## Host-side fixes required for body-embed

The multi-review surfaced several blockers that must be fixed inside the host before body-embed is safe. These are not optional:

### 1. Iframe message cross-talk (Codex)

`handlePluginMessage()` in `src/app/plugins/util/plugin-iframe.util.ts:451` accepts any `PLUGIN_API_CALL` without checking `event.source` or plugin id. Side-panel already mounts a `<plugin-index>` (`plugin-panel-container.component.ts:25`); adding a work-view embed gives two listeners that will both answer the same API call with different bound methods.

**Fix:** in every `handlePluginMessage` call site, verify `event.source === iframe.contentWindow` AND tag the message with the receiving plugin id; ignore mismatches. Apply to all embed sites: route page, side panel, work-view embed.

### 2. Header-button `onClick` callback proxy (Codex)

The iframe proxy posts `registerHeaderButton(cfg)` directly (`plugin-iframe.util.ts:329`) — `onClick` is a function, not structured-cloneable. The existing host-side `PluginAPI.registerHeaderButton()` works because it runs in the host runtime. Same applies to the new `registerWorkContextHeaderButton`.

**Fix:** mirror the existing hook/dialog callback proxy pattern. Iframe sends `{ register: {...cfg, callbackId} }`; host wraps `onClick` to post `{ type: 'CALLBACK_INVOKE', callbackId, ctx }` back to the iframe, where the plugin's stored callback runs.

### 3. `ANY_TASK_UPDATE` missing from iframe Hooks enum (Claude + Codex)

`plugin-iframe.util.ts:282-291` ships `TASK_COMPLETE | TASK_UPDATE | TASK_DELETE | CURRENT_TASK_CHANGE | FINISH_DAY | LANGUAGE_CHANGE | PERSISTED_DATA_UPDATE | ACTION` only. The host fires `ANY_TASK_UPDATE` (`plugin-hooks.effects.ts:237`) but the plugin can't subscribe.

**Fix:** add `ANY_TASK_UPDATE` (and `PROJECT_LIST_UPDATE`, `TASK_CREATED`) to the iframe enum.

Note: `anyTaskUpdate$` does not cover subtask reorders, task moves within Today list, or project task-list reorders. For read-only chips this matters less — title + isDone is enough — but document the gap.

### 4. `WORK_CONTEXT_CHANGE` source observable (Codex)

`WorkContextService.activeWorkContextTypeAndId$` (`work-context.service.ts:119-127`) only emits `{activeId, activeType}` — no title, no taskIds. `activeWorkContext$` (`:148`) has them but emits on any context-data change, which would spam the hook.

**Fix:** derive `WORK_CONTEXT_CHANGE` from a custom observable that distincts on `(type, id)` and then takes one `activeWorkContext$` snapshot for the payload. Also gate through `isContextChangingWithDelay$` so the hook fires once per nav, not during the 50 ms transition.

### 5. `PluginIndexComponent` cleanup-on-nav (Claude)

`plugin-index.component.ts:275` calls `cleanupPlugin(currentPluginId)` on `ngOnDestroy`. Embedding it in `work-view` means switching contexts (or toggling embed off/on) tears down hooks — the plugin re-initializes from scratch and loses its in-memory editor state.

**Fix:** when `<plugin-index>` is mounted with `directPluginId` (embed mode), skip `cleanupPlugin` on destroy. The cleanup belongs to the route lifecycle, not to embedded usage. Add an `@Input() skipCleanupOnDestroy = false`.

## Host files to change

| File                                                                                                          | Change                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/plugin-api/src/types.ts` + `src/app/plugins/plugin-api.model.ts`                                    | new types, `WORK_CONTEXT_CHANGE` + `ANY_TASK_UPDATE` enum members exposed                                                                                                                                                                                                              |
| `src/app/plugins/plugin-api.ts`                                                                               | bound methods + cleanup of context-buttons on plugin disable                                                                                                                                                                                                                           |
| `src/app/plugins/plugin-bridge.service.ts`                                                                    | `_registerWorkContextHeaderButton`, `workContextHeaderButtons` computed signal (filtered by `(type, id)` against each button's `showFor`), `workContextEmbedPluginId` signal, `_showInWorkContext` / `_closeWorkContextView`, `getActiveWorkContext`                                   |
| `src/app/plugins/util/plugin-iframe.util.ts`                                                                  | (a) add `ANY_TASK_UPDATE`/`PROJECT_LIST_UPDATE`/`TASK_CREATED` to enum, (b) proxy new methods, (c) verify `event.source` in `handlePluginMessage`, (d) callback proxy for header-button `onClick`                                                                                      |
| `src/app/plugins/plugin-hooks.effects.ts`                                                                     | emit `WORK_CONTEXT_CHANGE` from distinct-`(type,id)` observable, gated by `isContextChangingWithDelay$`; include `{id, type, title, taskIds}` in payload                                                                                                                               |
| `src/app/plugins/plugin-cleanup.service.ts`                                                                   | clear context-buttons + embed slot on disable                                                                                                                                                                                                                                          |
| `src/app/plugins/ui/plugin-index/plugin-index.component.ts`                                                   | add `@Input() skipCleanupOnDestroy`; default false; embed call sites pass `true`                                                                                                                                                                                                       |
| `src/app/core-ui/main-header/main-header.component.html` + new `plugin-work-context-header-btns.component.ts` | render context-scoped buttons next to the existing `<plugin-header-btns>`                                                                                                                                                                                                              |
| `src/app/features/work-view/work-view.component.ts/html`                                                      | branch: if `pluginBridge.workContextEmbedPluginId()` is set AND ctx is project or TODAY tag, render `<plugin-index [directPluginId]="..." [showFullUI]="false" [skipCleanupOnDestroy]="true">` in place of task list; suppress work-view header same way `isDocumentMode()` does today |

## Plugin (`packages/plugin-dev/document-mode/`)

Scaffold from `sync-md`. Build with Vite. Bundle: `@tiptap/core` + `@tiptap/starter-kit` + `@tiptap/extension-placeholder` + `@tiptap/suggestion`. Vanilla node-views — no React (~150 KB gzipped).

**Manifest:** `iFrame: true`, `isSkipMenuEntry: true`, `sidePanel: false`, hooks `WORK_CONTEXT_CHANGE` + `ANY_TASK_UPDATE`, `uiKit: true`.

**Editor model:** ProseMirror JSON. No `DocumentBlock[]`. Custom **`taskRef`** atom node `{ atom: true, draggable: true, selectable: true, attrs: { taskId } }`:

- NodeView renders checkbox + title from a local cache populated by `getTasks()`. Read-only display.
- Checkbox toggles → `updateTask(taskId, { isDone })`.
- Click on chip → `dispatchAction` to open the task in the existing side panel (not editable inside the editor).
- Backspace at start of a `taskRef`: confirm dialog (via host `openDialog` — `_isBareTask` heuristic is moved inside the host since the plugin's `Task` interface lacks `deadlineDay`/`reminderId`; expose a new `confirmTaskDeletion(taskId): Promise<boolean>` helper on the API or just always confirm in v1).
- Enter at end of a `taskRef`: `addTask({...})` + insert sibling `taskRef`.

**Other blocks:** StarterKit (paragraph/heading/bold/italic/strike/code), HorizontalRule (divider), Placeholder (empty state).

**Slash menu:** `@tiptap/suggestion` with `char: '/'`, `allowedPrefixes: null` (so `/` after arbitrary text triggers — current behavior). Items: Task / Paragraph / H1 / H2 / H3 / Divider plus turn-into.

**Block menu + drag handle:** vanilla floating UI on `.ProseMirror` mousemove.

**Lifecycle:**

- On load → register the context header button with `showFor: ['PROJECT', 'TODAY']`.
- On `WORK_CONTEXT_CHANGE` → flush pending save for previous ctx; load doc for new ctx from `persistDataSynced` blob (`{[ctxId]: doc}` map) → init editor. If no doc stored, seed from `payload.taskIds`.
- On `ANY_TASK_UPDATE` for current ctx, action is task-added → append `taskRef` if missing (mirrors `syncMissingTasks`).
- `editor.on('update')` → 5 s debounce → write to map, persist whole blob. Flush on `pagehide` and on `WORK_CONTEXT_CHANGE`. Note: `pagehide` inside iframe doesn't fire on Electron quit — last debounce window can be lost. Accept for POC; v2 can expose a host-side `beforeUnload` hook.

## Order of work

1. **Host plumbing — review fixes first** (`event.source` check, `skipCleanupOnDestroy`, `ANY_TASK_UPDATE` in iframe enum). These are bugs/gaps regardless of this feature.
2. **API extension**: new types, `WORK_CONTEXT_CHANGE` hook (with proper distinct-untils + gating), `getActiveWorkContext`, callback proxy for context-button `onClick`.
3. **Host UI**: `<plugin-work-context-header-btns>` + `workContextEmbedPluginId` signal + work-view branch.
4. **Plugin scaffold** + manifest + register button + open empty editor.
5. **TipTap editor**: paragraph/heading/divider + per-ctx persistence in single blob.
6. **`taskRef` read-only node** + create/delete via hooks.
7. **Slash menu + block menu + drag handle.**

## Out of scope (deferred to v2)

- Inline-editable `taskRef` titles (read-only chips for POC).
- Keyed `persistDataSynced(data, key)` API — using `{[ctxId]: doc}` in single blob for POC.
- Removal of in-tree `src/app/features/document-mode/`, `documentBlocks`/`isDocumentMode` fields, `isDocumentModeEnabled` flag.
- Data migration from legacy `documentBlocks`.
- Bundling as default install.
- Electron `beforeUnload` hook for the iframe.

## Open risks (acknowledged, not resolved)

- `anyTaskUpdate$` doesn't cover subtask reorders / Today list moves / project list reorders. For read-only chips this is small (titles + isDone), but title-on-other-context updates won't reflect until you switch back.
- `getTasks()` returns ALL tasks each call — fine for current scale, watchable as the task graph grows.
- The host-side fixes in §"Host-side fixes required" affect existing plugins (`sync-md`, etc.). Add regression tests for `plugin-bridge.service.spec.ts` and verify `sync-md` still loads.
