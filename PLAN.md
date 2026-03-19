# Plan: Android Background Sync via WorkManager (SuperSync only)

## Goal
Cancel stale Android reminders (AlarmManager alarms + active notifications) by periodically syncing with the SuperSync server in the background, even when the app is not open.

## Problem
When a task is completed/deleted on desktop, the Android app doesn't learn about it until opened. Meanwhile, `AlarmManager` fires stale reminders for tasks that are already done.

## Solution Overview
Use Android's `WorkManager` to run a periodic background job (every 15 minutes) that:
1. Fetches new operations from the SuperSync server
2. Parses them for reminder-relevant changes (task done, deleted, reminder removed, archived)
3. Cancels the corresponding `AlarmManager` alarms and dismisses active notifications

---

## Step 1: Frontend – Mirror SuperSync credentials to native SharedPreferences

**Files to modify:**
- `src/app/features/android/android-interface.ts` – Add `setSuperSyncCredentials?(baseUrl: string, accessToken: string): void` and `clearSuperSyncCredentials?(): void` method signatures (fire-and-forget, synchronous)
- `android/app/src/main/java/com/superproductivity/superproductivity/webview/JavaScriptInterface.kt` – Add `@JavascriptInterface` methods to persist credentials to SharedPreferences

**New file:**
- `src/app/features/android/store/android-sync-bridge.effects.ts` – NgRx effect that mirrors credentials to native

**What:**
- When SuperSync is configured (credentials saved), the frontend calls `androidInterface.setSuperSyncCredentials(baseUrl, accessToken)` to persist them to SharedPreferences
- When credentials are cleared/changed, call the corresponding update/clear method
- The worker reads these from SharedPreferences (no IndexedDB or WebView needed)

