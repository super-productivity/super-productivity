# `@sp/sync-core` Extraction Record

> **Status: completed for this extraction branch.** `@sp/sync-core` and
> `@sp/sync-providers` are in place, the frontend imports through package
> boundaries and tiered provider subpaths, and PR 6/PR 7 boundary hardening and
> polish are complete. Remaining work before merge is verification only.

**Outcome:** The sync engine has been carved out of `src/app/op-log/` into a
reusable, framework-agnostic, **domain-agnostic** `@sp/sync-core` package, plus
a sibling `@sp/sync-providers` package for bundled provider implementations.

## Current Architecture

- `@sp/sync-core` owns the generic sync engine surface: operation/apply
  primitives, vector clocks, full-state op helper factories, entity-key and
  sync-file-prefix helpers, compression/error helpers, import-filter decisions,
  conflict-resolution helpers, upload/download/replay/remote-apply planning
  helpers, entity-registry contracts, orchestration ports, and the
  privacy-aware `SyncLogger` port.
- `@sp/sync-providers` owns provider contracts and bundled implementations:
  Dropbox, WebDAV + Nextcloud, SuperSync, LocalFile, file-based sync envelopes,
  provider-shared errors, PKCE helpers, retry helpers, platform/credential/file
  ports, provider-owned string constants, and tiered subpath exports.
- `src/app/op-log/` owns Super Productivity wiring: NgRx adapters, app dialogs,
  IndexedDB orchestration, entity-registry composition, `ActionType`,
  `EntityType`, `SyncImportReason`, `SyncProviderId`, repair shapes,
  full-state wire format, credential-store implementation, OAuth routing,
  provider UI configuration, response validators, and platform bridges.
- Package boundaries are enforced by ESLint, package manifests, public-export
  audits, and source grep. `@sp/sync-core` has no runtime dependencies.
  `@sp/sync-providers` may depend only on public `@sp/sync-core` plus
  provider-runtime dependencies.

## Remaining Merge Gates

The extraction work itself is complete. Remaining work before merge is selected
verification only:

- Provider E2E smoke tests as needed for Dropbox, WebDAV, LocalFile, and
  SuperSync.
- Fresh-client bootstrap checks for file-based providers if that surface is
  touched before merge.
- Electron/Android LocalFile path smoke tests only when those platform bridges
  are part of the merge validation pass.

## Context

The sync frontend lives in `src/app/op-log/` (the older `src/app/pfapi/` is
legacy and out of scope). It already organizes itself by concern (`core`,
`sync`, `apply`, `capture`, `persistence`, `encryption`, `validation`, `util`,
`model`, `sync-providers`), but the boundary is convention-only: the engine
reaches into NgRx state, `core/entity-registry.ts` hardcodes imports from 15+
feature reducers, and providers and engine code intermix freely.

The final shape is a **three-concern split**:

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

These adjustments guided the extraction after the thin first slice:

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

## Final Branch Snapshot

The branch now contains the final package boundary for this extraction:

- `packages/sync-core/` exists and is exposed through the `@sp/sync-core` path
  alias.
- `packages/sync-providers/` exists and is exposed through the
  `@sp/sync-providers` path alias and focused `@sp/sync-providers/*` subpath
  exports.
- `npm run sync-core:build` and `npm run sync-providers:build` run the package
  builds, and `prepare` builds `sync-core`, `sync-providers`, `shared-schema`,
  then `plugin-api`.
- `eslint.config.js` applies `no-restricted-imports` and a dynamic-import ban to
  `packages/sync-core/**/*.ts` and `packages/sync-providers/**/*.ts`.
- `@sp/sync-core` exports generic operation/apply primitives,
  vector-clock algorithms, full-state op-type helper factories, entity-key and
  sync-file-prefix helpers, compression/error helpers, import-filter decisions,
  conflict-resolution helpers, upload/download/replay/remote-apply planning
  helpers, entity-registry contracts, app-side orchestration ports,
  `SyncStateCorruptedError`, and the privacy-aware logger port.
- `@sp/sync-providers` exports provider-neutral contracts, provider
  ports, file-based sync envelope types, provider-shared errors, PKCE and retry
  helpers, safe logging helpers, provider-owned string constants, and the
  bundled Dropbox, WebDAV + Nextcloud, SuperSync, and LocalFile provider
  classes.
- The app registry now has `buildEntityRegistry()` and an `ENTITY_REGISTRY`
  injection token. Existing helper functions still read the app-side
  `ENTITY_CONFIGS` singleton for compatibility.

Final extraction state:

- Full-state operation classification is now host-configured via
  `createFullStateOpTypeHelpers()`. The SP-facing
  `src/app/op-log/core/operation.types.ts` shim instantiates its own
  `FULL_STATE_OP_TYPES` and `isFullStateOpType`; the package root keeps
  deprecated SP compatibility exports for existing consumers. `OpType.SyncImport`,
  `OpType.BackupImport`, and `OpType.Repair` remain in `@sp/sync-core` only as
  host-defined compatibility strings.
- Vector-clock compare/merge/prune now lives in `@sp/sync-core`, with
  `@sp/shared-schema` re-exporting it for existing client/server imports.
- `SyncLogger` exists for package and movable code. App-only orchestration
  diagnostics intentionally still use `OpLog` where they remain app-side.
- `@sp/sync-core` has a Vitest package test runner and vector-clock tests.
- Generic gzip/base64 compression helpers now live in
  `packages/sync-core/src/compression.ts`. The app-facing
  `src/app/op-log/encryption/compression-handler.ts` shim preserves
  `CompressError` / `DecompressError` wrapping and the default `OpLog` logger
  adapter.
- PR 3b has generic conflict helpers in
  `packages/sync-core/src/conflict-resolution.ts`: deep equality, identical
  conflict detection, conflict-resolution suggestion, entity frontier
  construction, clock-corruption comparison adjustment, pure LWW conflict
  resolution planning, and local-DELETE-loses-to-remote-UPDATE payload
  extraction/merge helpers. It also owns pure LWW resolution partitioning:
  local/remote winner counts, remote-winner ops after host processing,
  local-winner remote ops, rejected-op id buckets, local-win op collection, and
  remote-winner affected entity-key calculation. The Angular
  `ConflictResolutionService` delegates to these helpers while keeping app
  orchestration, IndexedDB/apply flow, entity lookup, NgRx, dev-error wiring,
  app action-type ownership, fallback logging, and operation creation app-side.
- PR 3b also has the pure full-state import vector-clock decision helper in
  `packages/sync-core/src/sync-import-filter.ts`. The Angular
  `SyncImportFilterService` still owns full-state operation classification,
  latest import lookup from batch/store, IndexedDB access, conflict-dialog
  signaling, and logging.
- `sync-errors.ts` now routes constructor diagnostics for additional-log
  errors, JSON parse failures, and validation failures through the
  privacy-aware `SyncLogger` adapter with safe metadata only. The error classes
  still stay app-side because their recovery wording, provider diagnostics, and
  `additionalLog` UI/reporting behavior are SP-specific.
- PR 4a is present with `packages/sync-core/src/ports.ts`. The package now
  exports minimal contracts for operation application, action dispatch,
  remote-apply windows, deferred local action flushing, archive side effects,
  operation-store persistence, conflict UI, and sync configuration. The existing
  Angular services satisfy these contracts app-side. Conflict UI and sync config
  adapters remain app-side and are not used by package orchestration yet.
- PR 4b's current small helper set is present: remote-apply crash-safety
  ordering, upload last-server-sequence planning, full-state snapshot upload
  follow-up partitioning, download gap/full-state/encryption planning, and
  file-snapshot hydration skip planning. Provider calls, encryption/decryption,
  IndexedDB reads, UI, diagnostics, and result assembly remain app-side.
