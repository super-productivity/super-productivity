# RRULE Epic — Roadmap & Branch Model

In-tree mirror of the epic tracker for the RFC 5545 RRULE recurring-schedules
overhaul. The canonical, watchable tracker is the **standing draft PR
`feat/rrule-epic → master`**; this doc travels with the branch and is the source of
truth for the phase list, branch names, and the issue/branch wiring.

Companions: [`recurring-events-implementation-plan.md`](recurring-events-implementation-plan.md)
(the plan) · [`rrule-epic-review-watchlist.md`](rrule-epic-review-watchlist.md)
(per-phase risk checklist).

---

## Branch model

- **Epic = the standing PR `feat/rrule-epic → master`.** Long-running, opened as a
  draft; its body holds the phase table. Merges to master only once the epic is whole
  and testable in final form. Opened/owned by the maintainer (it heads from the
  upstream `feat/rrule-epic` branch).
- **Integration branch = `feat/rrule-epic`** (upstream). Phases merge into it; it is
  never rebased onto master mid-epic.
- **Phase branches = `feat/rrule-epic-pN-<slug>`** — a **hyphen**, not a slash.
  > A git ref cannot be both a branch and a directory. While `feat/rrule-epic` exists
  > as a branch, `feat/rrule-epic/<phase>` is rejected:
  > `fatal: cannot lock ref … 'feat/rrule-epic' exists; cannot create
'feat/rrule-epic/p2-heatmap'`. GitHub enforces the same. The hyphen scheme keeps
  > the visual grouping (phases sort adjacent to the epic branch) with no conflict.
- **Reference / waypoint = `feat/recurring-full`** (currently fork-side, `omega-tree`):
  the full implementation. Each phase is a reviewable slice cut from it.
- **Off-by-default per-device flag** (`RRuleFeatureFlagService`, localStorage, never
  synced) keeps the legacy `repeatCycle` engine authoritative while off — so the branch
  can hold half-built phases (and eventually sit in master) with no half-state risk.

### Contribution flow (fork-based — no upstream push access)

Work happens on the fork (`omega-tree/super-productivity`) and lands via PRs:

1. Cut a phase branch from the waypoint: `feat/rrule-epic-pN-<slug>` (on the fork).
2. PR it into upstream **`feat/rrule-epic`**, body `Part of #<epic-PR>` (never `Closes` —
   that would auto-close the epic on a phase merge).
