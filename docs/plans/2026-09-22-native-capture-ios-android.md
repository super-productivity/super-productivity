# Native capture for iOS and Android

**Status:** Plan (revised after review) · **Date:** 2026-09-22
**Companion:** `2026-09-22-desktop-mcp-plan.md` (desktop MCP). Hosted capture,
relays and a headless server stay deferred.

## Decision

Add one native "Add task to Super Productivity" action per platform. It writes
a capture request to a small on-device inbox without starting the web UI; the
normal app turns it into one Inbox task once it is hydrated. The native action
never reads tasks, never touches the op-log, and never sees sync keys.

**Scope correction from review:** the first draft proposed a new inbox,
delivery journal, dataset-generation quarantine and SQLite storage. Most of
the hard part already exists in the repo or in draft PR #10033, and the extra
machinery defends against failures nobody has observed. This revision builds
on what exists and cuts the rest (see "Review changes" at the end).

## 1. Experience

"Add buy milk to Super Productivity" → the action saves the capture and
answers "Saved. Super Productivity will add it next time you open the app."
On the next ready launch or resume, the app creates one Inbox task and syncs it
through whatever sync the user already has.

- Inputs: `title` (required) and optional `notes`. Nothing else.
- Works offline, with the app closed, with no account or network.
- "Saved on this phone", "created in SP" and "synced elsewhere" are different
  outcomes; the action only ever claims the first.
- Failure (storage unavailable, input invalid, capture disabled) is reported as
  failure. There is no "queue full" state in v1 (see §4).

## 2. What already exists — build on it

Verified at `2f4c660` and PR #10033 head `ef0f4cb`.

