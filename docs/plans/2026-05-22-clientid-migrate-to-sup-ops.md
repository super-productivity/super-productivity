# Migrate sync `clientId` from `pf` into `SUP_OPS`

**Issue:** #7732 — follow-up to PR #7712 / issue #7709
**Status:** Draft plan — revised after three multi-agent review rounds
**Prerequisite:** #7712 merged (2026-05-22) ✅

## Goal

Move the sync `clientId` out of the legacy `pf` IndexedDB database into
`SUP_OPS` so the clientId write joins the atomic multi-store transaction in
`OperationLogStoreService.runDestructiveStateReplacement()`. Once it does, the
hand-rolled two-phase commit `ClientIdService.withRotation()` (and its CAS guard
and rollback-failure logging) is deleted.

## Design decisions (and why)

Three review rounds converged on these. Two reverse earlier-draft mistakes —
kept here as explicit decisions so they are not "re-improved" into bugs again.

1. **No permanent `pf` mirror.** Downgrading past this schema bump opens
   `SUP_OPS` at a lower version than stored → `VersionError` → the op-log/sync
   subsystem is dead regardless of where the clientId lives. A mirror cannot
   rescue that. `pf` becomes a **read-only, one-time migration source.**

2. **Self-healing read, no separate migration service.** The `pf → SUP_OPS`
   copy happens inline in the clientId resolver, triggered lazily by the first
   read. This removes the init-ordering failure mode — the clientId is read very
   early and is _non-regenerable_, so a self-gating read is safer than call-order
   discipline plus an ordering test.

3. **`getOrGenerateClientId()` must never generate on a read _failure_.**
   _(Reverses an earlier draft.)_ An earlier draft made `loadClientId()` "never
   throw" and had `getOrGenerateClientId()` generate whenever it returned
   `null`. That converts a transient IndexedDB hiccup into a brand-new clientId
   that orphans the device's real, history-bearing id — the exact
   non-regenerable loss this issue exists to prevent. The resolver therefore
   **propagates IndexedDB read errors**; generation happens _only_ when reads
   succeed and confirm no id exists anywhere. This matches today's behavior
   (today `getOrGenerateClientId` throws on a DB-open failure rather than
   generating).

4. **`OperationLogMigrationService`'s genesis-op clientId resolution is left
   unchanged.** _(Reverses an earlier draft.)_ An earlier draft routed it
   through `getOrGenerateClientId()`. That is unsafe: the legacy genesis op is
   built as `{ clientId, vectorClock: meta.vectorClock || { [clientId]: 1 } }`,
   and `meta.vectorClock` is keyed by the _legacy PFAPI_ identity — the `pf`
   `CLIENT_ID` key. The migration must keep resolving the genesis clientId from
   `CLIENT_ID` so the op's `clientId` matches its own `vectorClock` keys.
   `persistClientId` is therefore **kept** (not deleted), and now also seeds the
   new `SUP_OPS` store.

5. **`ClientIdService` is _not_ relocated in this PR.** The relocation to
   `op-log/util/` is a pure rename touching ~12 import sites for zero behavioral
   benefit (the `core ↔ op-log` coupling already exists via
   `client-id.provider.ts`). Per "minimize changes / stay in scope" it is a
   separate follow-up. `ClientIdService` stays in `core/util/` and imports the
   `SUP_OPS` schema constants from `op-log/persistence/` (a layering smell, but
   no lint rule forbids it and the provider already crosses that boundary).

Net effect: roughly line-neutral versus today's `withRotation` machinery, but a
clear win in _conceptual_ complexity — cross-database two-phase commit is
replaced by a single in-transaction `put` plus a one-time idempotent copy.

## Files touched

