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

## Signing setup

Before release, register `com.super-productivity.app.ShareExtension` in Apple
Developer and enable the App Group above for both app identifiers. Regenerate
the app's distribution profile with the App Group entitlement and update
`IOS_PROVISION_PROFILE`. Create a distribution profile for the extension and
store its base64 representation in `IOS_SHARE_PROVISION_PROFILE`.

For development, select the same signing team on both Xcode targets and enable
automatic provisioning. The app target embeds the extension. Existing release
versioning via `agvtool` updates both targets.

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
