# Local Recovery Points

Protects hosted-SuperSync users against the "all my data is gone" failure: a
full-state op (`SYNC_IMPORT` / `BACKUP_IMPORT` / `REPAIR`) from one device
propagates to every other device and replaces their local copy. Under mandatory
E2EE the server cannot replay history, so recovery has to happen on the device
that still held the data when the overwrite arrived.

## Design

Every device captures its complete state into a **local recovery ring** before
any full-state replacement, and a **backups list** in Settings → Sync & Backup
lets the user browse and restore every backup the device has.

### Recovery ring (IndexedDB `import_backup` store)

| Key          | Row                               | Purpose                                             |
| ------------ | --------------------------------- | --------------------------------------------------- |
| `current`    | `{ backupId, savedAt }`           | Undo pointer — unchanged identity semantics (#8107) |
| `ring`       | `{ entries: ImportBackupMeta[] }` | Small metadata list, newest first, for the UI       |
| `<backupId>` | `{ backupId, savedAt, state }`    | Full snapshot                                       |

- Ring size 3. Older snapshots are deleted in the same transaction that writes
  a new one. The newest snapshot is stored once (the pointer has no state).
- `ImportBackupMeta` carries `reason` (`REMOTE_IMPORT`, `FORCE_DOWNLOAD`,
  `LOCAL_IMPORT`) and `taskCount` so the list is informative without loading
  any snapshot.
- Undo keeps its identity check: `clearImportBackup` retires the pointer only;
  the snapshot remains browsable until it rotates out. Any newer capture
  (including a remote full-state op) supersedes a pending Undo offer, as a
  second force download always did. The raw-rebuild paths pass
  `skipRecoveryPoint` so the post-snapshot replay cannot move the pointer they
  are about to verify
  (`testing/integration/force-download-recovery-point.integration.spec.ts`).
- A `QuotaExceededError` on capture prunes the ring to its newest snapshot and
  retries once, so a full device degrades to a ring of two instead of never
  applying another full-state op. The newest snapshot is never evicted, and
  any other error aborts the apply without touching the ring.
- The pristine-device skip uses `hasRecoverableData` (tasks incl. archive,
  projects, tags, notes, recurring configs, counters, issue providers, metrics,
  plugin data). Settings alone never trigger a capture.
- Shortcut: plain FIFO of 3 with no notion of value. Upgrade path if evictions
  bite: pin the newest `REMOTE_IMPORT` entry.
- Legacy single-slot rows (state stored under `current`) keep working for Undo
  and are replaced by the pointer on the next capture.

### Capture sites

| Trigger                                 | Reason           | Existed before |
| --------------------------------------- | ---------------- | -------------- |
| Remote full-state op during op-log sync | `REMOTE_IMPORT`  | **no**         |
| "Use Server Data" / force download      | `FORCE_DOWNLOAD` | yes            |
| JSON import, local backup restore, undo | `LOCAL_IMPORT`   | yes            |

Capture failure aborts the replacement (same contract as force download).
A full-state op that is already in the local log is a duplicate delivery
(forced download from seq 0, #9975); it never replaces state, so it does not
capture either — otherwise three re-deliveries would fill the ring with copies
of the post-loss state.

### Backups list

One dialog listing every source the device has, each row with date, source and
task count, and a restore action:

- recovery ring (all platforms)
- Electron backup files (`<userData>/backups`, via a new list IPC)
- Android / iOS native backup slots

Restore goes through the existing per-platform load + `importCompleteBackup`,
which captures its own `LOCAL_IMPORT` ring entry first.

### Shrink banner

After a remote full-state apply, if the incoming state holds fewer than half the
tasks of the captured snapshot, show a dismissable banner linking to the backups
list. Fires only on that rare event; no setting.

## Steps

1. Ring in the op-log store → verify: store spec (rotation, pointer identity,
   legacy row), backup-service spec (reason/taskCount passed through), existing
   undo specs unchanged.
2. Capture before remote full-state apply → verify: unit test that a failed
   capture leaves state untouched; two-client E2E
   `e2e/tests/sync/supersync-local-recovery-point.spec.ts` (B replaces the
   server with 1 task, A gets the banner and restores its 3 tasks from the
   ring, B receives them back).
3. Backups list dialog + Electron list IPC → verify: electron test for the IPC
   path guard, component spec, manual check desktop + Android.
4. Shrink banner → verify: threshold unit test, assertion in the step-2 E2E.
5. Docs: restore wiki page and server `backup-and-recovery.md` point to the
   list first.

## Out of scope

- File-based providers (WebDAV, Dropbox, local file). Their snapshot hydration
  (`SyncHydrationService`) replaces state through a different path that has no
  capture hook; the feature targets hosted SuperSync, where the server cannot
  hand history back under E2EE.

- Server-side retention of the previous op generation on clean slate (follow-up,
  bounded to one previous generation to stay under 2× storage).
- Re-enabling the conflict journal (partial field loss, untested blast radius).
- Compressing ring entries — upgrade path if mobile peak memory becomes an issue.
