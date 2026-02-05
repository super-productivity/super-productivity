# Recurring Events Research Report

## Executive Summary

Super Productivity has a functional recurring task system with good foundational patterns (deterministic IDs, sync-safe design, DST handling). However, it implements a **custom recurrence model** that lacks many patterns users expect from modern task/calendar applications. Adopting **RFC 5545 RRULE** as the recurrence format would unlock significant capabilities with relatively low implementation cost.

---

## 1. Current Implementation Analysis

### What Super Productivity Has

| Feature | Implementation | Status |
|---------|---------------|--------|
| Daily recurrence | `repeatCycle: 'DAILY'` | ✅ |
| Weekly recurrence | `repeatCycle: 'WEEKLY'` + weekday flags | ✅ |
| Monthly recurrence | `repeatCycle: 'MONTHLY'` | ✅ |
| Yearly recurrence | `repeatCycle: 'YEARLY'` | ✅ |
| Interval (every N) | `repeatEvery: number` | ✅ |
| Weekday selection | `monday`, `tuesday`, etc. booleans | ✅ |
| Start date | `startDate: string` | ✅ |
| Skip occurrences | `deletedInstanceDates: string[]` | ✅ |
| Completion-based | `repeatFromCompletionDate: boolean` | ✅ |
| Pause/resume | `isPaused: boolean` | ✅ |
| Deterministic IDs | `rpt_${cfgId}_${dueDay}` | ✅ |
| DST-safe calculation | Uses noon (12:00) for comparisons | ✅ |
| Subtask templates | `subTaskTemplates[]` | ✅ |

### Strengths

1. **Sync-safe architecture** - Deterministic task IDs prevent duplicates across devices
2. **DST handling** - Uses noon-based calculations to avoid daylight savings issues
3. **Clean separation** - `TaskRepeatCfg` is separate from tasks, allowing template-based generation
4. **Projection system** - Shows future occurrences in schedule without creating actual tasks
5. **Completion-based mode** - Supports "after completion" scheduling (not in RFC 5545)

---

## 2. Gap Analysis: What's Missing

### High-Impact Missing Features

| Pattern | RFC 5545 | Industry Apps | Super Productivity |
|---------|----------|---------------|-------------------|
| Nth weekday of month (e.g., "2nd Tuesday") | `BYDAY=2TU` | All major apps | ❌ Missing |
| Last day of month | `BYMONTHDAY=-1` | All major apps | ❌ Missing |
| Last weekday of month | `BYDAY=-1FR` | Most apps | ❌ Missing |
| End after N occurrences | `COUNT=10` | All major apps | ❌ Missing |
| End on specific date | `UNTIL=20251231` | All major apps | ❌ Missing |
| Last weekday (business) | `BYDAY=MO-FR;BYSETPOS=-1` | Some apps | ❌ Missing |
| Multiple days per month | `BYMONTHDAY=1,15` | Some apps | ❌ Missing |
| Every N months on Nth weekday | Complex RRULE | Google/Outlook | ❌ Missing |

### Medium-Impact Missing Features

| Pattern | RFC 5545 | Impact |
|---------|----------|--------|
| Modify single occurrence | `RECURRENCE-ID` | Users can't reschedule one instance |
| "This and future" changes | `RANGE=THISANDFUTURE` | Must delete and recreate |
| Bi-weekly on multiple days | `INTERVAL=2;BYDAY=MO,WE,FR` | Works but limited UI |
| Specific weeks of year | `BYWEEKNO=1,26` | Rare but useful |
| Day of year | `BYYEARDAY=100` | Very rare |

### Current Data Model Limitations

```typescript
// Current: Custom format
interface TaskRepeatCfg {
  repeatCycle: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  repeatEvery: number;
  monday?: boolean;
  tuesday?: boolean;
  // ... 5 more boolean fields
  startDate?: string;
  // No end condition (COUNT/UNTIL)
  // No BYMONTHDAY for specific days
  // No BYDAY ordinal (1MO, -1FR)
}

// RFC 5545: Single string encodes everything
// "FREQ=MONTHLY;BYDAY=2TU;COUNT=12"
```

