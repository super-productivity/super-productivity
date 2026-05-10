# `@sp/sync-core` Extraction Plan

> **Status: In progress — PR 1 landed**

**Goal:** Carve the sync engine out of `src/app/op-log/` into a reusable, framework-agnostic, **domain-agnostic** `@sp/sync-core` package, plus a sibling `@sp/sync-providers` for the bundled provider implementations.

## Context

The sync frontend lives in `src/app/op-log/` (the older `src/app/pfapi/` is legacy and out of scope). It already organizes itself by concern (`core`, `sync`, `apply`, `capture`, `persistence`, `encryption`, `validation`, `util`, `model`, `sync-providers`), but the boundary is convention-only: the engine reaches into NgRx state, `core/entity-registry.ts` hardcodes imports from 15+ feature reducers, and providers and engine code intermix freely.

The eventual target is a **three-concern split**:

1. **Sync logic / engine** — operation orchestration, vector clocks, conflict resolution, persistence interface. Framework-agnostic AND domain-agnostic (knows nothing about Super Productivity).
2. **Configuration** — entity registry, model config, app-specific wiring, action-type enums, entity-type unions, repair payload shapes, provider lists. Lives in the app.
3. **Provider implementations** — SuperSync, Dropbox, WebDAV, LocalFile. Pluggable, talk to the engine through a stable interface.

## What stays in the app — domain rule

Anything that names a Super Productivity domain object, enum value, or wire convention belongs in the app, not in the lib. The lib carries `actionType` and `entityType` as plain `string`; the app narrows via `Omit`-and-extend on top of the lib's generic `Operation`.

App-only forever:

- **`ActionType` enum** (200 lines of NgRx action strings: METRIC, BOARD, TAG, PROJECT, etc.) — host-app config, not lib content.
- **`ENTITY_TYPES` / `EntityType` union** — TASK, PROJECT, TAG, METRIC, BOARD, etc. is SP's domain. Lib uses `string`; app narrows.
- **`SyncImportReason` union** — `'PASSWORD_CHANGED' | 'FILE_IMPORT' | 'BACKUP_RESTORE' | 'FORCE_UPLOAD' | 'SERVER_MIGRATION' | 'REPAIR'` are SP's specific import flows.
- **`RepairSummary`, `RepairPayload`** — SP's repair-output shape.
- **`WrappedFullStatePayload` + `extractFullStateFromPayload` + `assertValidFullStatePayload`** — the `appDataComplete` wrapper and the `['task','project','tag','globalConfig']` key-presence check are SP wire format.
- **`SyncProviderId` enum** (`Dropbox | WebDAV | LocalFile | SuperSync | Nextcloud`), `OAUTH_SYNC_PROVIDERS`, `REMOTE_FILE_CONTENT_PREFIX = 'pf_'`, `PRIVATE_CFG_PREFIX = '__sp_cred_'` — SP's bundled providers and SP-flavored storage prefixes.
- **`@sp/shared-schema`** itself — that package is also SP-coupled (server + SP client), so the lib must not depend on it.

Anywhere the lib needs to enumerate domain values (e.g. LWW update action types are derived from the entity-type list), it exposes a **factory** that takes the list as input. The app instantiates the factory once with its `ENTITY_TYPES`.

---

## PR 1 — Thin first slice (landed)

Stand up `packages/sync-core/` with the pieces that are both framework-agnostic and domain-agnostic. No behavior change. Establishes the import boundary and the `@sp/sync-core` alias so subsequent PRs can do harder work against a real package boundary instead of a notional one.

### Goals

- Create `packages/sync-core/` mirroring the existing `@sp/shared-schema` package shape.
- Move only generic, domain-agnostic primitives. The lib must contain **no Super Productivity-specific identifiers, enums, unions, or shapes** — those stay in the app and feed the lib via configuration.
- Move only framework-agnostic code (no `@Injectable`, no `inject()`, no NgRx, no Angular Material).
- Keep the rest of `src/app/op-log/` working unchanged via re-export stubs at the original paths.
- Zero behavior change. All unit tests and E2E tests pass without modification.

