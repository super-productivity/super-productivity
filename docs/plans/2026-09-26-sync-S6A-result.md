# S6A: explicit WebDAV v3 test mode

Test/CI preparation only. Originally based on PR #10272 head
`ad845f5a27dbb33515814330f5ef53a7127e095d` (verified against GitHub). After #10272
merged, rebased onto integrated master
`1001dedbf1bcb1cbf0a9a0ec10aa51803ba0bb89` and validated there. The final local
publication artifact is refreshed onto published master
`ea1e285964d5b226cdb732567dbde49866c1016a`; neither rebase required changes to
the S6A code. No production defaults, sync code, wire formats, models,
dependencies, or integration gates change.

## Selection and coverage

The scheduled workflow accepts `webdav_format: v2 | v3` for its WebDAV job;
scheduled/push runs and omitted inputs remain v2. `webdav_grep` still defaults to
`@webdav`, and the server remains required. Locally, set `E2E_WEBDAV_FORMAT=v3`.
`setupWebdavSync` explicitly sets the existing Surgical sync checkbox; an
individual `isUseSplitSyncFiles: false/true` takes precedence over the suite mode.

Both modes discover the same **61 tests in 22 files**. No tests or assertions
were skipped or removed to enable v3.

| Cases                               | Format selection / inventoried assumptions                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 44 generic tests                    | Follow the suite mode, including multi-client tasks, conflicts, encryption, archives, provider switching, ordering, and error handling.                                  |
| First-sync conflict (within the 44) | Two PUT witnesses use the selected commit file: `sync-data.json` for v2, `sync-ops.json` for v3.                                                                         |
| Setup encryption (within the 44)    | Raw encrypted/plaintext and unchanged-remote assertions cover the selected commit file and every fixed/generation snapshot written by the v3 fixture.                    |
| #10239 (2 tests)                    | Explicit v2; seeded `state`, counters, snapshot base and `recentOps` still target `sync-data.json`. A real envelope-version assertion pins v2 even under a v3 suite run. |
| Legacy migration (4 tests)          | Explicit v2, preserving the original legacy-data-to-v2 scenarios.                                                                                                        |
| #10256 (4 tests)                    | Existing explicit v2/v3 choices and corrected retry expectation unchanged.                                                                                               |
| Surgical sync (6 tests)             | Existing v2-to-v3 migration and explicit v3 response-loss/restart cases unchanged; the prefixed-file reader is reused by the generic format assertion.                   |
| Newer-format #8764 (1 test)         | Existing explicit v3 selection and snapshot assumptions unchanged.                                                                                                       |

The generic two-client full-flow test now GETs the selected remote file and
asserts envelope version 2 or 3. For v3 it follows `snapshotRef.file` (or the
existing `sync-state.json` fallback), fetches that snapshot, and checks version,
syncVersion, vector clock and state. This witnesses actual remote contents,
independently of the checkbox and without relying on the surgical-only spec.

## Original dependency validation

Local services are isolated to app port 4344 and WebDAV port 2345, checked free
before startup. No shared services were stopped. Browser runs use zero retries.

- `npm run checkFile` passed for all eight changed TypeScript files.
- `tsc -p e2e/tsconfig.json --noEmit` passed.
- Workflow YAML parsed; choice/default/environment wiring, required server and
  full-suite grep checked. Prettier and `git diff --check` passed.
- `--grep @webdav --list` output is identical with v2 and v3 selected.
- Selected v3: generic full flow, first-sync Keep local, setup encryption and
  plaintext-downgrade rejection: **4 passed**. The generic case observed
  `sync-ops.json` and `sync-state__1__02d828f00c605c08.json`, both version 3.
  Log: `/tmp/sync-s6a-v3-generic.log`.
- Selected v3: the other adapted snapshot-replacement PUT witness: **1 passed**.
  Log: `/tmp/sync-s6a-v3-replacement.log`.
- Selected v3: both explicit-v2 #10239 regressions, all four #10256 cases, and
  legacy migration Keep local: **7 passed**.
  Log: `/tmp/sync-s6a-v3-regressions.log`.
- Selected v2: generic full flow (observed version-2 `sync-data.json`) plus the
  explicit-v3 surgical response-loss/restart override: **2 passed**.
  Log: `/tmp/sync-s6a-v2.log`.

These **14 focused cases passed with zero skips**.

Negative control: temporarily replaced the setup fallback with
`config.isUseSplitSyncFiles ?? false`, leaving the expected suite mode at v3.
The generic two-client case failed at the real `sync-ops.json` GET assertion:
that file returned 404 while `sync-data.json` returned 200 with version 2.
The selector was then restored and the same test **passed** in v3 mode (one
additional positive run). Logs: `/tmp/sync-s6a-negative.log`,
`/tmp/sync-s6a-negative-files.json`, `/tmp/sync-s6a-restored.log`. The mutation
is not part of this commit.

