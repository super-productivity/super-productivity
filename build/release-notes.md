For all current downloads, package links, and platform-specific notes: [check the wiki](https://github.com/super-productivity/super-productivity/wiki/2.01-Downloads-and-Install).

## Super Productivity 18.14.0

### Highlights

- Added a Todoist import plugin to the Import/Export launcher.
- Create tasks by dropping links or EML files onto the app, with hardened EML importing.
- Added an Android home-screen widget for today’s tasks.
- Redesigned the add-task bar with improved toggles, notes, layout, and accessibility.
- Added file-tree actions for creating subfolders and items within folders.
- Added optional sorting of completed tasks by completion date.

### Tasks and planning

- New everyday recurring tasks now skip overdue occurrences by default.
- Fixed selecting day-of-month recurrence.
- Shift+T now schedules overdue tasks for today more reliably.
- Improved subtask creation on touch devices and during IME composition.
- Collapsed subtask state now persists across restarts.
- Project sections are now retained when duplicating a project.
- Fixed navigation from search for tasks without a project or tag.
- Unified Due, Deadline, Planned, and Scheduled labels.

### Sync and data safety

- Added an opt-in split-file sync format for delta-based syncing.
- Avoids full downloads when the remote revision has not changed.
- Improved atomic file writes, backup recovery, and encrypted file-sync safety.
- Reduced false conflict dialogs and corrected displayed conflict-change counts.
- File-based providers can now offer end-to-end encryption before the first upload.
- Improved reporting when an encryption key is missing.

### Accessibility, integrations, and mobile

- Improved accessible names, keyboard controls, and task focus behavior.
- Agenda plugin events now appear without navigating away and back.
- Added support for Outlook and other allowed app deep links in notes.
- Fixed Android bottom-navigation insets and stale focus-timer completions.
- Improved handling of third-party keyboard heights on iOS.
- The Eisenhower “Not Completed” filter now persists across restarts.
- Fixed freezes in issue-provider calendar configuration.

### Performance and polish

- Reduced unnecessary task-list, planner, date-formatting, and work-context updates.
- Fixed sidebar icon movement, add-task scrollbar behavior, and small-screen reminder labels.
- The active project or tag icon is now shown in the header.
