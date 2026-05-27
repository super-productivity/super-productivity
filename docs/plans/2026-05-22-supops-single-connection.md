# `SUP_OPS` `versionchange` handlers — #7735 (scoped down)

<!-- Filename predates the rescope: this plan is no longer about a single
shared connection — that consolidation was dropped (see the final section). -->

**Issue:** #7735 — filed as a follow-up to #7732 / #7712 / #7709.
**Status:** Active plan. Rescoped from #7735's original connection-consolidation
proposal (dropped — see the final section) and revised across multi-agent review
rounds, which corrected several factual errors in earlier drafts.
**Prerequisite:** none. The fix is **independent of #7732** and can land on
`master` directly, before or after #7732 (see "Baseline independence").

## Goal

Register an IndexedDB `versionchange` handler on the two `SUP_OPS` connections
that lack one — `OperationLogStoreService` and `ArchiveStoreService` — so the
next schema bump is not stalled by a handler-less connection. This is the one
genuine correctness fix in #7735.

It removes **one known latent hang**. It is necessary but not by itself
sufficient for a fully hang-proof upgrade — see "Limits".

## The latent bug

When a connection or tab opens `SUP_OPS` at a higher `DB_VERSION` (a schema
bump), IndexedDB dispatches a `versionchange` event on every other open
connection. The upgrade proceeds only once those connections close; any that
**stay open block the upgrade** — the upgrading `openDB` sits on `blocked`. A
connection with no `versionchange` handler never closes itself, so it stalls the
upgrade until the user manually closes that tab.

`SUP_OPS` connections and their `versionchange` handler status:

| Connection owner | `versionchange` handler today |
| --- | --- |
| `OperationLogStoreService` (`init()`) | ❌ **no** — fix here |
| `ArchiveStoreService` (`_init()`) | ❌ **no** — fix here |
| `ClientIdService` (`_openSupOpsDb()`) | ✅ yes — exists only post-#7732 |

This fix must land before any `DB_VERSION` increase.

### Baseline independence

`OperationLogStoreService` and `ArchiveStoreService` open `SUP_OPS` and register
a `close` (but no `versionchange`) handler **identically before and after
#7732** — the fix is the same two-line addition either way. Pre-#7732 there are
two `SUP_OPS` connections (both handler-less); #7732 adds a third
(`ClientIdService`, which ships with its own `versionchange` handler). So this
fix is not gated on #7732 and may land first. The post-#7732 `ClientIdService`
handler is a *consistency reference*, not a dependency.

## The fix

A standard close-and-null `versionchange` listener, added next to each service's
existing `close` listener. (Post-#7732, `ClientIdService._openSupOpsDb()` has an
identical one — keep all three consistent.)

### `OperationLogStoreService.init()`

```ts
async init(): Promise<void> {
  const db = await this._openDbWithRetry();
  db.addEventListener('close', () => {
    Log.warn(
      '[OpLogStore] IndexedDB connection closed by browser. Will re-open on next access.',
    );
    this._db = undefined;
    this._initPromise = undefined;
  });
  // A newer tab is upgrading SUP_OPS (a future schema bump). Close now so this
  // connection does not block the upgrade; the next op-log access reopens
  // transparently via _ensureInit().
  db.addEventListener('versionchange', () => {
    db.close();
    this._db = undefined;
    this._initPromise = undefined;
  });
  this._db = db;
}
```

### `ArchiveStoreService._init()`

The identical addition next to its existing `close` listener (fields `_db` /
`_initPromise`; log tag `[ArchiveStore]`).

### Behaviour notes

- **No behaviour change in normal operation.** The handler only acts on a
  `versionchange` — i.e. a schema bump — which today has no defined behaviour at
  all (the upgrade just hangs). The fix turns that hang into a graceful
  close-and-reopen; nothing else changes.
- **`db.close()` is graceful — it does NOT abort in-flight transactions.** Per
  the IndexedDB spec, a scripted `close()` (the `forced` flag is false) sets a
  *close-pending* flag, lets every transaction already running on the connection
  **run to completion**, and only then closes — it raises no `AbortError`. So a
  `versionchange` landing mid-transaction (e.g. during
  `runDestructiveStateReplacement`) lets that transaction commit normally; the
  upgrading tab simply waits for it. New work after the handler runs goes
  through `_ensureInit()` and opens a fresh connection (the handler nulled
  `_db`). The `forced`-flag abort path (`AbortError`) applies to browser-forced
  closes / `deleteDatabase`, not to this handler.
