# Collapse `SUP_OPS` onto a single connection — Alternative (Plan B)

**Issue:** #7735 — follow-up to #7732 / #7712 / #7709
**Status:** ❌ **REJECTED** by a 4-agent evaluation (2026-05-22) in favour of
[`2026-05-22-supops-single-connection.md`](./2026-05-22-supops-single-connection.md)
(Plan A). Kept for the record. Reasons: (1) Plan B makes other services depend
on the 1,745-line `OperationLogStoreService` for a DB handle, cutting against
this codebase's small-leaf-service convention (`LockService` is the precedent
Plan A follows); (2) the `mergeRemoteOpClocks` signature change has a wide,
silent-failure-prone blast radius; (3) Step 2 below rests on a **factual error**
— see the ⚠️ correction inline. Plan A is lower-risk and architecturally
cleaner. Do not implement this plan.
**Prerequisite (hard gate):** #7732 merged to `master`. Not yet merged — see
Plan A for detail.

## The core idea

Plan A breaks the DI cycle by **adding** a new leaf service
(`SupOpsConnectionService`) that all three openers delegate to.

Plan B breaks the cycle by **removing an edge** instead. The key fact, verified:

> `OperationLogStoreService` injects **exactly one dependency** —
> `CLIENT_ID_PROVIDER` (`operation-log-store.service.ts:186`) — and uses it in
> **exactly two places**: `loadClientId()` in `mergeRemoteOpClocks()` (`:1417`)
> and `clearCache()` in `runDestructiveStateReplacement()` (`:1687`).

Cut that one edge and `OperationLogStoreService` becomes a **dependency-free
leaf**. Once it is a leaf, `ClientIdService` (and optionally `ArchiveStoreService`)
can depend on it directly and **borrow its existing `SUP_OPS` connection** — no
new service, no cycle. `OperationLogStoreService` already owns the canonical
connection: the retry/backoff opener, `runDbUpgrade` wiring, the `OpLogDB`
schema type. Plan B reuses that owner instead of extracting a new one.

## Why it is cycle-free (verified)

- `OperationLogStoreService`'s only injected dependency is `CLIENT_ID_PROVIDER`.
  After Steps 1–3 it injects nothing → it cannot be part of any cycle.
- `CLIENT_ID_PROVIDER` has **11 consumer services** (op-log persistence, op-log
  sync, validation, `imex/sync`). Only `OperationLogStoreService` is in the
  (prospective) cycle. The token is **kept unchanged** for the other 10; this
  plan does not touch the `CLIENT_ID_PROVIDER` abstraction.
- The cycle #7735 describes is *prospective*, not current: post-#7732
  `ClientIdService` injects nothing. The cycle would only appear *if*
  `ClientIdService` delegated DB access to `OperationLogStoreService` while the
  latter still injected `CLIENT_ID_PROVIDER`. Plan B removes that edge first, so
  the delegation becomes safe.

## Steps

### Step 1 — Make `mergeRemoteOpClocks` take the clientId as a parameter

`mergeRemoteOpClocks(ops)` → `mergeRemoteOpClocks(ops, currentClientId: string | null)`.
The method body keeps its existing null-check / "cannot prune" warning; it just
reads the parameter instead of `await this.clientIdProvider.loadClientId()`.

Callers (~5, all already inject `CLIENT_ID_PROVIDER`):
- `operation-log-hydrator.service.ts` — 4 call sites (`:213`, `:239`, `:291`,
  `:315`). Field `clientIdProvider` already present (`:57`). Load once per
  hydration pass and pass it in.
- `conflict-resolution.service.ts` — 1 call site (`:432`). Field already present
  (`:100`); it already loads the clientId at `:614`/`:654`.

This is arguably *better design* — `mergeRemoteOpClocks` is a pure-ish clock
operation; taking its inputs explicitly beats reaching into DI.

### Step 2 — Move the `clearCache()` call to `runDestructiveStateReplacement`'s callers

Delete `this.clientIdProvider.clearCache()` from
`runDestructiveStateReplacement()` (`:1687`). Its 2 callers —
`backup.service.ts:228` and `clean-slate.service.ts:132` — would call
`clientIdService.clearCache()` themselves immediately after the `await` returns.

> ⚠️ **Factual error (caught by the evaluation).** This step originally claimed
> "both services already import `ClientIdService`." That is **false** —
> `backup.service.ts` and `clean-slate.service.ts` import only the pure
> `generateClientId` util, not `ClientIdService`, and both carry comments
> stating the cache-clear happens *inside* `runDestructiveStateReplacement`'s
> transaction. So Step 2 must **add** a new `ClientIdService` injection to two
> more services and **move** a correctness guarantee (cache-clear bound to a
> committed `tx.done`) out into callers that cannot see `tx.done`. This widens
> the blast radius and decentralises an invariant — a core reason Plan B lost.

### Step 3 — Delete the `CLIENT_ID_PROVIDER` field + import from `OperationLogStoreService`

`OperationLogStoreService` now injects nothing → a verifiable leaf.

### Step 4 — Expose the connection on `OperationLogStoreService`

Add a narrow public surface. Two options (decision point — see Open questions):
- **4a** — `getDb(): Promise<IDBPDatabase<OpLogDB>>` (or `init()` + `db` getter):
  consumers get the raw handle.
- **4b** — narrow typed methods (`readClientId()`, `putClientId()`, …): consumers
  never see the handle.

