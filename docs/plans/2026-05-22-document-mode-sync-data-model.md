# Document Mode — slimming the sync data model

**Status:** proposal, revised after multi-review
**Date:** 2026-05-22
**Branch:** `feat/how-fat-is-data-model-for-sync-for-new-fbd044`
**Follows:** [`2026-05-21-document-mode-tiptap-plugin.md`](./2026-05-21-document-mode-tiptap-plugin.md)
(the POC, which deliberately deferred a "keyed `persistDataSynced` API" — see its Limitations §)

## Problem

The document-mode plugin persists a **single blob** via `persistDataSynced`,
stored host-side as one `PluginUserData` entry keyed by **plugin id**:

```jsonc
{ "version": 1,
  "docs": { "<ctxId>": <full ProseMirror JSON>, ... },  // one doc per project/tag/TODAY
  "enabledCtxIds": ["..."] }
```

Each save → `upsertPluginUserData` → **one op** (`entityType: PLUGIN_USER_DATA`,
`entityId: pluginId`, `opType: Update`) whose payload embeds the _entire_ `data`
string. Three problems compound:

1. **Every op carries every context.** Typing one character in TODAY's doc
   emits an op containing TODAY + every project doc + every tag doc. Throttled
   ~once / 2 s while typing (`SAVE_THROTTLE_MS`; the host additionally coalesces
   to ≤ 1 commit/s via `MIN_PLUGIN_PERSIST_INTERVAL_MS`). Hard cap 1 MB
   (`MAX_PLUGIN_DATA_SIZE`) — above it the write throws. The op-log retains up
   to `COMPACTION_THRESHOLD = 500` ops over a 7-day window, so each fat blob is
   re-stored in IndexedDB and re-synced many times before compaction.

2. **Each chip stores a redundant copy of the task title.** A `taskRef` /
   `subTaskRef` chip persists the task title as inline text content plus an
   `isDone` attr. But on load, `prepareStoredDoc` → `migrateStoredDoc` +
   `refreshChipContentFromCache` **discard** the stored title/`isDone` and
   re-derive both from the live task cache; the chip NodeView likewise "trusts
   `task.isDone`, not the attr" (`task-ref-node.ts`). The stored title is dead
   weight in the synced payload — often the byte-heavy, variable-length part of
   a doc. Chip identity, order, and subtask membership are equally derived
   (rebuilt from `ctx.taskIds` / `subTaskIds`; reorders round-trip through the
   host — `reorderTasks` for PROJECT contexts, `ctx.taskIds` re-sort for
   TODAY/TAG). So chips are reconstructable; only the **prose between them** is
   plugin-owned.

3. **Concurrent edits do not resolve cleanly.** `entityId` is the _plugin id_,
   so all N documents collapse into one sync entity: device A editing project X
   and device B editing project Y produce `CONCURRENT` vector clocks on the
   _same entity_ → a conflict, even though they touched different documents.
   Worse, `PLUGIN_USER_DATA` is registered as a **`virtual`** entity
   (`entity-registry.ts`), and `ConflictResolutionService.getCurrentEntityState`
   has **no `virtual` branch** — it returns `undefined`. So the LWW local-win
   path (`_createLocalWinUpdateOp`) cannot read the entity and produces no
   replacement op. LWW does not function correctly for `PLUGIN_USER_DATA`;
   concurrent edits lose data, and not by a predictable last-writer-wins rule.

   _Note:_ even today a conflict that drops the blob only loses **prose** — on
   reload chips are rebuilt from the host regardless. Problem 3 is therefore a
   correctness gap, separate from problems 1–2 (size).

## Goals

1. Shrink the synced payload by removing the data the plugin redundantly stores.
2. No schema break — keep the change readable by both old and new clients.
3. No regression in load behaviour (chip order, prose anchoring, subtask
   backfill, stale-chip handling all already covered by `doc-transform.spec.ts`).

## Non-goals

- **Fixing problem 3 now.** It needs host-side work (per-context entities _and_
  virtual-entity LWW support) and is deferred — see Future work.