| Existing piece                                                                                                                                                                                                                                               | State                                        | Use                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------ |
| **iOS `ShareInbox`** (#10033): one immutable JSON file per capture in App Group `group.com.super-productivity.app`                                                                                                                                           | Draft PR, not merged, not on-device-verified | The iOS inbox. The App Intent writes to the same directory.  |
| **`IosShareService`** (#10033): waits for data init + initial sync + sync window, dispatches `addTask` with **capture id = task id**, flushes op-log writes, checks `hasUnrecoveredPersistFailure()`, keeps an id-only receipt until the native ack succeeds | Draft PR, 12 unit tests                      | The importer. Generalize it; do not write a second one.      |
| iOS deployment target 16.0                                                                                                                                                                                                                                   | master                                       | App Intents are available from iOS 16 — no minimum-OS bump.  |
| Android `WidgetTaskQueue` + `StartupOverlayManager` (native quick-add overlay), `getWidgetTaskQueue()` bridge                                                                                                                                                | master                                       | Prior art only — it has the flaws listed below; do not copy. |
| Android `ShareIntentQueue` → `onShareWithAttachment$`                                                                                                                                                                                                        | master                                       | Interactive share flow; leave unchanged.                     |
| `TaskService.add(..., isIgnoreShortSyntax)` / `TaskSharedActions.addTask({ isIgnoreShortSyntax: true })`                                                                                                                                                     | master                                       | Literal title, no short-syntax parsing.                      |
| Android min/target SDK 24/36                                                                                                                                                                                                                                 | master                                       | AppFunctions needs API 36 at runtime; must stay optional.    |

Observed flaws in the existing Android quick-add queue (`WidgetTaskQueue`,
drained in `startup-overlay.service.ts` and `android.effects.ts`):

1. `addTask()` persists with `apply()` (async) — a process kill right after
   the overlay closes can lose the capture.
2. `getAndClearQueue()` deletes before JS has created and persisted the task.
3. Tasks are created with a new random id, so a retry cannot be deduplicated.
4. It is drained by two separate code paths.

These are real, present-day instances of exactly the loss/duplication shapes
this plan guards against, which is what justifies the acknowledged handoff
below. Moving the overlay onto the new Android inbox is a cheap follow-up (§5).

## 3. Capture contract (shared by iOS, Android and desktop MCP)

```ts
interface NativeCapture {
  v: 1;
  id: string; // UUID minted once by the native adapter; becomes the task id
  title: string;
  notes?: string;
  source: 'share' | 'intent' | 'overlay' | 'mcp';
  createdAt: number; // epoch ms, set by native code
}
```

- **Idempotency key = task id.** Import is "if no task with `id` exists and no
  receipt for `id`, dispatch `addTask` with that id". Replays of the same
  capture are no-ops; two separate invocations create two tasks. Never
  deduplicate by title.
- **Destination:** Inbox project, bottom of list, `isAddToBacklog: false`,
  `isIgnoreShortSyntax: true` — identical to #10033. Independent of current
  screen, tags or Today. **Exception: `source: 'overlay'`** (Android startup
  quick-add) keeps the in-app add bar's behaviour — active work context and
  short syntax — because the user typed it into SP's own UI.
- **Defaults:** `DEFAULT_TASK` as #10033 does. No due dates, no parsing, no
  caller-supplied clocks or project ids.
- **Limits:** title 1–300 chars after trim (matches #10033's clamp), notes
  ≤ 100 000 chars (matches #10033's check). Native side **rejects** oversize
  intent input with a spoken/visible error; share input keeps #10033's
  existing clamp behaviour. JS re-validates and moves invalid entries aside
  (below) rather than throwing.
- Golden JSON fixtures (including emoji/CJK/RTL) live in one place and are
  asserted by the TS spec plus one Swift and one Kotlin test.
- Keep the TS type and importer inside `src/app`. No new package.

## 4. Importer and delivery guarantees

Generalize `IosShareService` into a platform-neutral `NativeCaptureImporter`
over a tiny port:

```ts
interface NativeCaptureSource {
  getPending(): Promise<NativeCapture[]>; // non-destructive read
  acknowledge(id: string): Promise<void>; // delete one entry
  reject?(id: string, code: string): Promise<void>; // move aside, keep file
}
```

Guarantees, all already implemented or directly derivable from #10033:

- The native action reports success only after its file write returns
  (`.atomic` write / `rename` into place).
- Reads never delete. An entry is removed only after the task is in the store,
  `flushPendingWrites()` has completed, and no persist failure is flagged.
- Crash after native save → capture stays pending. Crash after task persist but
  before ack → next run finds the task (or the receipt) and just acks.
- One importer, serialized with `concatMap`, waits for
  `isAllDataLoadedInitially$`, `afterInitialSyncDoneStrict$` and the end of
  the sync window before dispatching. This is also what keeps imports out of
  the way of sync imports/restores; no separate lock is needed.
- A malformed or invalid entry is moved aside via `reject()` and counted, so
  it cannot block later entries. _Status (2026-09-23):_ #10033 as merged
  already skips invalid entries and imports later ones; they stay on disk, so
  iOS shows the import-error snackbar on every resume until removed.
  `reject()` (move aside natively) is deferred to M3, when the Swift side is
  touched anyway.
- Receipts are id-only and live only until the native ack succeeds (#10033's
  pruning is correct: once the native file is gone it cannot be redelivered,
  so long-lived receipts buy nothing).

**Known, accepted gap** (already documented in #10033): if the app dies after
the user deletes a freshly imported task but before its receipt is written,
that capture can reappear once. Closing it needs task-op + receipt in one
IndexedDB transaction; not worth it until observed.

**Restores, resets, profile switches:** a pending capture is imported into
whatever dataset is active when the app next becomes ready. The user captured
it for "their SP", so that is the correct default. No dataset-generation
tagging or quarantine UI in v1 — revisit only if a real report shows captures
landing somewhere harmful.

**Capacity:** no queue cap in v1. Captures are tiny; storage-full surfaces as
a write error, which the action reports as failure. Add a cap only if abuse or
runaway automation is observed.

**Backups:** App Group files and Android `noBackupFilesDir` are excluded from
device backup so a restored phone does not replay old captures.

## 5. Platform work

### iOS (after #10033 lands)

1. **Spike on a signed device.** One `AddTaskIntent: AppIntent` with `title`
   and optional `notes` parameters, `openAppWhenRun = false`, writing via
   `ShareInbox.save`. Decide between running in the main app process and an
   App Intents extension by testing both: the main-app route must not create
   the Capacitor WebView in a background launch; the extension route reuses
   the App Group that #10033 already provisions but adds a third signed bundle
   and profile (see `2026-09-18-ios-share-extension-testflight-setup.md` for
   the cost of each extra bundle). Prefer the main-app route if it works.
2. **Production intent:** validation, localized dialog strings, honest
   success/failure responses.
3. **`AppShortcutsProvider`** with 1–2 localized phrases, so it appears in
   Siri, Spotlight, Shortcuts and the Action button without user setup. No
   in-app setup page in v1 — a docs/wiki section is enough.
4. **Lock-screen policy (open decision, see §8).** Default in this plan:
   `authenticationPolicy = .requiresAuthentication`; move to
   `.requiresLocalDeviceAuthentication` if the device spike shows the stricter
   policy is available on the targets we care about.
5. Extend `SharedCapture` with `v`, `source`, `createdAt` and optional notes;
   decode old #10033 files (missing fields) with defaults so pending shares
   survive the upgrade.

Physical-device checks: app killed, cold launch after capture, capture while
app foregrounded, reboot before import, locked device, airplane mode, app
upgrade with pending captures.

### Android

1. **New inbox, no new dependency:** `NativeCaptureInbox.kt` — one JSON file
   per capture in `noBackupFilesDir/capture-inbox/`, written to a temp file,
   `fsync`, then renamed. Same port as iOS (`getPending`, `acknowledge`,
   `reject`) exposed through `JavaScriptInterface`. No SQLite, no Room, no
   SharedPreferences array rewrite.
2. **Migrate the quick-add overlay** (`StartupOverlayManager`) to write into
   this inbox and delete `WidgetTaskQueue` plus its two drain paths. This is
   the first user-visible Android payoff, fixes the flaws in §2, needs no new
   OS API and is testable on every supported Android version.
3. **AppFunctions: time-boxed spike only.** Build one `addTask` function behind
   a build flag on an API 36 emulator. Record SDK version, caller and device.
   Ship it only when a consumer assistant (not the test agent) can actually
   invoke it on a production device; until then it is not advertised and not
   in the release build. The inbox and overlay work do not depend on it.
4. Leave the interactive share flow (`ShareIntentQueue`) as it is — it asks the
   user to confirm in-app, which is a different contract.

Checks: process death between save and import, activity recreation, repeated
intents, reboot, low storage, app upgrade with a pending legacy
`WidgetTaskQueue` entry (drain it once into the new inbox), API 24 device.

### Chat assistants (ChatGPT, Claude, Gemini)

Unverified. Do not claim support. On iOS, any assistant that can run a
Shortcut gets it for free through the App Shortcut; document only routes that
were tested end to end.

## 6. Privacy

Write-only capability: no reads of tasks, projects or tags. Log capture ids and
error codes only (`Log.err('native capture rejected', { id, code })`), never
titles or notes — matches the existing #10033 care. No new network surface;
the assistant provider's own processing of dictated text is outside SP's
control and should be stated in the docs. Payload files are deleted on ack.

## 7. Milestones

| #   | Deliverable                                                                                   | Exit                                                                                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0  | Land #10033 (device test + TestFlight per the 2026-09-18 plan)                                | Share → Inbox verified on a physical iPhone.                                                                                                                                                                   |
| M1  | `NativeCaptureImporter` generalized from `IosShareService`; poison-entry fix; shared fixtures | Existing 12 importer tests + new poison/limits tests pass; desktop MCP can call the same entry point. _Status: importer shared by Android + iOS (done); poison `reject()` and shared fixtures deferred to M3._ |
| M2  | Android `NativeCaptureInbox` + overlay migration                                              | Kill-after-save and replay tests pass on device; `WidgetTaskQueue` removed.                                                                                                                                    |
| M3  | iOS App Intent + App Shortcut (device spike first)                                            | Siri/Shortcuts capture with app killed creates exactly one task on next launch.                                                                                                                                |
| M4  | Docs/wiki + release notes; AppFunctions spike result recorded                                 | Only verified routes documented.                                                                                                                                                                               |

M1 and M2 need no Apple hardware and can start in parallel with M0. M3 depends
on M0 (App Group provisioning). AppFunctions never blocks a milestone.

## 8. Open decisions for the maintainer

1. **Locked-device capture.** Allowing capture while locked (after first
   unlock) is the main Siri use case (driving, walking) and leaks nothing, since
   the action is write-only; the cost is that anyone holding the phone can add
   tasks. This plan keeps "require authentication" as the conservative default.
2. **Enable toggle.** The draft proposed an in-app capture toggle plus pending
   count UI. This revision drops it: App Shortcuts can be disabled per app in
   iOS Settings, and the pending count is normally 0 within seconds of opening
   the app. Add a toggle only if users ask for it.

## Review changes (vs. first draft)

| First draft                                                | Revision                                                  | Why                                                                                             |
| ---------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| New native inbox; #10033 not mentioned (only #8950 widget) | Build on #10033's inbox and importer                      | It already implements the acknowledged handoff with stable task ids and has tests.              |
| SQLite on both platforms                                   | One immutable file per capture                            | Already chosen in #10033, atomic by construction, no dependency, no concurrent-rewrite problem. |
| 4-state machine + application delivery journal             | Task id = capture id + short-lived receipt                | Existence of the task _is_ the durable receipt; a journal duplicates op-log persistence.        |
| Receipts kept for the lifetime of a dataset generation     | Receipts pruned once native entry is gone                 | Nothing can be redelivered after native deletion.                                               |
| Dataset-generation binding + quarantine review UI          | Import into the active dataset                            | No observed failure; adds persisted state and UI (`hardening-earns-its-place.md`).              |
| Queue limit, capture toggle, pending-count UI, setup page  | Dropped from v1                                           | Feature creep for a write-only action; OS already offers per-app Shortcut control.              |
| "Inbox backlog"                                            | Inbox, bottom, not backlog                                | Matches #10033 and user expectation of seeing the task.                                         |
| "Never truncate"                                           | Reject oversize intent input; share keeps clamp           | Consistent with existing share behaviour; intent callers can be told to retry.                  |
| AppFunctions as a peer milestone                           | Flagged spike; Android value comes from overlay migration | Gemini integration is private preview; the overlay path has real, observed loss today.          |
| Assumed `prepareMainTaskAdd()` might exist                 | Not needed                                                | #10033 dispatches `TaskSharedActions.addTask` directly.                                         |
| Poison entries "must not block"                            | Explicit fix item in M1                                   | #10033 currently throws and blocks the batch on one invalid entry.                              |
