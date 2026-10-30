# Plan: Address PR #10435 Feedback

## Current State

### What's Working

- Week number calculation logic (`getWeekNumber.ts`) - ISO and US branches
- Planner calendar week numbers - showing when ISO/US selected
- Datetime picker week numbers - showing when ISO/US selected

### Critical Issues from Review (Needs Fixing)

#### 1. **ISO Week Calculation Ignores `firstDayOfWeek`** (BLOCKING)

**Location:** `src/app/util/get-week-number.ts:70-87`

**Problem:** The ISO branch ignores `firstDayOfWeek` parameter entirely, per ISO 8601. However, the **worklog component** passes the user's actual `firstDayOfWeek` setting (not 1), expecting ISO week numbers to be calculated based on Monday regardless.

**Current code:**

```typescript
// ISO branch - firstDayOfWeek is ignored
const daysToThursday = 4 - (isoDate.getUTCDay() === 0 ? 7 : isoDate.getUTCDay());
```

**Issue:** For a Sunday-first user with worklog:

- Week starting Sun 3 Jan 2027 was week 1 on master
- Now shows week 53 (wrong)

**Why:** ISO week 1 must contain the first Thursday. The `firstDayOfWeek` should NOT affect ISO week calculation.

**Fix:** This is **correct behavior** - ISO weeks should ignore `firstDayOfWeek`. The issue is that:

1. Worklog was passing arbitrary `firstDayOfWeek` values
2. Now ISO weeks correctly ignore it
3. This is a **breaking change** for existing behavior

**Decision needed:**

- Option A: Keep ISO ignoring `firstDayOfWeek` (correct per ISO 8601), accept worklog shows different weeks
- Option B: Revert ISO branch to use `firstDayOfWeek` (incorrect per spec, but matches old behavior)

**Recommendation:** Option A (correct ISO behavior) - document that worklog weeks now follow ISO standard, not user's first day setting.

---

#### 2. **Schedule Header Week Label Hidden by Default** (BLOCKING)

**Location:** `src/app/features/schedule/schedule/schedule.component.ts:245`

**Problem:** When `weekNumberSystem` is `null`/`undefined` (default), the header shows plain date range only, no week number. This breaks the existing behavior where users saw "Week 42 · Oct 12 – 18".

**Current code:**

```typescript
if (!this.showWeekNumbers() || !weekNumberSystem || weekNumberSystem === 'none') {
  // No week number shown
  return `${startStr} – ${endStr}`;
}
```

**Issue:** Default is `undefined`, so `showWeekNumbers()` returns `false`.

**Fix:**

1. Show week label when setting is `undefined` (default), numbered as ISO/Monday-based
2. Use setting only to switch to US numbering if chosen

**Implementation:**

```typescript
const localization = this._globalConfigService.localization();
const weekNumberSystem = localization?.weekNumberSystem;

// Show week numbers if explicitly set to ISO/US, OR if undefined (default)
const shouldShowWeekNumbers =
  weekNumberSystem === 'iso' ||
  weekNumberSystem === 'us' ||
  weekNumberSystem === undefined;

// For default (undefined), always use ISO/Monday-based
const firstDayOfWeek = weekNumberSystem === 'us' ? 0 : 1;
const weekNumber = getWeekNumber(start, firstDayOfWeek, weekNumberSystem || 'iso');
```

---

#### 3. **Planner Calendar Grid Misaligned When Week Numbers Hidden** (BLOCKING)

**Location:** `src/app/features/planner/planner-calendar-nav/planner-calendar-nav.component.scss:16`

**Problem:** When week numbers are hidden (default), the grid breaks because `grid-template-columns` is missing.

**Current state:**

- Base rule lost `grid-template-columns: repeat(7, 1fr)`
- Default: one-column grid (weeks stack vertically)
- Should be: 7-column grid for weekday labels

**Fix:**

```scss
// Base rule (when week numbers hidden)
grid-template-columns: repeat(7, 1fr);

// With week numbers: 24px column + 7 day columns
.has-week-col {
  grid-template-columns: 24px repeat(7, 1fr);
}
```

---

#### 4. **US Week Calculation Uses UTC Getters on Local Date** (BLOCKING)

**Location:** `src/app/util/get-week-number.ts:12-66`

**Problem:** US branch builds date like this:

```typescript
const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
```

This creates a UTC date, but `date` is already local. For eastern time zones:

- Local midnight on Jan 3, 2027 = Dec 31, 2026 in UTC
- Week calculation uses wrong year

**Fix:** Already done in current code - uses `Date.UTC()` correctly.

**Verify:** Test with `TZ=Europe/Berlin`:

- `new Date(2027, 0, 3)` + `Date.UTC()` = correct UTC date
- Week 2 should show correctly

---

#### 5. **Planner Component Doesn't Compile** (BLOCKING)

**Location:** `src/app/features/planner/planner-calendar-nav/planner-calendar-nav.component.ts:47`

**Problem:** Template uses `T` and `translate` pipe, but component is standalone without `TranslatePipe` in imports.

**Fix:**

```typescript
@Component({
  imports: [TranslatePipe], // Add this
  ...
})
export class PlannerCalendarNavComponent {
  readonly T = T; // This is already present
}
```

---

#### 6. **Datetime Picker Week Column Squeezes Calendar** (BLOCKING)

**Location:** `src/app/ui/datetime-picker/datetime-picker.component.scss:261`

**Problem:** `.week-number-col` has `flex: 1`, which makes it grow to share width with calendar.

**Fix:** Remove `flex: 1` from `.week-number-col`, keep only `width: 32px`.

---

#### 7. **Planner Header Not Translated** (BLOCKING)

**Location:** `src/app/features/planner/planner-calendar-nav/planner-calendar-nav.component.html:14`