- PR 4c is present with `replayOperationBatch()` in `@sp/sync-core`. It owns
  only the strict replay ordering around remote-apply windows, bulk dispatch,
  the required event-loop yield, archive side-effect processing, post-sync
  cooldown, and deferred local-action flushing. The Angular
  `OperationApplierService` still owns NgRx action construction,
  operation-to-action conversion, archive predicates, `remoteArchiveDataApplied`,
  `Injector` usage, and diagnostics.
- Pre-P5 readiness cleanup is complete for this branch: movable core code no
  longer depends on `OpLog`, generic prefix/error/compression helpers are
  package-side with app-owned diagnostics, sync-core source comments were
  rechecked for SP entity examples, and the core boundary grep was rerun with no
  forbidden source imports.
- PR 5 has its package boundary: `packages/sync-providers/` exists with
  tsup/Vitest scaffolding, root scripts, build-package wiring, the
  `@sp/sync-providers` path alias, package-local generated-artifact ignores,
  and ESLint restrictions that reject Angular, NgRx, app imports,
  `@sp/shared-schema`, sync-core internals, and dynamic imports.
- Provider-neutral contracts now live in `@sp/sync-providers`: generic
  string-ID provider contracts, operation-sync response types, file provider
  response types, a credential-store port, and the local file-adapter port. The
  app-side `provider.interface.ts` remains as the SP-narrowed compatibility
  shim that specializes those contracts with `SyncProviderId` and
  `PrivateCfgByProviderId`; the unused local `file-adapter.interface.ts` shim
  was removed after app adapters switched to `@sp/sync-providers/file-based`.
- File-based sync envelope contracts now live in `@sp/sync-providers` with
  generic host-owned state, compact-operation, and archive payload parameters.
  The app-side `file-based-sync.types.ts` shim binds those generics to
  `CompactOperation` and `ArchiveModel`.
- Dropbox PKCE code generation now lives in `@sp/sync-providers`, including
  the existing WebCrypto-first and `hash-wasm` fallback behavior. The app-side
  Dropbox helper path remains a compatibility re-export.
- Dropbox, WebDAV + Nextcloud, SuperSync, and LocalFile provider
  implementations now live in `@sp/sync-providers`. App-side shims keep
  `SyncProviderId`, OAuth routing, config UI, credential-store implementation,
  response validators that depend on `@sp/shared-schema`, and the
  Electron/SAF platform bridges app-side.

The extraction sequence below is historical. Work through PR 7 is complete on
this branch; the only remaining work is the merge-level verification listed
above.

## Historical Slice Notes

The following sections preserve how the extraction landed and why the boundaries
were chosen. They are not a pending task list.

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
- `isMultiEntityPayload`, `extractActionPayload`.

**Full-state op-type helper factory** (`full-state-op-types.ts`):

- `createFullStateOpTypeHelpers<TOpType>(fullStateOpTypes)` returns the
  host-owned `FULL_STATE_OP_TYPES` set and `isFullStateOpType` predicate.
- The package keeps deprecated SP compatibility exports for
  `FULL_STATE_OP_TYPES` / `isFullStateOpType`, but reusable hosts should
  instantiate their own helper instead of using those defaults.

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
  `EntityConflict`, `ConflictResult`, and `MultiEntityPayload`. It also
  instantiates `createFullStateOpTypeHelpers()` with SP's full-state op strings.
- `src/app/op-log/core/types/apply.types.ts` redeclares app-narrowed apply
  result/options types.
- `src/app/op-log/core/lww-update-action-types.ts` instantiates the LWW helper
  factory with `ENTITY_TYPES`.
- `src/app/op-log/core/sync-state-corrupted.error.ts` re-exports from the
  package.
- `src/app/op-log/util/entity-key.util.ts` delegates to the package while
  preserving the app's `EntityType`-narrowed API.
- `src/app/op-log/core/action-types.enum.ts` stays full source in the app.
- `src/app/op-log/sync-providers/provider.const.ts` stays full source in the app.

### PR 1 Follow-Ups Before Merge

- Update the PR description if it still says `action-types.enum.ts` or
  `provider.const.ts` moved into `@sp/sync-core`; the code correctly keeps them
  app-side.
- Resolved in PR 3a: vector-clock ownership moved to `@sp/sync-core`, and
  `packages/shared-schema` now compatibility-re-exports those algorithms from
  `@sp/sync-core`. The forbidden direction remains
  `@sp/sync-core -> @sp/shared-schema`.
- Resolved in follow-up: `FULL_STATE_OP_TYPES` is now app-configured via
  `createFullStateOpTypeHelpers()`.

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

### Implemented State

Already present:

- `eslint.config.js` has a `packages/sync-core/**/*.ts` override that rejects
  Angular, NgRx, `src/app`, `@sp/shared-schema`, relative `shared-schema`
  imports, and dynamic imports.
- `packages/sync-core/src/entity-registry.types.ts` defines structural
  `EntityConfig` / `EntityRegistry` contracts and helper predicates.
- `src/app/op-log/core/entity-registry.ts` builds the SP registry app-side,
  re-exports the core contracts, and provides `ENTITY_REGISTRY`.
- `SINGLETON_ENTITY_ID` remains app-side, which is correct while singleton
  entity IDs are still an SP replay convention.
- `ConflictResolutionService` now uses the injected `ENTITY_REGISTRY`, proving
  the DI-based registry path while keeping compatibility helpers available for
  non-DI consumers.
- `packages/sync-core/src/sync-logger.ts` defines `SyncLogger`,
  `NOOP_SYNC_LOGGER`, `SyncLogMeta`, `SyncLogError`, and `toSyncLogError()`.
- `packages/sync-core/src/sync-file-prefix.ts` defines
  `createSyncFilePrefixHelpers()`. The app shim supplies
  `REMOTE_FILE_CONTENT_PREFIX` and `InvalidFilePrefixError`, keeping SP storage
  constants and diagnostics app-side while moving the generic parsing/formatting
  logic behind a config boundary.
- `packages/sync-core/src/error.util.ts` defines `extractErrorMessage()` for
  generic thrown-value message extraction. The app error module re-exports it
  for compatibility while keeping SP/provider-specific error classes app-side.
- `src/app/op-log/core/errors/sync-errors.ts` now sends constructor diagnostics
  through `SyncLogger` instead of direct raw `OpLog` calls. Logs retain IDs,
  counts, paths, error names, and key summaries, but not validation payloads,
  raw provider responses, JSON samples, or wrapped error messages.
- `src/app/op-log/core/sync-logger.adapter.ts` wires `SyncLogger` to `OpLog`
  via the app-side `SYNC_LOGGER` injection token and the
  `OP_LOG_SYNC_LOGGER` direct adapter.
- `EncryptAndCompressHandlerService` now accepts a `SyncLogger` constructor
  argument and uses the app adapter by default, proving the direct-constructor
  path for package-level classes without changing sync behavior.
- `op-log/encryption/compression-handler.ts` now routes compression failures
  through `SyncLogger` + `toSyncLogError()` and logs only safe length metadata.
- A deliberate bad-import check was run with a temporary
  `packages/sync-core/src/__boundary-check__.ts` importing `@angular/core`;
  `npm run lint:file -- packages/sync-core/src/__boundary-check__.ts` failed on
  `no-restricted-imports`, proving the boundary rule is active.

Post-extraction PR 2 notes:

- The compatibility `ENTITY_CONFIGS` singleton remains intentionally while
  non-DI consumers still need it.
- `SyncLogger` routing was kept targeted to package and movable files. A broad
  app-side `OpLog` refactor is outside the extraction scope.
- External PR text should describe the extraction as complete and treat
  remaining provider E2E checks as merge verification.

### Boundary Enforcement

- `eslint.config.js` already lints `packages/sync-core/**`.
- The package override already has `no-restricted-imports` for:
  - `@angular/*`
  - `@ngrx/*`
  - `@sp/shared-schema`
  - `src/app/*` and relative app imports such as `../../src/app/*`
