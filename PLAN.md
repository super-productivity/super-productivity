# Plan: Android Background Reminder Sync via WorkManager

## Goal
Cancel stale Android reminders (AlarmManager alarms + active notifications) by periodically syncing with the sync server in the background, even when the app is not open.

## Problem
When a task is completed/deleted on desktop, the Android app doesn't learn about it until opened. Meanwhile, `AlarmManager` fires stale reminders for tasks that are already done.

## Solution Overview
Use Android's `WorkManager` to run a periodic background job (every 15 minutes) that:
1. Fetches new operations from the sync server
2. Parses them for reminder-relevant changes (task done, deleted, reminder removed, archived)
3. Cancels the corresponding `AlarmManager` alarms and dismisses active notifications

**Currently implemented for SuperSync only** (lightweight operation-based API). The architecture uses a provider interface so Dropbox/WebDAV support can be added later without restructuring (see Extensibility section).

---

## Step 1: Frontend – Mirror sync credentials to native SharedPreferences

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
- Use `distinctUntilChanged` on `(baseUrl, accessToken)` tuple to avoid redundant calls

**Pattern reference:** Follow `android-focus-mode.effects.ts` which uses the same selector-based + hydration guard pattern.

## Step 2: Android – Credential store (SharedPreferences)

**New file:** `android/app/src/main/java/com/superproductivity/superproductivity/service/BackgroundSyncCredentialStore.kt`

**What:**
- Simple SharedPreferences wrapper (similar pattern to `ReminderAlarmStore`)
- Stores: `baseUrl`, `accessToken`, `providerId`
- Methods: `save(context, providerId, baseUrl, accessToken)`, `get(context): Credentials?`, `clear(context)`
- SharedPreferences name: `SuperProductivitySync`
- `lastServerSeq` stored per-account: key = `LAST_SERVER_SEQ_{hash(baseUrl)}` to prevent account-switching bugs
- When credentials change with a different `baseUrl`, the old `lastServerSeq` is effectively abandoned (new key)
- Uses `@Synchronized` and `.commit()` (not `.apply()`) for thread safety, matching `ReminderAlarmStore` pattern

## Step 3: Android – Background sync provider interface + SuperSync implementation

**New file:** `android/app/src/main/java/com/superproductivity/superproductivity/service/BackgroundSyncProvider.kt`

```kotlin
interface BackgroundSyncProvider {
    /** Fetch task IDs that should have their reminders cancelled since lastSeq */
    suspend fun fetchReminderChanges(
        baseUrl: String,
        accessToken: String,
        lastSeq: Long,
        limit: Int = 100
    ): ReminderChangeResult?  // null = error (retry later)
}

data class ReminderChangeResult(
    val taskIdsToCancel: Set<String>,
    val latestSeq: Long,
    val hasMore: Boolean
)
```

**New file:** `android/app/src/main/java/com/superproductivity/superproductivity/service/SuperSyncBackgroundProvider.kt`

**What:**
- Implements `BackgroundSyncProvider`
- Uses OkHttp (already a dependency at 4.12.0) to call `GET /api/sync/ops?sinceSeq={seq}&limit=100`
- Sets `Authorization: Bearer {accessToken}` header
- OkHttp timeouts: 15s connect, 30s read
- Parses JSON response: `{ ops: [...], hasMore: boolean, latestSeq: number }`
- OkHttp handles gzip decompression transparently
- Returns `null` on auth error (401/403) or network error (no retry needed, will run again in 15 min)

**Operation parsing** (embedded in the provider or a helper):
- Parses the compact operation JSON format (shortened keys: `o`, `e`, `d`, `p`, `a`, `ds`)
- Only cares about operations where `e` = `"TASK"`
- Detects these reminder-relevant changes:
  - **Task done:** `o` = `"UPD"` and `payload.task.changes.isDone == true`
  - **Task deleted:** `o` = `"DEL"`
  - **Reminder cleared:** `o` = `"UPD"` and payload contains `remindAt: null` or `deadlineRemindAt: null`
  - **Reminder dismissed:** action type code `a` = `"HRX"` (TASK_SHARED_DISMISS_REMINDER)
  - **Task archived:** action type code `a` = `"HX"` (TASK_SHARED_MOVE_TO_ARCHIVE)
