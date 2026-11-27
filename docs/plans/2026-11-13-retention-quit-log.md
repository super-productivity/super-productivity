# Retention quit log

Public reports of people stopping, nearly stopping, or hitting a failure that would plausibly make a typical user quit. This log belongs to the [retention plan](2026-11-13-retention.md), which owns the method and the conclusions. Append monthly; count quarterly.

**Rules:**

- One row per thread or review.
- One category per row.
- Signal is E (said they quit), A (said they nearly quit or called it a deal-breaker) or F (failure only). F is the logger's judgment, not stated intent.
- Play reviews are paraphrased; no names or quotes.
- State is as of the seed date, taken from maintainer comments rather than changelogs.

**Seed: 2026-11-13.** Sources:

- GitHub issues and discussions since 2025-11, found by keyword search. Recall on non-sync, non-crash complaints is probably low.
- The Play exports for 2026-05 to 2026-10, plus one 2025-09 review from an older export. Ten text-less reviews were skipped.

"Closed" means closed on GitHub. Where the reporter says it still fails, the row says so. For discussions, "maintainer replied" and "community replied" mean someone answered; "no human reply" means only a bot touched the thread.

- AlternativeTo: only 7 of 102 comments were visible.
- Not reached: the App Store page (404), Reddit (blocked from the agent environment), blogs.

Issue links: `#n` = issue, `D#n` = discussion.

## Counts (seed)

| Category              |     E |     A |      F |  Total |
| --------------------- | ----: | ----: | -----: | -----: |
| Sync failure          |     0 |     2 |     30 |     32 |
| Performance / crash   |     0 |     0 |     20 |     20 |
| Data loss             |     0 |     1 |     15 |     16 |
| Mobile polish         |     1 |     1 |     14 |     16 |
| First run / overwhelm |     1 |     0 |      7 |      8 |
| Missing feature       |     2 |     2 |      0 |      4 |
| Other                 |     0 |     0 |      2 |      2 |
| **Total**             | **4** | **6** | **88** | **98** |

Of the 16 mobile-polish rows, 12 are Android reminders, notifications or background timers.

## Data loss

