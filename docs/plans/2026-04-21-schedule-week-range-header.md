# Schedule Header Week Range Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `Week N · Apr 20 – Apr 26` / `April 2026` title to the schedule nav, snap the week view to calendar-aligned weeks, move the "Today" action to an icon button on the left, and flatten the nav row so it blends with the sticky header.

**Architecture:** Single `headerTitle` computed signal in `ScheduleComponent` drives the label for both views. `getDaysToShow` in `ScheduleService` gains a `firstDayOfWeek` parameter and snaps the start to the preceding first-day-of-week. ISO week number via existing `getWeekNumber` util. Separate month-header inside `schedule-month.component` is deleted — shared nav owns the label.

**Tech Stack:** Angular standalone components, Angular signals, `localeDate` pipe, `ngx-translate`.

---

## Task 1: Add translation keys (WEEK_LABEL, TODAY)

**Files:**
- Modify: `src/assets/i18n/en.json` (insert within the `F.SCHEDULE` block, around line 960-975)
- Modify: `src/app/t.const.ts` (insert within `F.SCHEDULE`, around lines 981-990)

**Step 1:** Add two keys to `en.json` under `F.SCHEDULE`. Preserve alphabetical order within the block.

```json
"TODAY": "Today",
"WEEK_LABEL": "Week {{nr}}"
```

The resulting block (around lines 965-975) should look like:

```json
"END": "Work End",
"INSERT_BEFORE": "Before",
"LUNCH_BREAK": "Lunch Break",
"MONTH": "Month",
"NO_TASKS": "...",
"NOW": "Now",
"PLAN_END_DAY": "End of {{date}}",
"PLAN_START_DAY": "Start of {{date}}",
"SHIFT_KEY_INFO": "Hold Shift to toggle day planning mode",
"START": "Work Start",
"TODAY": "Today",
"WEEK_LABEL": "Week {{nr}}"
```

**Step 2:** Add matching entries in `t.const.ts` under the `SCHEDULE` object (alphabetical):

```ts
TODAY: 'F.SCHEDULE.TODAY',
WEEK_LABEL: 'F.SCHEDULE.WEEK_LABEL',
```

**Step 3:** Verify:

```bash
npm run checkFile src/app/t.const.ts
```

**Step 4:** Commit:

```bash
git add src/assets/i18n/en.json src/app/t.const.ts
git commit -m "feat(schedule): add i18n keys for week-label and today button"
```

---

## Task 2: Snap week view to calendar-aligned week in `getDaysToShow`

**Files:**
- Modify: `src/app/features/schedule/schedule.service.ts:143-151`
- Modify: `src/app/features/schedule/schedule.service.spec.ts:52-139`

**Step 1: Update the failing tests first** (TDD). Edit `schedule.service.spec.ts` — replace the existing `describe('getDaysToShow', …)` block (lines 52-140) with the new snapping expectations:

```ts
describe('getDaysToShow', () => {
  it('should return the requested number of days', () => {
    const result = service.getDaysToShow(5, null, 1);
    expect(result.length).toBe(5);
  });

  it('should snap 7-day range to start on firstDayOfWeek (Monday)', () => {
    // Wed Jun 17, 2026 is a Wednesday → snapped start Mon Jun 15
    const referenceDate = new Date(2026, 5, 17);
    const result = service.getDaysToShow(7, referenceDate, 1);
    expect(result.length).toBe(7);
    const [y, m, d] = result[0].split('-').map(Number);
    expect(new Date(y, m - 1, d).getDay()).toBe(1); // Monday
  });

  it('should snap 7-day range to start on firstDayOfWeek (Sunday)', () => {
    const referenceDate = new Date(2026, 5, 17); // Wed
    const result = service.getDaysToShow(7, referenceDate, 0);
    const [y, m, d] = result[0].split('-').map(Number);
    expect(new Date(y, m - 1, d).getDay()).toBe(0); // Sunday
  });

  it('should not snap when day count is less than 7', () => {
    // Responsive mobile mode shows fewer days; keep current behavior
    const referenceDate = new Date(2028, 5, 15);
    const result = service.getDaysToShow(3, referenceDate, 1);
    const expectedFirstDay = dateService.todayStr(referenceDate.getTime());
    expect(result[0]).toBe(expectedFirstDay);
    expect(result.length).toBe(3);
  });

  it('should return consecutive days', () => {
    const result = service.getDaysToShow(7, new Date(2028, 0, 20), 1);
    for (let i = 0; i < result.length - 1; i++) {
      const cur = new Date(result[i]);
      const nxt = new Date(result[i + 1]);
      expect((nxt.getTime() - cur.getTime()) / 86_400_000).toBe(1);
    }
  });

  it('should use today when referenceDate is null', () => {
    const result = service.getDaysToShow(3, null, 1);
    expect(result[0]).toBe(dateService.todayStr());
  });
});
```