- Keep package exceptions explicit for packages that cannot yet be linted.
- `packages/sync-providers/**` now has the same boundary shape, with an
  additional ban on sync-core internal import paths. It may import public
  `@sp/sync-core` only.
- The rule was proved with a temporary `@angular/core` import under
  `packages/sync-core/src/`; scoped lint failed as expected with
  `no-restricted-imports`, and the file was removed.

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

App-side state:

- `src/app/op-log/core/entity-registry.ts` already exposes
  `buildEntityRegistry()`.
- `ENTITY_REGISTRY` already exists as an app injection token.
- `ENTITY_CONFIGS` and helper functions still read a singleton registry for
  compatibility. Keep that until services are deliberately ported to injected
  registry dependencies, or migrate one low-risk consumer in PR 2 to prove the
  token works.
- Keep all feature reducer/selector imports in the app.

### Logger Port

Define `SyncLogger` in the lib:

```ts
export type SyncLogMeta = Record<string, string | number | boolean | null | undefined>;

export interface SyncLogError {
  name: string;
  code?: string | number;
}

export interface SyncLogger {
  log(message: string, meta?: SyncLogMeta): void;
  error(message: string, error?: SyncLogError, meta?: SyncLogMeta): void;
  err(message: string, error?: SyncLogError, meta?: SyncLogMeta): void;
  normal(message: string, meta?: SyncLogMeta): void;
  verbose(message: string, meta?: SyncLogMeta): void;
  info(message: string, meta?: SyncLogMeta): void;
  warn(message: string, meta?: SyncLogMeta): void;
  critical(message: string, meta?: SyncLogMeta): void;
  debug(message: string, meta?: SyncLogMeta): void;
}
```

Also provide `NOOP_SYNC_LOGGER` for tests and package defaults, plus
`toSyncLogError(error: unknown)` so adapters can preserve safe error identity
without passing arbitrary error objects into exportable logs.

Keep both `error()` and `err()` initially because current movable code uses both
`OpLog` spellings. If a follow-up PR normalizes calls to one spelling, do that
explicitly in the same PR instead of silently shrinking the port surface.

Privacy rule: logger metadata must not include full entities, operation payloads,
task titles, note text, raw provider responses, credentials, or encryption
material. IDs, counts, op IDs, action strings, entity types, and error names are
acceptable.

App-side follow-up:

- The app adapter lives in `src/app/op-log/core/sync-logger.adapter.ts` and
  satisfies `SyncLogger` by forwarding only the safe port arguments to `OpLog`.
- Angular services should inject `SYNC_LOGGER`; package-level pure functions and
  classes should receive a `SyncLogger` constructor/function argument.
- Convert only files being moved or made movable; a broad `OpLog` refactor is
  unnecessary and risks changing log behavior.

Initial candidate-file audit:

- `op-log/encryption/encrypt-and-compress-handler.service.ts`: safe prefix and
  flag metadata now goes through `SyncLogger`.
- `op-log/encryption/compression-handler.ts`: routes failures through
  `SyncLogger` and preserves only safe counts such as input length. The generic
  stream/base64 implementation now lives in `@sp/sync-core`; the app file is a
  compatibility shim that keeps SP error classes and the default `OpLog`
  adapter app-side.
- `op-log/core/errors/sync-errors.ts`: constructor diagnostics now route through
  `SyncLogger` with safe metadata only. Generic `extractErrorMessage()` lives in
  the package, but the error classes remain app-side because recovery messages,
  provider diagnostics, and `additionalLog` UI/reporting behavior are still
  SP-specific.
- `op-log/validation/validate-operation-payload.ts`: validation warnings now
  route through `SyncLogger` with sanitized operation metadata plus payload
  type/count summaries only; raw payload values and raw payload keys stay out of
  exportable logs.
- `op-log/validation/auto-fix-typia-errors.ts`: Typia repair attempts and
  applied fixes now route through `SyncLogger` with path/type/count metadata
  only; raw invalid values, defaults, and full Typia error objects stay out of
  exportable logs.
- `op-log/validation/repair-menu-tree.ts`: menu-tree repair logs now use
  `SyncLogger` metadata for removed references/invalid nodes; raw node objects
  and folder names stay out of exportable logs.
- `op-log/validation/validation-fn.ts`: schema validation failures now route
  through `SyncLogger` with counts, paths, expected types, and data shape
  summaries only; raw validation result data and invalid values stay out of
  exportable logs.
- `op-log/validation/is-related-model-data-valid.ts` and the invalid-date
  repair branch in `data-repair.ts`: cross-model validation and date repair
  diagnostics now keep raw app state, titles, and corrupted date strings out of
  exportable logs.
- `op-log/util/sync-file-prefix.ts`: now delegates to the package helper with
  app-supplied prefix and error construction. The app-facing shim should remain
  until consumers are deliberately switched to injected/configured helpers.

### What This Unlocks

After this PR, files blocked only by `OpLog` can move without creating a package
dependency on app logging:

- `op-log/encryption/`
- `op-log/core/errors/sync-errors.ts`
- `op-log/util/sync-file-prefix.ts`

### Verification

- `npm run lint` proves package boundary rules are active.
- Add and revert one deliberately-bad package import to prove the rule fails.
- `npm run sync-core:build` proves the new exported contracts build.
- `npm test` for registry-related specs.
- App boot + sync round-trip.
- Manual log export flow: sync/encryption events still appear and do not expose
  user content.

---

## PR 3a - Vector-Clock Ownership and Package Test Harness

Do this before moving more algorithms. Vector-clock parity is load-bearing for
sync correctness.

Status: implemented on this branch.

### Goals

1. Pick the single source of truth for vector-clock compare/merge/prune logic.
2. Add a package test runner for `@sp/sync-core`.
3. Port existing vector-clock tests before changing call sites.

### Preferred Direction

Decide the dependency direction before PR 3a moves code. The preferred outcome
is that `@sp/sync-core` owns generic vector-clock algorithms:

- `compareVectorClocks`
- `mergeVectorClocks`
- `limitVectorClockSize`
- `MAX_VECTOR_CLOCK_SIZE`
- validation/sanitization helpers if they are shared by client/server

This is acceptable only if current server/shared consumers can depend on
`@sp/sync-core` without creating a bad package direction or build cycle. In that
case, update build order so `sync-core` is available before those consumers, or
make the server consume `@sp/sync-core` directly.

If that dependency direction is awkward, create a tiny leaf package such as
`@sp/vector-clock` and have both `@sp/sync-core` and server/shared code consume
it. Do not make `@sp/sync-core` depend on `@sp/shared-schema`; the important
constraint is one implementation, not two copies.

### Current Locations

- Generic compare/merge/prune and `MAX_VECTOR_CLOCK_SIZE` live in
  `packages/sync-core/src/vector-clock.ts`.
- `packages/shared-schema/src/vector-clock.ts` is a compatibility re-export from
  `@sp/sync-core`.
- The client wrapper lives in `src/app/core/util/vector-clock.ts`; it adds
  null/undefined handling, sanitization, logging, and pruning notifications.
- Server sanitization and sync types live in
  `packages/super-sync-server/src/sync/sync.types.ts`; server conflict detection
  and storage pruning consume the shared algorithms.
- Existing vector-clock package tests live in
  `packages/sync-core/tests/vector-clock.spec.ts`. `shared-schema` keeps its
  existing compatibility coverage through the re-export.

PR 3a moved the algorithms and tests in one commit set to avoid client/server
drift.

### Test Harness

Implemented using the same Vitest shape as `packages/shared-schema`:

- `packages/sync-core/vitest.config.ts` with Node environment and
  `tests/**/*.spec.ts`.
- `test` and `test:watch` scripts in `packages/sync-core/package.json`.
- `vitest` as a `packages/sync-core` dev dependency.
- Root `sync-core:test` next to
  `sync-core:build`.
