# Wire `PluginHooks.PERSISTED_DATA_CHANGED`

**Status:** proposal (post multi-review v2)
**Date:** 2026-05-23
**Trigger:** Multi-review of `199e816479` flagged that document-mode's
editor goes stale on remote `PLUGIN_USER_DATA` updates because nothing
notifies the plugin. The hook `PluginHooks.PERSISTED_DATA_UPDATE` is
declared in `packages/plugin-api/src/types.ts:24` but never dispatched
on the host side (grep of `src/app/` confirms zero hits).
**Related:** [Stage A plan](./2026-05-23-stage-a-keyed-plugin-persistence.md)
risks table — same staleness gap, Stage A does not fix it on its own.

## TL;DR

Fire the dead hook. This PR ships the **host capability only** — the
selector subscription, the per-plugin dispatch, the enum rename, the
API contract. Document-mode's adoption (banner UX, dirty tracking,
selection preservation) is tracked separately and ships after this
groundwork has baked: see "Follow-up: document-mode adoption" below.

Host mechanism: a selector subscription in `PluginHooksEffects` on
`selectPluginUserDataFeatureState`. Skipped during the sync window
(SYNC_IMPORT / BACKUP_IMPORT replace state wholesale — semantically a
reload, not a change). No cache, no payload, no separate delete hook.
Plugins receive a `void` signal and re-call `loadSyncedData()` to get
fresh data. Rename the enum entry to `PERSISTED_DATA_CHANGED` for
consistency with sibling hooks (`*_CHANGE`); the rename is free since
nothing fires the hook today.

Estimated 3–4 hours including specs.

## Goal

Plugins get a notification when their persisted data changes for any
reason **other than wholesale state replacement** (SYNC_IMPORT,
BACKUP_IMPORT, app boot). Local user write, remote sync-apply, and
cross-tab writes all fire.

## Non-goals

- Auto-refreshing plugin UIs. Host fires the hook; plugin decides.
- Distinguishing "local" from "remote" in the payload. Plugin handlers
  are required to be idempotent; if a plugin writes and then receives
  its own change-event, re-reading and re-rendering is harmless.
  (Reviewer 3's `source` flag was considered and rejected as YAGNI —
  re-add only if a real plugin needs to discriminate.)
- A separate `PERSISTED_DATA_DELETED` hook. No plugin-callable delete
  API exists today; the only fire path would be on uninstall when the
  plugin is being torn down and can't usefully react. YAGNI.
- Replay-on-register. Plugin contract is "call `loadSyncedData()` on
  init for fresh state, then `registerHook(...)` for subsequent
  changes." Explicit, no surprise.
- Throttling. The persistence service already coalesces local writes
  to ≥ 1 op/sec per plugin; sync apply is event-driven, not flooded.

## Design

### The selector effect

In `src/app/plugins/plugin-hooks.effects.ts`, parallel to the existing
hook effects but **selector-based, not action-based**. Action-based
effects inject `LOCAL_ACTIONS` (sync rule 1, `:55`) and would miss
remote upserts which arrive through `bulkApplyOperations` (see
`src/app/op-log/apply/bulk-hydration.meta-reducer.ts`) — the action
type is the bulk wrapper, not `upsertPluginUserData`, so an
`ofType(upsertPluginUserData)` filter never fires for remote ops. The
state still changes, so a state-selector subscription does observe it.