---

## 3. How Major Apps Compare

| Feature | Google Calendar | Todoist | Things 3 | TickTick | Super Productivity |
|---------|-----------------|---------|----------|----------|-------------------|
| Basic (D/W/M/Y) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Every N interval | ✅ | ✅ | ✅ | ✅ | ✅ |
| Weekday selection | ✅ | ✅ | ✅ | ✅ | ✅ |
| Nth weekday of month | ✅ | ✅ | ✅ | ✅ | ❌ |
| Last day of month | ✅ | ✅ | ✅ | ✅ | ❌ |
| End after N times | ✅ | ❌ | ❌ | ✅ | ❌ |
| End on date | ✅ | ❌ | ❌ | ✅ | ❌ |
| After completion | ❌ | ✅ | ✅ | ✅ | ✅ |
| Skip occurrence | ✅ | ✅ | ✅ | ✅ | ✅ |
| Natural language | ✅ | ✅ | ❌ | ❌ | ❌ |
| iCal export | ✅ | ✅ | ❌ | ✅ | ❌ |

---

## 4. Industry Standards: RFC 5545 RRULE

The **iCalendar specification (RFC 5545)** is the most widely adopted standard for defining recurrence patterns. The **RRULE** (Recurrence Rule) property is the core mechanism.

### Core RRULE Components

| Parameter | Description | Valid Values |
|-----------|-------------|--------------|
| **FREQ** (Required) | Frequency of recurrence | `YEARLY`, `MONTHLY`, `WEEKLY`, `DAILY`, `HOURLY`, `MINUTELY`, `SECONDLY` |
| **INTERVAL** | Spacing between iterations | Any positive integer (default: 1) |
| **COUNT** | Number of occurrences | Any positive integer |
| **UNTIL** | End date for recurrence | DATE or DATE-TIME value |
| **WKST** | Week start day | `MO`, `TU`, `WE`, `TH`, `FR`, `SA`, `SU` (default: `MO`) |

### BYxxx Rule Parts

| Parameter | Description | Valid Values |
|-----------|-------------|--------------|
| **BYDAY** | Days of the week | `MO`, `TU`, `WE`, `TH`, `FR`, `SA`, `SU` (with optional ordinal prefix) |
| **BYMONTH** | Months of the year | 1-12 |
| **BYMONTHDAY** | Days of the month | 1 to 31 or -31 to -1 (negative = from end) |
| **BYYEARDAY** | Days of the year | 1 to 366 or -366 to -1 |
| **BYWEEKNO** | ISO 8601 week numbers | 1 to 53 or -53 to -1 |
| **BYSETPOS** | Position within recurrence set | 1 to 366 or -366 to -1 |

### BYDAY with Ordinal Prefix

Each BYDAY value can be preceded by a positive (`+n`) or negative (`-n`) integer:
- `+1MO` or `1MO` = First Monday of the period
- `-1MO` = Last Monday of the period
- `+2TU` = Second Tuesday

### Common RRULE Examples

```
# Daily for 10 occurrences
RRULE:FREQ=DAILY;COUNT=10

# Weekly on Monday and Friday until end of 2024
RRULE:FREQ=WEEKLY;UNTIL=20241231T235959Z;BYDAY=MO,FR

# Every other week on Monday, Wednesday, Friday
RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR

# Monthly on the 15th
RRULE:FREQ=MONTHLY;BYMONTHDAY=15

# Monthly on the last day
RRULE:FREQ=MONTHLY;BYMONTHDAY=-1

# First Monday of every month
RRULE:FREQ=MONTHLY;BYDAY=1MO

# Last Friday of every month
RRULE:FREQ=MONTHLY;BYDAY=-1FR

# Second Tuesday of every month
RRULE:FREQ=MONTHLY;BYDAY=2TU
```

### Exception Handling: EXDATE and RDATE

