# `@sp/sync-core` Extraction Plan

> **Status: In progress - PR 1 is under review in #7546**

**Goal:** Carve the sync engine out of `src/app/op-log/` into a reusable,
framework-agnostic, **domain-agnostic** `@sp/sync-core` package, plus a sibling
`@sp/sync-providers` package for bundled provider implementations.

## Context

The sync frontend lives in `src/app/op-log/` (the older `src/app/pfapi/` is
legacy and out of scope). It already organizes itself by concern (`core`,
`sync`, `apply`, `capture`, `persistence`, `encryption`, `validation`, `util`,
`model`, `sync-providers`), but the boundary is convention-only: the engine
reaches into NgRx state, `core/entity-registry.ts` hardcodes imports from 15+
feature reducers, and providers and engine code intermix freely.

The eventual target is a **three-concern split**:

1. **Sync logic / engine** - operation orchestration, vector clocks, conflict
   resolution, persistence interfaces. Framework-agnostic and domain-agnostic.
2. **Configuration** - entity registry, model config, app-specific wiring,
   action-type enums, entity-type unions, repair payload shapes, provider lists.
   Lives in the app.
3. **Provider implementations** - SuperSync, Dropbox, WebDAV, LocalFile.
   Pluggable, and talking to the engine through stable interfaces.

## Domain Rule

Anything that names a Super Productivity domain object, enum value, or wire
convention belongs in the app, not in `@sp/sync-core`. The lib carries
`actionType` and `entityType` as plain `string`; the app narrows via
`Omit`-and-extend on top of the lib's generic `Operation`.

App-only forever:

- **`ActionType` enum** - host-app action catalog, not lib content.
- **`ENTITY_TYPES` / `EntityType` union** - TASK, PROJECT, TAG, METRIC, BOARD,
  etc. are SP's domain. Lib uses `string`; app narrows.
- **`SyncImportReason` union** - SP's specific import flows.
- **`RepairSummary`, `RepairPayload`** - SP's repair-output shape.
- **`WrappedFullStatePayload` + `extractFullStateFromPayload` +
  `assertValidFullStatePayload`** - the `appDataComplete` wrapper and the
  `['task','project','tag','globalConfig']` key-presence check are SP wire
  format.
- **`SyncProviderId`, `OAUTH_SYNC_PROVIDERS`, `REMOTE_FILE_CONTENT_PREFIX`,
  `PRIVATE_CFG_PREFIX`** - SP's bundled providers and SP-flavored storage
  prefixes.
- **`@sp/shared-schema`** - that package is SP-coupled today, so
  `@sp/sync-core` must not depend on it.

Where the lib needs host-specific enumerations, it exposes a factory or config
object and the app supplies values at composition time. The current LWW helper
factory is the model to follow.

## Recommendations From PR #7546 Review

These adjustments should happen before the extraction proceeds beyond the thin
first slice:

1. **Move boundary enforcement up.** Add ESLint/package-boundary checks in the
   next PR, not at the end. Once `packages/sync-core/` exists, accidental
   imports from Angular, NgRx, `src/app`, or `@sp/shared-schema` should fail
   immediately.
2. **Single-source vector-clock algorithms.** The client currently delegates
   comparison/merge/prune behavior to `@sp/shared-schema` for client/server
   parity. Before moving vector-clock code, pick one owner for
   compare/merge/prune and have the other package/server import or re-export it.
   Do not duplicate the algorithms.
3. **Treat full-state operation classification as configuration.** PR 1 keeps
   `OpType.SyncImport`, `OpType.BackupImport`, and `OpType.Repair` in the
   generic package for compatibility. Before the engine becomes reusable, make
   full-state operation classification configurable or explicitly document those
   op types as host-defined strings.
4. **Do not move `OperationApplierService` wholesale.** It currently coordinates
   NgRx bulk dispatch, hydration windows, archive side effects, and deferred
   local actions. Extract a small core replay contract/state machine first,
   leaving the Angular/SP choreography in the app until the port boundary has
   proven itself.
5. **Make logger metadata privacy-safe.** `CLAUDE.md` forbids logging user
   content into exportable logs. The `SyncLogger` port should make this explicit
   by accepting only safe, structured metadata and documenting that payloads/full
   entities must not be logged.