- `packages/shared-schema/tests/vector-clock.spec.ts` ported to
  `packages/sync-core/tests/vector-clock.spec.ts`.

### Server Build Fallout

Because `@sp/shared-schema` now depends on `@sp/sync-core`, all places that
currently copy, install, build, or pack only `shared-schema` must include
`sync-core` first:

- `packages/shared-schema/package.json` depends on `@sp/sync-core`.
- `package.json` and `packages/build-packages.js` build `sync-core` before
  `shared-schema`.
- `packages/super-sync-server/Dockerfile`.
- `packages/super-sync-server/Dockerfile.test`.
- Any CI workflow that installs only `packages/shared-schema` and
  `packages/super-sync-server`.

Keep `@sp/shared-schema` available to the server for schema/version/entity-type
contracts until those are separately decoupled.

### Migration Notes

- Preserve client null/undefined wrapper behavior exactly.
- Preserve `MAX_VECTOR_CLOCK_SIZE = 20`.
- Preserve server ordering: conflict detection first, pruning before storage.
- Replace the RxJS prune `Subject` with a callback/event hook at the package
  boundary.
- Route logging through `SyncLogger`.

### Verification

- `npm run sync-core:build`.
- `npm run sync-core:test` once the root script exists.
- `cd packages/shared-schema && npm test` if shared-schema keeps re-exporting or
  wrapping the moved algorithms.
- `cd packages/super-sync-server && npm test` for server parity.
- `npm run test:file src/app/core/util/vector-clock.spec.ts` for client wrapper
  behavior.
- Docker verification for the changed server image paths:
  `docker build -f packages/super-sync-server/Dockerfile.test .` at minimum, and
  `docker build -f packages/super-sync-server/Dockerfile .` before merge when
  image-build time is acceptable.
- Keep app wrapper specs for null/undefined handling, logging, sanitization, and
  import compatibility.
- Boundary grep stays empty for `packages/sync-core/src/`.

---

## PR 3b - Pure Algorithmic Core

Move framework-agnostic, stateless sync algorithms. These should only need typed
inputs and the logger port.

### Implemented State

- `deepEqual`, `isIdenticalConflict`, `suggestConflictResolution`,
  `buildEntityFrontier`, `adjustForClockCorruption`, and
  `planLwwConflictResolutions` live in `@sp/sync-core` with package-level
  Vitest coverage.
- `classifyOpAgainstSyncImport` lives in `@sp/sync-core` and owns only the
  vector-clock keep/invalidate decision for an op against the latest full-state
  import. It returns the raw comparison plus a reason so app logging stays
  unchanged.
- Local DELETE losing to remote UPDATE conversion now delegates to
  `extractEntityFromPayload`, `extractUpdateChanges`, and
  `convertLocalDeleteRemoteUpdatesToLww` in `@sp/sync-core`. The app supplies
  payload-key resolution, LWW action-type conversion, singleton-id handling,
  and fallback warning logging.
- `ConflictResolutionService` keeps compatibility wrappers/call sites and
  passes the app `SyncLogger` adapter into package helpers. It also supplies
  the app-owned archive action predicate to LWW planning and creates
  archive/local-win operations app-side.
- Pure remote/local operation partitioning now lives in `@sp/sync-core`;
  NgRx state lookup and operation creation stay in the app.
- `SyncImportFilterService` still owns full-state op detection, latest import
  selection from current batch/local store, IndexedDB access, local unsynced
  import detection, and all `OpLog` messages.
- Generic gzip/base64 compression helpers live in `@sp/sync-core` with
  package-level Vitest coverage. The app shim keeps `CompressError`,
  `DecompressError`, truncated-file recovery wording, and `OpLog` adapter
  defaults app-side.

### What Moves

- Conflict detection and LWW resolution algorithms from
  `op-log/sync/conflict-resolution.service.ts`.
- Filtering/partitioning helpers that operate on `OperationLogEntry[]`.
- Pure op merge helpers currently scattered across `remote-ops-processing.service.ts`
  and `operation-log-sync.service.ts`.
- Pure operation payload validation from `op-log/validation/`, as long as it
  does not import app schemas or NgRx selectors.
- Remaining encryption utilities once their app diagnostics and runtime
  dependencies are split. Generic compression is already package-side behind the
  `SyncLogger` port and host error factories.
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

Status: implemented for the current branch slice. `@sp/sync-core` exports the
first minimal replay/storage port contracts, and these app services now
explicitly satisfy them:

- `OperationApplierService` implements `OperationApplyPort<Operation>` and uses
  `ActionDispatchPort<SyncActionLike>` for its NgRx dispatch seam.
- `HydrationStateService` implements `RemoteApplyWindowPort`.
- `OperationLogEffects` implements `DeferredLocalActionsPort`.
- `ArchiveOperationHandler` implements `ArchiveSideEffectPort<PersistentAction>`.
- `OperationLogStoreService` implements
  `OperationStorePort<Operation, OperationLogEntry>`.

`ConflictUiPort` and `SyncConfigPort` are also exported and satisfied by
app-side services:

- `SyncImportConflictDialogService` implements
  `ConflictUiPort<SyncImportConflictResolution>` for the sync-import conflict
  dialog while keeping its app-specific `SyncImportConflictData` API.
- `GlobalConfigService` implements `SyncConfigPort` by exposing the current
  `selectSyncConfig` snapshot without leaking NgRx selectors into
  `@sp/sync-core`.

These adapters are intentionally not used by package orchestration yet.

This is contract-only: NgRx dispatch, hydration windows, archive IndexedDB
handling, and deferred local action processing remain app-side.

App-side adapter specs now exercise the first port set through the sync-core
types:

- `OperationApplyPort` and `ActionDispatchPort` coverage in
  `operation-applier.service.spec.ts`, including action/meta identity, bulk
  operation reference preservation, dispatch-yield-before-archive ordering,
  remote cooldown/end-window/deferred flush ordering, and local hydration
  close-window/deferred flush behavior.
- `RemoteApplyWindowPort` coverage in `hydration-state.service.spec.ts`.
- `ArchiveSideEffectPort` coverage in
  `archive-operation-handler.service.spec.ts`.
- `DeferredLocalActionsPort` coverage in `operation-log.effects.spec.ts`.
- `OperationStorePort` coverage in `operation-log-store.service.spec.ts`.

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

Status: implemented for the current branch slice. `@sp/sync-core` now exports
`applyRemoteOperations()` plus the narrow `RemoteOperationApplyStorePort`.
`RemoteOpsProcessingService.applyNonConflictingOps()` delegates the generic
remote-apply crash-safety ordering to that coordinator:

1. append incoming remote ops as pending while atomically skipping duplicates;
2. apply only newly appended ops through `OperationApplyPort`;
3. mark applied seqs;
4. merge applied remote vector clocks;
5. clear older full-state ops after a newer applied full-state op lands;
6. mark the failed op and remaining unapplied ops as failed on partial apply
   errors.

The Angular service still owns app diagnostics, validation/session latching,
snack notifications, conflict detection, NgRx dispatch construction, and the
IndexedDB implementation.

The package also owns small upload-planning helpers used by
`OperationLogUploadService`:

- `planRegularOpsAfterFullStateUpload()` partitions regular ops into
  already-covered-by-snapshot vs still-needs-upload buckets after a full-state
  snapshot upload.
- `planUploadLastServerSeqUpdate()` keeps last-server-sequence persistence
  monotonic while preserving the "has more piggyback" follow-up download
  behavior.

Provider calls, encryption/decryption, snapshot upload, error handling, app
logging, and persistence remain app-side.

Download-side planning is also limited to pure decisions:

- `planDownloadGapReset()` allows one gap reset per download session.
- `planDownloadFullStateUpload()` decides when an empty remote needs a
  full-state upload and when the app should query synced-op history.
- `planDownloadedDataEncryptionState()` derives the "server has only
  unencrypted data" flag.