| File                                                            | Change                                                                                                                                                               |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/op-log/persistence/db-keys.const.ts`                   | `DB_VERSION` 5→6; add `STORE_NAMES.CLIENT_ID`                                                                                                                        |
| `src/app/op-log/persistence/db-upgrade.ts`                      | Version 6 branch: create `client_id` store                                                                                                                           |
| `src/app/op-log/persistence/operation-log-store.service.ts`     | `OpLogDB` schema entry; `client_id` `put` in `runDestructiveStateReplacement` + post-commit `clearCache()`; `_clearAllDataForTesting`                                |
| `src/app/core/util/generate-client-id.ts`                       | **New** — pure `generateClientId()` + `isValidClientIdFormat()`                                                                                                      |
| `src/app/core/util/client-id.service.ts`                        | Rewritten in place — `SUP_OPS`-backed, inline one-time `pf` migration, error-aware resolver, no `withRotation`                                                       |
| `src/app/op-log/util/client-id.provider.ts`                     | Add `clearCache()` to the `ClientIdProvider` interface + factory; doc-note the migration side effect                                                                 |
| `src/app/op-log/clean-slate/clean-slate.service.ts`             | Rewrite: pure id gen, no `withRotation`, no cache handling                                                                                                           |
| `src/app/op-log/backup/backup.service.ts`                       | Rewrite: pure id gen, no `withRotation`, no cache handling                                                                                                           |
| `src/app/op-log/capture/operation-log.effects.ts`               | `loadClientId() ?? generateNewClientId()` → `getOrGenerateClientId()`                                                                                                |
| `src/app/op-log/persistence/operation-log-migration.service.ts` | `generateNewClientId()` → `getOrGenerateClientId()` for the fallback only; **fix `:249` — stop logging the full clientId**. Clientid resolution otherwise unchanged. |
| `docs/sync-and-op-log/`                                         | Note the clientId now lives in `SUP_OPS` v6 (per CLAUDE.md: op-log changes need doc updates)                                                                         |
| Specs                                                           | see Step 6                                                                                                                                                           |

`LegacyPfDbService` is **not** modified or used by `ClientIdService` — see Step 4
for why its error-swallowing `load()` is unsuitable here.

## Step 1 — Schema bump

### `db-keys.const.ts`

```ts
export const DB_VERSION = 6; // was 5

export const STORE_NAMES = {
  // ...existing...
  /** Client ID - sync device identity (singleton, key = SINGLETON_KEY) */
  CLIENT_ID: 'client_id' as const,
} as const;
```

`SINGLETON_KEY = 'current'` is reused as the key.

> **Hard pre-merge gate:** confirm no other in-flight PR also bumps `DB_VERSION`
> to 6. `db-upgrade.ts` runs exactly one callback per version transition; a
> collided version corrupts the `SUP_OPS` schema irrecoverably.

### `db-upgrade.ts`

```ts
// Version 6: Add client_id store for atomic clientId rotation.
// Consolidates the sync clientId from legacy 'pf' (key '__client_id_') into
// SUP_OPS so destructive-flow rotation joins runDestructiveStateReplacement's
// atomic transaction. See issue #7732. The runtime copy from 'pf' happens in
// ClientIdService (a versionchange tx cannot read another database).
if (oldVersion < 6) {
  db.createObjectStore(STORE_NAMES.CLIENT_ID);
}
```

Keyless store (out-of-line key, like `vector_clock`).

### `operation-log-store.service.ts` — `OpLogDB` schema

```ts
[STORE_NAMES.CLIENT_ID]: {
  key: string;   // SINGLETON_KEY
  value: string; // the clientId
};
```

Add `STORE_NAMES.CLIENT_ID` to the `_clearAllDataForTesting()` store list and a
matching `.clear()`. (`ArchiveDBSchema` in `archive-store.service.ts` does _not_
need the entry — that service never touches the store; the shared `runDbUpgrade`
still creates it.)

## Step 2 — `generate-client-id.ts` (new pure util)

Extract the existing pure generation logic out of `ClientIdService` into
`src/app/core/util/generate-client-id.ts`:

```ts
/** Generates a compact client ID: {platform}_{4-char-base62}, e.g. "B_a7Kx". */
export const generateClientId = (): string => {
  /* _generateClientId body */
};

