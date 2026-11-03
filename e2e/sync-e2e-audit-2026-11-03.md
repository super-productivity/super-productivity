# Sync E2E audit: 2026-11-03

This audit covered every sync E2E spec (181 files, about 61k lines) and the shared helpers. A first pass looked for tests that pass even when the behavior they claim to protect is broken. A second pass of fresh-context reviewers then tried to refute each HIGH and MEDIUM finding against the code and the contract docs. This file holds the verified result, grouped by work theme. Each theme ships as its own PR.

Verdicts:

- CONFIRMED / PLAUSIBLE / REFUTED: whether the finding held up.
- FIX: strengthen the assertion. REBUILD: the setup never reaches the claimed path. DELETE/RENAME: the test adds nothing or claims the wrong thing. ISSUE: the strengthened check may expose an app bug.
- "Mutation" is the temporary change that must make the strengthened test fail. That run is the proof the test can fail at all.

## Cross-cutting causes (shared helpers, coordinator PR)

1. `syncAndWait`/`setupSuperSync` silently answer the sync-import conflict, enter-password, enable-encryption and decrypt-error dialogs, plus the DATA_REPAIR confirm.
2. `setupSuperSync` ends on `[data-sync-confirmation]`, which ignores the spinner and the error state.
3. The TODAY, project and tag worklogs include live tasks, so "in the worklog" does not mean archived. Use `getArchiveYoungTaskIds` plus an absence check in the store. TODAY's Done section is expanded by default, so absence from the work view does help.
4. devError alerts are auto-dismissed (`runtime-errors.ts`), so internal invariant violations and `console.error` checks for them never fail a test.
5. WebDAV `waitForSyncComplete` returns 'conflict' instead of throwing, and most call sites ignore the result.

Step 1 adds `recordSyncAudit()` (`e2e/utils/sync-audit.ts`) to measure which tests depend on each of these. Making the helpers strict follows from that data.

## Verify 1 (archive / worklog / absence). 15 confirmed, 2 refuted, 3 plausible.

Facts

- The worklog merges live tasks and archived tasks for TODAY, projects and tags; undone tasks are listed too.
- Mitigation: TODAY's Done section is expanded by default. So "absent from the work view" plus "present in the worklog" does prove a task was archived.
- `getArchiveYoungTaskIds` (supersync-helpers.ts:278) works. It returns [] when the store is missing, so absence checks on it need an anchor.
- `getTaskIdByTitle`/`getActiveTasks` are private to archive-conflict.spec:565-591. Move them to e2e/utils.

HIGH CONFIRMED FIX

- supersync.spec 5.1:690-750 — capture ids on A; after A syncs, assert archive_young contains both ids and they are absent from A's store.
- supersync-worklog:83-98 and 180-216 — same fix, both directions, before and after the reload.
  - Mutation for both: drop TASK_SHARED_MOVE_TO_ARCHIVE ops from remote batches in operation-applier.service.ts.
- archive-subtasks (all 3) [NEW] — `checkForOrphanSubtaskError` reads console.error, but in dev builds devError goes to the alert, which is dismissed. Fix: assert via the store; also depends on the helper change.
  - Mutation: remove `taskAdapter.removeMany(allSubTaskIds)` in deleteTaskHelper (task.reducer.util.ts:~342).
- cascade-delete:171-183 — anchor B with `getTaskTitleFromState`, then poll that both titles are null in both stores.
  - Mutation: make handleDeleteProject (project-shared.reducer.ts:195) skip task removal for remote actions.
- import-clean-server-state:136-161, 275-289 — fetch `/api/test/user/:id/ops` and assert no op has a serverSeq below the BACKUP_IMPORT's.
  - Mutation: comment out `tx.operation.deleteMany` (sync.service.ts:322).
- import-clean-server-state:376-390 — anchor with waitForTask and a worklog fixture title, assert oldArchived's id is not in archive_young, and add the server-ops check. Depends on the helper change.

HIGH CONFIRMED REBUILD / RENAME / DELETE

- backup-recovery REBUILD
  - A fresh A never creates a SYNC_IMPORT, so the precondition is never set up. A 409 would be silently dropped anyway.
  - Rebuild: put a full-state op on the server first (provider switch to a fresh account), make importBackup throw on timeout, assert BACKUP_IMPORT isSynced, and use backup content that differs from the server.
  - Mutation: `_opTypeToSnapshotReason` BackupImport→'initial' (operation-log-upload.service.ts:1054).
