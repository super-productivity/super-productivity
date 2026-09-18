# Released-client checkpoint compatibility experiment (#9962)

This opt-in browser experiment tests an upgrade requirement using the unmodified
web assets extracted from published Android APKs. It does not enable checkpoints
or implement a production server gate.

## Findings (2026-09-18)

- v18.14.0 preserves pending task operation IDs after HTTP 426 rejects a download
  and, separately, an upload. The task and pending operation survive a reload.
- Upgrading the same browser profile to v19.0.1 preserves the pending operation.
  After rejection is lifted, the client receives a causal REPAIR checkpoint,
  uploads its pending task, and a second client receives that task.
- Downgrading a v19.0.1 profile to v18.14.0 fails during startup: the old release
  requests IndexedDB version 7, but the profile has version 11. The test dismisses
  the database error without modifying the database. Re-upgrading preserves the
  pending task and completes sync across the stored checkpoint.

The checkpoint fixture reuses the initial encrypted SYNC_IMPORT uploaded by the
real app. It asserts that this is the complete server history before submitting
a REPAIR with the exact current base sequence and a concurrent author clock.
The offline task is absent from that checkpoint. No app state is fabricated.

HTTP rejection is injected at the browser network boundary. The server, encrypted
payloads, browser persistence, upgrade migrations, and subsequent sync are real.
Service workers are blocked to prevent cached assets or intercepted requests from
silently bypassing the selected release or rejection.

## Reproduce locally

Use a disposable local SuperSync database/server with `TEST_MODE=true` and
`TEST_MODE_CONFIRM=yes-i-understand-the-risks`. The test rejects non-loopback sync
URLs. Allow CORS from `http://127.0.0.1:4249`; that port hosts the released assets.
The server's generated Prisma client must match its checked-out schema. Do not
regenerate a shared client belonging to another worktree; generate an isolated
client if necessary. The normal local E2E database setup is sufficient; these
tests do not measure production query plans or pruning.

Download `app-play-release.apk` from each release and extract **only**
`assets/public/`, preserving its contents, into separate asset directories:

| Release                                                                                    | APK SHA-256                                                        |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| [v18.14.0](https://github.com/super-productivity/super-productivity/releases/tag/v18.14.0) | `1dab9bb1124200f0b2c3dc51e464a4bba38f951cb4325091e1cc4fcfb5b6126e` |
| [v19.0.1](https://github.com/super-productivity/super-productivity/releases/tag/v19.0.1)   | `9ba64b5cb0b043f442187250ac0e2e91a44f79ebdcc8dd3dc2b10588a7037530` |

Each configured directory must contain `index.html` directly:

```sh
COMPAT_OLD_ASSETS=/tmp/issue-9962-compat/v18.14.0 \
COMPAT_NEW_ASSETS=/tmp/issue-9962-compat/v19.0.1 \
SUPERSYNC_E2E_URL=http://127.0.0.1:1909 \
npx playwright test --config e2e/playwright.compatibility.config.ts
```

The tests create synthetic users and tasks. Destroy the disposable database after
the run. Never point the experiment at production. The normal E2E suite skips
these tests when the asset-directory variables are absent.

## What remains unproven

This is evidence for a possible upgrade-required policy, not authorization to
deploy it. It does not test native Android background sync, Electron/SQLite,
restoring an older browser profile, or every intermediate release. In particular,
the direct browser downgrade never reaches the versionless sync request that
would exercise the server's stale remembered-version gap.

A production gate still needs an account-level compatibility boundary, enforcement
before every relevant upload/download, and atomic handling of clients arriving
while a checkpoint is accepted. Automatic checkpoint cadence, pruning, byte
savings, and long-offline profile recovery require separate tests.