### Non-goals (deferred to follow-up PRs)

- Moving `core/entity-registry.ts` (hardcoded feature imports — needs parameterization).
- Moving anything under `op-log/sync/`, `apply/`, `capture/`, `persistence/`, or `model/` (Angular-coupled or feature-coupled).
- Extracting providers themselves.
- Defining new abstract `SyncEngine` / `SyncConfig` interfaces.
- Adding ESLint module-boundary rules.

### What landed in `@sp/sync-core` initial contents

Source: `packages/sync-core/src/`. All exports from `index.ts`. No Angular, no NgRx, no `@sp/shared-schema` dep, no SP identifiers.

**Operation primitives** (`operation.types.ts`):

- `OpType` enum (CRUD + sync ops: `Create | Update | Delete | Move | Batch | SyncImport | BackupImport | Repair`)
- `Operation` (with `actionType: string`, `entityType: string`, no `syncImportReason`)
- `OperationLogEntry`, `EntityConflict`, `ConflictResult`, `EntityChange`, `MultiEntityPayload`
- `VectorClock = Record<string, number>` (defined locally — no shared-schema dep)
- `FULL_STATE_OP_TYPES`, `isFullStateOpType`, `isMultiEntityPayload`, `extractActionPayload`

**LWW factory** (`lww-update-action-types.ts`):

- `createLwwUpdateActionTypeHelpers<TEntityType>(entityTypes)` returns `{ LWW_UPDATE_ACTION_TYPES, isLwwUpdateActionType, getLwwEntityType, toLwwUpdateActionType }`. App calls this once with its `ENTITY_TYPES`.

**Apply types** (`apply.types.ts`):

- `ApplyOperationsResult`, `ApplyOperationsOptions` — generic over the lib's Operation.

**Utilities**:

- `toEntityKey`, `parseEntityKey` (`entity-key.util.ts`) — string-typed.
- `SyncStateCorruptedError` (`sync-state-corrupted.error.ts`).

Build output: ESM 2.43 KB, DTS 10.46 KB.

### App stubs (preserve existing call sites)

Each previously-public symbol path keeps working via thin shims:

- `src/app/op-log/core/operation.types.ts` — re-exports lib's generic types, redeclares **SP-narrowed** `Operation`, `OperationLogEntry`, `EntityChange`, `EntityConflict`, `ConflictResult`, `MultiEntityPayload` via `Omit`-and-extend (narrowing `actionType` to the local `ActionType` enum and `entityType` to the `EntityType` union from `@sp/shared-schema`, adding `syncImportReason?: SyncImportReason`). Hosts SP-specific helpers locally: `WrappedFullStatePayload`, `isWrappedFullStatePayload`, `extractFullStateFromPayload`, `assertValidFullStatePayload`, `RepairSummary`, `RepairPayload`, `SyncImportReason`, plus a SP-narrowed `isMultiEntityPayload` type guard that delegates to the lib at runtime.
- `src/app/op-log/core/types/apply.types.ts` — redeclares `ApplyOperationsResult` / `ApplyOperationsOptions` with the app's narrow `Operation`.
- `src/app/op-log/core/lww-update-action-types.ts` — calls `createLwwUpdateActionTypeHelpers(ENTITY_TYPES)` once and re-exports the resulting helpers.
- `src/app/op-log/core/sync-state-corrupted.error.ts` — re-exports from lib.
- `src/app/op-log/sync-providers/provider.const.ts` — **stays as full source** (SP-specific provider enum and prefixes; never moved into the lib).
- `src/app/op-log/core/action-types.enum.ts` — **stays as full source** (200-line SP feature action enum).
- `src/app/op-log/sync-exports.ts` — barrel updated to source generic types via `@sp/sync-core` and SP-specific provider const from local.

### Workspace plumbing

Mirrors `packages/shared-schema/`.