- `planSnapshotHydration()` decides when a file-based snapshot can be skipped
  because the local vector clock already equals or dominates the snapshot clock.

Provider pagination, snapshot handling, decryption, clock drift warnings,
IndexedDB reads, and result assembly remain app-side.

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

Status: implemented for the current branch slice. The extracted part is the
narrow `replayOperationBatch()` coordinator in `packages/sync-core/src/replay-coordinator.ts`.
It is intentionally generic and calls host-supplied ports/callbacks in a strict
order:

1. open the remote-apply window;
2. dispatch the host-created bulk replay action;
3. yield after dispatch so host reducers finish before side effects;
4. run remote archive side effects after dispatch when configured;
5. yield around archive side effects to preserve UI responsiveness;
6. start post-sync cooldown before ending the remote-apply window;
7. end the remote-apply window and flush deferred local actions.

Package-level Vitest coverage now asserts dispatch-yield ordering, local
hydration behavior, archive failure reporting, archive notification timing,
cooldown failure handling, and empty-batch no-op behavior.

The Angular `OperationApplierService` delegates to this coordinator but keeps
all app-specific work app-side: `bulkApplyOperations`, `convertOpToAction`,
`isArchiveAffectingAction`, `remoteArchiveDataApplied`, `Injector` access to
`OperationLogEffects`, and `OpLog` diagnostics.

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

## Pre-P5 Readiness Check

Status: complete for this branch.

- No remaining pre-P5 `SyncLogger` routing is needed in core: files already made
  movable either live in `@sp/sync-core` without app logging, accept a
  `SyncLogger` port, or stay app-side because their diagnostics/recovery
  behavior is still SP-specific.
- `sync-file-prefix`, generic error-message extraction, and gzip/base64
  compression helpers are package-side behind host-owned configuration/error
  factories.
- `OperationApplierService` logging remains app-side intentionally; the moved
  replay coordinator has no logging dependency.
- Provider-specific logging and credential diagnostics were handled during PR 5
  as those files moved to `@sp/sync-providers`.
- Boundary verification was rerun for `packages/sync-core/src` and found no
  forbidden Angular, NgRx, `src/app`, or `@sp/shared-schema` imports.

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

### First Slice

- `packages/sync-providers/` mirrors the `sync-core` package scaffolding:
  `package.json`, tsup build, Vitest config, strict package `tsconfig`, and a
  package-local `.gitignore` for generated artifacts.
- Root wiring is in place: `sync-providers:build`,
  `sync-providers:test`, the `packages:test` aggregate used by root
  `npm test`, `build-packages.js`, `prepare`, the `@sp/sync-providers` path
  alias, package-lock workspace metadata, and Angular lint coverage.
- Boundary lint rejects Angular, NgRx, app source imports, `@sp/shared-schema`,
  sync-core internals, and dynamic imports under `packages/sync-providers/**`.
- Provider-neutral type contracts moved first. App-owned `SyncProviderId`,
  provider constants, OAuth routing, config UI, and the IndexedDB credential
  store implementation remain app-side.
- `SyncCredentialStore` now implements the package
  `SyncCredentialStorePort`, while `src/app/op-log/sync-providers/` keeps
  shims so existing call sites keep their imports.

### Second Slice

- `FileBasedSyncData`, `SyncFileCompactOp`, and
  `FILE_BASED_SYNC_CONSTANTS` moved into `@sp/sync-providers`.
- The package contracts stay host-agnostic by accepting generic state,
  compact-operation, and archive payload types.
- `src/app/op-log/sync-providers/file-based/file-based-sync.types.ts` remains
  the compatibility shim that binds the package envelope to app-owned
  `CompactOperation` and `ArchiveModel`.

### Third Slice

- Provider-owned PKCE utilities moved into `@sp/sync-providers`:
  `generateCodeVerifier`, `generateCodeChallenge`, and `generatePKCECodes`.
- The implementation keeps the existing browser WebCrypto behavior and the
  `hash-wasm` fallback needed when `crypto.subtle` is unavailable.
- `src/app/op-log/sync-providers/file-based/dropbox/generate-pkce-codes.ts`
  remains as a compatibility re-export for existing Dropbox call sites.

### Fourth Slice

- Provider-owned native HTTP retry helpers moved into `@sp/sync-providers`:
  `executeNativeRequestWithRetry`, `isTransientNetworkError`, and the
  `NativeHttpExecutor` / `NativeHttpRequestConfig` / `NativeHttpResponse`
  contracts.
- The package version is platform-agnostic: callers inject a
  `NativeHttpExecutor` (CapacitorHttp on Android, fetch on web/Electron, a
  test double in unit tests) and an optional `SyncLogger` from
  `@sp/sync-core`. Retry policy (2 attempts, 1s/2s backoff, transient
  network errors only) is preserved.
- Retry log entries flow as safe `SyncLogMeta` primitives (url, attempt,
  errorName, errorCode) rather than raw error objects, aligning with the
  package's privacy-aware logger contract.
- `src/app/op-log/sync-providers/native-http-retry.ts` remains as the
  app-side adapter that wires `CapacitorHttp` and `OP_LOG_SYNC_LOGGER`
  through to the package helper so existing Dropbox and SuperSync callers
  keep working unchanged.
- The full Dropbox and WebDAV provider moves were deferred from this
  slice because their dependency surface (provider error classes,
  per-platform fetch hacks, `tryCatchInlineAsync`, Capacitor plugin
  registration, OAuth glue) needs additional package ports that should
  be designed and reviewed in their own slice. Updated plan below.

### Fifth Slice

Shipped as two commits behind a shared design doc
(`docs/plans/2026-05-12-pr5-dropbox-slice.md`) plus a post-review
cleanup pass:

- **Dropbox slice A — provider error classes.** Twelve provider-shared error
  classes (`AuthFailSPError`, `InvalidDataSPError`,
  `HttpNotOkAPIError`, `NoRevAPIError`, `RemoteFileNotFoundAPIError`,
  `MissingCredentialsSPError`, `MissingRefreshTokenAPIError`,
  `TooManyRequestsAPIError`, `UploadRevToMatchMismatchAPIError`,
  `PotentialCorsError`, `RemoteFileChangedUnexpectedly`,
  `EmptyRemoteBodySPError`) plus `AdditionalLogErrorBase` and
  `extractErrorMessage` moved into `@sp/sync-providers`. App-side
  `sync-errors.ts` is now a re-export shim so existing call sites and
  `instanceof` catches keep working; a co-located identity spec
  asserts constructor identity across import paths so future bundler
  or tsconfig drift can't silently break the catches.
- `AdditionalLogErrorBase` lost its constructor-time
  `OP_LOG_SYNC_LOGGER.log` side effect (Option A from the design
  doc): privacy responsibility shifts entirely onto catch-site
  logging via the injected `SyncLogger` port.
- `HttpNotOkAPIError` split its parsed body excerpt off `.message`
  onto a new opt-in `.detail` field; `getErrorTxt` forwards
  `.detail` to UI surfaces, so user-visible toasts remain unchanged
  while privacy-aware logger paths see only "HTTP `<status>`
  `<statusText>`". `TooManyRequestsAPIError`'s constructor was
  narrowed to `{ status, retryAfter?, path? }`, closing a latent
  bearer-token leak where Dropbox's `_handleErrorResponse` had
  passed raw `Authorization` headers through `additionalLog`.
- Package gained `"sideEffects": false` so consumers that only
  import error classes can tree-shake through the barrel.
