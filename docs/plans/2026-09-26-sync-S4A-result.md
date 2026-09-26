# S4A — verified unused legacy code removal

Starting HEAD: `9177c3afed6429934632b23de936cda8c6603fde`; no task commits or
product edits existed. Rebased the empty range with `--autostash --onto` to the
assigned baseline `9344378cb37a5e82d3b1ee7a55651d00d147dcd3` and reread its
guidance. Local master had advanced to `c24c5e7ef5a320b376efc34958a8670b3727aa6b`;
it was not substituted. The injected AGENTS.md change remains uncommitted.
Checks below exercised the final product diff on the assigned baseline; the
completion signal records the resulting commit SHA.

## Exact changes and consumer evidence

| File                                                        | Removal / evidence                                                                                                            |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/app/pfapi/api/index.js`                                | 48 lines; orphan CommonJS barrel, requiring already-absent modules. Its only inbound module reference was the deleted config. |
| `src/app/pfapi/api/model-ctrl/meta-model-ctrl.js`           | 609 lines; only referenced by the deleted `pfapi.js`; dependencies such as `../pfapi.const` are absent.                       |
| `src/app/pfapi/api/pfapi.js`                                | 839 lines; only exported by the deleted barrel; its sync/database implementations are absent.                                 |
| `src/app/pfapi/pfapi-config.js`                             | 281 lines; no live consumer of the module or its PFAPI exports.                                                               |
| `src/app/features/project/project.service.ts`               | Uncalled `updateOrder` and its action import.                                                                                 |
| `src/app/features/tag/tag.service.ts`                       | `updateOrder` and its action import; the only caller was the removed wrapper test. Prettier collapses the remaining import.   |
| `src/app/features/simple-counter/simple-counter.service.ts` | Uncalled `updateAll` and its action import. Live `updateOrder` remains.                                                       |
| `src/app/features/tag/tag.service.spec.ts`                  | One dispatch-only wrapper test and its exclusive import.                                                                      |
| `docs/plans/2026-09-26-sync-S4A-result.md`                  | This report.                                                                                                                  |

Before deletion, `rg` plus tracked-file `git grep` covered production, tests,
templates, scripts, CI, package exports and build references (the JS files are
tracked despite `.gitignore`). TypeScript app/spec programs contained 2,397/3,267
source files and **zero** PFAPI sources. An AST audit of tracked TS/JS/CJS/MJS
module calls found no nonliteral module loads in the app; other computed loads
target Electron test subjects or tooling dependencies, not these candidates.

The root package launches `electron/main.js`; the supported plugin package exports
only its own types. `PluginBridgeService.createBoundMethods` exposes explicit
operations, not these service instances or wrappers. No supported public export
is withdrawn. Angular includes TS sources, has no global scripts, and copies only
favicon/assets/manifest/static. Electron packaging includes `electron/**` and
`.tmp/angular-dist/**`; Capacitor consumes `dist/browser`. Packaging hooks do not
copy PFAPI sources; service-worker globs cover built output, not app source.

After deletion, the candidate module references are gone except two historical
comments in `sync.effects.spec.ts`; no removed wrapper calls remain. Persisted
actions/reducers and their tests remain, as do `LegacyPfDbService`,
`OperationLogMigrationService`, and `BackupService.importCompleteBackup` (used by
JSON import). No op-log, resolver, adapter, provider, migration, schema, or other
task-owned code changed. No candidate needed deferral.

## Validation and size

- `node node_modules/typescript/bin/tsc -p src/tsconfig.app.json --noEmit` — passed.
- Same command with `src/tsconfig.spec.json` — passed.
- `npm run checkFile <path>` for all four remaining modified TS files above —
  passed (format/lint; sandbox-blocked formatter subprocesses required escalation).
- `npm run buildFrontend:dev -- --stats-json` — passed; 3,207 bundler inputs and
  460 emitted source maps contain zero PFAPI sources. Existing Chrome 107
  Browserslist warning only; no full platform installer build was needed.
- `npm run test:file -- 'src/app/features/{project,tag,simple-counter}/**/*.spec.ts'
--karma-config=/tmp/sync-s4a-checks/karma.cjs --source-map=false` — **303 passed**.
  The temporary config delegates to the repository config and changes only
  basePath and the verified-free Karma/debug ports to 9881/9226. Sandbox binding
  required escalation. An initial attempt used unsupported CLI `--port`; the
  successful run sets it in Karma config. No shared services were restarted.
- `git diff --check` — passed. Protected-path diff is empty.

Production: **1,798 lines deleted, 1 added, net reduction 1,797** across seven
files (including 1,777 historical JS lines). Tests: **13 deleted, 1 added, net
reduction 12** in one file. Documentation: this report only, excluded from those
counts. The large diff is deletion of four explicitly assigned compiled files.

Risk reviewed: an overlooked consumer would make deletion unsafe; compilation,
bundle graphs, exports and packaging checks support unreachability. No persisted
shape, wire semantic, replay handler, migration or import behavior changes. This
is unreachable-code removal, not a sync bug fix; no artificial E2E was added.