- A scripted `db.close()` also does **not** fire the `close` event, so the
  `versionchange` handler must null `_db` / `_initPromise` itself — exactly as
  `ClientIdService`'s handler does.
- The handler closes over `db` and nulls `this._db` unconditionally. A stale
  `versionchange` cannot clobber a *newer* connection: a closed IndexedDB
  connection receives no further events, and there is **no `await`** between
  `addEventListener('versionchange', …)` and `this._db = db` (they run in one
  synchronous tick, so the event cannot fire between them). Keep them adjacent —
  a future refactor inserting an `await` there would open a stale-handle window.
- `idb`'s `openDB({ blocking })` callback is the alternative API; rejected for
  consistency — the existing `close` handlers and `ClientIdService`'s
  `versionchange` handler all use `addEventListener`.

## Tests

Specs run against **real Chrome IndexedDB** (Karma `ChromeHeadless`); there is no
`fake-indexeddb`. That rules out an "open a 2nd connection at `DB_VERSION + 1`"
test — a real upgrade persistently bumps the shared `SUP_OPS` database for the
rest of the Karma run (`_clearAllDataForTesting()` clears object stores, **not**
the DB version), poisoning every later test with `VersionError`.

**Primary test (deterministic, per service)** — dispatch a synthetic
`versionchange` event; no DB version is mutated, so nothing is poisoned:

1. Force initialization through the **lazy `_ensureInit()` path** so
   `_initPromise` is genuinely populated: reset `(service as any)._db` and
   `_initPromise` to `undefined`, then call a cheap read-only method (op-log:
   e.g. `getLastSeq()`; archive: e.g. `loadArchiveYoung()`) and `await` it to
   completion. (The specs' `beforeEach` uses a *direct* `init()`, which leaves
   `_initPromise` unset — asserting it without the lazy path makes the
   `_initPromise` check vacuous.) Awaiting the read keeps the test
   deterministic.
2. `import { unwrap } from 'idb'`; capture the raw handle:
   `const raw = unwrap((service as any)._db)`.
3. `raw.dispatchEvent(new Event('versionchange'))` — synchronous; the handler
   reads no event fields, so a plain `Event` suffices.
4. Assert `(service as any)._db` and `_initPromise` are both `undefined`, **and**
   that the connection was actually closed — e.g. `raw.transaction(<store>)`
   throws `InvalidStateError`. (Asserting the close, not just the field nulling,
   guards the load-bearing `db.close()` call — the thing that actually unblocks
   the upgrade.)
5. Call the read again; assert it succeeds — the connection reopened
   transparently (this also proves `_initPromise` was nulled: a stale resolved
   `_initPromise` would make `_ensureInit()` skip the reopen and the `db` getter
   throw).

This proves *our* code: the handler closes the connection and the service
reopens. That Chrome fires `versionchange` on a real cross-connection upgrade is
browser behaviour, not ours — a true end-to-end "the upgrade completes across
tabs" check is e2e territory and out of scope here.

Also add a minimal **`close`-handler test** in the same describe block (dispatch
`close`, assert `_db`/`_initPromise` cleared) — neither service has one today,
and the fix adds a sibling listener right next to it; cheap regression cover.

Spec files:
- `OperationLogStoreService` has `operation-log-store.service.spec.ts` — add the
  tests in a new `describe`. Use the **real** `init()` path, not the fully-faked
  `_openDbOnce` db used by the `_openDbWithRetry` describe block.
- `ArchiveStoreService` has **no spec file** — `archive-store.service.spec.ts`
  must be **created**. `ArchiveStoreService` injects nothing, so `TestBed` setup
  is trivial (no providers/mocks). The new file must mirror the op-log spec's
  teardown — `_clearAllDataForTesting()` in `afterEach` — so it does not leave
  archive rows or an open connection for later specs.

## Limits — what this fix does NOT do

- It does not help against an **old tab still running pre-fix code** — that
  connection has no `versionchange` handler and still blocks the upgrade. A
  fully hang-proof v-bump rollout also needs a `blocked`-path UX story; that
  belongs with the schema-bump PR, not here.
