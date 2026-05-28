# The Contributor Sync Model

**The one thing to understand before writing any effect, reducer, or bulk
dispatch that touches synced state.**

Super Productivity syncs by replaying an operation log. Almost every sync
correctness rule you will hit is a facet of a **single invariant**:

> ## One user intent = exactly one operation. Replayed and remote operations must never re-trigger effects.

Reducers **must** run for remote/replayed operations (that is how state is
rebuilt). Effects **must not** — the UI side effect (snack, sound, navigation)
already happened on the originating client, and any cascading change is already
its own entry in the operation log. Re-running effects on replay duplicates side
effects and emits phantom operations that conflict with sync.

Everything below is that invariant applied at three points.

---

## Boundary 1 — The action boundary

**Effects inject `LOCAL_ACTIONS`, never `inject(Actions)`.**

`LOCAL_ACTIONS` is the standard actions stream with `meta.isRemote` filtered
out (`src/app/util/local-actions.token.ts`). Remote/replayed operations are
applied as one `bulkApplyOperations` action; `LOCAL_ACTIONS` ensures your effect
only sees genuine local user intent.

- Default for **all** effects: `private _actions$ = inject(LOCAL_ACTIONS);`
- The only legitimate exception uses `ALL_ACTIONS` and handles `isRemote`
  itself: `operation-log.effects.ts` (captures/persists every action). You are
  almost certainly not adding a second.
- Remote **archive** side effects are _not_ an `ALL_ACTIONS` case:
  `archive-operation-handler.effects.ts` itself uses `LOCAL_ACTIONS`; the
  remote-client archive writes/deletes are driven separately by
  `OperationApplierService` → `ArchiveOperationHandler`.

✅ **Enforced by `local-rules/no-actions-in-effects`** — you cannot get this
wrong; the linter rejects `inject(Actions)` / `Actions` imports in
`*.effects.ts`.

## Boundary 2 — The selector boundary

**Selector-driven effects must guard with `skipDuringSyncWindow()`.**

An effect that reacts to a _selector_ (store state) instead of a specific
_action_ bypasses Boundary 1 entirely — it fires on every store change,
including hydration and sync replay. Two timing gaps (initial startup before
first sync; the post-sync re-evaluation window) make such effects emit
operations with stale vector clocks that immediately conflict.

- Use `skipDuringSyncWindow()` for selector-based effects that modify
  frequently-synced entities or perform "repair"/"consistency" work.
- The narrower `skipWhileApplyingRemoteOps()` /
  `HydrationStateService.isApplyingRemoteOps()` exist for finer control.
- **Prefer action-based effects.** A selector-based effect is the
  intuitive-but-usually-wrong choice; reach for it only when there is no
  action to key off.

✅ **Enforced by `local-rules/require-hydration-guard`** (existing rule).

## The atomicity rule — one intent, one op

**Multi-entity changes are meta-reducers, not effects. Bulk dispatch loops yield.**

- A change that touches more than one entity for a single user intent (e.g.
  deleting a tag also removing it from every task) must be **one reducer pass**
  so it becomes **one operation**. Put it in
  `src/app/root-store/meta/task-shared-meta-reducers/`, not in an effect that
  dispatches a fan-out of follow-up actions. An effect-based fan-out emits N
  operations for one intent _and_ re-runs on replay (a restatement of Boundary 1).
- `store.dispatch()` is non-blocking. After a loop of 50+ dispatches, add
  `await new Promise((r) => setTimeout(r, 0))` so captured operations don't
  lose intermediate state.

⚠️ `local-rules/no-multi-entity-effect` (`warn`) flags this heuristically — it
catches the array-literal fan-out shape (`map(() => [a(), b()])`), not every
multi-entity dispatch (e.g. a `of(a(), b())` varargs fan-out slips past). The
blessed pattern is a `task-shared-meta-reducers/` reducer.

---

## Decision table — "I'm writing an effect"

| Question                                              | Answer                                                    | Linter                               |
| ----------------------------------------------------- | --------------------------------------------------------- | ------------------------------------ |
| Does it inject the actions stream?                    | Use `LOCAL_ACTIONS` (not `Actions`)                       | ✅ `no-actions-in-effects` (error)   |
| Does it react to a **selector** instead of an action? | Add `skipDuringSyncWindow()`                              | ✅ `require-hydration-guard` (error) |
| Does one user intent change **>1 entity**?            | Make it a meta-reducer, not an effect                     | ⚠️ `no-multi-entity-effect` (warn)   |
| Does it dispatch in a **loop of 50+**?                | `await new Promise(r => setTimeout(r, 0))` after the loop | — (convention)                       |

Two of the three are mechanically enforced — you do not need to memorize them,
only understand _why_ (the invariant at the top).

---

## Why (deeper)

- **Mechanism & rules:** [`operation-rules.md`](./operation-rules.md)
- **Architecture:** [`operation-log-architecture.md`](./operation-log-architecture.md)
- **Diagrams:** [`diagrams/05-meta-reducers.md`](./diagrams/05-meta-reducers.md),
  [`diagrams/08-sync-flow-explained.md`](./diagrams/08-sync-flow-explained.md)
- **Source of truth:** `src/app/util/local-actions.token.ts`,
  `src/app/util/skip-during-sync-window.operator.ts`,
  `src/app/op-log/apply/hydration-state.service.ts`
