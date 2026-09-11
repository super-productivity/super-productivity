# Sync regression coverage: September 3–10, 2026

Audited the current branch's history through `f6cf7cd79e`, using commit dates
from September 3 onward. This includes device sync, persistence/recovery,
tracking presence, and issue-provider sync. Existing reproductions are reused;
an additional browser test is useful where it exercises a missing user flow or
a boundary that the existing unit/integration tests do not cover.

## Added coverage

| Change                                                                              | Browser reproduction                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `b1b39f9c60` #9916 / #9904: starting a completed task must emit a persistent reopen | [Task reopening](tests/sync/supersync-reopen-started-task-9904.spec.ts): start a done task with `Y`, sync to another device, verify `isDone` and `doneOn`, then reload. Also start a parent whose only subtask is done and verify that the child reopens remotely.                                                       |
| `5bde0aa362` #9922 / #8764: unknown wire vocabulary must block per operation        | [Mid-batch errors](tests/sync/supersync-error-scenarios.spec.ts): extend the existing schema-version scenario with unknown `opType` and `syncImportReason`. Intercept real encrypted operations, require the valid prefix, preserve the cursor, and recover the blocked suffix after removing the incompatible metadata. |
| `50db311cdd` #9900: issue refresh must respect field sync directions                | [GitHub refresh](tests/issue-provider-panel/github-sync-direction-9900.spec.ts): import through the bundled provider with title sync off; refresh a changed issue and require the status update while preserving the mapped title. Only GitHub HTTP responses are stubbed.                                               |
| `50db311cdd` #9900: calendar connection errors must reach the setup dialog          | [Calendar connection error](tests/issue-provider-panel/calendar-connection-error-9900.spec.ts): a real HTTP 401 failure reaches the toast without exposing the private calendar URL.                                                                                                                                     |

## Existing browser reproductions retained

