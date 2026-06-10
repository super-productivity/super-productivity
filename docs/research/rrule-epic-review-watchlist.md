# RRULE Epic — Review Watchlist

Distilled from the PR **#7948** review thread (johannesjo, 2026-06-02…09) — 9 review
rounds across the cron→RRULE pivot and Phase 1. Keep this open while working any
phase of the epic on `feat/rrule-epic`. The same handful of risk classes resurfaced
in almost every round; the **Always-verify checklist** below is the load-bearing part.

Companion docs: [`recurring-events-implementation-plan.md`](recurring-events-implementation-plan.md)
(the plan), `ARCHITECTURE-DECISIONS.md`, `docs/sync-and-op-log/contributor-sync-model.md`.

**Status legend:** ✅ done (Phase 1 / follow-ups) · 🔶 deferred to a named later phase ·
⛔ open / pre-merge · ❓ status unverified on current head — re-check when that code is touched.

---

## 0. The one governing rule (the failure mode behind ~half the findings)

Every **synced** field must stay within the value set the _released_ master client's
typia validator accepts. An out-of-union value on a **required** field — or a required
key dropped entirely — makes an old/mobile client treat the whole task as **corrupt on
the live sync path**, triggering data-repair / restore-from-backup with **no rollback**.
A single bad task on one up-to-date device can break sync for an older device on the
same account.

This is the exact reason `repeatCycle:'CRON'` was rejected; it then resurfaced through
`quickSetting`, `monthlyWeekOfMonth`, and `repeatCycle:undefined`. **Treat it as the
default failure mode of any new field, value, or enum member added anywhere near synced
repeat state.** typia _tolerates unknown extra fields_ (so a brand-new optional field
like `rrule?: string` is safe) but _rejects an out-of-union value on a field it already
knows_.

Released-master `RepeatQuickSetting` union (the only persist-safe values):
`DAILY | WEEKLY_CURRENT_WEEKDAY | MONTHLY_CURRENT_DATE | MONTHLY_FIRST_DAY |
MONTHLY_LAST_DAY | MONTHLY_NTH_WEEKDAY | MONDAY_TO_FRIDAY | YEARLY_CURRENT_DATE | CUSTOM`.
Released-master `MonthlyWeekOfMonth = 1|2|3|4|-1`; `MonthlyWeekday = 0..6`.

---

## 1. ALWAYS verify on every phase / PR touching synced repeat state

- [ ] **No new value of an existing synced field reaches the wire.** New `quickSetting`
      literals, `repeatCycle` values, `monthlyWeekOfMonth` ordinals, etc. must be
      clamped to a master-safe value **at the action-creator boundary** (see §2), not
      just in the UI.
