For all current downloads, package links, and platform-specific notes: [check the wiki](https://github.com/super-productivity/super-productivity/wiki/2.01-Downloads-and-Install).

### Highlights

- Tasks with deadlines today can now be added to the Today view automatically.
- Added Ctrl/Cmd+C to copy the focused task title.
- Focus Mode can auto-start breaks after manual session completion and show Flowtime/countdown timers in the browser tab.
- Added a keyboard shortcut to toggle the sidebar between compact and full mode.
- Schedule time inputs now support Shift/Ctrl+Arrow minute stepping.
- Specific-day habit streaks now grey out non-selected days.
- Self-hosted Jira instances can be used without the web extension.

### Sync & SuperSync

- SuperSync selection now surfaces mandatory client-side encryption.
- Improved SuperSync reconnect handling and reduced reconnect storm logging.
- Fixed sync status wording to distinguish newly synced data from already-synced data.
- Added support for a separate Nextcloud login name.
- Fixed sync fallback lock recovery after timeout and database version-change handling.
- Added a SuperSync server user-recovery script.

### Fixes

- Fixed backups continuing after automatic backups were disabled.
- Fixed calendar auto-import timing and serialized auto time-block writes.
- Fixed planner budget calculations for 24-hour calendar events.
- Fixed task creation messages for untitled tasks, deleted-task short syntax handling, task panel toggling, and scheduled completion preserving schedules.
- Fixed Focus Mode overtime display while paused, zero-duration completion, Flowtime switching, mode selector visibility, and countdown badge layout.
- Fixed note dragging, touch scrolling, and unpin-from-today icons.
- Fixed larger background image uploads and stale Schedule button translations.
- Fixed native dialogs during op-log hydration, Android focus-mode time crediting, and macOS shutdown quitting.

### Plugins & Advanced

- Added plugin support for work-context header buttons, an embed slot, the WORK_CONTEXT_CHANGE hook, and iframe-only installs.
- Added a TipTap-based doc-mode plugin and reduced redundant synced chip data.
- Added distribution-target suffixes to Electron version strings.
- Fixed SuperSync Caddy healthchecks, PostgreSQL connection headroom, Docker sync package inclusion, and the F-Droid build dependency issue.
