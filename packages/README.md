# Workspace packages

Use the package that owns the behavior. The Angular app composes these packages;
package code must respect the [sync dependency boundaries](../docs/sync-and-op-log/package-boundaries.md).

| Package                                          | Responsibility / starting point                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| [sync-core](sync-core/README.md)                 | Framework-independent sync primitives, conflicts, clocks, compression, encryption                      |
| [sync-providers](sync-providers/src/)            | Provider contracts, transports, credential storage, and platform adapters                              |
| [shared-schema](shared-schema/src/)              | Shared schema versions, validation, and migrations                                                     |
| [super-sync-server](super-sync-server/README.md) | Hosted sync API, accounts, and database; [server architecture](super-sync-server/docs/architecture.md) |
| [plugin-api](plugin-api/README.md)               | Public types consumed by third-party plugins                                                           |
| [plugin-dev](plugin-dev/)                        | Plugin implementations and examples; [development guide](../docs/plugin-development.md)                |
| [vite-plugin](vite-plugin/src/)                  | Build tooling for plugins                                                                              |

## Validation

Run commands from the repository root. Formatting, lint, type checking, and tests
are separate checks; one does not imply the others ran.

- Format changed files with `npm run prettier:file -- <path>`.
- Run `npm run checkFile <path>` for root-ESLint-covered TypeScript (including
  sync-core and sync-providers). Root ESLint intentionally ignores plugin-api,
  plugin-dev, shared-schema, super-sync-server, and vite-plugin; use their checks
  below instead. Do not override those ignores to force Angular lint onto them.
- Run relevant package checks below, including focused tests for changed behavior.
  For Vitest packages, append `-- <test-path>` to `npm test` for a focused run.
  Paths are relative to the package. Read the server guide before database tests.

| Package           | Commands (repository root)                                                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| sync-core         | `npm run sync-core:build` and `npm run sync-core:test` (includes test type checking)                                                                                               |
| sync-providers    | `npm run sync-providers:build` and `npm run sync-providers:test` (includes test type checking)                                                                                     |
| shared-schema     | `npm run shared-schema:build` and `npm run shared-schema:test`                                                                                                                     |
| super-sync-server | `npm --prefix packages/super-sync-server run build` and `npm --prefix packages/super-sync-server test` (pretest generates Prisma client; see [setup](super-sync-server/README.md)) |
| plugin-api        | `npm --prefix packages/plugin-api run typecheck`; `npm run plugin-api:build` when consumers need updated declarations                                                              |
| vite-plugin       | `npm run vite-plugin:build`                                                                                                                                                        |
| plugin-dev        | Use the affected plugin's own `package.json` build/lint/test scripts via `npm --prefix packages/plugin-dev/<name> run <script>`; available checks vary                             |

Root `npm test` covers sync-core, shared-schema, and sync-providers, release
tooling, and Angular specs. It does **not** run the server, Electron, every
plugin's tests, or E2E suites. Root `npm run test:file` selects Angular specs only.

## Building and adding packages

`npm run build:packages` runs [build-packages.js](build-packages.js): it builds
sync-core, sync-providers, shared-schema, plugin-api, and vite-plugin, then
discovers plugins in plugin-dev and copies their required assets into
[src/assets/bundled-plugins](../src/assets/bundled-plugins/). It skips the SolidJS
boilerplate. The server has its own build and deployment workflow.

For a new plugin, follow the [plugin development guide](../docs/plugin-development.md)
and the chosen example's manifest/build conventions; discovery does not require
adding a hard-coded entry to the build script. For standalone sync packages,
follow [package boundaries](../docs/sync-and-op-log/package-boundaries.md).