- **Dropbox slice B — Dropbox provider proper.** `Dropbox`, `DropboxApi`, and
  `DropboxFileMetadata` moved into
  `packages/sync-providers/src/file-based/dropbox/` behind three new
  injected ports:
  - `ProviderPlatformInfo` — readonly booleans `{ isNativePlatform,
isAndroidWebView, isIosNative }` replacing direct
    `Capacitor.isNativePlatform` / `IS_IOS_NATIVE` reads inside the
    provider.
  - `WebFetchFactory` — callable type `() => fetch`; lazy
    resolution preserves the iOS workaround where Capacitor
    patches `window.fetch` asynchronously.
  - `NativeHttpExecutor` (from slice 4) gained a `maxRetries`
    option so `getTokensFromAuthCode` can share the regular retry
    helper while still being one-shot for one-time auth-code
    exchanges.
- App-side `dropbox.ts` collapsed to a 38-line factory function
  `createDropboxProvider(deps)` that wires `OP_LOG_SYNC_LOGGER`,
  `APP_PROVIDER_PLATFORM_INFO`, `APP_WEB_FETCH`,
  `SyncCredentialStore`, and `CapacitorHttp.request` into
  `DropboxDeps` and returns the package `Dropbox` class directly.
  `sync-providers.factory.ts` was updated to call the factory.
- Privacy work folded in alongside the move: malformed-download
  raw `r.data` no longer logged; every
  `SyncLog.critical(..., e)` catch-site replaced with structured
  `toSyncLogError(e)` + curated `SyncLogMeta`; URLs scrubbed to
  host + pathname; error constructors receive relative
  `targetPath`, never the joined `basePath + targetPath`; and
  `AuthFailSPError` no longer carries raw `responseData`.
- Native-platform routing specs that were previously skipped under
  Jasmine (`Capacitor.request` un-mockable) are now un-skipped
  under Vitest with the injected `NativeHttpExecutor` mock. Package
  spec count went from 70 to 103. `tryCatchInlineAsync` was deleted
  (the sole consumer inlined a defensive `response.json().catch(...)`
  instead) and `src/app/imex/sync/dropbox/dropbox.model.ts` was
  deleted (no other consumers of `DropboxFileMetadata`).
- **Post-review cleanups.** Round-2 multi-review surfaced four
  follow-ups: dropped a dead `export type { NativeHttpResponse }`
  from the Dropbox module (the package barrel already re-exports
  it); replaced a hand-rolled `encodeFormBody` helper with
  `URLSearchParams` (fetch path passes it as `BodyInit`, native
  path uses `.toString()`); converted the runtime `_idCheck`
  constant in the app shim into a pure-type `AssertDropboxId`
  conditional alias; inlined the redundant
  `_executeNativeRequestWithRetry` private wrapper on
  `DropboxApi`; and dropped the now-unnecessary `as unknown as`
  step on the `credentialStore` cast in the factory shim.

WebDAV follow-up resolved: `errorMeta(e, extra)` and `urlPathOnly(url)` were
promoted into shared provider logging helpers before WebDAV duplicated them.

### Sixth Slice

Shipped as two commits (one helper-promotion PR plus the bulk move) behind
a shared design doc (`docs/plans/2026-05-12-pr5-webdav-slice.md`) with
multi-review consensus, followed by tightening commits that fold
post-review findings:

- **WebDAV slice A — shared log helpers.** Promoted `errorMeta(e, extra)` and
  `urlPathOnly(url)` from `dropbox-api.ts:88-104` into
  `packages/sync-providers/src/log/error-meta.ts` so WebDAV could adopt
  them without copy-paste. Exported from the package barrel. Dropbox
  imports updated. No behavior change.
- **WebDAV slice B — WebDAV + Nextcloud provider proper.** `webdav-base-provider.ts`,
  `webdav-api.ts`, `webdav-xml-parser.ts`, `webdav-http-adapter.ts`,
  `webdav.const.ts`, `webdav.model.ts`, `webdav.ts`, `nextcloud.ts`, and
  `nextcloud.model.ts` (plus their co-located specs) moved into
  `packages/sync-providers/src/file-based/webdav/`. Specs converted from
  Jasmine to Vitest. `SyncProviderId.WebDAV` / `SyncProviderId.Nextcloud`
  replaced inside the package with `PROVIDER_ID_WEBDAV` /
  `PROVIDER_ID_NEXTCLOUD` constants, with type-level `AssertWebdavId` /
  `AssertNextcloudId` bridges in the app-side shims (mirroring the
  Dropbox pattern).
- **Port reuse, not duplication.** Multi-review consensus rejected the
  initially-proposed `WebDavNativeHttpExecutor` port. The existing
  `NativeHttpExecutor` already supports arbitrary methods (`PROPFIND`,
  `MKCOL`, `MOVE`, …), `responseType: 'text'`, and `maxRetries: 0`. App-side
  wires `APP_WEBDAV_NATIVE_HTTP: NativeHttpExecutor` adapter pointing at
  the existing `WebDavHttp` Capacitor plugin registration in
  `capacitor-webdav-http/`. The inline `registerPlugin` duplication in
  `webdav-http-adapter.ts:13-31` was dropped — the subfolder
  registration with `web: () => import('./web')` fallback is canonical.
- **Factory shape mirrors Dropbox.** App-side `webdav.ts` / `nextcloud.ts`
  collapsed to `createWebdavProvider(extraPath?: string)` /
  `createNextcloudProvider(extraPath?: string)` factory functions that
  compose `deps` internally from app singletons
  (`APP_PROVIDER_PLATFORM_INFO`, `APP_WEB_FETCH`, `OP_LOG_SYNC_LOGGER`,
  `SyncCredentialStore`, `APP_WEBDAV_NATIVE_HTTP`). External callers
  pass app-level config (`extraPath`), not the internal deps bag.
- **Nextcloud generic widened.** `WebdavBaseProvider`'s generic narrowed
  to `T extends typeof PROVIDER_ID_WEBDAV` widened to `T extends typeof
PROVIDER_ID_WEBDAV | typeof PROVIDER_ID_NEXTCLOUD`. Four
  `as unknown as SyncProviderId.WebDAV` double-casts deleted.
- **`md5HashSync` migrated to `hash-wasm` async.** `WebdavApi._computeContentHash`
  became `async`; ripple touched ~5 spec call sites. `spark-md5` no
  longer appears in the package surface. The later LocalFile slice also
  migrated its rev hashing to `hash-wasm` and removed the app-side
  `spark-md5` helper/dependency.
- **CORS heuristic tightened.** `webdav-http-adapter.ts:180-219` collapsed
  to a ~3-line check (`error instanceof TypeError &&
error.message.includes('cors')`). Ambiguous-error log path that
  leaked the raw URL via `error.message` replaced with structured
  `toSyncLogError(error)` + `urlPathOnly(options.url)` meta. ~40 lines
  deleted, one privacy leak closed. A follow-up commit
  (`refactor(sync-providers): broaden WebDAV CORS heuristic for real
browsers`, W2) restored "Failed to fetch" / "NetworkError" /
  "Load failed" pattern coverage that browsers other than Firefox use
  for CORS rejections — still gated on `TypeError` and through the
  same structured-log surface.
- **`testWebdavConnection` helper extraction.** Test-connection path
  (`webdav-api.ts:355-380`) moved into a standalone
  `packages/sync-providers/src/file-based/webdav/test-connection.ts`
  helper so the adapter and api shims could drop from the package
  barrel. App-side `WebDAV` provider, config UI, and connection-test
  command call the helper directly.
- **No-retry behavior preserved.** Multi-review consensus rejected the
  Gemini-only recommendation to add a 2-attempt / 1s+2s retry policy
  with 423-Locked handling. WebDAV's stateful methods (LOCK/UNLOCK)
  and conditional writes (412 Precondition Failed) have semantics that
  differ from Dropbox's idempotent file API; preserving the existing
  no-retry behavior keeps the slice scope a refactor. Trivially
  addable later as a per-call-site `maxRetries` argument on the
  reused `NativeHttpExecutor` port.
