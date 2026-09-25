# Recurring Events Implementation Plan

> **Read `rrule-epic-roadmap.md` on `feat/rrule-epic` first.** This plan is the
> _design rationale_ companion to a live epic, not a greenfield proposal. Much of
> what follows is already implemented on that branch (forward/inverse RRULE
> converters, the old-client compatibility contract, an off-by-default per-device
> engine flag), and the branch resolved several questions this document still
> poses as open. Check there before planning or building anything here.
>
> **Reconciled 2026-08-21: the branch's raw-`rrule`-string design stands** —
> see the Decision note below for what is superseded and why it is kept.

> **Revision note (verified against code 2026-06-02).** Rewritten after two rounds
> of multi-axis review against the actual codebase. The original draft was built on
> three false premises and several sync-unsafe steps; a later "raw RRULE string as
> the model" revision was then corrected again after review surfaced real costs in
> this codebase. Net premises now driving the plan:
>
> 1. **The RRULE engine is already in the repo.** `ical.js@2.2.1` is already in
>    `package.json` (a **devDependency**, not `dependencies`), lazy-loaded (`src/app/features/schedule/ical/ical-lazy-loader.ts`), and
>    expands RRULEs in **two** places
>    (`get-relevant-events-from-ical.ts`,
>    `packages/plugin-dev/caldav-calendar-provider/src/plugin.ts`).
>    `caldav-client.service.ts` uses ical.js only to parse VTODO — it does **not**
>    expand RRULEs. **Do not add `rrule` (rrule.js).** _(Superseded on this
>    point: the epic added pinned `rrule@2.8.1` as its engine — see the
>    Decision note.)_
> 2. **The headline "critical gaps" already shipped.** Nth-weekday of month
>    (#6040), last-day-of-month (#7726), EXDATE (`deletedInstanceDates`). Earlier
>    gap-analysis/industry-standards research drafts marked these missing; that was
>    stale and those docs have been folded into this one (see Appendices A–B).
> 3. **`TaskRepeatCfg` is synced state.** The model change must go through the
>    op-log schema-migration system (`packages/shared-schema/src/migrations/`),
>    keep the deterministic ID `rpt_${repeatCfgId}_${dueDay}` stable, and not break
>    cross-version sync. This dominates the risk profile.

---

## Decision (superseded): a typed, RRULE-isomorphic recurrence model

> **Superseded 2026-08-21.** The standing decision is the epic branch's: a raw
> `rrule?: string` added alongside the legacy flat fields, which stay
> dual-written forever as the wire format. Everything from here down is the
> superseded typed-model plan, kept because its correctness constraints
> (DTSTART/noon anchoring, EXDATE day-string matching, `UNTIL` inclusivity,
> WKST, monthly-anchor precedence, the parity gate, the wire-rename and
> migration warnings) apply to the epic's serializer and engine just the same —
> only the persisted shape differs.

The superseded plan: the recurrence **pattern** becomes a single typed,
structured field — a discriminated union that maps **1:1 to RFC 5545** —
replacing the ~14 interdependent flat fields (`repeatCycle`, `repeatEvery`, the
7 weekday booleans, `monthlyWeekOfMonth`, `monthlyWeekday`, `monthlyLastDay`,
`quickSetting`).

The RFC-5545 **RRULE string is produced/parsed only at the boundary** (`.ics`
export, CalDAV). **The raw string is never the persisted/synced field.**

### Why the raw-string rejection was stale (reconciled 2026-08-21)

An earlier revision rejected a raw `rrule` string as the canonical field on
three grounds. Checked against what `feat/rrule-epic` actually built, each
objection is answered by a design decision the rejection did not anticipate:

- **"Un-queryable."** The branch adds `rrule?: string` _additively_ and
  **dual-writes the legacy flat fields forever** — they are the wire format for
  old clients (roadmap, "Dual-engine endgame" §4). Selectors and any field-level
  consumer keep a structured representation; nothing is forced to parse the
  string on projection.
- **"Un-diffable / un-repairable."** Same dual-write: the op-log still diffs the
  legacy fields, and `data-repair.ts` still repairs them. For the string itself
  the branch has an explicit policy instead of silent corruption: the engine is
  fail-soft (malformed `rrule` → log + `null`, never a throw), `isRRuleValid`
  gates routing (invalid → legacy fallback), and the decided post-legacy-engine
  behavior for an invalid string is **pause + repair prompt**, never silent
  rescheduling.
- **"Hot-path performance."** The objection assumed the expansion engine would
  be ical.js (async, lazy-loaded, forward-only). The branch's engine is
  **rrule.js (`rrule@2.8.1`, pinned exact) — synchronous** — in a dedicated
  day-granular, UTC-based occurrence util (`store/rrule-occurrence.util.ts`).
  It runs inside the existing sync calculators; no async dependency enters the
  selector path. (Implementation specifics live on the branch — the roadmap is
  the source of truth for current mechanics.)

The one cost the old reasoning weighed correctly: **`rrule` is a new root
runtime dependency**, which the project rules normally forbid. The
maintainer-owned epic accepted it deliberately and treats it like an engine —
pinned to an exact version, with a differential spec battery as the upgrade
tripwire (a parser-version drift between devices is a duplicate-task generator,
see the roadmap's risk model). That trade is decided; do not relitigate it here,
and do not un-pin the version.

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

## The typed model (superseded — kept as rationale record)

> Superseded — see the Decision note above. Kept because the invariant
> analysis below is the best record of the legacy fields' implicit precedence
> rules.

The sketch replaced the flat pattern fields in `TaskRepeatCfgCopy`
(`task-repeat-cfg.model.ts` — edit `TaskRepeatCfgCopy`, not the `Readonly` alias)
with one discriminated union plus an end condition. Sketch (final names TBD):

```typescript
type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';

type RecurrencePattern =
  | { freq: 'DAILY'; interval: number }
  | { freq: 'WEEKLY'; interval: number; byDay: Weekday[] } // WKST derived, never persisted — see 1.3
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
  deletedInstanceDates: string[]; // wire name kept verbatim — `exDates` would be exactly the forbidden rename
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
| **Last day of month**                                      | ✅ #7726       | `monthlyLastDay`; month-end clamp in `get-next-repeat-occurrence.util.ts:125-140` |
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
(Phase 1). Deferred / YAGNI: `RDATE`, `RECURRENCE-ID`, `BYWEEKNO`, `BYYEARDAY`,
sub-daily, full two-way `.ics` import. `BYSETPOS`: needed only for the
serializer's month-end clamp idiom (see the Phase-1 mapping table); general
engine-side expansion stays deferred.

---

## Engine decision: keep the synchronous bounded engine

> _Reconciled:_ holds for legacy/flag-off cfgs; flag-on `rrule` cfgs route to
> the branch's synchronous rrule.js engine (see "Why the raw-string rejection
> was stale"). ical.js stays boundary-only either way — the paragraph below
> records why, and still stands.

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
  to the bounded engine. Exotic RRULE parts (general `BYSETPOS`, `BYWEEKNO`) are not free;
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

| Typed model                                                                         | RRULE                                                                                                                                 |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `{freq, interval}`                                                                  | `FREQ=...;INTERVAL=...`                                                                                                               |
| WEEKLY `byDay`                                                                      | `BYDAY=MO,WE,...` (WKST: see 1.3)                                                                                                     |
| MONTHLY `on.monthDay`                                                               | `BYMONTHDAY=<n>` (n ≤ 28); 29–31 → clamp idiom `BYMONTHDAY=<n>,-1;BYSETPOS=1` (SP clamps to month-end, plain `BYMONTHDAY` skips)      |
| MONTHLY `on.lastDay`                                                                | `BYMONTHDAY=-1`                                                                                                                       |
| MONTHLY `on.{week,day}`                                                             | `BYDAY=<week><DD>` (`-1`=last)                                                                                                        |
| YEARLY `{month, day}`                                                               | `BYMONTH=<m>;BYMONTHDAY=<d>`; Feb-29 → same clamp idiom (`BYMONTH=2;BYMONTHDAY=29,-1;BYSETPOS=1`, clamps to Feb-28 in non-leap years) |
| `end.count` / `end.until`                                                           | `COUNT=` / `UNTIL=` (end-of-day UTC)                                                                                                  |
| `deletedInstanceDates`                                                              | `EXDATE` (export only; the wire field name stays verbatim)                                                                            |
| `repeatFromCompletionDate`                                                          | **Not expressible** — serializer refuses/flags; such configs are export-incompatible by nature                                        |
| `startTime`, `remindAt`, `waitForCompletion`, `skipOverdue`, subtask flags, `order` | SP extensions, out of band of RRULE — preserve                                                                                        |
| `isPaused`                                                                          | No RRULE equivalent — serializer skips or flags a paused cfg (see below)                                                              |
| `lastTaskCreationDay` / `lastTaskCreation`                                          | Internal creation cursor, out of band of RRULE — never exported, never derived from an imported rule                                  |

`isPaused` short-circuits all occurrence generation
(`store/task-repeat-cfg.selectors.ts:102,142`), so exporting a paused cfg as a
live RRULE would promise occurrences SP never creates.

The three MONTHLY rows are **not independent** — the engine resolves one anchor
with fixed precedence: nth-weekday (`monthlyWeekOfMonth` + `monthlyWeekday`,
checked first at `get-next-repeat-occurrence.util.ts:110`) → `monthlyLastDay` →
startDate's day-of-month. A row-by-row serializer that emits parts for a cfg
carrying several anchors produces `BYMONTHDAY=-1;BYDAY=2TU` — in RFC 5545 an
**intersection**, usually the empty set. Serialize exactly one anchor, in that
precedence order (the epic branch's `legacyTaskRepeatCfgToRRule` switch does
exactly this).

### 1.3 DTSTART / date-basis correctness (the part that bites)

- **DTSTART is local-noon of the anchor day, time component stripped.** The legacy
  engine never uses `startTime` for date math — it anchors at `setHours(12,…)`
  (`get-next-repeat-occurrence.util.ts:43-45`). A non-noon DTSTART makes ical.js emit
  occurrences at a different instant that can roll to a different **calendar day**
  across a day/DST boundary → broken parity and shifted IDs. `startTime` stays a
  post-expansion task-template field, not part of DTSTART date math.
- **EXDATE by day-string**, not instant equality: filter generated occurrences by
  `getDbDateStr(occurrence)` against `exDates`.
- **`UNTIL` is inclusive end-of-day.**
- **`WKST` = weekday of the effective startDate** — or emit no `WKST` and
  re-anchor DTSTART instead, as the epic branch does (`getAlignedStartDate`).
  **Not** user `firstDayOfWeek`: that setting is display-only
  (`src/app/core/date-time-format/custom-date-adapter.ts:19`). The engine counts
  rolling 7-day blocks from the startDate's weekday
  (`getDiffInWeeks(startDate, d) % repeatEvery`,
  `get-next-repeat-occurrence.util.ts:88,95-96`), so a calendar-week `WKST`
  shifts bi-weekly (`INTERVAL=2`) occurrences. Counterexample: startDate Wed
  2026-01-07, `INTERVAL=2`, `BYDAY=MO,FR` — SP fires Mon 01-12; `WKST=MO` fires
  Mon 01-19.

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
- **Cross-version story (resolve the old-client contradiction).** _Corrected
  2026-08 — see #9664._ An earlier revision of this bullet named
  **`MIN_SUPPORTED_SCHEMA_VERSION`** as a "force-update gate" that would push
  pre-typed clients through the `VERSION_UNSUPPORTED` flow. That is backwards.
  It is a lower bound applied to data _this_ client reads
  (`remote-ops-processing.service.ts:177`, `operation-log-sync.service.ts:2318`,
  `verify-decrypted-op-integrity.ts:139`, `migrate.ts:49,115`); senders stamp
  `CURRENT_SCHEMA_VERSION` only, and no server-side client-version gate exists.
  Raising it would wedge the **updated** client — the block halts the cycle
  before upload (`sync-wrapper.service.ts:595-606`), the cursor is not advanced,
  and the `VERSION_UNSUPPORTED` snack deliberately carries no remedy
  (`remote-ops-processing.service.ts:540-546`, "updating THIS device cannot
  help"). It never prompts the old device. **There is no version gate here.**

  Nor does a `CURRENT_SCHEMA_VERSION` bump supply one for the _currently
  released_ fleet: master is at 4, so a bump lands on 5 — inside the
  v17.0.0–v18.14.0 tolerated band (`2 + 3`) — and those clients apply the ops
  **unmigrated**; a bump to 6 blocks them but still advances their cursor,
  permanently skipping the ops. (Post-v18.14.0 receivers _do_ block safely, so a
  bump becomes a real fence once that cohort ages out.) See
  `packages/shared-schema/src/schema-version.ts` and
  `docs/sync-and-op-log/operation-log-architecture.md` §A.7.11.

- **The mechanism that actually solves this is already built on
  `feat/rrule-epic`** — do not re-derive it. The legacy schedule fields stay
  populated alongside the new representation as the wire format for old clients
  (`util/legacy-cfg-to-rrule.util.ts`), under an **exact-or-null contract**:
  where the rule is within legacy expressiveness the legacy fields fire on the
  same days; where it is not (`COUNT`/`UNTIL`, seasonal `BYMONTH`,
  `BYWEEKNO`/`BYYEARDAY`, multi-day lists, out-of-union ordinals) the
  `LEGACY_NEVER_FIRES_FALLBACK` sentinel is written instead — an all-false
  `WEEKLY` cfg, which every released version deterministically never fires. Old
  clients create **nothing** rather than tasks on wrong days that would sync
  back. `getAlignedStartDate` handles `startDate`'s double duty as both the
  monthly/yearly day encoding and the interval anchor. The off-by-default
  per-device flag (`RRuleFeatureFlagService`, localStorage, never synced) keeps
  the legacy engine authoritative while the epic is incomplete — that flag, not
  a schema gate, is what makes half-built phases safe.
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

| Risk                                                                    | Severity    | Mitigation                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Occurrence dates shift on model swap → re-keyed instances               | **Blocker** | Keep the existing bounded engine; Phase-1 golden master gates migration                                                                                                                          |
| Cross-version sync: old client can't read typed model                   | **Blocker** | No version gate exists (#9664). Keep legacy fields populated on the wire under the exact-or-null contract; `LEGACY_NEVER_FIRES_FALLBACK` for inexpressible rules; per-device flag gates the epic |
| Renaming the `deletedInstanceDates` wire key loses skip data            | High        | Do not rename the persisted key; `EXDATE` only at export                                                                                                                                         |
| `repeatFromCompletionDate` fed a fixed DTSTART → becomes fixed-calendar | High        | Route completion mode before any fixed-anchor path; re-anchor per cycle                                                                                                                          |
| Wrong migration subsystem (`pfapi-config.js`)                           | High        | Use `packages/shared-schema` migrations + `schema-migration.service.ts`                                                                                                                          |
| Hot-path regression from async/forward-only ical.js iteration           | High        | ical.js for string parse/serialize only; sync bounded engine stays the runtime                                                                                                                   |
| DTSTART carries `startTime` → day rolls                                 | High        | DTSTART = local-noon of anchor day; `startTime` applied post-expansion                                                                                                                           |
| EXDATE never matches (instant vs noon)                                  | Medium      | Filter by `getDbDateStr` day-string                                                                                                                                                              |
| Bi-weekly shifts (WKST default)                                         | Medium      | startDate-derived WKST, or omit + re-anchor — see 1.3                                                                                                                                            |
| `UNTIL` drops final day                                                 | Medium      | Inclusive end-of-day                                                                                                                                                                             |
| ~~Production shadow mode cost~~                                         | n/a         | Not needed — engine unchanged; offline golden master covers parity                                                                                                                               |
| ~~Bundle size of new dep~~                                              | n/a         | No new dep in the typed-model plan (the epic did add pinned `rrule` — see the Decision note)                                                                                                     |

---

## Measurable success criteria (gates)

1. **Phase-1 parity:** typed-field engine == flat-field engine for the full
   config-shape corpus over a 5-year window, both CI timezones; harness green in CI.
2. **Serializer round-trips** `typed → RRULE → typed` for every shape
   (property-tested), incl. monthly-nth-weekday and last-day.
3. **No new runtime dependency** (ical.js only, boundary-only). _(Superseded —
   the epic deliberately added pinned `rrule`; see the Decision note.)_
4. **No synced field key renamed** (`deletedInstanceDates` stays on the wire).
5. **Forward-compat:** an old client reading the new fields neither errors nor
   strips them (regression spec).
6. After migration, `repeatFromCompletionDate`, `waitForCompletion`, `skipOverdue`,
   subtask templates, and skip-list behavior are unchanged (regression specs green).
7. **Phase-3 end conditions** ship with tests passing in both CI timezones; UI
   end-state is derived, not persisted.

---

## Files in play (verified paths)

| Area                                                                        | File                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model                                                                       | `src/app/features/task-repeat-cfg/task-repeat-cfg.model.ts` (`TaskRepeatCfgCopy`)                                                                                                                                                                                                                               |
| Occurrence engine (kept, re-pointed to typed field)                         | `store/get-next-repeat-occurrence.util.ts`, `store/get-newest-possible-due-date.util.ts`, `store/get-first-repeat-occurrence.util.ts`, `store/get-nth-weekday-of-month.util.ts`, `store/get-effective-repeat-start-date.util.ts`, `store/get-effective-last-task-creation-day.util.ts`                          |
| Deterministic ID (must stay stable)                                         | `get-repeatable-task-id.util.ts`                                                                                                                                                                                                                                                                                |
| Selectors / projection                                                      | `store/task-repeat-cfg.selectors.ts`                                                                                                                                                                                                                                                                            |
| Service / creation                                                          | `task-repeat-cfg.service.ts`                                                                                                                                                                                                                                                                                    |
| Quick settings / dialog UI                                                  | `dialog-edit-task-repeat-cfg/` (form const, quick-setting updates, build options)                                                                                                                                                                                                                               |
| Human-readable text                                                         | `src/app/features/tasks/task-detail-panel/get-task-repeat-info-text.util.ts`                                                                                                                                                                                                                                    |
| RRULE serialize/parse (boundary only)                                       | `src/app/features/schedule/ical/ical-lazy-loader.ts` (reuse loader)                                                                                                                                                                                                                                             |
| Migration (corrected)                                                       | `packages/shared-schema/src/migrations/` (+ `index.ts`), `packages/shared-schema/src/schema-version.ts` (`CURRENT_SCHEMA_VERSION` — note `MIN_SUPPORTED_SCHEMA_VERSION` is _not_ a cross-version gate, #9664), `src/app/op-log/persistence/schema-migration.service.ts`                                         |
| Old-client wire compatibility (already built on `feat/rrule-epic`)          | `src/app/features/task-repeat-cfg/util/legacy-cfg-to-rrule.util.ts` (`legacyTaskRepeatCfgToRRule`, `rruleToLegacyTaskRepeatCfg`, `LEGACY_NEVER_FIRES_FALLBACK`, `getAlignedStartDate`), `src/app/features/config/rrule-feature-flag.service.ts`                                                                 |
| Validation / repair                                                         | `src/app/op-log/validation/` (`createValidate`, `data-repair.ts`)                                                                                                                                                                                                                                               |
| Calendar write boundary (note: predates #6040/#7726/`deletedInstanceDates`) | [ARCHITECTURE-DECISIONS.md #9 — calendar writes live in plugins](../../ARCHITECTURE-DECISIONS.md#9-calendar-writes-live-in-plugins-behind-per-provider-opt-in). CalDAV VEVENT expansion shipped as the `caldav-calendar-provider` plugin; per-occurrence edits (`RECURRENCE-ID`/`EXDATE`) are still open, #8148 |

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
