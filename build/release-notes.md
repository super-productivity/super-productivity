For all current downloads, package links, and platform-specific notes: [check the wiki](https://github.com/super-productivity/super-productivity/wiki/2.01-Downloads-and-Install).

### Tasks and views

- Added Smart Lists, multi-tag filtering, and a redesigned view editor with rule chips, pinned views, and improved mobile layouts.
- Open a project directly from a task’s project chip, and add deadlines from the add-task bar.
- Duplicating tasks now preserves links, files, and deadlines. Unplanned tasks with missed deadlines appear in Today’s overdue list.
- Fixed recurring task start dates, placement, and duplicate schedule entries. Planning no longer double-counts subtasks, and overflowing work skips local weekend days.
- Improved cross-project search and offered a way to clear filters hiding a searched task.

### Plugins and integrations

- Added the bundled AI Command plugin, off by default, with multi-select and Add to Today actions.
- Added guided plugin creation with AI prompts, and information about data plugins send off your device.
- Moved GitLab into a bundled plugin. Expanded the community catalog with Deadlines, Task Colors, Timesheet, standalone Markdown notes, monday.com, and Ridonculous plugins.
- Added an option to include Gitea pull requests and support for sending task completion to Azure DevOps work items.
- Added calendar logging for tracked work sessions. Cancelled or moved-away calendar events are no longer imported.

### Time tracking and worklog

- Added optional web notifications when focus sessions or breaks end, and looping bells for desktop alarm-style reminders.
- Recording idle time as a break now resets the break timer.
- Added Friday weekly wrap-ups. Worklog exports now include archived projects, export the displayed week, and keep weeks spanning two months together.

### Sync and Android

- Simplified SuperSync setup and fixed file-sync recovery and preservation of pending edits.
- Fixed conflicts involving tag deletion, counter restoration, task section moves, and Today ordering.
- Added Android task creation from the home-screen widget and share saving without opening the app.
- Added Android background reminders for WebDAV/Nextcloud, fixed stale or missing reminders, and kept widget task order aligned with Today.
- Mobile sync now sends pending changes when the app enters the background; Android also checks file-based providers while in the foreground.

### Interface, desktop, and performance

- Added smoother page transitions that respect reduced-motion settings, faster startup, and performance improvements for long task lists and tracking.
- Improved keyboard menus, touch interactions, and IME input in notes and the focus task picker.
- Added desktop launch shortcuts for New task, Today, and Inbox, plus a `--start-minimized` option.
- Fixed desktop task copying and macOS window dragging. Resuming or unlocking no longer raises the app or requests attention.
- Exported logs now redact home-folder paths. Updated Russian translations and German tag terminology.
