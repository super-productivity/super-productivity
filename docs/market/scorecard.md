# Market scorecard

**Snapshot 2026-10** · SP v19.3.1, plus unreleased changes on `master` up to
`f958c66` (2026-10-28) · target, competitor set and method: [README.md](README.md)

How this snapshot was gathered:

- **SP facts** were read from the code at the v19.2.0 tag and updated from the
  commits and issues up to v19.3.1 (the 2026-10 refresh read commit history and
  issue state, not every code path). Later changes on `master` are listed under
  [Unreleased on master](#unreleased-on-master).
- **Competitor facts** come from search-result excerpts of vendor pages, so they
  count as **snippet** unless marked otherwise. The 2026-10 refresh (2026-10-29)
  could not read any competitor page and found no verified change, so the
  competitor sections below are carried over unchanged. The research environment blocked
  play.google.com, apps.apple.com, appbrain.com, alternativeto.net, reddit.com and
  the specialists' vendor sites, and direct fetches of ticktick.com and todoist.com
  failed. GitHub was reachable, so open-source repos and docs were read directly.
- Each **Sources** line gives the month checked; prices and ratings are as of
  that month. Check store ratings and prices directly before quoting them.

## Summary

- **Must be best:** SP is better than all three general todo apps on every
  must-be-best dimension except focus, where it ties with TickTick. Against the
  specialists it is better on privacy and price, and on developer integrations
  against the five scored on it. Three must-be-best dimensions are not met yet:
  - **Time tracking:** Toggl Track and Clockify are better on time entries and
    editing them.
  - **Daily planning:** Sunsama and Akiflow add weekly rituals and two-way
    Outlook sync.
  - **Focus:** a tie with TickTick.
- **Must not lose badly:** this is where the distance to "best on the market"
  is. SP loses to TickTick and Todoist on all eight of these dimensions.
- **To Do List:** SP wins on capability. It loses on the phone: first run, capture
  and polish.

| Competitor | Better for the typical user?  | SP better by far                                                     | SP worse where it must not lose badly                |
| ---------- | ----------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------- |
| TickTick   | TickTick                      | Time tracking, developer integrations, privacy                       | All eight dimensions                                 |
| Todoist    | Todoist                       | Time tracking, focus, privacy                                        | All eight; capture and mobile polish by far          |
| To Do List | To Do List, for a casual list | Organization, planning, time tracking, focus, developer integrations | Capture on phones, mobile polish, first run (by far) |

## General todo apps

Verdicts are from SP's side; "Must not lose" means must not lose badly. Each
app's section below gives the reasons.

| #   | Dimension                        | Group         | TickTick       | Todoist        | To Do List      |
| --- | -------------------------------- | ------------- | -------------- | -------------- | --------------- |
| 1   | Quick capture                    | Must not lose | Worse          | Worse, by far  | Worse on phones |
| 2   | Organization                     | Must not lose | Worse          | Worse          | Better, by far  |
| 3   | Recurrence                       | Tracked       | Tie            | Slightly worse | Better          |
| 4   | Calendar                         | Must not lose | Worse          | Worse          | Better          |
| 5   | Daily planning and time-blocking | Must be best  | Better         | Better         | Better, by far  |
| 6   | Reminders                        | Must not lose | Worse          | Worse          | Tie             |
| 7   | Time tracking                    | Must be best  | Better, by far | Better, by far | Better, by far  |
| 8   | Focus and breaks                 | Must be best  | Tie            | Better, by far | Better, by far  |
| 9   | Views                            | Tracked       | Slightly worse | Better         | Better          |
| 10  | Habits                           | Won't compete | Worse          | —              | —               |
| 11  | Notes                            | Tracked       | Worse          | Tie            | Better          |
| 12  | Collaboration                    | Won't compete | Worse          | Worse, by far  | Tie             |
| 13  | Developer integrations           | Must be best  | Better, by far | Better         | Better, by far  |
| 14  | Consumer integrations            | Tracked       | Worse          | Worse          | Tie             |
| 15  | Extensibility                    | Tracked       | Better         | Tie            | Better          |
| 16  | Platforms and widgets            | Must not lose | Worse          | Worse          | Better          |
| 17  | Mobile polish                    | Must not lose | Worse          | Worse, by far  | Worse           |
| 18  | Sync reliability                 | Must not lose | Worse          | Worse          | Mixed           |
| 19  | Offline, privacy, ownership      | Must be best  | Better, by far | Better, by far | Better          |
| 20  | Price                            | Must be best  | Better         | Better         | Better          |
| 21  | AI                               | Open decision | Worse          | Worse          | Tie             |
| 22  | Customization                    | Tracked       | Better         | Better         | Better          |
| 23  | First run                        | Must not lose | Worse          | Worse          | Worse, by far   |

### SP baseline (v19.3.1)

1. **Capture**
   - The add-task bar parses `+project`, `#tag`, `@date`, `30m` estimates and
     recurrence such as `@every friday`. `!deadline` exists but is off by default
     (`src/app/features/tasks/short-syntax.ts`).
   - `@` dates follow the UI language and date order (#10970); priority is
     `p1`–`p3` (#10974). There is no priority control in the add-task bar yet.
   - The local REST API applies this syntax unless a request sets
     `isIgnoreShortSyntax`. The Android share sheet (#10917), iOS share, the URL
     scheme, `.eml` drops, the MCP endpoint and SuperSync assistant capture store
     titles literally.
   - An opt-in MCP endpoint on desktop (#10251) and task capture for AI
     assistants through SuperSync (#10759).
   - No voice capture.
2. **Organization:** projects, Inbox, tags, sections, project folders, priorities.
   - Subtasks go one level deep (`task.component.ts`: `parentId || id`).
   - One filter, sort and grouping per view, stored on the device only. No saved
     filters.
3. **Recurrence:**
   - Daily, weekly, monthly or yearly every N days, weeks, months or years.
   - Monthly by nth weekday or last day.
   - Repeat from the completion date, skip overdue, pause, subtask templates.
   - Optional end date (#10276). Missing: an end count, hourly, yearly by nth weekday.
4. **Calendar:**
   - The schedule has day, week and month views.
   - iCal subscriptions, Outlook's included, are read-only.
   - The bundled Google Calendar and CalDAV Events plugins read, create, update
     and delete events, and can auto time-block tasks.
   - The CalDAV tasks (VTODO) provider syncs done, title and notes, and can
     create (#10991) and delete (#10989) VTODOs when you opt in.
5. **Planning:**
   - A planner that opens with 15 days on desktop (5 on phones), loads more on
     scroll, and shows each day's capacity against work hours.
   - The schedule fits tasks around fixed blocks.
   - "Finish day" review. No weekly review.
6. **Reminders:** one `remindAt` plus one deadline reminder per task (`task.model.ts`),
   with 1-day, 3-day and 1-week lead times (#10977).
   - Android: exact alarms, an optional alarm style, and Done or Snooze on the
     notification.
   - No location reminders.
7. **Time tracking:**
   - Time per task per day, estimates, idle detection and reminders to track.
   - Time is added or corrected per day as a duration, past days included.
   - Worklog CSV export; worklog upload to Jira, OpenProject, Redmine and GitLab.
   - No start and end timestamps per tracking session (#6378). One timer at a time
     (#5832).
8. **Focus:**
   - Pomodoro, Flowtime and countdown modes, with an optional tick or white-noise
     sound.
   - Optional full-screen breaks on desktop.
   - Floating desktop task widget.
9. **Views:** list, Kanban, Eisenhower matrix, custom tag-based boards, planner and
   schedule. No timeline or Gantt view.
10. **Habits:** simple counters, with optional streaks.
11. **Notes:** markdown task notes, project notes, pasted images (stored locally,
    not synced).
12. **Collaboration:** only through Plainspace.
13. **Developer integrations:**
    - Built in: Jira, GitLab, OpenProject and CalDAV. Bundled plugins: GitHub,
      Gitea/Forgejo, Linear, Redmine, Azure DevOps, ClickUp, Trello and Nextcloud
      Deck.
    - Per-field two-way sync for the plugin providers and CalDAV. Jira can move
      an issue's status when a task starts or is done.
14. **Consumer integrations:**
    - The URL scheme, which iOS Shortcuts can call.
    - Importers for Todoist and TickTick.
    - No Zapier or email-to-task.
15. **Extensibility:**
    - Plugin API with UI entry points and custom issue providers.
    - Local REST API on desktop.
    - MIT licence.
16. **Platforms:**
    - Desktop: Windows, macOS and Linux (AppImage, deb, rpm, snap, Flatpak).
    - Web/PWA, Android (Play, F-Droid) and iOS (App Store).
    - One Android widget: up to 20 of Today's tasks, tap to complete, no adding.
    - iOS Home Screen quick actions: New task, Today, Inbox.
    - Android launcher shortcuts (#10971).

- No watch apps, no iOS widget.

17. **Mobile polish:** bottom navigation below 600px (choosable second slot,
    #10990), swipe gestures, larger touch targets (#10975), long-press menus in
    the side navigation (#10992). Users still call it clunky and dated (#9225,
    #4864).
18. **Sync:** SuperSync (beta, end-to-end encrypted, self-hostable), Dropbox,
    Nextcloud, OneDrive, WebDAV and local file.
    - Some conflicts fall back to a whole-dataset "keep local or remote" dialog.
    - The two data-loss reports in the 2026-10 baseline are closed: #7892
      (Android data reset overnight; the last full mobile backup now survives a
      restart with near-empty data, #10847) and #9256 (SuperSync data could not be
      restored; decryption failures get diagnostics and SP asks before
      overwriting remote data it can't decrypt, #10855). v19.3.1 also asks before
      hydrating a remote that lost the client's own uploads (#11115).
19. **Privacy:** no account and no telemetry; data stays on the device unless
    you sync it.
    - Encryption (Argon2id + AES-GCM) is required on SuperSync and optional on
      the file-based providers.
    - Automatic local backups on desktop, Android and iOS; full JSON export.
20. **Price:** free, no paid tier, no ads.
21. **AI:** no built-in assistant. External assistants connect through the
    opt-in MCP endpoint and SuperSync capture (see Capture).
22. **Customization:** 16 built-in themes plus custom CSS themes, 56 configurable
    shortcuts, feature toggles, 28 languages.
23. **First run:**
    - New installs start with fewer features switched on, with first-run hints,
      a quick tour on the first task (#10957), an explanation of Today and the
      Inbox (#10913) and a guided tour in the Help menu.
    - Reviews (snippet) and #9225 still call it "intimidating" or "overwhelming".

### Unreleased on master

Merged after v19.3.1 (`1014df9`), up to `f958c66` (2026-10-28). Re-score these when
they ship. Everything listed here in the 2026-10 snapshot shipped in v19.3.0 and
is now in the baseline.

- **Capture:** Android shares are saved without opening the app and uploaded sealed
  through SuperSync capture (#11119); New task, Today and Inbox in the desktop dock
  menu and jump list (#11017); existing multi-word tags parse after `#` (#11234).
- **Calendar and time tracking:** opt-in "Add tracked time to calendar" writes each
  finished tracking session, with its start and end, as a CalDAV event (#11181,
  closes #6378). Sessions are not stored with timestamps in the task or shown in
  the worklog, so #7888 and #7890 stay open.
- **Reminders:** full-screen intent on alarm-style reminders (#10171).
- **Mobile polish:** global progress bar above the bottom nav (#11241), grouped
  task context menu with quieter icons (#11236).
- **First run:** each list explains itself when empty (#11176); onboarding skips a
  repeated swipe step and mentions import.
- **Sync:** download from the start when the op log never synced (#11120), no forced
  download when the local clock covers rejections (#11229), pending edits kept on a
  catch-up file snapshot (#11142, re-landed in #11171).
- **Extensibility:** plugin minimum app version enforced (#11019); monday.com and
  Timesheet listed as community plugins (#11133, #11224).

### TickTick

| #   | SP is          | Why                                                                                                                                                            |
| --- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Worse          | Smart Recognition parses dates and repeats; AI voice add; email to task; Siri, Google Assistant and Alexa                                                      |
| 2   | Worse          | Subtasks five levels deep plus checklists, folders, saved AND/OR filters (Premium)                                                                             |
| 3   | Tie            | TickTick: end after N, specific dates, holidays. SP: nth weekday, last day, skip overdue, pause                                                                |
| 4   | Worse          | Day, 3-day, week, month and year views; two-way Google (one calendar), iCloud, CalDAV                                                                          |
| 5   | Better         | TickTick has "Plan your day" and drag to calendar. It has no capacity view, no flowing schedule, no end-of-day review                                          |
| 6   | Worse          | Up to five reminders per task (two free), Constant Reminder that rings through Do Not Disturb, location reminders (platform support conflicts between sources) |
| 7   | Better, by far | TickTick logs focus sessions against tasks; no timesheet, export or worklog found                                                                              |
| 8   | Tie            | TickTick: strict mode, watch, cross-device focus, white noise (SP has one too). SP: more modes, enforced breaks, desktop widget                                |
| 9   | Slightly worse | Both have list, Kanban, Eisenhower and calendar; TickTick adds a timeline (Premium)                                                                            |
| 10  | Worse          | Habit tracker with goals, streaks, heatmaps and watch complications                                                                                            |
| 11  | Worse          | Note lists, markdown editor, desktop sticky notes                                                                                                              |
| 12  | Worse          | Shared lists of up to 29 members, assignees, comments, permissions                                                                                             |
| 13  | Better, by far | No native Jira, GitHub or GitLab integration; only through Zapier, IFTTT or Zoho Flow                                                                          |
| 14  | Worse          | Zapier, IFTTT, Gmail add-on, two-way Notion sync, Telegram, email to task                                                                                      |
| 15  | Better         | TickTick has an open API, an official MCP server and a CLI, but no plugins and it is closed source                                                             |
| 16  | Worse          | Apple Watch, Wear OS, iOS widgets and Live Activities, browser extensions. SP packages better for Linux                                                        |
| 17  | Worse          | App Store Editors' Choice                                                                                                                                      |
| 18  | Worse          | Nothing to set up. Complaints are slow calendar sync and occasional delays, not data loss                                                                      |
| 19  | Better, by far | Account required, no end-to-end encryption, not offline-first, CSV export. Operated by Appest                                                                  |
| 20  | Better         | Premium US$49.99/yr. The free tier caps lists at 9, tasks per list at 99, reminders per task at 2 and habits at 5                                              |
| 21  | Worse          | AI Assistant (2026-10), AI voice add, recording transcription                                                                                                  |
| 22  | Better         | Themes only, against SP's custom CSS, shortcuts and feature toggles                                                                                            |
| 23  | Worse          | Reviewers find it easy to start; Zapier calls it a power-user tool next to Todoist                                                                             |

- **Price:**
  - Premium US$49.99/yr, previously $35.99. Third-party trackers report the
    change in 2026-08/09; the pricing page did not announce it.
  - Education discount 25%.
- **Ratings:**
  - Google Play: 4.6 from about 166K reviews, 10M+ installs.
  - App Store US: 4.9 from about 46K ratings, Editors' Choice.
- **2026 releases:**
  - 8.0 (Jan): suggested tasks, year view.
  - Official MCP server (Apr).
  - AI voice add and transcription (Apr).
  - Search filters (Jun).
  - Constant Reminder through Do Not Disturb on iOS 26 (Jun).
  - AI Assistant (2026-10-08).
- **Sources** (2026-10, snippet): [upgrade](https://ticktick.com/upgrade) ·
  [price change](https://vyneron.com/en/blog/ticktick-pricing-2026) ·
  [help center](https://help.ticktick.com/) ·
  [what's new](https://help.ticktick.com/articles/7082552170989486080) ·
  [AI features](https://help.ticktick.com/articles/7444685542580551680) ·
  [security](https://ticktick.com/security) ·
  [Play](https://play.google.com/store/apps/details?id=com.ticktick.task) ·
  [App Store](https://apps.apple.com/us/app/ticktick-to-do-list-calendar/id626144601)

### Todoist

| #   | SP is          | Why                                                                                                                                                        |
| --- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Worse, by far  | Quick Add parses `#project /section p1 !reminder {deadline}`; Ramble voice capture in 38 languages; tasks from photos and PDFs; email forwarding (Pro)     |
| 2   | Worse          | Sub-projects, nested subtasks, labels, a filter query language with 150 saved filters on Pro. Limits: 5 projects and 3 filters free, 300 tasks per project |
| 3   | Slightly worse | Same power, typed in plain English ("every 3rd friday", "every!")                                                                                          |
| 4   | Worse          | Google or Outlook on every plan; the calendar layout is Pro-only                                                                                           |
| 5   | Better         | Durations and time-blocking are Pro-only; no start dates; no capacity view or end-of-day review                                                            |
| 6   | Worse          | Pro: several reminders, location reminders, urgent full-screen alarm. Free: automatic reminders and one urgent reminder per task                           |
| 7   | Better, by far | No native time tracking; Toggl's extension fills the gap                                                                                                   |
| 8   | Better, by far | No native focus timer                                                                                                                                      |
| 9   | Better         | List, board and calendar (Pro). No Eisenhower matrix, planner or schedule                                                                                  |
| 10  | —              | Karma points, goals and streaks, but no habit tracker                                                                                                      |
| 11  | Tie            | Descriptions and comments                                                                                                                                  |
| 12  | Worse, by far  | Shared projects, team workspaces, roles, Business plan                                                                                                     |
| 13  | Better         | No official Jira or GitHub integration; Jira only through a third-party app                                                                                |
| 14  | Worse          | Slack, Zapier, Make, n8n, Gmail and Outlook, five browser extensions, Siri, Google Assistant, Alexa                                                        |
| 15  | Tie            | Todoist: unified API v1, official MCP server and CLI, large ecosystem. SP: plugins that add UI, open source                                                |
| 16  | Worse          | Apple Watch, Wear OS, Vision Pro, widgets                                                                                                                  |
| 17  | Worse, by far  | Its reputation is the polished reference; PCMag Editors' Choice                                                                                            |
| 18  | Worse          | Invisible sync once signed in                                                                                                                              |
| 19  | Better, by far | Online-first: you must be signed in, and unsynced changes can be lost if the app closes. No end-to-end encryption; backups leave out completed tasks       |
| 20  | Better         | Pro US$7/month or $60/yr since 2025-12-10 (monthly price up 40%)                                                                                           |
| 21  | Worse          | Ramble, Task Assist, Filter Assist, Email Assist, Task Capture                                                                                             |
| 22  | Better         | Themes only                                                                                                                                                |
| 23  | Worse          | Clean and minimal; easy to start                                                                                                                           |

- **Price:**
  - Pro: US$7/month or $60/yr. Business: $10/user/month or $96/user/yr.
  - Pro Legacy subscribers keep the old price but get no features released after
    2025-12-10.
- **Ratings** (sources conflict):
  - Google Play: 4.4–4.6 from about 265–300K reviews, 10M+ installs.
  - App Store: 4.8 from about 106K ratings.
  - About 30M users (2024).
- **2026 releases:**
  - Ramble generally available (Jan 21).
  - Old API endpoints switched off (about Feb).
  - Task Capture beta (Apr 21).
  - People tab beta (Apr 23).
  - Gmail extension retired (Jun 30).
  - Urgent reminders.
  - Calendar colours (Sep).
  - `%` replaces `@` for labels by the end of 2026 (unverified).
- **Sources** (2026-10, snippet):
  [pricing update](https://www.todoist.com/help/articles/todoist-pro-pricing-update-in-2025-bxBvHZuJZ) ·
  [usage limits](https://www.todoist.com/help/articles/usage-limits-in-todoist-e5rcSY) ·
  [offline](https://todoist.com/help/articles/use-todoist-while-offline-4rbaZw) ·
  [reminders](https://www.todoist.com/help/articles/introduction-to-reminders-9PezfU) ·
  [calendar](https://www.todoist.com/help/todoist/integrations/use-the-calendar-integration-rCqwLCt3G) ·
  [backups](https://www.todoist.com/help/articles/download-or-restore-backups-in-todoist-ywaJeQbN) ·
  [2026 changelog](https://www.todoist.com/help/todoist/product-updates/2026-changelog-HD3jJAtLd)

### To Do List (Splend Apps)

| #   | SP is           | Why                                                                                                                         |
| --- | --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | Worse on phones | Voice entry, quick add from the notification bar, batch add, clipboard capture. Some 2026 reviews say 5.x removed quick add |
| 2   | Better, by far  | Lists only; no documented subtasks, priorities or attachments; no manual reordering                                         |
| 3   | Better          | Repeat rules are undocumented; reviews report finished recurring tasks coming back as overdue                               |
| 4   | Better          | No calendar view; tasks sync with Google Tasks                                                                              |
| 5   | Better, by far  | No planning features                                                                                                        |
| 6   | Tie             | Reminders are read aloud; SP has exact alarms, an alarm style and Done/Snooze actions                                       |
| 7   | Better, by far  | None                                                                                                                        |
| 8   | Better, by far  | None                                                                                                                        |
| 9   | Better          | Lists only                                                                                                                  |
| 10  | —               | None                                                                                                                        |
| 11  | Better          | Basic notes                                                                                                                 |
| 12  | Tie             | Neither has collaboration                                                                                                   |
| 13  | Better, by far  | None                                                                                                                        |
| 14  | Tie             | Two-way Google Tasks sync                                                                                                   |
| 15  | Better          | None                                                                                                                        |
| 16  | Better          | Android only. Two widgets (a counter and a list) against SP's one                                                           |
| 17  | Worse           | Simple and single-purpose. 2026 reviews complain about ads and glitches since 5.x                                           |
| 18  | Mixed           | Google Tasks sync needs no setup on Android; SP syncs across every platform but asks you to pick a provider                 |
| 19  | Better          | Shows ads. Its Data safety label says no data is collected, which is unusual for an ad-supported app (unverified)           |
| 20  | Better          | Free with ads; one-time ad removal (price unverified); included in Play Pass                                                |
| 21  | Tie             | None                                                                                                                        |
| 22  | Better          | Limited theming                                                                                                             |
| 23  | Worse, by far   | Nothing to learn                                                                                                            |

- **Ratings:**
  - Google Play: 4.6 from about 933–960K reviews, 10M+ installs.
  - AppBrain estimates about 41M installs.
- **Developer:** Splend Apps, Poland. Version 5.1.x; listing updated 2026-10-19.
- **Market position:**
  - It has the most reviews of any dedicated to-do app on Play, but every major
    to-do app shows the same 10M+ install badge.
  - Review counts for the others: Google Tasks about 612K, Microsoft To Do about
    470K, Todoist about 265–300K, TickTick about 166K.
  - Google Keep, with 1B+ installs, is larger than all of them.
- **Why it succeeds** (inference):
  - its title is the exact search term
  - about ten years on the store
  - nothing to learn
  - widgets and a notification-bar entry keep it visible
  - free, and cross-promoted from a publisher with about 500M installs
- **Sources** (2026-10, snippet):
  [Play](https://play.google.com/store/apps/details?id=com.splendapps.splendo) ·
  [AppBrain](https://www.appbrain.com/app/to-do-list/com.splendapps.splendo) ·
  [Galaxy Store](https://galaxystore.samsung.com/detail/com.splendapps.splendosum)

## Specialists

Time tracking is split in two, because the specialists beat SP on one half and
lose on the other. "—" means not scored; [README.md](README.md#competitor-set)
says which dimensions each group is scored on.

| #   | Dimension                               | Toggl Track    | Clockify       | Sunsama        | Akiflow        | Motion         | Tasks.org | Vikunja | Things 3       |
| --- | --------------------------------------- | -------------- | -------------- | -------------- | -------------- | -------------- | --------- | ------- | -------------- |
| 4   | Calendar                                | —              | —              | Worse          | Worse          | Worse          | —         | —       | —              |
| 5   | Daily planning and time-blocking        | —              | —              | Worse          | Worse          | Mixed          | —         | —       | —              |
| 7   | Time tracking: tracking tied to tasks   | Better         | Better         | Better         | Better, by far | Better         | Better    | Better  | —              |
| 7   | Time tracking: time entries and editing | Worse          | Worse          | —              | —              | —              | —         | —       | —              |
| 8   | Focus and breaks                        | Better         | Better         | —              | —              | —              | —         | —       | —              |
| 13  | Developer integrations                  | Better         | Better         | Better         | Better         | Better, by far | —         | —       | —              |
| 19  | Offline, privacy, ownership             | Better, by far | Better, by far | Better, by far | Better, by far | Better, by far | Better    | Better  | Better, by far |
| 20  | Price                                   | Better         | Better         | Better, by far | Better, by far | Better, by far | Better    | Better  | Better         |

- **Must be best, not yet met:**
  - **Time entries** (dimension 7): Toggl and Clockify record start and end times
    on every entry and let you fix or add time in a timesheet or calendar (#6378,
    #7888, #7890).
  - **Daily planning** (dimension 5):
    - Sunsama and Akiflow add weekly planning and review rituals, which SP doesn't
      have.
    - All three planners sync calendars both ways with Google, Outlook and iCloud.
      SP does this for Google and CalDAV (iCloud included) through plugins; Outlook
      is read-only.
- **Met:**
  - privacy and price against all eight specialists
  - developer integrations against the five scored on it
  - focus against the time trackers
  - time tracking tied to tasks against the seven scored on it

### Time trackers: Toggl Track, Clockify

- **Toggl Track:**
  - "New Toggl" (formerly Toggl 2.0) became the main product in 2026-09. Classic
    Track continues.
  - Paid Starter is US$9–12 per user per month.
  - No Linux desktop app.
- **Clockify:**
  - The free plan was cut on 2026-04-21: up to 5 users, PDF-only exports, a
    31-day report range, and billable rates and estimates moved to paid plans.
  - Paid plans start at US$3.99 per user per month.
- **Both:**
  - Account required.
  - Neither can run several timers at once, so #5832 is not a gap against them.
- **SP better:**
  - no account
  - tasks with estimates that roll up
  - free worklog upload to Jira, OpenProject, Redmine and GitLab (Toggl's native
    Jira integration needs Premium)
  - free CSV export with chosen columns and rounding
  - Flowtime mode and enforced breaks
  - idle detection on Wayland
- **They are better:**
  - start and end times on every entry, and timesheet and calendar editing
  - automatic tracking of apps, sites and calendar events (SP's alpha App Auto
    Track plugin only suggests a task from the active window)
  - a timer button in about 150 (Toggl) or 100 (Clockify) websites
  - billable rates, for client billing (outside the [target](README.md#target))
  - mature mobile apps
- **Sources** (2026-10, snippet unless marked):
  [Toggl pricing](https://toggl.com/pricing) ·
  [Toggl extension](https://github.com/toggl/track-extension) (read) ·
  [Clockify pricing](https://clockify.me/pricing) ·
  [Clockify free-plan changes](https://clockify.me/help/administration/updates-to-clockify-free-plan) ·
  [Clockify extension](https://github.com/clockify/browser-extension) (read)

### Daily planners: Sunsama, Akiflow, Motion

- **Price** (unverified, sources conflict; none has a free tier):
  - Sunsama: about US$17–22 per month.
  - Akiflow: US$19–34 per month.
  - Motion: US$19–49 per month, with AI credit limits.
- **Sunsama:**
  - Guided daily planning and shutdown, weekly planning and a weekly review.
  - Rule-based auto-scheduling that asks "Overcommitted?" when the day is full.
  - Two-way calendar sync with Google, Outlook and iCloud.
  - Jira status is written back. GitHub is read-only, there is no GitLab, and
    tracked time is not sent back to the source tool.
  - No offline mode.
- **Akiflow:**
  - Universal inbox from Gmail, Slack and Teams.
  - Daily and weekly planning and shutdown rituals.
  - Two-way sync with Jira Cloud and GitHub.
  - No GitLab, no per-task timer, no Linux app.
- **Motion:**
  - Continuous AI auto-scheduling with deadline estimates and overbooking
    warnings.
  - No native developer integrations.
  - Users complain that the plan "keeps reshuffling itself".
- **SP better:**
  - GitLab, Gitea, Redmine, OpenProject and Azure DevOps
  - writes back to GitHub, which Sunsama doesn't
  - worklog upload
  - real time tracking
  - a day-by-day capacity view in the planner
  - free, offline and Linux
- **They are better:**
  - weekly rituals
  - two-way Outlook sync
  - one-key auto-scheduling
  - email and chat as task sources
- **Sources** (2026-10, snippet):
  [Sunsama daily planning](https://help.sunsama.com/docs/daily-planning) ·
  [Sunsama auto-scheduling](https://help.sunsama.com/docs/timeboxing-auto-scheduling) ·
  [Sunsama GitHub](https://help.sunsama.com/docs/github-integration) ·
  [Akiflow rituals](https://akiflow.featurebase.app/en/help/articles/0805246-rituals) ·
  [Akiflow Jira](https://akiflow.featurebase.app/en/changelog/boom-jira-software-cloud-2-ways-sync-integration) ·
  [Motion integrations](https://www.usemotion.com/help/settings/integrations/reference-integrations/native-integrations)

### Privacy-first: Tasks.org, Vikunja, Things 3

- **Tasks.org** (GPL-3.0, Android; desktop alpha since 2026-04):
  - **SP better:**
    - SP has no telemetry in any build. Tasks.org's Play and desktop builds
      include Firebase Crashlytics and PostHog, on by default (read:
      `app/build.gradle.kts`, `Preferences.kt`).
    - Tasks.org Cloud has no end-to-end encryption.
    - On Play, CalDAV sync costs from US$0.99/yr.
  - **Tasks.org better:**
    - Its data is iCalendar, which any CalDAV client opens, with DAVx⁵ and EteSync
      support.
    - Location reminders, widgets, Wear OS, multi-level subtasks, custom filters.
- **Vikunja** (AGPL-3.0, self-hosted):
  - **SP better:**
    - Vikunja is server-first, with no offline mode and no end-to-end encryption.
    - Time tracking needs Pro.
    - The mobile app is alpha.
  - **Vikunja better:**
    - Multi-user self-hosting with a CalDAV endpoint.
    - Full ZIP export including attachments, and a generic CSV importer.
- **Things 3:** Apple only; syncing needs a Things Cloud account without
  end-to-end encryption, and there is no standard export. It is better on native
  polish.
- **Ideas worth checking against the principles:**
  - DAVx⁵ through Android's tasks provider, as Tasks.org does. This is a narrower
    route to #2719 than full two-way CalDAV.
  - A "what syncs on each backend" table in the docs.
  - An Exodus Privacy report for each SP build, as proof that there are no
    trackers.
- **Sources** (2026-10, read unless marked):
  [Tasks.org sync](https://github.com/tasks/docs/blob/main/docs/sync.md) ·
  [Tasks.org build](https://github.com/tasks/tasks/blob/main/app/build.gradle.kts) ·
  [Exodus](https://reports.exodus-privacy.eu.org/en/reports/search/org.tasks/)
  (snippet) ·
  [Vikunja import and export](https://github.com/go-vikunja/website/blob/main/src/content/help/import-and-export.mdx) ·
  [Vikunja pricing](https://github.com/go-vikunja/website/blob/main/src/pages/pricing.astro) ·
  [Things Cloud](https://culturedcode.com/things/support/articles/2803586/)
  (snippet)

## Gaps

Gaps where SP misses its group's bar, in the order the 2026-10 comparison ranked
them; the last three rows were added in review, unranked. Android app-icon
shortcuts (#10971) and dates in the user's language (#10970) shipped in v19.3.0
and their rows were removed. A row is a prompt, not a
plan: it still has to pass
[Does it earn its place?](../feature-review-guide.md#does-it-earn-its-place).
Status values are defined in [README.md](README.md#monthly-refresh) (step 4).

| Gap                                                          | #     | Who has it                                            | Issue                        | Status (2026-10)                                                             |
| ------------------------------------------------------------ | ----- | ----------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------- |
| Sync trust: data-loss reports, whole-dataset conflict dialog | 18    | TickTick, Todoist                                     | #10393 (#7892, #9256 closed) | Partly released v19.3.0 (#10847, #10855); on master (#11120, #11142)         |
| Add a task from the Android widget                           | 1, 16 | TickTick, Todoist, To Do List                         | #5139                        | Draft PR open (#10612, conflicted)                                           |
| Priority in the add-task bar                                 | 1     | Todoist                                               | #10887, #10904               | Partly released v19.3.0 (#10974: `p1`–`p3` syntax only)                      |
| Multiple reminders per task                                  | 6     | TickTick, Todoist                                     | #4331                        | —                                                                            |
| Two-way Outlook sync; creating CalDAV tasks                  | 4     | Todoist, planners (Outlook); Tasks.org (CalDAV tasks) | #5001, #3938, #2719          | Partly released v19.3.0 (#10991, #10989: CalDAV tasks)                       |
| Mobile UI refresh                                            | 17    | TickTick, Todoist                                     | #9225, #4864, #7637          | Partly released v19.3.0 (#10975, #10990, #10992); on master (#11241, #11236) |
| Start and end times per entry, timesheet editing             | 7     | Toggl Track, Clockify                                 | #7888, #7890 (#6378 closed)  | Partly on master (#11181: session start and end go to the calendar only)     |
| Weekly planning and review                                   | 5     | Sunsama, Akiflow                                      | none                         | —                                                                            |
| Nested subtasks                                              | 2     | TickTick, Todoist, Tasks.org                          | #2657                        | —                                                                            |
| iOS home-screen widget                                       | 16    | TickTick, Todoist                                     | #6373                        | —                                                                            |
| Quick add from a notification                                | 1     | To Do List                                            | none                         | —                                                                            |
| Voice capture                                                | 1     | TickTick, Todoist, To Do List                         | none                         | —                                                                            |
| Location reminders                                           | 6     | TickTick, Todoist, Tasks.org                          | #5336                        | Proposal ([plan](../long-term-plans/location-based-reminders.md))            |
| Watch apps                                                   | 16    | TickTick, Todoist, Tasks.org                          | none                         | —                                                                            |
| First run: time to first task, learning curve                | 23    | TickTick, Todoist, To Do List                         | #8824                        | Partly released v19.3.0 (#10913, #10957); on master (#11176)                 |
| Saved filters                                                | 2     | TickTick, Todoist                                     | #10347                       | —                                                                            |
| Focus: strict mode, focus across devices                     | 8     | TickTick                                              | none                         | —                                                                            |

## Speed benchmark

Not measured yet. The jobs are defined in [README.md](README.md#speed-benchmark).