4b is better encapsulation; 4a is less code. Recommend 4b for `ClientIdService`'s
needs (small, fixed surface) — it keeps the IndexedDB handle private.

### Step 5 — Repoint `ClientIdService` at `OperationLogStoreService`

`ClientIdService` injects `OperationLogStoreService`; delete `_getSupOpsDb`,
`_openSupOpsDb`, `_supOpsDb`, `_supOpsDbPromise` (~50 lines). Route its
`SUP_OPS.client_id` reads/writes through the Step-4 surface. The legacy `pf`
reader (`_readPf`) is untouched.

### Step 6 — versionchange handler

`OperationLogStoreService.init()` registers a `versionchange` handler (mirroring
the one `ClientIdService` has today). Since it is now the connection owner, this
is the single handler the app needs for the op-log/clientId connection.

> Ship Step 6 **first**, as its own tiny PR, exactly as in Plan A's Phase 1 —
> the latent v6→v7 upgrade-hang fix should not wait behind this refactor.
> `ArchiveStoreService` also gets one in that first PR.

### Step 7 — (optional) Fold in `ArchiveStoreService`

`ArchiveStoreService` does not inject `CLIENT_ID_PROVIDER`, so
`ArchiveStoreService → OperationLogStoreService` is cycle-free today. To reach
*one connection process-wide*, `ArchiveStoreService` injects
`OperationLogStoreService` and drops its own opener; `_withRetryOnClose` (iOS
#6643) stays, repointed at an invalidate hook. Without Step 7 the end state is
two connections (op-log+clientId shared, archive separate).

### Step 8 — (optional) Relocate `ClientIdService`

`ClientIdService` still imports `OperationLogStoreService` from `op-log/`, so the
`core → op-log` inversion persists (unchanged from today, not worsened). To kill
it, relocate `ClientIdService` to `op-log/util/` and add the ESLint
`no-restricted-imports` guard — identical to Plan A's Phase 3, and equally
optional / separable.

## Files touched

`operation-log-store.service.ts`, `operation-log-hydrator.service.ts`,
`conflict-resolution.service.ts`, `backup.service.ts`, `clean-slate.service.ts`,
`client-id.service.ts`, plus their specs and the op-log integration helpers
that reference `mergeRemoteOpClocks`. Optional Step 7: `archive-store.service.ts`.
Optional Step 8: ~16 import sites + `eslint.config.js` + docs. **No new file.**

## Estimated size

| Scope | Diff churn |
| --- | --- |
| Steps 1–6 (core: cut the edge, share the connection) | ~300–450 |
| + Step 7 (archive folded in) | +~80 |
| + Step 8 (relocation + ESLint) | +~80 |
| **Plan B full** | **~450–600** |
| (Plan A full, for comparison) | ~750–1,100 |

Plan B is smaller mainly because it adds no service and no new spec file, and
because the connection machinery is *reused in place* rather than relocated.

## Acceptance criteria

- `OperationLogStoreService` injects nothing — a verifiable leaf (greppable: no
  `inject(` in the class).
- `ClientIdService` no longer opens `SUP_OPS`; it routes through
  `OperationLogStoreService`.
- `mergeRemoteOpClocks` and `runDestructiveStateReplacement` no longer reference
  `CLIENT_ID_PROVIDER`; the `clearCache` responsibility is at both destructive
  callers and covered by tests.
- The op-log/clientId connection registers `close` + `versionchange` handlers.
- `client-id.service.spec.ts` data-safety matrix passes after the test-double
  rewrite (private seams moved to `OperationLogStoreService`).
- `runDestructiveStateReplacement` atomicity unchanged; concurrency regression
  test added.
- With Step 7: one `SUP_OPS` connection process-wide.
- Full unit suite (both timezone variants) + op-log integration specs green.

## Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| A future cycle if `OperationLogStoreService` gains an injected dep that reaches `ClientIdService` | "Injects nothing" is an enforced acceptance criterion; a store service *should* be a leaf |
| `clearCache` now at 2 caller sites — one could be forgotten on a future destructive flow | Only 2 call sites today; cover both with tests; consider an ESLint/review note. (Plan A keeps it centralized — a genuine point for A.) |
| `ClientIdService` / `ArchiveStoreService` depend on the whole 1,745-line `OperationLogStoreService` for a DB handle | Step 4b: expose only narrow typed methods, not the raw handle — the DI dependency is on the class but the *used* surface is tiny |
| `mergeRemoteOpClocks` signature change ripples to specs + integration helpers | ~5 call sites + helpers; mechanical, enumerated |
| `OperationLogStoreService` becomes the connection "landlord" (dual responsibility) | This is the central A-vs-B trade-off — see below |

## The central trade-off vs Plan A

- **Plan A** adds a dedicated `SupOpsConnectionService` (single-responsibility:
  it *only* owns the connection). Cleaner separation; one more service/file;
  larger diff; keeps `CLIENT_ID_PROVIDER` on `OperationLogStoreService`.
- **Plan B** removes a dependency edge so `OperationLogStoreService` itself can
  be the connection owner. Fewer moving parts; no new file; smaller diff; makes
  `OperationLogStoreService` a proper leaf and `mergeRemoteOpClocks` explicit —
  but `OperationLogStoreService` carries connection-ownership *and* op storage,
  and other services depend on it for a DB handle.

KISS leans B; single-responsibility purity leans A. Both are correct; both are
optional cleanup on top of the one must-do fix (the `versionchange` handlers).

## Out of scope

Same as Plan A: the legacy `pf` reader is untouched; no new schema version.
