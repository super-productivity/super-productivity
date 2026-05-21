# Architecture Decision Records

This document tracks significant architectural decisions and patterns in the Super Productivity codebase. When making changes that affect these patterns, reference this document and update it if needed.

## Active Patterns & Decisions

### 1. dueDay/dueWithTime Mutual Exclusivity Pattern

**Status**: ✅ Active (since commit `400ca8c1`, 2026-01-29)

**Decision**: The `task.dueDay` and `task.dueWithTime` fields are mutually exclusive in new data. When setting `dueWithTime`, `dueDay` must be cleared (set to `undefined`). When reading, `dueWithTime` takes priority over `dueDay`.

**Rationale**:

- Prevents state inconsistency bugs where both fields had conflicting values
- Single source of truth for task scheduling
- Simpler state management

**Implementation**:

- **Writing**: Clear `dueDay` when setting `dueWithTime` (in meta-reducers)
- **Reading**: Check `dueWithTime` first; only check `dueDay` if `dueWithTime` is not set (in selectors)
- **Legacy Data**: Old data with both fields works via priority pattern (no migration needed)

**Key Files**:

- [`task.model.ts`](src/app/features/tasks/task.model.ts) - Field definitions with JSDoc
- [`task-shared-scheduling.reducer.ts`](src/app/root-store/meta/task-shared-meta-reducers/task-shared-scheduling.reducer.ts) - Write implementation
- [`work-context.selectors.ts`](src/app/features/work-context/store/work-context.selectors.ts) - Read pattern
- [`planner.selectors.ts`](src/app/features/planner/store/planner.selectors.ts) - Read pattern
- [`task.selectors.ts`](src/app/features/tasks/store/task.selectors.ts) - Read pattern

**When to Update This Pattern**:

- Adding new date/time scheduling fields
- Modifying task scheduling logic
- Working with task selectors that check due dates

---

### 2. TODAY_TAG Virtual Tag Pattern

**Status**: ✅ Active (established pattern)

**Decision**: `TODAY_TAG` (ID: `'TODAY'`) is a **virtual tag** whose membership is determined by `task.dueWithTime` or `task.dueDay`, not by `task.tagIds`. The tag's `taskIds` field stores only the ordering of tasks, not membership.

**Key Invariant**: `TODAY_TAG.id` must NEVER be added to `task.tagIds`

**Rationale**:

- Uniform move operations across all tags (virtual and regular)
- Single source of truth for "today" membership (date fields, not tagIds)
- Self-healing ordering (stale entries automatically filtered)
- Natural integration with planner (which uses date fields)

