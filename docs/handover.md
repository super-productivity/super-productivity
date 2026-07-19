# Handover: ISO 8601 "spelled-out date names leak Swedish" work

_Last updated: 2026-07-16. This document hands off two related, in-flight pieces of
work to a fresh agent with no prior context._

## TL;DR

Super Productivity's **ISO 8601 date-format option** stores `dateTimeLocale = 'sv'`
as a **backward-compatible sync sentinel** (it yields `YYYY-MM-DD` + a 24h clock).
Any code that renders **spelled-out** weekday/month names (e.g. `Wed`, `July`) using
that configured locale therefore prints them in **Swedish** (`ons`, `juli`),
regardless of the app's UI language. The correct behavior: **spelled-out names follow
the UI language; numeric dates and clock times keep the configured locale** (so ISO
stays `YYYY-MM-DD` and 24h is preserved).

There are two branches:

| Branch | PR | Scope | State |
| --- | --- | --- | --- |
| `feat/https-github-com-super-productivity-su-726a40` | **#9055** | Recurring-task cluster (start-date value, quick-setting weekday, repeat-info util, add-task-bar chips) | Pushed, browser-verified, **awaiting CI + merge** |
| `fix/iso-spelled-out-date-leaks` (**current**) | not opened yet | 5 more leak sites found during #9055 verification | Committed locally, **needs push + PR + verify** |

## Background: the fix chain

- **#8991 (merged, issue #8987):** localized ISO weekday labels only in the _custom_
  Schedule/Habits/Planner components, via `DateTimeFormatService.isoTextLocale()`.
- **#9013 (merged):** fixed the Material `<mat-calendar>` app-wide by overriding
  `CustomDateAdapter.getDayOfWeekNames/getMonthNames/format` to swap to `isoTextLocale()`.
- **#9055 (open):** this session's first PR — the recurring-task dialog + add-task-bar.
- **This branch:** the remaining spelled-out leaks found by browser-testing #9055.

## Key `DateTimeFormatService` API (in `src/app/core/date-time-format/`)

- `currentLocale()` → the configured locale (the `sv` sentinel under ISO). Use for
  **numeric** dates and clock times.
- `isoTextLocale()` → `string | null`. Returns the **UI language** _only when the ISO
  (`sv`) option is active_, else `null`. This is the shared primitive (on master).
- `textLocale()` → `isoTextLocale() ?? currentLocale()`. **Added by #9055, NOT on master.**
  It is the canonical "spelled-out names" locale.

**Why this branch inlines `isoTextLocale() ?? currentLocale()` instead of using
`textLocale()`:** `textLocale` only exists on the #9055 branch. To keep this PR
**independent and conflict-free** with #9055 (no shared files, no `DateTimeFormatService`
change, mergeable in any order), it inlines the same expression — consistent with how
#8991/#9013 already inline `isoTextLocale` checks. After both merge, these inline
expressions _could_ be simplified to `textLocale()`, but that is optional cleanup.

## This branch's 5 fixes (`fix/iso-spelled-out-date-leaks`, based on `master`)

All follow the rule **spelled-out → UI language (`isoTextLocale() ?? currentLocale()`);
numeric → `currentLocale()`**:

1. **`src/app/pages/scheduled-list-page/scheduled-list-page.component.ts`** — the `locale`
   signal now prefers `isoTextLocale()`. All 6 `localeDate` usages in its template are
   spelled-out (`EE, d MMM`), so this one change fixes all of them. _This is the leak that
   was reproduced on screen: "ons, 15 juli" under German UI._
2. **`.../metric/dialog-focus-session-edit/dialog-focus-session-edit.component.ts`** —
   `formatSelectedDate()` (weekday `long` + month `long`) → UI language.