| Property | Purpose | Example |
|----------|---------|---------|
| **EXDATE** | Exclude specific occurrences | `EXDATE:20240710T070000Z` |
| **RDATE** | Add additional occurrences | `RDATE:20241106T080000Z` |

---

## 5. Recommendations

### Recommendation 1: Adopt RRULE Format Internally

**Priority: High | Effort: Medium**

Store recurrence as RFC 5545 RRULE string instead of custom fields:

```typescript
interface TaskRepeatCfgV2 {
  id: string;
  projectId: string | null;
  title: string | null;
  tagIds: string[];

  // Replace custom fields with RRULE
  rrule: string;  // e.g., "FREQ=MONTHLY;BYDAY=2TU;COUNT=12"

  // Keep SP-specific extensions
  repeatFromCompletionDate?: boolean;  // Not in RFC 5545
  isPaused: boolean;

  // Exception handling (RFC 5545 compliant)
  exdates?: string[];  // Excluded dates
  rdates?: string[];   // Additional dates (optional)

  // Keep existing task template fields
  defaultEstimate?: number;
  startTime?: string;
  remindAt?: TaskReminderOptionId;
  // ... etc
}
```

**Benefits:**
- Unlocks all RFC 5545 patterns (nth weekday, last day, COUNT, UNTIL, etc.)
- Single source of truth for recurrence logic
- Easy iCal import/export compatibility
- Leverage existing library (rrule.js) for calculations

### Recommendation 2: Use rrule.js Library

**Priority: High | Effort: Low**

```bash
npm install rrule
```

**Why rrule.js:**
- 3.7k GitHub stars, battle-tested
- Full RFC 5545 compliance
- Natural language output (`rule.toText()` → "every 2 weeks on Monday, Friday")
- TypeScript types included
- ~5KB gzipped

**Adaptation needed:**
- Super Productivity uses noon-based DST handling; rrule.js has timezone quirks
- Wrap rrule.js calls in utility that normalizes to local noon time

### Recommendation 3: Implement Missing High-Value Patterns

**Priority: High | Effort: Medium**

1. **Nth weekday of month** - "2nd Tuesday", "Last Friday"
   - RRULE: `FREQ=MONTHLY;BYDAY=2TU` or `BYDAY=-1FR`

2. **Last day of month** - Critical for billing/invoicing tasks
   - RRULE: `FREQ=MONTHLY;BYMONTHDAY=-1`

3. **End conditions** - "Repeat 10 times" or "Until December 31"
   - RRULE: `COUNT=10` or `UNTIL=20251231T235959Z`

### Recommendation 4: Improve Quick Settings UI

**Priority: Medium | Effort: Low**

```typescript
// Recommended quick settings
type TaskRepeatCfgQuickSettingV2 =
  | 'DAILY'
  | 'WEEKDAYS'                    // M-F
  | 'WEEKLY_SAME_DAY'             // Every [current weekday]
  | 'BIWEEKLY_SAME_DAY'           // Every 2 weeks
  | 'MONTHLY_SAME_DATE'           // Same day of month
  | 'MONTHLY_SAME_WEEKDAY'        // e.g., "3rd Wednesday" (NEW)
  | 'MONTHLY_LAST_DAY'            // Last day of month (NEW)
  | 'MONTHLY_LAST_WEEKDAY'        // Last [current weekday] (NEW)
  | 'YEARLY_SAME_DATE'
  | 'CUSTOM';
```

### Recommendation 5: Preserve "After Completion" Mode

**Priority: Medium | Effort: N/A (already implemented)**

This is a **competitive advantage**. RFC 5545 doesn't support this, but Todoist, Things, and TickTick all do. Keep the `repeatFromCompletionDate` flag as a Super Productivity extension.

---

## 6. Implementation Roadmap

### Phase 1: Foundation (Low Risk)
1. Add `rrule` dependency
2. Create utility wrapper for rrule.js with DST-safe handling
3. Add `rrule` field to `TaskRepeatCfg` model (keep old fields)
4. Write bidirectional conversion: old format ↔ RRULE string
5. Update `getNextRepeatOccurrence()` to use rrule.js when `rrule` field present