/** True if the id matches a known valid format (legacy length>=10, or new). */
export const isValidClientIdFormat = (id: unknown): id is string => {
  /* ... */
};
```

`_getEnvironmentId` / `_generateBase62` move here as module-private helpers.
Pure, no DI, no I/O — unit-testable directly, and importable by the
destructive-flow callers (`op-log → core` is the legal dependency direction)
without going through the stateful service. `isValidClientIdFormat` is a type
guard so callers narrow `unknown` reads from IndexedDB cleanly. No external code
imports the current `private _isValidClientIdFormat`, so the extraction is clean.

## Step 3 — `runDestructiveStateReplacement` joins the clientId write

In `operation-log-store.service.ts`, in `runDestructiveStateReplacement` (~line
1584):

- Add `STORE_NAMES.CLIENT_ID` to the `storeNames` array **unconditionally**
  (~line 1597) — both callers always rotate; unlike the archive stores it is not
  conditional.
- Inside the `try`, **before `await opsStore.clear()` (~line 1615)**, write the
  clientId first:

  ```ts
  await tx.objectStore(STORE_NAMES.CLIENT_ID).put(syncImportOp.clientId, SINGLETON_KEY);
  ```

  Use an inline `tx.objectStore(...)` call (the value is written once; no hoisted
  handle needed). The rotated id is already on the op — no new parameter.
  **First-in-tx is deliberate:** the interrupt tests inject failure into
  `opsStore.add`; placing the `client_id` `put` first means that injected
  failure occurs _after_ the `client_id` `put` is queued, so the abort genuinely
  exercises "client_id put queued → tx aborts → `client_id` unchanged."
  Atomicity itself is order-independent.

- After `await tx.done` (~line 1654), invalidate the clientId cache so the next
  read sees the rotated value:

  ```ts
  this.clientIdProvider.clearCache();
  ```

  `OperationLogStoreService` already injects `CLIENT_ID_PROVIDER`. Doing the
  cache-clear _inside_ `runDestructiveStateReplacement`, bound to `tx.done`,
  makes it impossible for a future edit to open a window between commit and
  cache-clear. On `catch`/abort, `clearCache()` is not reached and the cache
  correctly keeps the old id.

- Replace the doc-comment paragraph about "Atomicity holds within the `SUP_OPS`
  database only … callers own the clientId rollback" with: the clientId now
  lives in `SUP_OPS` and rotates atomically with `OPS`/`STATE_CACHE`/`VECTOR_CLOCK`.

## Step 4 — `ClientIdService` rewrite

Rewritten **in place** at `src/app/core/util/client-id.service.ts` (no
relocation — decision 5).

### Databases this service touches

- **`SUP_OPS`** — an **independent connection** opened via the shared
  `runDbUpgrade` + `DB_NAME`/`DB_VERSION`. Independent because
  `OperationLogStoreService` injects `CLIENT_ID_PROVIDER` (→ `ClientIdService`),
  so delegating back would be a DI cycle. Two same-origin connections to one
  store are fine — IndexedDB serializes transactions across them. Register a
  `'close'` handler (null the cached handle, reopen on next access — mirror
  `OperationLogStoreService.init` at `:194-200`) and a `versionchange` handler
  (`db.close()`) so a future v7 upgrade is not blocked. The open does **not**
  replicate `OperationLogStoreService`'s heavy retry logic; a transient
  `SUP_OPS` open failure surfaces as a thrown error (handled per the resolver
  contract below).
- **`pf`** — opened **read-only, directly by this service**, per-call
  (open-read-close, no cached handle). It is **not** routed through
  `LegacyPfDbService`: that service's `load()`/`loadClientId()` _swallow_
  IndexedDB errors and return `null`, which makes "key genuinely absent"
  indistinguishable from "read failed" — and that distinction is exactly what
  decision 3 depends on. `ClientIdService`'s own `pf` read lets IndexedDB errors
  **propagate**. (Opening a non-existent `pf` creates an empty one; this is
  harmless and is already the current behavior.)

### Final public surface

```ts
loadClientId(): Promise<string | null>     // never throws; null on absence OR read failure
getOrGenerateClientId(): Promise<string>   // resolves, else generates; throws on read failure
persistClientId(id: string): Promise<void> // legacy-migration genesis seed; validated; unconditional
clearCache(): void                         // invalidate the in-memory cache
```

`getOrGenerateClientId` and `loadClientId` keep their current names/signatures,
so `CLIENT_ID_PROVIDER` and its consumers are unaffected. `clearCache()` is
promoted from a test helper to a documented production method (used by
`runDestructiveStateReplacement`); its JSDoc must say so.

**Deleted:** `withRotation`, `_restorePriorClientIdIfCurrentMatches`,
`_errorName`, `generateNewClientId`, and the in-service generation helpers
(moved to `generate-client-id.ts`).

### `_resolve()` — the shared resolver (private)

The one place that answers "what is this device's clientId, migrating it
forward if needed". **Read failures propagate; only a failed copy-forward is
swallowed.**

```
private async _resolve(): Promise<string | null> {
  const fromOps = await this._readSupOps();   // throws on IndexedDB read error
  if (fromOps) return fromOps;
  const fromPf = await this._readPf();        // throws on IndexedDB read error
  if (!fromPf) return null;                   // reads succeeded -> confirmed: no id anywhere
  try {
    return await this._putClientIdIfAbsent(() => fromPf);
  } catch {
    // Copy-forward to SUP_OPS failed (quota, closed conn). The pf id is valid;
    // return it and let a later launch retry the copy. Worst case: redundant copy.
    return fromPf;
  }
}
```

- `_readSupOps()` — open `SUP_OPS`, `get(client_id, SINGLETON_KEY)`,
  `isValidClientIdFormat`-gate (invalid → `null`, never throw on bad _format_ —
  issue #6197). IndexedDB _errors_ propagate.
- `_readPf()` — open `pf` read-only, read `__client_id_` then `CLIENT_ID`,
  format-gate, return first valid or `null`. IndexedDB _errors_ propagate.

> **`pf` key precedence.** `__client_id_` is the key `ClientIdService` has always
> operated on (every current `loadClientId()` reads it); on an op-log-era device
> it is the live identity. `CLIENT_ID` is the original PFAPI key, read only as a
> fallback to seed a legacy profile. On a legacy device migrating for the first
> time, `OperationLogMigrationService` resolves the genesis op from `CLIENT_ID`
> and `persistClientId` writes it **unconditionally** to `SUP_OPS` — so it wins
> over any `__client_id_`-derived copy, keeping the genesis op consistent with
> its `meta.vectorClock` (decision 4).

### `_putClientIdIfAbsent(factory)` — shared single-tx CAS (private)

```
private async _putClientIdIfAbsent(factory: () => string | null): Promise<string | null> {
  const tx = supOpsDb.transaction(CLIENT_ID, 'readwrite');
  const raced = await tx.store.get(SINGLETON_KEY);
  if (isValidClientIdFormat(raced)) { await tx.done; return raced; }
  const next = factory();
  if (next) await tx.store.put(next, SINGLETON_KEY);
  await tx.done;
  return next;
}
```

The in-tx re-check is load-bearing: IndexedDB serializes same-store transactions
across same-origin connections, so a write that committed first (another tab's
generate, or a rotation) is observed by `raced` and **wins** — the helper never
clobbers it. Comment it as a _multi-tab / rotation_ guard. `persistClientId` and
`runDestructiveStateReplacement` are the two _unconditional_ writers (they know
the exact intended value); `_putClientIdIfAbsent` is the _establish-if-absent_
writer — that asymmetry is deliberate.

### `loadClientId()` — swallowing reader

```
if (_cachedClientId) return _cachedClientId;
try {
  const id = await this._resolve();
  if (id) _cachedClientId = id;
  return id;
} catch {
  return null;   // never throws — callers (hydrator, sync readers) tolerate null
}
```

The cache is the migration's memoization: once warm, `_resolve()` (and the `pf`
read) never run again. Concurrent first-launch callers may each run `_resolve()`
— harmless, `_putClientIdIfAbsent` is idempotent.

### `getOrGenerateClientId()` — resolves or generates

```
if (_cachedClientId) return _cachedClientId;
const existing = await this._resolve();   // PROPAGATES read failures — does not swallow
if (existing) { _cachedClientId = existing; return existing; }
// Reads succeeded and confirmed empty everywhere -> safe to generate.
const id = await this._putClientIdIfAbsent(() => generateClientId());
_cachedClientId = id;
return id;
```

If `_resolve()` throws (transient `SUP_OPS`/`pf` read failure),
`getOrGenerateClientId()` throws — it does **not** generate. This is the same
contract as today (`generateNewClientId` already throws on IDB failure); callers
(`operation-log.effects.ts:171-175`, and via the provider
`file-based-encryption.service.ts`, `snapshot-upload.service.ts`) already treat
a failed clientId resolution as fatal-and-retryable.

### `persistClientId(id)` — legacy-migration genesis seed

Validate format, **unconditionally** `put` into `SUP_OPS.client_id`, set the
cache. Unconditional (not CAS) because it carries the authoritative legacy
`CLIENT_ID` value that the genesis op is built from and must win over any
`__client_id_`-derived migration copy. No `pf` write.

## Step 5 — Rewrite the callers

### `clean-slate.service.ts` / `backup.service.ts`

Both already rotate inside `lockService.request(LOCK_NAMES.OPERATION_LOG, …)`.
The rewrite — no `withRotation`, no try/catch, no cache handling:

```ts
import { generateClientId } from '../../core/util/generate-client-id';