**Where to hook in:** Subscribe to `SyncProviderManager.currentProviderPrivateCfg$`, filter for `SyncProviderId.SuperSync`, and mirror to native. This is a selector-based effect, so it MUST:
- Use `skipWhileApplyingRemoteOps()` guard (per CLAUDE.md rule #8)
- Use `dispatch: false` (platform-only side effect)
- Guard with `IS_ANDROID_WEB_VIEW` (only relevant on Android)
- Use `distinctUntilChanged` on `baseUrl` + `accessToken` to avoid redundant calls

**Pattern reference:** Follow `android-focus-mode.effects.ts` which uses the same selector-based + hydration guard pattern.

## Step 2: Android – SuperSync credential store (SharedPreferences)

**New file:** `android/app/src/main/java/com/superproductivity/superproductivity/service/SuperSyncCredentialStore.kt`

**What:**
- Simple SharedPreferences wrapper (similar pattern to `ReminderAlarmStore`)
- Stores: `baseUrl`, `accessToken`
- Methods: `save(context, baseUrl, accessToken)`, `get(context): Credentials?`, `clear(context)`
- SharedPreferences name: `SuperProductivitySuperSync`

## Step 3: Android – Lightweight SuperSync HTTP client

**New file:** `android/app/src/main/java/com/superproductivity/superproductivity/service/SuperSyncClient.kt`

**What:**
- Uses OkHttp (already a dependency) to call `GET /api/sync/ops?sinceSeq={seq}&limit=100`
- Sets `Authorization: Bearer {accessToken}` header
- Parses JSON response: `{ ops: [...], hasMore, latestSeq }`
- Handles gzip decompression if needed (OkHttp handles this transparently via `Accept-Encoding: gzip`)
- Returns list of parsed operations and `latestSeq`
- Simple error handling: returns null/empty on auth failure or network error (no retry needed, will run again in 15 min)

## Step 4: Android – Operation parser for reminder-relevant changes

**New file:** `android/app/src/main/java/com/superproductivity/superproductivity/service/SyncOpParser.kt`

**What:**
- Parses the compact operation JSON format (shortened keys: `o`, `e`, `d`, `p`, etc.)
- Only cares about operations where `e` = "TASK"
- Detects these reminder-relevant changes:
  - **Task done:** `o` = "UPD" and payload contains `isDone: true`
  - **Task deleted:** `o` = "DEL"
  - **Reminder cleared:** `o` = "UPD" and payload contains `remindAt: null` or `deadlineRemindAt: null`
  - **Reminder dismissed:** action type code `a` = "HRX" (TASK_SHARED_DISMISS_REMINDER)
  - **Task archived:** action type code `a` = "HX" (TASK_SHARED_MOVE_TO_ARCHIVE)
- Returns a list of task IDs that should have their reminders cancelled
- Also handles BATCH operations with `entityChanges` array in payload (for meta-reducer multi-entity changes). Note: batch operations use `ds` field (not `d`) for multiple entity IDs
- Ignores encrypted payloads (`isPayloadEncrypted: true`) – these can't be parsed without the key, and supporting encryption in the background worker adds significant complexity. Users with encryption enabled won't benefit from background cancellation but their reminders still work normally when the app is open.

## Step 5: Android – Notification ID hash function (Kotlin port)

**Add to:** `SyncOpParser.kt` or a small utility

**What:**
- Port the TypeScript `generateNotificationId()` hash function to Kotlin
- Must produce identical output for the same input string
- This allows cancelling alarms by task ID without looking up the alarm store
- Also generate the `_dueday` variant ID for due-date notifications

## Step 6: Android – Background sync worker

**New file:** `android/app/src/main/java/com/superproductivity/superproductivity/service/SyncReminderWorker.kt`

**What:**
- Extends `CoroutineWorker` (from `androidx.work:work-runtime-ktx`)
- `doWork()` implementation:
  1. Read credentials from `SuperSyncCredentialStore`
  2. If no credentials, return `Result.success()` (SuperSync not configured)
  3. Read `lastServerSeq` from SharedPreferences
  4. Call `SuperSyncClient.downloadOps(baseUrl, accessToken, lastServerSeq)`
  5. If network error or auth error, return `Result.retry()` (WorkManager will back off)
  6. Parse operations with `SyncOpParser` to get task IDs needing cancellation
  7. For each task ID:
     - Compute `notificationId = generateNotificationId(taskId)`
     - Call `ReminderNotificationHelper.cancelReminder(context, notificationId)`
     - Also cancel due-date variant: `generateNotificationId(taskId + "_dueday")`
  8. Update `lastServerSeq` in SharedPreferences
  9. If `hasMore`, loop back to step 4 (paginate)
  10. Return `Result.success()`

**Sequence number storage:**
- SharedPreferences: `SuperProductivitySuperSync`, key: `LAST_SERVER_SEQ`
- This is separate from the frontend's localStorage value – the worker tracks its own sequence to avoid interference

## Step 7: Android – Schedule the worker

**Files to modify:**
- `android/app/src/main/java/com/superproductivity/superproductivity/receiver/BootReceiver.kt` – Enqueue periodic work after re-registering alarms (wrapped in try-catch; WorkManager may not be ready immediately at boot)
- `android/app/src/main/java/com/superproductivity/superproductivity/CapacitorMainActivity.kt` – Enqueue periodic work on app start (idempotent via `ExistingPeriodicWorkPolicy.KEEP`)
- `android/app/src/main/java/com/superproductivity/superproductivity/webview/JavaScriptInterface.kt` – When credentials are set, ensure worker is enqueued

**WorkManager configuration:**
- `PeriodicWorkRequestBuilder<SyncReminderWorker>(15, TimeUnit.MINUTES)`
- Constraints: `NetworkType.CONNECTED` (only run when network available)
- `ExistingPeriodicWorkPolicy.KEEP` (don't restart if already scheduled)
- Unique work name: `"super_sync_reminder_check"`
- BackoffPolicy: exponential, 30 seconds initial

## Step 8: Android – build.gradle dependency

**File to modify:** `android/app/build.gradle`

**What:**
- Add `implementation 'androidx.work:work-runtime-ktx:2.10.0'`

## Step 8b: Android – ProGuard rules (if needed)

**File to modify:** `android/app/proguard-rules.pro` (currently empty)

**What:**
- Add keep rules for WorkManager worker classes and coroutines so release builds don't strip them:
```proguard
-keepnames class * extends androidx.work.CoroutineWorker
```
- OkHttp rules are typically handled by its own consumer ProGuard file, but verify after a release build

## Step 9: Frontend – Trigger credential sync on SuperSync config changes

**File to modify or create:** A small piece in the sync setup flow

**What:**
- Watch for SuperSync credential changes (when user configures SuperSync)
- On change: call `androidInterface.setSuperSyncCredentials(baseUrl, accessToken)`
- On clear: call `androidInterface.clearSuperSyncCredentials()`
- This ensures the native worker always has current credentials

**Best hook point:** New `AndroidSyncBridgeEffects` in `src/app/features/android/store/android-sync-bridge.effects.ts` (see Step 1 for details).

---

## What this does NOT do
- Does NOT apply full state changes – only cancels stale reminders
- Does NOT support encrypted payloads (encrypted ops are skipped)
- Does NOT replace the normal sync flow (full sync still happens when app opens)
- Does NOT add new reminders from remote changes (that happens via the normal `MobileNotificationEffects` when the app is open)

## File Summary

| File | Action |
|------|--------|
| `android/app/build.gradle` | Add work-runtime-ktx dependency |
| `android/.../service/SuperSyncCredentialStore.kt` | **New** – SharedPrefs for credentials + lastServerSeq |
| `android/.../service/SuperSyncClient.kt` | **New** – OkHttp client for SuperSync API |
| `android/.../service/SyncOpParser.kt` | **New** – Parse ops, detect task done/delete/reminder clear |
| `android/.../service/SyncReminderWorker.kt` | **New** – WorkManager CoroutineWorker |
| `android/.../webview/JavaScriptInterface.kt` | Add credential bridge methods |
| `android/.../receiver/BootReceiver.kt` | Enqueue worker on boot |
| `android/.../CapacitorMainActivity.kt` | Enqueue worker on app start |
| `src/app/features/android/android-interface.ts` | Add credential bridge method types |
| `src/app/features/android/store/android-sync-bridge.effects.ts` | **New** – Effect to mirror credentials to native |
| `android/app/proguard-rules.pro` | Add WorkManager keep rules |
