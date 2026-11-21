# Calendar Week View Implementation Plan

## Overview

Add a new "Calendar Week" view alongside the existing Day/Week/Month views. This view displays a fixed calendar week (Monday-Sunday or Monday-Friday) that can be navigated, rather than a rolling 7-day window starting from today.

## Architecture

### New View Type

Add `'calendarWeek'` as a fourth time view option to `selectedTimeView`.

**Current:** `'week' | 'month' | 'day'`  
**After:** `'calendarWeek' | 'week' | 'month' | 'day'`

## Implementation Steps

---

### 1. Update Layout Service (`src/app/core-ui/layout/layout.service.ts`)

**Change:**

```typescript
// Update signal type to include calendarWeek
readonly selectedTimeView = signal<'calendarWeek' | 'week' | 'month' | 'day'>('calendarWeek');
```

**Rationale:** Make `calendarWeek` the default new view, with `week` available for those who prefer rolling 7-day windows.

---

### 2. Update Schedule Constants (`src/app/features/schedule/schedule.constants.ts`)

**Add:**

```typescript
VIEW_CALENDAR_WEEK: 'calendarWeek' as const,
```

**Add to header controls template:**

- Button with icon: `calendar_view_week` (or `week_todo`)
- Tooltip: `T.F.SCHEDULE.VIEW_CALENDAR_WEEK`

---

### 3. Update Schedule Component HTML (`src/app/features/schedule/schedule/schedule.component.html`)

**Add new button to time-view-selector:**

```html
<button
  mat-icon-button
  class="time-view-btn e2e-calendar-week-view-btn"
  [class.active]="isCalendarWeekView()"
  [attr.aria-pressed]="isCalendarWeekView()"
  (click)="selectTimeView('calendarWeek')"
  [matTooltip]="T.F.SCHEDULE.VIEW_CALENDAR_WEEK | translate"
  [attr.aria-label]="T.F.SCHEDULE.VIEW_CALENDAR_WEEK | translate"
>
  <mat-icon>calendar_view_week</mat-icon>
</button>
```

**Add new condition in scroll-wrapper:**

```html
@if (isCalendarWeekView()) {
<schedule-calendar-week
  [events]="events()"
  [beyondBudget]="beyondBudget()"
  [daysToShow]="daysToShow()"
  [workStartEnd]="workStartEnd() || null"
  [currentTimeRow]="currentTimeRow()"
  [todayDateStr]="_todayDateStr()"
  [isHorizontalScrollMode]="shouldEnableHorizontalScroll()"
  [isHScrolled]="isHScrolled()"
></schedule-calendar-week>
}
```

---

### 4. Update Schedule Component TS (`src/app/features/schedule/schedule/schedule.component.ts`)

**Add new computed:**

```typescript
isCalendarWeekView = computed(() => this._currentTimeViewMode() === 'calendarWeek');
```

**Add new method:**

```typescript
selectTimeView(view: 'calendarWeek' | 'week' | 'month' | 'day'): void {
  this.layoutService.selectedTimeView.set(view);
  localStorage.setItem(LS.SELECTED_TIME_VIEW, view);
}
```

**Add navigation for calendar week:**

```typescript
// In goToPreviousPeriod() / goToNextPeriod()
if (selectedView === 'calendarWeek') {
  // Navigate by 7 days, but ensure we land on a Monday
  const daysToSkip = 7;
  // Use modulo to find days to skip to next Monday
}
```

**Update `daysToShow()` computed for calendar week:**

```typescript
if (selectedView === 'calendarWeek') {
  return this.scheduleService.getCalendarWeekDaysToShow(
    this.firstDayOfWeek(),
    this._selectedDate(),
  );
}
```

**Add new method for calendar week days:**

```typescript
getCalendarWeekDaysToShow(
  firstDayOfWeek: number = 1,
  referenceDate: Date | null = null,
): string[] {
  return this.scheduleService.getCalendarWeekDaysToShow(firstDayOfWeek, referenceDate);
}
```

---

### 5. Add Schedule Calendar Week Component

**File:** `src/app/features/schedule/schedule-calendar-week/schedule-calendar-week.component.ts`

**Key differences from ScheduleWeekComponent:**

- Always shows 7 days (unless work week config)
- First day of week is Monday (or configured)
- Navigation jumps by exact weeks (Monday to Monday)
- "Jump to Current Week" button enabled
- Selected week doesn't move with today

**Configurable options (from localization settings):**

- `firstDayOfWeek`: Controls week start (default: Monday = 1)
- Optional: `isWorkWeekOnly`: Show only Mon-Fri (if added later)

**Component properties:**

- `daysToShow`: Always 7 days (or 5 for work week)
- `firstDayOfWeek`: From `firstDayOfWeek()` computed
- `referenceDate`: Optional user-selected week anchor

**Navigation methods:**

- `goToPreviousPeriod()`: Jump back 7 days, align to Monday
- `goToNextPeriod()`: Jump forward 7 days, align to Monday
- `goToCurrentWeek()`: Jump to this week's Monday

---

### 6. Update Schedule Service (`src/app/features/schedule/schedule.service.ts`)

**Add new method:**

