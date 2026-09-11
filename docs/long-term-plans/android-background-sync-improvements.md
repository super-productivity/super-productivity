# Android Background Sync Improvements

> **Status: Planned**
>
> **Owner / tracking:** Unassigned; create an issue before implementation.
>
> **Last verified:** 2026-07-29

## Context

Android WorkManager polls the SuperSync server approximately every 15 minutes.
When it detects that a task was completed, deleted, rescheduled, or had its
reminder cleared on another device, it updates or cancels the stale Android
notification. This works but leaves a delay before native reminders reflect a
remote change.

This document records:

1. a safety constraint around the worker's private sequence cursor; and
2. possible ways to reduce the 15-minute notification-update delay.

---

## Rejected: using the reminder cursor for foreground sync

The background worker's `lastServerSeq` is **not** proof that operations were
stored in the operation log or applied to Angular state. It only records how far
the native reminder worker has scanned while updating notifications.

Therefore:

- Never expose the reminder cursor as `getLastSyncSeq()` or seed the foreground
  provider's `sinceSeq` from it.
- Foreground sync may advance its own cursor only after the downloaded operations
  are durably stored and successfully applied.
- Seeing or filtering an operation for native reminder purposes does not make it
  safe for foreground sync to skip that operation.

Violating this boundary can permanently omit remote task changes from the app.
Any future shared background-sync cache would need to store the actual operations
and transfer them through the same durable apply/checkpoint path as a normal
foreground download. That is a separate sync design, not a reminder optimization.

---

## Possible improvement: push-based cancellation

### Problem

WorkManager's minimum periodic interval is 15 minutes. A user could complete a task on their desktop and still receive the reminder on their phone if it fires within that window.

### Candidate approach

Use Firebase Cloud Messaging (FCM) to push a lightweight signal from the SuperSync server when reminder-relevant operations occur. The Android app receives the push and immediately cancels the stale notification.

This is **not approved implementation work**. It requires a tracked privacy,
operations, and product decision because it adds Google infrastructure, device
registration, server state, and a new delivery path.

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

## Possible improvement: other sync providers

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

| Candidate                 | Effort                                | Impact                      | Recommendation                                   |
| ------------------------- | ------------------------------------- | --------------------------- | ------------------------------------------------ |
| FCM push                  | Large (~1 week, needs server changes) | High — faster cancellation  | Only after privacy/product/operations approval   |
| Other sync providers      | Medium per provider                   | Medium — broader coverage   | Only in response to demonstrated provider demand |
| Reminder cursor as a hint | Small                                 | Unsafe — can skip user data | Rejected; preserve the safety fence above        |