- **Spec count delta.** Package spec count went from 103 (post Dropbox slice B)
  to 177. WebDAV slice B added 53 webdav specs (Jasmine → Vitest one-to-one
  move).
  Two follow-up commits added 13 namespace/server-format specs (the
  `getElementsByTagNameNS('*', name)` PROPFIND parsing path,
  `:href` variants, server-format compatibility — `restore WebDAV
parser namespace + server-format specs`, W4) and 7 CORS specs
  (`broaden WebDAV CORS heuristic for real browsers`, W2). Plus one
  refactor moving `@xmldom/xmldom` to `devDependencies` and adopting
  the global `DOMParser` at runtime (`@xmldom/xmldom to devDeps +
global DOMParser`, W3) so xmldom does not ship in the package bundle
  (`grep -c xmldom dist/index.mjs` returns 0).
- **Privacy sweep.** Applied the same A1/A3/B3.x audit as Dropbox plus
  three sites the security reviewer surfaced. `webdav-api.ts:73, 111,
151, 261, 329, 372` and `webdav-base-provider.ts:83, 109, 124, 130`
  all moved from `SyncLog.critical(..., e)` to `errorMeta(e)` plus
  curated `SyncLogMeta`. Full-URL `_buildFullPath` results scrubbed
  via `urlPathOnly` at every error-construction and log site.
  `testConnection`'s raw `e.message` return narrowed via
  `toSyncLogError(e).message`. `_buildFullPath`'s generic
  `Error('Invalid path: ${path}')` replaced with `InvalidDataSPError`
  with scrubbed path. PROPFIND multistatus bodies no longer fed into
  `HttpNotOkAPIError`'s second arg. Package boundary invariant
  documented: response headers are not logged or attached to errors.
- **Bundle size.** Package CJS now 75.77 KB / ESM 73.23 KB / DTS
  37.13 KB. Up from ~55 KB pre-slice. The single barrel was still fine at that
  point; the tiered split (`@sp/sync-providers/dropbox`, `/webdav`, ...) is now
  complete in the post-provider-lift polish.
- **WebDAV parser follow-up.** Repeated
  `getElementsByTagNameNS('*', name)` subtree walks in
  `webdav-xml-parser.ts` were replaced with one `childNodes`/`localName`
  document scan for response discovery plus direct-child scans for field
  extraction. This keeps mixed-prefix WebDAV compatibility while avoiding
  repeated response-subtree walks and preventing nested extension fields from
  shadowing direct WebDAV children.

### Seventh Slice

Shipped behind the shared design doc
(`docs/plans/2026-05-12-pr7-super-sync-slice.md`) with multi-review
consensus, then tightened by follow-up commits from review findings:

- **SuperSync slice A - retryable upload helper.** Promoted the broad-pattern
  operation-upload retry predicate from
  `src/app/op-log/sync/sync-error-utils.ts` into
  `packages/sync-providers/src/http/retryable-upload-error.ts` as
  `isRetryableUploadError`. The app-side `sync-error-utils.ts` now
  re-exports it as `isTransientNetworkError` so
  `operation-log-upload.service.ts` kept its import surface unchanged.
  This helper remains distinct from the native-code-aware
  `isTransientNetworkError` in `native-http-retry.ts`.
- **SuperSync slice B - SuperSync provider proper.** `super-sync.ts`,
  `super-sync.model.ts`, and the SuperSync provider spec moved into
  `packages/sync-providers/src/super-sync/`. The spec was converted
  from Jasmine to Vitest. `SyncProviderId.SuperSync` was replaced in
  the package by `PROVIDER_ID_SUPER_SYNC`, with the app-side
  `AssertSuperSyncId` bridge matching the Dropbox/WebDAV pattern.
- **App-side composition stayed thin.** `src/app/op-log/sync-providers/super-sync/super-sync.ts`
  now exports `createSuperSyncProvider()` with no `extraPath` argument
  (SuperSync has no file base-path concept). The factory wires
  `OP_LOG_SYNC_LOGGER`, `APP_PROVIDER_PLATFORM_INFO`, `APP_WEB_FETCH`,
  `SyncCredentialStore`, `CapacitorHttp.request`, `SuperSyncStorage`,
  and the app response validators into `SuperSyncDeps`.
- **Response validators remain app-side.** `response-validators.ts`
  still imports `@sp/shared-schema`, so it stays under `src/app` and is
  injected through the package's `SuperSyncResponseValidators` port.
  The package owns the response _types_ only.
- **Narrow SuperSync storage port.** `localStorage` access for
  `lastServerSeq` moved behind `SuperSyncStorage`, while the package
  still owns the `super_sync_last_server_seq_` prefix and the
  per-server/per-token hash key. `_cachedServerSeqKey` is explicitly
  reset on `setPrivateCfg` to preserve account/server isolation.
- **Transport and compression ports reused.** SuperSync now uses the
  existing `SyncLogger`, `ProviderPlatformInfo`, `WebFetchFactory`,
  `NativeHttpExecutor`, and `SyncCredentialStorePort` ports. Web uploads
  use `WebFetchFactory`; native uploads preserve the base64-gzip
  `CapacitorHttp` path for Android WebView/iOS binary-body safety.
  Compression imports directly from `@sp/sync-core`.
- **Privacy sweep.** The move folded in the SuperSync-specific privacy
  blockers from the design doc: `AuthFailSPError` no longer retains raw
  response bodies in `additionalLog`; transient native request errors
  throw a fixed user-facing message without interpolating raw native
  messages; web timeout messages no longer include the request path;
  server `error` reasons are capped at 80 chars; non-retryable foreign
  native errors are surfaced by error name only; logger catch paths use
  safe error name/code metadata rather than raw error objects.
- **Idempotency and retry hardening.** Ops upload `requestId` generation
  was ported and hardened: it is deterministic over the logical ops
  batch, stable across JSON key ordering and encrypted payload IV
  changes, but changes when unencrypted payload content changes. A
  post-review fix broadened `isRetryableUploadError` for `429`, "too
  many requests", "rate limit", and "retry in ..." messages so
  full-state uploads (`SYNC_IMPORT`, `BACKUP_IMPORT`, `REPAIR`) are left
  pending instead of permanently rejected under SuperSync rate limiting.
- **Spec count delta.** Package spec count is now 278 after the
  SuperSync move and rate-limit hardening. The SuperSync provider spec
  remains intentionally monolithic; splitting it into themed files is outside
  this extraction because the Jasmine -> Vitest conversion is easier to review
  in one move.
- **Bundle size.** Package build after the SuperSync slice is roughly
  CJS 99.56 KB / ESM 96.76 KB / DTS 47.18 KB. Tiered exports are now present
  for provider and helper surfaces (`@sp/sync-providers/dropbox`, `/webdav`,
  `/super-sync`, `/local-file`, `/http`, `/errors`, `/file-based`, `/pkce`,
  `/platform`, `/provider-types`, and `/credential-store`) while the root
  barrel stays available for compatibility.

### Eighth Slice

Shipped the LocalFile final slice:

- `LocalFileSyncBase`, `LocalFileSyncElectron`,
  `LocalFileSyncAndroid`, `LocalFileSyncPrivateCfg`, and
  `PROVIDER_ID_LOCAL_FILE` now live in
  `packages/sync-providers/src/file-based/local-file/`.
- LocalFile provider behavior is package-owned, but Electron and Android
  platform bridges stay app-side:
  - Electron file operations still go through the app's
    `ElectronFileAdapter` and `window.ea` bridge.
  - Android SAF operations still go through `SafService` /
    `SafFileAdapter`.
  - App factory shims (`createLocalFileSyncElectron` /
    `createLocalFileSyncAndroid`) inject those bridges plus
    `SyncCredentialStore` and `OP_LOG_SYNC_LOGGER` into the package
    classes. The dead app-side abstract base shim and duplicate spec were
    removed.
- LocalFile rev hashing now uses `hash-wasm` directly in the package,
  matching the WebDAV move. The unused app-side `src/app/util/md5-hash.ts`,
  `spark-md5` dependency, lockfile entry, and Angular CommonJS allowance
  were removed.