| Date       | Source                                                                              | Platform      | Report                                                                      | Sig | State                                  |
| ---------- | ----------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------- | --- | -------------------------------------- |
| 2025-11-19 | [#5550](https://github.com/super-productivity/super-productivity/issues/5550)       | macOS         | All tasks and time records gone after an update                             | F   | closed                                 |
| 2026-02-14 | [#6524](https://github.com/super-productivity/super-productivity/issues/6524)       | desktop       | Task with subtasks missing after restart                                    | F   | closed, not planned                    |
| 2026-02-22 | [#6608](https://github.com/super-productivity/super-productivity/issues/6608)       | Android       | Tasks wiped twice after importing ~40 from TickTick, Dropbox on             | F   | closed                                 |
| 2026-04-24 | [#7345](https://github.com/super-productivity/super-productivity/issues/7345)       | Windows       | "Auto-fix" after a crash wiped everything (very old version)                | F   | closed                                 |
| 2026-04-27 | [#7390](https://github.com/super-productivity/super-productivity/issues/7390)       | Android       | Tracked time lost when the app was refocused                                | F   | closed                                 |
| 2026-05    | Play review                                                                         | Android       | Used it 3 days, woke to an empty app; deal-breaker unless recoverable       | A   | —                                      |
| 2026-05-31 | [#7892](https://github.com/super-productivity/super-productivity/issues/7892)       | Android       | All tasks and history gone overnight while evaluating, no sync              | F   | closed; SQLite store #7931, #7956 open |
| 2026-06-22 | [#8540](https://github.com/super-productivity/super-productivity/issues/8540)       | Linux         | "No data found" dialog froze and crashed                                    | F   | fixed v18.13.0                         |
| 2026-07-11 | [#8932](https://github.com/super-productivity/super-productivity/issues/8932)       | desktop       | Unsaved project-note edits lost on exit                                     | F   | closed (auto-save)                     |
| 2026-07-20 | [#9209](https://github.com/super-productivity/super-productivity/issues/9209)       | Windows Store | Note edit lost; backups not where the UI said                               | F   | closed                                 |
| 2026-09-02 | [#9863](https://github.com/super-productivity/super-productivity/issues/9863)       | Android, web  | Existing Android tasks vanished after adding SuperSync                      | F   | fixed v18.22.0 / v19.0.0               |
| 2026-09    | Play review                                                                         | Android       | Long-running timer discarded by Back with no warning; most of the time lost | F   | —                                      |
| 2026-09-06 | [#9946](https://github.com/super-productivity/super-productivity/issues/9946)       | Linux         | Code report: missing task id deletes all top-level tasks                    | F   | closed                                 |
| 2026-09-08 | [D#9965](https://github.com/super-productivity/super-productivity/discussions/9965) | —             | Board, tags and probably tasks gone after two good weeks                    | F   | maintainer replied (recovery steps)    |
| 2026-09-12 | [#10085](https://github.com/super-productivity/super-productivity/issues/10085)     | Android       | Task notes silently reverted to a days-old version                          | F   | **open**                               |
| 2026-10-22 | [#11049](https://github.com/super-productivity/super-productivity/issues/11049)     | Linux snap    | All data gone after restart, IndexedDB checksum corruption                  | F   | **open** (backup path fixed v19.3.0)   |

## Sync failure

| Date       | Source                                                                              | Platform          | Report                                                                | Sig | State                                           |
| ---------- | ----------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------- | --- | ----------------------------------------------- |
| 2025-11-29 | [D#5601](https://github.com/super-productivity/super-productivity/discussions/5601) | desktop           | Lost data on one PC, can't reconnect WebDAV                           | F   | maintainer replied                              |
| 2026-01-25 | [#6174](https://github.com/super-productivity/super-productivity/issues/6174)       | Android, snap     | v16 and v17 devices can't sync                                        | F   | closed, not planned                             |
| 2026-01-28 | [#6236](https://github.com/super-productivity/super-productivity/issues/6236)       | Android           | Can't reset or re-enable Dropbox, 400 errors                          | F   | closed                                          |
| 2026-01-28 | [D#6234](https://github.com/super-productivity/super-productivity/discussions/6234) | Android           | Phone desynced from Dropbox; reconnect fails with invalid JSON        | F   | maintainer replied                              |
| 2026-01-29 | [#6262](https://github.com/super-productivity/super-productivity/issues/6262)       | multi             | Random WebDAV loss; gave up on sync, wiped and re-synced              | F   | closed                                          |
| 2026-02-06 | [#6387](https://github.com/super-productivity/super-productivity/issues/6387)       | PC, phone         | Tasks disappeared after resync                                        | F   | closed                                          |
| 2026-02-06 | [#6397](https://github.com/super-productivity/super-productivity/issues/6397)       | multi             | One machine lost many tasks, Dropbox                                  | F   | closed                                          |
| 2026-02-09 | [D#6448](https://github.com/super-productivity/super-productivity/discussions/6448) | Mac, iOS          | Dropbox auto-resolves conflicts wrongly                               | F   | answered                                        |
| 2026-02-22 | [#6601](https://github.com/super-productivity/super-productivity/issues/6601)       | Win, Linux        | Auto conflict resolution resurrects deleted tasks                     | F   | **open**                                        |
| 2026-03-28 | [#6992](https://github.com/super-productivity/super-productivity/issues/6992)       | Flatpak, Android  | Devices say "in sync" but differ                                      | F   | **open** (partial v18.1.0)                      |
| 2026-04-05 | [#7144](https://github.com/super-productivity/super-productivity/issues/7144)       | iOS               | Losing data on each sync                                              | F   | closed (fixes to v18.7.0)                       |
| 2026-04-22 | [#7330](https://github.com/super-productivity/super-productivity/issues/7330)       | Windows           | Conflict error after hibernate                                        | F   | **open** (reopened)                             |
| 2026-04-23 | [#7339](https://github.com/super-productivity/super-productivity/issues/7339)       | iOS               | Phantom Dropbox conflicts while on WebDAV                             | F   | **open** (reopened)                             |
| 2026-04-26 | [#7372](https://github.com/super-productivity/super-productivity/issues/7372)       | Android           | Nextcloud not working (legacy Android mode)                           | F   | closed                                          |
| 2026-05-05 | [#7489](https://github.com/super-productivity/super-productivity/issues/7489)       | Win, phone        | Repeated "data damage" warnings after phone edits                     | F   | closed                                          |
| 2026-05-12 | [#7562](https://github.com/super-productivity/super-productivity/issues/7562)       | phone, laptop     | Sync timeouts; phone overwrites laptop                                | F   | closed                                          |
| 2026-05-15 | [#7616](https://github.com/super-productivity/super-productivity/issues/7616)       | desktop           | 18.5.0 upgrade broke WebDAV; would probably have moved to another app | A   | closed (same reporter as #7617)                 |
| 2026-05-15 | [#7617](https://github.com/super-productivity/super-productivity/issues/7617)       | Android, desktop  | Can't set up Nextcloud; "about to give up"                            | A   | closed; a user reports it unresolved afterwards |
| 2026-06-12 | [D#8294](https://github.com/super-productivity/super-productivity/discussions/8294) | Android 16        | Dropbox "syncs" but data doesn't appear elsewhere                     | F   | maintainer replied; reporter resolved           |
| 2026-07    | Play review                                                                         | Android           | Nextcloud stopped after an update; Linux still fine (matches #9196)   | F   | fixed v18.16.0                                  |
| 2026-07-18 | [#9154](https://github.com/super-productivity/super-productivity/issues/9154)       | iOS               | WebDAV/Nextcloud upload fails with 412                                | F   | closed                                          |
| 2026-07-20 | [#9196](https://github.com/super-productivity/super-productivity/issues/9196)       | PWA, Android      | Nextcloud only updates the .bak file                                  | F   | closed                                          |
| 2026-07-23 | [#9256](https://github.com/super-productivity/super-productivity/issues/9256)       | desktop           | Fresh install can't recover SuperSync data                            | F   | closed                                          |
| 2026-07-27 | [#9332](https://github.com/super-productivity/super-productivity/issues/9332)       | Win, Android, iOS | SuperSync password change led to an auth loop                         | F   | closed                                          |
| 2026-07-31 | [#9405](https://github.com/super-productivity/super-productivity/issues/9405)       | Android           | Unresolvable WebDAV conflict after bulk plan-for-today                | F   | closed                                          |
| 2026-08-10 | [#9537](https://github.com/super-productivity/super-productivity/issues/9537)       | Win, Android      | Sync stuck after "End of day" archive                                 | F   | closed                                          |
| 2026-09-13 | [#10102](https://github.com/super-productivity/super-productivity/issues/10102)     | Android           | Sync error on every retry                                             | F   | closed                                          |
| 2026-09-30 | [#10403](https://github.com/super-productivity/super-productivity/issues/10403)     | macOS, iOS        | Encryption password loop                                              | F   | **open**                                        |
| 2026-10-18 | [#10916](https://github.com/super-productivity/super-productivity/issues/10916)     | Mac, Android      | Phone tasks missing on Mac and deleted from phone                     | F   | closed (v19.3.1)                                |
| 2026-10-27 | [#11184](https://github.com/super-productivity/super-productivity/issues/11184)     | iOS               | Completed tasks stay pending, no error                                | F   | **open**                                        |
| 2026-10-30 | [#11344](https://github.com/super-productivity/super-productivity/issues/11344)     | Android           | Server-migration snapshot rejected; still failing on 19.3.1 per user  | F   | closed, not resolved per reporter               |
| 2026-11-10 | [#11645](https://github.com/super-productivity/super-productivity/issues/11645)     | Win, phone        | Recurring-task edits overwritten between devices                      | F   | **open**                                        |

## Performance / crash

| Date       | Source                                                                        | Platform         | Report                                                  | Sig | State             |
| ---------- | ----------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------- | --- | ----------------- |
| 2025-12-20 | [#5771](https://github.com/super-productivity/super-productivity/issues/5771) | desktop          | Won't open (JSON error), reinstall didn't help          | F   | closed            |
| 2026-01-03 | [#5868](https://github.com/super-productivity/super-productivity/issues/5868) | desktop, Android | ~30 s load time                                         | F   | closed            |
| 2026-01-21 | [#6076](https://github.com/super-productivity/super-productivity/issues/6076) | Linux            | High CPU in focus mode                                  | F   | closed            |
| 2026-02-08 | [#6428](https://github.com/super-productivity/super-productivity/issues/6428) | Flatpak          | v16→v17 migration failed                                | F   | closed            |
| 2026-02-19 | [#6576](https://github.com/super-productivity/super-productivity/issues/6576) | mobile           | Freezes on completing tasks                             | F   | closed            |
| 2026-04-14 | [#7229](https://github.com/super-productivity/super-productivity/issues/7229) | Android          | WebView version check blocks launch                     | F   | closed            |
| 2026-04-15 | [#7234](https://github.com/super-productivity/super-productivity/issues/7234) | Linux snap       | "Data damage" popup on every start, slow add-task       | F   | closed            |
| 2026-05-06 | [#7500](https://github.com/super-productivity/super-productivity/issues/7500) | Linux            | Excessive CPU                                           | F   | closed            |
| 2026-05-07 | [#7518](https://github.com/super-productivity/super-productivity/issues/7518) | Android          | Bogus "WebView too old" block; data lost after rollback | F   | closed            |
| 2026-05-24 | [#7771](https://github.com/super-productivity/super-productivity/issues/7771) | Debian           | Freezes within 10 s of launch                           | F   | closed            |
| 2026-05-28 | [#7840](https://github.com/super-productivity/super-productivity/issues/7840) | Android          | WebView init failure after reboot                       | F   | closed            |
| 2026-06    | Play review                                                                   | Android          | Pomodoro throws errors since last update                | F   | —                 |
| 2026-07-04 | [#8777](https://github.com/super-productivity/super-productivity/issues/8777) | Linux, Mac       | Freezes when adding Google Calendar                     | F   | closed            |
| 2026-07-20 | [#9187](https://github.com/super-productivity/super-productivity/issues/9187) | Windows          | Can't open after update (DB version guard)              | F   | closed (v18.16.0) |
| 2026-07-23 | [#9271](https://github.com/super-productivity/super-productivity/issues/9271) | macOS            | "Failed to load data" after update                      | F   | closed (v18.15.1) |
| 2026-08-28 | [#9779](https://github.com/super-productivity/super-productivity/issues/9779) | iOS              | Task input lag, "quite unusable"                        | F   | closed            |
| 2026-08-28 | [#9785](https://github.com/super-productivity/super-productivity/issues/9785) | Android 15       | Crash on open after 18.21.0                             | F   | closed            |
| 2026-08-29 | [#9793](https://github.com/super-productivity/super-productivity/issues/9793) | Android          | Crash on startup after 18.21.0                          | F   | fixed 18.21.1     |
| 2026-08-29 | [#9799](https://github.com/super-productivity/super-productivity/issues/9799) | Android          | Closes immediately; uninstalled and lost data           | F   | closed            |
| 2026-09    | Play review                                                                   | Android          | Slow, non-native app                                    | F   | —                 |

## Mobile polish

| Date       | Source                                                                              | Platform | Report                                                                                | Sig | State                             |
| ---------- | ----------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------- | --- | --------------------------------- |
| 2025-09    | Play review (older export)                                                          | Android  | No working notifications, recurring tasks need a restart, no widget; stopped using it | E   | —                                 |
| 2026-03-14 | [#6832](https://github.com/super-productivity/super-productivity/issues/6832)       | Android  | Reminders only fire if the app was opened recently                                    | F   | **open** (partial v19.3.0)        |
| 2026-04-29 | [#7408](https://github.com/super-productivity/super-productivity/issues/7408)       | Android  | Can't enable notifications                                                            | F   | closed                            |
| 2026-05    | Play review                                                                         | Android  | Settings menu off-screen in one theme                                                 | F   | —                                 |
| 2026-05    | Play review                                                                         | Android  | Desktop-only settings shown on the phone; deal-breaker                                | A   | —                                 |
| 2026-05-10 | [D#7545](https://github.com/super-productivity/super-productivity/discussions/7545) | Android  | Repeating in-app reminders; turning them off also removed Android notifications       | F   | no human reply (stale-bot closed) |
| 2026-05-27 | [#7818](https://github.com/super-productivity/super-productivity/issues/7818)       | Android  | Timer and Pomodoro reset when the app leaves recents                                  | F   | closed (v18.8/18.9)               |
| 2026-06    | Play review                                                                         | Android  | UI rendered outside the screen                                                        | F   | —                                 |
| 2026-06-10 | [#8243](https://github.com/super-productivity/super-productivity/issues/8243)       | Android  | Battery drain (user: still on 18.13.1)                                                | F   | closed                            |
| 2026-09    | Play review                                                                         | Android  | Notifications barely work despite permissions                                         | F   | —                                 |
| 2026-09    | Play review                                                                         | Android  | No push notifications on any of their phones                                          | F   | —                                 |
| 2026-09-10 | [#10013](https://github.com/super-productivity/super-productivity/issues/10013)     | Android  | Reminders missing or delayed                                                          | F   | **open**                          |
| 2026-09-25 | [#10261](https://github.com/super-productivity/super-productivity/issues/10261)     | Android  | Pomodoro time dropped in background                                                   | F   | closed                            |
| 2026-10    | Play review                                                                         | Android  | Pomodoro resets when switching apps, time not recorded                                | F   | —                                 |
| 2026-10-01 | [#10424](https://github.com/super-productivity/super-productivity/issues/10424)     | Android  | No reminders outside the app (Android 16)                                             | F   | **open**                          |
| 2026-10-12 | [#10781](https://github.com/super-productivity/super-productivity/issues/10781)     | Android  | Daily reminder only after opening the app; user: still on 19.3.1                      | F   | closed, not resolved per reporter |

## First run / overwhelm

| Date       | Source                                                                                | Platform | Report                                                              | Sig | State                            |
| ---------- | ------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------- | --- | -------------------------------- |
| 2025-11-29 | [D#5597](https://github.com/super-productivity/super-productivity/discussions/5597)   | desktop  | Unclear how iCal import fits a workflow                             | F   | maintainer and community replied |
| 2026-03-18 | [D#6867](https://github.com/super-productivity/super-productivity/discussions/6867)   | desktop  | Confused where Jira issues appear                                   | F   | answered                         |
| 2026-04-03 | [D#7119](https://github.com/super-productivity/super-productivity/discussions/7119)   | desktop  | Schedule timebox behaviour confusing                                | F   | no human reply                   |
| 2026-05    | Play review                                                                           | Android  | Many menus, no instructions, archive not found; uninstalled at once | E   | —                                |
| 2026-06-11 | [#8267](https://github.com/super-productivity/super-productivity/issues/8267)         | all      | UI distracting and overwhelming; simplify task creation             | F   | **open**                         |
| 2026-07-21 | [#9225](https://github.com/super-productivity/super-productivity/issues/9225)         | Android  | Mobile UI clunky, hard to read, buttons everywhere                  | F   | **open**                         |
| 2026-08-28 | [#9770](https://github.com/super-productivity/super-productivity/issues/9770)         | Windows  | New install shows "Failed to load data"                             | F   | closed                           |
| 2026-11-10 | [D#11666](https://github.com/super-productivity/super-productivity/discussions/11666) | web      | Thought it was local-only; no automatic local backup found          | F   | community replied                |

## Missing feature

| Date       | Source                                                                              | Platform | Report                                                        | Sig | State    |
| ---------- | ----------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------- | --- | -------- |
| 2025-12-15 | [#5737](https://github.com/super-productivity/super-productivity/issues/5737)       | desktop  | Simple Pomodoro-with-tracking flow removed; near deal-breaker | A   | closed   |
| 2026-01-25 | [D#6168](https://github.com/super-productivity/super-productivity/discussions/6168) | desktop  | Needed hourly-rate costing; moved to another app              | E   | answered |
| 2026-03-03 | [#6717](https://github.com/super-productivity/super-productivity/issues/6717)       | desktop  | No all-tasks view; deal-breaker for switching from tasks.org  | A   | **open** |
| 2026-03-31 | [#7058](https://github.com/super-productivity/super-productivity/issues/7058)       | desktop  | No batch operations, "the only reason" a commenter quit       | E   | closed   |

## Other

| Date       | Source                                                                        | Platform | Report                                                    | Sig | State  |
| ---------- | ----------------------------------------------------------------------------- | -------- | --------------------------------------------------------- | --- | ------ |
| 2026-06-14 | [#8391](https://github.com/super-productivity/super-productivity/issues/8391) | Android  | Pomodoro break broke after update                         | F   | closed |
| 2026-10-25 | AlternativeTo guest comment                                                   | web      | Dismissed as low quality and AI-written; no failure named | F   | —      |