- keep-local-archive-preservation RENAME (or delete)
  - The fix is FileBased-only and already unit-tested (file-based-sync-adapter.service.spec.ts:2389-2423). Reword it as SuperSync dialog coverage; real coverage of the fix would need a WebDAV test.
  - MED fixes: :286-291 needs an anchor plus a store check; :401-402 needs an anchor plus archive ids; [NEW] :175-181 looks for an archived task in the work view.
- daily-summary test 2 DELETE — the error string no longer exists. Covered by archive.service.spec.ts:215-260.

MED

- archive-conflict Test A PLAUSIBLE — add `expectTaskNotVisible(B, task1Name)`, archive ids, and store absence.
  - Mutation: exclude the conflicted id from the re-emitted archive (bulk-archive-intent.util.ts).
- archive-conflict Test B PLAUSIBLE — the archive wins, so the original title is expected on both clients. Read archive_young titles (extend the helper to {id,title}).
  - Mutation: overlay the live title in the remote `_handleMoveToArchive`.
- archive-conflict Test C REFUTED — the Done-section absence check catches it; only the comment is wrong.
- archive-data-sync REFUTED — B has no live tasks. LOW: no SYNC_IMPORT asserted.

## Verify 4 (wrong-path / error). 16 confirmed, 1 refuted.

- constraint-error-recovery (all 3 tests) [HIGH CONFIRMED DELETE]
  - Production never calls appendBatch for remote ops; it uses appendBatchSkipDuplicates (conflict-resolution.service.ts:1121, operation-log-sync.service.ts:2300).
  - Covered by the operation-log-store.service.spec.ts appendBatchSkipDuplicates and #6213 tests.
  - NEW, LOW, plausible: the #6213 unit tests (:1356, :1383) may still pass with `_appliedOpIdsCache = null` removed (store.service.ts:480). To settle, delete it and run test:file.
- server-migration-abort:43-89 [HIGH CONFIRMED DELETE]
  - B is fresh, so `hasSyncedOps` is false and the function returns early.
  - Covered by server-migration.service.spec.ts:352 and :1001 (server_not_empty abort).
- server-migration:20-36 [MED CONFIRMED FIX]
  - Fix: call syncAndWait outside the try/catch and retry only the waitForTask. The real path is reached.
  - Mutation: make the first download throw once.
- server-backup-revert:288-372 [MED CONFIRMED ISSUE + RENAME]
  - The partial revert leaves task2 permanently off the server with no signal: planDownloadFullStateUpload gives no upload when the server isn't empty.
  - The doc (backup-and-recovery.md:108/140) claims a SYNC_IMPORT_EXISTS error appears; it doesn't.
  - Action: open an issue (operator-only path), fix the stale comments and doc, and don't pin the divergence.
- server-backup-revert:~595-614 [MED CONFIRMED FIX]
  - Fix: after restoreUserData, assert getLatestServerSeq equals the post-dump seq and that task2 is absent on the server/probe before the reset; drop the SYNC_IMPORT_EXISTS wording.
  - Mutation: make restoreUserData a no-op.
- superseded-clock-regression:91-215, 280-307 [HIGH/MED CONFIRMED DELETE]
  - No hydration op exists: TODAY is virtual and there's no repair at load (#7631).
  - Covered by operation-log-hydrator.service.spec.ts ~:961 and rejected-ops-handler.service.spec.ts:454/497.
- max-retry-rejection:119-141 [HIGH CONFIRMED FIX]
  - Fix: arm a wait for the snack "Sync conflict resolution failed. Please reload." early; read SUP_OPS and assert a taskName2 op has rejectedAt and nothing is pending.
  - Mutation: set MAX_CONCURRENT_RESOLUTION_ATTEMPTS=100 (operation-log.const.ts:276). The cap's unit test is rejected-ops-handler.spec:1286, so DELETE is also acceptable.