**Step 2: Run the test** (should fail because signature/behavior mismatch):

```bash
npm run test:file src/app/features/schedule/schedule.service.spec.ts
```
Expected: compile errors or assertion failures referencing `getDaysToShow`.

**Step 3: Update the implementation** in `schedule.service.ts`:

```ts
getDaysToShow(
  nrOfDaysToShow: number,
  referenceDate: Date | null = null,
  firstDayOfWeek: number = 0,
): string[] {
  const baseTime = referenceDate ? referenceDate.getTime() : Date.now();
  let startTime = baseTime;

  // Snap to start of week only when showing a full 7-day week
  if (nrOfDaysToShow === 7) {
    const base = new Date(baseTime);
    base.setHours(0, 0, 0, 0);
    const daysToGoBack = (base.getDay() - firstDayOfWeek + 7) % 7;
    base.setDate(base.getDate() - daysToGoBack);
    startTime = base.getTime();
  }

  const daysToShow: string[] = [];
  for (let i = 0; i < nrOfDaysToShow; i++) {
    daysToShow.push(this._dateService.todayStr(startTime + i * 24 * 60 * 60 * 1000));
  }
  return daysToShow;
}
```

**Step 4:** Update the call site in `schedule.component.ts:142`:

```ts
return this.scheduleService.getDaysToShow(count, selectedDate, this.firstDayOfWeek());
```

**Step 5: Run tests:**

```bash
npm run test:file src/app/features/schedule/schedule.service.spec.ts
npm run checkFile src/app/features/schedule/schedule.service.ts
```
Expected: PASS on both.

**Step 6: Commit:**

```bash
git add src/app/features/schedule/schedule.service.ts src/app/features/schedule/schedule.service.spec.ts src/app/features/schedule/schedule/schedule.component.ts
git commit -m "feat(schedule): snap week view to calendar-aligned week"
```

---

## Task 3: Update `isViewingToday` semantics in `ScheduleComponent`

**Files:**
- Modify: `src/app/features/schedule/schedule/schedule.component.ts:69-79`
- Modify: `src/app/features/schedule/schedule/schedule.component.spec.ts:167-202`

**Step 1: Update the failing tests** — replace the `describe('isViewingToday …')` block:

```ts
describe('isViewingToday computed', () => {
  it('should return true when _selectedDate is null', () => {
    component['_selectedDate'].set(null);
    expect(component.isViewingToday()).toBe(true);
  });

  it('should return true when the displayed range contains today', () => {
    // Mock today = 2026-01-20 (Tue). Week-aligned (Mon) → Jan 19-25
    const insideSameWeek = new Date(2026, 0, 22); // Thu same week
    component['_selectedDate'].set(insideSameWeek);
    expect(component.isViewingToday()).toBe(true);
  });

  it('should return false when viewing a future week', () => {
    component['_selectedDate'].set(new Date(2026, 0, 27));
    expect(component.isViewingToday()).toBe(false);
  });

  it('should return false when viewing a past week', () => {
    component['_selectedDate'].set(new Date(2026, 0, 13));
    expect(component.isViewingToday()).toBe(false);
  });
});
```

**Step 2: Run** — expect failures on the "displayed range contains today" case:

```bash
npm run test:file src/app/features/schedule/schedule/schedule.component.spec.ts
```

**Step 3: Update the implementation** of `isViewingToday`:

```ts
isViewingToday = computed(() => {
  if (this._selectedDate() === null) return true;
  const todayStr = this._todayDateStr();
  return todayStr ? this.daysToShow().includes(todayStr) : false;
});
```

**Step 4:** Run tests and file lint:

```bash
npm run test:file src/app/features/schedule/schedule/schedule.component.spec.ts
npm run checkFile src/app/features/schedule/schedule/schedule.component.ts
```

**Step 5: Commit:**

```bash
git add src/app/features/schedule/schedule/schedule.component.ts src/app/features/schedule/schedule/schedule.component.spec.ts
git commit -m "feat(schedule): base isViewingToday on visible range containing today"
```

---

## Task 4: Add `headerTitle` computed signal

**Files:**
- Modify: `src/app/features/schedule/schedule/schedule.component.ts`

**Step 1: Write a test first** in `schedule.component.spec.ts`, near the other computeds:

