For all current downloads, package links, and platform-specific notes: [check the wiki](https://github.com/super-productivity/super-productivity/wiki/2.01-Downloads-and-Install).

### Features

- Added OneDrive as a sync provider and marked it as desktop/mobile-only.
- Improved the project archive flow.
- Added a Start break action to break reminders.
- Improved the task swipe menu appearance.
- Improved the task attachment dialog and URL handling.
- Delayed rating prompts for 30 days after crashes or data damage.
- Added plugin persistence improvements, persisted-data change hooks, and support for multiple handlers per plugin hook.
- Improved plugin sync data size.

### Fixes

- Fixed Android edge-to-edge, keyboard inset, startup overlay, and dark-theme keyboard resize issues.
- Improved Android recovery from transient WebView startup failures.
- Kept Android foreground services alive when the app task is removed.
- Fixed iOS time tracking and focus mode state after app resume.
- Restored iOS local notifications and fixed notification timing after the permission dialog.
- Prevented the iOS tag picker from opening automatically when opening tasks in portrait mode.
- Fixed macOS app quit behavior.
- Updated search results immediately when a task is marked done.
- Guarded the schedule dialog against malformed time input.
- Retried transient client-side network GET failures once.
- Hardened OneDrive sync follow-ups and encrypted sync retry handling.
- Fixed recurring task cases around start dates moved to today and overdue untracked instances from yesterday.
- Preserved issue-number prefixes on imported issue tasks.
- Fixed the label shown when re-opening a completed task.
- Preserved the visible default notes template when toggling checklist mode.
- Fixed browser blocking when sync removes the active project.
- Guarded boards loading against malformed payloads.
- Allowed parent tasks and subtasks to share tags independently.
- Improved selected-subtask highlighting, current-task styling in Zen and Lines, and habit tracker day-circle readability.
- Improved German, Turkish, and mismatched translation wording.

### Performance

- Skipped no-op plugin document-mode saves.