6. **Add package tests before moving algorithms.** `@sp/sync-core` can start
   with build-only checks, but PR 3a should first introduce the package test
   runner and then port algorithm specs.
7. **Keep provider extraction separate.** Do not let `@sp/sync-core` learn
   provider IDs, file prefixes, OAuth behavior, credential storage, or bundled
   provider lists.

## PR 1 - Thin First Slice (#7546)

Stand up `packages/sync-core/` with pieces that are framework-agnostic and
mostly domain-agnostic. No behavior change. Establishes the import boundary and
the `@sp/sync-core` alias so later PRs work against a real package boundary.

### Goals

- Create `packages/sync-core/` mirroring the existing package shape.
- Move only generic primitives and helpers.
- Move only framework-agnostic code: no `@Injectable`, no `inject()`, no NgRx,
  no Angular Material.
- Keep existing `src/app/op-log/` call sites working through stubs at the
  original paths.
- Keep `ActionType`, provider constants, full-state payload wrappers, repair
  payload shapes, and import reasons app-side.
- Avoid behavior changes.

### Current Contents

Source: `packages/sync-core/src/`. All exports come through `index.ts`.

**Operation primitives** (`operation.types.ts`):

- `OpType` enum.
- `Operation` with `actionType: string` and `entityType: string`.
- `OperationLogEntry`, `EntityConflict`, `ConflictResult`, `EntityChange`,
  `MultiEntityPayload`.
- `VectorClock = Record<string, number>`.
- `FULL_STATE_OP_TYPES`, `isFullStateOpType`, `isMultiEntityPayload`,
  `extractActionPayload`.

**LWW factory** (`lww-update-action-types.ts`):

- `createLwwUpdateActionTypeHelpers<TEntityType>(entityTypes)` returns
  `LWW_UPDATE_ACTION_TYPES`, `isLwwUpdateActionType`, `getLwwEntityType`, and
  `toLwwUpdateActionType`.
- The app instantiates it once with `ENTITY_TYPES`.

**Apply types** (`apply.types.ts`):

- `ApplyOperationsResult`, `ApplyOperationsOptions` over the lib's generic
  `Operation`.

**Utilities**:

- `toEntityKey`, `parseEntityKey`.
- `SyncStateCorruptedError`.

### App Stubs

Each previously-public symbol path keeps working via thin shims:

- `src/app/op-log/core/operation.types.ts` re-exports generic symbols and
  redeclares SP-narrowed `Operation`, `OperationLogEntry`, `EntityChange`,
  `EntityConflict`, `ConflictResult`, and `MultiEntityPayload`.
- `src/app/op-log/core/types/apply.types.ts` redeclares app-narrowed apply
  result/options types.
- `src/app/op-log/core/lww-update-action-types.ts` instantiates the LWW helper
  factory with `ENTITY_TYPES`.
- `src/app/op-log/core/sync-state-corrupted.error.ts` re-exports from the
  package.
- `src/app/op-log/util/entity-key.util.ts` re-exports from the package.
- `src/app/op-log/core/action-types.enum.ts` stays full source in the app.
- `src/app/op-log/sync-providers/provider.const.ts` stays full source in the app.

### PR 1 Follow-Ups Before Merge

- Update the PR description if it still says `action-types.enum.ts` or
  `provider.const.ts` moved into `@sp/sync-core`; the code correctly keeps them
  app-side.
- Fix comments that imply `sync-core` depends on `shared-schema`. The build may
  run after `shared-schema`, but the package dependency direction must remain
  absent.
- Decide whether `FULL_STATE_OP_TYPES` is acceptable compatibility debt for PR 1
  or whether it should already become app-configurable.

### Verification

1. `cd packages/sync-core && npx tsup` - package builds clean.
2. `npx tsc -p src/tsconfig.app.json --noEmit` - app type-checks.
3. `npm run checkFile` on every touched `.ts` file.
4. `npm test` or scoped op-log specs.
5. App boot plus manual sync smoke: sync round-trip, conflict round-trip,
   encryption toggle.
6. SuperSync E2E when the branch is ready for merge.
7. Boundary check returns nothing:

   ```bash
   grep -r "from '@angular\\|from '@ngrx\\|from '@sp/shared-schema\\|src/app" packages/sync-core/src/
   ```

---

## PR 2 - Boundary Guardrails, Entity Registry Types, Logger Port

This replaces the original late ESLint PR. Boundary guardrails should land
immediately after the package exists.

