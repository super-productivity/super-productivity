# S6B: default new empty file-sync configurations to v3

Implementation and review verification are local; no push, PR or merge is authorized. Full
scheduled v2 and v3 WebDAV jobs on the eventual published S6B head remain an
integration gate, separate from the local results below.

## Baseline and ownership

- Branch: `task/sync-s6b-default-new-empty-folders-to-v3-c926d8`.
- Starting HEAD: `9177c3afed6429934632b23de936cda8c6603fde`.
- Verified zero task commits and only runtime-injected `AGENTS.md` changes;
  empty-range rebase with autostash reached the required integrated S6A baseline
  `1ef2cb53cba650fb4c5be85c79e6083000adfbde`.
- Runtime guidance remains outside the commits. S5's journal, resolver,
  startup/backup cleanup and Settings ownership are untouched.
- Prior full S6A gates: `/tmp/sync-s6b-gate-evidence-20260926.md`. They validated
  S6A, not this selection change. Exact S6A head was
  `183ee8bbd1e70935b3f90f6ee04c6ed76cedd8ea`; both full WebDAV jobs passed
  61 tests with no skips/failures/flakes:
  [v3 run](https://github.com/super-productivity/super-productivity/actions/runs/36254538910),
  [v2 run](https://github.com/super-productivity/super-productivity/actions/runs/36254548472).
  The supplied evidence did not yet establish the unrelated regular E2E result
  for the entire v2 workflow.

## Behavior and implementation

The existing optional `isUseSplitSyncFiles` field supplies the selection:

| Stored value         | Behavior                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------- |
| absent (new default) | Discover existing v2/v3; create v3 when no live sync file or legacy metadata is present. |
| `false`              | Preserve saved legacy v2 behavior, including deliberate v2 creation fixtures.            |
| `true`               | Preserve explicit one-way migration to v3.                                               |

A fresh installation is never evidence of an empty remote. No setting is
persisted by discovery. Only discovered nonempty formats are cached, using the
existing target invalidation and generation fence. This adds discovery calls
once per target/session, not to routine settled polls. Errors propagate;
`InvalidDataSPError` from a revision probe proves presence and lets the existing
reader/recovery path handle the file. Absent files alone establish emptiness.

New ops-based v3 creation now conditionally creates the existing v3 tombstone at
`sync-data.json` before publishing snapshots/ops. This prevents compatible v2
readers from starting an independent history. Existing migration still
neutralizes the v2 backup before replacing its primary. An automatic uploader
that finds a v2 payload on its final legacy read requests a retry instead of
calling the migration writer. No new wire format, required field, schema bump,
provider interface, dependency, or format-policy framework is introduced.

The provider audit found Dropbox replacing a caller's create-only `null` revision
with the latest remote revision. That would let the new tombstone overwrite a
concurrent v2 creator. Removing that substitution preserves the API's existing
add/update/overwrite modes. This is the only shared-provider production edit.

## Exact files and scope

- `src/app/op-log/sync-providers/file-based/file-based-sync-adapter.service.ts`:
  selection, target-scoped cache, explicit-migration guard and initial tombstone.
- `src/app/op-log/sync-providers/file-based/file-based-sync-format.ts`:
  extracted legacy reader/revision annotation plus discovery. The adapter shrinks
  from 3,284 to 3,236 physical lines; its grandfathered ceiling is not increased.
- `src/app/features/config/default-global-config.const.ts`: omit the old default
  `false`; `global-config.model.ts`: document the existing optional field.
- `packages/sync-providers/src/file-based/dropbox/dropbox.ts`: preserve caller
  create-only intent, deleting the revision-refetch fallback.
- `src/app/op-log/sync-providers/file-based/file-based-sync-adapter.service.spec.ts`
  and `packages/sync-providers/tests/file-based/dropbox/dropbox-api.spec.ts`:
  selection, error, target-switch, late-v2 and real Dropbox/API regression tests.
- `e2e/pages/sync.page.ts`: narrowly allow untouched product format defaults;
  explicitly toggle the checkbox for deliberate v2/v3 fixtures.
- `e2e/tests/sync/webdav-format-rollout.spec.ts`: seven real-app/server cases,
  independent of `E2E_WEBDAV_FORMAT`.
- `src/assets/i18n/en.json`,
  `docs/wiki/3.08-Sync-Integration-Comparison.md`,
  `docs/sync-and-op-log/operation-log-architecture.md`: minimal format guidance.
- This result document.

The larger line count is primarily required E2E/unit coverage and moving the
existing reader out of an already oversized service. The additional marker and
Dropbox changes follow reproduced failures on the new-folder creation path.

## Red/green evidence

1. On the exact S6A baseline, the new real-default test left the advanced format
   option untouched, completed setup, and wrote a valid `pf_2__` v2 monolith
   containing the seeded task. Its desired `sync-ops.json` assertion failed
   (404): `/tmp/sync-s6b-red.log`.
2. Initial implementation: the same test passed, checking v3 ops, the referenced
   generation snapshot and task, reload, and a second default client's hydration:
   `/tmp/sync-s6b-green-initial.log` (1 passed).
3. Mixed-reader review added a tombstone assertion. It failed because the
   ops-based creation path did not write `sync-data.json`:
   `/tmp/sync-s6b-marker-red.log`. The final rollout verifies that marker too.
4. Dropbox's real provider plus real API encoder, with transport responses,
   reproduced an overwrite instead of a create conflict:
   `/tmp/sync-s6b-dropbox-red.log` (1 failed, 450 passed). Removing the revision
   substitution gives 451 passed: `/tmp/sync-s6b-providers-final.log`.
   Dropbox has no E2E harness, so this uses the assignment's provider exception.
5. Final local review found cached automatic v3 discovery bypassing a later
   explicit v2 choice when legacy and ops files coexist. The focused regression
   failed (`/tmp/sync-s6b-cache-red.log`: 1 failed, 165 passed). Explicit choices
   now clear the discovered-format cache; auto-switch cache writes also honor
   the existing target generation fence.

## Validation

All browser runs use `E2E_REQUIRE_WEBDAV=true`, `--retries=0`, the actual local
WebDAV server, and this worktree's Angular app at `http://localhost:4256`.
`PLAYWRIGHT_BROWSERS_PATH=/tmp/sync-s6b-browsers` isolates browser installation
from other tasks. Browser commands start with
`npx playwright test --config e2e/playwright.config.ts`.

| Check                                                                                                                                       | Result / evidence                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:file -- src/app/op-log/sync-providers/file-based/file-based-sync-adapter.service.spec.ts --no-progress`                       | 167 passed; `/tmp/sync-s6b-switch-unit-green.log`                                                                                                                                                                                                                                                                            |
| `npm run test:file -- src/app/imex/sync/sync-config.service.spec.ts --include src/app/op-log/validation/frozen-state.spec.ts --no-progress` | 48 passed; `/tmp/sync-s6b-config-frozen.log`                                                                                                                                                                                                                                                                                 |
| `npm run sync-providers:test` (includes package typecheck)                                                                                  | 451 passed; `/tmp/sync-s6b-providers-final.log`                                                                                                                                                                                                                                                                              |
| `npx tsc --noEmit -p src/tsconfig.app.json`                                                                                                 | Passed; `/tmp/sync-s6b-switch-type-app.log`                                                                                                                                                                                                                                                                                  |
| `npx tsc --noEmit -p src/tsconfig.spec.json`                                                                                                | Passed; `/tmp/sync-s6b-switch-type-spec.log`                                                                                                                                                                                                                                                                                 |
| `npx tsc --noEmit -p e2e/tsconfig.json --baseUrl .`                                                                                         | Passed; `/tmp/sync-s6b-switch-type-e2e.log`                                                                                                                                                                                                                                                                                  |
| `npx tsc --noEmit -p e2e/tsconfig.json`                                                                                                     | Reproduces the known baseline absolute `src/...` import-resolution error; `/tmp/sync-s6b-type-e2e.log`. S6A already reproduced it on unmodified master.                                                                                                                                                                      |
| `npm run checkFile <file>` for every modified/added TS file                                                                                 | Passed; `/tmp/sync-s6b-check*.log` (latest reruns supersede intermediate fixture/lint errors).                                                                                                                                                                                                                               |
| `--grep @webdav --list`, once per mode                                                                                                      | Identical: 68 tests in 23 files (61 existing + 7 rollout), `/tmp/sync-s6b-switch-discovery-v2.log` and `-v3.log`. No exclusions added.                                                                                                                                                                                       |
| Focused existing regressions, `E2E_WEBDAV_FORMAT=v3 --workers=2`                                                                            | 17 passed, no skips/retries; `/tmp/sync-s6b-regressions-v3.log`.                                                                                                                                                                                                                                                             |
| Final rollout runs                                                                                                                          | 7 passed in v3 mode after the review fix, no skips/retries; `/tmp/sync-s6b-switch-green.log`. The new target-switch case also passed in v2 mode; `/tmp/sync-s6b-switch-v2.log`. Earlier implementation: 10 passed in v2 mode (six rollout plus generic sync and encryption), no skips/retries; `/tmp/sync-s6b-v2-green.log`. |

The 17-case command selects `webdav-surgical-sync.spec.ts` (all six migration/
restart cases), `webdav-stale-monolith.spec.ts` (all four #10256 cases),
`webdav-upload-unseen-ops-10239.spec.ts` (both cases),
`webdav-setup-encryption.spec.ts` (both cases),
`webdav-newer-format-8764.spec.ts`, and `webdav-sync-full.spec.ts` (both cases),
all under `e2e/tests/sync/`. Generic flow observed actual v3 ops and a generation
snapshot. The final v2 command selects `webdav-format-rollout.spec.ts`,
`webdav-sync-full.spec.ts`, and `webdav-setup-encryption.spec.ts` with two workers.
An earlier concurrent-create fixture assumed server CAS and was corrected as
explained below; its failing run remains in `/tmp/sync-s6b-v2-final.log`.

Intermediate failures are retained, not hidden by retries: sandbox subprocess
restrictions required escalation; initial plugin bootstrap built the needed test
assets but some unrelated plugin builds failed; the shared Playwright browser
then disappeared and was replaced by the isolated installation; one run was
interrupted after dev-server edits. New fixture assertions/type/lint issues were
corrected. A migration test initially chose the option before initial hydration,
which restored remote settings; the final case explicitly opts in after joining,
matching the established migration flow. No setting-synchronization redesign is
included.

## Risks and limits

- Sync format selection remains high-risk. Existing v2 settings/files are
  preserved; default v3 joins do not infer format from local install age.
  Explicit `false` remains a pin to legacy behavior; it is not silently redefined
  as automatic. The parent was notified of this concrete interpretation.
- The existing tombstone is the mixed-reader barrier. Older apps may require
  enabling Surgical sync; v2 retirement and forced conversion are not included.
- Conditional writes are only as strong as the provider. The local
  `hacdias/webdav:v5` server accepted a PUT with `If-None-Match: *` even after a
  competing file was seeded (201 rather than 412); the trace records that header
  in `.tmp/s6b-v2-final/`. This is an existing transport limitation, not evidence
  of CAS. The final late-v2 test inserts data before the final read and checks
  the adapter's retry/no-migration guarantee. A writer appearing after that last
  read still depends on server precondition enforcement. LocalFile remains
  single-writer/best-effort; no new cross-provider lock protocol is added.
- Dropbox and OneDrive authenticate/map not-found separately from other errors;
  WebDAV/Nextcloud and LocalFile can read the body to obtain a revision.
  Invalid/unparseable files go through the existing error/recovery paths.
  LocalFile's pre-existing empty-file-as-not-found behavior is unchanged.
- Dropbox received the narrow real-code regression above. Native platforms,
  Dropbox and OneDrive were **not** E2E-tested. Existing provider unit tests ran.
- Backup/recovery, vector clocks, replay ordering and snapshot formats are
  preserved. Explicit whole-dataset replacement retains its existing semantics
  and transport race limits.

## Review follow-up: stale format cache on target switch

The first independent subagent review found a P2 at the late-v2 upload guard:
a legacy read finishing after target invalidation could cache `v2` under the
shared provider key. The next sync then created v2 in a new empty folder.
The fix discards that cached choice and lets the next sync rediscover the
current remote; it adds no generation plumbing or persistent contract.

- Unit red: `/tmp/sync-s6b-switch-unit-red.log` (1 failed, 166 passed).
- Real app/server red on `ba3f2b2c745652f5e194b778da35189fa1d4cdfa`:
  `/tmp/sync-s6b-switch-real-red.log` and `.tmp/s6b-switch-real-red/`.
  The test seeds a real v2 payload, holds its final upload read in flight,
  switches folders through the settings UI, then releases the old response.
  The old code retries as v2; the new folder lacks `sync-ops.json`.
- An initial browser attempt passed because it paused the fourth legacy GET,
  an earlier server-migration read protected by the epoch guard. The corrected
  fixture pauses the sixth GET, after both discovery/bootstrap pairs and upload
  discovery. The existing late-v2 case now exercises this final upload read too.
  Diagnostic logs are `/tmp/sync-s6b-switch-diagnostic-2.log`; temporary console
  diagnostics were removed from the test.
- Green adapter suite: 167 passed, `/tmp/sync-s6b-switch-unit-green.log`.
- New regression with v2 suite selection: 1 passed, no retries/skips,
  `/tmp/sync-s6b-switch-v2.log`.
- Full local rollout: 7 passed in v3 mode, no retries/skips,
  `/tmp/sync-s6b-switch-green.log`.
- Fix commit: `96e050e40ba4485d7d77cb047a9821b5dfef861a`
  (`fix(sync): rediscover folder format after a late legacy read`).
- Second independent subagent review of fix `96e050e40b` and the overall
  rollout: no actionable introduced defects found. The reviewer checked
  selection, explicit preferences, migration, invalidation, marker writes,
  Dropbox creation, and the recorded red/green evidence. Review was read-only;
  it did not rerun suites or replace the final scheduled gates.
- All three changed TS files passed `checkFile`:
  `/tmp/sync-s6b-switch-check-{service,unit,e2e}.log`. App/spec/E2E typechecks
  passed; the E2E command still needs the documented baseline `--baseUrl .`.

## Handoff gate

Local implementation commit: `6e32a5ba13a6375ec32f4133b23d655c62f356bb`
(`feat(sync): default new empty file sync folders to v3`), directly on the
required S6A baseline. The review fix above follows this implementation;
handoff updates are committed separately.
The only remaining worktree modification is runtime-injected `AGENTS.md`, which
is deliberately excluded from all commits. All local implementation checks
listed above are complete; no local blocker remains.

The parent must arrange
publication only when authorized, then run both full scheduled WebDAV modes on
that exact final S6B head before integration. Do not treat S6A's prior full runs
or these focused local runs as that final gate. No push, PR, merge, worktree
removal or batch-completion claim is part of this task.