> Note: this is a *new pattern* in the codebase. The existing
> `PROJECT_LIST_UPDATE` effect at `plugin-hooks.effects.ts:341` is
> action-based, not selector-based, and is consequently blind to
> remote project changes (likely a latent bug, not this PR's problem).
> Earlier draft incorrectly cited it as precedent.

Skeleton:

```ts
firePersistedDataChanged$ = createEffect(
  () =>
    this.store.pipe(
      select(selectPluginUserDataFeatureState),
      startWith([] as PluginUserData[]),  // determinism for pairwise
      pairwise(),
      skipDuringSyncWindow(),             // see "Sync window" below
      map(([prev, next]) => diffChangedPluginIds(prev, next)),
      filter((ids) => ids.length > 0),
      switchMap((ids) =>
        from(ids).pipe(
          tap((pluginId) =>
            this.pluginService.dispatchHookToPlugin(
              pluginId,
              PluginHooks.PERSISTED_DATA_CHANGED,
            ),
          ),
        ),
      ),
    ),
  { dispatch: false },
);
```

### `diffChangedPluginIds`

Pure function. Compares `prev` and `next` arrays by both id-membership
and `data` field. Returns the set of pluginIds where:

- `id` is present in `next` but not `prev` (added), OR
- `id` is present in both but `data` differs (updated), OR
- `id` is present in `prev` but not `next` (deleted)

Encoding is deterministic (gzip + base64; verified — same input →
identical bytes), so a no-op local write that round-trips through the
service produces identical `data` strings and is correctly skipped by
the differ. **No separate dedupe cache is needed.** The differ alone
suppresses self-echoes from no-op writes; for writes that *do* change
data, the plugin's own handler firing is harmless and idempotent per
contract.

### Sync window

`skipDuringSyncWindow()` (sync rule 2) is the right operator here, but
the reasoning is non-obvious:

- The operator suppresses emissions during SYNC_IMPORT / BACKUP_IMPORT
  application windows. These replace state wholesale; firing a hook
  per plugin would (a) flood plugin handlers with what semantically is
  a reload, not a change, and (b) cause reentrancy where a handler's
  response-write commits against stale in-memory plugin state.
- It does **not** suppress regular incremental sync apply (per-op
  remote upserts via `bulkApplyOperations`). Those land outside the
  sync window and correctly fire the hook.

After SYNC_IMPORT the plugin re-initialises via the normal load path,
which itself calls `loadSyncedData()` — semantically equivalent to
"every plugin gets a fresh-state event." No separate signal needed
yet; revisit if a plugin asks for `SYNC_IMPORTED` explicitly.

`require-hydration-guard` lint rule will accept `skipDuringSyncWindow()`
without further action.

### Per-plugin dispatch

`PluginHooksService.dispatchHook` (`plugin-hooks.ts:34-57`) currently
fans out to **all** registered handlers for a hook. For per-plugin
data, we want only the affected plugin's handler. Add:

```ts
// plugin-hooks.ts
async dispatchHookToPlugin<T extends Hooks>(
  pluginId: string,
  hook: T,
  payload?: HookPayloadMap[T],
): Promise<void> {
  const handler = this._handlers.get(hook)?.get(pluginId);
  if (!handler) return;
  // Same 5 s timeout pattern as dispatchHook.
}
```

JSDoc both methods so the asymmetry is clear: `dispatchHook` is fan-out
(task / project / language events affect all plugins); `dispatchHookToPlugin`
is scoped (data events are per-owner).

Expose on `PluginService` as `dispatchHookToPlugin(pluginId, hook, payload?)`,
mirroring the existing `dispatchHook` passthrough at
`plugin.service.ts:1042-1048`.

### Payload

`void`. The plugin's handler is already scoped to its plugin id (it
registered with that id; `dispatchHookToPlugin` routes by id; the
handler runs in the plugin's own context where the id is implicit).
Update `PersistedDataUpdatePayload` accordingly — see "API surface
changes."

### API surface changes

In `packages/plugin-api/src/types.ts`:

- Rename enum entry: `PERSISTED_DATA_UPDATE` → `PERSISTED_DATA_CHANGED`.
  Value string changes from `'persistedDataUpdate'` to
  `'persistedDataChanged'`. Pre-emptive grep confirmed no plugin imports
  the type or references the value (only the enum entry exists, and the
  bundled `sync-md/plugin.js` references the enum name only). Safe to
  rename.
- Remove `PersistedDataUpdatePayload` (or alias it to `void` if there
  are external `@super-productivity/plugin-api` consumers; check
  `packages/plugin-api/README.md` for any documented public contract).
  Update `HookPayloadMap[PluginHooks.PERSISTED_DATA_CHANGED]` to `void`.
- Add to `packages/plugin-api/README.md` one paragraph:

  > **`PERSISTED_DATA_CHANGED`** fires when this plugin's persisted
  > data has changed for any reason other than full app state replacement
  > (SYNC_IMPORT, BACKUP_IMPORT, app boot — which the plugin handles
  > via the normal init load). Handler receives no payload; re-call
  > `loadSyncedData()` to get fresh data. Contract: call
  > `loadSyncedData()` on plugin init for the initial state; then use
  > this hook for subsequent changes. There is no replay-on-register
  > and no guaranteed ordering across rapid changes. Handlers must be
  > idempotent.

## Follow-up: document-mode adoption (separate PR / issue)

Tracked at [super-productivity#7752](https://github.com/super-productivity/super-productivity/issues/7752).
Blocked on this PR landing.

Scope of the follow-up — surfaced by the v3 multi-review (cut from
this PR to keep host work small and reviewable):

- **`background.ts`** — register the hook handler, re-run `loadState()`,
  reconcile `enabledIds` and current-context visibility.
- **`ui/editor.ts`** — register the hook handler, branch on
  "current-context doc unchanged / clean editor / dirty editor."

Critical correctness notes for the follow-up implementer (do not lose
these):

1. **Use the existing dirty signal**, not a new transaction flag.
   `editor.ts:327` already has `saveTimer !== null || saveInFlight` as
   the dirty predicate; reuse it. A new flag risks 1-keystroke-shows-banner
   misfires given `SAVE_THROTTLE_MS = 30_000` (`editor.ts:47`).
2. **`editor.commands.setContent` destroys selection + history.** A
   silent swap as written is a stealth cursor-jump bug. Snapshot
   `editor.state.selection` before and restore after, guarded by
   doc-size bounds. Or use `replaceWith` against the doc range.
3. **The hook does not deliver to a not-yet-mounted editor.** When
   the user is on Project A and Project B updates remotely, then
   switches to B → editor mounts → registers hook → never receives the
   update (no replay-on-register). The fix: have `setActiveContext`
   always call `readBlob()` for the freshly-active context, independent
   of the hook. The hook only fixes the "remote update lands while the
   editor is already open on that context" case.
4. **A bare reload-only banner does not prevent the LWW clobber** — it
   just makes the user aware. Two real choices, pick one:
   (a) two-button banner "Reload (discard local) / Keep mine (force-flush
       and win LWW deliberately)";
   (b) gate `flushSave` while banner is up — saves pause until user
       resolves.
   Recommend (a) — gives the user agency and matches the conflict-resolver
   mental model.
5. **Coalesce multiple hook fires** with a ~250 ms trailing timer.
   Five remote updates in 10 s should not be five silent swaps (each a
   cursor jump + history wipe even with #2's selection restore).
6. **Tests:** specs that require driving ProseMirror in `node --test`
   are blocked — current infrastructure (`doc-nav.spec.ts` etc.) uses
   hand-rolled `DocLike`, no jsdom/tiptap. Refactor the branch logic
   into a pure `decideRemoteUpdateAction(remoteDoc, localDoc, isDirty)`
   function and unit-test that. Manual-verify the actual `setContent`
   call in the iframe, or add a Playwright E2E.

Estimated ~6 hours for the doc-mode side, of which 2–3 h is the banner
UX + selection handling.

## Plugin contract

- Handler is `() => void | Promise<void>`.
- Handlers must be idempotent. Hook may fire multiple times per
  user-visible change due to throttle / apply interactions.
- Hook does **not** fire during SYNC_IMPORT / BACKUP_IMPORT / app boot.
- Hook may fire on the plugin's own writes (when those writes change
  the data). Re-reading is the expected response either way; the cost
  is bounded.
- No replay on register: any change between init and `registerHook` is
  not delivered. Plugins read fresh on init.

## Test plan

In `plugin-hooks.effects.spec.ts`:

1. **Local change fires.** Plugin dispatches `upsertPluginUserData`
   with new data; effect fires hook for that pluginId.
2. **No-op state emission does not fire.** Same data in equals same
   data out; differ returns no ids; no fire.
3. **Remote change fires.** Simulated `bulkApplyOperations` with
   PLUGIN_USER_DATA payload changes the state; effect fires hook.
4. **Multi-plugin isolation.** Plugin A's change does not fire plugin
   B's handler; only the affected pluginId's handler runs.
5. **SYNC_IMPORT suppressed.** Within the sync window, state replacement
   does not fire the hook. Verify via `skipDuringSyncWindow` test
   harness used by other selector effects.
6. **Delete fires.** Entry removed from state → differ detects id
   missing in `next` → fire hook for that pluginId. (The handler will
   call `loadSyncedData()` and receive `null`; that's the delete
   signal.)
7. **Read-your-writes inside handler.** Plugin's handler synchronously
   calls `loadPluginUserData(pluginId)`; gets the value the host just
   committed (existing `_committing` / `_pendingData` path,
   `plugin-user-persistence.service.ts:206-233`).

In `plugin-hooks.spec.ts`:

8. **`dispatchHookToPlugin` filters correctly.** Registers two
   plugins' handlers; dispatch to one fires only one handler;
   non-registered pluginId is a no-op (no error).

(Plugin-side specs live in the follow-up issue's PR, not here.)

## Risks

| Risk | Mitigation |
| --- | --- |
| `skipDuringSyncWindow` mis-applied — suppresses legitimate remote ops outside the SYNC_IMPORT window | Verify operator semantics in `src/app/util/skip-during-sync-window.operator.ts` before coding; spec #3 + #5 distinguish the two cases. |
| Hook reentrancy: handler calls `persistDataSynced`, which triggers another emission | Persistence service already serializes per-plugin via `_commitChain` (`plugin-user-persistence.service.ts:62`); handler's write awaits its own commit. Hook fire is `tap`-based (fire-and-forget), so emissions are not blocked by slow handlers. Ordering across rapid emissions is not guaranteed — document on the contract. |
| `pairwise` swallows first emission | `startWith([])` prepends an empty array so the first real state IS the second emission and `pairwise` yields `[[], firstState]`. Matches the `onCurrentTaskChange$` pattern at `plugin-hooks.effects.ts:94`. |
| Plugin uninstall / re-register leaves stale handlers | Existing `unregisterPluginHooks` (`plugin-hooks.ts:65-68`) already clears all hooks per plugin. No additional work. |
| Cross-tab "self-echo" | Tab B legitimately sees Tab A's write as remote — there is no self-echo to defend against. Spec the case as part of test #3. |

## Out of scope

- **Document-mode adoption.** Tracked separately (see "Follow-up"
  section above). The host hook ships first; doc-mode adopts in its
  own PR after this groundwork bakes.
- **All other plugins' adoption** (sync-md, automations, brain-dump,
  ai-productivity-prompts). Same pattern — host hook ships, each
  plugin opts in on its own timeline with its own UX decisions.
- `PERSISTED_DATA_DELETED` hook — no real consumer.
- `source: 'local' | 'remote'` payload flag — YAGNI; idempotent contract
  is enough; revisit if a plugin needs the discriminator.
- Cross-context concurrent-edit data loss (LWW collapsing different-
  context edits onto one whole-blob entity). Stage A's territory.
- Same-context concurrent-edit conflict resolution. Still whole-doc
  LWW. CRDT territory (Stage C, deferred indefinitely).
- Stage A keyspace interaction. When Stage A lands, revisit whether the
  payload needs a `key` (the `pluginId` argument to `dispatchHookToPlugin`
  becomes a composite id and the plugin can parse it). Until then, the
  hook fires once per pluginId, period.
- Throttling. The persistence service rate-limits writes; sync apply is
  event-driven. If a real flood appears in practice, add throttling
  then.
- `BACKUP_IMPORT` distinction from `SYNC_IMPORT`. Both are suppressed by
  the same sync-window operator; same rationale applies.

## Implementation order

1. `plugin-hooks.ts` — add `dispatchHookToPlugin`. ~15 LOC + JSDoc.
2. `plugin.service.ts` — passthrough `dispatchHookToPlugin`. ~5 LOC.
3. Helper file (`plugin-data-diff.util.ts` or inline in the effects
   file) — `diffChangedPluginIds(prev, next): string[]`. Pure. ~20 LOC.
4. `plugin-hooks.effects.ts` — the effect per "Skeleton" above. ~20 LOC.
5. `packages/plugin-api/src/types.ts` — rename enum entry; payload to
   `void`. ~3 LOC.
6. `packages/plugin-api/README.md` — one paragraph per the snippet
   under "API surface changes."
7. Specs per the test plan.

Total: ~80 LOC + specs. Realistic estimate **3–4 hours** end to end.

## Changelog

- 2026-05-23 v1 — initial proposal: per-pluginId cache in persistence
  service, encoded-data payload, separate `PERSISTED_DATA_DELETED`
  hook, document-mode adoption in same PR. Multi-reviewed.
- 2026-05-23 v2 — cut and reframed per multi-review:
  - Removed the dedupe cache: differ alone is sufficient because
    encoding is deterministic (Reviewer 2).
  - Renamed enum to `PERSISTED_DATA_CHANGED` for consistency with
    `*_CHANGE` siblings (Reviewer 3).
  - Payload simplified to `void` (Reviewer 2 + 3).
  - Dropped `PERSISTED_DATA_DELETED` (all three reviewers).
  - SYNC_IMPORT explicitly suppressed via `skipDuringSyncWindow`
    (Reviewer 1 + 2). Reasoning documented; rule 2 satisfied.
  - Dropped false `PROJECT_LIST_UPDATE` precedent citation; selector
    approach presented on its own merits (Reviewer 1).
  - Added `startWith([])` for `pairwise` determinism (Reviewer 1).
  - Differ clarified as id-membership + data comparison; deletes
    detected from array structure (Reviewer 1).
  - Document-mode adoption split out as a separate change (Reviewer 2).
  - Stage A reasoning stripped to a one-liner (Reviewer 2).
  - Estimate corrected to 3–4 hours (Reviewer 2).
- 2026-05-23 v3 — re-folded document-mode adoption back into scope per
  user request. Reason: shipping the host hook alone delivers no
  user-visible benefit; the staleness gap remains until the plugin
  adopts. Bundling them in one PR avoids re-litigating the banner UX
  later. Added explicit `background.ts` and `ui/editor.ts` adoption
  sections, banner UX rationale ("no auto-replace when dirty"),
  plugin-side specs (#9–13), and the deploy step. Estimate revised to
  6–8 hours.
- 2026-05-23 v4 — split scope. User clarified: this PR should be the
  groundwork (better plugin-data sync handling); doc-mode adoption
  is a separate GitHub issue to start after groundwork lands. v3
  multi-review surfaced doc-mode UX blockers (`setContent` destroys
  selection; mount race; bare reload-only banner doesn't prevent
  clobber) which are now seeds for the follow-up issue rather than
  fixes attempted here. Restored host-only scope; estimate back to
  3–4 hours. Doc-mode adoption notes preserved in "Follow-up" section
  so the follow-up implementer starts from the multi-reviewed
  insights, not a blank page.