| Change                                                                       | Existing coverage                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2827f4cf49` #10002: local recovery points                                   | [Local recovery point](tests/sync/supersync-local-recovery-point.spec.ts) exercises remote replacement, shrink banner, browsing/restoring backups, propagation to the other client, and the pristine-device skip. [Forced download](tests/sync/supersync-forced-download-pruned-import.spec.ts) also asserts that duplicate imports do not rotate the ring. Ring rotation, quota failure, and undo identity have store/integration tests. |
| `188cbc1450` #9943 / #9932: archive-only legacy joins and migration outcomes | [Legacy migration](tests/sync/supersync-legacy-migration-sync.spec.ts), archive-only join: conflict dialog, Keep local, genesis acknowledgement, and archived task arrival on the other device. Seeding outcomes and interrupted writes have service/integration tests.                                                                                                                                                                   |
| `ee455beef0` #9975: ignore already-applied operations on forced download     | [Forced download after compaction](tests/sync/supersync-forced-download-pruned-import.spec.ts) checks the real rejection/re-download path and watches for unexpected conflict dialogs independently of helpers that auto-dismiss them.                                                                                                                                                                                                    |
| `323f454c61` #9931 / #9256: empty device cannot overwrite the server         | [Final-page decrypt failure](tests/sync/supersync-final-page-decrypt-failure-9256.spec.ts) has both the blocked decrypt reproduction and refusal of a destructive overwrite, with server-copy preservation.                                                                                                                                                                                                                               |
| `5289cd1961` #9930 / #9921 and `eaad99dad6` #9919 / #9863: genesis-only join | [Legacy migration](tests/sync/supersync-legacy-migration-sync.spec.ts) seeds credentials before boot, verifies ordinary server operations without a full-state import, requires the conflict dialog, and verifies local data reaches the other device. Other cases cover Keep remote and first-client migration.                                                                                                                          |
| `51edc77a6b` #9887: legacy late joiner adopts server data                    | The existing Keep remote case in [legacy migration](tests/sync/supersync-legacy-migration-sync.spec.ts) is the reproduction added by this commit.                                                                                                                                                                                                                                                                                         |
| `e35e82317a` #9879: tracking-presence device labels                          | [Tracking presence](tests/sync/supersync-tracking-presence.spec.ts) covers remote tracking and labels; native OS/device-name construction is covered by platform/unit tests.                                                                                                                                                                                                                                                              |
| `2182ec335c` #9884: remove profiles and migrate persistence                  | [Profiles-era migration](tests/migration/user-profiles-removal-v11.spec.ts) boots seeded old IndexedDB data and checks retained active drafts. Backup/export compatibility has corresponding unit tests.                                                                                                                                                                                                                                  |
| `b973ac9747` #9982 and `f6cf7cd79e` #10011: privacy in exportable logs       | [Decrypt failure](tests/sync/supersync-final-page-decrypt-failure-9256.spec.ts) checks diagnostic exports. Individual log call sites, lint-rule holes, and Electron spellchecking are covered more directly by lint/unit/native tests.                                                                                                                                                                                                    |

## Changes where an additional browser test would not help

| Change                                                                                                                 | Reason / appropriate coverage                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `992c81d1cb` #9920 / #8746: shared SQLite connection gate                                                              | `sqlite-shared-connection.integration.spec.ts` exercises both adapters and native connection scheduling. Chromium uses IndexedDB and cannot reproduce the native SQLite race.                                      |
| `cfa858661c` #9918 / #8305: mid-batch archive failure at boot                                                          | `operation-log-hydrator.failed-op-boot.integration.spec.ts` and `.retry.integration.spec.ts` already exercise boot/retry boundaries. A browser equivalent needs an artificial internal archive-write failure hook. |
| `d25707d26e` #9915 / #8761: compensation survives failed resolution apply                                              | `conflict-resolution-persistence.integration.spec.ts` controls the failed apply at the persistence boundary. A browser cannot naturally force that specific internal failure.                                      |
| `a95e148aa4` #9847: causal full-state SQL lookup plan                                                                  | SQL integration and PGlite plan tests verify query semantics and planner behavior. Browser task convergence cannot distinguish a generic from a custom PostgreSQL plan.                                            |
| `df16412c8b` #9889: crash-killed backup must not look valid                                                            | `packages/super-sync-server/tests/backup-script.spec.ts` exercises the shell script and failed backup publication; this does not run in the browser.                                                               |
| `78b31bdbc6` #9917 / #9695: orphaned PostgreSQL health probes                                                          | Docker process adoption / postmaster restart behavior, not a browser behavior.                                                                                                                                     |
| `6872e7678b` #9995: isolate and clean up test containers                                                               | Test harness lifecycle. Verify container startup/teardown, not another app E2E.                                                                                                                                    |
| `b9bf872bf2` #9859: Fastify security update                                                                            | Server security tests directly cover the changed HTTP behavior. Existing sync E2Es exercise the server's normal requests.                                                                                          |
| #9998 nodemailer, #9933 WebAuthn, #9860 XML parser, #9974 security lockfile updates, and other dependency-only changes | No new sync workflow; exercise existing tests instead of duplicating them per dependency bump.                                                                                                                     |
| #9984, #9983, #9955 and other CI changes; #9994 docs; #9896 and the timezone/menu E2E fixes                            | Automation, documentation, or existing-test reliability, not new sync behavior.                                                                                                                                    |

Adjacent task/UI/API changes (#9880 appointment placement, #9525 plugin project
deletion, #9834 duplicate shortcut, #9883 automation keyboard triggers, and #9986
copy-as-checklist) do not change the device-sync protocol or replay behavior.
They use the existing task/project actions or change local presentation; their
own feature tests and existing sync/cascade tests remain the appropriate coverage.
The other #9900 fixes (shortcut handling, GitLab worklog day, and finish-day hook)
have focused feature/effect tests and do not introduce a device-sync path.

## Validation

Final focused run: **7 passed in 5.6 minutes, with retries disabled** (six new
cases plus the existing mid-batch schema-version control).

Verified with Chromium, the checked-out SuperSync server, and a disposable
PostgreSQL 15 database. `E2E_REQUIRE_SUPERSYNC=true` prevents an unavailable
backend from silently skipping the sync tests.

Each of the six new cases was also verified against the old behavior:

- Reopening: temporarily used the task reducer and internal effects from
  `b1b39f9c60^`; both remote tasks remained completed.
- Vocabulary: used the converter from `5bde0aa362^` and removed the later
  unknown-vocabulary gate; an unknown type lost the valid prefix, and an unknown
  import reason incorrectly completed sync instead of blocking.
- Calendar/GitHub: used the respective service implementations from
  `50db311cdd^`; the calendar toast lost the HTTP detail and GitHub replaced the
  protected title. These controls were rerun after compilation settled to
  exclude dev-server startup failures.

All temporary production edits were restored byte for byte. `npm run checkFile`
passed for all four changed TypeScript test files and the restored source files.
Existing tests listed above were inspected for coverage; the full SuperSync and
WebDAV suites were not rerun as part of this audit.

To run the focused cases using the repository's Docker-backed runner:

```sh
npm run e2e:supersync:file -- \
  e2e/tests/sync/supersync-reopen-started-task-9904.spec.ts \
  e2e/tests/sync/supersync-error-scenarios.spec.ts \
  e2e/tests/issue-provider-panel/github-sync-direction-9900.spec.ts \
  e2e/tests/issue-provider-panel/calendar-connection-error-9900.spec.ts \
  --grep 'reopening|Mid-batch|GitHub refresh|calendar connection failure' \
  --workers=1 --retries=0
```
