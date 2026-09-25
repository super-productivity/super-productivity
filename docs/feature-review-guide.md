# Feature & PR Review Guide

The full form of two AGENTS.md _Project rules_ — "Does it earn its place?" and
"Code review". The short invariants stay in AGENTS.md; the verification
mechanics live here. Read this before reviewing a feature PR, and when deciding
whether a feature you are about to build should exist at all.

## Does it earn its place?

For a new feature, the first review question is whether it should exist at all — not whether the diff is correct. Complexity added is permanent, so the burden is on the change to justify it. Is there real demand (reactions and distinct participants on the linked issue, not just the author)? Has the same idea been declined before — search **closed** issues, because a prior "no" needs new evidence, not a new PR. Does the PR's stated motivation survive checking: are the issues it cites actually open, or already fixed more cheaply (`git log -S`, `git tag --contains`)? Treat the motivation as a claim to verify, not context to accept. A correct, well-tested implementation of something that doesn't earn its place is still a decline, and the leanest fix that resolves the reported symptom usually wins.

## Long-term cost of a change

When reviewing new features, always double-check the potential long-term costs and risks a change introduces — maintenance burden, hard-to-reverse choices (data shapes, public/plugin APIs, sync formats), locked-in dependencies/abstractions, and footguns that only surface at scale or across synced clients — not just whether the immediate diff is correct.

Three of those costs are permanent once shipped, because released clients and third-party plugins keep running against them. On any PR that touches one — however small the diff — the question is not "is this correct" but "what does a client that has never heard of this field do when it arrives?" Ask it while authoring, not only while reviewing.

- **Persisted model** — any type a `MODEL_CONFIGS` slice reaches (`src/app/op-log/model/model-config.ts`; its `AllModelConfig` type is the source of truth, and `validation-fn.ts` derives from it). Not every `*.model.ts` qualifies — banner, snack, dialog and router state do not — and some non-model files do: `PlannerState` in `src/app/features/planner/store/planner.reducer.ts`, `BoardsState` in `src/app/features/boards/store/boards.reducer.ts`, and the runtime defaults in `src/app/features/config/default-global-config.const.ts`. New fields optional (`?`) plus a runtime default → [persisted-model-fields.md](sync-and-op-log/persisted-model-fields.md).
- **Sync wire** — `packages/shared-schema/src/**`; the wire types in `packages/sync-core/src/` (`operation.types.ts`, `apply.types.ts`, `full-state-op-types.ts`, `entity-registry.types.ts`, `vector-clock.ts`, `sync-file-prefix.ts`, `compression.ts`, `encryption/transport-shape.ts`) rather than that package's conflict/encryption algorithms; `src/app/op-log/core/{operation.types,action-types.enum,lww-update-action-types,entity-registry}.ts`; and `src/app/op-log/persistence/compact/{compact-operation.types,action-type-codes}.ts`. Degrade gracefully on released clients instead of bumping the schema. The enum **string values** in `action-types.enum.ts` and the short codes in `action-type-codes.ts` are immutable — what is stored in IndexedDB and shipped over the wire; a rename adds a new member carrying the OLD value plus an `ACTION_TYPE_ALIASES` entry.
- **Plugin API** — `packages/plugin-api/src/**`. The package imports nothing outside itself, so this surface only grows by an explicit edit here. An exported symbol is a contract with third-party plugin authors and withdrawing it breaks their plugins with no warning: does it need to be public at all?

**What CI already covers, and what it does not.** `frozen-state.spec.ts` runs real v18.15.1 on-disk state against the current model, catching required-field additions in CI — but only for models the fixture populates, and a warm Angular cache can hide a break locally (see its docblock). `action-types.enum.spec.ts` and `persistent-action-types.spec.ts` pin the action strings and codes. `released-client-compatibility-policy.spec.ts` demands a compatibility assessment for every migration past schema v4, with pinned released-client provenance when the migration is runtime-visible. Nothing mechanical covers **optional** field additions, new op payload fields, new plugin-API exports, or new `ENTITY_CONFIGS` entries (`require-entity-registry` is scoped to `**/*.effects.ts`, so its completeness check never reaches `entity-registry.ts`). Those are caught by reading the diff — a "surface changes need a dedicated PR" gate was measured and rejected → [hardening-earns-its-place.md](hardening-earns-its-place.md) § Rejected guards.

## Footguns reviewers keep missing

Two real bugs shipped through three review rounds of the task multi-select feature (2026-09) because reviewers checked the dispatched action, not the resulting state or DOM. Check these explicitly on task-list code:

- **Today membership is the task's due date, never the Today tag's list.** `TODAY_TAG.taskIds` only stores ordering, so removing an id from it changes nothing on screen; leaving Today means unscheduling → [ARCHITECTURE-DECISIONS.md](../ARCHITECTURE-DECISIONS.md) Decision #2.
- **A destroyed task row is still in the DOM while the list's leave animation runs.** `ngOnDestroy` has fired, but `document.querySelector('task')`, `isConnected` and `document.activeElement` still see the host for another ~225 ms. Any "is this row still rendered?" or "is focus intact?" check must ask the component layer, not the DOM (see `TaskMultiSelectService.isDestroyedHost`).

## Related

- Product principles (feature creep, calm defaults) → [AGENTS.md](../AGENTS.md) § Product principles
- Load-bearing decisions already made → [ARCHITECTURE-DECISIONS.md](../ARCHITECTURE-DECISIONS.md)
- Sync-bug severity triage → [sync-and-op-log/sync-severity-triage.md](./sync-and-op-log/sync-severity-triage.md)