3. **`.../simple-counter/habit-tracker/habit-tracker.component.ts`** — `dateRangeLabel`
   (month `short`) → UI language. (The habit-tracker weekday _column_ was already guarded
   by #8991; only this range label leaked.)
4. **`src/app/ui/pipes/scheduled-date-group.pipe.ts`** — work-view group-header `[title]`
   tooltip (weekday `short` + numeric). Low-visibility; applies UI language to the whole
   compact formatter (documented tradeoff: the numeric part also follows UI language here
   rather than splitting and losing the locale-native separator).
5. **`src/app/features/worklog/worklog.service.ts`** — passes UI language into
   `mapArchiveToWorklog` → `formatDayStr` (weekday `short` worklog day headers). Verified
   that `locale` param feeds _only_ the spelled-out weekday there.

Spec mocks updated so the new `isoTextLocale()` calls don't throw
(`TypeError: isoTextLocale is not a function`): `scheduled-date-group.pipe.spec.ts` (+ a new
ISO regression test) and `worklog.service.spec.ts`. The habit-tracker spec already mocked
`isoTextLocale`.

**NOT leaks (verified guarded / different mechanism — do not touch):** habit-tracker weekday
column, planner-day `dayLabel`, schedule-week/month (all `isoTextLocale`-guarded); the
`formatMonthDay`-based pipes (`short-planned-at`, `local-date-str`, `short-date2`) and the
focus-session chart label are numeric; `planner-calendar-nav` uses the **browser** locale
(`toLocaleDateString(undefined, …)`) — a separate, pre-existing, non-`sv` concern.

## How the audit was done (repeat it if you suspect more leaks)

A single-line `grep toLocaleDateString … currentLocale` is **insufficient** — leaks hide
behind the `localeDate` pipe, multi-line `Intl.DateTimeFormat(locale, …)` where `locale`
is assigned earlier, and util indirection (`formatDayStr`, `getWeekdaysMin`). Search
instead for the **spelled-out format tokens** and then trace the locale source:

```bash
# spelled-out Intl options in .ts
grep -rEn "weekday: *'(long|short|narrow)'|month: *'(long|short|narrow)'" src/app --include='*.ts' | grep -v spec
# spelled-out localeDate pipe usages in templates (E / MMM / EEEE / MMMM)
grep -rEn "localeDate: *'[^']*(E|MMM)" src/app --include='*.html'
```

For each hit, confirm whether the locale is `isoTextLocale()`-guarded (safe), the browser
default `undefined` (separate concern), or raw `currentLocale()`/`locale()` (a leak).

## Verification status

- **#9055 (branch `feat/https-…-726a40`):** browser-verified against the Cloudflare PR
  preview — recur dialog start-date value shows French `mer. 15 juil. 2026` / German
  `Mi., 15. Juli 2026` (not Swedish), and the quick-setting dropdown shows German
  `Jede Woche am Mittwoch`. Unit tests green; awaiting CI + merge.
- **This branch:** unit-tested (`scheduled-date-group.pipe` 15 incl. new ISO test;
  `habit-tracker` 4; `worklog.service` 4). **Not yet browser-verified.** No dedicated spec
  for `scheduled-list-page` (routed page, heavy TestBed); rely on browser verification.

## What's left (do these)

1. **Push this branch and open the PR** (base `master`):
   ```bash
   # push is blocked in the sandbox; the user runs it via the `! ` prefix:
   ! git push -u origin fix/iso-spelled-out-date-leaks
   gh pr create --repo super-productivity/super-productivity --base master \
     --head fix/iso-spelled-out-date-leaks \
     --title "fix(locale): localize remaining ISO 8601 spelled-out date names (#8987)" \
     --body-file <a body summarizing the 5 sites>
   ```
2. **Browser-verify this branch** on its fresh Cloudflare preview (URL is posted as a PR
   comment ~1-2 min after push): Settings → Datetime format = **ISO 8601**, Language =
   **Deutsch**; then check (a) the **"Wiederkehrend"** page (`/#/scheduled-list`) date labels
   read German `Mi., 15. Juli` not `ons, 15 juli`; (b) habit-tracker range label; (c) a
   focus-session-edit dialog date; (d) worklog day headers.
3. **Merge order does not matter** between #9055 and this branch (no shared files). If you
   later want the inline expressions unified to `textLocale()`, do it _after_ #9055 merges.
4. **Re-verify #9055's round-2 surfaces** (`getTaskRepeatInfoText` repeat-info text +
   add-task-bar date/deadline chips) on #9055's latest preview — the first verification
   only covered its commit 1. These are unit-tested and mechanism-proven, so this is
   confirmation, not a blocker.

## Incidental finding (separate, pre-existing, NOT part of either PR)

`src/assets/i18n/fr.json` uses **single-brace** placeholders (`{weekdayStr}`,
`{dateDayStr}`, `{dayAndMonthStr}`) where ngx-translate needs **double** `{{ }}` — so the
French recurring quick-setting labels render the literal placeholder
("Chaque semaine le {weekdayStr}"). `en.json` and `de.json` are correct. Project rule:
**only edit `en.json`** (other locales come from the translation pipeline), so this should
be reported upstream, not fixed in code here.

## Commands

```bash
npm run checkFile <file>                 # prettier + lint one file (run on every changed .ts)
npm run test:file <spec>                 # single Karma spec (~real Chrome)
git push                                 # blocked in sandbox — user runs `! git push`
```
