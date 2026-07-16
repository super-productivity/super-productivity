# Conflict-review cohort and persisted-data audit (plan Task 1)

**Date:** 2026-07-16
**Scope:** Task 1 of [`2026-07-13-sync-simplification-plan.md`](2026-07-13-sync-simplification-plan.md). Blocks the conflict-review rollback (Task 6) and authorizes the producer freeze.
**Baseline:** master `6f88775ea2`. Feature under audit: conflict review / conflict journal, merged `962c5bbeb1` (PR #8874, 2026-07-11).

## Decision summary

| Question                                              | Decision                                                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Producer freeze before the next release cut?          | **Yes** — freeze both producers now (landed with this document).                                     |
| Are Snap `edge` / Play `internal` supported cohorts?  | **No** — dogfood/pre-release. No export or migration obligation.                                     |
| Journal retention / export / deletion policy          | **No export.** Rely on the existing 14-day / 200-row expiry; delete store, reader, UI and marker together in Task 6. |

These are product decisions, recorded explicitly rather than inferred from release tags, per the Task 1 acceptance criteria.

## 1. Distribution channels carrying `962c5bbeb1`

`git tag --contains 962c5bbeb1` matches no release tag (only the `issue-8983-verbose` working tag). It is on `master`. v18.14.0 was cut 2026-07-10 and does not contain it.

| Channel                        | Trigger                | From master? | Public?                  | Evidence                                                    |
| ------------------------------ | ---------------------- | ------------ | ------------------------ | ----------------------------------------------------------- |
| **Snap Store `edge`**          | every push to `master` | **Yes**      | **Yes — unauthenticated** | `.github/workflows/build.yml:2-6`, `:174-191`               |
| **Google Play `internal`**     | every push to `master` | **Yes**      | Opt-in testers (Play caps at 100) | `.github/workflows/build-android.yml:135-150`      |
| GHCR `supersync:latest`        | push to `master`       | Yes          | Server image only — no review UI | `.github/workflows/supersync-docker.yml:3-14`      |
| GitHub Release (desktop)       | tag `v*`               | No           | Yes                      | `build.yml:136-141`, `:515-524`                             |
| Web app                        | `release: published`, non-prerelease | No | Yes            | `build-update-web-app-on-release.yml:3-4`, `:11`            |
| Play production / iOS / stores | tag `v*`               | No           | Yes                      | `build-android.yml:190-198`, `build-ios.yml:2-7`            |
| Cloudflare Pages preview       | `pull_request`         | No           | Yes (URL in PR)          | `pr-preview-build.yml:3-6`                                  |

**Two cohorts already run the feature today.** Snap `edge` is the material one: it is public, requires no invitation, and snapd auto-refreshes subscribers. The Play `internal` track auto-updates its testers on-device by design (`build-android.yml:129-134`). Subscriber counts for both live in Snap Store / Play Console telemetry and are not knowable from the repo.

**Not exposed:** Electron desktop ships **no auto-updater** (`electron-builder.yaml:65-70`; the `autoUpdater` block in `electron/start-app.ts:474-486` is commented out) and master builds use `--publish never`; the web app deploys only on published non-prerelease releases; there is no nightly/canary release channel.

**Consequence:** the persisted-data obligation began at the first master push after `962c5bbeb1`, not at a future tag. The next release cut does not *create* the obligation — it expands it from these two pre-release cohorts to the entire stable fleet, which is what the freeze prevents.

## 2. Stable baseline vs master

- v18.14.0 (deployed stable): schema **v2**, op-log DB **v7**.
- master: schema **v4**, op-log DB **v10**.
- Both the v2→v3 replace/patch barrier and the v3→v4 marked-project-delete barrier are unreleased.

Unless reverted before the next tag, schema v3 compatibility, schema v4 delete-wins behaviour, and conflict review reach stable **together**. The deployed stable fleet stays v2/DB 7 until that cut.

## 3. What the journal persists

`ConflictJournalEntry` (`src/app/op-log/sync/conflict-journal.model.ts:98-112`) stores `entityTitle` plus `fieldDiffs` (`:66-93`), whose `localVal`/`remoteVal` hold **arbitrary entity field values copied verbatim** from op payloads — by design: "capture the discarded (losing) side of a conflict verbatim" (`:8-10`). There is no field allowlist; `NOISE_FIELDS` affects classification only, not storage. `kind: 'action'` diffs persist raw action payloads (`:85-92`) and are the widest content surface.

So rows contain **real user content** (task/note/project titles and discarded field values, including note bodies).

The blast radius is nonetheless small:

- **Device-local only.** Standalone IndexedDB `SUP_CONFLICT_JOURNAL` v1, store `conflicts` (`model.ts:181-185`), deliberately separate from the op-log `SUP_OPS` DB.
- **Never uploaded.** No sync/upload path reads the journal; sync code only calls `record()` and `clearAll()`. The only readers are UI.
- **Not in backups or exports.** `BackupService.loadCompleteBackup` builds solely from NgRx `AppDataComplete`, and the journal is not in NgRx; the DB constants appear nowhere outside the journal's own files.
- **Self-expiring.** `JOURNAL_RETENTION_DAYS = 14`, `JOURNAL_MAX_ENTRIES = 200`, pruned by `pruneOnStart()` (APP_INITIALIZER, `main.ts:313-321`) and opportunistically in `record()` above 220 rows.

**Known gap (accepted):** the 14-day age bound is enforced only on app start or when the row count crosses 220, so an always-on desktop can hold rows past 14 days, bounded at ~220 rows. With the writer frozen no new rows accrue, and the next app start prunes the rest.

**Known gap (accepted):** there is no user-facing way to clear the journal — the review page offers only keep/flip. `clearAll()` is reachable only via dataset replacement (`backup.service.ts:183`) or raw op-log rebuild (`operation-log-sync.service.ts:2174`). Adding a clear button was rejected: it grows UI surface on a feature slated for deletion, and with the writer frozen the content expires on its own.

## 4. Retention decision

No export path is owed, because both carrying cohorts are pre-release (§1) and the data never left the device (§3).

Task 6 must delete the writer, store, reader, UI, route, banner, badge **and** the `SUP_CONFLICT_JOURNAL_CLEARED_BEFORE` localStorage marker together. The marker is a cross-profile privacy fail-safe (#9045): `clearAll()` swallows IndexedDB errors, so if `db.clear()` fails the rows physically survive, and the marker is what hides them from every read path until `pruneOnStart()` reclaims them. **It must not be stranded** — a marker left behind with the store deleted protects nothing, and a store left behind with the marker deleted exposes profile A's titles to profile B.

Deleting the journal's IndexedDB is itself part of Task 6: dropping the store code without deleting `SUP_CONFLICT_JOURNAL` would leave user content on disk with no code path to reach or prune it. A live constraint already recorded in-code (`conflict-journal.service.ts:68-70`) is that any future "reset app data" flow clearing localStorage must also clear the journal DB.

## 5. What this audit does not authorize

Per the Task 1 stop condition, this audit authorizes **removal of producers only**. It does not authorize schema downgrade, nor reader removal, while supported stored data remains possible. Task 6 remains gated on the preserve list in the plan (schema v3/v4 barriers, delete-wins, #9048 cascade recovery, #9035 clientId tiebreak, #9025 LWW projectId sanitization, #9045 decrypt-path footprint auth).

## 6. Action taken

The producer freeze landed with this document — see `remote-ops-processing.service.ts`, the single production entry point into `autoResolveConflictsLWW`:

- `disableDisjointMerge: true` — conflicts resolve by whole-entity LWW, the behaviour of every released version to date, so the stable fleet gains no merge behaviour it would later be migrated off.
- `disableConflictJournal: true` — no new rows are persisted.

Both are caller-wired rather than global, so `ConflictResolutionService` keeps the capability intact for its own tests and the freeze reverts by deleting two lines. Rows already written on edge/internal builds stay readable and expire on their own; the full rollback proceeds on its own schedule in Task 6.