**Related**: Uses the dueDay/dueWithTime mutual exclusivity pattern (Decision #1)

**Key Files**:

- [`tag.const.ts`](src/app/features/tag/tag.const.ts) - TODAY_TAG definition
- [`work-context.selectors.ts`](src/app/features/work-context/store/work-context.selectors.ts) - Membership computation
- [`task-shared-helpers.ts`](src/app/root-store/meta/task-shared-meta-reducers/task-shared-helpers.ts) - Invariant enforcement

**When to Update This Pattern**:

- Adding new virtual tags
- Modifying tag membership logic
- Working with today's task list

---

### 3. Sync Package Boundary Direction

**Status**: ✅ Active (since May 2026)

**Decision**: Operation-log sync code is split by dependency direction:
`src/app` composes host-specific wiring, `@sp/sync-providers` owns bundled
provider implementations, and `@sp/sync-core` owns framework-agnostic reusable
sync primitives.

**Rationale**:

- Keeps reusable sync algorithms independent of Angular, NgRx, app models, and
  provider implementations
- Prevents provider IDs, app action/entity enums, validation schemas, UI, OAuth,
  and platform bridges from leaking into the core engine package
- Gives boundary lint a clear rule: packages never import app code, and
  providers consume only public sync-core exports

**Implementation**:

- ESLint rejects Angular, NgRx, app, shared-schema, sync-core deep imports, and
  dynamic imports inside package sources
- `@sp/sync-core` has no runtime dependencies and owns vector-clock algorithms
  used by client/server compatibility paths
- `packages/shared-schema` compatibility-re-exports generic vector-clock
  algorithms from `@sp/sync-core`; `@sp/sync-core` must not import
  `@sp/shared-schema`
- `@sp/sync-providers` depends on public `@sp/sync-core` plus provider runtime
  helpers, while app factories inject credentials, platform bridges, validators,
  OAuth routing, and config

**Documentation**: [`docs/sync-and-op-log/package-boundaries.md`](docs/sync-and-op-log/package-boundaries.md)

**Key Files**:

- [`packages/sync-core/src/index.ts`](packages/sync-core/src/index.ts) - Core public API
- [`packages/sync-providers/src/index.ts`](packages/sync-providers/src/index.ts) - Provider public API
- [`eslint.config.js`](eslint.config.js) - Package boundary enforcement
- [`src/app/op-log/sync-providers/sync-providers.factory.ts`](src/app/op-log/sync-providers/sync-providers.factory.ts) - App-side provider composition

**When to Update This Pattern**:

- Moving sync code between app and packages
- Adding a package export or dependency
- Adding a provider implementation or plugin-facing provider contract
- Changing vector-clock ownership or shared-schema compatibility

---

### 4. Document Mode Delta-Based Sync for documentBlocks

**Status**: ⛔ Superseded by Decision #5 (feature removed in commit `de5e399a`).

The original in-tree document-mode feature stored a `documentBlocks` array on each project/tag entity and used `updateDocumentBlocksDelta` + meta-reducers to sync a minimal diff per context. That feature has been removed in favour of a TipTap-based plugin (see Decision #5) which trades the delta machinery for portability outside the host's NgRx + op-log world.

The original action type (`DOCUMENT_MODE_UPDATE_BLOCKS_DELTA`) and its op-log code (`DU`) are kept in `action-types.enum.ts` and `action-type-codes.ts` for stable historical-op-log decoding only — no reducer handles them anymore.

---

### 5. Document Mode lives in plugin-owned synced storage (LWW blob)

**Status**: ✅ Active (POC)

**Decision**: Document mode is implemented as a TipTap-based plugin under `packages/plugin-dev/document-mode/`. Per-context document state is persisted as a single JSON blob via `PluginAPI.persistDataSynced`. The blob is keyed by `{ docs: { [contextId]: ProseMirrorJSON } }` plus an `enabledCtxIds` list owned by the background script. Task identity (title, done state, parent/child relationships) continues to live in NgRx and is reached through `PluginAPI.updateTask` and the `ANY_TASK_UPDATE` hook.

**How it works**:

1. The plugin renders each `task` from `getTasks()` as a content-bearing `taskRef` (and `subTaskRef`) node inside an editor doc.
2. Title edits inside the doc are debounced (~600 ms) and written back via `PluginAPI.updateTask`. The done-toggle writes the same way.
3. The doc itself is debounced (~5 s) and flushed to `persistDataSynced` as a full blob replacement.
4. On context switch / app start, the plugin reads the blob, walks `migrateStoredDoc` (schema migration) → `ensureSubtasksInJSON` (backfill subtasks from the host that aren't yet in the doc), and seeds the editor.
5. External task changes (other clients, regular task list, time tracking) arrive via `ANY_TASK_UPDATE`; the plugin refreshes the affected chip, and only auto-appends a new chip on a transition absent → present in its cache snapshot.

**Conflict behavior** (the tradeoff vs Decision #4):

- The doc blob is **last-writer-wins for the entire user's doc-mode state**. Two devices editing different contexts' docs concurrently can lose one device's edits — there is no delta merge.
- Task fields (`title`, `isDone`, etc.) still flow through `updateTask` and so still benefit from the host's per-field op-log + vector clock model.
- Document-side subtask ordering may drift from `task.subTaskIds` — the source of truth for hierarchy is NgRx; the doc reflects it on next reseed of a context, but in-place subtask reorders done in the regular task list are not back-merged into an already-open doc.

**Rationale**:

- The plugin runs inside an iframe with a stable, postMessage-based API. Plugin code does not touch NgRx, the op-log encoder, sync wrapper, or meta-reducers — the host's sync invariants stay simple even as the editor surface grows.
- TipTap / ProseMirror schema decisions are isolated from the host's data model; a future kanban or planner plugin can reuse the same embed-slot pattern without expanding the op-log action-type space.
- The single-blob LWW model is the most data we lose to a worse sync strategy than Decision #4. It is acceptable for the POC because (a) the doc layout is a _view_, not a primary store, and (b) the meaningful per-task state — what users actually care about preserving — still travels through the host's existing per-field sync.

**When to Revisit**:

- A second consumer of the embed slot lands (kanban, planner). The current `_workContextEmbedPluginId` is a single signal — last-writer-wins for the slot, no claim/release protocol. Generalise then.
- Reports of doc-state loss from multi-device usage. The first remediation step is per-context storage keys (so concurrent edits to different contexts no longer race on a single blob). A delta API on `PluginAPI` is the second step and would be a breaking API addition for plugins; revisit only if real users hit ordering/loss issues frequently.
- A `PluginAPI` versioning surface — current bindings are by method name string and break at runtime, not install time.

**Open known limitations** (intentional scope cuts for the POC):

- Doc / `task.subTaskIds` order may drift; only a full reseed of the context heals it.
- Concurrent local typing + remote title change can silently overwrite the remote within the debounce + echo window (~1.1 s).
- A corrupted stored blob shows an empty seed; saves are suppressed (`isDocCorrupt` flag) so the original isn't overwritten, but there is no in-app recovery path yet.
- Plugin unload / `pagehide` flushes the debounce best-effort but can lose up to ~5 s of edits on hard exit.

**Key Files**:

- [`packages/plugin-dev/document-mode/src/ui/editor.ts`](packages/plugin-dev/document-mode/src/ui/editor.ts) — TipTap editor, schema, NodeViews, drag, persistence
- [`packages/plugin-dev/document-mode/src/background.ts`](packages/plugin-dev/document-mode/src/background.ts) — header button, enabled-context tracking, blob layout
- [`docs/plans/2026-05-21-document-mode-tiptap-plugin.md`](docs/plans/2026-05-21-document-mode-tiptap-plugin.md) — full design doc
- [`packages/plugin-api/src/types.ts`](packages/plugin-api/src/types.ts) — `registerWorkContextHeaderButton`, embed slot, hooks
- [`src/app/plugins/plugin-bridge.service.ts`](src/app/plugins/plugin-bridge.service.ts) — host-side registry + embed slot

---

## How to Use This Document

### When Making Architectural Changes

1. **Before implementing**: Check if your change affects any active pattern
2. **During implementation**: Follow the documented patterns
3. **After implementation**: Update this document if you've:
   - Changed an existing pattern
   - Added a new architectural pattern
   - Made a decision that affects future development

### When to Add a New Decision

Add a new decision record when:

- The decision affects multiple files/modules
- Future developers need to understand "why" not just "what"
- The pattern needs to be followed consistently across the codebase
- The decision prevents a specific class of bugs

### Decision Record Template

```markdown
### N. [Pattern/Decision Name]

**Status**: ✅ Active | 🚧 Draft | ⚠️ Deprecated | ❌ Superseded

**Decision**: [One-sentence summary of the decision]

**Rationale**:

- [Why was this decision made?]
- [What problems does it solve?]

**Implementation**:

- [How is it implemented?]
- [Key techniques or patterns used]

**Documentation**: [Link to detailed docs]

**Key Files**: [List of primary files implementing this pattern]

**When to Update This Pattern**: [Scenarios when someone should review/update this]
```

---

## Related Documentation

- [`docs/sync-and-op-log/`](docs/sync-and-op-log/) - Operation log architecture
- [`docs/long-term-plans/`](docs/long-term-plans/) - Future architectural plans

---

## Commit Reference

When committing changes related to these patterns, reference this document and the specific decision:

```
feat(tasks): implement feature X

Uses dueDay/dueWithTime mutual exclusivity pattern (ARCHITECTURE-DECISIONS.md #1)
```