### Goals

1. **Add package boundary enforcement.** Lint `packages/sync-core/**` and reject
   imports from Angular, NgRx, `src/app`, and `@sp/shared-schema`.
2. **Entity registry as config.** Move abstract registry types into
   `@sp/sync-core`; keep SP feature imports and registry construction in the app.
3. **Logger port.** Define a privacy-aware `SyncLogger` interface in
   `@sp/sync-core` so moveable files can drop direct `OpLog` imports.

### Boundary Enforcement

- Update `eslint.config.js` so `packages/sync-core/**` is linted.
- Add `no-restricted-imports` for:
  - `@angular/*`
  - `@ngrx/*`
  - `@sp/shared-schema`
  - `src/app/*` and relative app imports such as `../../src/app/*`
- Keep package exceptions explicit for packages that cannot yet be linted.
- Add the same rule for `packages/sync-providers/**` once that package exists.

### Entity Registry Types

Define `EntityConfig` / `EntityRegistry` types in
`@sp/sync-core/src/entity-registry.types.ts`, but make the shape reflect the
current registry, not a simplified example.

Required storage patterns:

```ts
type EntityStoragePattern = 'adapter' | 'singleton' | 'map' | 'array' | 'virtual';
```

Guidelines:

- Registry keys are `string`; the app narrows them to `EntityType`.
- Selectors are structural function types; the package must not import NgRx
  selector types.
- Adapter support is structural, not `@ngrx/entity`-typed. Include only the
  methods actually consumed by op-log code.
- Include `payloadKey`, `featureName`, `mapKey`, and `arrayKey` if current
  consumers need them.
- Keep `SINGLETON_ENTITY_ID` generic if it remains engine-relevant; otherwise
  keep it in the app.

App-side changes:

- Replace the hardcoded exported registry with `buildEntityRegistry()` in
  `src/app/op-log/core/entity-registry.ts`.
- Provide an `ENTITY_REGISTRY` injection token in app code for services that
  should stop importing the registry singleton directly.
- Keep all feature reducer/selector imports in the app.

### Logger Port

Define `SyncLogger` in the lib:

```ts
export type SyncLogMeta = Record<string, string | number | boolean | null | undefined>;

export interface SyncLogger {
  log(message: string, meta?: SyncLogMeta): void;
  err(message: string, error?: unknown, meta?: SyncLogMeta): void;
  normal(message: string, meta?: SyncLogMeta): void;
  verbose(message: string, meta?: SyncLogMeta): void;
  info(message: string, meta?: SyncLogMeta): void;
  warn(message: string, meta?: SyncLogMeta): void;
  critical(message: string, meta?: SyncLogMeta): void;
  debug(message: string, meta?: SyncLogMeta): void;
}
```

Also provide a `NOOP_SYNC_LOGGER` for tests and package defaults.

Privacy rule: logger metadata must not include full entities, operation payloads,
task titles, note text, raw provider responses, credentials, or encryption
material. IDs, counts, op IDs, action strings, entity types, and error names are
acceptable.

### What This Unlocks

After this PR, files blocked only by `OpLog` can move without creating a package
dependency on app logging:

- `op-log/encryption/`
- `op-log/core/errors/sync-errors.ts`
- `op-log/util/sync-file-prefix.ts`

### Verification

- `npm run lint` proves package boundary rules are active.
- Add and revert one deliberately-bad package import to prove the rule fails.
- `npm test` for registry-related specs.
- App boot + sync round-trip.
- Manual log export flow: sync/encryption events still appear and do not expose
  user content.

---

## PR 3a - Vector-Clock Ownership and Package Test Harness

Do this before moving more algorithms. Vector-clock parity is load-bearing for
sync correctness.

### Goals

1. Pick the single source of truth for vector-clock compare/merge/prune logic.
2. Add a package test runner for `@sp/sync-core`.
3. Port existing vector-clock tests before changing call sites.

### Preferred Direction

Make `@sp/sync-core` own generic vector-clock algorithms:

- `compareVectorClocks`
- `mergeVectorClocks`
- `limitVectorClockSize`
- `MAX_VECTOR_CLOCK_SIZE`
- validation/sanitization helpers if they are shared by client/server

Then update the current server/shared package path to consume or re-export that
implementation. If dependency direction makes that awkward, create a smaller
shared vector-clock package instead. The important constraint is one
implementation, not two copies.