## Independent review and correction

Two read-only subagents reviewed the complete frozen diff against the dependency
head (snapshot patch SHA-256
`f2815c7e2bc5d746d414f937dcdb620bda2dc7433d27e06228d7b899ba846ffd`).
The correctness review found no issues. The adversarial review identified one
valid gap: inspecting only the v3 ops file weakened encryption and unchanged-remote
checks because snapshots are separate files.

The existing encryption tests now record the actual snapshot upload URLs and
inspect those snapshots alongside the commit file, including the fixed
compatibility copy. The task is seeded before setup so the initial snapshot is
nonempty; the plaintext fixture verifies that each file contains the task.
Both corrected cases passed in v3 and v2 (**4 additional passes**, for **19
successful focused executions** total). Logs:
`/tmp/sync-s6a-v3-encryption.log`, `/tmp/sync-s6a-v2-encryption.log`.

Two further negative controls changed only the fixed snapshot, leaving ops
untouched: a plaintext snapshot failed the encrypted-content assertion, and a
snapshot byte change failed the unchanged-remote assertion. Both failed at
`sync-state.json` as intended (`/tmp/sync-s6a-snapshot-negative.log`). All
temporary mutations were removed; the restored spec matches the passing version.

This extra test-only scope preserves the assertions when moving from one remote
file to split files; it adds no production behavior or general test framework.
A third independent careful review of the corrected commit found no further
issues.

## Integrated master revalidation

After rebasing onto `1001dedbf1bcb1cbf0a9a0ec10aa51803ba0bb89`, all eight
TypeScript file checks passed again. Workflow YAML/wiring checks and formatting
passed; v2 and v3 still discover the same 61 tests in 22 files. A follow-up
subagent review found no incompatibilities with the new base.

The standalone `tsc -p e2e/tsconfig.json --noEmit` now encounters an upstream
path-resolution error: the merged SuperSync reorder spec imports
`CompactOperationLogEntry`, whose `VectorClock` import uses `src/...`. An archive
of unmodified master reproduces the same sole error
(`/tmp/sync-s6a-integrated-base-typing.log`). The full E2E typecheck passes with
`--baseUrl .`. This task does not alter the unrelated SuperSync spec or shared
TypeScript configuration.

The focused v3 rerun passed **12 tests**, with zero skips/retries: generic full
flow, both adapted first-sync PUT witnesses, both strengthened encryption cases,
both explicit-v2 #10239 fixtures, all four #10256 cases, and legacy migration
Keep local. It observed version-3 `sync-ops.json` and
`sync-state__1__1fd7a889ac213f18.json` on the actual remote.
Log: `/tmp/sync-s6a-integrated-v3.log`.

The v2 rerun passed **4 tests**, also with zero skips/retries: generic full flow
(observed version-2 `sync-data.json`), both strengthened encryption cases, and the
explicit-v3 response-loss/restart override. Log:
`/tmp/sync-s6a-integrated-v2.log`. In total, **16 focused executions passed on the
integrated base**, in addition to the original dependency checks above.

## Publication refresh

The single reviewed S6A commit `48cdf064911f7be4580a3a9448b01888d059a64b` was
replayed onto `ea1e285964d5b226cdb732567dbde49866c1016a`. All nine test/workflow
files and their diff are byte-identical; the patch SHA-256 before and after is
`3119084fb47ab765bd3a357b848b544eea302078bbd80de973f745599c157410`.
The runtime AGENTS guidance was preserved and remains excluded from the commit.

The two upstream commits do not touch any S6A file. S4B2 removes the already
disabled concurrent-snapshot merge path, retaining the active conflict-dialog
behavior; its lint change only reduces that production service's size allowance.
The other commit adds a planning document. No new overlap or behavior change
warrants repeating the focused runs. No browser tests were rerun on this final
refresh: the 12 v3-selected and 4 v2-selected passes above belong to the
`1001ded` baseline. Report formatting and `git diff --check` were rechecked.

The exact PR body and final baseline/head manifest are local publication artifacts
under `/tmp/sync-s6a-publication-bwyef2ou/`. Publication remains unauthorized.

## Remaining gates

The #10272 dependency is merged and S6A is rebased onto integrated master. This
local commit is not published. Obtain approval to publish the separate test/CI
PR, then dispatch **E2E Tests (Scheduled)** on that published head with
`run_webdav=true`, `webdav_format=v3`, `webdav_grep=@webdav`; retain a separate v2
full-suite run. No workflow was dispatched on this unpublished head.

The full genuine v3 suite remains an explicit gate. Existing v2 CI and these
focused local runs do not satisfy it. Adapter cleanup/integration and the other
S6 rollout gates remain in place; this is S6A preparation, not completion of S6.
S6B must still default only new empty remote folders to v3, preserve discovered
v2/v3 and explicit migration, and never infer emptiness from discovery errors.
