For all current downloads, package links, and platform-specific notes: [check the wiki](https://github.com/super-productivity/super-productivity/wiki/2.01-Downloads-and-Install).

### Features

- Add notes directly from the add-task bar.
- Added the built-in Plainspace theme and refreshed the Rainbow theme.
- Project and tag dropdowns now follow their tree order.
- Focus Mode is enabled in the time-tracker onboarding preset.
- Updated Ukrainian translations.

### Fixes

- Improved sync reliability, conflict handling, retries, encryption operations, and lost-update protection.
- Fullscreen note edits now persist when navigating, resizing, or ending a Focus Mode session.
- Improved mobile backup restoration and durability, including large Android backups and iOS read failures.
- Restored desktop plugin rendering, prevented empty side panels, and exposed the focused-task API to iframe plugins.
- Fixed Windows tray icons, macOS shortcut layouts, and Meta/OS modifier recording.
- Fixed Android keyboard positioning, status-bar spacing, and background battery drain.
- Added support for app deep links such as `obsidian://`.
- Fixed Daily Summary opening from the before-close dialog.
- Fixed several task, Focus Mode, schedule, and idle-button visual issues.
- Redacted provider credentials and WebSocket tokens from exportable logs.
- Fixed Nextcloud Deck completion values and rejected negative counter values.

### Performance

- Improved sync performance by caching the latest full-state operation lookup.