- network-failure:632-721
  - "413 never reaches the quota path" is REFUTED: the real server returns 413 with "Storage quota exceeded", and the code matches it.
  - [HIGH CONFIRMED FIX] Any alert counts, and "not rejected" is never asserted. Fix: mock the real body with errorCode STORAGE_QUOTA_EXCEEDED, assert the alert contains "Sync storage is full", then unroute, syncAndWait, and have B join and waitForTask.
  - Mutation: markRejected the chunk ids in the upload.service.ts:524-528 catch.
- error-scenarios G.5:352-373 [MED FIX]
  - Fix: before unroute, assert no sync error and no `snack-custom .wrapper.error`.
  - Mutation: setSyncStatus('ERROR') in the DUPLICATE_OPERATION branch (~rejected-ops-handler:166).
- error-scenarios B.4:207-216, 269-270 [MED FIX]
  - Fix: expect the alert to contain "Your data is too large to upload".
- token-expiry:77-100, 179-202 [MED CONFIRMED REBUILD]
  - One 401 does not clear credentials: sync-wrapper.service.ts:962-979 tolerates 2 transient 401s and shows AUTH_TOKEN_REJECTED.
  - Fix: assert the error icon and the snack "Sync token was rejected by the server", unroute, then recover with a plain syncAndWait (no re-setup).
  - Mutation: change `< 3` to `< 1` at :975.
- backup-import-id-mismatch:146-156, 122-141 [MED CONFIRMED DELETE]
  - Covered by operation-log-upload.service.spec.ts:2074, the server opId requirement, and forced-download-pruned-import.
- use-remote-app-features-10399:426-429 [MED CONFIRMED FIX]
  - Fix: triggerSync, expect conflictDialog visible, resolveConflictDialog('remote'), then syncAndWait; assert REBUILD_COMMITTED_LOG appeared and that neither title is in getArchiveYoungTaskIds.
  - Mutation: drop the restore-then-re-archive step at :417-421.
- provider-switch-to-supersync:126-160 [MED CONFIRMED REBUILD]
  - The data is carried by the encryption clean-slate (`_promptSuperSyncEncryptionIfNeeded`), not by migration.
  - Fix: call seedSuperSyncCredentials with an encryptKey and reload before switching; assert the server holds exactly 1 SYNC_IMPORT.
  - Mutation: make checkAndHandleMigration return immediately.

## Verify 7 (misc). 2 confirmed, 3 refuted, 1 plausible.

- supersync-models:606-622 [MED CONFIRMED FIX]
  - The tag-delete check reads chip text. A dangling tagId on B triggers a devError (dismissed silently) and then a REPAIR, so the end state looks clean.
  - Fix: right after the delete, read A's tasks' `tagIds` and `tag.ids` from the store; at the end, assert `fullStateOps(readStoredOps)==[]` on both clients.
  - Mutation: make tag-shared.reducer.ts:368 skip stripping the deleted id from `task.tagIds`.
- plainspace-poll-sync-window-11034:391-397 [MED CONFIRMED REBUILD]
  - The gate is released after the window closes (1500 ms + POST_SYNC_COOLDOWN_MS 2000).
  - Fix: release the gate from the routeSuperSyncOps GET handler; assert `isInSyncWindow()` when the held answer is fulfilled; pin the interim state (B shows T1, no PATCH).
- project-delete-conflict:191-204, 310-314 [MED PLAUSIBLE FIX]
  - Fix: assert the Inbox menuitem is visible first; check `project.entities` has no entry with that name on both clients and after a reload.
  - Mutation: make `isProjectDeleteWinsOperation` (conflict-resolution.util.ts:73) return false.