- [ ] **Clamp lives in the action creator, never only the reducer.** The op-log replays
      the action _payload_ (`operation-capture.service.ts`), not reduced state — a
      reducer-only clamp still ships the bad value to remotes. (Comment #8.)
- [ ] **No required synced field can become `undefined`** (e.g. `repeatCycle` from an
      unmapped FREQ → JSON drops the key → typia failure). (§5.)
- [ ] **No optional synced field is "cleared" via `undefined`** expecting it to
      propagate — JSON.stringify drops the key, so remotes never see the clear. Use a
      wire-stable strategy. (§3.)
- [ ] **Legacy fallback fields stay faithful.** Old clients ignore `rrule` and schedule
      from `repeatCycle` + weekday flags + monthly anchors + `startDate`-day. Any rule
      the builder can emit must round-trip to legacy fields that fire on the _same days_,
      or the value must be left unset so old clients fall back cleanly. (§4.)
- [ ] **Effects inject `LOCAL_ACTIONS`** (lint-enforced); multi-entity changes go through
      a meta-reducer, not effect fan-out; no `Date.now()` in pure engine/reducer code.
- [ ] **Never log rule bodies or task content** — `rrule` (raw-override = free-text),
      titles, notes. Log ids / changed-keys only (rule #9). (§6.)
- [ ] **A regression test typia-validates a cfg produced by each new builder/import/REST
      path**, and (where feasible) a cross-device replay test exercises the clamp. (§8.)

---

## 2. Forward-compat: synced field value safety ✅ (keep guarding)

- ✅ **`quickSetting` clamp** — new presets + `RRULE` persist as `CUSTOM`; the rich literal
  lives only in dialog form state and is re-promoted from `rrule` on reopen
  (`_processQuickSettingForDate`). Clamp centralized in the `addTaskRepeatCfgToTask` /
  `updateTaskRepeatCfg` / `updateTaskRepeatCfgs` **action creators**
  (`toSyncSafeQuickSetting` / `_toPersisted`, `MASTER_SAFE_QUICK_SETTINGS`). (Comments #5–9.)
- ❓ **`monthlyWeekOfMonth` out-of-range** — `rruleToLegacyTaskRepeatCfg` blind-casts the
  BYDAY ordinal; builder custom-ordinal allows ±5 (monthly) / ±53 (yearly), so
  `BYDAY=5MO`→`5`, `BYDAY=-2MO`→`-2` are outside `1|2|3|4|-1`. Fix: only set the anchor
  when model-valid (`n===-1 || (n>=1&&n<=4)`), else leave unset; mirror a strip/repair in
  the action boundary **and `data-repair.ts`**. (Comment #15.1 — verify still guarded.)
- ❓ **`null` anchors not master-safe** — `monthlyWeekOfMonth`/`monthlyWeekday = null` must
  be normalized to absent/`undefined` before persist (`_normalizeMonthlyAnchor`). (Comments #13.3, #15.) The
  follow-up fix `fix(task-repeat-cfg): clear repeat-from-completion…` touches this path.
- 🔶/❓ **`monthlyWeekOfMonth: 0` sentinel does NOT work** as a clear shortcut — `0` is also
  out-of-union and trips released typia exactly like `null`. The legitimate path is a
  two-release `| null` migration. (Comment #19.)

## 3. JSON op-log drops `undefined` keys (clears don't sync) ⛔ partly open

`JSON.stringify` removes keys whose value is `undefined`, so "clear this optional field"
never reaches remotes — they keep the stale value.

- ✅ **`rrule` clears** — presets stay rrule-backed (the old `else if (working.rrule) {
rrule: undefined }` branch is removed); editing a preset no longer drops the canonical
  rule. (Comments #16.1–2, #19.)
- 🔶 **`MONTHLY_ANCHOR_RESET` (nth-weekday → day-of-month switch)** — clearing
  `monthlyWeekOfMonth`/`monthlyWeekday` via `undefined` doesn't propagate, so a **released**
  client (ignores `rrule`, checks Nth-weekday anchors first) keeps scheduling the old
  rule. Affects the whole installed base during the mixed-version window; self-heals once
  both devices run the rrule build, loses no data. **Tracked follow-up** — needs a
  wire-stable clear/replace strategy or the two-release `| null` migration, not a code
  comment alone. (Comments #16.3, #17.1, #19.) **This is the canonical example — any new
  "switch mode clears a legacy anchor" path inherits it.**

## 4. Legacy ⇄ RRULE dual-engine fidelity ✅ (keep faithful)

Old clients schedule from legacy fields; new clients prefer a valid `rrule`. Divergence =
the same task fires on different days per device.

- ✅ **Malformed `rrule` → silent dormancy** — the three dispatchers gate on `isRRuleValid`
  and fall back to legacy fields instead of returning `null`. (Comments #5, #7; reinforced
  by the freeze fix below.)
- ✅ **BYDAY-less `FREQ=WEEKLY` zeroes weekday flags** → never fires on old clients. Reverse
  converter now falls back to the start weekday. (Comments #5, #7.)
- ✅ **`BYMONTHDAY`/`BYMONTH` fallback fired on `startDate`-day, not the rule day** — save
  aligns `startDate` and always re-derives legacy fields. (Comments #9.2, #13.2.)
- ✅ **`monthlyLastDay` (`BYMONTHDAY=-1`) stripped on RRULE save** — `_normalizeMonthlyAnchor`
  now keeps it for `quickSetting==='RRULE'`. (Comment #9.3.)
- ❓ **`getAlignedStartDate` ignores `INTERVAL` and skips clamp-idiom occurrences** —
  e.g. `FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=15` from `2024-06-20` saved as `2024-07-15`
  (shifts cadence); `BYMONTHDAY=31,-1;BYSETPOS=1` from `2024-02-10` skips valid Feb 29.
  (Comment #13.1 — verify on head.)
- ❓ **Legacy `CUSTOM` → RRULE migration not behavior-preserving** — legacy monthly/yearly
  _clamps_ missing dates (Jan 31 → Feb 28, Feb 29 → Feb 28); RRULE _skips_ them. Opening +
  saving the dialog silently changes the schedule. Needs legacy-path retention or explicit
  compatible semantics + tests. (Comment #9.1.)
- ✅ **`startDate` changed after last builder emit** → stale legacy weekday booleans/dtstart
  mismatch. Save now _always_ re-derives legacy fields against the final `startDate`.
  (Comment #13.2.)

## 5. Engine robustness

- ✅ **`isRRuleValid` freeze + silent-never-fire** — a never-firing rule (`FREQ=DAILY;
BYMONTH=13`, Feb-30 combos) walked to year 275760 (~3.8s freeze) and returned `true`.
  Fixed: `_canNeverFire` pre-screen (contradictory BY-constraints) + the probe must
  actually return an occurrence; `UNTIL`/`COUNT` stripped for the probe.
  (Commit `d1ef458`; Comment #20 🟠.) Note: `.between()`/`until` do **not** bound a
  never-firing rule in rrule.js — only `_canNeverFire` does.
- ✅ **`_canNeverFire` combo coverage** — the original pre-screen only paired
  `BYMONTH` × positive `BYMONTHDAY`, so `BYMONTH` × `BYYEARDAY` / `BYWEEKNO`
  contradictions (`FREQ=DAILY;BYWEEKNO=53;BYMONTH=2`: measured ~7–10s) slipped through
  to the one-time memoised probe walk — i.e. a save-click freeze on first sight.
  Extended to month-possibility checks for positive year-days (both leap layouts) and
  positive week numbers (conservative ±-day superset covering WKST shifts and
  year-boundary spill — ISO week 1 can include late December, week 53 early January;
  verified against rrule.js, which uses ISO week-year semantics). Negative values
  count from the year's end and skip the check. Rules the pre-screen still can't
  recognise (e.g. `BYSETPOS` beyond the period's occurrence count) keep the one-time
  unbounded-probe cost — any future BY-part interplay check belongs in
  `_canNeverFire`, never in the probe.
- 🔶 **Sub-daily FREQ (HOURLY/MINUTELY/SECONDLY)** — engine maps every occurrence to local
  noon, so sub-daily silently collapses to ~daily; also `FREQ_TO_CYCLE` miss →
  `repeatCycle: undefined` → required-field typia failure. Rejected at the **dialog**
  only. **Mirror the guard at the engine/persist/`data-repair` boundary** so a synced/
  imported/REST rule can't slip past. (Comments #15.2, #20 🟡.) Phase 12 owns real
  sub-daily support.
- 🔶 **`COUNT` + `repeatFromCompletionDate`** — completion re-anchors `startDate` +
  `lastTaskCreationDay`, restarting the COUNT window → never terminates. Rejected at the
  dialog only; mirror at the persist boundary. (Comment #20 🟡.)
- ✅ **Yearly builder default fired monthly** — `FREQ=YEARLY;BYMONTHDAY=n` without `BYMONTH`
  matches that day every month. Builder seeds/requires `BYMONTH` for yearly date modes.
  (Comment #9.5.)
- ❓ **`BYSETPOS=0` dead rule re-emitted** — parser drops `0` from `bySetPos`, but the
  canonical-mismatch path stores the original rule in `rawOverride`, re-emitting the dead
  `BYSETPOS=0`. Test should assert the _emitted rule_, not just `m.bySetPos`. (Comment #13.4.)
- ✅ **`_parseStart` wall-clock fallback** — start-less MONTHLY/YEARLY migration encoded
  _today's_ day-of-month (non-deterministic across devices/days). Fixed to a fixed
  `1970-01-01` epoch. (Commit `5e22d90`; Comment #20 🟡.)
- 🔶 **Perf (missed-backfill phase only):** `_buildRuleSet` re-parses the `RRuleSet` every
  call; a long catch-up re-parses the same rule N times — build once, walk it. Same for the
  per-cfg `endsAfterCompletions` archive read on every app-open fan-out (one snapshot per
  pass). (Comments #5, #7.)

## 6. Logging / privacy (rule #9 — log history is exportable)

- ✅ **`Log.warn` with rule body** in `rrule-occurrence.util.ts` → error _name_ only.
  (Comment #5.)
- ❓ **`Log.log(changes)` / `Log.log(todayTasks, archiveTasks)`** in the effects "update
  all" path now carry the `rrule` string + task titles/notes. Log `{ changedKeys: … }` +
  task **ids** only, never the objects. Same class as any `Error.message` that can embed
  the rule string. (Comment #15.3 — verify on head.)

## 7. UI / dialog correctness

- ✅ **Completion-relative cfg silently flips to "from start"** — a no-`rrule` completion
  cfg opened under a preset label (toggle hidden), then any save reset
  `repeatFromCompletionDate:false`. Fixed: the check is hoisted above `if (cfg.rrule)`;
  no-rrule completion cfgs migrate into the builder so the toggle stays visible.
  (Commit `042f9c8`; Comments #19, #20 🟠.)
- ❓ **Date-writing presets ignore the chosen `startDate` at change time** —
  `getQuickSettingUpdates(event.value)` is called without the date, so selecting
  `MONTHLY_CURRENT_DATE` / quarterly / semiannual / yearly after picking a _future_ start
  overwrites the anchor with today before the save-time recompute. (Comment #9.6.)
- ❓ **`createForEachMissed` / missed-backfill option exposed but not implemented** in the
  slice → users enable a setting that silently does nothing. Remove/defer the field + copy
  until the backfill phase lands, or implement with coverage. (Comment #9.4.)
- 🔶 **Hardcoded placeholders instead of `T` keys** in `rrule-builder.component.html`
  (`:98,:163,:211,:445,:460,:476`); `en.json` advertises `@+<phrase>` short syntax that is
  deferred. (Comments #16, #15.) Clean up when the builder/NL layer is next touched.

## 8. Tests / process (gaps that let regressions pass green CI)

- ⛔ **Effects re-anchor untested** — `rrule ∈ SCHEDULE_AFFECTING_FIELDS` prevents a recurring
  task silently stopping after an edit; no spec covers it. **Fast-follow.** (Comment #20.)
- ⛔ **No cross-device sync/replay e2e** — e2e is single-client; the forward-compat clamp is
  never exercised end-to-end. **Fast-follow / before default-on.** (Comment #20.)
- ⛔ **typia-validate a cfg from each builder/import/REST path** (`BYDAY=5MO`/`-2MO` never
  persists out-of-union `monthlyWeekOfMonth`; `FREQ=HOURLY` never yields
  `repeatCycle:undefined`). (Comments #15, #20.)
- 🔶 **Bundle budget** — `rrule` core is in the main bundle (~30 KB gzip, no luxon/tz
  subpath); worth a budget check, not a blocker. (Comment #20.)
- **Process:** mark ready + green CI before any merge to master; the feature flag (off by
  default, local per-device — `RRuleFeatureFlagService`) is what lets the epic sit in master
  without shipping a half-state. (Comments #15.4, #22–24.)

## 9. Deferred features carrying their own sync surface (gate when they land)

- 🔶 **`endsAfterCompletions` / "ends after N"** — old clients ignore the field and
  materialize forever. Needs a **min-client-version gate**, not "self-healing" framing.
  (Comments #5, #7.)
- 🔶 **Natural-language layer / `@+` short syntax (phases 2/7)** — if it returns, shape it
  as `RRule.fromText`-first + custom fallback (covers "weekends", "every other tuesday",
  month ranges that `fromText` misses) to shrink the hand-rolled parser; de-dupe
  `normalizeWeekdays`/`toNumArray` (byte-identical across `rrule-form.util.ts` and
  `legacy-cfg-to-rrule.util.ts`) into one module. (Comments #5, #7.)
- 🔶 **Missed-occurrence backfill** — see §5 perf note; ships with its own phase + coverage.
- 🔶 **Recurring-task creation over REST (#7239)** — inherits the action-creator clamp for
  free _iff_ it dispatches the same actions; verify it routes through `_toPersisted`.

## 10. Hygiene

- ❓ **Lockfile** — earlier rounds flagged stale `cron-parser` / `cronstrue` entries in
  `package-lock.json` with no source imports. Should be gone post-pivot — verify
  `package-lock.json` only adds `rrule` (+ pre-existing `tslib`). (Comments #9, #20.)

---

### Quick map: review round → what it found

| Round (comment) | Headline                                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #2              | cron rejected: WASM unauditable, `repeatCycle:'CRON'` breaks sync, direction = RRULE                                                                     |
| #5              | quickSetting forward-compat (#2 relocated); malformed-rule dormancy; reverse-WEEKLY guard; log redaction; lib reuse; DRY; backfill perf                  |
| #7              | `'RRULE'` also unsafe to persist → clamp to `CUSTOM`; 4 write sites; clamp at action creator                                                             |
| #9              | CUSTOM→RRULE not behavior-preserving; monthly/yearly fallback day; last-day strip; backfill option no-op; yearly fires monthly; preset ignores startDate |
| #13             | `getAlignedStartDate` ignores INTERVAL/clamp; stale legacy on startDate change; `null` anchors; `BYSETPOS=0` re-emit                                     |
| #15             | out-of-range `monthlyWeekOfMonth`; sub-daily accept-and-collapse + `repeatCycle:undefined`; `Log.log` leaks; draft/no-CI                                 |
| #16–17          | preset save strips its rrule; `undefined` clears not wire-durable; MONTHLY_ANCHOR_RESET divergence; completion cfg reopens as preset                     |
| #19–20          | from-completion silent flip 🟠; isRRuleValid freeze 🟠; persist-boundary guards; `_parseStart`; test gaps                                                |
| #22–24          | revert to `feat/rrule-epic`; gate behind off-by-default per-device flag; ship on a major release                                                         |
