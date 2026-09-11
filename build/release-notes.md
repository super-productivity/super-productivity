For all current downloads, package links, and platform-specific notes: [check the wiki](https://github.com/super-productivity/super-productivity/wiki/2.01-Downloads-and-Install).

### New features

- Select multiple tasks and apply bulk actions using desktop, keyboard, or touch controls.
- Copy the focused task and its subtasks as a Markdown checklist.
- Duplicate tasks with a keyboard shortcut and trigger automations with shortcuts.
- Added the Auto-Fill Time Spent community plugin.
- Identify desktop devices by operating system and device name in tracking presence.

### Sync, recovery, and privacy

- Added local recovery points for full-state data loss, preserved through restores.
- Prevent empty devices from overwriting server data and protect archive-only legacy data when joining sync.
- Show sync conflicts on devices that have never synced and skip duplicate changes during forced downloads.
- Improved WebDAV handling of stale server responses after saving.
- Reject truncated legacy backups with a repair message.
- Fixed user content leaking into exported logs and disabled spellchecking at the session level.
- Preserve plugin sign-ins through temporary token refresh failures.

### Fixes and improvements

- Prevent a missing task ID from clearing the task list; correctly sync completed tasks reopened by starting them.
- Allow completed habits to be unchecked.
- Open task notes directly from the notes icon; fix DEVONthink links and Markdown links without a URL scheme.
- Keep the note toolbar overflow menu accessible on phones and prevent the right-panel close handle from covering content.
- Keep Android’s add-task bar above the keyboard on older WebViews and fix iOS keyboard layout handling.
- Show the schedule day panel in the mobile bottom sheet and keep it tied to the displayed day.
- Keep started or tracked appointments in the main task list.
- Restore the Linux tray icon, fix the tray’s Show App action, and stop the macOS tray icon from jumping when tracking starts.
- Fixed Snap packaging and unwanted scrolling during navigation and with background images.
- Improved Korean translations.

### Removed

- Removed the User Profiles feature.
