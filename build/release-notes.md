For all current downloads, package links, and platform-specific notes: [check the wiki](https://github.com/super-productivity/super-productivity/wiki/2.01-Downloads-and-Install).

### Features

- **tasks:** unfocus the focused task on Escape
- **ios:** add home screen quick actions (#10124)
- **trello:** add two-way card synchronization (#9447)
- **calendar:** support multiple Google Calendar accounts (#8865)
- **boards:** add keyboard navigation and task multiselect
- **planner:** add keyboard navigation, shortcuts, and multiselect (#10086)

### Fixes

- **plainspace:** restore archived recurring task for next occurrence (#10157)
- **window:** track un-maximized bounds instead of trusting the library (#10094)
- **ci:** repair TestFlight publisher reporting and extension handling (#10156)
- **tasks:** keep a non-empty sub-task draft open on focus loss
- **sync:** offer recovery for unsupported multi-entity conflicts (#10140)
- **sync:** prevent missed updates during resets and realtime sync (#10145)
- **electron:** correct progressBarMode typo 'pause' -> 'paused'
- **i18n:** correct wrong Vietnamese sync safety strings
- **platform:** require the preload bridge for electron detection (#10139)
- address review findings in notes, task selection, and recovery (#10138)
- **schedule:** span the whole month in the month grid (#9463)
- **tasks:** make the iOS focus-zoom guard reachable from tests
- **daily-summary:** keep the celebration headline when confetti is off
- **tasks:** stop focus borders sticking after a tap on touch
- **tasks:** restore focus outlines and selection behavior
- **schedule:** persist resize before render

### Performance

- reduce task, schedule, and worklog processing costs (#10141)

### Other Changes

- chore(deps)(deps): bump the github-actions-minor group with 5 updates (#10108)
