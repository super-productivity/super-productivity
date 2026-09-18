For all current downloads, package links, and platform-specific notes: [check the wiki](https://github.com/super-productivity/super-productivity/wiki/2.01-Downloads-and-Install).

This release collects everything since v18.21.1, including the 18.21.2, 18.22.0 and 19.0.0 changes that were never published.

### Highlights

- Notes are now edited directly with live Markdown — no more switching between edit and preview mode.
- Select multiple tasks and apply bulk actions with desktop, keyboard, or touch controls.
- Duplicate tasks with a keyboard shortcut, and trigger automations with shortcuts.
- Copy the focused task and its subtasks as a Markdown checklist, and convert selected text into Markdown checklist items.
- Rename projects and tags straight from their context menu.
- Local recovery points protect against full-state data loss: a browsable "Backups on this device" list under Settings → Sync & Backup, plus a banner when a remote full state holds far fewer tasks than your last snapshot.
- The currently tracked task is shown in the browser tab title.
- Added URL-scheme task actions on Android.
- Tasks opened from search are now clearly highlighted.

### Removed

- The User Profiles feature is gone. Removing it drops the local profile store, and deletes the note drafts of every profile except the one that was active at removal time. The local database bump also acts as a downgrade barrier, so you cannot return to 18.21.1 afterwards. Synced task data is unaffected.

### Tasks, planning, and UI

- When sorting a task list, date-only scheduled tasks and deadlines are now ordered after timed ones, and the date-only heading in the Schedule is clearer.
- Long task titles stay reachable while editing.
- Clicking a completed habit unchecks it again, instead of counting further (simple completion habits; goal-based counters still count past their goal).
- Started or tracked appointments stay in the main task list instead of moving to "Later Today".
- Task notes open directly from the notes icon, and the empty Subtasks panel no longer shows a misleading "(0)".
- Subtask checkboxes align with their title in the detail panel.
- Pressing Escape properly leaves the plain-text notes field, and task details no longer steal focus back from a field you have re-entered.
- Tag entry accepts a suggestion with Tab and keeps the typed text with Enter.
- Opening Edit repeating task or Edit issue provider no longer reorders the sidebar tags of anyone whose tags predate the navigation tree.
- Date-picker quick-access shortcuts are now labelled.
- Refined the appearance controls and centred the settings tab strip.
- Fixed repeated side-navigation actions, and unwanted scrolling during navigation and with background images.
- The right panel's edge close handle no longer overlaps panel content.
- Reminders no longer block cleanup of overdue repeating tasks.

### Sync, recovery, and privacy

- A device with no data can no longer overwrite server data, and archive-only legacy data is protected when joining sync.
- Legacy data is preserved during operation-log rebuilds, and legacy data missing newer model sections now migrates correctly.
- An unrecognised value in synced data no longer wedges an older client: a single unknown entry used to fail an entire download page, leaving the device stuck in a generic sync error instead of prompting for an app update.
- Cleared fields now survive the wire, a failed causal repair no longer advances past the only recovery snapshot, and live tracking broadcasts a final stopped state so other devices stop showing stale tracking.
- Truncated legacy backups are refused with a repair message.
- Sync conflicts are surfaced on devices that have never synced, and changes already applied are skipped during forced downloads.
- Starting a done task now correctly syncs it as reopened.
- A missing task ID can no longer clear the task list.
- Improved WebDAV handling of stale server responses after saving.
- User content no longer leaks into exported logs, and the spellchecker is disabled at session level.
- Live tracking presence tells desktop devices apart by operating system and device name, with an opt-in name for this device.
- Improved SuperSync maintenance of older operations, backup integrity, health alerts, and hardening of the self-hosted deployment surface.

### Mobile and desktop

- Android: notifications now work in the legacy WebView shell.
- Android: touching a time field opens the native time picker.
- Android: the add-task bar stays above the keyboard on older WebViews.
- iOS: the add-task bar no longer jumps with keyboard layout changes.
- The Schedule day panel renders in the mobile bottom sheet and stays tied to the displayed day.
- Touch swipes no longer move or resize Schedule events.
- The note toolbar's overflow menu stays reachable on phones, and the mobile notes panel dropped its redundant close button.
- Restored the Linux tray icon and fixed the tray's Show App action.
- The macOS tray icon no longer shifts when tracking starts, nor blinks during Flowtime focus sessions.
- Maximized windows keep their state across hiding, minimizing, and restarting.
- Flowtime keeps its OS progress bar.
- The desktop startup restore prompt now names task and project counts instead of only a folder and timestamp.
- Fixed Snap packaging and Windows release artifacts.

### Integrations and plugins

- Issue polling no longer overwrites task completion state and keeps reminders in step with due-time changes.
- Fixed issue-provider sync direction, shortcut handling, CalDAV, and the finish-day hook.
- REST API support for task deadlines, and a new `deleteProject` plugin API.
- Plugin sign-ins survive temporary token refresh failures.
- Plainspace tells a rejected token apart from an unreachable host and can now be disconnected persistently.
- Notes support `mid:` email message links, DEVONthink links, and Markdown links without a URL scheme.
- Bulk Add Tasks and Auto-Fill Time Spent are now available in the community plugins list.

### Translations

- Filled in missing translations across all locales, and refined the Korean and Turkish locales.