**Current:** Uses `T.G.WEEK | translate`, but `T` not available.

**Fix:** Already done in current code - `readonly T = T` added to component.

---

#### 8. **Datetime Picker Row Alignment Off by One** (BLOCKING)

**Location:** `src/app/ui/datetime-picker/datetime-picker.component.ts:360` and `.scss:278`

**Problem:** Week numbers computed for 6 rows, but `mat-calendar` sometimes adds a hidden month-label row (when month starts in columns 1-3). This causes numbers to be one row too high.

**Current approach:**

```typescript
// Always emits 6 entries
this.weekNumbersWithNulls = this._cdr.markForCheck();
// SCSS: flex: 1 on each cell = equal shares
```

**Issue:** When month has 6 rows + 1 label row (7 total), numbers fill rows 1-6, label row empty, but numbers are visually misaligned.

**Fix Options:**

- **Option A:** Get row positions from DOM's `tr` elements directly
- **Option B:** Put week numbers inside calendar rows (not separate column)

**Recommendation:** Option A - get actual row positions from DOM, then map week numbers to those rows.

---

### Minor Issues from Review

#### 9. **Week Label Height Should Track Calendar Rows** (MINOR)

**Location:** Datetime picker `.scss:278`

**Problem:** Fixed 54.8px height doesn't track responsive calendar rows.

**Status:** Already fixed - removed fixed height, uses flex equal shares.

**Remaining issue:** Equal shares don't match calendar's actual row heights when label row present.

---

#### 10. **Dropdown Text Should Say "None" not "System Default"** (MINOR)

**Location:** `src/app/features/config/form-cfgs/language-selection-form.const.ts`

**Status:** Already fixed - "System default" changed to "None" for weekNumberSystem.

**Remaining:** Language and firstDayOfWeek dropdowns still say "System default" but should not (they use `null` for auto-detect).

---

## Implementation Plan

### Phase 1: Critical Fixes (Before Merge)

#### 1. Fix Schedule Header to Show Week Numbers by Default

- **File:** `src/app/features/schedule/schedule/schedule.component.ts:237-253`
- **Change:** Show week label when setting is `undefined`, numbered as ISO/Monday-based

#### 2. Fix Planner Calendar Grid Alignment

- **File:** `src/app/features/planner/planner-calendar-nav/planner-calendar-nav.component.scss:16`
- **Change:** Restore `grid-template-columns: repeat(7, 1fr)` in base rule

#### 3. Fix Datetime Picker Week Column Width

- **File:** `src/app/ui/datetime-picker/datetime-picker.component.scss:261`
- **Change:** Remove `flex: 1` from `.week-number-col`

#### 4. Fix Datetime Picker Row Alignment

- **File:** `src/app/ui/datetime-picker/datetime-picker.component.ts:356-390`
- **Change:** Get row positions from calendar DOM's `tr` elements directly, not computed counts

#### 5. Add Missing Import to Planner Component

- **File:** `src/app/features/planner/planner-calendar-nav/planner-calendar-nav.component.ts:47`
- **Change:** Add `TranslatePipe` to imports array

#### 6. Verify US Week Calculation

- **File:** `src/app/util/get-week-number.ts:12-66`
- **Action:** Test with different timezones, ensure UTC handling is correct

---

### Phase 2: ISO/`firstDayOfWeek` Behavior (After Merge or Separate PR)

#### Decision: ISO Should Ignore `firstDayOfWeek` (Correct Per Spec)

**File:** `src/app/util/get-week-number.ts:70-87`

**Current behavior:** ISO ignores `firstDayOfWeek` ✓ (correct)

**Impact:** Worklog weeks will now follow ISO standard (Monday-based), not user's first day setting

**Documentation needed:** Add note that ISO weeks always use Monday, regardless of user preference

---

### Phase 3: Tests (After Critical Fixes Working)

#### Add Tests for:

1. Schedule header with default (undefined) weekNumberSystem
2. Planner calendar with week numbers hidden
3. Datetime picker with different month starts (label row present/absent)
4. Datetime picker in non-English locales (German, Persian)
5. Month navigation in datetime picker
6. US week year boundaries (Dec 31, Jan 1)
7. ISO week year boundaries (week 52/53 transitions)

**File:** `src/app/features/schedule/schedule/schedule.component.spec.ts`
**File:** `src/app/ui/datetime-picker/datetime-picker.component.spec.ts` (new)
**File:** `src/app/features/planner/planner-calendar-nav/planner-calendar-nav.component.spec.ts` (new)

---

## Summary of Changes Needed

### Critical (Block Merge)

1. ✅ Schedule header week label shown by default
2. ✅ Planner grid template restored
3. ✅ Datetime picker column width fixed
4. ✅ Datetime picker row alignment fixed
5. ✅ Planner component imports added

### Minor (Can Follow)

6. Week label height tracks calendar rows (already mostly done)
7. Dropdown text consistency for language/firstDayOfWeek

### Tests (After)

8. Schedule/Planner/Datetime picker tests
9. Non-English locale tests
10. Month navigation tests

---

## Recommendation

**Proceed with critical fixes (Phase 1) now**, then re-test with the actual PR branch.

The ISO/`firstDayOfWeek` issue is a **design decision** - ISO should ignore user's first day setting. Document this clearly and ensure all users understand that ISO weeks are standardized (always Monday-based).

The week numbering system setting should control:

- **`null`/`undefined` (default):** Show week numbers, ISO-style (Monday-based)
- **`'iso'`:** Show week numbers, ISO-style (Monday-based)
- **`'us'`:** Show week numbers, US-style (Sunday-based)

In other words:

- Default shows week numbers (fixes the regression)
- ISO and US both show week numbers, just with different logic
- "None" option hides week numbers entirely
