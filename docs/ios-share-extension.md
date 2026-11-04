# iOS share extension

The ShareExtension target receives URLs and text using Apple's system compose
sheet. It writes one immutable JSON file per capture into the App Group
`group.com.super-productivity.app`. The app imports these files into Inbox on
startup/resume using the existing task-create action. No shared database,
new synced model fields, or operation semantics are introduced.

The native queue is acknowledged only after operation writes finish without
an unrecovered persistence failure. The capture UUID is the task ID, so replay
after a crash before acknowledgement recognizes an existing task. Local
ID-only receipts cover acknowledgement retries after a user archives/deletes
an imported task. Pending captures are not part of the app's normal exports or
sync until imported. Uninstalling the app removes them.

## Native capture inbox and shared importer

iOS and Android share one importer, `NativeCaptureImporter`
(`src/app/features/tasks/native-capture/`). Each platform supplies a
`NativeCaptureSource`: a durable on-device inbox plus `getPending`, `isValid`,
`createTask` and `acknowledge`. iOS is `ShareInbox.swift` (App Group, exposed
by `ShareInboxPlugin.swift`, consumed by `IosShareService`); Android is
`CaptureInbox.kt` (`noBackupFilesDir/capture-inbox/`, consumed by
`AndroidCaptureImportService`).

Why it is built this way:

- One immutable JSON file per capture, written atomically (iOS `.atomic`;
  Android temp file, fsync, rename). Writers and acknowledgements never
  rewrite a shared file, so a suspended or killed process cannot corrupt the
  queue, and no database or extra dependency is needed. The one exception is
  an Android share waiting for its SuperSync upload: its upload state is
  rewritten the same atomic way under the inbox lock, so a reader sees the
  old or the new file
  ([plan](plans/2026-10-24-android-share-capture.md)).
- Reads never delete. An entry is acknowledged only after its task is in the
  store, `flushPendingWrites()` completed and no unrecovered persist failure
  is flagged. Never acknowledge a task that exists only in memory.
- The capture id is the task id. Replay after a crash finds the task and just
  acknowledges. Never deduplicate by title; two captures are two tasks.
- Id-only receipts in localStorage (`sp-ios-share-receipts`,
  `sp-android-capture-receipts`, `sp-android-share-receipts`; never rename,
  installs keep them) cover a
  failed acknowledgement after the user deleted the imported task. They are
  pruned once the native entry is gone, since nothing can be redelivered then.
- The importer waits for initial data load, the initial sync and the end of the
  sync window before dispatching, which keeps imports out of the way of sync
  imports and restores. A pending capture lands in whichever dataset is active
  when the app is next ready.
- An invalid entry is skipped but left on disk so it cannot block later
  entries (known limitation: it is reported on every resume until removed).
- iOS shares become Inbox tasks, bottom of list, not backlog, with short syntax
  ignored; title is clamped to 300 characters and text over 100 000 is
  invalid. Android shares (`ShareReceiverActivity`) become Inbox tasks the
  same way, through the agent-capture `toCaptureTask` and one `addTask`: title
  built natively and clamped to 150 characters, text up to 100 000 characters
  as notes, a lone http(s) URL as one `LINK` attachment. Android title-only
  entries, left by the removed startup quick-add overlay of older versions,
  behave like the in-app add bar (active work context, short syntax) with only
  the id fixed.
- Android keeps the inbox in `noBackupFilesDir` so a device restore cannot
  replay old captures. Ids cross the JS bridge and become file names, so both
  platforms accept canonical UUIDs only.
- Privacy: logs carry capture ids and fixed error strings only, never titles
  or notes (`CAPTURE_IMPORT_ERR`).
- Known gap: if the app dies after the user deletes a freshly imported task but
  before its receipt is written, that capture can reappear once.

## Signing setup

Before release, register `com.super-productivity.app.ShareExtension` in Apple
Developer and enable the App Group above for both app identifiers. Regenerate
the app's distribution profile with the App Group entitlement and update
`IOS_PROVISION_PROFILE`. Create a distribution profile for the extension and
store its base64 representation in `IOS_SHARE_PROVISION_PROFILE`.

The profile alone does not grant the group: the IPA's code signature must carry
it. CI archives without signing, so `tools/sign-ios-archive-adhoc.sh` ad-hoc
signs the archive with each target's `.entitlements` before export, and
`tools/assert-ios-app-group-entitlements.sh` fails the export job when the IPA
lacks the App Group (#10777).

For development, select the same signing team on both Xcode targets and enable
automatic provisioning. The app target embeds the extension. Release builds
pass `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` to `xcodebuild archive`,
so every target's `Info.plist` must reference those build settings rather than
hardcode versions.

The extension bundles `src/assets/i18n/en.json` for its custom strings. Its
custom copy currently uses English; system controls follow the device language.

## Verification on macOS and iOS

1. Run `npm run dist:ios:prod`, then build the App scheme in Xcode. Check that
   `App.app/PlugIns/ShareExtension.appex` is embedded and both targets have the
   App Group entitlement.
2. On an iPhone and iPad, share a Safari URL and plain text from another app.
   Check supplied titles, query strings, multiline text, Unicode, and literal
   `+project`, `#tag`, and `@date` text. Save and cancel separately.
3. With the app terminated, save two different shares, then open the app.
   Verify two Inbox tasks with complete notes, no due date or inherited tags.
   Repeat with the app in the background and with airplane mode enabled.
4. Reopen repeatedly: each capture should appear once. Test a write failure
   and a crash before native acknowledgement; pending content must survive.
5. Check empty and oversized input, and unsupported photo/file shares. Saving
   must stay disabled for invalid content. Verify VoiceOver and large text.

Native compilation, signing, and share-sheet behavior require macOS/Xcode and
an iOS device or simulator; the Angular importer tests alone do not verify them.

## Apple references

- [Share extensions](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html)
- [Shared-container file safety](https://developer.apple.com/library/archive/technotes/tn2408/_index.html)
- [Extension lifecycle and containing app](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/ExtensionOverview.html)
