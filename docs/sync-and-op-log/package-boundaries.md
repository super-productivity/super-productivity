# Sync Package Boundaries

**Status:** Active
**Last Updated:** May 13, 2026

This note documents the package split used by the operation-log sync stack. The
goal is to keep reusable sync logic framework-agnostic while leaving Super
Productivity domain wiring in the app.

## Dependency Direction

Allowed direction:

```text
src/app
  -> @sp/sync-providers
  -> @sp/sync-core

src/app
  -> @sp/sync-core

packages/shared-schema
  -> @sp/sync-core
```

Rules:

- `@sp/sync-core` must not import Angular, NgRx, `src/app`, `@sp/shared-schema`,
  `@sp/sync-providers`, or provider-specific code.
- `@sp/sync-providers` may import only public `@sp/sync-core` exports. It must
  not deep-import `@sp/sync-core/*`, Angular, NgRx, `src/app`, or
  `@sp/shared-schema`.
- The app may import both packages and is responsible for Angular dependency
  injection, NgRx, Electron/Capacitor bridges, config UI, OAuth routing, and
  Super Productivity-specific model wiring.
- `packages/shared-schema` depends on `@sp/sync-core` only for compatibility
  re-exports of generic vector-clock algorithms.

The `packages/shared-schema -> @sp/sync-core` edge is deliberate compatibility
coupling. Vector-clock compare/merge/prune algorithms moved to `@sp/sync-core`
so sync-core, client wrappers, and server/shared consumers use one
implementation. `packages/shared-schema` re-exports those algorithms to preserve
legacy import paths while consumers migrate; do not add new sync-engine logic to
`@sp/shared-schema`, and remove the compatibility edge once no consumers need
it.

## Ownership

`@sp/sync-core` owns reusable sync-engine primitives:

- generic operation and apply types;
- vector-clock compare, merge, and prune algorithms;
- pure conflict, import-filter, upload/download, replay, compression, and
  prefix helpers;
- structural entity-registry contracts;
- app-facing port contracts and the privacy-aware `SyncLogger` interface.

`@sp/sync-providers` owns bundled provider implementations and provider-neutral
contracts:

- Dropbox, WebDAV, Nextcloud, SuperSync, and LocalFile provider classes;
- file-based sync envelope types and provider response contracts;
- provider-owned file envelope constants such as `sync-data.json` and
  file-sync version keys;
- credential, file-adapter, platform-info, web-fetch, native-HTTP, storage, and
  response-validator ports;
- provider-shared error classes, PKCE helpers, retry helpers, and safe logging
  metadata helpers.

Cross-provider utilities belong in `@sp/sync-providers` when they are reusable
by provider implementations but not by the generic engine. Existing examples are
provider-shared error classes, PKCE, retry predicates, native-HTTP retry, and
safe log-metadata helpers.

New bundled providers should follow the Dropbox/WebDAV/SuperSync/LocalFile
pattern: put provider-owned protocol logic and provider-neutral contracts in
`@sp/sync-providers`, then compose app-only credentials, platform bridges,
validators, OAuth routing, and UI config in thin app-side factories. If a
provider is app-specific or plugin-provided rather than bundled, implement it
app-side against the provider contracts instead of widening the package surface.

`src/app` owns host-specific configuration and choreography:

- `ActionType`, `ENTITY_TYPES`, `SyncProviderId`, provider lists, and storage
  prefixes such as `REMOTE_FILE_CONTENT_PREFIX` and `PRIVATE_CFG_PREFIX`;
- entity registry construction from feature reducers/selectors;
- wrapped full-state payload shape, import reasons, repair payloads, and
  validation against `@sp/shared-schema`;
- Angular services, NgRx dispatch/replay conversion, local-action filtering,
  hydration windows, archive side effects, provider factories, OAuth callbacks,
  config dialogs, and platform bridge implementations.

`packages/shared-schema` owns Super Productivity schema contracts and validators
that are shared between app and server. In this boundary it should stay
SP-coupled and should not become a dependency of `@sp/sync-core` or
`@sp/sync-providers`.

## Public Exports

Package consumers should import from package barrels only:

```ts
import { compareVectorClocks } from '@sp/sync-core';
import { Dropbox, PROVIDER_ID_DROPBOX } from '@sp/sync-providers/dropbox';
```

Do not import from package internals such as `@sp/sync-core/src/*`,
`@sp/sync-providers/src/*`, or `dist/*`. If a host needs a symbol, promote it to
the package barrel deliberately and check that it is not app-owned.

The root `@sp/sync-providers` barrel remains available for compatibility, but
new host code should prefer focused subpath barrels such as
`@sp/sync-providers/dropbox`, `/webdav`, `/super-sync`, `/local-file`, `/http`,
`/errors`, `/file-based`, `/pkce`, `/platform`, `/provider-types`, and
`/credential-store`. Provider classes and provider-owned string constants are
exported there, but app enums such as `SyncProviderId` are not. Internal helpers
such as WebDAV API/adapter classes stay unexported unless a second host needs
them.

`@sp/sync-core` still exports deprecated full-state op compatibility defaults
and host-defined `OpType.SyncImport` / `BackupImport` / `Repair` strings for
existing consumers. New reusable hosts should provide their own full-state
operation strings through `createFullStateOpTypeHelpers()`.

## Privacy Boundary

Package logging must use `SyncLogger` and safe structured metadata only.
`SyncLogger` is a privacy-aware port shape; it does not sanitize arbitrary
metadata. Call sites are responsible for passing already-scrubbed values, and
enforcement is currently code review plus focused tests.

IDs, counts, action strings, entity types, provider IDs, and error names/codes
are acceptable. URL metadata is acceptable only after the caller strips query
strings, fragments, credentials, tokens, raw response bodies, and user-provided
path segments such as file names, emails, share IDs, or folder names. Prefer
coarse path templates, provider operation names, host-only values, or a
provider-owned relative path category over raw URL paths.

Full entities, operation payloads, task titles, note text, raw provider
responses, credentials, headers, and encryption material must stay out of
exportable logs. A lint rule for unsafe direct logging remains a possible
follow-up; until then, new movable/provider code should use `SyncLogger` and
tests should assert privacy-sensitive catch paths.

## Tests

The ESLint package-boundary overrides apply to all TypeScript files under
`packages/sync-core/**` and `packages/sync-providers/**`, including tests. Tests
may import their own package internals through relative paths for white-box
coverage. `@sp/sync-providers` tests may import public `@sp/sync-core` exports,
but should not import `@sp/sync-core` internals or sync-core test helpers.

## Verification

Before moving code across these boundaries, run:

```bash
npm run lint
npm run sync-core:build
npm run sync-providers:build
npm run packages:test
```

For a quick boundary spot-check, use:

```bash
rg -n "from ['\"](@angular|@ngrx|@sp/shared-schema|src/app|@sp/sync-core/src|@sp/sync-core/)|import\(['\"](@angular|@ngrx|@sp/shared-schema|src/app|@sp/sync-core/src|@sp/sync-core/)" packages/sync-core/src packages/sync-providers/src
```
