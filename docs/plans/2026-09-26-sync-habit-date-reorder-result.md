# Habit-grid dated counts crossing habit reordering

## Result and scope

The habit grid emits `COUNTER_SET_FOR_DATE` for both today and historical cells.
Recognize that action alongside `COUNTER_SET_TODAY` when a count edit crosses a
habit reorder, preserving its original `date` and action identity. Replacement
counts use the current durable value for that date, including later local edits.

This change builds on `8861a63adca`, including #10288's recovery of absolute
current-day counts without retained conflict evidence. Dated counts use the same
recovery: reissue one day's value instead of stopping sync or replacing the whole
habit. Reorders still require the exact retained, applied, synced, non-rejected
commuting row. Missing or compacted evidence keeps a pending reorder behind the
existing safety dialog. Settings, deletes, time deltas and competing reorders
remain outside the commuting exception.

Only two production files change: `reorder-conflict.util.ts` and
`superseded-operation-resolver.service.ts`. No action, persisted model, wire
format, schema, dependency or public/plugin API changes. The larger test diff
covers real UI actions, both resolution directions, compaction, restart and an
unmodified released client using the two existing suites.

## Reproduction and review

The original implementation on `6d74ae511d6` reproduced four real-app/server
failures: today and a past date, each with either a local or remote reorder.
The tests first verify the grid's `SFD` payload, the CDK drag's three enabled
habit IDs, disabled-habit exclusion and concurrent clocks. Sync then stops with
`UnsupportedMultiEntityConflictError`, rather than silently losing data. No
matching user incident is claimed. `git tag --contains 5e754d355` establishes
release inclusion of the original safety gate through v19.1.0.

Review found that #10288 had meanwhile replaced the current-day count safety
stop. The branch was updated to preserve that behavior for dated counts too.
The reviewed browser tests additionally require the intended reordered sequence
and the original dated action/payload on the accepted replacement after compaction.

Fresh baseline checks use the production files from `8861a63adca` with the new
tests. The real-store suite reports eight dated-count failures and 37 passes.
All four browser baseline cases fail at the expected conflict dialog. They use
actual encrypted transport and the isolated SuperSync server, without choosing a
whole-dataset winner. Logs:
`/tmp/habit-date-review-integration-baseline.log` and
`/tmp/habit-date-review-baseline.log`.

With only the commuting/projection utility updated, the dated-count compaction
case still fails: the receiving client gains a `modified` field from generic
entity LWW and diverges from the sender. The resolver adjustment removes this
fallback. Evidence: `/tmp/habit-date-review-projection-only.log` and
`/tmp/habit-date-review-projection-only-artifacts/`.

The initial implementation's older evidence remains in
`/tmp/habit-date-reorder-baseline.log` and
`/tmp/habit-date-reorder-before-guard-valid.log`. Its pending-count safety-stop
expectations predate #10288 and do not describe the final behavior.

## Verification coverage

The real-store matrix exercises both timestamp winners, dominating replacement
clocks, rejected-original retirement, two dates, durable successor values,
StopWatch settings, siblings and disabled slots. It replays both rejected-original
and accepted-only histories. Missing retained evidence, compacted evidence and
missing entity clocks still allow absolute counts to recover.

The browser matrix uses real grid clicks and CDK dragging, checks the operation
payloads, reloads established clients and syncs a fresh client. The compaction
cases interrupt uploads, age only retained-row application metadata and trigger
the production compactor with ordinary task edits. Pending counts recover;
pending reorders survive four cancelled retries. Successful recovery must not be
masked by REPAIR, SYNC_IMPORT or BACKUP_IMPORT operations.

## Released-client boundary

The compatibility fixture uses the unmodified official v19.1.0 APK assets from
[the S2 release fixture](2026-09-26-sync-S2-result.md#released-client-evidence).
Tag commit: `42ded9f31a132bf92633b0c78ad4ebf1d87c0f71`.
APK SHA-256: `127af90995763d88a502eae428af9dc395dcdf17d3f8f1be498f56dfa4aab9dc`.
The initial provenance check compared all 1,229 served files with the APK;
`/tmp/habit-date-reorder-release-provenance.log` records that check. The APK reports
`NO_SUPPORTED_VCS_FOUND`, so no embedded VCS provenance is claimed.

In both tested histories the old client uploads first, the current client
resolves, and the old client consumes the accepted existing `SM` or `SFD` action.
Assertions cover `appVersion=19.1.0`, three dates, ordering, disabled state and
reload. An older client resolving first retains its original safety stop. There
is no compatibility claim for untested releases and no schema bump.

## Review validation environment

Frontend: this worktree on port 4368. Dedicated Docker project:
`habit-date-reorder-04e4`, SuperSync port 1938. The server image was built from the
original baseline; this client fix needs no server change. Karma uses port 9984
and an ephemeral Chrome debugging port. Released assets serve on port 4249.

Full scheduled SuperSync/WebDAV suites remain a separate release gate; focused
local results do not claim those suites passed.

## Final review checks

- Focused real-store integration and adjacent conflict/resolver suites: 114 passed.
- Full focused browser file: 27 passed, with no retries or skips, including all
  four unmodified v19.1.0 compatibility histories.
- App, spec and E2E TypeScript checks: passed.
- `npm run checkFile` on all four changed TypeScript files: passed.
- Documentation links, Markdown formatting and `git diff --check`: passed.
- Independent production/replay review: no blocking findings.

Commands (run from the worktree; the local Karma override only isolates ports):

```sh
npm run test:file src/app/op-log/testing/integration/reorder-conflict-wedge.integration.spec.ts -- --include=src/app/op-log/testing/integration/unsupported-multi-entity-conflict.integration.spec.ts --include=src/app/op-log/sync/superseded-operation-resolver.service.spec.ts --karma-config=.tmp/karma-habit-date-integration.conf.cjs
E2E_BASE_URL=http://127.0.0.1:4368 SUPERSYNC_E2E_URL=http://127.0.0.1:1938 E2E_REQUIRE_SUPERSYNC=true COMPAT_OLD_ASSETS=/tmp/sync-s2-release-v19.1.0/assets/public node_modules/.bin/playwright test --config e2e/playwright.config.ts e2e/tests/sync/supersync-reorder-conflict-wedge.spec.ts --workers=2 --retries=0 --max-failures=0 --output=/tmp/habit-date-review-final-artifacts
node_modules/.bin/tsc --noEmit -p src/tsconfig.app.json
node_modules/.bin/tsc --noEmit -p src/tsconfig.spec.json
node_modules/.bin/tsc --noEmit -p e2e/tsconfig.json --baseUrl .
npm run docs:check-links
```

Logs use the `/tmp/habit-date-review-` prefix: `unit-final.log`,
`{app,spec,e2e}-types.log`, `{util,resolver,integration,e2e}-checkfile.log`,
`doc-links.log` and `final-e2e.log`.