- `FileHashCreationAPIError` moved into `@sp/sync-providers` with the
  other provider-shared errors. The app error module re-exports it so
  cross-import `instanceof` identity remains guarded.
- Package LocalFile Vitest coverage was added for the base file provider,
  Electron folder-picker/path logic, and Android SAF permission/setup
  logic. The remaining app-side Jasmine spec continues to cover the
  Electron compatibility shim.

### Final Slice State

PR 5 and PR 6 final boundary hardening are complete for this branch:

- Boundary rules were rechecked with direct ESLint on
  `packages/sync-core/**/*.ts` and `packages/sync-providers/**/*.ts`; the
  forbidden-import grep for Angular, NgRx, `src/app`, `@sp/shared-schema`, and
  sync-core deep imports returned no source matches.
- Manifest/runtime dependency audit: `@sp/sync-core` has no runtime
  dependencies and now declares `"sideEffects": false`; `@sp/sync-providers`
  runtime deps remain limited to public `@sp/sync-core` plus `hash-wasm`, with
  `@xmldom/xmldom` test-only in `devDependencies`.
- Public barrel audit: `@sp/sync-providers` exports provider classes,
  provider-owned string constants, contracts, ports, and shared helpers, but no
  app-owned `SyncProviderId`, provider lists, OAuth routing, UI config, storage
  prefixes, or `@sp/shared-schema` validators. `@sp/sync-core` still carries
  the explicitly-deprecated full-state op compatibility exports and
  host-defined `OpType.SyncImport` / `BackupImport` / `Repair` strings noted
  above; reusable hosts should use `createFullStateOpTypeHelpers()` instead of
  those defaults. Tiered provider exports are now present for focused consumer
  imports.
- Added `docs/sync-and-op-log/package-boundaries.md`, linked it from the sync
  docs README, and recorded the boundary direction in `ARCHITECTURE-DECISIONS.md`.

Selected provider E2E smoke tests remain merge-level verification outside this
extraction slice.

### Verification

- Per-provider unit specs.
- E2E sync round-trip per provider: Dropbox, WebDAV, LocalFile, SuperSync.
- Fresh-client bootstrap for file-based providers.
- Electron-gated LocalFile path smoke test.

---

## PR 6 - Final Boundary Hardening

This is now a final audit rather than the first boundary rule.

### Goals

- Recheck the boundary rules for `packages/sync-core/**` and
  `packages/sync-providers/**`.
- Audit package manifests for accidental runtime deps.
- Audit public exports for SP names and app-only concepts.
- Add a small architecture note that explains the package boundaries and allowed
  dependency direction.

### Implemented State

Status: implemented for this branch.

- `docs/sync-and-op-log/package-boundaries.md` documents the allowed dependency
  direction: app composition may consume both packages,
  `@sp/sync-providers` may consume only public `@sp/sync-core`, and
  `@sp/sync-core` stays independent of Angular, NgRx, app code,
  `@sp/shared-schema`, and provider implementations.
- `docs/sync-and-op-log/README.md` now points to the package-boundary note and
  its key-file section reflects the current package/app split rather than the
  pre-extraction app-local provider layout.
- `ARCHITECTURE-DECISIONS.md` records the package boundary direction as an
  active architectural decision.
- `packages/sync-core/package.json` now declares `"sideEffects": false`,
  matching `@sp/sync-providers` and the package's no-runtime-side-effect
  surface.
- Manifest and public-export audit found no app-owned provider enums, provider
  lists, storage prefixes, OAuth routing, UI config, shared-schema validators,
  or sync-core deep imports in package public APIs. The known exception remains
  the deprecated `@sp/sync-core` full-state op compatibility exports plus the
  host-defined `OpType.SyncImport` / `BackupImport` / `Repair` strings retained
  for existing consumers.

### Verification

- `npm ci` completed, including the prepare-time builds for sync-core,
  sync-providers, shared-schema, and plugin-api.
- `npx eslint "packages/sync-core/**/*.ts" "packages/sync-providers/**/*.ts"`
  passed.
- `npm run lint` passed.
- Boundary grep for both packages returned no forbidden source imports.
- `npm run sync-core:build` passed.
- `npm run sync-providers:build` passed.
- Local run on May 13, 2026: `npm run packages:test` passed with sync-core 156
  tests and sync-providers 302 tests.
- Full app unit tests passed in the PR 7 verification below; selected sync E2E
  remain merge-level verification as needed.

---

## Optional Polish (Post-Provider Lift)

Status: implemented for this branch.

Non-blocking cleanups surfaced during the PR 5 provider lift. These do not
change behaviour or boundaries; they remove duplication, tighten tests, and
retire deprecated aliases after consumers have migrated.

### Implemented State

- PKCE is package-owned: app OAuth code imports `generateCodeVerifier` and
  `generateCodeChallenge` from `@sp/sync-providers/pkce`, and the app-local
  `pkce.util` shim/spec/helper were removed.
- The dead `_length` parameter was removed from `generatePKCECodes()`, and the
  Dropbox call site now uses the zero-argument helper.
- Package PKCE tests now assert the exact 43-character verifier length produced
  by the default 32 random bytes.
- The deprecated `SyncProviderServiceInterface` alias was removed. File-provider
  references now use `FileSyncProvider`, and generic/operation-capable provider
  references now use `SyncProviderBase` plus `OperationSyncCapable` where
  needed.
- The `packages/sync-providers/**` ESLint boundary override no longer repeats
  relative sync-core/shared-schema pattern depths already covered by the
  `**/...` forms.
- WebDAV XML parsing now uses namespace-agnostic `childNodes`/`localName`
  scans instead of repeated `getElementsByTagNameNS()` subtree walks. A package
  spec covers mixed-prefix parsing and direct WebDAV child precedence over
  nested extension fields.
- Tiered `@sp/sync-providers/*` package exports were added, and frontend app
  imports now use focused subpaths instead of the root provider barrel. The
  unused app-side SuperSync model and LocalFile file-adapter re-export shims
  were removed.

### Verification

- `npm run packages:test` passed with sync-core 156 tests and sync-providers
  303 tests.
- `npm run sync-core:build` passed.
- `npm run sync-providers:build` passed.
- `npm test` passed, including the full Karma run and the Los Angeles timezone
  run.
- `npm run lint` passed.
- Source grep for `pkce.util` and `SyncProviderServiceInterface` returned zero
  hits under `src` and `packages`.

---

## Completed Timeline

| PR     | Scope                                                      | Risk        | Notes                     |
| ------ | ---------------------------------------------------------- | ----------- | ------------------------- |
| **1**  | Stand up `@sp/sync-core` with generic primitives and stubs | Low         | Complete                  |
| **2**  | Boundary lint, registry types, privacy-aware logger port   | Medium      | Complete                  |
| **3a** | Vector-clock ownership and package test harness            | Medium      | Complete                  |
| **3b** | Pure algorithmic core                                      | Medium      | Complete                  |
| **4a** | Port contracts only                                        | Medium      | Complete                  |
| **4b** | Move small orchestration units behind ports                | High        | Complete                  |
| **4c** | Revisit `OperationApplierService` extraction               | High        | Narrow replay coordinator |
| **5**  | Lift providers into `@sp/sync-providers`                   | Medium-High | Complete                  |
| **6**  | Final boundary hardening and architecture note             | Low         | Complete                  |
| **7**  | Optional polish and tiered provider exports                | Low         | Complete                  |

After the final PR, `@sp/sync-core` is the domain-agnostic sync engine and
abstractions, `@sp/sync-providers` contains bundled provider implementations,
and `src/app/op-log/` contains SP-specific wiring: NgRx adapters, dialog ports,
entity-registry composition, `ActionType`, `EntityType`, `SyncImportReason`,
`SyncProviderId`, repair shapes, and full-state wire format.
