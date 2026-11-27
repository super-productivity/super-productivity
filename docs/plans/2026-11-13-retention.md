# Retention: find out why people stop using SP, and fix the top causes

> **Status: Planned 2026-11-13.** Investigation and coordination only. Fixes are made in the plans and issues each cause links to, not here.
>
> **Owner / tracking:** Unassigned. Complaints log: [2026-11-13-retention-quit-log.md](2026-11-13-retention-quit-log.md).
>
> **Last verified against the code:** 2026-11-13 (`01149fbae6`)
>
> **Removal condition:** delete once there are three monthly reads (§ 4), and each of the top three causes (§ 3) has a plan, an issue or a recorded decline. Move the routine (§ 5) and the quit log to wherever the maintainer then keeps recurring product reviews.

**Sections:** [1 Scope](#1-scope) · [2 What we know](#2-what-we-know-2026-11-13) · [3 Hypotheses](#3-hypotheses) · [4 Measurement](#4-measurement) · [5 Routine](#5-routine) · [6 Steps](#6-steps) · [7 Decisions](#7-decisions) · [8 Progress](#8-progress)

## The short version

- **We can't measure retention in the app, and won't.** Principle 1 rules out telemetry. Evidence comes from the stores' own statistics, aggregate SuperSync counts, the survey, and public complaints.
- **We're looking for why people leave, not for ways to pull them back.** Principle 3 rules out streaks and nags. The levers are fewer failures, a faster first win, and mobile polish. In the scorecard these are the "Must not lose badly" rows: users who give up there never reach SP's strengths.
- **There's no retention baseline yet.** Play's installed base grows by under half of each month's installs, but that isn't cohort retention. The first read of Play's retention figures is due on 2026-11-16 (§ 4).
- **The two sources point in different directions, and both matter.** In the survey, people in their first month mostly name UI polish and missing features. In 98 public complaints, failures dominate: sync (32), crashes (20), data loss (16), and Android reminders and background timers (12). Few say outright that they quit (4 in the log, 7 in the survey).
- **Every large failure cluster already has active work.** Sync has [make-sync-boring](2026-11-09-make-sync-boring.md). Data loss has the SQLite store. Android reminders got four fixes between 2026-10-30 and 2026-11-09. So the next useful step is to check whether those fixes worked and to walk through the first week (H2, H3), not to write new plans (D2).

## 1. Scope

In scope: why people stop in their first weeks, and why long-time users switch away. Out of scope: re-engagement mechanics, in-app tracking, uninstall surveys that open a URL, and acquisition (owned by the maintainer's private marketing notes).

Every candidate fix still has to pass [Does it earn its place?](../feature-review-guide.md#does-it-earn-its-place). A retention reason doesn't override the product principles.

## 2. What we know (2026-11-13)

**Play installed base** (May–July 2026; the figures are in the maintainer's private marketing notes): active devices grew by well under half of each month's installs. Uninstalls include long-time users, so this is not cohort retention.

**Survey 2026** (241 responses, export rows `Rn` as in [survey-feature-gaps](2026-11-11-survey-feature-gaps.md); answers paraphrased):

- **Seven chose "I stopped using it"** (Q2). Their reasons:
  - sync with a provider other than SuperSync failed or was hard to set up: 2 (CalDAV R46, WebDAV R160);
  - the app didn't fit how they organise: 2 (todo.txt-style contexts and no global task view R71; wanted spaced repetition R116);
  - a missing integration kept them on another app: 1 (TickTick's standalone pomodoro, R28);
  - recurring-task links kept disappearing, and asking for help felt unwelcome: 1 (R186);
  - no reason given: 1 (R11).

  Too few to rank, but it's the only voice of people who left. Raw answers are deleted 30 days after the summary ([survey plan](2026-10-27-user-survey.md)), so the `Rn` references can't be re-checked after that.

- **People in their first month, Q9 "what gets in the way"**: 45 non-empty answers, one category each, hand-coded 2026-11-13. Assigning categories is a judgment call, so read each count as ±3. Two "missing feature" answers are about plugins and attachments not syncing, and could count as sync.

  | Category                  | Answers | Notes                                                                       |
  | ------------------------- | ------: | --------------------------------------------------------------------------- |
  | UI and interaction polish |      18 | 7 mobile-specific (widget ×3, phone layout, slow capture launch, iOS feel)  |
  | Missing feature           |      17 | Smart lists / saved search ×2, undo ×2, attachments and plugins not syncing |
  | Setup and docs            |       3 | Self-host guide, admin rights for install, example setups                   |
  | Sync                      |       1 | Switching devices                                                           |
  | Notifications / noise     |       1 | Idle pop-ups and notifications outside set hours                            |
  | Nothing / personal        |       5 |                                                                             |

- **Biases:** respondents stayed long enough to answer, and 95 of 241 use SuperSync. So the survey explains causes but not how common they are among people who quit early. Q4 (first-week confusion) was already analysed: the feature gaps in [survey-feature-gaps](2026-11-11-survey-feature-gaps.md), the wording in the clarity work.

**Known reliability incidents:**

- Android local data loss without sync, [#7892](https://github.com/super-productivity/super-productivity/issues/7892): cause not proven, closed 2026-10-29.
- Storage hardening, [#7901](https://github.com/super-productivity/super-productivity/issues/7901): fixed by #7924 in v18.9.0.
- Auto Backup can silently exceed its quota, [#9762](https://github.com/super-productivity/super-productivity/issues/9762): **still open**.
- The Nextcloud upload regression: fixed in v18.16.0.

**Public complaints** ([quit log](2026-11-13-retention-quit-log.md), seeded 2026-11-13: 98 rows from GitHub since 2025-11, Play reviews May–October, AlternativeTo):

- **Counts by category:** sync failure 32, crash or performance 20, data loss 16, mobile polish 16 (12 of them reminders, notifications or background timers), first run 8, missing feature 4, other 2. One category per row, but hypotheses overlap: for example, sync bugs that lost data count toward both H1 and H4.
- **Rarely an outright quit:** only 4 rows say the person quit, and 6 say they nearly did. Those are about missing features (batch operations, hourly rates, an all-tasks view), Android notifications, and a first run with no guidance.
- **Biases:** reporters are mostly technical, and searching by keyword over-samples bugs. That's the opposite bias to the survey, which is why the two disagree.
- **Data loss after v18.9.0 continues, on other paths:**
  - adding SuperSync to an existing Android install, #9863 (fixed in v18.22.0 and v19.0.0);
  - Android notes reverting to an old version, #10085, open;
  - snap IndexedDB corruption, #11049, open;
  - Back discarding a running timer (Play review).

  The durable fix, a native SQLite store (#7931, #7956), is still open.

- **Launch failures follow releases:** about 9 of the 20 crash rows are an update that wouldn't start (#6428, #7229, #7518, #7840, #9187, #9271, #9785, #9793, #9799). These were fixed fast, but each one hits everyone who updates that week. The other rows are performance (CPU, load time, input lag).
- **"Closed" isn't always resolved:** on #10781 and #11344, the reporter says it still fails on 19.3.1.

## 3. Hypotheses

Ranked by how many independent sources point to each, how many users it reaches, and whether it certainly ends use. Re-rank at each quarterly review (§ 5).

| #   | Cause                                                              | Evidence so far                                                                                                                                | Owner                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H1  | Local data loss (any path)                                         | 16 log rows; 2 open after v18.9.0 (#10085, #11049); irreversible                                                                               | #7931, #7956 (SQLite store), #9762, #10085, #11049, all open                                                                                                                                                                                                                                                                                                                                                 |
| H7  | Android reminders, notifications and background timers fail        | 12 log rows; open #6832, #10013, #10424, plus #10781 (closed, reporter says still failing on 19.3.1); "Reminders" picked by 2 of 7 who stopped | Fixes land one at a time: #11323, #11364, #11570, #11638 (merged 2026-10-30 to 11-09). Context: [survey-mobile-background-sync](2026-10-28-survey-mobile-background-sync.md), [narrow-mobile-background-sync](2026-10-30-narrow-mobile-background-sync.md), [android-background-sync-improvements](../long-term-plans/android-background-sync-improvements.md). No plan owns reminder reliability end to end |
| H8  | An update breaks launch for everyone on that version               | ~9 launch-failure rows tied to releases (§ 2)                                                                                                  | Release process; check per-version Android vitals monthly (§ 4)                                                                                                                                                                                                                                                                                                                                              |
| H2  | Overwhelm, plus desktop interaction friction, in the first week    | Reviews, #9225, survey Q4, 11 desktop/general Q9 answers                                                                                       | [onboarding-next-steps](2026-10-27-onboarding-next-steps.md)                                                                                                                                                                                                                                                                                                                                                 |
| H3  | Mobile polish: widget, capture speed, layout                       | 7 new-user Q9 answers, scorecard rows 1 and "Mobile polish"                                                                                    | [android-share-capture](2026-10-24-android-share-capture.md), [mobile-dialog-autofocus](2026-11-01-mobile-dialog-autofocus.md); no widget plan                                                                                                                                                                                                                                                               |
| H4  | Sync fails, silently diverges, or is hard to set up                | 32 log rows (7 open), 2 of 7 who stopped, Q3b                                                                                                  | [make-sync-boring](2026-11-09-make-sync-boring.md), [survey-mobile-background-sync](2026-10-28-survey-mobile-background-sync.md)                                                                                                                                                                                                                                                                             |
| H5  | The app doesn't fit how the user organises (contexts, smart lists) | 2 of 7 who stopped, 2 Q9 answers                                                                                                               | [survey-feature-gaps](2026-11-11-survey-feature-gaps.md); much is outside product scope                                                                                                                                                                                                                                                                                                                      |
| H6  | A support exchange that feels dismissive                           | 1 answer (R186)                                                                                                                                | Note only, until a second source appears                                                                                                                                                                                                                                                                                                                                                                     |

## 4. Measurement

| Signal                                                                                       | Covers                            | Who / when                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Play Console **Statistics** and **Grow users**: first opens, MAU, user loss, 7-day retention | Android                           | Monthly, owned by the marketing growth plan, step 3. First read 2026-11-16. Record which retention reports Play actually offers (per release? D30?) before relying on them |
| Android vitals: crashes and ANRs per app version                                             | Android stability                 | Same monthly read                                                                                                                                                          |
| SuperSync activity snapshot (query below)                                                    | SuperSync users on any platform   | Monthly, after decision D1                                                                                                                                                 |
| Quit log                                                                                     | All platforms, people who say why | Monthly append, quarterly count                                                                                                                                            |
| Desktop and web without sync                                                                 | Invisible                         | Accepted blind spot. Don't guess                                                                                                                                           |

**SuperSync snapshot.** The server keeps no history of activity. `sync_devices.last_seen_at` (epoch ms) records the device's last contact of any kind: upload, download, or the heartbeat on an open WebSocket (`device.service.ts` `touchDevice`, `sync.routes.ts`, `server.ts`). The daily cleanup deletes devices unseen for 45 days (`RETENTION_DAYS`). So we can't reconstruct "still syncing on day 90" for past cohorts. What we can count, each month, is the share of each signup month's accounts seen in the last 30 days. Read across months, that is a survival curve. Read-only, aggregate output only:

```sql
SELECT date_trunc('month', u.created_at) AS signup_month,
       count(*) AS accounts,
       count(*) FILTER (
         WHERE d.last_seen >= (extract(epoch FROM now() - interval '30 days') * 1000)
       ) AS seen_last_30d
FROM users u
LEFT JOIN (SELECT user_id, max(last_seen_at) AS last_seen
           FROM sync_devices GROUP BY user_id) d ON d.user_id = u.id
WHERE u.is_verified = 1
GROUP BY 1
ORDER BY 1;
```

Caveats:

- **Reads high:** deleted accounts drop out of their cohort, and an app left open with a live WebSocket counts as seen even when nobody uses it.
- **Reads low:** accounts that registered but never synced have no device row, so they count as gone.
- **How to read it:** compare months with each other, not with other apps.

## 5. Routine

- **Monthly**, together with the marketing repo's monthly review on the first working day, about 15 extra minutes:
  - Play figures (already part of that review);
  - the SuperSync snapshot, once D1 is decided;
  - append new reports from issues, reviews and Discussions to the quit log.
- **Quarterly:** count the quit log by category and signal, re-rank § 3, and pick at most three causes to work on. Each must get a plan, an issue or a recorded decline.
- **After a fix ships:** compare the next two monthly reads with the ones before. At a few thousand Play installs a month, one month's 7-day figure is noisy. Treat it as a rough signal, not proof.

Rules for the log: one row per report or thread, with a category, a link and a signal (explicit quit, almost quit, failure only). Paraphrase private Play review text and never quote it, like the survey.

## 6. Steps

1. Seed the quit log from GitHub, the Play exports and AlternativeTo → verify: the log exists with sourced rows and per-category counts. **Done 2026-11-13** (98 rows). The App Store page and Reddit couldn't be reached; add them by hand from a normal browser.
2. Play baseline (2026-11-16, marketing TODO) → verify: May–October figures saved in the private marketing notes, and § 2 says what they show (no raw figures in this public repo).
3. Decide D1, then run the SuperSync snapshot → verify: first row in § 8.
4. Walk through the first week on a real Android phone and the Electron build (the onboarding plan's step 1 covered only the first minute, emulated): install, first task, SuperSync and WebDAV setup, import from Todoist/TickTick, widget, coming back on day 2 → verify: a findings list in § 8, and an issue for each defect that reproduces.
5. Rank, and choose at most three causes → verify: § 3 updated, and each chosen cause linked to a plan or issue.

Deferred until steps 2–4 show whether they're worth it: interviewing people who stopped (Discussions and Reddit mostly reach people still using the app), and an optional "why are you leaving?" field when deleting a SuperSync account (few people delete an account; most just stop syncing).

## 7. Decisions

- **D1, SuperSync aggregate counts (open).** The [SuperSync privacy policy](../../packages/super-sync-server/templates/privacy.template.html) names legitimate interest for security, error analysis and stability, and "aggregate counting of AI assistant connections". It doesn't name aggregate account-activity counts. The inventory data does list registration date and account status (Active, Inactive). The AI counting is described as "a manual database query" keeping only non-identifying totals, the same framing this query would use. The "no analytics services" line is in the cookies and tracking section, which is about the web pages. Recommendation: add one sentence in the same style as the AI counting (accounts per signup month and how many were seen in the last 30 days, totals only, to size and maintain the service) before running the query.
- **D2, first cause to work on (open).** Recommendation: no new plan yet. Every large cluster already has active work (H1, H4, H7). The cheap next step is to check whether that work fixed things:
  - ask the reporters on #6832, #10013, #10424 and #10781 to retest on the latest version;
  - include reminders in the first-week walkthrough on a real phone (step 4).

  Write a reminder-reliability plan only if reminders still fail after that. Choose at step 5, once the Play baseline and the walkthrough are in. H2 and H3, the friction new users name most, may then rank higher than the failures.

## 8. Progress

| Date       | What                                                                                                                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-13 | Plan written; survey stopped-user and first-month Q9 answers hand-coded; quit log seeded                                                                                                                          |
| 2026-11-13 | Adversarial review. Fixed: SuperSync query semantics (`last_seen_at` = any contact); H7 is not ownerless (4 merged reminder PRs), so D2 now says verify those fixes first; discussion states; H8 evidence; counts |