- `packages/sync-core/package.json` — `@sp/sync-core`, `tsup` build, dual ESM/CJS output, no runtime deps (no `@sp/shared-schema`, no Angular, no NgRx).
- `packages/sync-core/tsconfig.json` — strict, isolatedModules, ES2022 target.
- `packages/sync-core/tsup.config.ts` — entry `src/index.ts`, dts on, sourcemaps on.
- `packages/sync-core/.gitignore` — `dist/`, `node_modules/`.
- Root `tsconfig.base.json` — `"@sp/sync-core": ["packages/sync-core/src/index.ts"]` in `paths`.
- Root `src/tsconfig.spec.json` — same alias added (this file _overrides_ `paths`, doesn't extend; without this the spec build resolves via `node_modules/@sp/sync-core/dist/`).
- Root `package.json` — `"sync-core:build": "cd packages/sync-core && npm run build"` chained into `prepare` after `shared-schema:build`.
- `packages/build-packages.js` — registers `sync-core` in the explicit list (after `shared-schema`, before `plugin-api`).

### Verification (per PR 1)

1. `cd packages/sync-core && npx tsup` — package builds clean, zero Angular/NgRx/shared-schema imports leak in.
2. `npx tsc -p src/tsconfig.app.json --noEmit` — app type-checks.
3. `npm run checkFile` on every touched `.ts` file — lint/format clean.
4. `npm test` (or scoped op-log run via `npx ng test --watch=false --include 'src/app/op-log/**/*.spec.ts'`) — all specs pass without modification.
5. App boot + smoke (manual sync, conflict round-trip, encryption toggle).
6. SuperSync E2E suite.
7. Boundary check: `grep -r "from '@angular\|from '@ngrx\|from '@sp/shared-schema\|src/app" packages/sync-core/src/` — must return nothing.

---

## Follow-up PRs

Each PR below is self-contained; do not bundle them. They are ordered so each builds on the previous one's boundaries without churn.

**Domain rule applies to every PR**: nothing Super Productivity-specific lands in the lib. Any place where the engine needs a domain enum or list, expose a port or factory and feed it from the app at boot. SP `EntityType`/`ENTITY_TYPES`, `ActionType`, `SyncImportReason`, `SyncProviderId`, `appDataComplete` wire format etc. all stay app-side forever.

### PR 2 — Parameterize `core/entity-registry.ts` and add a logger port

**Goals (two related decouplings, can be one PR or split if it gets too big):**

1. **Entity registry as config.** Move the _abstract_ `EntityConfig` / `EntityRegistry` types into `@sp/sync-core`; keep the _wiring_ (the actual feature imports) in the app. This is the single biggest decoupling step — `entity-registry.ts` is what currently makes the engine reach into 15+ feature reducers.
2. **Logger port.** Define a tiny `SyncLogger` interface in `@sp/sync-core` so the next round of moves (`encryption/`, `core/errors/sync-errors.ts`, `util/sync-file-prefix.ts`) can drop their `OpLog` dependency. App provides an `OpLog`-backed adapter at boot.

**What changes for the entity registry:**

- Define `EntityConfig` and `EntityRegistry` _types_ in `@sp/sync-core/src/entity-registry.types.ts`. The lib must not enumerate SP entity types — registry keys are `string`, the app supplies the concrete keys. Shape:
  ```ts
  type EntityKind = 'adapter' | 'singleton' | 'map';
  interface EntityConfig<S = unknown, A = unknown> {
    kind: EntityKind;
    initialState: S;
    adapter?: EntityAdapter<A>; // for 'adapter' kind, structural shape
    selectIds?: (s: S) => string[]; // for 'map' kind
    // ...whatever the current registry exposes, generically typed
  }
  type EntityRegistry = Record<string, EntityConfig>;
  ```
- Replace the hardcoded registry object in `src/app/op-log/core/entity-registry.ts` with a `buildEntityRegistry()` function that returns an `EntityRegistry` constructed from the feature imports. Keep this function in the app — it is SP config, not engine.
- Anything in `op-log/` that today imports the registry directly should instead receive it via DI (e.g. an `ENTITY_REGISTRY` `InjectionToken` provided in `AppModule`/root config).
- Engine code in `@sp/sync-core` (added in PR 3) consumes the typed `EntityRegistry`; it never imports from `src/app/features/*`.

**What changes for the logger port:**

- Define `SyncLogger` interface in the lib with the methods actually used by the moveable files: `log`, `err`, `normal`, `verbose`, `info`, `warn`, `critical`, `debug`. Match the `OpLog` surface shape-only.
- Provide a no-op default the lib's tests can use.
- App registers an `OpLog`-backed adapter when composing the engine.
- This unlocks moving (in this PR or PR 3a): `op-log/encryption/`, `op-log/core/errors/sync-errors.ts`, `op-log/util/sync-file-prefix.ts`.

**Risks / things to verify:**

- `@ngrx/entity` types: keep `EntityAdapter` typed as a structural shape (`{ getInitialState, addOne, ... }`) so the package stays free of the NgRx runtime dep.
- Any selector-based code in `op-log/core/` that consumes the registry needs to be checked for app-store coupling (per CLAUDE.md sync-correctness rule #2).
- The `OpLog` history-recording behavior must be preserved end-to-end — the app adapter forwards every call to the real `OpLog`. Verify by running through the log export feature manually.

**Verification:**

- `npm test` — registry-related specs.
- App boot + sync round-trip (same as PR 1).
- `grep -r "from 'src/app/features\|from '@angular\|from '@ngrx\|@sp/shared-schema" packages/sync-core/src/` returns nothing.
- Manual: run the log export flow and confirm sync/encryption events still appear.

---

### PR 3a — Pure algorithmic core into `@sp/sync-core`

**Goal:** Move the framework-agnostic, stateless sync algorithms — the parts that don't talk to NgRx, IndexedDB, or any UI. These are pure-ish functions plus small helpers; they only need the `SyncLogger` port from PR 2.

**Why split it from 3b:** these pieces are mechanically liftable (no port surface beyond logger) and have most of the meaningful test coverage. Landing them first lets us validate the algorithms-vs-orchestration split before introducing four new ports in PR 3b.

**What moves into `packages/sync-core/src/`:**

- **Vector-clock client wrapper** — the `VectorClock` helpers currently in `src/app/core/util/vector-clock.ts` (`incrementVectorClock`, `mergeVectorClocks`, `compareVectorClocks` wrapper, `limitVectorClockSize` wrapper, `vectorClockToString`, `hasVectorClockChanges`, `isValidVectorClock`, `sanitizeVectorClock`). The `Subject` for prune notifications becomes a `(event) => void` callback the app wires up. `OpLog` calls go through the `SyncLogger` port.
- **Conflict detection / resolution algorithms** — the pure parts of `op-log/sync/conflict-resolution.service.ts`: detecting concurrent ops, choosing winners by LWW timestamp+clientId tiebreak, building merged vector clocks. The `SnackService` call (the user-facing notification) stays app-side as a port adapter; the algorithm core moves.
- **Op validation** — pure shape checks in `op-log/validation/`: `validate-operation-payload.ts` (already mostly pure), `validate-state.service.ts` shape-only checks. Anything that calls into NgRx selectors stays in PR 3b.
- **Filtering / partitioning helpers** — anything in `op-log/sync/` that computes "which ops are local-only", "which need uploading", "which conflict" given inputs. Functions that take `OperationLogEntry[]` and return derived data.
- **Op merging** — combining local and remote op streams by vector clock order. Currently scattered across `remote-ops-processing.service.ts` and `operation-log-sync.service.ts`; extract the pure merge into the lib.
- **Encryption + compression** — `op-log/encryption/` (already-pure crypto, blocked in PR 1 only by `OpLog` dep, unblocked by PR 2's logger port).
- **`op-log/util/sync-file-prefix.ts`** — was blocked in PR 1 by `sync-errors` dep; unblocked once errors move (also in this PR).
- **`op-log/core/errors/sync-errors.ts`** — drops `OpLog` import, uses `SyncLogger` instead.

**What stays in the app (ports come in PR 3b):**

- Anything that calls `Store.dispatch()` or reads from `Store.select()` directly.
- `OperationLogStoreService` (IndexedDB).
- The four UI-coupled services (dialogs, snack).
- Effects, meta-reducers in `capture/`.
- `OperationApplierService.applyOperations()` — moves in 3b once `ActionDispatchPort` exists.
- Anything that reads sync config from NgRx state.

**Migration mechanics:**

- Replace `inject(X)` / `@Injectable` with plain functions or classes that take dependencies as constructor args. Most of the algorithmic code is already function-shaped.
- Specs co-located with the moved files become vitest specs in the package. Specs that depend on `TestBed` stay app-side and re-test the integrated behaviour.
- Internal cross-imports inside the package use relative paths; app callers continue to import from the in-app stub paths (now re-exporting from `@sp/sync-core`).

**Risks:**

- The vector-clock client wrapper is on the hottest sync path; touch with care. Keep behavior bit-identical — the only change is logger calls go through the port.
- `SyncStateCorruptedError` is already in the lib (PR 1) — make sure new lib code throws it consistently.
- Any function that _looks_ pure but secretly reaches into the NgRx Store (rare but possible) needs to be flagged before moving.

**Verification:**

- `cd packages/sync-core && npm test` — vitest suite for moved algorithms (port from Karma where they came with specs).
- Full app `npm test` — integration specs against the in-app stub paths still pass.
- `grep -rn "from '@angular\|from '@ngrx\|@sp/shared-schema\|src/app" packages/sync-core/src/` — still empty.
- Manual: sync round-trip, encryption toggle, conflict scenario.

---

### PR 3b — Orchestrators behind ports

**Goal:** Move the _stateful orchestrators_ — services that drive the upload/download loop, replay ops, and coordinate with the rest of the app. These are where the app/lib boundary becomes load-bearing, so they land behind ports introduced in this PR.

**Ports introduced in `@sp/sync-core`** — all generic, no SP identifiers:

- `OperationStorePort` — abstract over today's `OperationLogStoreService` (read/write op-log entries to IndexedDB). Method names use `Operation` / `OperationLogEntry`, never `Task` or `Project`.
- `ActionDispatchPort` — abstract over `Store.dispatch()`. App-side adapter wraps the NgRx Store. Takes `{ type: string; meta?: ...; [key: string]: unknown }` — no app-action-type union in the lib.
- `ConflictUiPort` — methods like `confirmImportConflict(...)`, `notifyLwwResolution(...)`. The "reason" parameter is `string`, not the SP `SyncImportReason` union — the app dialog adapter narrows.
- `SyncConfigPort` — read sync config (provider id, encryption settings, interval). The provider-id parameter is `string`, not `SyncProviderId` (which stays SP-specific). App-side adapter selects from NgRx state via `selectSyncConfig` (`features/config/store/global-config.reducer.ts:92`).
- `RepairPort` (if needed) — generic repair-summary shape; app's `RepairSummary` with the concrete fields stays in the stub.

**What moves into `packages/sync-core/src/`:**

- `OperationLogSyncService` — upload/download orchestrator, decides what to push and pull.
- `OperationApplierService` — replays ops via `ActionDispatchPort` (preserves the bulk-dispatch yield from CLAUDE.md rule #6).
- `OperationLogUploadService` — batch + retry logic, uses `OperationStorePort`.
- `RemoteOpsProcessingService` — applies remote ops, marks application status, retries failed.
- `op-log/persistence/` — the parts that don't reach into NgRx; the `OperationLogStoreService` itself stays in app as the `OperationStorePort` implementation.
- Whatever remains in `op-log/sync/` that isn't already moved (3a) and isn't UI-coupled.

**What stays in the app (cannot be moved):**

Per Phase 1 exploration, four files have unavoidable Angular UI dependencies and stay app-side as adapters:

- `op-log/sync/sync-import-conflict-dialog.service.ts` (MatDialog)
- `op-log/sync/server-migration.service.ts` (MatDialog)
- `op-log/sync/conflict-resolution.service.ts` (the SnackService call — the algorithmic core moved in 3a)
- `op-log/sync/operation-log-download.service.ts` (SnackService — only the toast call)

Plus all NgRx-coupled glue: `OperationLogStoreService`, anything that calls `Store.dispatch()` directly, meta-reducers in `capture/`, effects using `inject(LOCAL_ACTIONS)` (CLAUDE.md rule #1).

**Migration mechanics:**

- Each moved service: replace `@Injectable` with a plain class, replace `inject(X)` with constructor parameters. The app composes the engine at boot via a small `createSyncEngine({ storePort, dispatchPort, conflictUi, syncConfig, logger })` factory, passing in adapters that satisfy the ports.
- The four UI-coupled services stay in `src/app/op-log/sync/` as port implementations.
- `LOCAL_ACTIONS` and meta-reducer wiring stays app-side (CLAUDE.md sync-correctness rule #1).

**Risks (high — this is the biggest PR of the series):**

- `OperationApplierService.applyOperations()` has the bulk-dispatch yield (`await new Promise(r => setTimeout(r, 0))` per CLAUDE.md rule #6) — preserve this exactly when moving.
- The dispatch port must preserve action shape _and_ `meta` exactly (CLAUDE.md rule #1: effects use `inject(LOCAL_ACTIONS)` to filter remote ops; the meta-flag pattern must round-trip).
- Many services have spec files; the ones that import Angular testing utilities need to be rewritten for vitest, or kept app-side as integration tests against the port adapters. Default: keep specs alongside the moved code, port to vitest.
- Effects must continue to use `inject(LOCAL_ACTIONS)`. Any effect that moves needs its action stream injected via a port instead.
- Concurrent sync race conditions are the main runtime risk — the SuperSync E2E scenarios are the primary safety net.

**Verification:**

- `cd packages/sync-core && npm test` — full engine spec suite.
- Full app `npm test` — adapter specs.
- `npm run e2e` — sync-related E2E (see `e2e/CLAUDE.md` for SuperSync setup).
- Smoke: encryption toggle, conflict scenario, fresh-client bootstrap, and the multi-client SuperSync scenarios from `docs/sync-and-op-log/supersync-scenarios.md`.

---

### PR 4 — Lift providers into `@sp/sync-providers`

**Goal:** Pull the four providers out of `src/app/op-log/sync-providers/` so the engine, providers, and config concerns each live in their own package.

**Decision: separate package, not bundled into `@sp/sync-core`.** Reasons:

- Engine doesn't need to know about Dropbox/WebDAV/SuperSync specifics.
- Providers can carry their own (sometimes heavy) deps without bloating the core.
- Keeps the "sync logic vs implementation" split visible at the file system level.

**What moves to `packages/sync-providers/src/`:**

- `op-log/sync-providers/super-sync/`
- `op-log/sync-providers/file-based/dropbox/`
- `op-log/sync-providers/file-based/webdav/` (incl. `nextcloud.ts`)
- `op-log/sync-providers/file-based/local-file/` — **wrinkle:** local-file uses Electron APIs gated behind `IS_ELECTRON` (CLAUDE.md project rules). Keep the Electron bridge in the app, expose a port the local-file provider calls into.
- `op-log/sync-providers/provider-manager.service.ts` — split: the _engine-facing_ provider registry/factory moves to the package; the part that reads `selectSyncConfig` from NgRx stays in the app and feeds config in via the `SyncConfigPort` from PR 3b.

**What stays in the app:**

- `op-log/sync-providers/credential-store.service.ts` — Angular `@Injectable` wrapper. The provider package depends on the `SyncCredentialStore<PID>` _interface_ (extract it in this PR — not done in PR 1 because `provider.interface.ts` couldn't move yet).
- OAuth callback handling (`src/app/imex/sync/oauth-callback-handler.service.ts`) — Angular Router-coupled.
- Any provider config UI / dialogs.
- `SyncProviderId` enum and `OAUTH_SYNC_PROVIDERS` set — these are SP's bundled-provider list. The provider package defines its own per-provider IDs as `string` constants; `SyncProviderId` stays in the app as the union of all bundled IDs.

**Risks:**

- HTTP clients: providers currently use `HttpClient` (Angular). The package can't depend on Angular, so providers should switch to `fetch` (already the case for some). Verify each provider before moving — non-trivial for any that use `HttpInterceptor`s.
- Dropbox/WebDAV `webdav.config.ts` has provider-specific config that may import from `features/config` — audit and parameterize.

**Verification:**

- Per-provider unit specs in the package.
- E2E sync round-trip per provider (Dropbox, WebDAV, LocalFile, SuperSync) — `npm run e2e:file <path>` for each.
- Snapshot bootstrap from a fresh client (file-based providers).

---

### PR 5 — ESLint boundary rule (belt-and-braces)

**Goal:** Add a `no-restricted-imports` rule to `eslint.config.js` preventing the packages from importing app code, even by accident.

**What changes:**

- `eslint.config.js`: add a rule scoped to `packages/sync-core/**` and `packages/sync-providers/**`:
  ```js
  'no-restricted-imports': ['error', {
    patterns: [
      { group: ['src/app/*', '../../**/src/app/*'], message: 'Sync packages must not import from the app.' },
      { group: ['@angular/*', '@ngrx/*'], message: 'Sync packages must stay framework-agnostic.' },
    ],
  }]
  ```
- Note: `eslint.config.js` currently _ignores_ `packages/**`. Reverse that to ignore only `packages/plugin-dev/**` / `packages/super-sync-server/**` (or whatever is appropriate) so `sync-core` / `sync-providers` are linted.

**Verification:**

- `npm run lint` — should pass clean.
- Add a deliberately-bad import in a throwaway commit and verify the rule fires; revert.

---

## Summary timeline

| PR             | Scope                                                                                                                                                                                   | Risk        | Touches                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| **1** (landed) | Stand up `@sp/sync-core` with generic, domain-agnostic primitives only (Operation/OpType/VectorClock/conflict types/LWW factory/entity-key util/error class)                            | Low         | 7 files moved as generics, ~8 in-app stubs/redeclarations, 1 alias added in two tsconfigs, 1 barrel rewritten          |
| **2**          | Parameterize `entity-registry.ts` via DI; introduce `SyncLogger` port and move encryption + sync-errors + sync-file-prefix                                                              | Medium      | All op-log code that consumes the registry; everything that uses `OpLog` from the moveable files                       |
| **3a**         | Pure algorithmic core into the lib (vector-clock client wrapper, conflict detection algorithms, op merge, op validation, encryption/compression) — only the `SyncLogger` port is needed | Medium      | `op-log/encryption/`, `op-log/validation/` pure parts, vector-clock util, pieces of `op-log/sync/` conflict resolution |
| **3b**         | Orchestrators behind ports (`OperationStorePort`, `ActionDispatchPort`, `ConflictUiPort`, `SyncConfigPort`) — sync/applier/upload/remote-ops services                                   | High        | Most of `op-log/sync/`, `apply/`, `capture/`, `persistence/`                                                           |
| **4**          | Lift providers into `@sp/sync-providers`                                                                                                                                                | Medium-High | `op-log/sync-providers/`                                                                                               |
| **5**          | ESLint boundary rule                                                                                                                                                                    | Trivial     | `eslint.config.js`                                                                                                     |

After PR 5 the three concerns are physically separate: `@sp/sync-core` is the **domain-agnostic** engine + abstractions, `@sp/sync-providers` is the implementations, and `src/app/op-log/` is just app-side wiring (NgRx adapters, dialog ports, entity-registry composition, `ActionType` enum, `EntityType` union, `SyncImportReason`, `SyncProviderId`, repair shapes, full-state wire format). The lib stays reusable for any host app that wants an op-log + vector-clock sync engine; SP is one such host.
