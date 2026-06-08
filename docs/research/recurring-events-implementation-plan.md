# Recurring Events Implementation Plan

> **Revision note (verified against code 2026-06-02).** Rewritten after two rounds
> of multi-axis review against the actual codebase. The original draft was built on
> three false premises and several sync-unsafe steps; a later "raw RRULE string as
> the model" revision was then corrected again after review surfaced real costs in
> this codebase. Net premises now driving the plan:
>
> 1. **The RRULE engine is already in the repo.** `ical.js@2.2.1` is a dependency,
>    lazy-loaded (`src/app/features/schedule/ical/ical-lazy-loader.ts`), and
>    expands RRULEs in **two** places
>    (`get-relevant-events-from-ical.ts`,
>    `packages/plugin-dev/caldav-calendar-provider/src/plugin.ts`).
>    `caldav-client.service.ts` uses ical.js only to parse VTODO — it does **not**
>    expand RRULEs. **Do not add `rrule` (rrule.js).**
> 2. **The headline "critical gaps" already shipped.** Nth-weekday of month
>    (#6040), last-day-of-month (#7726), EXDATE (`deletedInstanceDates`). Earlier
>    gap-analysis/industry-standards research drafts marked these missing; that was
>    stale and those docs have been folded into this one (see Appendices A–B).
> 3. **`TaskRepeatCfg` is synced state.** The model change must go through the
>    op-log schema-migration system (`packages/shared-schema/src/migrations/`),
>    keep the deterministic ID `rpt_${repeatCfgId}_${dueDay}` stable, and not break
>    cross-version sync. This dominates the risk profile.

---

## Decision: a typed, RRULE-isomorphic recurrence model

The recurrence **pattern** becomes a single typed, structured field — a
discriminated union that maps **1:1 to RFC 5545** — replacing the ~14
interdependent flat fields (`repeatCycle`, `repeatEvery`, the 7 weekday booleans,
`monthlyWeekOfMonth`, `monthlyWeekday`, `monthlyLastDay`, `quickSetting`).

The RFC-5545 **RRULE string is produced/parsed only at the boundary** (`.ics`
export, CalDAV). **The raw string is never the persisted/synced field.**

### Why typed-isomorphic instead of a raw RRULE string

A raw `rrule` string as the canonical field was considered and rejected. It is the
worst fit for _this_ codebase:

- **Un-queryable.** NgRx selectors (`task-repeat-cfg.selectors.ts`) read fields; a
  string forces parsing on every projection.
- **Un-diffable / un-repairable.** The op-log diffs fields and `data-repair.ts`
  repairs typed shapes (`_fixTaskRepeatMissingWeekday`,
  `_fixTaskRepeatCfgInvalidQuickSetting`); it cannot validate or repair the
  _interior_ of an opaque string. A partially-corrupt string would sync silently.
- **Hot-path performance.** The occurrence engine runs **synchronously**,
  `days × configs` times, in selector projectors (`selectTaskRepeatCfgsForExactDay`,
  `selectAllUnprocessedTaskRepeatCfgs`) consumed per displayed day by the schedule
  (~up to a month grid) and the 14-day mobile-notification lookahead. Expanding a
  raw string means ical.js iteration, which is **forward-only** and **async**
  (the engine is lazy-loaded, ~76 KB) — it cannot run inside a sync selector and is
  far heavier than today's bounded loops. To keep a raw string _and_ stay fast you
  would maintain a parsed structured form alongside it — i.e. rebuild this typed
  model anyway, plus a redundant string.

A typed union maps onto the same `FREQ/INTERVAL/BYDAY/BYMONTHDAY/COUNT/UNTIL`
concepts the existing engine already handles, so it stays queryable, validatable,
diffable, and **fast** — while remaining losslessly serializable to the RRULE
string for interop. It honors the "RRULE as the model" intent in substance (the
model _is_ RRULE, structured) without the opaque-blob costs.

### Honest caveats on the goals (design to them)

1. **"Smaller data model" is partial.** The pattern sub-model collapses (~14
   fields → 1 typed `recurrence` field), but `TaskRepeatCfg` stays ~18 fields
   (task-template + SP-extension + tracking are irreducible). The real win is
   **invariant-elimination** — a discriminated union makes "the fields disagree"
   _unrepresentable_, deleting the implicit-precedence bug class (e.g. "Nth-weekday
   anchor wins over `monthlyLastDay`") and shrinking `data-repair.ts`. Sell that,
   not byte-count.
2. **"Covers everything" is true minus one carve-out.** RFC 5545 cannot express
   "N days **after completion**", so `repeatFromCompletionDate` (SP's
   differentiator) stays a separate non-RRULE representation. The model is
   "RRULE-isomorphic + one carve-out", and the engine keeps two modes.

---

## The typed model

Replace the flat pattern fields in `TaskRepeatCfgCopy`
(`task-repeat-cfg.model.ts` — edit `TaskRepeatCfgCopy`, not the `Readonly` alias)
with one discriminated union plus an end condition. Sketch (final names TBD):

```typescript
type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';

type RecurrencePattern =
  | { freq: 'DAILY'; interval: number }
  | { freq: 'WEEKLY'; interval: number; byDay: Weekday[]; wkst?: Weekday }
  | { freq: 'MONTHLY'; interval: number; on: { monthDay: number } } // BYMONTHDAY=n
  | { freq: 'MONTHLY'; interval: number; on: { lastDay: true } } // BYMONTHDAY=-1
  | { freq: 'MONTHLY'; interval: number; on: { week: 1 | 2 | 3 | 4 | -1; day: Weekday } } // BYDAY=nDD
  | { freq: 'YEARLY'; interval: number; month: number; day: number };

type RecurrenceEnd =
  | { type: 'never' }
  | { type: 'count'; count: number } // COUNT
  | { type: 'until'; until: string }; // UNTIL — DbDateStr, inclusive end-of-day

interface RecurrenceConfigPart {
  // canonical, RRULE-isomorphic, persisted/synced:
  recurrence: RecurrencePattern;
  end: RecurrenceEnd;
  exDates: string[]; // = today's `deletedInstanceDates`, NOT renamed on the wire
  // SP carve-out — not expressible in RFC 5545:
  repeatFromCompletionDate?: boolean;
}
```

- **Discriminant** is `freq` (+ the monthly `on` shape). Illegal combinations
  (e.g. weekday booleans set on a yearly cfg) become unrepresentable.
- **No derived fields are persisted.** UI affordances (the weekday checkbox row,
  the "Ends" control, `quickSetting`) are computed from `recurrence`/`end` at
  form-open and written back on save — view-model only. This defuses the documented
  formly "whole-model emit" gotcha (no second representation to drift).
- `repeatFromCompletionDate` selects the carve-out engine (see below).

---

## Corrected current state (what already ships)

Verified in `src/app/features/task-repeat-cfg/`:

| Capability                                                 | Status         | Where                                                                             |
| ---------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------- |
| Daily / Weekly / Monthly / Yearly + `repeatEvery` interval | ✅             | `get-next-repeat-occurrence.util.ts`                                              |
| Weekday selection (weekly)                                 | ✅             | 7 booleans, `task-repeat-cfg.model.ts`                                            |
| **Nth weekday of month** ("2nd Tue", "last Fri")           | ✅ #6040       | `monthlyWeekOfMonth` + `monthlyWeekday`; `get-nth-weekday-of-month.util.ts`       |
| **Last day of month**                                      | ✅ #7726       | `monthlyLastDay`; month-end clamp in `get-next-repeat-occurrence.util.ts:101-116` |
| First day of month                                         | ✅             | quick-setting `MONTHLY_FIRST_DAY`                                                 |
| Skip occurrence (EXDATE)                                   | ✅             | `deletedInstanceDates: string[]`                                                  |
| After-completion recurrence                                | ✅ (SP-unique) | `repeatFromCompletionDate` + `getEffectiveRepeatStartDate`                        |
| Wait-for-completion (no pile-up)                           | ✅             | `waitForCompletion`                                                               |
| Skip overdue instances                                     | ✅             | `skipOverdue`                                                                     |
| Pause / resume                                             | ✅             | `isPaused`                                                                        |
| Subtask templates (+ inherit / auto-update flags)          | ✅             | `subTaskTemplates`, `shouldInheritSubtasks`, `disableAutoUpdateSubtasks`          |
| DST-safe calc                                              | ✅             | local-noon anchoring throughout                                                   |
| Deterministic multi-device IDs                             | ✅             | `rpt_${repeatCfgId}_${dueDay}`, `get-repeatable-task-id.util.ts`                  |
| Human-readable description                                 | ✅             | `get-task-repeat-info-text.util.ts`                                               |
| "Next due" preview + history heatmap                       | ✅             | `repeat-cfg-preview/`, `repeat-task-heatmap/`                                     |

**Genuinely missing (delivered in Phase 3):** end conditions (`COUNT`/`UNTIL`),
multiple days per month (`BYMONTHDAY=1,15`), `.ics`/CalDAV RRULE generation
(Phase 1). Deferred / YAGNI: `RDATE`, `RECURRENCE-ID`, `BYSETPOS`, `BYWEEKNO`,
`BYYEARDAY`, sub-daily, full two-way `.ics` import.

---

## Engine decision: keep the synchronous bounded engine

**The occurrence runtime stays the existing synchronous bounded loops**
(`get-next-repeat-occurrence.util.ts`, `get-newest-possible-due-date.util.ts`),
re-pointed to read the new typed `recurrence` field instead of the flat fields.
ical.js is used **only** to serialize/parse the RRULE string at the export/CalDAV
boundary — never on the occurrence hot path.

Consequences:

- No async dependency on the lazy-loaded module in sync selectors; no ~76 KB on
  the boot/projection path.
- The occurrence logic barely changes (same `FREQ/INTERVAL/BYxxx` math, new input
  shape), so the deterministic-ID parity risk is small and an **offline
  golden-master test is sufficient — no production shadow mode required**.
- New common patterns (multi-day-per-month, end conditions) are small extensions
  to the bounded engine. Exotic RRULE parts (`BYSETPOS`, `BYWEEKNO`) are not free;
  defer them, and if ever needed, expand those rare configs via ical.js _off_ the
  hot path.

---

## Phase 1 — Typed model + RRULE serializer + parity harness

Independently shippable; the serializer unblocks the calendar two-way-sync
roadmap's "SP doesn't generate RRULE" critical-path item.

### 1.1 Add the typed `recurrence`/`end` fields (additive, not yet canonical)

Add the union alongside the existing fields. Because validation uses typia
`createValidate` (excess-property-tolerant, **not** `createValidateEquals` —
verified in `validation-fn.ts`), old clients reading the new fields will neither
reject nor strip them — forward-compatible by construction. Confirm no
`data-repair.ts` pass deletes them, and add a forward-compat regression spec.

### 1.2 Bidirectional serializer (typed ⇄ RRULE string)

A pure module (e.g. `task-repeat-cfg/rrule/`). `typed → RRULE` is simple string
assembly (or `ICAL.Recur.fromData({...}).toString()`); `RRULE → typed` (for `.ics`
import) uses ical.js parsing. Field mapping — must cover everything:

| Typed model                                                                         | RRULE                                                                                          |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `{freq, interval}`                                                                  | `FREQ=...;INTERVAL=...`                                                                        |
| WEEKLY `byDay`                                                                      | `BYDAY=MO,WE,...` (+ `WKST` from user `firstDayOfWeek`)                                        |
| MONTHLY `on.monthDay`                                                               | `BYMONTHDAY=<n>`                                                                               |
| MONTHLY `on.lastDay`                                                                | `BYMONTHDAY=-1`                                                                                |
| MONTHLY `on.{week,day}`                                                             | `BYDAY=<week><DD>` (`-1`=last)                                                                 |
| YEARLY `{month, day}`                                                               | `BYMONTH=<m>;BYMONTHDAY=<d>` (document Feb-29 → Feb-28; no RFC equivalent)                     |
| `end.count` / `end.until`                                                           | `COUNT=` / `UNTIL=` (end-of-day UTC)                                                           |
| `exDates`                                                                           | `EXDATE` (export only; do not rename the wire field)                                           |
| `repeatFromCompletionDate`                                                          | **Not expressible** — serializer refuses/flags; such configs are export-incompatible by nature |
| `startTime`, `remindAt`, `waitForCompletion`, `skipOverdue`, subtask flags, `order` | SP extensions, out of band of RRULE — preserve                                                 |

### 1.3 DTSTART / date-basis correctness (the part that bites)

- **DTSTART is local-noon of the anchor day, time component stripped.** The legacy
  engine never uses `startTime` for date math — it anchors at `setHours(12,…)`
  (`get-next-repeat-occurrence.util.ts:36`). A non-noon DTSTART makes ical.js emit
  occurrences at a different instant that can roll to a different **calendar day**
  across a day/DST boundary → broken parity and shifted IDs. `startTime` stays a
  post-expansion task-template field, not part of DTSTART date math.
- **EXDATE by day-string**, not instant equality: filter generated occurrences by
  `getDbDateStr(occurrence)` against `exDates`.
- **`UNTIL` is inclusive end-of-day.**
- **`WKST` from `firstDayOfWeek`**, or bi-weekly (`INTERVAL=2`) occurrences shift.

### 1.4 Occurrence-parity golden master (the gate)

Differential harness: the engine reading the **typed** field yields
**byte-identical occurrence dates** to today's engine reading the flat fields, for
every config shape (daily, weekly multi-day, `repeatEvery>1`, monthly-by-date,
monthly-nth-weekday, monthly-last-day, yearly, Feb-29), over a multi-year window,
in **both** CI timezones, across DST boundaries. Cap occurrences-per-shape so the
test can't blow up if a sub-daily freq is added later. Completion-based configs are
**out of scope** for the harness (different engine). Migration is gated on 100%
parity. Serializer round-trips (`typed → RRULE → typed`) are property-tested.

---

## Phase 2 — Versioned migration (via the op-log schema system)

> Corrected mechanism. **Not** `pfapi-config.js` — that file is
> `@deprecated LEGACY CODE` (its `CROSS_MODEL_VERSION` is a stale `4.4` and it
> `require`s a `./migrate/cross-model-migrations` path that no longer exists).

Migrate via the live op-log schema system:

- Add a `vN → vN+1` entry to `packages/shared-schema/src/migrations/` (registry
  `index.ts`), supplying **both** `migrateState` (snapshot) and `migrateOperation`
  (in-flight ops), and bump `CURRENT_SCHEMA_VERSION`
  (`packages/shared-schema/src/schema-version.ts`). Applied by
  `src/app/op-log/persistence/schema-migration.service.ts` /
  `remote-ops-processing.service.ts`. The conversion itself is pure O(1)
  string/struct assembly per config — cheap even for many configs; the migration
  must **not** expand occurrences per config.
- **Cross-version story (resolve the old-client contradiction):** you cannot both
  retire the flat fields _and_ have old clients keep computing from them. The
  decision is to gate via **`MIN_SUPPORTED_SCHEMA_VERSION`**: pre-typed clients
  fall below the minimum and get the existing "update required"
  (`VERSION_UNSUPPORTED`) flow before they can apply typed-model ops. State this as
  a deliberate, breaking, update-required step with its UX consequence — it is the
  real safety mechanism, not "atomic flip" (op-log migration is per-op on receive,
  not a single fleet-wide transaction).
- **Never rename `deletedInstanceDates` on the wire.** Keep the synced field name;
  `exDates` is the in-memory/typed name and `EXDATE` the export name. Under
  whole-entity LWW, an old client that wins a conflict re-emits the entity without
  a renamed field and destroys the skip list fleet-wide; the partial-update
  shallow-merge path is a second destruction vector. (If keeping the literal
  property name is preferred, do that — the point is: no rename of the persisted
  key.)

---

## Phase 3 — RRULE-native features

With the typed model canonical, new patterns are typed-union additions + small
bounded-engine extensions:

- **End conditions.** `end: {type:'count'|'until'}`, enforced as a guard in the
  occurrence loop (return `null` past the bound). UI "Ends" control derives from
  `end`, persists nothing extra. Labels via `T`/`TranslateService` (`en.json`
  only).
- **Multiple days per month** (`BYMONTHDAY=1,15`) etc., as the model/engine grow.

### Phase 3 tests

- No occurrences past `COUNT`/`UNTIL`, each freq, both CI timezones.
- **Decide & test `COUNT` vs `exDates`:** does a skipped instance consume a count?
  (ical.js counts pre-EXDATE; SP filters post-generation — pick "10 actual tasks"
  vs "10 scheduled" deliberately and test it.)
- `UNTIL` boundary: end day included, next day excluded.

---

## `repeatFromCompletionDate` carve-out

Not a separate _engine_ — it runs the same `FREQ/INTERVAL` calc but re-anchors the
**start date** to `lastTaskCreationDay` each cycle (`getEffectiveRepeatStartDate`).
So the real risk is feeding a **wrong DTSTART/anchor**, not "wrong engine":

- It has **no stable DTSTART** → not RRULE-expressible; the serializer refuses it
  (export-incompatible by nature).
- Model it as the union variant + the `repeatFromCompletionDate` flag; route to the
  dynamically-anchored calc **before** any fixed-anchor path.
- Honest code-reduction accounting: only the fixed-schedule plumbing is deleted;
  the completion path stays.

---

## Risk register

| Risk                                                                    | Severity    | Mitigation                                                                     |
| ----------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------ |
| Occurrence dates shift on model swap → re-keyed instances               | **Blocker** | Keep the existing bounded engine; Phase-1 golden master gates migration        |
| Cross-version sync: old client can't read typed model                   | **Blocker** | `MIN_SUPPORTED_SCHEMA_VERSION` force-update gate (not "compute from legacy")   |
| Renaming the `deletedInstanceDates` wire key loses skip data            | High        | Do not rename the persisted key; `EXDATE` only at export                       |
| `repeatFromCompletionDate` fed a fixed DTSTART → becomes fixed-calendar | High        | Route completion mode before any fixed-anchor path; re-anchor per cycle        |
| Wrong migration subsystem (`pfapi-config.js`)                           | High        | Use `packages/shared-schema` migrations + `schema-migration.service.ts`        |
| Hot-path regression from async/forward-only ical.js iteration           | High        | ical.js for string parse/serialize only; sync bounded engine stays the runtime |
| DTSTART carries `startTime` → day rolls                                 | High        | DTSTART = local-noon of anchor day; `startTime` applied post-expansion         |
| EXDATE never matches (instant vs noon)                                  | Medium      | Filter by `getDbDateStr` day-string                                            |
| Bi-weekly shifts (WKST default)                                         | Medium      | Thread `firstDayOfWeek` → `WKST`                                               |
| `UNTIL` drops final day                                                 | Medium      | Inclusive end-of-day                                                           |
| ~~Production shadow mode cost~~                                         | n/a         | Not needed — engine unchanged; offline golden master covers parity             |
| ~~Bundle size of new dep~~                                              | n/a         | No new dep — ical.js already present & lazy-loaded                             |

---

## Measurable success criteria (gates)

1. **Phase-1 parity:** typed-field engine == flat-field engine for the full
   config-shape corpus over a 5-year window, both CI timezones; harness green in CI.
2. **Serializer round-trips** `typed → RRULE → typed` for every shape
   (property-tested), incl. monthly-nth-weekday and last-day.
3. **No new runtime dependency** (ical.js only, boundary-only).
4. **No synced field key renamed** (`deletedInstanceDates` stays on the wire).
5. **Forward-compat:** an old client reading the new fields neither errors nor
   strips them (regression spec).
6. After migration, `repeatFromCompletionDate`, `waitForCompletion`, `skipOverdue`,
   subtask templates, and skip-list behavior are unchanged (regression specs green).
7. **Phase-3 end conditions** ship with tests passing in both CI timezones; UI
   end-state is derived, not persisted.

---

## Files in play (verified paths)

| Area                                                                           | File                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model                                                                          | `src/app/features/task-repeat-cfg/task-repeat-cfg.model.ts` (`TaskRepeatCfgCopy`)                                                                                                                                                                                                      |
| Occurrence engine (kept, re-pointed to typed field)                            | `store/get-next-repeat-occurrence.util.ts`, `store/get-newest-possible-due-date.util.ts`, `store/get-first-repeat-occurrence.util.ts`, `store/get-nth-weekday-of-month.util.ts`, `store/get-effective-repeat-start-date.util.ts`, `store/get-effective-last-task-creation-day.util.ts` |
| Deterministic ID (must stay stable)                                            | `get-repeatable-task-id.util.ts`                                                                                                                                                                                                                                                       |
| Selectors / projection                                                         | `store/task-repeat-cfg.selectors.ts`                                                                                                                                                                                                                                                   |
| Service / creation                                                             | `task-repeat-cfg.service.ts`                                                                                                                                                                                                                                                           |
| Quick settings / dialog UI                                                     | `dialog-edit-task-repeat-cfg/` (form const, quick-setting updates, build options)                                                                                                                                                                                                      |
| Human-readable text                                                            | `src/app/features/tasks/task-detail-panel/get-task-repeat-info-text.util.ts`                                                                                                                                                                                                           |
| RRULE serialize/parse (boundary only)                                          | `src/app/features/schedule/ical/ical-lazy-loader.ts` (reuse loader)                                                                                                                                                                                                                    |
| Migration (corrected)                                                          | `packages/shared-schema/src/migrations/` (+ `index.ts`), `packages/shared-schema/src/schema-version.ts` (`CURRENT_SCHEMA_VERSION`, `MIN_SUPPORTED_SCHEMA_VERSION`), `src/app/op-log/persistence/schema-migration.service.ts`                                                           |
| Validation / repair                                                            | `src/app/op-log/validation/` (`createValidate`, `data-repair.ts`)                                                                                                                                                                                                                      |
| Calendar roadmap (note: predates #6040/#7726/`deletedInstanceDates`)           | `docs/long-term-plans/calendar-two-way-sync-technical-analysis.md` (CalDAV VEVENT expansion shipped as the `caldav-calendar-provider` plugin)                                                                                                                                           |

---

## Appendix A — Competitor comparison

Reference for "what users expect" (verified SP column as of 2026-06; the
remaining ❌ are the genuine targets — end conditions). Consolidated from the
former `recurring-events-gap-analysis.md` / `recurring-events-industry-standards.md`.

| Feature              | Google Calendar | Todoist | Things 3 | TickTick | Super Productivity |
| -------------------- | --------------- | ------- | -------- | -------- | ------------------ |
| Basic (D/W/M/Y)      | ✅              | ✅      | ✅       | ✅       | ✅                 |
| Every N interval     | ✅              | ✅      | ✅       | ✅       | ✅                 |
| Weekday selection    | ✅              | ✅      | ✅       | ✅       | ✅                 |
| Nth weekday of month | ✅              | ✅      | ✅       | ✅       | ✅ (#6040)         |
| Last day of month    | ✅              | ✅      | ✅       | ✅       | ✅ (#7726)         |
| End after N times    | ✅              | ❌      | ❌       | ✅       | ❌ (Phase 3)       |
| End on date          | ✅              | ❌      | ❌       | ✅       | ❌ (Phase 3)       |
| After completion     | ❌              | ✅      | ✅       | ✅       | ✅ (carve-out)     |
| Skip occurrence      | ✅              | ✅      | ✅       | ✅       | ✅                 |
| Natural language     | ✅              | ✅      | ❌       | ❌       | ✅ (info text)     |
| iCal export          | ✅              | ✅      | ❌       | ✅       | ❌ (Phase 1)       |

---

## Appendix B — RFC 5545 RRULE reference

The iCalendar spec (RFC 5545) `RRULE` property is the recurrence standard the
typed model mirrors and the serializer targets.

**Core components**

| Parameter           | Meaning                    | Values                                                                   |
| ------------------- | -------------------------- | ------------------------------------------------------------------------ |
| **FREQ** (required) | Frequency                  | `YEARLY`, `MONTHLY`, `WEEKLY`, `DAILY`, `HOURLY`, `MINUTELY`, `SECONDLY` |
| **INTERVAL**        | Spacing between iterations | positive integer (default 1)                                             |
| **COUNT**           | Number of occurrences      | positive integer                                                         |
| **UNTIL**           | End date(-time)            | DATE or DATE-TIME                                                        |
| **WKST**            | Week start day             | `MO`…`SU` (default `MO`)                                                 |

**BYxxx parts**

| Parameter      | Meaning             | Values                                             |
| -------------- | ------------------- | -------------------------------------------------- |
| **BYDAY**      | Days of week        | `MO`…`SU`, optional ordinal prefix (`2TU`, `-1FR`) |
| **BYMONTH**    | Months              | 1–12                                               |
| **BYMONTHDAY** | Days of month       | 1..31 or -31..-1 (negative = from end)             |
| **BYYEARDAY**  | Days of year        | 1..366 / -366..-1                                  |
| **BYWEEKNO**   | ISO week numbers    | 1..53 / -53..-1                                    |
| **BYSETPOS**   | Position within set | 1..366 / -366..-1                                  |

`BYDAY` ordinal prefix: `1MO`/`+1MO` = first Monday, `-1MO` = last Monday,
`2TU` = second Tuesday.

**Examples**

```
FREQ=DAILY;COUNT=10                         # daily, 10 times
FREQ=WEEKLY;UNTIL=20241231T235959Z;BYDAY=MO,FR
FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR       # every other week, M/W/F
FREQ=MONTHLY;BYMONTHDAY=15                   # 15th
FREQ=MONTHLY;BYMONTHDAY=-1                   # last day
FREQ=MONTHLY;BYDAY=2TU                       # 2nd Tuesday
FREQ=MONTHLY;BYDAY=-1FR                      # last Friday
```

**Exceptions:** `EXDATE` excludes occurrences (= SP `deletedInstanceDates`);
`RDATE` adds them (deferred — see "Genuinely missing").