- Extracts task ID from `d` field (entityId) for single ops, `ds` field for batch ops
- Also handles BATCH operations with `entityChanges` array in payload (for meta-reducer multi-entity changes)
- Skips encrypted payloads (`isPayloadEncrypted: true` on the operation object) — can't parse without key

## Step 4: Android – Notification ID hash function (Kotlin port)

**Add to:** `SuperSyncBackgroundProvider.kt` or a small utility file

**What:**
- Port the TypeScript `generateNotificationId()` hash function from `android-notification-id.util.ts` to Kotlin
- Must produce **identical output** for the same input string (simple djb2-variant hash → positive int < 2147483647)
- This allows cancelling alarms directly by task ID without looking up the alarm store
- No changes needed to `ReminderAlarmStore` — `cancelReminder(context, notificationId)` already handles alarm cancellation + notification dismissal + store cleanup

## Step 5: Android – Background sync worker

**New file:** `android/app/src/main/java/com/superproductivity/superproductivity/service/SyncReminderWorker.kt`

**What:**
- Extends `CoroutineWorker` (from `androidx.work:work-runtime-ktx`)
- `doWork()` implementation:
  1. Read credentials from `BackgroundSyncCredentialStore`
  2. If no credentials → return `Result.success()` (sync not configured)
  3. If encrypted payloads are enabled → return `Result.success()` (can't parse)
  4. Read `lastServerSeq` from credential store (per-account key)
  5. Instantiate the appropriate `BackgroundSyncProvider` based on `providerId`
  6. Call `provider.fetchReminderChanges(baseUrl, accessToken, lastServerSeq)`
  7. If null (error) → return `Result.retry()` (WorkManager handles exponential backoff)
  8. For each task ID in `taskIdsToCancel`:
     - Compute `notificationId = generateNotificationId(taskId)`
     - Call `ReminderNotificationHelper.cancelReminder(context, notificationId)`
     - Also cancel due-date variant: `generateNotificationId(taskId + "_dueday")`
  9. Update `lastServerSeq` in credential store
  10. If `hasMore` → loop back to step 6 (paginate)
  11. Return `Result.success()`

**Sequence number storage:**
- Per-account key: `LAST_SERVER_SEQ_{hash(baseUrl)}`
- Stored in `BackgroundSyncCredentialStore` SharedPreferences
- This is **separate from the frontend's localStorage value** — the worker tracks its own cursor to avoid interference. Both can safely process the same operations independently.

## Step 6: Android – Schedule the worker

**Files to modify:**
- `android/app/src/main/java/com/superproductivity/superproductivity/receiver/BootReceiver.kt` – Enqueue periodic work after re-registering alarms (wrapped in try-catch)
- `android/app/src/main/java/com/superproductivity/superproductivity/CapacitorMainActivity.kt` – Enqueue periodic work on app start (idempotent via `ExistingPeriodicWorkPolicy.KEEP`)
- `android/app/src/main/java/com/superproductivity/superproductivity/webview/JavaScriptInterface.kt` – When credentials are set, ensure worker is enqueued; when cleared, cancel worker

**WorkManager configuration:**
- `PeriodicWorkRequestBuilder<SyncReminderWorker>(15, TimeUnit.MINUTES)`
- Constraints: `NetworkType.CONNECTED` (only run when network available)
- `ExistingPeriodicWorkPolicy.KEEP` (don't restart if already scheduled)
- Unique work name: `"super_sync_reminder_check"`
- BackoffPolicy: exponential, 30 seconds initial

**Extract scheduling to a helper function** to avoid duplication across BootReceiver, CapacitorMainActivity, and JavaScriptInterface:
```kotlin
object SyncReminderScheduler {
    fun ensureScheduled(context: Context) { ... }
    fun cancel(context: Context) { ... }
}
```

## Step 7: Android – build.gradle dependency

**File to modify:** `android/app/build.gradle`

**What:**
- Add `implementation 'androidx.work:work-runtime-ktx:2.10.0'`

## Step 8: Android – ProGuard rules

**File to modify:** `android/app/proguard-rules.pro` (currently empty)

**What:**
- Add keep rules for WorkManager worker classes so release builds don't strip them:
```proguard
-keepnames class * extends androidx.work.CoroutineWorker
```
- OkHttp ships its own consumer ProGuard rules; verify after a release build

## Step 9: Frontend – Trigger credential sync on SuperSync config changes

Covered by Step 1. The `AndroidSyncBridgeEffects` in `src/app/features/android/store/android-sync-bridge.effects.ts` handles this entirely.

---

## Edge Cases & Known Limitations

### Handled
- **Account switching:** `lastServerSeq` is keyed per `baseUrl` hash. Switching accounts uses a fresh cursor.
- **Force-kill:** WorkManager uses JobScheduler on Android 6+ which persists across force-stop. Worker resumes on next scheduled interval.
- **App syncing while worker runs:** No conflict — worker and frontend track separate `lastServerSeq` cursors. Both can safely process the same operations.
- **Rapid credential changes:** `distinctUntilChanged` on `(baseUrl, accessToken)` in the effect prevents redundant native calls.

### Known Limitations (Intentional)
- **Encrypted payloads skipped:** Worker can't decrypt without the key. Users with encryption get background cancellation only when the app is open (normal sync).
- **15-minute minimum interval:** Android WorkManager enforces this. Reminders may still fire if the task was completed <15 min before the reminder time.
- **Token expiration:** If the access token expires while the app is closed, the worker will get 401s and retry. Credentials refresh when the user next opens the app and the effect re-mirrors them.
- **`gapDetected` from server:** Worker ignores this — it only cancels stale reminders, it doesn't apply state. Full state recovery happens when the app opens.
- **Notification race:** If an alarm fires at the same moment the worker cancels it, the user might briefly see then lose the notification. This is acceptable — the task was already done.

## What this does NOT do
- Does NOT apply full state changes — only cancels stale reminders
- Does NOT replace the normal sync flow (full sync still happens when app opens)
- Does NOT add new reminders from remote changes (that happens via `MobileNotificationEffects` when the app is open)

---

## Extensibility: Dropbox / WebDAV (Future)

**Can this work for Dropbox?** Yes, but it's much heavier:
- Dropbox stores the full app state + recent operations in a single `sync-data.json` file
- A background worker would need to download the entire file (~100KB+), then parse only the `recentOps` array
- This is feasible but less efficient than SuperSync's lightweight paginated ops API (~2KB per request)

**Architecture is ready for this:**
- `BackgroundSyncProvider` interface abstracts the fetch logic
- `SyncReminderWorker` delegates to the provider — adding Dropbox means implementing one new class
- `BackgroundSyncCredentialStore` already stores `providerId` to select the right provider
- No restructuring needed — just add `DropboxBackgroundProvider implements BackgroundSyncProvider`

**Not implementing now** because:
- SuperSync is the primary sync target for mobile
- Dropbox background polling is battery/data-heavy for minimal benefit
- Users with Dropbox still get reminder cancellation when the app opens

---

## File Summary

| File | Action |
|------|--------|
| `android/app/build.gradle` | Add work-runtime-ktx dependency |
| `android/.../service/BackgroundSyncCredentialStore.kt` | **New** – SharedPrefs for credentials + per-account lastServerSeq |
| `android/.../service/BackgroundSyncProvider.kt` | **New** – Interface for provider-agnostic background sync |
| `android/.../service/SuperSyncBackgroundProvider.kt` | **New** – SuperSync implementation: OkHttp client + op parser |
| `android/.../service/SyncReminderWorker.kt` | **New** – WorkManager CoroutineWorker |
| `android/.../service/SyncReminderScheduler.kt` | **New** – Helper to enqueue/cancel WorkManager job |
| `android/.../webview/JavaScriptInterface.kt` | Add credential bridge methods |
| `android/.../receiver/BootReceiver.kt` | Enqueue worker on boot |
| `android/.../CapacitorMainActivity.kt` | Enqueue worker on app start |
| `android/app/proguard-rules.pro` | Add WorkManager keep rules |
| `src/app/features/android/android-interface.ts` | Add credential bridge method types |
| `src/app/features/android/store/android-sync-bridge.effects.ts` | **New** – Effect to mirror credentials to native |
