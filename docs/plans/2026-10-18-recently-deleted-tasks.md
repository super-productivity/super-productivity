# Recently deleted tasks (trash bin) — design note

Status: shipped in #10912.
Demand: #2778 (21 👍, 15 comments); #10350 also asks for projects/tags/filters
(out of scope); related general-undo requests #7244 and #8821.

## Product decision (can be flipped)

- **No settings toggle.** A trash helps only if it was already on when the
  accident happened, so an opt-in trash protects nobody. The project rule is
  "prefer not building a feature over adding a toggle to dodge a decision".
- **Always on, found where people look.** No nav item, badge or count.
  - **Search** lists deleted tasks, marked "Deleted", without "include
    completed", because searching for its title is how people look for a task
    that went missing. Selecting one (or its Restore button) restores it and
    jumps to it. A match on a subtask title finds the deleted parent.
  - **The delete message** says where to look once Undo is gone: "Search still
    finds it for 30 days", or "History → Recently deleted" when the Search app
    feature is off. Plainspace tasks, which are not trashed, keep the old
    message.
  - **History** has a quiet "Recently deleted" link at the bottom, where
    archived tasks are already restored. It opens a dialog to browse, restore
    and empty the trash.
  - A permanent menu item (with an App-features toggle) was considered and
    left out: daily noise for a rare need, plus a persisted config field. It
    stays the fallback if Search does not make the trash findable enough.
- **Fixed retention of 30 days, no setting**, plus "Empty". Deletes that are
  already older than that are not recorded. Expired entries are purged when
  the trash is opened and on the first write of a session, so they go even
  if the trash is never opened.
- **Tasks only, with their subtasks.** Plainspace tasks (deleting them deletes
  them for the whole Space) keep the current always-confirm behavior and
  never go to the trash. Blank tasks (the ones that also get no undo snack)
  are skipped too.
- The delete-undo snackbar (`undo-task-delete.meta-reducer.ts`,
  `TASK_DELETE_UNDO_WINDOW_MS`) is unchanged.

**Alternative: a hidden toggle**, i.e. trash off by default behind a setting.
That has the same code, plus a setting, and protects only the users who found
the setting before they lost something. Flipping to it later means gating
`RecentlyDeletedEffects` and the History link on a config flag. Nothing on
the wire changes either way.

## Prior art

Checked 2026-10 from vendor docs where noted. The rest is unverified
secondhand information.

