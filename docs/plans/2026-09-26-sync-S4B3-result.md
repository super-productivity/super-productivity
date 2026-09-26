# S4B3 — resolver-wrapper cleanup

Completed the bounded cleanup on the integrated S2 baseline. No live conflict
resolution behavior, journal hooks, package exports, persisted models, schema,
wire formats, provider contracts, or store code changed.

## Revisions and consumer audit

- Starting HEAD: `9177c3afed6429934632b23de936cda8c6603fde`.
- Inspected/tested base: `ea1e285964d5b226cdb732567dbde49866c1016a`.
- Before moving the fresh child, verified zero task commits, an empty index,
  and no product edits. The authorized empty-range rebase moved HEAD to the
  pinned base without replaying planning commits. The injected `AGENTS.md`
  block was preserved and excluded from the commit.
- Validation ran against that base plus this report's product diff. The final
  commit SHA is supplied in the handoff; tested file hashes are saved with the
  validation artifacts and checked against the committed files.

Tracked whole-repository searches of the three exact names found only their
private declarations, direct calls in the resolver spec, and historical audit
prose. Build inputs (`src/tsconfig.app.json`, `src/tsconfig.spec.json`, Angular's
Karma configuration), package exports, tooling/CI searches, service consumers,
and the explicit plugin bridge bindings exposed no production, build, export,
or dynamic consumer. After deletion, no references remain in source, packages,
tooling, or workflows. Historical reports remain unchanged.

| Removed wrapper             | Baseline consumer evidence                                                    | Preserved live code                                                                      |
| --------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `_deepEqual`                | Declaration at service:961; spec helper at :5737, used by seven wrapper cases | Three direct `deepEqual` calls, its import/export, and `syncLogger`                      |
| `_extractEntityFromPayload` | Declaration at service:4202; five direct spec calls                           | Direct core extraction in parent recovery and `_resolvePayloadKey`                       |
| `_extractUpdateChanges`     | Declaration at service:4214; five direct spec calls                           | Exported core helper and its live conversion callers; only the unused app import removed |

## Changes and coverage preservation

- `src/app/op-log/sync/conflict-resolution.service.ts`: remove the three
  wrappers, their exclusive comments, and one import; 36 lines removed,
  4,774 → 4,738 physical lines.
- `src/app/op-log/sync/conflict-resolution.service.spec.ts`: remove only the
  three wrapper describe blocks (17 cases, 187 lines).
- `packages/sync-core/tests/conflict-resolution.spec.ts`: narrowly extend
  ownership to preserve coverage of the still-live algorithms. Existing tests
  already cover object cycles, depth options, entity extraction, null/missing
  keys, direct entities, adapter/flat updates, and wrapped adapter updates.
  Move circular-array and default-depth regressions here (two cases), and add
  the missing primitive/object-array assertions and wrapped-flat assertion to
  existing cases. No core production code changed.
- `eslint.config.js`: lower only the resolver's existing cap, 4,775 → 4,738
  (the old cap had one line of slack).
- This report records the bounded result.

TypeScript AST comparison proves all 64 surviving resolver members are
textually unchanged. Module-level statements differ only by the unused import.
The remaining app spec text is identical after removing the three blocks.
Ordering projections, archive recovery, time deltas, disjoint merge,
LWW readers/envelopes, delete-wins, and journal behavior remain intact.

## Validation

- `npm run checkFile <path>` passed for all three changed TypeScript files,
  including the core spec; none was ignored.
- `node node_modules/typescript/bin/tsc -p src/tsconfig.app.json --noEmit`
  and the same command with `src/tsconfig.spec.json`: passed using real configs.
- `npm run sync-core:build`: passed (ESM, CJS, declarations).
- `npm --prefix packages/sync-core test -- tests/conflict-resolution.spec.ts`:
  package spec typecheck passed; **62 tests passed, zero skipped/failed**.
- Focused Angular/Karma run: **524 tests passed, zero skipped/failed**.
  Angular's installed `findTests` discovered exactly 12 files: resolver service,
  disjoint merge, resolver persistence, journal hooks, superseded resolver,
  rejected-op handler, and the reorder, unsupported multi-entity, Today-plan,
  time-convergence, restore-task, and archive-conflict integrations.
- The in-memory size-cap probe passes the unchanged service and rejects one
  added line. Final diff/scope and whitespace checks passed.

Task-specific discovery output, Karma config, consumer/member audits, removed
case list, hashes, and focused log are in
`/tmp/sync-s4b3-validation-PAF6FB/`. Typecheck, package build, and package test
logs are `/tmp/sync-s4b3-{app-typecheck,spec-typecheck,core-build,core-test}.log`.
The temporary Karma wrapper uses the repository configuration with its source
base path and verified-free ports 9913/9243. Sandbox port binding was denied;
the elevated check and browser run passed. No shared services or S6A ports were
touched. Angular emitted the existing unsupported Chrome 107 Browserslist
warning.

Residual risk is a missed dynamic consumer; tracked name/build/export checks,
real app/spec compilation, member comparison, and focused runtime coverage found
none. This is unreachable-code removal, not a sync bug fix, so no artificial
failing E2E was added and no E2E run is claimed. S5 journal removal and all other
cleanup remain outside this change. The initial handoff was local-only: no push,
merge, PR publication, or workflow dispatch.

## Independent review

At the user's follow-up request, a separate subagent reviewed commit
`be93b21f1802b011d14c71dfe2097747cfd879cf` against the pinned baseline and found
no actionable defects or lost meaningful coverage. It independently verified
the consumer search, unchanged surviving members, retained exports/contracts,
test relocation, artifact hashes, and recorded test results; it did not rerun
the suites. No product-code changes were warranted. The user authorized pushing
the reviewed branch and opening a PR; integration remains subject to review.
