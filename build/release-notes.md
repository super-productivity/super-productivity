For all current downloads, package links, and platform-specific notes: [check the wiki](https://github.com/super-productivity/super-productivity/wiki/2.01-Downloads-and-Install).

This release collects everything since v18.21.1, including the 18.21.2, 18.22.0 and 19.0.0 changes that were never published.

### Highlights

- Notes are now edited directly with live Markdown — no more switching between edit and preview mode.
- Select multiple tasks and apply bulk actions with desktop, keyboard, or touch controls.
- Duplicate tasks with a keyboard shortcut, and trigger automations with shortcuts.
- Copy the focused task and its subtasks as a Markdown checklist, and convert selected text into Markdown checklist items.
- Double-click projects, tags, and folders in the navigation to rename them.
- Local recovery points protect against full-state data loss and are preserved through restores.
- The currently tracked task is shown in the browser tab title.
- Added URL-scheme task actions on Android.
- Tasks opened from search are now clearly highlighted.

### Tasks, planning, and UI

- Date-only scheduled tasks are ordered after timed tasks, and the date-only heading in the Schedule is clearer.
- Long task titles stay reachable while editing.
- Completed habits can be unchecked again.
- Started or tracked appointments stay in the main task list instead of moving to "Later Today".
- Task notes open directly from the notes icon, and the empty Subtasks panel no longer shows a misleading "(0)".
- Pressing Escape properly leaves the plain-text notes field, and task details no longer steal focus back from a field you have re-entered.
- Tag entry accepts a suggestion with Tab and keeps the typed text with Enter.
- Subtask checkboxes align with their title in the detail panel.
- Date-picker quick-access shortcuts are now labelled.
- Refined the appearance controls and centred the settings tab strip.
- Fixed repeated side-navigation actions and unwanted scrolling during navigation and with background images.
- The right panel's edge close handle no longer overlaps panel content.
- Reminders no longer block cleanup of overdue repeating tasks.

### Sync, recovery, and privacy

- A device with no data can no longer overwrite server data, and archive-only legacy data is protected when joining sync.
- Legacy data is preserved during operation-log rebuilds, and legacy data missing newer model sections now migrates correctly.
- Truncated legacy backups are refused with a repair message.
- Sync conflicts are surfaced on devices that have never synced, and changes already applied are skipped during forced downloads.
- Starting a done task now correctly syncs it as reopened.
- A missing task ID can no longer clear the task list.
- Improved WebDAV handling of stale server responses after saving.
- User content no longer leaks into exported logs, and the spellchecker is disabled at session level.
- Improved SuperSync processing and maintenance of older operations, backup integrity, health alerts, and deployment-surface hardening.

### Mobile and desktop

- Android: notifications and the native time picker work in the legacy WebView shell, and the add-task bar stays above the keyboard on older WebViews.
- iOS: the add-task bar no longer jumps with keyboard layout changes.
- The Schedule day panel renders in the mobile bottom sheet and stays tied to the displayed day.
- Touch swipes no longer move or resize Schedule events.
- The note toolbar's overflow menu stays reachable on phones, and the mobile notes panel dropped its redundant close button.
- Restored the Linux tray icon, fixed the tray's Show App action, and stopped the macOS tray icon from jumping or blinking during focus sessions.
- Maximized windows keep their state across hiding, minimizing, and restarting.
- Flowtime keeps its OS progress bar.
- Fixed Snap packaging and Windows release artifacts.

### Integrations and plugins

- Issue polling no longer overwrites task completion state and keeps reminders in step with due-time changes.
- Fixed issue-provider sync direction, shortcut handling, CalDAV, and the finish-day hook.
- REST API support for task deadlines, and a new `deleteProject` plugin API.
- Plugin sign-ins survive temporary token refresh failures.
- Plainspace tells a rejected token apart from an unreachable host and can now be disconnected persistently.
- Notes support `mid:` email message links, DEVONthink links, and Markdown links without a URL scheme.
- Added the Bulk Add Tasks and Auto-Fill Time Spent community plugins.
- Tracking presence identifies desktop devices by operating system and device name.

### Translations

- Filled in missing translations across all locales, and refined the Korean and Turkish locales.

### Removed

- Removed the User Profiles feature.