| App             | Trash?                                        | Retention            | Entry point        | Source                                                                                                      |
| --------------- | --------------------------------------------- | -------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------- |
| Apple Reminders | "Recently Deleted" list (iOS 18 / macOS 15)   | 30 days, then purged | Sidebar smart list | [Apple support](https://support.apple.com/en-gb/guide/reminders/remna83c9566/mac) (vendor docs)             |
| Todoist         | No; a deleted task is gone, paid backups only | n/a                  | n/a                | third-party integration docs, not Todoist's own                                                             |
| Things 3        | Trash list, manually emptied                  | until emptied        | Sidebar            | from memory, not checked                                                                                    |
| Amazing Marvin  | Trash area                                    | not checked          | not checked        | [Marvin help](https://help.amazingmarvin.com/en/articles/3869041-how-does-the-trash-area-work) (title only) |

**Take:** Apple's name ("Recently deleted") and its fixed 30-day retention.
Restoring is one action. **Deliberately don't:** add a sidebar entry (Apple,
Things), because it is noise for the 99% of days nothing was lost. Don't keep
entries until manually emptied (Things), because storage would grow without
limit.

## How delete works today

- `TaskService.remove` → `TaskSharedActions.deleteTask({ task })`. One TASK
  entity is declared, with `OpType.Delete`. The reducer cascades to
  `subTaskIds`. The payload carries the full `TaskWithSubTasks`. The keyboard
  path passes a raw subtask `Task` whose `subTasks` is undefined (#9280).
- `TaskService.removeMultipleTasks` → `deleteTasks({ taskIds, tasks })`. It is
  a bulk Delete and its `tasks` snapshots include the cascaded subtasks.
- `undoTaskDeleteMetaReducer` captures the pre-delete context, and the snack's
  Undo dispatches `restoreDeletedTask`. That action **overwrites**
  project/tag/parent id lists with the snapshot taken at delete time. This is
  fine within 5 s but would clobber 30 days of later reordering, so it is not
  usable for a late restore.
- Issue side effects: `deleteIssueOnTaskDelete$` deletes the remote issue
  (when the provider supports it) after `REMOTE_ISSUE_DELETE_DEFER_MS`, and is
  cancelled only by `restoreDeletedTask`. Calendar auto-import dismissals ride
  on the `deleteTasks` payload. None of this can be undone (#10155).
- The archive (`archive_young` / `archive_old`, outside NgRx) is restored with
  `TaskSharedActions.restoreTask({ task, subTasks })`. Its reducer re-adds the
  family to its project and tags, drops stale project/tag/repeat refs and
  sections, and is idempotent on replay.

## Options considered

### A. Trash inside the archive (`moveToArchive` + optional `deletedAt?`)

Delete would become `moveToArchive` with `deletedAt` on the task snapshots.

- The wire changes for every delete: a `Delete` op becomes a multi-entity bulk
  `Update` that gets "archive wins" precedence. Delete-vs-edit conflicts move
  to a different resolution path.
- Every side effect keyed on `deleteTask`/`deleteTasks` (remote issue delete,
  calendar dismissal, time-block delete, reminders, plugin `taskDelete` hook,
  the undo snack) would have to be re-keyed or would silently stop.
- Released clients would write the trashed tasks into their archive as plain
  archived tasks. Their search, History, worklog totals, daily summary,
  metrics, calendar and plugin/REST `getArchivedTasks` would show deleted tasks
  and count their time. New clients would need a `deletedAt` filter in every
  one of the dozen-plus archive readers, and every future reader would have to
  remember it.
- Purging needs a new action (nothing existing removes archive entries by id).
  Released clients ignore it, so their archives keep the "deleted" tasks
  forever.
- **Rejected.** The degradation is not just "archived": it is visible data
  and time totals on released clients, plus a changed conflict path.

### B. Soft delete in live state (`task.deletedAt?`, task stays in NgRx)

Released clients would render deleted tasks as normal, live tasks.
**Rejected.**

### C. New synced trash model (`MODEL_CONFIGS` slice or entity)

This adds a new persisted model, new actions, full-state snapshot surface and
conflict rules. Released clients drop or ignore it. It has the largest
surface. **Rejected.**

### D. Device-local trash fed by the delete ops every client already sees — **chosen**

- Each client keeps the trash in its own small IndexedDB database
  (`SUP_RECENTLY_DELETED`, one object store keyed by task id). It is never
  uploaded, never in snapshots or backups, and not part of `SUP_OPS`, so
  `SUP_OPS` `DB_VERSION` is untouched (no downgrade barrier, #9187).
- **Local deletes:** a `LOCAL_ACTIONS` effect records `deleteTask` and
  `deleteTasks` from their existing payloads (snapshots of the task and its
  subtasks).
- **Remote deletes:** `OperationApplierService` hands the ops whose reducers
  committed (not local hydration) to the trash, through the
  `REMOTE_APPLY_LISTENER` token provided in `main.ts`, so the op-log layer
  does not import the feature. An op whose archive side effect fails is still
  recorded, because its reducer already deleted the task. The delete time is
  `op.timestamp`, clamped to this device's clock so a sender clock that runs
  ahead cannot keep an entry past retention.
  A delete made on the phone is therefore restorable on the desktop. A bulk
  `deleteTasks` reaches other devices with ids only, because the upload strips
  its `tasks` snapshots (`_sanitizeRegularOpPayloadForUpload` in
  `operation-log-upload.service.ts`). So the applier first reads those tasks
  and their subtasks from this device's own state, before the ops apply
  (`beforeRemoteApply`, read-only). A remote `deleteTask` also gets the
  subtasks only this device has, because the reducer deletes them by
  `parentId` too. Nothing extra goes on the wire. The hook
  is fire-and-forget and swallows errors, so the trash can never fail or slow
  a sync.
- **Restore** dispatches the existing, released `restoreTask` with the stored
  snapshot. A deleted subtask is restored as a top-level task in its project,
  because its old parent's subtask order cannot be restored safely. A task
  whose project was archived or deleted meanwhile comes back in the Inbox, so
  it is visible. Restoring removes the entry and offers Undo, which deletes the
  task again (back into the trash). Any other `restoreTask`
  (History, REST API, issue service, or remote) or `restoreDeletedTask` also
  removes it.
- **Retention / Empty** are local deletes from that database. They emit no op
  and need no replay determinism: no reducer reads the trash. "Empty" also
  stores its time on this device (localStorage
  `SUP_RECENTLY_DELETED_EMPTIED_AT`); deletes made before it are not recorded
  again, so a replay cannot bring emptied tasks back.

### E. The op log itself as the trash

Restore by reading the delete op back from `SUP_OPS`. Compaction drops ops
after 7 days (`COMPACTION_RETENTION_MS`), and a synced bulk delete arrives
without its task snapshots, so most deletes would no longer be restorable.
**Rejected.**

### Open product decision: local deletes only

Recording only this device's own deletes would drop the remote path
(`REMOTE_APPLY_LISTENER`, the pre-apply snapshot) and the cross-device
privacy copy. It would also lose the case of a delete made on the phone that
is noticed on the desktop. It is kept for now, pending a decision.

## Sync / compatibility analysis

- **No new action, op type, payload field, persisted model field or schema
  bump, and no change to what any existing op carries.** Every `remove()`
  caller already passes the full family. The keyboard path's raw `Task`
  (#9280) is a subtask, which has no subtasks of its own.
- **Released clients** see nothing new. A restore made on a new client
  reaches them as `restoreTask`, which they already apply from the History
  view today. Their archive handler asks the archive to delete ids it does not
  hold, which is a no-op.
- **One intent = one op:** delete is still one op, and restore is one
  `restoreTask` op. No multi-entity crossing is added: `restoreTask` declares
  one TASK entity, as it does for archive restores. No denormalized list is
  added.
- **Replay / effects:** the effect uses `LOCAL_ACTIONS`. Remote recording
  happens only on the non-hydration apply path, and recording is idempotent
  (a put keyed by id).

### Concurrent cases

| Case                                  | Outcome                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delete on A while B edits the task    | Unchanged from today (existing delete-vs-update resolution). If the delete wins, both devices have the trash entry (A's own snapshot, so B's concurrent edit is not in it). If B's edit wins and recreates the task, the entry is hidden because the dialog filters ids that are active again. |
| Restore on A while B empties / purges | Emptying on B is local and emits no op. A's `restoreTask` still applies on B (its payload carries the full task).                                                                                                                                                                              |
| Restore on A and B concurrently       | Two `restoreTask` ops. The second is a no-op (the reducer is idempotent when the root is already active, since v19.0.0; a v18 receiver behaves as for a concurrent double archive restore today).                                                                                              |
| Purge timing across devices           | Each device expires entries 30 days after the delete's own timestamp. Devices may disagree briefly about what is in their trash, which is local, unsynced UI state. No synced state depends on it.                                                                                             |

### Known limitations (accepted for v1)

- The trash is per device. A device set up after the delete (from a
  snapshot), or a new browser profile, starts with an empty trash. "Empty" on
  one device does not empty the others. A synced "empty" would need a new
  action. Released clients would ignore it harmlessly, but it is not needed
  for the reported problem.
- **Privacy:** a deleted task's pre-delete state stays in the op log and on
  the SuperSync server until compaction (7 days locally), as today. The trash
  adds a searchable copy on each device for 30 days, including deletes made
  on other devices. "Empty" is per device.
- The pre-apply snapshot is taken once per downloaded batch. A task created
  and bulk-deleted (`deleteTasks`) inside the same batch is not in it, so it
  is not trashed, and one edited and then bulk-deleted in one batch is trashed
  as it was before the batch. A single `deleteTask` carries its own snapshot.
- A full-state rebuild (USE_REMOTE) that replays the whole history onto an
  empty state (SuperSync) re-adds every single-task delete of the last 30
  days made after the last "Empty" here; bulk deletes from that replay are not
  trashed. A file-based provider hydrates a snapshot first, so only deletes
  after it can come back.
- The "Empty" cutoff compares against the sender's delete time. A delete made
  before "Empty" that arrives later (an offline device) is not trashed, and
  neither is a newer delete from a device whose clock runs behind by more than
  the time since "Empty". If this device's clock was ahead when emptying, its
  own deletes are not trashed until the clock passes that time again.
- A delete that reaches this device more than 30 days after it was made is
  not trashed.
- Restoring marks the task undone (`restoreTask` semantics, same as archive
  restore) and drops its section.
- Issue-linked tasks: the remote side effect is **not** deferred beyond the
  existing undo window (#10155 stays as is). A restored issue-linked task
  keeps its issue link. If the remote issue was deleted, the next issue
  refresh treats it like any other remotely deleted issue.
- The trash is fed only where the reducers actually run. A retry with
  `skipReducerDispatch` (a failed remote op re-run at startup, unsynced local
  ops re-applied after a snapshot load) is skipped, because state already
  reflects those ops: a delete that only applies on such a retry is not
  trashed. Paths that do re-run reducers on already-seen ops (restoring
  preserved local ops after USE_REMOTE, a USE_REMOTE raw rebuild) record the
  deletes of the last 30 days again, except those made before the last
  "Empty". The puts are keyed by id, retention still applies, and no synced
  state reads the trash.
- The trash survives a backup import or SYNC_IMPORT, so it can offer a task
  from the replaced dataset. Restoring one goes through `restoreTask`, which
  drops stale project, tag and repeat references, so state stays consistent.
- Automatic `deleteTasks` (stale duplicate repeat instances, plugin/issue
  removals) are trashed like user deletes, because the effect cannot tell
  them apart from the payload.
- Tasks deleted together with their project (`deleteProject`) are not
  trashed. That is out of scope with #10350.