```typescript
getCalendarWeekDaysToShow(
  firstDayOfWeek: number = 1,
  referenceDate: Date | null = null,
): string[] {
  const today = referenceDate || this._dateService.getLogicalTodayDate();
  const cursor = new Date(today);
  cursor.setHours(12, 0, 0, 0); // Avoid DST issues

  // Calculate days to Monday (or first day of week)
  const dayOfWeek = cursor.getDay();
  const daysToGoBack = (dayOfWeek - firstDayOfWeek + 7) % 7;

  cursor.setDate(cursor.getDate() - daysToGoBack);

  const daysToShow: string[] = [];
  for (let i = 0; i < 7; i++) {
    daysToShow.push(this._dateService.todayStr(cursor.getTime()));
    cursor.setDate(cursor.getDate() + 1);
  }
  return daysToShow;
}
```

---

### 7. Update Schedule Month Component (`src/app/features/schedule/schedule-month/schedule-month.component.ts`)

**No changes needed** - already handles `firstDayOfWeek` for weekday headers.

---

### 8. Navigation Controls (`src/app/features/schedule/schedule/schedule.component.html`)

**Update previous/next buttons for calendar week:**

```html
<!-- Previous button -->
[disabled]="isViewingToday() && selectedWeekIsCurrent()"
[attr.aria-label]="(isCalendarWeekView() ? T.F.SCHEDULE.PREVIOUS_WEEK : ...)|translate"

<!-- Next button -->
[attr.aria-label]="(isCalendarWeekView() ? T.F.SCHEDULE.NEXT_WEEK : ...)|translate"
```

**Add "Jump to Current Week" button:**

```html
<button
  mat-icon-button
  (click)="goToCurrentWeek()"
  [disabled]="isViewingToday()"
  [attr.aria-label]="T.F.SCHEDULE.JUMP_TO_CURRENT_WEEK | translate"
  [matTooltip]="T.F.SCHEDULE.JUMP_TO_CURRENT_WEEK | translate"
>
  <mat-icon>location_on</mat-icon>
</button>
```

---

### 9. Update Header Title (`src/app/features/schedule/schedule/schedule.component.ts`)

**Update `headerTitle()` computed:**

```typescript
if (this.isCalendarWeekView()) {
  const start = parseDbDateStr(days[0]);
  const end = parseDbDateStr(days[days.length - 1]);
  const weekNr = getWeekNumber(start, 1, 'iso'); // ISO weeks
  const startStr = safeFormatDate(start, 'MMM d', locale);
  const endStr = safeFormatDate(end, 'MMM d', locale);
  return `${weekNr} · ${startStr} – ${endStr}`;
}
```

---

### 10. Add Translation Keys (`src/assets/i18n/en.json`)

**Add:**

```json
"VIEW_CALENDAR_WEEK": "Calendar Week",
"PREVIOUS_WEEK": "Previous week",
"NEXT_WEEK": "Next week",
"JUMP_TO_CURRENT_WEEK": "Jump to current week",
"WEEK": "Week"
```

---

### 11. Update Local Storage Key (`src/app/core/persistence/storage-keys.const.ts`)

**No changes** - `SELECTED_TIME_VIEW` already stores view type.

---

### 12. Add Tests

**Unit tests:**

- `schedule.service.ts`: Test `getCalendarWeekDaysToShow()`
- `schedule.component.ts`: Test view switching, navigation
- `schedule-calendar-week.component.ts`: Test rendering, navigation

**E2E tests:**

- Switch to calendar week view
- Navigate to previous/next weeks
- Verify week starts on Monday
- Verify week doesn't auto-move with today

---

## Configuration Options

### v1 (Initial Release)

- Fixed week: Monday-Sunday (ISO week)
- Navigation: Previous/Next week, Jump to Current
- Configurable first day via existing `firstDayOfWeek` setting

### Future Enhancements (Out of Scope)

- Configurable week type: Full week (Mon-Sun) vs Work week (Mon-Fri)
- Custom week start day (beyond firstDayOfWeek)
- week number display mode: ISO, US, or none
- Week-to-week navigation controls in header

---

## Files to Create/Modify

### Create:

1. `src/app/features/schedule/schedule-calendar-week/schedule-calendar-week.component.ts`
2. `src/app/features/schedule/schedule-calendar-week/schedule-calendar-week.component.html`
3. `src/app/features/schedule/schedule-calendar-week/schedule-calendar-week.component.scss`

### Modify:

1. `src/app/core-ui/layout/layout.service.ts` - Update `selectedTimeView` type
2. `src/app/features/schedule/schedule/schedule.component.ts` - Add calendar week logic
3. `src/app/features/schedule/schedule/schedule/schedule.component.html` - Add button, view condition
4. `src/app/features/schedule/schedule.service.ts` - Add `getCalendarWeekDaysToShow()`
5. `src/app/features/schedule/schedule.constants.ts` - Add view constant
6. `src/assets/i18n/en.json` - Add translation keys

---

## Testing Checklist

- [ ] New view button appears in header
- [ ] View切换 works: Day ↔ Calendar Week ↔ Week ↔ Month
- [ ] Calendar week always shows Monday-Sunday
- [ ] Previous/Next buttons skip 7 days
- [ ] "Jump to Current Week" works correctly
- [ ] Header title shows correct week range
- [ ] Events display correctly in week
- [ ] No regression: existing Week view still works (rolling window)
- [ ] Responsive layout works (horizontal scroll on narrow screens)

---

## Edge Cases Handled

1. **DST transitions:** Using midday (12:00) for date calculations
2. **Month boundaries:** Weeks can span months (expected behavior)
3. **Year boundaries:** Week 52/53 handling handled by existing logic
4. **Today detection:** `isViewingToday()` considers week range, not just current day
5. **Fixed vs rolling:** Calendar week stays fixed; Week view remains rolling
