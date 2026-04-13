# Android Background Sync Improvements

> **Status: Planned**

## Context

The current implementation (branch `claude/fix-android-reminder-sync-TdwQY`) uses Android WorkManager to poll the SuperSync server every ~15 minutes. When it detects that a task was completed, deleted, or had its reminder cleared on another device, it cancels the stale Android notification. This works but has limitations.

This document outlines two improvements:

1. **Fast app startup via cached sync state** — use the background worker's progress to speed up the initial sync when the app opens
2. **Push-based notification cancellation via FCM** — eliminate the 15-minute polling gap

---

## Phase 1: Fast App Startup via Cached Sync State

### Problem

When the user opens the app on Android, the sync layer starts from scratch — it doesn't know what the background worker has already seen. The worker has been tracking `lastServerSeq` in SharedPreferences, but that knowledge is wasted on app start.

### Approach

Expose the worker's cached state to the TypeScript layer so the app can skip already-processed operations or use the seq as a sync hint.

### Design

#### Option A: Seq Hint (Minimal)

1. Add `getLastSyncSeq(): number` to `AndroidInterface`
2. On app init, `SyncService` calls `androidInterface.getLastSyncSeq()` to get the worker's last-processed sequence number
3. The sync layer uses this as a starting point, only fetching operations newer than this seq
4. Benefit: reduces initial sync payload from potentially thousands of ops to at most ~15 minutes' worth

**Bridge addition:**

```typescript
// android-interface.ts
getLastSyncSeq?(): number;
```

```kotlin
// JavaScriptInterface.kt
@JavascriptInterface
fun getLastSyncSeq(): Long {
    return credentialStore.getLastServerSeq()
}
```

**Sync layer integration point:** wherever the initial `sinceSeq` is determined in `SyncService` or `OperationApplierService`, check for the Android hint first.

#### Option B: Cached Operations (More Ambitious)

1. The worker writes fetched operations to a local cache (SharedPreferences or a small SQLite table) instead of just tracking seq
2. On app start, the TypeScript layer reads cached ops via the bridge, applies them immediately, then syncs live for anything newer
3. Benefit: app state is updated almost instantly on open, even before a network call

**Trade-offs:**

- More storage and complexity on the native side
- Need to handle cache invalidation (e.g., if the user switches accounts)
- Operations could be large if the user was offline for days

**Recommendation:** Start with Option A. It's simple, low-risk, and already covers the common case (user opens app after a short break). Option B adds latency savings of one network round-trip, which matters less on modern connections.

### Implementation Steps (Option A)

1. Add `getLastSyncSeq()` to `AndroidInterface` and `JavaScriptInterface`
2. In the sync initialization path, check `IS_ANDROID_WEB_VIEW` and call `getLastSyncSeq()`
3. If the returned seq is greater than 0, use it as the starting point for `sinceSeq`
4. Fall back to the normal sync path if 0 or unavailable

### Edge Cases

- **Account switch**: `lastServerSeq` is keyed by `baseUrl.hashCode()`, so switching accounts resets to 0 automatically
- **Worker never ran**: Returns 0, sync proceeds normally — no regression
- **Stale seq**: If the seq is very old (worker was killed by OS), the app just fetches more ops than usual — still correct, just slower

---

## Phase 2: Push-Based Cancellation via FCM

### Problem

WorkManager's minimum periodic interval is 15 minutes. A user could complete a task on their desktop and still receive the reminder on their phone if it fires within that window.

### Approach

Use Firebase Cloud Messaging (FCM) to push a lightweight signal from the SuperSync server when reminder-relevant operations occur. The Android app receives the push and immediately cancels the stale notification.

### Prerequisites

- SuperSync server must support webhook/push triggers on new operations
- FCM project setup and device token registration
- Server-side logic to determine which operations are "reminder-relevant"

### Design

#### Server Side

1. Client registers its FCM token with the SuperSync server (new API endpoint)
2. When the server receives operations matching reminder-relevant action codes (HRX, HX, HD, HCR, HU with reminder changes), it sends a **data-only** FCM message to registered tokens for that account
3. The FCM payload is minimal: `{ "type": "reminder_change", "seq": 12345 }`

#### Client Side

1. A `FirebaseMessagingService` receives the data message
2. It reads the current `lastServerSeq` from SharedPreferences
3. If the incoming seq is newer, it fetches operations from `lastServerSeq` to the new seq using the existing `SuperSyncBackgroundProvider`
4. Parses and cancels notifications using the existing logic in `SyncReminderWorker`
5. Updates `lastServerSeq`

#### Hybrid Approach

Keep the 15-minute WorkManager poll as a fallback. FCM delivery is best-effort — messages can be delayed or dropped by the OS (Doze mode, battery optimization). The worker ensures eventual consistency even if FCM fails.

```
FCM push (immediate, best-effort)
        ↓
  Cancel notification
        ↓
WorkManager poll (15-min, guaranteed)
        ↓
  Cancel any remaining stale notifications
```

### Implementation Steps

1. Add Firebase SDK to the Android project
2. Create `SyncFirebaseMessagingService` extending `FirebaseMessagingService`
3. Add FCM token registration endpoint to SuperSync server
4. Add server-side push logic for reminder-relevant operations
5. Bridge FCM token to TypeScript layer so it can be sent during SuperSync auth
6. Keep existing WorkManager poll as fallback

### Considerations

- **Privacy**: FCM messages go through Google's servers. The payload should contain only the seq number, never task content.
- **Battery**: Data-only FCM messages are low-impact. Combined with the existing WorkManager poll, this adds negligible battery drain.
- **Server cost**: One push per reminder-relevant operation per registered device. For most users this is a handful per day.
- **Multiple devices**: Each device registers its own FCM token. The server pushes to all tokens for the account.

---

## Phase 3: Extend to Other Sync Providers

### Dropbox / WebDAV

The `BackgroundSyncProvider` interface already supports this. A Dropbox implementation would:

1. Download `sync-data.json` (~100KB+) via the Dropbox API
2. Diff against a locally cached copy to detect task completions/deletions
3. Return the set of taskIds to cancel

This is heavier than SuperSync's operation-based API but workable for the ~15-minute poll interval. WebDAV would be similar.

**Key difference**: Dropbox/WebDAV providers would need to cache the previous state locally to compute diffs, adding storage overhead. SuperSync's seq-based pagination avoids this entirely.

### Implementation would add:

- `DropboxBackgroundProvider` implementing `BackgroundSyncProvider`
- `WebDavBackgroundProvider` implementing `BackgroundSyncProvider`
- Credential bridging for Dropbox OAuth tokens and WebDAV credentials
- Provider selection logic in `SyncReminderWorker` based on stored provider ID

---

## Priority and Sequencing

| Phase                     | Effort                                | Impact                      | Recommendation             |
| ------------------------- | ------------------------------------- | --------------------------- | -------------------------- |
| Phase 1 (seq hint)        | Small (~1 day)                        | Medium — faster app start   | Do first                   |
| Phase 2 (FCM push)        | Large (~1 week, needs server changes) | High — instant cancellation | Do when server supports it |
| Phase 3 (other providers) | Medium per provider                   | Medium — broader coverage   | Do on demand               |