3. On merge, tick the phase's row.
4. The standing `feat/rrule-epic → master` PR is the **only** one that `Closes`
   (the epic · #4020 · #7239) — and only when the whole epic lands.

> **Pending now:** `origin/feat/rrule-epic` (`1df014090`) does not yet contain the
> Phase-1 follow-ups + flag — those sit on `fork:feat/rrule-epic` (`37d797a9a`, +5
> commits). First action is a PR `fork:feat/rrule-epic → origin:feat/rrule-epic` to put
> them on the integration branch.

### Issue wiring

- **#4020** "Enhanced Repeating Schedule" — **must be reopened**: it was auto-closed by
  the #7948 squash-merge (`1718b0a8b`), which was then reverted from master
  (`3d2c811e7`), so the feature is _not shipped_. The standing master PR re-closes it.
- **#4931** "Collection: Repeat Task / Recurring Task Improvement" (open) — parent
  collection; the epic links under it (`Part of #4931`).
- **#7239** "Local REST API should support creating recurring tasks" (open) — closed by
  Phase 7.

---

## Phases

Phase 1 is the **base** of `feat/rrule-epic` (Core built on its own branch, merged then
reverted; the integration branch was created from it — so it is the starting content, not
a merge in). Phases 2+ each = a PR `feat/rrule-epic-pN-<slug> → feat/rrule-epic`, body
`Part of` the epic PR (never `Closes`).

| ✓   | Phase                                  | Branch                                                                   | Scope                                                                                                 | Status         |
| --- | -------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | -------------- |
| ☑   | **1 — Core**                           | `feat/cron-recurring-schedules` (#7948 → reverted) → base of this branch | engine · builder · legacy⇄RRULE migration · forward-compat clamp · tests · flag + review follow-ups¹  | ✅ base        |
| 🚧  | **2 — Heatmap + simulation**           | `feat/rrule-epic-p2-heatmap`                                             | live 365-day calendar preview of the in-progress rule; click a day to simulate completion + re-anchor | 🚧 in progress |
| ☐   | **3 — Natural language `@+`**          | `feat/rrule-epic-p3-nl`                                                  | `@+<phrase>` → RRULE + add-bar + preview                                                              | ⏸ waypoint     |
| ☐   | **4 — Due-date derivation**            | `feat/rrule-epic-p4-duetype`                                             | per-instance Due: offset / until-next / period-end / fixed / from-completion / none                   | ⏸ waypoint     |
| ☐   | **5 — Ends after N completions**       | `feat/rrule-epic-p5-endsafter`                                           | stop after N completed²                                                                               | ⏸ waypoint     |
| ☐   | **6 — Missed-occurrence backfill**     | `feat/rrule-epic-p6-backfill`                                            | a task per missed occurrence (+ build-set-once perf)                                                  | ⏸ waypoint     |
| ☐   | **7 — REST API recurring**             | `feat/rrule-epic-p7-rest`                                                | create recurring via REST (#7239) + ingestion guards³                                                 | ⏸ waypoint     |
| ☐   | **8 — RECURRENCE-ID overrides**        | `feat/rrule-epic-p8-overrides`                                           | edit one occurrence via RDATE+EXDATE                                                                  | ⏸ waypoint     |
| ☐   | **9 — iCal / RRULE export**            | `feat/rrule-epic-p9-ical`                                                | export `.ics` / RRULE                                                                                 | ⬜ not built   |
| ☐   | **10 — Adaptive scheduling**           | `feat/rrule-epic-p10-adaptive`                                           | learn cadence → suggest/adjust; op-log-deterministic                                                  | 🔭 not built   |
| ☐   | **11 — Trigger-based recurrence**      | `feat/rrule-epic-p11-trigger`                                            | fires on a state-change, not a clock                                                                  | 🔭 not built   |
| ☐   | **12 — Sub-daily / hourly**            | `feat/rrule-epic-p12-subdaily`                                           | `FREQ=HOURLY`/`BYHOUR`; owns sub-daily engine + persist guard⁴                                        | 🔭 not built   |
| ☐   | **13 — Multiple reminders/occurrence** | `feat/rrule-epic-p13-reminders`                                          | >1 reminder offset per instance                                                                       | 🔭 not built   |

¹ On `feat/rrule-epic` (fork→origin PR pending): off-by-default per-device flag,
from-completion flip, `isRRuleValid` never-fire/freeze, deterministic `_parseStart`, rrule
re-anchor test.
² Needs a min-client-version gate (old clients ignore the field); rejects `COUNT`+completion
at the persist boundary.
³ Persist-boundary guards for untrusted ingestion (unsupported-FREQ / `repeatCycle`
wire-safety) — defends the non-dialog write path.
⁴ Until Phase 12, sub-daily FREQs are rejected at save **and** at the engine validity
gate (`isRRuleValid` → legacy fallback, covering synced/imported rules the dialog never
saw); the persist-boundary ingestion guard lands with Phase 7 (note ³).

Status key: ✅ base · 🚧 in progress · ⏸ on waypoint, awaiting its slice · ⬜ not started ·
🔭 newly scoped, not built. Donetick assignee rotation / round-robin is out of scope — SP
recurrence is single-assignee.

---

## The governing risk model: duplicates, not shifted dates

Occurrence creation is **per-device recomputation**, not a replayed derivation: each
device independently computes "what's due" and emits concrete ops, deduped only by the
deterministic id `rpt_<cfgId>_<dueDay>` (`get-repeatable-task-id.util.ts`). The flag
gates **evaluation** (it sits inside all three calculators), so two devices routing
different engines that disagree on the day produce **different ids → both instances are
created and sync to every device** — and each side's `lastTaskCreationDay` update then
feeds the other engine a foreign anchor (creation/suppression flip-flop). Any engine
divergence on a multi-device account is therefore a **duplicate-task generator for the
whole mixed window**, which is why:

- the flag help text warns multi-device accounts to enable it everywhere or nowhere
  (the flag is per-device localStorage, never synced — the mixed window opens the
  moment ONE device opts in, not at default-flip);
- the converter divergence classes are pinned as expected-output contract cases, not
  an exclusion list (see flip gates below);
- `rrule` is **pinned to an exact version** (`2.8.1`, no caret): a caret upgrade that
  changes rrule.js parsing on some devices mid-account re-creates the same duplicate
  mechanics between identical app versions. Treat an rrule bump like an engine change —
  the differential/invariants specs are the upgrade tripwire.

## Legacy-fallback contract (decided policy)

The legacy fields written alongside `rrule` are the **wire format** for old clients and
the schedule for flag-off devices. The contract
(`rruleToLegacyTaskRepeatCfg`, decided 2026-06-11):

- **Within legacy expressiveness** → fields fire on the **same days** (modulo the two
  documented divergence classes: WEEKLY `INTERVAL>1` week-grouping/WKST phase, and the
  day>28 clamp-vs-skip edge — the lazy-migrate class).
- **Outside legacy expressiveness** (COUNT/UNTIL, seasonal `BYMONTH`, `BYWEEKNO` /
  `BYYEARDAY`, multi-day lists, out-of-union ordinals, yearly weekday modes) → the
  **never-fires sentinel** `LEGACY_NEVER_FIRES_FALLBACK` (`repeatCycle: 'WEEKLY'`, all
  weekday flags `false` — deterministically dead on every released legacy engine, every
  value wire-stable). Old/flag-off devices create **no** tasks rather than tasks on
  wrong days that would sync back to every device. The dialog warns at authoring time
  (`isRRuleLegacyRepresentable` → `RRULE_LEGACY_INCOMPAT`).
- Never a silent best-effort approximation in between.

## Dual-engine endgame (written down so the second engine cannot become immortal)

1. **Now (flag default-off):** lazy-migrate on edit — the dialog already converts
   legacy `CUSTOM` cfgs in the builder, the migration rides a user-intent op, and the
   preview shows the user the new schedule at exactly the moment semantics could shift.
2. **At flag default-on:** a one-time data-repair backfill of `rrule` for **only the
   provably-lossless class** (`interval=1` — empirically exact and DST-proof). Never
   bulk-convert the divergent classes; they lazy-migrate or age out.
3. **Then:** flag default-on → soak (one release minimum) → flag removed → legacy
   engine deleted one release later.
4. **Forever:** legacy-field dual-write stays — it is the wire format for old clients,
   cheap, and independent of the engine question.
5. **Post-legacy-engine fallback for an invalid `rrule`:** pause + repair prompt
   (`isPaused` already exists on the model) — never silent rescheduling. Decided now so
   deleting the legacy engine has no open design question attached.

## Flip gates — what must be green before flag default-on (and before engine deletion)

In priority order; #1 models the production failure mode and outranks the rest:

1. **Mixed-version convergence simulation** — two simulated devices sharing an op
   stream, one routing RRULE and one legacy, driven through day rollovers; assert no
   duplicate `rpt_<cfgId>_<day>` instances and no `lastTaskCreationDay` flip-flop
   suppression.
2. **Differential fuzz spec** over the legacy cfg space (cycle × interval 1–6 ×
   weekday masks incl. empty × monthly anchors × day-29/30/31 + Feb-29 starts),
   comparing multi-year streams legacy vs converted-RRULE under both CI timezones —
   with the known divergences pinned as **expected-output cases**, not excluded. Must
   run against **all three calculators**, especially `getNewestPossibleDueDate` (what
   task creation actually consumes).
3. **typia wire round-trip per producer path** (builder save, converter, backfill,
   later REST/repair) against the released schema — guards the catastrophic mode
   (out-of-union value → old-client data-repair, no rollback).

Note on the engine-robustness alternative considered and rejected (2026-06-11): a
bounded `between`/`until` probe **cannot** replace the `_canNeverFire` heuristics —
rrule.js checks `until` only against _emitted_ occurrences, so a never-firing rule
walks to year 275760 regardless (measured: 10.1 s with `UNTIL` set). The heuristics
stay; new BY-part interplay checks belong there (watchlist §5).

---

## Feature comparison (RFC 5545 baseline, expanded)

**SP now** = released Super Productivity (master, legacy repeat). **SP this epic** = after
the epic lands. `*Google` = Google **Calendar** (RRULE-complete via API/import; the
custom-recurrence GUI is limited; Google **Tasks** is far weaker). **Donetick** =
open-source self-hosted chore manager (closest OSS peer). **Build** = status on the SP
waypoint: ✓ built · ☐ planned · — not planned. Markers: ✅ full · ➖ partial/limited ·
❌ none · 🟢 SP-distinct.

| Feature                                | SP now | RFC 5545 | SP this epic | Google\* | Todoist | Things 3 | TickTick | Donetick | Build          |
| -------------------------------------- | ------ | -------- | ------------ | -------- | ------- | -------- | -------- | -------- | -------------- |
| **— Frequency —**                      |        |          |              |          |         |          |          |          |                |
| Basic D/W/M/Y                          | ✅     | ✅       | ✅           | ✅       | ✅      | ✅       | ✅       | ✅       | ✓              |
| Every N interval                       | ✅     | ✅       | ✅           | ✅       | ✅      | ✅       | ✅       | ✅       | ✓              |
| Weekday selection                      | ✅     | ✅       | ✅           | ✅       | ✅      | ✅       | ➖       | ✅       | ✓              |
| Nth weekday of month (`2TU`)           | ✅     | ✅       | ✅           | ✅       | ✅      | ✅       | ❌       | ✅       | ✓              |
| 🟢 Per-day ordinals (`3MO,4SU`)        | ❌     | ✅       | ✅           | ➖       | ❌      | ❌       | ❌       | ➖       | ✓              |
| Last day / last weekday                | ✅     | ✅       | ✅           | ✅       | ➖      | ➖       | ❌       | ➖       | ✓              |
| Last business day (`BYSETPOS=-1`)      | ❌     | ✅       | ✅           | ➖       | ➖      | ❌       | ❌       | ❌       | ✓              |
| Multiple month-days (`1,15`)           | ❌     | ✅       | ✅           | ➖       | ❌      | ➖       | ❌       | ➖       | ✓              |
| Seasonal `BYMONTH`                     | ❌     | ✅       | ✅           | ➖       | ❌      | ❌       | ❌       | ➖       | ✓              |
| 🟢 `BYWEEKNO`/`BYYEARDAY`/`WKST`       | ❌     | ✅       | ✅           | ➖       | ➖      | ❌       | ❌       | ❌       | ✓              |
| **— End conditions —**                 |        |          |              |          |         |          |          |          |                |
| Never                                  | ✅     | ✅       | ✅           | ✅       | ✅      | ✅       | ✅       | ✅       | ✓              |
| On date (`UNTIL`)                      | ❌     | ✅       | ✅           | ✅       | ✅      | ✅       | ✅       | ❌       | ✓              |
| After N occurrences (`COUNT`)          | ❌     | ✅       | ✅           | ✅       | ❌      | ✅       | ✅       | ❌       | ✓              |
| End after N completions                | ❌     | ➖       | ✅           | ❌       | ❌      | ➖       | ➖       | ❌       | ✓ Ph5          |
| **— Occurrence control —**             |        |          |              |          |         |          |          |          |                |
| Skip / exclude one (`EXDATE`)          | ✅     | ✅       | ✅           | ✅       | ➖      | ❌       | ✅       | ❌       | ✓              |
| Edit one occurrence (`RECURRENCE-ID`)  | ❌     | ✅       | ✅           | ✅       | ➖      | ❌       | ✅       | ❌       | ✓ Ph8          |
| **— Completion-relative —**            |        |          |              |          |         |          |          |          |                |
| After-completion scheduling            | ✅     | ❌       | ✅           | ❌       | ✅      | ✅       | ✅       | ✅       | ✓              |
| Configurable gap after completion      | ✅     | ❌       | ✅           | ❌       | ➖      | ✅       | ✅       | ✅       | ✓              |
| Wait-for-completion (no pile-up)       | ✅     | ❌       | ✅           | ❌       | ➖      | ✅       | ➖       | ✅       | ✓              |
| Adaptive (learns cadence)              | ❌     | ❌       | ✅           | ❌       | ❌      | ❌       | ❌       | ✅       | ☐ Ph10         |
| Trigger-based (state-change fires)     | ❌     | ❌       | ✅           | ❌       | ❌      | ❌       | ❌       | ✅       | ☐ Ph11         |
| **— Time / reminders —**               |        |          |              |          |         |          |          |          |                |
| Specific time-of-day                   | ✅     | ✅       | ✅           | ✅       | ✅      | ➖       | ✅       | ✅       | ✓              |
| Hourly / sub-daily / multi-per-day     | ❌     | ✅       | ✅           | ✅       | ✅      | ❌       | ❌       | ✅       | ☐ Ph12         |
| Reminder lead-time per occurrence      | ✅     | ➖       | ✅           | ➖       | ✅      | ✅       | ✅       | ✅       | ✓              |
| Multiple reminders per occurrence      | ❌     | ➖       | ✅           | ➖       | ❌      | ➖       | ✅       | ✅       | ☐ Ph13         |
| **— Entry —**                          |        |          |              |          |         |          |          |          |                |
| Natural-language entry                 | ❌     | ➖       | ✅           | ➖       | ✅      | ➖       | ✅       | ✅       | ✓ Ph3          |
| 🟢 `@+` NL → RRULE + next-date preview | ❌     | ❌       | ✅           | ❌       | ➖      | ❌       | ➖       | ❌       | ✓ Ph3          |
| 🟢 Raw RRULE override (UI)             | ❌     | ✅       | ✅           | ❌       | ❌      | ❌       | ➖       | ❌       | ✓              |
| **— Preview —**                        |        |          |              |          |         |          |          |          |                |
| Occurrence list / calendar preview     | ❌     | ➖       | ✅           | ➖       | ➖      | ❌       | ✅       | ❌       | ✓              |
| 🟢 Heatmap occurrence preview          | ❌     | ➖       | ✅           | ❌       | ❌      | ❌       | ❌       | ❌       | ✓ Ph2          |
| 🟢 Completion **simulation** preview   | ❌     | ❌       | ✅           | ❌       | ❌      | ❌       | ❌       | ❌       | ✓ Ph2          |
| **— Derivation / backfill —**          |        |          |              |          |         |          |          |          |                |
| 🟢 Per-instance due-date derivation    | ❌     | ➖       | ✅           | ❌       | ➖      | ❌       | ➖       | ❌       | ✓ Ph4          |
| 🟢 Create task per missed occurrence   | ❌     | ➖       | ✅           | ❌       | ❌      | ❌       | ❌       | ❌       | ✓ Ph6          |
| **— Teams / projects / habits —**      |        |          |              |          |         |          |          |          |                |
| Assignee rotation / round-robin        | ❌     | ❌       | ❌           | ❌       | ❌      | ❌       | ❌       | ✅       | — out of scope |
| Repeating projects w/ checklist        | ❌     | ❌       | ❌           | ❌       | ❌      | ✅       | ❌       | ➖       | —              |
| Habit-tracking subsystem               | ❌     | ❌       | ❌           | ❌       | ❌      | ❌       | ✅       | ❌       | —              |
| **— Interop —**                        |        |          |              |          |         |          |          |          |                |
| iCal / RRULE export                    | ❌     | ✅       | ✅           | ✅       | ✅      | ❌       | ✅       | ❌       | ☐ Ph9          |
| iCal / RRULE import                    | ➖     | ✅       | ➖           | ✅       | ❌      | ➖       | ➖       | ❌       | ✓              |
| REST / API create recurring            | ❌     | ➖       | ✅           | ✅       | ✅      | ❌       | ✅       | ✅       | ✓ Ph7          |

### 🟢 Genuinely SP-distinct (no mainstream rival matches)

- **Completion simulation** preview — click a day, the series re-anchors. _Nobody else._
- **Create a task per missed occurrence** — true catch-up, not just "next". _Nobody else._
- **Heatmap** 365-day occurrence preview. _Nobody else._
- **Per-day ordinals** (`3MO,4SU`), **seasonal `BYMONTH`**, **`BYWEEKNO`/`BYYEARDAY`/`WKST`**,
  **raw RRULE override** in the _UI_ — Google only via API/import; mainstream apps not at all.
- **Per-instance due-date derivation** (due = appears + offset / until-next / period-end /
  fixed / from-completion / none).

---

## Forward-compat note (carries every phase)

New `quickSetting` literals (incl. `RRULE`) are never persisted — saved cfgs use a
`master`-safe value (`CUSTOM`); the rich value drives the dialog UI in-memory only, so
typia on old/mobile clients stays happy. Engine internals stay UTC; the opaque `rrule`
string keeps `repeatCycle` within the old enum subset, so old clients ignore unknown
fields and fall back to the legacy schedule. Each deferred / new phase carries its own
sync surface — re-run the [watchlist](rrule-epic-review-watchlist.md) "Always-verify" list.