- tracking-presence:84-85 REFUTED. B's pill proves tracking happened; LOW: add `toBeVisible` before Stop.
- android-timer-sync-recovery:212-258 REFUTED. Same bulkApplyOperations path.
- pomodoro-5974:160-176 REFUTED. The following `.focus-running-label` check catches it.
- time-preserving helper dueDay 2099: the outcome is documented (lww-field-level-resolution.md, #10393 items 1 and 6; decision 6). Fix: add a comment citing it.
- LOW, confirmed: repeat-subtask-9728 (add a store count), multi-tab:375-380, reenable-and-account-switch (no cursor/SYNC_IMPORT read), wrong-password JSDoc. repair-lifecycle:812-816 REFUTED.

## Verify 6 (WebDAV). 11 confirmed, 4 plausible, 3 new.

Expected conflicts: of the `waitForSyncComplete` call sites in these 12 specs, only lost-update-10916:121 and late-snapshot:58 should return 'conflict'. Every other call should be pinned to 'success'.

- webdav-sync-delete-cascade 1.1:69-181 [HIGH FIX]
  - Capture data-task-id. Before the delete, assert B's archive_young contains the task. After, read `archive_young.current.data.task.entities[id]` on A and B (extend the helper): it must exist with `tagIds`=[]. Use a web-first check that the tag is gone from B's sidebar.
  - Mutation: `_handleDeleteTags` returns early when `isRemote`.
- webdav-sync-delete-cascade 1.2:199-314 [HIGH FIX]
  - Precondition: the task is in B's archive_young. After the delete, it is absent on A and B.
  - Mutation: `_handleDeleteProject` returns early when remote.
- webdav-sync-delete-cascade 1.3:332-459 [HIGH FIX + plausible ISSUE]
  - Assert Task1 is absent from both lists and present in both archives, Task2 is untagged on both, and the tag is gone from B's sidebar.
  - A's archived Task1 probably keeps the deleted tag id (writeTasksToArchiveForRemoteSync doesn't scrub it). If confirmed, report it as an issue candidate; don't pin it.
  - Mutation: on B, delete Task1 instead of archiving it.
- webdav-sync-full:282-318 [HIGH FIX]
  - Re-sync A and expect 'success'. A shows 'Conflict Task B' and not 'Conflict Task A', with count 2.
  - Mutation: `_tryCreateFieldPatch`/`_createLocalWinUpdateOp` return undefined.
- webdav-sync-full:208-232 [MED FIX]
  - One B sync expecting 'success', then count 1 with no reload, and the remaining title asserted.
- webdav-sync-tags:193-211 [HIGH FIX]
  - Before: `getTagOnTask(taskB, tag)` is visible. After A's removal: count 0 on A. After B syncs: count 0 on B.
  - Mutation: comment out removeTagFromTask (l.194).
- webdav-sync-archive:459-460, 333, 609 [MED FIX]
  - Assert the ids are in archive_young on A and B and absent from `tasks.entities`. For 609, check the parent and both subtasks.
  - Mutation: delete the task instead of archiving it.
- webdav-sync-today-tag:475-482 [MED FIX]
  - Task2 exists with dueDay=tomorrow on both clients (store read).
  - Mutation: A deletes Task2.
- webdav-first-sync-conflict:715-734 [MED PLAUSIBLE FIX] and 349-365 [NEW]
  - Drop the sleeps and the isVisible check, pin 'success' at 365, 724 and 734.
  - In v2, assert `recentOps` equals [] after USE_LOCAL.
- webdav-legacy-migration-sync:177-205, 511-533 [MED FIX; issue if it fails]
  - Replace the conflict branch with `expect(syncResultA).toBe('success')`. A is clean, and #9170 says it must hydrate silently.
  - Mutation: force `hasLocalChanges=true`.
- webdav-lost-update-10916:31-32 [MED FIX]
  - Parametrize Keep local and Keep remote. With Keep remote, the phone shows the desktop task and not its own; a second sync returns 'success' (no re-ask); the desktop is unchanged.
- webdav-encryption-disable:94-107 [MED FIX]
  - After l.76, a raw GET has no plaintext. Right after the disable, `readPrefixedFile` parses and contains the task.
  - Mutation: make uploadSnapshot in disableEncryption a no-op.
- webdav-format-rollout:444-448 [PLAUSIBLE] and [NEW] 444-470
  - Pin the final `legacyReads`. Count PUTs to sync-data, sync-ops and sync-state and assert 0.
- webdav-late-snapshot:151 and 245 [PLAUSIBLE]
  - Pin the read counts, assert the dialog is hidden after 168, and count PUTs (expect 0).
- webdav-multi-archive-recovery:170-180 [NEW MED]
  - Task count 0 in the work view plus archive_young containing the ids.

## Verify 5 (import / encryption). 10 confirmed (+2 new), 2 refuted, 3 plausible.

Dialog contract below: NEVER means the dialog must not appear; ALWAYS means it must.

