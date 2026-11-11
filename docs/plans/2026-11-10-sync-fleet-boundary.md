# Bounding the released fleet: version floor, checkpoints and one file format

> **Status: Planned.** The maintainer accepted the recommendation and the
> defaults F1–F9 on 2026-11-10. Nothing here is built yet.
>
> **Owner:** @johannesjo. **Tracking:**
> [#10397](https://github.com/super-productivity/super-productivity/issues/10397)
> (floor), [#9962](https://github.com/super-productivity/super-productivity/issues/9962)
> (checkpoints), tracker
> [#10393](https://github.com/super-productivity/super-productivity/issues/10393).
>
> **Last verified against the code:** 2026-11-10, master `954256d` (app
> v20.0.0). Release claims were checked against the tags v19.1.0, v19.2.0,
> v19.3.0, v19.3.1 and v20.0.0 with `git grep <pattern> <tag> -- <file>`.
>
> **Removal condition:** delete this file once decisions F1–F9 below are
> answered and their results have moved into
> [`client-version-floor.md`](../sync-and-op-log/client-version-floor.md), the
> server's [`architecture.md`](../../packages/super-sync-server/docs/architecture.md)
> and [`operation-log-architecture.md`](../sync-and-op-log/operation-log-architecture.md)
> part B. If the answer is "do nothing", move the missing-evidence list to
> #10397 and delete it then.

**The question.** Released clients stay in use indefinitely, so every shipped
op shape and reducer stays live, and structural sync fixes keep being deferred
"until the floor". How should the fleet be bounded on each transport, in what
order, and is it worth doing now?

**Short answer.**

- **One version is the natural boundary on both transports: v19.2.0**
  (2026-10-11). It is the first release that sends `appVersion` on every
  SuperSync request, handles `CLIENT_UPDATE_REQUIRED`, shows a calm notice for
  a file format newer than it reads, and joins a v3 folder without a toggle
  (measured from the tags, see below). A gate that treats a missing version
  as old cannot sit lower: v19.1.0 sends the version on downloads only.
- **A SuperSync floor alone deletes almost no client code.** The same client
  build also syncs over files, where old devices remain. What the floor buys
  alone is server-side: checkpoints, and with them pruning. Client deletions
  need both transports bounded, and most also need old ops gone from stored
  history.
- **Checkpoints are not ready to build on.** By code reading, a device that
  is behind a causal `REPAIR` and holds pending edits drops that `REPAIR` and
  never receives the ops before it. That is the normal checkpoint case. It is
  not reproduced, and it comes before any cadence.
- **Worth doing now:** the two measurements (version spread, quota headroom),
  a reproduction of that case, and the two remaining fixes that block the v3
  default. All are small and reversible.
- **Not worth doing now:** the server gate, enforcing the floor, building
  checkpoints, or a file generation break. Each waits for a number or a
  decision named below.
- **Doing nothing is the right call** if the quota query shows almost no
  account near its limit, the database growth is affordable, and no apply-time
  change is chosen (D2 and D11 chose none).

## What was read and measured

### Release facts (measured from tags)

| Capability                                                                         | Anchor                                                                 | v19.1.0 | v19.2.0 | v19.3.1 | v20.0.0 |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------- | ------- | ------- | ------- |
| `appVersion` on every request (`_buildUrl`)                                        | `packages/sync-providers/src/super-sync/super-sync.ts`                 | no      | yes     | yes     | yes     |
| `CLIENT_UPDATE_REQUIRED` handled                                                   | same file, `_checkHttpStatus`                                          | no      | yes     | yes     | yes     |
| `appVersion` on the WebSocket handshake                                            | `src/app/op-log/sync/super-sync-websocket.service.ts`                  | no      | yes     | yes     | yes     |
| Newer file format is not treated as corruption (`isRemoteNewer`)                   | `src/app/op-log/sync-providers/file-based/assert-sync-file-version.ts` | no      | yes     | yes     | yes     |
| Format discovery (joins v3 when the setting is absent), `EMPTY_FOLDER_SYNC_FORMAT` | `src/app/op-log/sync-providers/file-based/file-based-sync-format.ts`   | no      | `'v2'`  | `'v2'`  | `'v2'`  |
| `deleteNote` carries the note                                                      | `src/app/features/note/store/note.actions.ts`                          | no      | yes     | yes     | yes     |
| `deleteSimpleCounter` carries the counter (#11465)                                 | `src/app/features/simple-counter/store/simple-counter.actions.ts`      | no      | no      | no      | yes     |

So release N of #10397 is v19.2.0. Its four-week spread check fell on
2026-11-08 and its eight-week check falls on 2026-12-06. The read-only spread
query is in #10397 (comment of 2026-09-30). It has not been run for this note.

### SuperSync server (code reading at `954256d`)

- **No floor is enforced.** `appVersion` is read on `GET /api/sync/ops` only
  (`sync.routes.ts:132-145`) and stored per device (`device.service.ts:110-130`).
  The server reads it on no other route, and not on the WebSocket handshake.
  The gate is diagnostic: `checkpoint-gate.ts` (140 lines) feeds one daily log
  line (`cleanup.ts:67-78`).
- **Routes.** All HTTP sync routes sit in one plugin behind one
  `preHandler` (`sync.routes.ts:72`): `POST /ops`, `GET /ops`,
  `POST /snapshot`, `GET /status`, `GET /devices`, `DELETE /data`,
  `GET /restore-points`, `GET /restore/:serverSeq`. The WebSocket route is
  separate (`websocket.routes.ts:90`). It already refuses at the upgrade with an
  HTTP status in one case, the per-IP 429 in its `onRequest` hook (lines 94-104).
  Outside `/api/sync` a sync client also calls `/api/replace-token`,
  `/api/capture/*` (`packages/sync-providers/src/super-sync/super-sync.ts`)
  and `/api/connect/requests`
  (`src/app/imex/sync/super-sync-connect/super-sync-connect.api.ts`).
- **Retention can only prune before a causal full-state op.** The daily sweep
  takes the newest causal boundary per user (`storage-quota.service.ts:403-447`).
  If the prefix before it still holds an op inside retention, it falls back to
  an older boundary whose whole prefix has aged out (lines 621-634). A user
  whose only boundary is the initial import at sequence 1 is skipped.
- **Quota recovery needs two boundaries and frees only the older prefix.**
  `freeStorageForUpload` stops when one restore point or none remains (lines
  1059-1071). Otherwise it deletes the oldest restore point and everything up
  to it (`deleteOldestRestorePointAndOps`, lines 835-865). An account with the
  initial import and one later checkpoint therefore frees only sequence 1,
  the import itself. The branch that deletes everything before a single
  restore point exists (lines 862-868) but cannot be reached from here. The
  only other path that frees more is a clean-slate upload, which wipes the
  account.
- **A checkpoint upload passes the same quota check**
  (`sync.routes.snapshot-handler.ts:404`). A full account cannot write the
  checkpoint that would relieve it.
- **Every device behind a causal full-state op is moved to it.** The download
  path moves `sinceSeq` to just before the latest causal full-state op
  (`operation-download.service.ts:186-200`). A markerless legacy `REPAIR`
  does not trigger this. The server therefore never sends such a device the
  ops before the boundary.
- **A causal `REPAIR` is accepted only at the head.** The upload must prove
  `repairBaseServerSeq === lastSeq` under the row lock, else `REPAIR_STALE`
  (`sync.service.ts:287-301`).
- **A regular upload from a cursor behind a causal `REPAIR` is accepted.**
  Only imports move the stale-cursor fence. One exception: for an account
  whose fence marker was never resolved and whose import has been pruned, the
  fence resolves to the newest causal `REPAIR` (`sync.service.ts:63-81`), and
  stale-cursor uploads are then rejected as they are behind an import.
  Pruning after checkpoints produces exactly that state.
- **Default quota:** 100 MB (`prisma/schema.prisma:32`,
  `storage-quota.service.ts:23`). A full account sees a blocking alert that
  tells the user to write to support (`sync-error-utils.ts:6-10`).

### Client handling of an incoming causal `REPAIR` (code reading, not reproduced)

- With no pending work, the device applies it. Ops concurrent with it are
  kept when they come after it, and dropped as already contained when they
  sit before it in the same batch (`sync-import-filter.service.ts:227-246`).
- With meaningful pending work, the gate defers it
  (`sync-import-conflict-gate.service.ts:207-213`). The deferred `REPAIR` is
  then filtered out of the batch for good and the device validates its own
  state instead (`operation-log-sync.service.ts:1356-1362`, `:1411-1415`).
  The comment there gives the reason: "this client already applies every op
  the repair was built from".
- **Suspected defect.** That reason holds only for a device whose cursor is
  at the `REPAIR`'s base. Nothing compares the cursor with
  `repairBaseServerSeq`. A device that is behind the base and has pending
  edits is moved past the prefix by the server (above), drops the `REPAIR`,
  and so gets neither the prefix ops nor the snapshot. It would stay
  diverged, permanently once the prefix is pruned. The checkpoint experiment
  does not cover it: its history held only an import and the `REPAIR`.
  Validation repairs already produce causal `REPAIR`s today, so this is a
  question about released behaviour, not only about checkpoints.

### Production numbers (from #9962, 2026-09-07 and 2026-09-10, not re-measured)

- Database 14 GB, `operations` 13 GB with 10.06 million rows (measured).
- About 5.1 million rows, roughly half, were older than the 45-day retention
  (estimate from a 0.1% sample).
- 3,312 of 12,556 accounts (26.4%) had a causal boundary above sequence 1
  (measured). The other 74% cannot prune at all.
- Growth 108k to 154k rows per day (estimate from the same sample).

### File providers (code reading at `954256d`)

- **Two formats are live.** `file-based-sync-adapter.service.ts` is 3,172
  lines. By method ranges, about 800 lines are the v2 path (`_getCurrentSyncState`
  to `_uploadSnapshot`, lines 673-1473), about 325 the v2-to-v3 migration (lines
  1895-2218), 55 the legacy read-only download (lines 2738-2792), and about 90
  `downloadLegacySyncFile` in `file-based-sync-format.ts`. These are ranges, not
  a diff. The first range holds about 90 lines of shared entry code (target
  guards, the split dispatch, the stale-`REPAIR` check), and the second starts
  with the tombstone writer that v3 uses too. The v2-only total is about 1,100
  lines (estimate).
- **The v3 tombstone is the only lever that stops released file clients**
  (`packages/sync-providers/src/file-based-sync-data.ts:98-105`). It stops
  three groups differently:
  - before v18.14.0: a hard error on `version !== 2`;
  - v18.14.0 to v19.1.0, and any later build with a saved "off": a pause with
    a notice to turn on Surgical sync. v19.1.0 saved `isUseSplitSyncFiles: false`
    by default (`default-global-config.const.ts:244` at that tag), so devices
    upgraded from it keep the "off";
  - v19.2.0 and later with the setting absent: they join v3.

  The first group is from the code comment only: no tag before v19.1.0 was
  read. The third group may be smaller than it looks. `isUseSplitSyncFiles`
  is not a local-only key
  (`src/app/features/config/local-only-sync-settings.util.ts:20-33`), so a
  saved "off" appears to travel with synced config to a fresh device (code
  reading, not tested).

- **The three follow-ups that block the v3 default** (from
  [#10339](https://github.com/super-productivity/super-productivity/pull/10339)):

  | #   | Follow-up                                                                                                                                                                 | Status at `954256d`                                                                                                                                                                           |
  | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 1   | The snapshot path force-writes the v2 tombstone with no create-only reservation, so a concurrent v2 writer can lose an acknowledged upload                                | Open. `_uploadSnapshotSplit` still calls `_writeTombstoneAndNeutralizeBak(provider, cfg, encryptKey)` with no expected revision (adapter line 2873), which forces the write (lines 1934-1939) |
  | 2   | Android writes a file as delete, create, write. An interrupted write leaves `sync-data.json` missing, discovery reads the folder as empty, and a v3 default would flip it | Open. `SafBridgePlugin.kt:131-137` still deletes before it creates. `discoverFileSyncFormat` checks only the two primary files, not the `.bak`                                                |
  | 3   | "Force overwrite" on a v16 `__meta_` folder failed every time                                                                                                             | Fixed in #10339: discovery ignores `__meta_`. What remains is a choice, not a bug: with a v3 default, that overwrite writes v3                                                                |

  The gate from #10339 also stands: one default-path v3 WebDAV run on master.

### Released-client behaviour on a refusal

- **Proven** ([checkpoint experiment](../sync-and-op-log/checkpoint-compatibility-experiment.md)):
  v18.14.0 keeps its pending ops across an HTTP 426 on download and on upload,
  and across the upgrade to v19.0.1, which then syncs past a causal `REPAIR`.
- **Code reading at v19.1.0:** a failed snapshot upload returns
  `{ accepted: false }` for every thrown error
  (`operation-log-upload.service.ts:846-853` at that tag), which is the
  misclassification [`client-version-floor.md`](../sync-and-op-log/client-version-floor.md)
  point 4 describes. A message containing `503` matches the retryable patterns
  (`packages/sync-providers/src/http/retryable-upload-error.ts`), and the
  caller then leaves the op pending instead of rejecting it (lines 349-354).
  A normal upload rethrows and its ops stay pending. The web path does not
  retry a status error inside a request, and the native path turns a 503 into
  a network error, which is also retryable.
- **Not read:** any tag before v19.1.0.
- **Not tested:** any released client against a 503 refusal, native Android
  background sync, Electron.

## Payoff inventory

What exists only for old clients, and what each needs before it can go. "Both"
means SuperSync and file providers, because the code runs on both.

| #   | Compensation                                                                                                       | Anchor and size (measured unless marked)                                                                                                                                                                  | Needs                                                                                                                            | User-visible effect of removing it                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| P1  | No checkpoints: releases before v18.15.0 treat `REPAIR` as a reset, with later fixes up to v18.21.2                | `checkpoint-gate.ts` (140 lines), the roll-up in `device.service.ts:137-143` and `cleanup.ts:67-78`                                                                                                       | Floor ≥ v18.21.2, **SuperSync only**                                                                                             | History can be pruned. No quota alert for long-lived accounts. Database growth bounded                                            |
| P2  | Singleton LWW payload carries an `id` for v18.15.0 and v18.15.1                                                    | `lww-update-op.util.ts:61-77`, plus the receiver-side strip; about 10 lines                                                                                                                               | Floor ≥ v18.16.0, both                                                                                                           | None                                                                                                                              |
| P3  | Tags re-asserted after convert-to-subtask for clients up to v18.20.1                                               | `task-internal.effects.ts:104-171`, 68 lines                                                                                                                                                              | Floor ≥ v18.21.0, both                                                                                                           | One op fewer per conversion                                                                                                       |
| P4  | A reminder clear keeps the whole-entity snapshot, because v18.15.0 to v18.21.x ignore `clearedFields` (decision 3) | `conflict-field-patch.util.ts:49-59` and `:536-541`; `time-preserving-task-snapshot.util.ts:135`                                                                                                          | Floor ≥ v18.22.0, both                                                                                                           | A concurrent edit next to a reminder clear merges per field instead of losing to the snapshot                                     |
| P5  | A type-shadowed snapshot is sent as a patch (`SUNSET: drop once v18.15.0-v19.1.0 are out`)                         | `lww-snapshot-patch-mode.util.ts`, 69 lines                                                                                                                                                               | Floor ≥ v19.2.0, both                                                                                                            | None                                                                                                                              |
| P6  | NOTE stays out of field patches until v19.1.0 leaves (decision 4)                                                  | `recreate-fallback.const.ts:63-68`                                                                                                                                                                        | Floor ≥ v19.2.0, both                                                                                                            | Concurrent edits to one note merge per field. Ends the #10380 residual (a note hidden from the project panel on a v19.1.0 device) |
| P7  | A delete without the entity recreates a partial note or a blank counter                                            | `recreate-fallback.const.ts:56-58`, `:66-68`, `:110-112`                                                                                                                                                  | Senders ≥ v19.2.0 (note) and ≥ v20.0.0 (counter), both, **and** no such op left in stored history or in a device's pending queue | The recreated entity is always whole                                                                                              |
| P8  | Reorders stay multi-entity while the stored list is written (option C of the order note)                           | `reorder-conflict.util.ts` (569 lines); reissue path; about 430 lines of list upkeep in `lww-update.meta-reducer.ts` (estimate from [the order note](../sync-and-op-log/order-and-membership-options.md)) | Floor at the future release that ships order keys, both (D7), plus O2 changed                                                    | The 12 kept order stops go (count from the order note). Lists converge                                                            |
| P9  | Op migrations and the schema tolerance band for v17.0.0 to v18.14.0                                                | `packages/shared-schema/src/migrations/` (259 lines without the index), `schema-version.ts`                                                                                                               | Floor > v18.14.0, both, and old ops gone from history. State migrations stay regardless: old JSON backups remain importable      | None                                                                                                                              |
| P10 | The whole v2 file path and the migration into v3                                                                   | About 1,100 lines, see above (estimate)                                                                                                                                                                   | Every v2 folder migrated or abandoned. This contradicts the standing decision that existing v2 folders are not migrated (F8)     | One format to fix. Fixes no longer exist twice                                                                                    |
| P11 | In-place v16 migration                                                                                             | `operation-log-migration.service.ts` (395 lines), `legacy-sup-db.service.ts` (95)                                                                                                                         | Already decided: first release after 2027-01-23. Independent of any floor                                                        | None                                                                                                                              |
| P12 | Server accepts a `REPAIR` without a base, and a snapshot without an `opId`                                         | `sync.routes.snapshot-handler.ts:113` and `:242`, `sync.service.ts:176`; a few lines each                                                                                                                 | Floor at the first release that sends both, **SuperSync only**. That release was not dated here                                  | None                                                                                                                              |
| P13 | Types without a recreate fallback re-send one full snapshot instead of patches                                     | `MERGED_SNAPSHOT_TYPES`, `conflict-field-patch.util.ts:302-310`                                                                                                                                           | Floor at a future release whose receivers have the fallback, both                                                                | Smaller resolution ops                                                                                                            |
| P14 | Section rows keep a v18.4.x wire shape                                                                             | `section-conflict-commutativity.util.ts:393`                                                                                                                                                              | Not dated here, both                                                                                                             | None                                                                                                                              |
| P15 | Files without a snapshot base, written by v19.1.0 or older, count as a gap                                         | `file-based-sync-gap.util.ts:109` and `:291`                                                                                                                                                              | Files only: no writer before v19.2.0 left in the folder                                                                          | Fewer full re-downloads                                                                                                           |

Three things follow from the table:

1. **Only P1 and the small server shims in P12 are SuperSync-only.** Every
   other row is client code that also serves file sync, with no provider
   branch in any of the files named. A SuperSync floor at any version leaves
   it in place unless the behaviour is made provider-specific, which adds a
   branch instead of removing one.
2. **Send-side and receive-side differ.** P2 to P6 are shapes a current client
   sends so that old receivers do not break. They go when no old receiver is
   left. P7 and P9 are old shapes a current client must still read. They also
   need the old ops gone: from the server log (a checkpoint plus pruning), from
   file snapshots, and from the pending queue of a device that captured them
   before it was updated. A floor refuses old builds, not old ops from an
   updated build.
3. **The line count is small.** P2 to P6 together are under 200 lines. The
   large rows are P8, which needs a design nobody has chosen, and P10, which
   needs a decision reversed. The measurable payoff today is P1.

The pre-18.6.0 WebSocket storm handling (`websocket.routes.ts:62-76`,
`websocket-connection.service.ts:137`) is not a payoff. Refused clients that
reconnect produce the same traffic shape, so the keyed rate limits stay.

## Options

### SuperSync enforcement

- **(E0) None.** Today.
- **(E1) Fleet-wide, stateless.** One configured minimum version. The check is
  a function of the request alone: missing, malformed or lower `appVersion` is
  refused.
- **(E2) Per account.** A stored minimum per account, raised when that account
  takes a step old clients cannot follow.
- **(E3) Count-only mode of (E1).** The same check logs what it would refuse,
  per version, and refuses nothing.

|                               | (E1) Fleet-wide                                                        | (E2) Per account                                                                                                |
| ----------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| State                         | None                                                                   | A column, and a rule for who raises it                                                                          |
| Arrival race                  | None: an old device is refused whenever it arrives                     | Exists: a device arriving between the eligibility check and the raise (#9962's open gap)                        |
| Returning device, row deleted | Refused by its version, with or without a device row                   | Needs the stored minimum, which survives, so equal here                                                         |
| Same-id downgrade             | Refused: each request states its version                               | Equal, if checked per request                                                                                   |
| Who is stopped                | Every account with an old device, including accounts that gain nothing | Only accounts that moved                                                                                        |
| What it enables               | Checkpoints for everyone. Apply-time changes on SuperSync              | The same per account, at the cost of two live behaviours on the server for as long as any account has not moved |
| Fits                          | A floor set once at an old, widely passed version                      | A protocol generation migration (review Phase 3), which D2 did not choose                                       |

**Coverage.** One `onRequest` hook in the sync plugin covers every HTTP route
listed above, and the same function in the WebSocket route's `onRequest`
refuses the upgrade with an HTTP status. It must be `onRequest`, not
`preHandler`: a `preHandler` runs after the body is received and parsed, up to
the 30 MB snapshot limit, and `authenticate` is a `preHandler` too. The
version is in the query string, so `onRequest` can read it. A refused request
then costs no body, token or database work, and an old client with an expired
token gets the refusal instead of a 401 that counts toward its three-strike
sign-out. The route rate limit still runs first.

- Account, login and recovery routes stay open, so a refused user can still
  sign in on the web, export and delete.
- `/api/replace-token`, `/api/capture/*` and `/api/connect/requests` are
  outside the sync plugin. They write no ops, so the default is to leave them
  open. This needs a decision per route when the gate is built.
- A browser cannot read the body of a refused WebSocket upgrade. The old
  client reconnects with backoff, and the notice comes from its next HTTP
  request, as `client-version-floor.md` point 2 says.

**Status code.** 503 with `{ errorCode: 'CLIENT_UPDATE_REQUIRED' }`, as #10397
proposes.

- Clients from v19.2.0 match the code under any status.
- Older clients treat 503 as retryable by its message, so a pending full-state
  op is not marked rejected. A 4xx such as 426 is the honest status, and
  v18.14.0 kept its ops across it, but for a device older than v19.2.0 with a
  pending full-state op it becomes a rejection.
- The sibling fix for misclassified snapshot failures changes nothing for
  clients already released. It helps only where the refusal code is not
  matched, and every client that has it also matches the code.
- Risk: a proxy that replaces 5xx bodies hides the code from new clients.
  They then see a plain server error, and nothing is lost. The hosted proxy is
  under our control.

**Request volume (estimate, unmeasured).** A refused device sends what it
sends today: its interval sync, one upload per debounced edit (2 s,
`immediate-upload.service.ts:24`) and up to 50 WebSocket attempts per session
with 1 to 60 s backoff. Each is answered before auth and the database, so a
refused device costs less than a served one. Neither current clients nor
v19.1.0 retry an HTTP status inside a request (code reading). Earlier tags
were not read.

**What count-only mode can and cannot show.** It counts requests it would
refuse, per route. It cannot split them by version below v19.2.0: those
builds send no version on uploads or the handshake, so they all count as
"missing". Counted before auth, the requests are also not tied to accounts.
The per-version and per-account view stays with `sync_devices`, from
downloads.

**Self-hosted.** Off unless configured. Advertise the active minimum in the
download response's `capabilities`, next to `causalRepairSnapshots`
(`sync.routes.ts:185`), so a client can tell a server with a floor from one
without.

### Checkpoints on top of the gate

Under E2EE only a client can write a full-state boundary.

- **(K0) None.** History grows until the quota alert.
- **(K1) Causal `REPAIR`, as it exists.** The server path, the stale check
  and the receiver filter are shipped. The receiver's deferral is shipped too,
  with the suspected defect described above.
- **(K2) (K1) plus an inert marker** (`isCheckpoint`, rule 10 style). A
  receiver that knows the marker and whose cursor equals the checkpoint's base
  skips applying it. Older receivers apply it as a causal `REPAIR`.
- **(K3) `SYNC_IMPORT`.** Rejected: it drops concurrent ops by design (rule 7).
- **(K4) Server-built.** Impossible under E2EE (#9688).

|                          | (K1) Causal `REPAIR`                                                                                                                  | (K2) With a skip marker                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| New wire or server code  | A trigger only                                                                                                                        | A trigger and one optional field                          |
| Floor needed             | The release that carries the receiver rule (suspected defect above). ≥ v18.21.2 for the filter alone                                  | The same. The marker needs none                           |
| Cost per checkpoint      | Every other device downloads and applies one full state                                                                               | Up-to-date devices skip. Devices behind still download it |
| Effect on diverged state | Every device adopts the author's state. Divergence is healed, and a damaged author spreads its damage                                 | Up-to-date devices keep their own state, as today         |
| Risk                     | Runs the full-state replace path on every device at every checkpoint. That path produced #9773. The suspected deferral defect applies | Lower exposure, one more branch. The same defect applies  |

**Trigger.** Server-requested, not timed. The server knows the retained delta
bytes since the last causal boundary and the size of that boundary. It sets an
optional flag in a download response. A client acts on it only when it has no
pending ops, has completed initial sync and holds valid state. Reasons:

- A checkpoint costs one full state, and every checkpoint inside the 45-day
  window is retained whole. Frequent checkpoints store more than they free.
  Ask only when the prunable deltas outweigh the state by a factor (F6).
- The client does not know its usage: `/status` is not used by the production
  client.
- Servers without the feature never ask, so self-hosted is off by default.

**Two devices asked at once.** The second `REPAIR` fails the base check and
gets `REPAIR_STALE`. A stale checkpoint must be dropped, not rebased: this is
new client logic, since today's stale repair is rebased.

**Arrivals during acceptance.**

- An upload that lands first makes the checkpoint stale (above). No op is
  lost.
- An old device is refused by (E1) on every route, before and after. This is
  why (E1) removes the per-account gate rather than repairing it.
- A current device with pending work that is at the checkpoint's base drops
  the checkpoint and keeps its own state, which already contains the prefix.
  Its ops upload as concurrent and are accepted.
- A current device with pending work that is **behind** the base is the
  suspected defect: it drops the checkpoint and never gets the prefix.
  The experiment proved one neighbouring case only: v19.0.1 with one pending
  task and a history of import plus `REPAIR`.

**Devices unseen for 45 days.** Only the device row is deleted. On return an
old build is refused and keeps its ops until it is updated. A current build
without pending work is moved to the latest checkpoint and applies it. A
current build with pending work is the suspected defect again, and after
pruning the prefix can no longer be fetched at all. So a checkpoint needs a
receiver rule first: defer only when the cursor is at the base, otherwise
apply the checkpoint and replay the pending ops on top. That rule is an
apply-time change in the client, which only builds from that release on
follow. The floor for checkpoints is then that release, not v18.21.2 and not
v19.2.0.

Also open: the fence exception above. After the import is pruned, a stale
cursor behind a checkpoint is treated as behind an import.

**Pruning that follows.**

- The daily sweep prunes the prefix before a boundary once that whole prefix
  is older than 45 days. Steady state per account: everything from the
  boundary in use onward, which is all deltas since then plus every later
  full-state op.
- **The quota path must change with it.** As written it frees only the
  initial import for an account with that import and one checkpoint. The
  server never sends ops before the newest boundary to a device behind it, so
  quota recovery could delete everything before it by making the existing
  single-restore-point branch reachable. That trades restore points inside
  the window for staying under quota (F7).
- The checkpoint upload itself must pass the quota check, so the request has
  to come well before the account is full. An account that is already full
  gains nothing from checkpoints as designed here.

**Byte savings.** Upper bound, estimate: about half of `operations` rows were
past retention in September, most of them in the 74% of accounts with no
boundary. At the 1.3 KB per row assumed in #9962 that is in the order of 6 GB,
minus one full state per account, whose size distribution is unknown. Needs
production data: state size per account (`payload_bytes` of the last
full-state op), prunable delta bytes per account, and accounts above 50% and
80% of quota. The sibling quota-headroom query supplies the last one.

### File providers

A file folder has no server, so the only boundary is a format generation: a
file an old build refuses to read or write.

- **(V0) Leave both formats.** v2 default, v3 opt-in.
- **(V1) Finish the v3 default** (already decided on 2026-09-26). New folders
  are v3. Existing v2 folders stay.
- **(V2) Migrate v2 folders and retire the v2 writer.** The tombstone stops
  old builds. The v2 reader stays as the migration source.
- **(V3) A further generation (a version 4 file)** whenever an apply-time
  change needs every reader on new rules.

|                         | (V1) v3 default                                                                                                          | (V2) Migrate v2                                                                               | (V3) Next generation                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Blocked by              | Follow-ups 1 and 2, one WebDAV run                                                                                       | (V1), and decision 4 of the review                                                            | A chosen apply-time change (none exists)                                                                                                 |
| Who is stopped          | Nobody on existing folders. Builds before v19.2.0 cannot join a new folder without the toggle, or at all before v18.14.0 | Every build before v19.2.0, and every upgraded device with a saved "off", in every folder     | Every build before the release that reads it                                                                                             |
| What an old build shows | Pause notice (v18.14.0+) or a version error                                                                              | The same                                                                                      | v19.2.0+: the calm "newer version" notice. v18.14.0 to v19.1.0 with split on: treated as corruption, restored from `.bak`, may overwrite |
| Code removed            | None                                                                                                                     | The v2 write path, about 800 lines of ranges (estimate). The migration and the v2 reader stay | None until the generation before it is dropped                                                                                           |
| Reversible              | Yes: one constant                                                                                                        | No: a folder migration is one-way                                                             | No                                                                                                                                       |

**End state with one format.** v3 only for writing. The v2 reader survives as
long as a v2 folder may be met, which without telemetry is unbounded. So "one
format" can mean one write path, not zero v2 code.

**What v3 must offer before it can be the boundary.** A split-on reader from
v18.14.0 to v19.1.0 that meets a _newer_ split version restores from `.bak`
and may overwrite it (`protocol-change-options.md`, recommendation 6). Only
v19.2.0 and later refuse it. So (V3) is safe only once v3 folders contain no
reader older than v19.2.0, which nothing can observe. The tombstone covers the
v2 side only.

**What LocalFile and weak-ETag WebDAV cannot guarantee.** Neither has
compare-and-swap (`operation-log-architecture.md` B.1). The migration lock and
the create-only reservation are best effort there: two devices can migrate at
once, and an old writer can overwrite a tombstone between a read and a write.
What still holds: the tombstone and the neutralized `.bak` stop an old build
at its next read, and the ops-file probe catches a v2 file next to committed
v3 ops. LocalFile is documented as single-writer and backup-only, so a format
break there protects order, not concurrency. Android adds follow-up 2: its
write is not atomic. A download-only device is invisible, and the format break
is its only protection.

## Comparison

| Step                                | Payoff                                                   | Cost                                                                  | Risk to released clients                                                                                                 | Reversible                                 | Can ship dark               | Needs first                                                                 |
| ----------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | --------------------------- | --------------------------------------------------------------------------- |
| Do nothing                          | None                                                     | None                                                                  | None                                                                                                                     | –                                          | –                           | –                                                                           |
| Run the spread and quota queries    | Sizes every later step                                   | Two read-only queries                                                 | None                                                                                                                     | –                                          | –                           | Nothing                                                                     |
| (E3) count-only gate                | Refusal counts per route. No version split below v19.2.0 | Small: one hook, one setting, tests                                   | None                                                                                                                     | Yes: unset it                              | Yes, it is the dark mode    | Spread near the threshold                                                   |
| (E1) enforce, no lower than v19.2.0 | P1. On SuperSync alone, nothing else                     | A switch, plus support load                                           | Older builds stop syncing until updated. Edits stay pending                                                              | Yes: unset it. Stopped devices resume      | Yes: off by default         | Spread under the threshold, a named payoff                                  |
| (K1) or (K2) checkpoints            | Pruning, quota relief, bounded database                  | Large: receiver rule, trigger, drop-on-stale, quota path, fence, E2Es | Silent divergence on a device behind the checkpoint with pending edits, unless the receiver rule ships first (suspected) | The trigger, yes. A written checkpoint, no | Yes: the server asks nobody | The reproduction, a floor at the release with the receiver rule, quota data |
| (V1) v3 default                     | New folders on the long-term format                      | Small: follow-ups 1 and 2, one WebDAV run                             | Old builds cannot join new folders                                                                                       | Yes: one constant. Created folders stay v3 | No                          | Nothing                                                                     |
| (V2) migrate v2                     | One write path                                           | Medium, on providers without CAS                                      | Every older build stops in every folder                                                                                  | No                                         | No                          | (V1) proven, F8                                                             |
| (V3) next file generation           | Apply-time changes on file sync                          | Large                                                                 | As (V2), and unsafe for split-on builds before v19.2.0                                                                   | No                                         | No                          | A chosen change (D2)                                                        |

## Recommendation

1. **Run the two queries now** and save the results in #10397 and #9962. The
   four-week spread check is two days overdue.
2. **Reproduce the deferred-`REPAIR` case with an E2E:** device A offline
   with a pending edit, device B uploads ops, a causal `REPAIR` lands, A
   syncs. Check that A has B's ops. If it fails, it is a data-divergence bug
   on a released path and goes through fix intake on its own. If it passes,
   remove the "suspected" notes here.
3. **Fix follow-ups 1 and 2 and flip the v3 default (V1)** after the
   default-path WebDAV run. This is already decided and does not depend on
   anything else here.
4. **Build the gate, count-only first (E3), only when the spread is near the
   threshold and the quota data shows a need.** Fleet-wide, stateless, in
   `onRequest`, on every sync route and the WebSocket upgrade, off by default.
5. **Enforce (E1) no lower than v19.2.0.** A gate that refuses a missing
   version refuses every older build anyway, because none of them sends one
   on uploads. If checkpoints are the payoff, the floor is the release that
   carries the receiver rule from step 2, which restarts the months of
   waiting. Without checkpoints, a SuperSync floor has no payoff worth
   stopping devices for.
6. **Then build checkpoints as (K1) with a server-requested trigger**, and
   decide on (K2)'s marker from the measured cost per device. Change the quota
   path and settle the fence exception in the same work. Delete the diagnostic
   gate (P1) afterwards.
7. **Do not start (V2) or (V3).** (V2) removes one write path at the price of
   stopping every older file device, with no report asking for it. (V3) needs
   an apply-time change that D2 and D11 declined.
8. **Do not promise client deletions from the floor.** P2 to P6 go only when
   file providers are bounded too. Say so in #10397, where three of them are
   listed as payoffs of the SuperSync floor.

**When doing nothing is right.** If the quota query shows no meaningful group
of accounts above about half of their quota, and the database growth is
acceptable for hosting, stop after steps 1 to 3 and build nothing on the
server. Steps 2 and 3 stand on their own. The floor then has no payoff on
SuperSync, and enforcing it would stop devices for nothing.

### Decisions needed from @johannesjo

@johannesjo answered the recommendation on 2026-11-10 with "Do as recommend".
The defaults below are therefore the decisions, and recommendations 1 to 8
are the plan. Nothing in F1 to F7 is built by that answer: each still waits
for the evidence its recommendation names.

| #   | Question                                                     | Decided                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1  | Fleet-wide or per-account floor?                             | Fleet-wide (E1). Per-account only if a generation migration is ever chosen                                                                                                                                         |
| F2  | Floor value and threshold                                    | No lower than v19.2.0, and the release with the receiver rule if checkpoints are the payoff. Enforce when under 5% of 30-day-active devices are older, from `sync_devices`, cross-checked with the count-only gate |
| F3  | Status code                                                  | 503 with the error code and a body, as #10397 proposes                                                                                                                                                             |
| F4  | Build the count-only gate now, before a payoff is confirmed? | No. Build it when the spread is near the threshold and the quota data shows a need                                                                                                                                 |
| F5  | Checkpoint semantics                                         | (K1), after the receiver rule. Add (K2)'s marker only if applying a full state on every device proves costly                                                                                                       |
| F6  | Checkpoint trigger                                           | Server-requested, when prunable delta bytes exceed four times the last full state, or usage passes half the quota. Both numbers are guesses                                                                        |
| F7  | May quota recovery delete restore points inside 45 days?     | Yes, everything before the newest boundary, only when the account is over quota                                                                                                                                    |
| F8  | Revisit "existing v2 folders are not migrated"?              | No. Keep decision 4. Revisit on a second data-loss class that exists only in v2                                                                                                                                    |
| F9  | With a v3 default, what does a v16 force overwrite write?    | v3, the default of the day                                                                                                                                                                                         |

## Missing evidence

- **Version spread** on the hosted server at four and eight weeks after
  v19.2.0, by platform. Not run for this note.
- **Quota headroom:** accounts above 50% and 80% of 100 MB, and how many have
  ever received `STORAGE_QUOTA_EXCEEDED`. The sibling query covers the first.
- **State size and prunable bytes per account,** to size the trigger and the
  savings. #9962's full dry run timed out on 2026-09-10.
- **The deferred-`REPAIR` case** (recommendation 2). Code reading only.
- **Released clients against a 503 refusal,** run rather than read: the
  pending full-state case and what the user sees. The compatibility harness
  can inject it. Tags before v19.1.0 were not read at all.
- **Whether a saved Surgical sync "off" reaches a fresh device** through
  synced config.
- **Checkpoints beyond one browser run:** native Android background sync,
  Electron, a profile offline across several checkpoints, two devices asked at
  once.
- **File fleets** cannot be counted at all. Every file-side statement about
  who is stopped is from code reading.
- **The size of P8 and P10** is from line ranges and another note's estimate,
  not from a diff.
- **Self-hosted proxies** that replace 5xx bodies: unknown share.

## Progress

**2026-11-11, recommendation 2 (reproduction): red, as suspected.** Branch
`claude/repair-deferral-behind-base-repro` adds
`gives an offline client with pending work the ops uploaded before the REPAIR`
to `e2e/tests/sync/supersync-repair-lifecycle.spec.ts`. It failed in the
scheduled E2E workflow
([run 42923512758](https://github.com/super-productivity/super-productivity/actions/runs/42923512758),
SuperSync shard 2 of 6). The server log of that run shows the mechanism:
client B downloads with `sinceSeq=2`, the server skips to the `REPAIR` at
sequence 5 ("Optimized download: skipping from sinceSeq=2 to 4"), B receives
that one op, and B's pending op is then accepted at sequence 6. Sequence 3,
the other device's task, never reaches B. The failed assertion is the wait for that task (`RepairPrefixBeforeRepair`), read from the run's error context. The existing test in the same suite did not fail. The "suspected"
notes above therefore describe a reproduced divergence on master, which goes
through fix intake on its own and is not fixed here.

**2026-11-11, recommendation 3 (v3 default): built on branch
`claude/file-sync-v3-default`, not merged, no pull request.**

- The snapshot path of a discovered-empty folder claims the v2 name with the
  create-only tombstone before it publishes split files (follow-up 1).
- Discovery treats a v2 backup without its primary as v2 (follow-up 2). The
  Android write itself (delete, then create) is unchanged: it cannot be tested
  here.
- `EMPTY_FOLDER_SYNC_FORMAT` is `'v3'`. A v16 force overwrite writes v3 (F9).
- Evidence: two new WebDAV E2Es and two new adapter tests fail with only the
  constant flipped and pass with the fixes. The rollout spec (12 tests) and
  the late-snapshot spec pass against a local Apache `mod_dav` server built
  from `e2e/webdav-server/httpd.conf`; 1,352 file-sync and sync-wrapper unit
  tests pass. CI, full WebDAV suite on that branch:
  - harness format v2
    ([run 42928501333](https://github.com/super-productivity/super-productivity/actions/runs/42928501333)):
    no failed job, including the regular E2E suite;
  - harness format v3
    ([run 42928497047](https://github.com/super-productivity/super-productivity/actions/runs/42928497047)):
    two tests failed, both in `webdav-late-snapshot.spec.ts`. That spec is
    about a v2 file but takes its format from the harness, so under v3 its
    seed client has Surgical sync explicitly on and writes v3 (`Expected: 2,
Received: 3`). By code reading this does not involve the default path
    this branch changes. A control run of the same spec on master code with
    harness format v3 was dispatched to confirm; its result is not recorded
    here yet.

**Recommendation 1 (the two production queries)** needs access to the hosted
database and is not done.

## Review

A fresh-context subagent challenged the draft's claims against the code on
2026-11-10. It read the code and ran nothing. What changed:

- **Checkpoint safety (largest change).** The draft said a device with
  pending work "defers the incoming `REPAIR`, uploads, and its ops are kept",
  and rated checkpoint risk under a floor as none. The reviewer showed the
  deferred `REPAIR` is dropped for good and that a device behind its base
  then misses the prefix. I re-read the three anchors and agree. The note now
  carries it as a suspected defect, makes a reproduction step 2, raises the
  checkpoint cost to large, and ties the checkpoint floor to a future release.
- **Count-only gate.** It cannot split refusals by version below v19.2.0 and,
  before auth, not by account. It moved from "build now" to "build when the
  numbers are near", which also removed a contradiction with "doing nothing".
- **Why v19.2.0.** The draft's reason (older builds show a raw error) argued
  for a lower floor. The real reason is that a missing version must count as
  old, and only v19.2.0 sends one on every route.
- **Hook placement.** `onRequest`, not a `preHandler` before `authenticate`:
  a `preHandler` runs after the body is parsed.
- **Missed routes and server facts.** Added the three client endpoints
  outside `/api/sync`, the unread WebSocket version, the quota check on
  checkpoint uploads, the fence exception after pruning, and the sweep's
  fallback to an older boundary.
- **Quota path.** "Frees nothing" corrected to "frees only the initial
  import". The needed branch already exists and is unreachable.
- **Payoff inventory.** "Only P1 is SuperSync-only" was wrong: added P12 to
  P15. The v2-only estimate fell from about 1,270 to about 1,100 lines.
- **Released clients on a 503.** The open question about in-request retries
  is closed for v19.1.0 by code reading.
- **File side.** Two line numbers corrected. Added that a saved "off" may
  travel through synced config, and that the pre-v18.14.0 behaviour comes
  from a comment only.

Confirmed without change: the release table in every cell, the head check for
a causal `REPAIR`, stale repairs being rebased, the route list, follow-ups 1
to 3, and the anchors and floor versions of P2 to P7.