const newClientId = generateClientId(); // pure — persisted only inside the tx
const syncImportOp: Operation = {
  /* ...clientId: newClientId... */
};
await this.opLogStore.runDestructiveStateReplacement({ syncImportOp /* ... */ });
// runDestructiveStateReplacement committed the new clientId and cleared the
// cache; nothing else to do. On throw, the tx aborted and the old id stands.
```

Update the class/method doc comments that describe the cross-DB rollback.

### `operation-log.effects.ts`

Replace `loadClientId() ?? generateNewClientId()` (`:168-170`) with
`await this.clientIdService.getOrGenerateClientId()`.

### `operation-log-migration.service.ts`

Clientid resolution is **unchanged** (decision 4) — keep `:239`
(`loadMetaModel`), keep `legacyPfDb.loadClientId()` reading `CLIENT_ID`, keep
`persistClientId(legacyClientId)`. Two edits only:

- `:241` fallback: `legacyClientId || generateNewClientId()` →
  `legacyClientId ?? (await this.clientIdService.getOrGenerateClientId())`
  (`generateNewClientId` is deleted; the fallback only fires when there is no
  legacy identity to preserve, so generating is correct).
- `:249`: stop logging the literal clientId
  (`OpLog.normal(\`...Using client ID: ${clientId}\`)`— a CLAUDE.md sync-rule-9
violation, log history is user-exportable). Log a 3-char suffix only,
consistent with`clean-slate.service.ts`. Audit the remaining `OpLog` calls in
  every touched file (spot-checked: the rest are already value-free).