### Migration Notes

- Preserve client null/undefined wrapper behavior exactly.
- Preserve `MAX_VECTOR_CLOCK_SIZE = 20`.
- Preserve server ordering: conflict detection first, pruning before storage.
- Replace the RxJS prune `Subject` with a callback/event hook at the package
  boundary.
- Route logging through `SyncLogger`.

### Verification

- Port `src/app/core/util/vector-clock.spec.ts` into package tests where possible.
- Keep app wrapper specs for integration behavior and import compatibility.
- Run package tests, app op-log specs, and boundary grep.

---

## PR 3b - Pure Algorithmic Core

Move framework-agnostic, stateless sync algorithms. These should only need typed
inputs and the logger port.

### What Moves

- Conflict detection and LWW resolution algorithms from
  `op-log/sync/conflict-resolution.service.ts`.
- Filtering/partitioning helpers that operate on `OperationLogEntry[]`.
- Pure op merge helpers currently scattered across `remote-ops-processing.service.ts`
  and `operation-log-sync.service.ts`.
- Pure operation payload validation from `op-log/validation/`, as long as it
  does not import app schemas or NgRx selectors.
- Encryption/compression utilities once `OpLog` is removed.
- `sync-errors.ts` and `sync-file-prefix.ts` if they are generic after
  logger/config cleanup.

### What Stays App-Side

- Anything that calls `Store.dispatch()` or `Store.select()`.
- `OperationLogStoreService` and IndexedDB implementation details.
- UI services: dialogs, snacks, Angular Material.
- Effects, meta-reducers, and `LOCAL_ACTIONS` wiring.
- App schema validation tied to SP model shape.
- Full-state payload wrappers and SP repair payloads.

### Verification

- Package test suite for moved algorithms.
- Full app `npm test` for integration through stubs.
- Boundary grep stays empty.
- Manual sync round-trip, encryption toggle, and conflict scenario.

---

## PR 4a - Port Contracts Only

Introduce orchestration ports without moving the orchestrators yet. This reduces
the risk of the later service moves.

### Ports

- `OperationStorePort` - abstract over op-log persistence. Method names use
  `Operation` / `OperationLogEntry` only.
- `ActionDispatchPort` - abstract over dispatching replay actions. Takes generic
  action objects and must preserve `meta` exactly.
- `RemoteApplyWindowPort` - abstracts `HydrationStateService` behavior: start
  remote apply, end remote apply, post-sync cooldown.
- `DeferredLocalActionsPort` - abstracts
  `OperationLogEffects.processDeferredActions()`.
- `ArchiveSideEffectPort` - abstracts archive-specific IndexedDB handling for
  remote operations.
- `ConflictUiPort` - app dialog/snack adapter. Reasons are strings at the
  package boundary.
- `SyncConfigPort` - app adapter around NgRx config selectors. Provider IDs are
  strings at the package boundary.
- `RepairPort` only if truly needed, and with generic shapes.

### Why Split This Out

`OperationApplierService` is not just replay logic. It currently coordinates:

- bulk NgRx dispatch,
- the required event-loop yield after dispatch,
- remote apply windows and cooldowns,
- archive side effects,
- `remoteArchiveDataApplied`,
- deferred local action processing.

Those behaviors should first be represented as ports and tested while the
service remains app-side.

### Verification

- Adapter specs prove app services satisfy the ports.
- Existing app sync specs still pass.
- Add contract tests for action `meta` preservation and bulk-dispatch yield
  behavior.

---

## PR 4b - Move Small Orchestration Units Behind Ports

Move only orchestration code whose dependencies are already represented by ports
and whose behavior can be tested without Angular.

### Candidate Moves

- Upload batching/retry logic from `OperationLogUploadService` if provider and
  store access are ported.
- Remote op processing state machine if applying, marking, and validation are all
  ports.
- Pure parts of download/upload decision logic.

### Keep App-Side Until Proven Safe

- The Angular `OperationApplierService` shell.
- `bulkApplyOperations` action and meta-reducer wiring.
- `HydrationStateService` implementation.
- `ArchiveOperationHandler` implementation.
- Effects using `inject(LOCAL_ACTIONS)`.
- UI-coupled conflict/import/download services.

### Verification