```ts
describe('headerTitle computed', () => {
  it('returns week label + range in week view', () => {
    mockLayoutService.selectedTimeView.set('week');
    mockScheduleService.getDaysToShow.and.returnValue([
      '2026-04-20', '2026-04-21', '2026-04-22', '2026-04-23',
      '2026-04-24', '2026-04-25', '2026-04-26',
    ]);
    fixture.detectChanges();
    // Format is locale-dependent; assert structure
    const title = component.headerTitle();
    expect(title).toMatch(/^Week 17 · .+ – .+$/);
  });

  it('returns month + year in month view', () => {
    mockLayoutService.selectedTimeView.set('month');
    const days = Array.from({ length: 35 }, (_, i) => {
      const d = new Date(2026, 3, 1 + i);
      return d.toISOString().split('T')[0];
    });
    mockScheduleService.getMonthDaysToShow.and.returnValue(days);
    fixture.detectChanges();
    expect(component.headerTitle()).toMatch(/April\s+2026/);
  });
});
```

Run: expect failure (`headerTitle` does not exist).

```bash
npm run test:file src/app/features/schedule/schedule/schedule.component.spec.ts
```

**Step 2: Implement in `schedule.component.ts`:**

Add imports at top of the file:

```ts
import { formatDate } from '@angular/common';
import { getWeekNumber } from '../../../util/get-week-number';
import { TranslateService } from '@ngx-translate/core';
```

Inject the DateTimeFormatService and TranslateService near the other inject() calls:

```ts
private _dateTimeFormatService = inject(DateTimeFormatService);
private _translate = inject(TranslateService);
```

Add imports for `DateTimeFormatService`:

```ts
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
```

Add the computed below `weeksToShow`:

```ts
headerTitle = computed(() => {
  const days = this.daysToShow();
  if (!days.length) return '';
  const locale = this._dateTimeFormatService.currentLocale();

  if (this.isMonthView()) {
    // Reference middle of displayed range (matches prior month-title heuristic)
    const midIdx = Math.min(14, days.length - 1);
    const mid = new Date(days[midIdx]);
    return formatDate(mid, 'LLLL yyyy', locale);
  }

  const start = new Date(days[0]);
  const end = new Date(days[days.length - 1]);
  const weekNr = getWeekNumber(start); // ISO (default firstDayOfWeek=1)
  const range = `${formatDate(start, 'MMM d', locale)} – ${formatDate(end, 'MMM d', locale)}`;
  const label = this._translate.instant(T.F.SCHEDULE.WEEK_LABEL, { nr: weekNr });
  return `${label} · ${range}`;
});
```

**Step 3:** Run tests + lint:

```bash
npm run test:file src/app/features/schedule/schedule/schedule.component.spec.ts
npm run checkFile src/app/features/schedule/schedule/schedule.component.ts
```

**Step 4: Commit:**

```bash
git add src/app/features/schedule/schedule/schedule.component.ts src/app/features/schedule/schedule/schedule.component.spec.ts
git commit -m "feat(schedule): add headerTitle computed for week/month label"
```

---

## Task 5: Rework nav template (Today icon left, title between arrows)

**Files:**
- Modify: `src/app/features/schedule/schedule/schedule.component.html`

Replace the existing `.schedule-nav-controls` block with the three-region layout:

```html
<div class="schedule-nav-controls">
  <button
    mat-icon-button
    class="today-btn"
    (click)="goToToday()"
    [disabled]="isViewingToday()"
    [attr.aria-label]="T.F.SCHEDULE.TODAY | translate"
    [matTooltip]="T.F.SCHEDULE.TODAY | translate"
  >
    <mat-icon>today</mat-icon>
  </button>

  <div class="center-group">
    <button
      mat-icon-button
      (click)="goToPreviousPeriod()"
      [attr.aria-label]="isMonthView() ? 'Go to previous month' : 'Go to previous week'"
      [matTooltip]="isMonthView() ? 'Previous Month' : 'Previous Week'"
    >
      <mat-icon>chevron_left</mat-icon>
    </button>

    <div class="title">{{ headerTitle() }}</div>

    <button
      mat-icon-button
      (click)="goToNextPeriod()"
      [attr.aria-label]="isMonthView() ? 'Go to next month' : 'Go to next week'"
      [matTooltip]="isMonthView() ? 'Next Month' : 'Next Week'"
    >
      <mat-icon>chevron_right</mat-icon>
    </button>
  </div>

  <div class="right-spacer"></div>
</div>
```

Remove the `MatButton` import from `schedule.component.ts` (no longer used — only `MatIconButton` remains). Also remove the commented-out `<!-- <div class="title">February 2019 Week 6</div> -->` line at the top.

**Step 2:** Lint:

```bash
npm run checkFile src/app/features/schedule/schedule/schedule.component.ts
```

