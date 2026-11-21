# Calendar Week View - Implementation Plan Summary

## Overview

Add a new "Calendar Week" view that displays a fixed calendar week (Monday-Sunday) with navigation, alongside existing Day/Week/Month views.

## Key Differences vs Existing Week View

| Aspect               | Current Week View                        | New Calendar Week View                  |
| -------------------- | ---------------------------------------- | --------------------------------------- |
| **Behavior**         | Rolling 7-day window starting from today | Fixed calendar week (Monday to Sunday)  |
| **Navigation**       | Move forward/back by 7 days (any day)    | Always aligns to Monday-Sunday weeks    |
| **Fixed vs Rolling** | Moves with today                         | Stays locked to selected week           |
| **Default**          | Week view                                | Calendar Week (proposed default change) |

## Changes by File

### 1. `src/app/core-ui/layout/layout.service.ts`

```typescript
// Change signal type to include calendarWeek as new default
readonly selectedTimeView = signal<'calendarWeek' | 'week' | 'month' | 'day'>('calendarWeek');
```

### 2. `src/app/features/schedule/schedule/schedule.component.ts`

```typescript
// Add computed for new view
isCalendarWeekView = computed(() => this._currentTimeViewMode() === 'calendarWeek');

// Update goToPreviousPeriod() to align to Monday for calendar week
// Update goToNextPeriod() to align to Monday for calendar week

// Update navigation buttons to account for calendar week
// Update goToCurrentWeek() method (new)
```

### 3. `src/app/features/schedule/schedule/schedule/schedule.component.html`

```html
<!-- Add new button for calendar week -->
<!-- Add new view condition -->
<!-- Add jump to current week button -->
```

### 4. `src/app/features/schedule/schedule-calendar-week/` (NEW)

- **Files:**
  - `schedule-calendar-week.component.ts` - Main component logic
  - `schedule-calendar-week.component.html` - Template
  - `schedule-calendar-week.component.scss` - Styles (borrow from schedule-week)

- **Key properties:**
  - `daysToShow[]`: Always 7 days
  - `firstDayOfWeek`: From global config (default Monday)
  - `selectedDate`: User-selected week anchor

- **Key methods:**
  - `goToPreviousPeriod()`: Jump back 7 days, snap to Monday
  - `goToNextPeriod()`: Jump forward 7 days, snap to Monday
  - `goToCurrentWeek()`: Jump to this week's Monday
  - `isViewingToday()`: true if week contains today

### 5. `src/app/features/schedule/schedule.service.ts`

```typescript
getCalendarWeekDaysToShow(
  firstDayOfWeek: number = 1,
  referenceDate: Date | null = null,
): string[] {
  // Returns 7 consecutive days, starting from Monday
}
```

### 6. `src/app/features/schedule/schedule.constants.ts`

```typescript
// Add VIEW_CALENDAR_WEEK constant
```

### 7. `src/assets/i18n/en.json`

```json
"VIEW_CALENDAR_WEEK": "Calendar Week",
"JUMP_TO_CURRENT_WEEK": "Jump to current week"
```

### 8. Translation verification

```bash
# Existing keys (verified):
VIEW_DAY: "View Day"
VIEW_MONTH: "View Month"
VIEW_WEEK: "View Week"
PREVIOUS_WEEK: "Previous Week"
NEXT_WEEK: "Next Week"

# New key needed:
JUMP_TO_CURRENT_WEEK: "Jump to current week"
```

---

## Implementation Steps (Ordered)

1. **Create component files** - scaffold `schedule-calendar-week` component
2. **Add translation keys** - add new i18n keys
3. **Update layout service** - add `calendarWeek` to view types
4. **Update schedule component** - add view switching logic
5. **Add HTML template** - button + view condition
6. **Add service method** - `getCalendarWeekDaysToShow()`
7. **Update navigation** - align Monday for calendar week view
8. **Add tests** - unit and E2E
9. **Add constants** - view constant for e2e selectors

---

## UX Flow

### User opens app

- **Current:** Week view shows rolling window (e.g., Wed-Tue)
- **After:** Calendar Week view shows Monday-to-Monday (e.g., Aug 4-10)

### User clicks "Next week"

- **Current:** Moves 7 days forward (any starting day)
- **After:** Moves to next Monday (e.g., Aug 11-17)

### User clicks "Previous week"

- **Current:** Moves 7 days backward (any starting day)
- **After:** Moves to previous Monday (e.g., Jul 28-Aug 3)

### User clicks "Jump to Current Week"

- **Current:** Not available
- **After:** Resets to this week's Monday

---

## Configuration Options

### v1 (Initial Release)

- **Fixed week length:** Always 7 days (Mon-Sun)
- **Navigation:** Previous/Next week buttons
- **Jump to current:** Quick access to this week
- **Configurable:** `firstDayOfWeek` setting (for display, but week is always Mon-Sun)

### Future Enhancements

- Work week view (Mon-Fri)
- Custom week start day
- Week number display mode (ISO/US/none)
- Toggle between calendar week and rolling week

---

## Testing Checklist

- [ ] New view button appears in header
- [ ] View switching works: Day ↔ Calendar Week ↔ Week ↔ Month
- [ ] Calendar week always shows Monday-Sunday
- [ ] Previous/Next buttons skip 7 days, aligned to Monday
- [ ] "Jump to Current Week" works correctly
- [ ] Header title shows correct week range (e.g., "31 · Jul 28 – Aug 3")
- [ ] Events display correctly in week
- [ ] Responsive layout works (horizontal scroll on narrow screens)
- [ ] Existing Week view still works (rolling window) - no regression

---

## Files to Create

1. `src/app/features/schedule/schedule-calendar-week/schedule-calendar-week.component.ts`
2. `src/app/features/schedule/schedule-calendar-week/schedule-calendar-week.component.html`
3. `src/app/features/schedule/schedule-calendar-week/schedule-calendar-week.component.scss`

## Files to Modify

1. `src/app/core-ui/layout/layout.service.ts`
2. `src/app/features/schedule/schedule/schedule/schedule.component.ts`
3. `src/app/features/schedule/schedule/schedule/schedule.component.html`
4. `src/app/features/schedule/schedule.service.ts`
5. `src/app/features/schedule/schedule.constants.ts`
6. `src/assets/i18n/en.json`

---

## Implementation Notes

1. **No breaking changes** - existing Week view remains unchanged
2. **Minimal code duplication** - Calendar Week borrows styles from Schedule Week
3. **DST-safe** - uses midday (12:00) for date calculations
4. **Responsive** - horizontal scroll works on narrow screens
5. **Keyboard navigation** - same controls work for all views
6. **Localization ready** - translation keys prepared

---

## Migration Path

1. Implement in feature branch
2. Test with real data
3. Add tests
4. Update documentation
5. Merge to `master`
6. Deprecate rolling week (optional, long-term)

---

## Open Questions

1. Should Calendar Week be the **default** view? (Proposed: yes)
2. Should users be able to keep the old rolling Week view? (Yes, available via toggle)
3. Should we add a toggle in settings to choose default view? (Future enhancement)
4. Should we show week numbers in the header? (Yes, per existing logic)

---

**Status:** Plan complete, ready for implementation

**Next step:** Create scaffold files for `schedule-calendar-week` component