- Package orchestration tests.
- App adapter tests.
- Full app unit tests.
- SuperSync scenarios focused on concurrency, fresh-client bootstrap, server
  migration, and import conflicts.

---

## PR 4c - Revisit `OperationApplierService`

Only after 4a/4b are stable, decide whether any part of
`OperationApplierService` belongs in `@sp/sync-core`.

Acceptable extraction:

- a small generic replay coordinator that calls ports in a strict order;
- contract tests for yielding, failure reporting, archive side-effect ordering,
  and deferred-action flush timing.

Likely app-side permanently:

- NgRx action construction and `bulkApplyOperations`,
- Angular `Injector` usage,
- `remoteArchiveDataApplied`,
- hydration-state implementation,
- archive handler implementation.

Hard requirements from `CLAUDE.md`:

- remote operations must not trigger normal effects;
- selector-based effects must remain guarded by the sync window;
- bulk dispatch must yield after the dispatch;
- remote archive side effects must still run;
- deferred local actions must be processed after remote apply finishes.

---

## PR 5 - Lift Providers Into `@sp/sync-providers`

Pull bundled providers out of `src/app/op-log/sync-providers/` so engine,
providers, and app wiring each live in their own package.

### What Moves

- `op-log/sync-providers/super-sync/`
- `op-log/sync-providers/file-based/dropbox/`
- `op-log/sync-providers/file-based/webdav/` including Nextcloud-specific code
- `op-log/sync-providers/file-based/local-file/`, with Electron APIs behind an
  app-provided port
- provider registry/factory logic that does not read NgRx state directly

### What Stays App-Side

- `SyncProviderId` and bundled provider lists.
- Credential-store Angular service implementation.
- OAuth callback routing.
- Provider config UI/dialogs.
- Electron bridge implementation.
- Any code reading `selectSyncConfig` directly.

### Provider Package Rules

- Provider IDs inside the package are string constants, not the app's
  `SyncProviderId` enum.
- Credential storage is an interface.
- HTTP should use `fetch` or an injected HTTP port, not Angular `HttpClient`.
- Provider package must not import `@sp/sync-core` internals beyond public
  ports/types.

### Verification

- Per-provider unit specs.
- E2E sync round-trip per provider: Dropbox, WebDAV, LocalFile, SuperSync.
- Fresh-client bootstrap for file-based providers.
- Electron-gated LocalFile path smoke test.

---

## PR 6 - Final Boundary Hardening

This is now a final audit rather than the first boundary rule.

### Goals

- Extend the boundary rules to `packages/sync-providers/**`.
- Audit package manifests for accidental runtime deps.
- Audit public exports for SP names and app-only concepts.
- Add a small architecture note that explains the package boundaries and allowed
  dependency direction.

### Verification

- `npm run lint`.
- Boundary grep for both packages.
- Package builds from a clean install.
- Full app unit tests and selected sync E2E.

---

## Summary Timeline

| PR     | Scope                                                      | Risk        | Notes                                  |
| ------ | ---------------------------------------------------------- | ----------- | -------------------------------------- |
| **1**  | Stand up `@sp/sync-core` with generic primitives and stubs | Low         | Current PR #7546                       |
| **2**  | Boundary lint, registry types, privacy-aware logger port   | Medium      | Moves guardrails earlier               |
| **3a** | Vector-clock ownership and package test harness            | Medium      | Prevents algorithm drift               |
| **3b** | Pure algorithmic core                                      | Medium      | No Angular/NgRx/IndexedDB              |
| **4a** | Port contracts only                                        | Medium      | Keeps orchestrators app-side           |
| **4b** | Move small orchestration units behind ports                | High        | Incremental state-machine extraction   |
| **4c** | Revisit `OperationApplierService` extraction               | High        | Extract only if the boundary is proven |
| **5**  | Lift providers into `@sp/sync-providers`                   | Medium-High | Provider deps stay out of core         |
| **6**  | Final boundary hardening and architecture note             | Low         | Audit and lock down                    |

After the final PR, `@sp/sync-core` should be the domain-agnostic sync engine
and abstractions, `@sp/sync-providers` should contain bundled provider
implementations, and `src/app/op-log/` should contain SP-specific wiring: NgRx
adapters, dialog ports, entity-registry composition, `ActionType`, `EntityType`,
`SyncImportReason`, `SyncProviderId`, repair shapes, and full-state wire format.