- import-clean-slate D.4:771-795 [HIGH REBUILD, depends on helper]
  - The path is never reached, and any dialog gets auto-clicked.
  - Rebuild: client C syncs before the import, then creates a task offline. Hold C's upload with routeSuperSyncOps until B's SYNC_IMPORT is on the server, then release it. A syncs.
  - Assert NEVER `dialog-sync-import-conflict` on A, C's task absent on A (store read), and no error.
  - Mutation: drop `&& processResult.isLocalUnsyncedImport` at operation-log-sync.service.ts:1255.
- import-clean-slate:616-626 [MED FIX, depends on helper]
  - Click sync directly. Assert ALWAYS `dialog-sync-import-conflict` with the MSG_INCOMING text ("1 local changes"), then call chooseSyncImportUseRemote.
  - Mutation: the gate returns no dialogData when hasMeaningfulPending is true.
- import-conflict-dialog tests 1-4 [HIGH RENAME + REBUILD]
  - These actually cover first-sync on a never-synced device with a local import. Rename them.
  - Add a test: B syncs first, A adds a task and syncs, B imports without syncing, then B syncs.
  - Assert ALWAYS the MSG_LOCAL_FILTERS text ("cannot be automatically merged") with no first-sync radios. Answer local, and A converges.
  - Mutation: make the condition at operation-log-sync.service.ts:1252 `false && …`.
- import-encryption-preserve:91-114, 235-251 [HIGH FIX]
  - Assert NEVER "Encryption Settings Will Change" (count 0).
  - Mutation: `willChange = currentEnabled !== importedEnabled` (import-encryption-handler.service.ts:105).
- import-encryption-preserve:127-133, 257-263 [HIGH FIX, depends on helper]
  - Drop the re-setup and call `syncAndWait({useLocal:true})`.
  - Assert NEVER enter-password, enable-encryption or decrypt-error on A. sync-import may appear (answer local).
  - Mutation: `hasLocalSettings=false` (global-config.reducer.ts:189), or remove isEnabled from LOCAL_ONLY_SYNC_DEVICE_KEYS.
- import-encryption-preserve:154-163 [MED FIX]
  - Move the anchor before the absence checks.
- import-encryption-preserve [NEW MED]
  - The fixture has no `sync.superSync`, so the "matching encryption" case is never modelled.
  - Fold test 1 into import-encryption-change, or give the fixture `superSync{isEncryptionEnabled:true, encryptKey:'other'}` and assert the current key is kept.
- import-encryption-change:61-64 [LOW]
  - Assert NEVER enable-encryption during the re-setup.
- encryption-password-preservation [REFUTED]
  - A lost key hits the upload guard and syncAndWait fails anyway. Optionally assert NEVER enter-password or decrypt-error on A.
  - The header of test 1 is stale, and the test nearly duplicates test 2 (LOW).
- encryption-password-change:386-391 [MED FIX, depends on helper]
  - Await changeEncryptionPassword before B syncs.
  - Then ALWAYS decrypt-error on B, and after the new password ALWAYS sync-import. Answer remote and remove the `.catch`.
  - Mutation: the gate skips the dialog for PASSWORD_CHANGED.
- encryption-password-change:465-488 [NEW HIGH FIX, depends on helper]
  - Assert NEVER decrypt-error or enter-password on A at :487. A adds a task after the change, and B must see it.
  - Mutation: after the upload, write the old encryptKey back via setProviderConfig.
- encryption.spec:101-161 [MED FIX]
  - Record the POST /api/sync/ops bodies. Every op must have `isPayloadEncrypted` true, and none of the pre-existing op ids may be re-uploaded.
  - The server holds one full-state op and no Pre\* regular ops.
  - Mutation: remove the GHSA guard (operation-log-upload.service.ts:242).
- account-deletion:157-165 [MED FIX]
  - Join a second client on configB and waitForTask for task1 and task2, or check that the server has a SERVER_MIGRATION SYNC_IMPORT.
  - Mutation: `if(!hasSyncedOps)` → `if(true)` (server-migration.service.ts:161).
- account-reset:108-121 [MED PLAUSIBLE FIX, depends on helper]
  - Assert the server is empty right after the reset (latestSeq==0).
  - For C: ALWAYS enable-encryption, NEVER enter-password.
  - Mutation: DELETE /api/sync/data returns 200 without deleting.
