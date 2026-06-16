For all current downloads, package links, and platform-specific notes: [check the wiki](https://github.com/super-productivity/super-productivity/wiki/2.01-Downloads-and-Install).

### Highlights

- Redesigned the idle dialog with a choice-first flow.
- Overhauled the Focus Mode screen UX.
- Added checklist progress, bulk actions, and notes editor UX improvements for tasks.
- Added a project completion experience.
- Improved boards project selection with multi-select and sidebar support.

### Search, Notes & Shortcuts

- Added a completed-task filter to search.
- Included note content in global search and improved folder search support.
- Added keyboard shortcuts to the fullscreen note editor.
- Added optional shortcuts for scheduling and a shortcut to set task deadlines.
- Improved long-word wrapping, soft line breaks, and checklist labels in markdown notes.

### Calendar, Planning & Reminders

- Improved calendar design and recurrent task calendar design.
- Allowed writable plugin calendar events to be rescheduled from Schedule.
- Fixed overlapping same-time tasks in Schedule.
- Fixed recurring tasks being double-counted in Today and planner views.
- Added hover tooltips to reminder popups and restored imported legacy task reminders.
- Made recurring CalDAV plugin occurrence edits and deletes safer and quieter.

### Sync, Backup & Data Safety

- Improved CalDAV calendar discovery and handling of missing DAV response headers.
- Preserved entity order during sync data repair.
- Made “Use Server Data” recoverable and guarded the destructive choice.
- Kept local sync and schedule settings local during sync.
- Added Android automatic backup restore and automatic backup file limit configuration.
- Surfaced native WebDAV errors more clearly.

### Integrations & Plugins

- Added Redmine issue search by ID, non-Latin search support, and optional project identifiers for global search.
- Added Jira issue priority display and fixed auto-import pagination, proxy handling, transitions, and yesterday worklog time.
- Added configurable GitHub issue provider API base URL.
- Added Azure DevOps auto-import limit configuration.
- Included Trello workspace boards in the picker.
- Migrated Gitea and Linear issue providers to plugins.
- Showed plugin authors and returned plugin dialog results.

### Desktop & Android

- Restored BMP/AVIF desktop background image support.
- Improved desktop sync-folder handling and tray title settings.
- Added a day/night Android launch splash background.
- Fixed Android WebView white screens on resume.
- Improved Android timer notifications and background behavior.
- Made Android back button close popups and added Vanadium WebView support.
- Deferred mobile notification permission prompts until first use.

### Security & Privacy

- Fixed stored XSS/RCE-related vulnerabilities in notes, note images, plugin nodeExecution, and CSP handling.
- Hardened desktop URL, file path, backup loading, and local file URL handling.
- Reduced logging of local paths, issue payloads, provider configs, archived task data, dragged task objects, and other sensitive data.
- Hardened plugin iframe isolation and nodeExecution grants.

### Performance & Polish

- Reduced per-task store subscription and selector overhead.
- Improved heatmap and Super Sync account badge contrast.
- Improved task, project, tag, habit, navigation, work-context, and calendar UI details.
- Fixed task menu keyboard handling, subtask shortcut behavior, project menu typeahead, and kanban in-progress tag cleanup.