- **Fine-grained concurrent editing of the same doc.** Two devices editing the
  _same_ doc's prose will always resolve whole-doc; character-level merge needs
  a CRDT (Yjs) and is out of scope.
- Removing the in-tree `src/app/features/document-mode/` feature.

## Phase 1 — strip redundant chip content on save (plugin-local)

The smallest change that fixes problems 1 & 2: stop persisting the title text
and `isDone` attr on chips. Store each chip as a **bare identity atom**:

```jsonc
{ "type": "taskRef", "attrs": { "taskId": "<id>" } } // no content, no isDone
```

The persisted doc stays an ordinary ProseMirror doc (`type: "doc"`, chips +
prose interleaved) — only the chip nodes get lighter.

### Why this needs no schema bump and no migration

`migrateStoredDoc` was _built_ to load atom-shaped chips ("Older docs stored
taskRef as an atom node (no `content` array)") — it backfills `content` from the
task cache and defaults `isDone`. `refreshChipContentFromCache` then overwrites
both unconditionally. So a bare-atom chip flows through the **existing,
unchanged** load pipeline correctly, and the change is **bidirectionally
compatible**:

- A **v1 client** reading a Phase-1 blob: `migrateStoredDoc` backfills the
  stripped chips — loads fine. No future-version guard tripped.
- A Phase-1 client reading a **legacy** blob: content-bearing chips pass through
  `migrateStoredDoc` (`hasContent` true) and are refreshed as before.

`STORAGE_VERSION` stays `1`. No per-entry migration, no cross-version handling,
no `background.ts` change.

### The strip is applied only to the serialized copy

`stripChipContent` operates on a **copy** — `editor.getJSON()` returns a fresh
object each call. The live `editor` document keeps its inline chip content, so
the title-editing path (`reconcileTitlesFromDoc`, which reads the _live_ doc) is
untouched. Only the bytes written to storage shrink.

### Files

| File                        | Change                                                                                                                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/doc-transform.ts`      | Add pure `stripChipContent(doc): unknown` — walk content, replace each `taskRef`/`subTaskRef` node with `{ type, attrs: { taskId } }`, leave every other node (paragraphs, headings, lists — their text!) untouched. |
| `src/ui/editor.ts`          | `flushSave` **and** `flushSaveSync` persist `stripChipContent(editor.getJSON())` instead of `editor.getJSON()`. No other change.                                                                                     |
| `src/doc-transform.spec.ts` | Test `stripChipContent` (chips emptied, prose intact); round-trip test (`stripChipContent` → `prepareStoredDoc` rebuilds full chips with titles); legacy content-bearing doc still loads.                            |
| `src/background.ts`         | No change — it treats `docs` as opaque and only writes `enabledCtxIds`.                                                                                                                                              |

### Expected reduction

A content-bearing chip with a typical title serialises to ~120–140 bytes; a
bare-atom chip is ~60–65 bytes (`taskId` is a 21-char nanoid). For a task-heavy
context (~60 chips) that is ~5 KB saved per doc; for a typical 5-context user
the per-op blob drops roughly 20 KB → ~12 KB. Multiplied across the op-log
retention window (up to 500 ops), that is a meaningful cut to IndexedDB volume
and sync transfer. Op _count_ is unchanged (the throttles are untouched) — this
is purely a per-op _size_ reduction.

### Alternative considered — prose-only storage (rejected for now)

A heavier option drops chips from storage entirely, persisting only
`{ leading, anchored }` prose blocks and regenerating chips on load. It saves a
further ~7 KB/op for the 5-context user, but needs two new transform functions,
a parallel data structure, a `STORAGE_VERSION` bump, per-entry v1→v2 migration,
cross-version handling, and a `background.ts` version-constant fix. For an
opt-in POC plugin that is disproportionate. Phase 1 (bare-atom chips) captures
the bulk of the win at a fraction of the surface; prose-only can be revisited
if telemetry shows the blob is still too fat.

---

## Future work — per-context sync entities (host change, deferred)

> Tracked as
> [super-productivity/super-productivity#7749](https://github.com/super-productivity/super-productivity/issues/7749) —
> Stage A (keyed plugin-persistence API for per-context sync entities).
> Multi-reviewed design lives in
> [`2026-05-23-stage-a-keyed-plugin-persistence.md`](./2026-05-23-stage-a-keyed-plugin-persistence.md).
> The summary below remains accurate for problem 3's host-side scope.

This is the fix for **problem 3**. Deferred, not scheduled: document mode is
opt-in (users enable it per context) and Stage 0 already shipped, so the
size pressure is gone. Pick this up when cross-context conflicts are
observed in practice — see the linked plan for the full phased design.

It is **larger than "add a `key` parameter"** — the multi-review surfaced the
full scope:

1. **Plugin API** — add an optional `key` to `persistDataSynced` /
   `loadSyncedData`, threaded through the _entire_ chain: `plugin-api/types.ts`,
   `plugin-bridge.service.ts`, the iframe wrapper (`plugin-api.ts`), and the
   iframe postMessage util (`plugin-iframe.util.ts`) — which currently drops a
   second argument.
2. **Composite entity id** — `PluginUserData.id` becomes `pluginId:key` so each
   `(plugin, context)` is its own sync entity; concurrent edits to different
   contexts stop conflicting.
3. **Virtual-entity LWW** — _required, not optional._ Per-context entity ids do
   **not** by themselves fix problem 3: `getCurrentEntityState` still has no
   `virtual` branch, so same-context conflicts still mis-resolve. Conflict
   resolution must learn to read a virtual entity (`PLUGIN_USER_DATA`) from
   `selectPluginUserDataFeatureState`.
4. **Rate-limit & size-cap semantics** — `PluginUserPersistenceService` keys its
   coalesce/throttle Maps by id; per-key keys weaken the per-plugin flood guard
   (`MIN_PLUGIN_PERSIST_INTERVAL_MS`) and make `MAX_PLUGIN_DATA_SIZE` per-key.
   Keep an additional per-_plugin_ aggregate cap so a many-keyed plugin cannot
   bypass the limits.
5. **Uninstall cleanup** — `removePluginUserData(pluginId)` deletes only the
   exact id; keyed entries `pluginId:*` would leak. Make deletion prefix-aware.
6. **`background.ts`** must move off the keyless API (e.g. `key: 'meta'` for
   `enabledCtxIds`) or it desyncs from the editor's meta entity.
7. **Migration** — split the legacy single blob into per-key entities, one-time
   and idempotent (guard on the meta key's existence).

Residual after this work: concurrent edits to the **same** context still resolve
whole-doc — acceptable per Non-goals.

---

## Risks

| Risk                                                                                              | Mitigation                                                                                                                                                |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrateStoredDoc` / `refreshChipContentFromCache` stop backfilling → stripped chips render empty | Both are existing load-pipeline invariants with spec coverage; add a round-trip test that a stripped doc rebuilds full chips.                             |
| Strip accidentally mutates the live editor doc or non-chip text                                   | `stripChipContent` is pure and runs on the `getJSON()` copy; only `taskRef`/`subTaskRef` nodes are altered. Unit-test both.                               |
| A chip stripped to empty content is written back to the host as a title erasure                   | Cannot happen — write-back (`reconcileTitlesFromDoc`) reads the _live_ editor doc, which always has refreshed content; only the storage copy is stripped. |

## Testing

- `npm --prefix packages/plugin-dev/document-mode test` (esbuild + `node --test`).
- `npm run test:file packages/plugin-dev/document-mode/src/doc-transform.spec.ts`.
- Manual: type prose + toggle done states, reload, switch context and back —
  chips show correct titles/done state, prose keeps its position.

## Open question

1. Phase 1 only, or schedule the Future-work block? Recommendation: Phase 1 now
   (low-risk, no schema break); treat Future work as a documented known
   limitation until the plugin is bundled by default.