- advanced:161-164 [MED FIX]
  - waitForTask on A first, then a store read: the task exists and its tagIds exclude the tag.
- agent-capture:405-408, 426-429 and 565-566 [MED PLAUSIBLE FIX]
  - Await B's claim response and the import log, assert the claim was empty, and only then count.

## Verify 2 (winner / reorder). 18 confirmed, 2 plausible.

GLOBAL_CONFIG `misc` resolves by whole-section LWW: the LWW Update replaces the section. No field merge happens.

- lww-singleton:176-192 [HIGH FIX]
  - Assert anim=ON and celeb=OFF on both clients. Optionally check for a synced `[GLOBAL_CONFIG] LWW Update`.
  - Mutation: flip `localMaxTimestamp > remoteMaxTimestamp` (packages/sync-core/src/conflict-resolution.ts:521).
- global-config-edge-cases:98-101, 136 [HIGH FIX]
  - C sets celebration to false. All three clients must end at anim=ON, celeb=OFF.
  - Mutation: the same flip.
- global-config-edge-cases:188-210 [HIGH FIX]
  - Use 3 toggles. B equals `!initial`, and B equals `initial` before the sync.
  - Mutation: `isPersistent:false` in the updateGlobalConfigSection meta.
- reorder-conflict-wedge:659-663 [MED FIX]
  - `expect(converged.order).toEqual(reordered)`.
  - Mutation (setup): re-dispatch the original order on reorderClient.
- reorder-conflict-wedge:1244 [MED FIX]
  - Expect the dragged order, or `reversed`.
- reorder-single-entity-rule:723-725 [MED FIX]
  - Assert the reorder survives in all 36 cases (they commute). The header at l.25 is wrong.
  - Mutation (setup): re-dispatch `before.order`.
- reorder-single-entity-rule:1050-1068 [MED FIX]
  - Snapshot the reissued order and pin it.
- reorder-competing-and-delete:221-222 [NEW MED FIX]
  - First-to-server wins and the arrival order is fixed, so assert `final.order==otherSide.order`.
- reorder-competing-and-delete:420-444 [MED FIX] (released)
  - order: the released order wins.
  - Today order: order is current's, and second is the released Today order.
  - delete + pending: kept(current).
  - delete + !pending: kept(released).
- reorder-beside-conflict:149, 202-207 [MED REBUILD/DELETE variant]
  - The !bNewer variant never makes B upload an LWW row. Add the "B uploaded a habit LWW row" assertion (pattern at :391-397), then drop or rebuild that variant.
- round-time-conflict:381-395 [MED FIX]
  - The parent title is `${parentName}-A` on both clients and after reload, with no `-B`.
  - Mutation: flip isNewer (conflict-field-patch.util.ts).
- remote-winner-server-order:192-206 [MED PLAUSIBLE] and [NEW HIGH PLAUSIBLE REBUILD]
  - After #10422, B probably uploads a title-only patch, so #10423's `orderIncomingPrefix` is never exercised.
  - To settle: run CI with orderIncomingPrefix disabled (fold-sync-time-spent.util.ts).
  - If the time loss turns out to be a replace-snapshot winner, it's a documented open gap (decision 7), so it becomes an issue, not a test pin.
- rejected-ops-transient-download-8331:262-272 [MED FIX]
  - Both clients end at `-ModifiedByB`.
- forced-download-pruned-import:385-391 [LOW FIX]
  - `-A` wins on both clients.
- legacy-migration-sync:148-168 Keep local [HIGH FIX]
  - Copy the genesis test pattern (:556-577): `waitForInitialSync:false`, expect the conflictDialog visible, then `syncAndWait({conflictDialog:'local'})`.
  - Assert B's SYNC_IMPORT is on the server. A syncs and ends with B1-B3 and no A1/A2 (store read).
  - Mutation: make the import gate report no conflict.
- legacy-migration-sync:424-443 ID collision [HIGH FIX, possible ISSUE]
  - A must show Version B plus "Version B Extra Task". If that goes red, open an issue.
- legacy-migration-sync:594-596 [MED FIX]
  - Check A1's absence through store titles.
- late-join:62-101 and 170-173 [MED FIX]
  - Assert BLocal1/2 are absent on B and A (after an anchor), and that A1/A2 are absent on both.