**Step 3: Commit:**

```bash
git add src/app/features/schedule/schedule/schedule.component.html src/app/features/schedule/schedule/schedule.component.ts
git commit -m "feat(schedule): show title between arrows, move today to left icon"
```

---

## Task 6: Update styles (transparent nav row, centered title with fixed min-width)

**Files:**
- Modify: `src/app/features/schedule/schedule/schedule.component.scss:49-93`

Replace the `header` and `.schedule-nav-controls` rules with:

```scss
header {
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 0;
  left: 0;
  right: 0;
  @include extraBorder('-top');
  @include extraBorder('-bottom');
  box-shadow: var(--whiteframe-shadow-1dp);
  z-index: 10;
  color: var(--text-color);
  background: var(--bg-lighter);
  padding-right: $schedule-header-scrollbar-padding;
}

.schedule-nav-controls {
  display: grid;
  grid-template-columns: 48px 1fr 48px;
  align-items: center;
  background: transparent;
  @include extraBorder('-bottom');
  min-height: 48px;

  .today-btn {
    justify-self: start;
  }

  .right-spacer {
    width: 48px;
  }

  .center-group {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s);
    min-width: 0;
  }

  .title {
    font-weight: 600;
    font-size: 18px;
    text-align: center;
    min-width: 260px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;

    @include mq(xs, max) {
      font-size: 14px;
      min-width: 180px;
    }
  }

  button {
    flex-shrink: 0;
  }
}
```

**Step 2:** Lint:

```bash
npm run checkFile src/app/features/schedule/schedule/schedule.component.scss
```

**Step 3: Commit:**

```bash
git add src/app/features/schedule/schedule/schedule.component.scss
git commit -m "style(schedule): transparent nav row, fixed-width centered title"
```

---

## Task 7: Remove duplicate month-header inside `schedule-month.component`

**Files:**
- Modify: `src/app/features/schedule/schedule-month/schedule-month.component.html:1-3`
- Modify: `src/app/features/schedule/schedule-month/schedule-month.component.scss:4-35`

**Step 1:** In the `.html`, delete lines 1-3 (the `<header class="month-header">` wrapper and the `.month-title` div). The template should now start directly at the `<div class="month-grid-container">`.

**Step 2:** In the `.scss`, delete the entire `.month-header { … }` block (lines 4-35 in the current file).

**Step 3:** Lint both files:

```bash
npm run checkFile src/app/features/schedule/schedule-month/schedule-month.component.scss
```
(No .ts change needed; the html is checked via lint+prettier via `npm run prettier` / `npm run lint` but has no `checkFile` target — lint runs already via the spec & the parent TS.)

**Step 4:** Also check that `schedule-month.component.spec.ts` doesn't assert on the `.month-header`:

```bash
grep -n "month-header\|month-title" src/app/features/schedule/schedule-month/schedule-month.component.spec.ts
```

Remove any such assertions if they exist (update test to assert `headerTitle` handles month view from `ScheduleComponent` instead — but only if tests actually reference it).

**Step 5: Commit:**

```bash
git add src/app/features/schedule/schedule-month/schedule-month.component.html src/app/features/schedule/schedule-month/schedule-month.component.scss
git commit -m "refactor(schedule): drop redundant month-header (now in shared nav)"
```

---

## Task 8: Final verification

**Step 1:** Run the full schedule test suite:

```bash
npm run test:file src/app/features/schedule/schedule.service.spec.ts
npm run test:file src/app/features/schedule/schedule/schedule.component.spec.ts
npm run test:file src/app/features/schedule/schedule-month/schedule-month.component.spec.ts
```

**Step 2:** Run lint on all modified files:

```bash
npm run checkFile src/app/features/schedule/schedule.service.ts
npm run checkFile src/app/features/schedule/schedule/schedule.component.ts
npm run checkFile src/app/features/schedule/schedule/schedule.component.scss
npm run checkFile src/app/features/schedule/schedule-month/schedule-month.component.scss
npm run checkFile src/app/t.const.ts
```

**Step 3:** Manually verify in the dev server:

```bash
npm run startFrontend
```

- Week view today: should show `Week {nr} · {start} – {end}`, with today highlighted somewhere inside the range (not always on the left).
- Click "next" → advances to the following calendar week.
- Click the "today" icon on the left → resets to current week, icon becomes disabled.
- Switch to month view → title becomes `April 2026`, the inner month title row is gone.
- Nav row blends into the sticky header (transparent), arrows don't jump as title changes.

**Step 4: No final commit needed** unless manual QA surfaces issues. If it does, fix + commit under a clear message (e.g. `fix(schedule): ...`).