- An `openDB({ blocked })` diagnostic callback (logs when *this* service's own
  open is stalled by other tabs) is **deferred** — it is diagnostics, not the
  fix; keep this PR minimal.

## Acceptance criteria

- `OperationLogStoreService` and `ArchiveStoreService` each register a
  `versionchange` handler that calls `db.close()` and clears `_db` /
  `_initPromise`.
- A unit test per service — including a newly created
  `archive-store.service.spec.ts` — proves the dispatch-`versionchange` → close
  (connection unusable) → transparent-reopen contract, plus a `close`-handler
  regression test.
- Tests mutate no `SUP_OPS` DB version; the full unit suite (both timezone
  variants) stays green.
- `npm run checkFile` clean on every modified or created `.ts` file.

## Estimated size

~10–12 production lines across 2 files; ~35–45 test lines added to
`operation-log-store.service.spec.ts` plus a new `archive-store.service.spec.ts`
(~60–80 lines incl. `TestBed` boilerplate — it also gives `ArchiveStoreService`
its first test coverage). One small, low-risk PR.

## Commit

`fix(sync): add versionchange handlers to SUP_OPS connections`

## Issue disposition

This PR closes #7735, whose original text proposed the larger consolidation. So
that decision is not buried: both plan docs
(`2026-05-22-supops-single-connection.md` and the rejected-alternative
`-alt.md`) land **in this PR**, and the PR description plus the `Closes #7735`
comment must state explicitly that the connection consolidation was evaluated
and deliberately dropped, linking this doc. No separate tracking issue is filed —
the consolidation is "not planned", not "deferred".

---

## Connection consolidation: not planned

#7735 originally proposed collapsing the three `SUP_OPS` connections onto one
shared connection, breaking a DI cycle, and relocating `ClientIdService` out of
`core/`. After two multi-agent review rounds, **that scope is dropped.**
Rationale:

- **No behavioral benefit.** #7735 admits this itself. The DI cycle is
  *prospective*, not live — post-#7732 `ClientIdService` injects nothing, so
  there is no cycle today. Three same-origin connections serialize their
  transactions correctly; that is the documented, working state, not a bug.
- **A bad LOC trade.** The consolidation is not a delete-and-simplify refactor —
  it *adds* a service file and a few hundred lines of net-new code (mostly new
  test surface) and edits ~16 files, for zero behavioral change, on the app's
  most safety-critical path (op-log + clientId + destructive replacement).
- The only genuine win underneath — de-duplicating `_openDbWithRetry` across two
  services — is ~50 lines and does not justify the rest.

If a future `SUP_OPS` schema migration ever makes a single connection genuinely
worthwhile, do it **bundled with that migration** (the marginal cost of the
connection extraction is small when you are already in that code with fresh
tests) and use the reference design below. Do not pursue it standalone.

### Reference design — extract `SupOpsConnectionService` (not planned; for a future migration only)

Preferred approach if the consolidation is ever revived (it beat the alternative
5–0 in a multi-agent evaluation):

- Extract a **dependency-free leaf** `SupOpsConnectionService` (in
  `op-log/persistence/`) owning the `SUP_OPS` connection lifecycle: `openDB` +
  `runDbUpgrade` + retry/backoff (`_openDbWithRetry`) + `close`/`versionchange`
  handlers + in-flight-promise dedup. It must `inject()` nothing — that is what
  makes it cycle-safe. Precedent in this codebase: `LockService`.
- `OperationLogStoreService`, `ArchiveStoreService`, `ClientIdService` delegate
  to it. Keep each service's existing `_ensureInit()` / `db`-getter shape as
  thin delegates so the ~50 + ~56 internal call sites are untouched.
- Keep `CLIENT_ID_PROVIDER` exactly as-is (it has 11 consumers and is unrelated
  to the connection question).
- Optionally relocate `ClientIdService` to `op-log/util/` + add an ESLint
  `no-restricted-imports` rule banning `core → op-log` (this part is unrelated
  to a schema migration and would be separately optional even then).

The **rejected** alternative — making `OperationLogStoreService` itself the
connection owner by cutting its `CLIENT_ID_PROVIDER` edge — is documented, with
the multi-agent evaluation's reasoning, in
[`2026-05-22-supops-single-connection-alt.md`](./2026-05-22-supops-single-connection-alt.md).
The full original phased breakdown of this consolidation is preserved in this
file's git history (pre-rescope revision).