## Step 6 — Tests

### `client-id.service.spec.ts` (rewritten, stays in `core/util/`)

Drop all `withRotation` tests. Behavioral matrix:

| Case                                              | Expectation                                                                                   |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `SUP_OPS.client_id` populated                     | returned directly; `pf` not opened                                                            |
| `SUP_OPS` empty, `pf.__client_id_` valid          | migrated into `SUP_OPS`; id unchanged                                                         |
| `SUP_OPS` empty, only `pf.CLIENT_ID`              | migrated; covers the bridge-ordering gap                                                      |
| `SUP_OPS` empty, both `pf` keys valid and differ  | `__client_id_` wins                                                                           |
| `SUP_OPS` invalid format, `pf` valid              | `pf` value wins, overwrites `SUP_OPS`                                                         |
| nothing anywhere                                  | `loadClientId()` → `null`; `getOrGenerateClientId()` generates                                |
| multi-tab fresh generate                          | two `getOrGenerateClientId()` over one fake-IDB converge on one id                            |
| **`SUP_OPS` read throws**                         | `loadClientId()` → `null` (no throw); `getOrGenerateClientId()` **throws, does not generate** |
| **`pf` read throws**                              | same — `loadClientId()` → `null`; `getOrGenerateClientId()` throws, no generation             |
| **migration copy-forward write fails (quota)**    | `loadClientId()` & `getOrGenerateClientId()` return the `pf` id; no throw, no generation      |
| `persistClientId`                                 | unconditional `SUP_OPS` write; cache set; rejects invalid format                              |
| `generateClientId` / `isValidClientIdFormat` util | pure; correct format / guard                                                                  |

The three **bold** rows are the data-safety core — they prove a transient
IndexedDB failure cannot mint a new clientId. They must use a fake-IDB that can
be made to throw, not just be empty.

### Destructive-flow atomicity

