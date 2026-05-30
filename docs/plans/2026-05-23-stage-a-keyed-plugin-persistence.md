# Stage A — keyed plugin-persistence API for per-context sync entities

**Status:** **Phases 1, 3, 4 implemented 2026-05-23** (Phase 2 still deferred)
**Date:** 2026-05-23
**Issue:** [super-productivity#7749](https://github.com/super-productivity/super-productivity/issues/7749)
**Predecessor:** [`2026-05-22-document-mode-sync-data-model.md`](./2026-05-22-document-mode-sync-data-model.md) (Stage 0 — gzip + throttle, shipped)

## Implementation status

| Phase                                                      | Status                      | Commits                 |
| ---------------------------------------------------------- | --------------------------- | ----------------------- |
| Phase 1 — keyed API end-to-end                             | Implemented                 | `b628ec5eec`            |
| Phase 2 — `EntityAdapter` conversion                       | Deferred (not load-bearing) | —                       |
| Phase 3 — host-side cleanup (Option A)                     | Implemented                 | `b628ec5eec`            |
| Phase 4 — document-mode migration                          | Implemented                 | `4cd60ca852`            |
| Boundary tightening (review fixes)                         | Implemented                 | `79d7558ae8`            |
| Per-write cap reduced 1 MB → 256 KB                        | Implemented                 | `0aac34f581`            |
| E2E migration coverage                                     | Implemented                 | `103f6d582e`            |
| Migration `attemptedAt` + `detectStaleLegacyWrite` cleanup | Implemented                 | _(follows this commit)_ |

Behavior change worth noting on release: `removePluginUserData` now
no-ops when no matching entries exist in local state, instead of
emitting a phantom Delete op for the bare pluginId. Pre-Stage-A that
phantom propagated to peers via sync; post-Stage-A, per-device
uninstall is a local decision. Users who expect uninstall on Device A
to also clear data on Device B should uninstall on each device.

## TL;DR

Document-mode was unregistered from bundled plugins
(`b0cae69ffe`) and is being re-bundled **without** Stage A: opt-in usage

- Stage 0 (~75× wire-payload reduction) + the existing in-plugin
  migration runway are judged enough for the initial bundled rollout. The
  remaining cross-context concurrent-edit conflict at the LWW layer is the
  gap this plan closes, and it's picked up when real users hit it.

The shipping unit, when picked up, is Phase 1 + Phase 3 + Phase 4 in
one release window. Phase 2 (`EntityAdapter`) stays deferred unless a
profiler shows otherwise. Phase 0 telemetry stays cut — explained under
"Out of scope."

No code changes are recommended ahead of Phase 1. (An earlier draft
proposed a "one-line safety net" extending `deletePluginUserData`'s
reducer to sweep `pluginId:*`. Reconsidered and dropped: locally it
would sweep, but the op-log captures one Delete op for `pluginId`
only — remote replicas would still hold keyed entries. False security.
Phase 1 must do proper N-action cleanup via the service, not a reducer
trick.)

## Keyspace contract (frozen here, not in code yet)

When Phase 1 lands, `composeId(pluginId, key?)` must obey:

- `composeId(pluginId, undefined) === pluginId` (legacy form preserved).
- `composeId(pluginId, key) === pluginId + ':' + key` for any non-empty
  `key` not containing `:`.
- Empty `key` (`''`) is treated as `undefined`; no distinct error. Reviewer
  consensus: a separate `InvalidPluginPersistenceKey` for the empty case
  is over-precision.
- `composeId` **throws synchronously** if `pluginId` itself contains `:`.
  This is the only enforcement that survives "the plugin was installed
  before validation existed" — registration-time validation alone misses
  user-installed plugins (verified: no provenance check on startup).

The delimiter `:` is the issue's suggestion; verified clean against the
in-tree plugins (`packages/plugin-dev/*/manifest.json` grep — none use
`:` in their ids).

## Phase 1 — keyed API end-to-end (design sketch)

Forward and backward compatible at the storage layer because the reducer
(`plugin-user-data.reducer.ts:19-25`) is purely id-keyed and pattern-
agnostic — a pre-Stage-A client replicates and stores `pluginId:key`
entries inertly without code to read them. (Verified.)

### 1.1 Public API surface

- `packages/plugin-api/src/types.ts:555-557`:
  ```ts
  persistDataSynced(dataStr: string, key?: string): Promise<void>;
  loadSyncedData(key?: string): Promise<string | null>;
  ```

### 1.2 iframe wrapper — pass the key

- `src/app/plugins/util/plugin-iframe.util.ts:365-367`: wrappers declare
  `(data) =>` and never read a second arg. `callApi(name, args)` already
  forwards the array transparently:
  ```ts
  persistDataSynced: (data, key) => callApi('persistDataSynced', [data, key]),
  loadPersistedData: (key) => callApi('loadPersistedData', [key]),
  loadSyncedData: (key) => callApi('loadPersistedData', [key]),
  ```

### 1.3 Host bridge — thread + validate

- `src/app/plugins/plugin-bridge.service.ts:239-240, :1034-1065`: bound
  methods accept `(data, key?)`. `composeId` is called here (transport
  layer) so the same validation covers iframe and direct callers.

### 1.4 Persistence service — composite id, same Maps

- `src/app/plugins/plugin-user-persistence.service.ts`: all internal
  `Map<string, …>` are already keyed by what we currently call `pluginId`.
  Re-key by `composeId(pluginId, key)`. No structural change.
- `removePluginUserData(pluginId)` is **rewritten in Phase 3**, not in
  Phase 1. See Phase 3 for the correct mechanism. In Phase 1 it still
  dispatches a single `deletePluginUserData({ pluginId })`, which now
  only removes the legacy entry — keyed entries leak if Phase 3 hasn't
  landed yet. That's why Phase 1 and Phase 3 ship together.

### 1.5 Rate-limit & size-cap

- Keep `MIN_PLUGIN_PERSIST_INTERVAL_MS` and `MAX_PLUGIN_DATA_SIZE` enforced
  per **composite id** (mechanical re-key of the current Map).
- **No per-plugin aggregate cap.** Originally proposed; multi-review
  rejected it on two grounds: (a) YAGNI — no real-world threat; (b) the
  proposed running-total check is racy across the async compression
  boundary in `_encodeAndDispatch` (two concurrent persists with
  different keys both pass the synchronous check then both succeed). If
  a real abuse case appears later, the correct fix is a per-pluginId
  commit chain (mirror `_commitChain` but scoped to pluginId), not an
  unserialized running total.

### 1.6 Tests

- Composite-id round-trip; throws on `pluginId` containing `:`.
- Two distinct keys → two distinct ops with distinct `entityId`s.
- Keyless `loadPluginUserData(pluginId)` still hits the legacy entry.
- iframe → host carries the key in `postMessage` payload.
- Regression: existing `plugin-user-persistence.service.spec.ts` —
  read-your-writes, generation counter, commit chain.

(Tests for the cleanup mechanism move to Phase 3.)

## Phase 2 — `EntityAdapter` conversion (deferred indefinitely)

Current reducer is a 28-LOC array with `findIndex`/`filter`. The issue
flagged O(N) regression at scale. **Verdict from multi-review:** still
not the bottleneck.

- `findIndex` runs on every reducer match, _including_ sync replay via
  `bulkApplyOperations`, SYNC_IMPORT, validateAndFix sweeps. With 500
  entries this is still sub-millisecond per op; a 1000-op replay touches
  it ≤ 1000× → < 1 s of accumulated cost. Not load-bearing.
- Revisit if and only if NgRx devtools profiler shows the reducer in the
  hot path with realistic post-Phase-1 data. Conversion itself is
  mechanical (`createEntityAdapter` swap + selectors + spec rewrite).

## Phase 3 — host-side cleanup of `pluginId:*`

Ships with Phase 1. Without it, every uninstall (or full clear) leaks
keyed entries on remote devices.

### Why a reducer-only "prefix match" doesn't work

Verified against `operation-capture.service.ts:135-158`: the op-log
captures one op per _dispatched action_, not per state mutation. A
reducer that sweeps multiple ids in response to a single
`deletePluginUserData({ pluginId })` emits one Delete op for `pluginId`
only — remote replicas keep the keyed entries. Reviewer 1 caught this
in the original design (a meta-reducer fan-out) and it applies equally
to a "smart reducer" shortcut. Don't take it.

### Two correct mechanisms, choose at implementation time

**Option A — N dispatched actions (mirrors `clearAllPluginUserData`).**
The service reads current state, filters by
`item.id === pluginId || item.id.startsWith(pluginId + ':')`, and
dispatches one `deletePluginUserData({ pluginId: item.id })` per match,
then `await new Promise(r => setTimeout(r, 0))` per CLAUDE.md sync rule 6. Each dispatch produces one Delete op; remote replay reconstructs the
full sweep. Pattern already exists at
`plugin-user-persistence.service.ts:268-277`.

**Option B — one action carrying `entityIds: string[]`.** A new
`cleanupPluginUserData({ pluginId, entityIds })` action whose `meta`
declares plural `entityIds`. The op-log capture path supports this
(`operation-sync.util.ts:67`, `operation-converter.util.spec.ts:70-74`,
matches the existing `batchUpdateForProject` pattern). Single dispatch,
single op carrying the list, replays atomically on remote sides.

Recommended: **Option A** for first-cut implementation. It re-uses an
existing action shape and an existing pattern in the same service file.
Option B is structurally cleaner but adds a new action + entity-registry
consideration; defer until profiling or correctness pushes for it.

### Tests

- 3 keyed + 1 legacy entry for `pluginA`; cleanup removes all 4;
  `pluginB`'s entries untouched.
- Mock op-log capture verifies 4 Delete ops emitted (Option A) or 1
  Delete op with `entityIds.length === 4` (Option B).
- Read-after-cleanup via `loadPluginUserData(pluginA, 'k')` returns
  `null`.
- Concurrent `persistPluginUserData` mid-cleanup: the generation counter
  in the service must invalidate the in-flight commit (existing
  mechanism — confirm it still triggers per composite id, not just per
  pluginId).

## Phase 4 — migration of the legacy single-blob entry

Affects every installed document-mode user (manual installers and the
larger bundled-rollout cohort, both of whom have legacy single-blob
entries). Ships with whatever release introduces Phase 1.

### Strategy

Plugin-side, not host-side. The host's job is to not break.

```ts
async function migrateToKeyedPersistence(): Promise<void> {
  // Step 1: stamp the attempt FIRST (Reviewer 3 finding 7).
  const meta = await PluginAPI.loadSyncedData('__meta__');
  const parsedMeta = meta ? JSON.parse(meta) : null;
  if (parsedMeta?.migrated === 1) return;

  const legacy = await PluginAPI.loadSyncedData(); // keyless = legacy
  if (!legacy) {
    await PluginAPI.persistDataSynced(JSON.stringify({ migrated: 1 }), '__meta__');
    return;
  }

  await PluginAPI.persistDataSynced(
    JSON.stringify({ migrated: 0, attemptedAt: Date.now() }),
    '__meta__',
  );

  // Step 2: split.
  const parsed = JSON.parse(legacy);
  for (const [ctxId, doc] of Object.entries(parsed.docs ?? {})) {
    await PluginAPI.persistDataSynced(JSON.stringify(doc), `doc:${ctxId}`);
  }
  await PluginAPI.persistDataSynced(
    JSON.stringify({ enabledCtxIds: parsed.enabledCtxIds ?? [] }),
    'meta',
  );

  // Step 3: delete legacy entry + stamp success.
  // A keyless persist of an empty payload is interpreted as
  // "tombstone the legacy entry" — see below.
  await PluginAPI.persistDataSynced('', undefined); // legacy = tombstone
  await PluginAPI.persistDataSynced(JSON.stringify({ migrated: 1 }), '__meta__');
}
```

### Why an explicit legacy tombstone, not "read both"

Original mitigation 1 ("read both, prefer most-recent") **does not work**
under LWW. Verified: `PLUGIN_USER_DATA` is `storagePattern: 'array'`
(`entity-registry.ts:331`), LWW resolves per-`entityId`, and the legacy
entry and `pluginId:doc:p1` have **different entityIds** → they don't
LWW-conflict. They coexist forever, and an offline edit to the legacy
blob on Device B sits there indefinitely with no host-side mechanism to
prefer one over the other.

Tombstoning the legacy entry (an empty payload, which the plugin's read
path treats as "ignore") gives LWW a winning side: Device B's offline
edit to the legacy blob is _guaranteed_ to lose against the tombstone if
the tombstone's timestamp is later. If B's edit is later, the user keeps
that edit (which is the same data the migration was about to split) —
acceptable.

Note: "empty payload as tombstone" is plugin-side convention, not a host
primitive. The host stores an `id` with empty `data`; reads return the
empty string; the plugin treats `''` as "no legacy data". The
alternative is an explicit `removePluginUserData` from inside the plugin
— not exposed today and a bigger API change than the migration warrants.

### Partial-failure recovery

The `migrated: 0, attemptedAt` stamp lets a retry detect a previously
crashed migration. On resume:

- If any `pluginId:doc:*` entries exist with `lastModified > attemptedAt`,
  another device already migrated concurrently — bail and just stamp
  `migrated: 1` locally.
- Otherwise, re-run the loop. Each upsert is content-idempotent (same
  context → same doc), so re-running costs op-log budget but doesn't
  corrupt state.

### Cross-device version skew

Real for any user who lags app updates. The plugin should show a "this
device has older sync data, update on all devices" banner when it
detects a post-migration write to the legacy id. Plugin-side only; no
host work. Same shape as any plugin-format migration.

## Out of scope

- Per-edit CRDT (Yjs / Stage C).
- IndexedDB `(entityType, entityId)` compound index. The issue lists
  this as a prerequisite. Verified the current hot queries
  (`operation-log-store.service.ts:519, :955`) use
  `BY_SOURCE_AND_STATUS`, not "latest op per entity". If a hot path
  surfaces later, add the index in its own PR with a benchmark — not as
  part of this work.
- Per-plugin rate-limit aggregation (deferred; correct fix is per-pluginId
  commit chain, not running totals).
- Conflict telemetry. Originally proposed as Phase 0; cut. Reasons:
  (a) the in-memory counter is reset on every refresh, so it can't drive
  a release decision over the timescale needed;
  (b) a per-entity-type counter can't distinguish "same-context conflict"
  (where current LWW is correct) from "different-context conflict"
  (Stage A's actual motivation) — both classify as
  `PLUGIN_USER_DATA CONCURRENT`;
  (c) document-mode unbundling means the population we'd be measuring
  over is empty.
  If revived: persist daily-bucketed counts in localStorage **and** add
  a discriminator (e.g. "loser blob's top-level JSON keys disjoint from
  winner's").
- Changes to `PLUGIN_METADATA`.

## Risks

| Risk                                                                               | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keyed entries leak on uninstall if Phase 1 ships alone                             | Don't ship alone. Phase 1 + Phase 3 land together. A reducer-level prefix-match looks tempting but is wrong (local sweep without matching ops → remote replicas leak; see Phase 3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Cross-device version skew during Stage A rollout                                   | Plugin-side "older device detected" banner; documented limitation. Worse than v3's framing assumed — without bundling-gated-on-Stage-A, the skew window is "user updates the app whenever they update" plus the lag of users still on a pre-Stage-A release.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Stale editor view when a remote `PLUGIN_USER_DATA` op lands during an open session | Document-mode subscribes only to `WORK_CONTEXT_CHANGE`; the editor's in-memory `storedState` does not refresh on remote upserts to the plugin entity. The user keeps typing against stale data until they switch contexts or reload. **Stage A does not fix this** — it splits the entity but the editor would still need an upstream-change hook to refresh. Independent follow-up: `PluginHooks.PERSISTED_DATA_UPDATE = 'persistedDataUpdate'` already exists in `packages/plugin-api/src/types.ts:24` but is **never dispatched on the host side** (grep `src/app/`); wiring requires a store-subscription in `plugin-bridge.service.ts` (selector-based, since CLAUDE.md sync rule 1 forbids the `ALL_ACTIONS` effect that would otherwise see remote upserts). Comment in `background.ts` marks the spot. |
| User-installed third-party plugin with `:` in its id                               | `composeId` throws synchronously; existing keyless data path still works (it calls neither `composeId` nor the keyed API). The plugin's read of its own data is unaffected unless it tries to call the keyed API, in which case it sees a synchronous throw with a clear message.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Cross-device plugin version skew (Phase 4)                                         | Plugin-side banner; documented limitation. Same as any plugin-format migration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Op-log compaction storm during heavy multi-context editing                         | Real risk Phase 1 needs to handle: 50 keyed entries × ~1 op/sec each × `COMPACTION_THRESHOLD = 500` → compaction every ~10 s. Per-pluginId commit chain (deferred above) is the eventual fix. Until then, document-mode's SAVE_THROTTLE_MS (~2 s) holds the per-context rate well below 1/sec, so the projected storm is theoretical. **Monitor first.**                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Stage-A writer downgrades to pre-Stage-A client                                    | Keyed entries become silently invisible to the plugin (storage intact, read path returns nothing for keys). Acceptable for an opt-in plugin; document.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Phase 4 partial-failure                                                            | `migrated: 0, attemptedAt` stamp + content-idempotent upserts + cross-device "newer keyed entry exists" check.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Testing

- Phase 1: per §1.6.
- Phase 3: per the Phase 3 "Tests" subsection.
- Phase 4: integration test in `packages/plugin-dev/document-mode/` —
  legacy → migrated, second-run no-op, crash-then-resume, concurrent
  device migration, tombstoned-then-resurrected legacy edit.
- Regression: full `npm test` (both TZ variants).

## Changelog of this plan

- 2026-05-23 v1 — initial draft, six-phase rollout, telemetry-gated.
- 2026-05-23 v2 — multi-reviewed and cut. Three blockers fixed (meta-
  reducer mechanism, LWW mitigation, `composeId` enforcement boundary),
  Phase 0 telemetry dropped, Phase 1.5 size-cap dropped, document-mode
  unbundling acknowledged. Framed as deferred design sketch.
- 2026-05-23 v3 — re-framed as scheduled work: document-mode will be
  re-bundled once Stage A lands, so Stage A is the gate, not academic.
  Phase 3 un-folded from Phase 1 (the "one-line safety net" was false
  security — local sweep without matching ops would leak on remote
  replicas). Phase 3 now spells out two correct mechanisms (N
  dispatches vs. one action with `entityIds`), recommends Option A.
  Phase 4 framed as shipping with the re-bundling release.
  Cross-device skew downgraded to "bounded by update lag."
- 2026-05-23 v4 — re-bundling decision: document-mode is being
  re-bundled **without** Stage A (opt-in + Stage 0 + Phase-4-style
  in-plugin migration runway is enough). Stage A returns to
  "scheduled when conflicts become observable." Phase 3's correctness
  notes and Phase 4's strategy stay as-is (they're needed whenever
  Phase 1 lands). Cross-device skew framing reverted to v2's "real,
  not bounded by anything we control."
