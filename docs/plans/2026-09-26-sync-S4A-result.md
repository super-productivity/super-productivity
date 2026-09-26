# S4A — verified unused legacy code removal

Started at `9177c3afed6429934632b23de936cda8c6603fde` with no product edits;
implemented and initially tested on assigned baseline
`9344378cb37a5e82d3b1ee7a55651d00d147dcd3` (commit `ec3a75fbe1`). For publication,
rebased only this task onto remote master `532456b8e3bbe53fa98d4149766b668014454156`
to exclude unrelated local commits. Revalidated product commit
`473d3fd7d989c39f027206c4e15f3f6a7e79afea`; subsequent changes are documentation only.
Injected AGENTS.md guidance remains uncommitted.

## Exact changes and evidence

| File                                                        | Change / consumer evidence                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/app/pfapi/api/index.js`                                | Delete 48 lines; orphan barrel, used only by deleted config; required modules already absent. |
| `src/app/pfapi/api/model-ctrl/meta-model-ctrl.js`           | Delete 609 lines; only referenced by deleted `pfapi.js`; required modules already absent.     |
| `src/app/pfapi/api/pfapi.js`                                | Delete 839 lines; only exported by deleted barrel; sync/database dependencies already absent. |
| `src/app/pfapi/pfapi-config.js`                             | Delete 281 lines; no live module/export consumers.                                            |
| `src/app/features/project/project.service.ts`               | Remove uncalled `updateOrder` and its action import.                                          |
| `src/app/features/tag/tag.service.ts`                       | Remove `updateOrder` and its import; only caller was the deleted wrapper test.                |
| `src/app/features/simple-counter/simple-counter.service.ts` | Remove uncalled `updateAll` and its import; live `updateOrder` remains.                       |
| `src/app/features/tag/tag.service.spec.ts`                  | Remove one dispatch-only wrapper test and its exclusive import.                               |
| `src/app/README.md`                                         | Correct the stale description of the deleted files (subagent review finding).                 |
| `docs/plans/2026-09-26-sync-S4A-result.md`                  | This report.                                                                                  |

Before deletion, `rg`, tracked-file `git grep` and an AST module-call audit covered
production, tests, templates, scripts, dynamic loads and exports. Neither the app
nor spec TypeScript graph included PFAPI files. The plugin package exports its own
types; the explicit plugin bridge does not expose these wrappers or service instances.
Angular copies favicon/assets/manifest/static, not these sources. Electron packages
`electron/**` and `.tmp/angular-dist/**`; Capacitor consumes `dist/browser`.
Packaging hooks and service-worker configuration do not expose PFAPI source files.

After deletion, no removed wrapper calls or live module references remain; two
historical comments in `sync.effects.spec.ts` remain. Persisted actions/reducers,
their tests, `LegacyPfDbService`, `OperationLogMigrationService` and JSON backup
import remain unchanged. No candidate was deferred. Subagent review found no runtime
or public-contract defect; the README correction addresses its documentation finding.

## Validation and size

Repeated after rebasing, with logs under `/tmp/sync-s4a-checks/pr-*`:

- `node node_modules/typescript/bin/tsc -p src/tsconfig.app.json --noEmit` and the
  same command for `src/tsconfig.spec.json` — passed.
- `npm run checkFile <path>` on all four modified TS files — passed.
- `npm run buildFrontend:dev -- --stats-json` — passed; emitted input/source-map
  audit found no PFAPI sources. Existing Chrome 107 Browserslist warning only.
- `npm run test:file -- 'src/app/features/{project,tag,simple-counter}/**/*.spec.ts' --karma-config=/tmp/sync-s4a-checks/karma.cjs --source-map=false` — **303 passed**.
  Temporary config delegates to repo config with absolute basePath and unused
  Karma/debug ports 9881/9226. No shared services were restarted.
- Prettier and `git diff --check` — passed. No platform installer or sync E2E run:
  this removes unreachable code without changing replay, migration or import behavior.

Production: **1,798 deleted / 1 added; net reduction 1,797 lines** across seven
files, including 1,777 compiled JS lines. Tests: **13 deleted / 1 added; net
reduction 12**. Documentation is separate: this report and the README correction.
The main deletion risk is an overlooked consumer; import graphs, supported exports,
packaging and existing tests support unreachability. No persisted shape, wire
semantic, schema version or replay handler changes.