`clean-slate-interrupt.integration.spec.ts` must be **extended**: seed
`SUP_OPS.client_id` with a valid-format id, run the existing `opsStore.add`-throw
interrupt, and assert `SUP_OPS.client_id` is unchanged after the abort (this is
the property `withRotation` used to provide by hand). Existing fixtures that seed
short ids like `'cPrior'` must switch to valid-format ids (`B_xxxx` / length ≥
10), or the new format guard treats them as absent.

### Other specs to update

Grep `withRotation`, `generateNewClientId`, `persistClientId`. Known set:

- **`withRotation` removed:** `clean-slate.service.spec.ts`,
  `backup.service.spec.ts`, `clean-slate-interrupt.integration.spec.ts`,
  `operation-log.effects.spec.ts` — delete `withRotation` mocks/expectations;
  the `ClientIdService` spy surface becomes `getOrGenerateClientId` (+ no manual
  cache handling — `runDestructiveStateReplacement` owns `clearCache`).
- **`generateNewClientId` removed:** `client-id.provider.spec.ts`,
  `sync-hydration.service.spec.ts`,
  `legacy-data-migration.integration.spec.ts` — remove it from
  `jasmine.createSpyObj` arrays; `client-id.provider.spec.ts:15` assertion
  dropped.
- **`operation-log-migration.service.spec.ts`:** `persistClientId` is **kept**,
  so its tests at `:418`/`:434` largely stand; only swap the `generateNewClientId`
  spy/`callFake` (incl. the manual logic at `:374-379`) for
  `getOrGenerateClientId`.

### Test teardown

`_clearAllDataForTesting()` clears `SUP_OPS.client_id` but not
`ClientIdService._cachedClientId` (separate service/connection). Specs that clear
data then expect a fresh id must also call `clientIdService.clearCache()`. Most
`_clearAllDataForTesting()` callers never mint a clientId mid-test, so the blast
radius is small — but the relocated/rewritten spec and the caller specs must be
audited.

## Risks & mitigations

1. **Non-regenerable clientId (lead risk).** `pf` is never deleted or written.
   `_resolve()` only ever _copies_; a failed copy still returns the valid `pf`
   id. `getOrGenerateClientId()` generates **only** after reads succeed and
   confirm absence everywhere — a transient failure throws, never generates.
   Worst case is a redundant copy.
2. **No downgrade support.** Downgrading past v6 → `VersionError` → op-log dead
   regardless of the clientId. True of every prior schema bump; not regressed,
   not pretended-to-be-supported. No `pf` mirror.
3. **Init ordering.** Eliminated — `_resolve()` self-heals on first read.
4. **Multi-tab.** `_putClientIdIfAbsent`'s single-tx CAS converges concurrent
   same-origin runs. Mixed-version tabs cannot serialize, but an old app post-v6
   has a `VersionError`'d op-log anyway — non-functional, not a data-loss path.
5. **Schema-upgrade coordination.** The new `ClientIdService` connection gets a
   `versionchange` handler. The pre-existing absence of `versionchange` handlers
   on `OperationLogStoreService`/`ArchiveStoreService` is **out of scope** —
   adding them helps only future (v6→v7) upgrades, not this one, and is left as
   a follow-up to keep this PR's diff minimal.
6. **Legacy genesis-op continuity.** `OperationLogMigrationService`'s clientId
   resolution is unchanged (decision 4); the genesis op keeps using `CLIENT_ID`,
   matching `meta.vectorClock`'s keys.

## Out of scope / follow-ups

The first three are tracked together in **#7735**:

- Relocating `ClientIdService` to `op-log/util/` (a pure rename, ~12 import
  sites) — separate PR.
- Adding `versionchange` handlers to `OperationLogStoreService` /
  `ArchiveStoreService`.
- Breaking the `OperationLogStoreService` ↔ `CLIENT_ID_PROVIDER` DI cycle to
  collapse onto one shared `SUP_OPS` connection.

Not yet tracked:

- Tightening `isValidClientIdFormat` (the legacy `length >= 10` branch accepts
  almost any string) — pre-existing, not this PR.
- Deleting the `pf` database — it remains a read-only fallback.

## Sequencing

#7712 is merged. Land as a single PR: the schema bump, the service rewrite, and
the caller rewrites are interdependent and cannot be split safely.