### Phase 2: New Patterns (Medium Risk)
1. Update UI to support new patterns (nth weekday, last day, etc.)
2. Add end conditions (COUNT, UNTIL) to UI
3. Add new quick settings
4. Migrate existing configs to RRULE format on save

### Phase 3: Polish (Low Risk)
1. Add natural language display: "Repeats every 2nd Tuesday"
2. Improve heatmap to show projected future occurrences
3. Consider iCal export for calendar integration

### Phase 4: Advanced (High Risk, Optional)
1. Single instance modifications
2. "This and future" changes
3. iCal import with recurrence

---

## 7. RRULE Mapping Examples

| User Request | Current SP | RRULE |
|--------------|------------|-------|
| Every day | `DAILY`, every=1 | `FREQ=DAILY` |
| Every 3 days | `DAILY`, every=3 | `FREQ=DAILY;INTERVAL=3` |
| Every Monday | `WEEKLY`, mon=true | `FREQ=WEEKLY;BYDAY=MO` |
| Every 2 weeks on Mon, Wed | `WEEKLY`, every=2, mon=true, wed=true | `FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE` |
| Monthly on 15th | `MONTHLY`, every=1 | `FREQ=MONTHLY;BYMONTHDAY=15` |
| **2nd Tuesday monthly** | ❌ Not possible | `FREQ=MONTHLY;BYDAY=2TU` |
| **Last Friday monthly** | ❌ Not possible | `FREQ=MONTHLY;BYDAY=-1FR` |
| **Last day of month** | ❌ Not possible | `FREQ=MONTHLY;BYMONTHDAY=-1` |
| Yearly on March 15 | `YEARLY`, every=1 | `FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=15` |
| **10 times then stop** | ❌ Not possible | `FREQ=WEEKLY;COUNT=10` |
| **Until Dec 31, 2025** | ❌ Not possible | `FREQ=WEEKLY;UNTIL=20251231` |

---

## 8. Library Comparison

| Criteria | rrule.js | rSchedule | later.js |
|----------|----------|-----------|----------|
| **RFC 5545 Compliance** | High | Partial | No |
| **Bundle Size** | ~5KB gzip | Smaller | ~8KB |
| **TypeScript** | Yes | Native | Community |
| **Timezone Support** | Quirky | Excellent | Basic |
| **NLP Support** | Yes | No | Yes |
| **Active Maintenance** | Slower | Yes | Fork only |
| **GitHub Stars** | 3.7k | 43 | 1.7k |

**Recommendation:** Use rrule.js for RFC 5545 compliance and community support. Wrap timezone handling carefully.

---

## 9. Key Files in Current Implementation

| Feature | File |
|---------|------|
| Task date properties | `src/app/features/tasks/task.model.ts` |
| Recurring config model | `src/app/features/task-repeat-cfg/task-repeat-cfg.model.ts` |
| Repeat calculation | `src/app/features/task-repeat-cfg/store/get-next-repeat-occurrence.util.ts` |
| Repeat selectors | `src/app/features/task-repeat-cfg/store/task-repeat-cfg.selectors.ts` |
| Repeat service | `src/app/features/task-repeat-cfg/task-repeat-cfg.service.ts` |
| Dialog UI | `src/app/features/task-repeat-cfg/dialog-edit-task-repeat-cfg/` |
| Schedule integration | `src/app/features/schedule/schedule.service.ts` |
| Planner integration | `src/app/features/planner/planner.service.ts` |

---

## Conclusion

Super Productivity's recurring task system has solid foundations (sync safety, DST handling) but uses a limited custom format. Adopting RFC 5545 RRULE—while preserving the `repeatFromCompletionDate` extension—would:

1. **Enable commonly requested patterns** (nth weekday, last day, end conditions)
2. **Reduce maintenance burden** by leveraging battle-tested library
3. **Enable future iCal integration** for calendar sync
4. **Align with industry standards** used by Google, Microsoft, Apple

The recommended approach is incremental: add RRULE support alongside existing fields, migrate gradually, and preserve backward compatibility.
