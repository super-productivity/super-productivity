# Recurring Events Gap Analysis

## Current Super Productivity Implementation

### Data Model: TaskRepeatCfg

Located at `src/app/features/task-repeat-cfg/task-repeat-cfg.model.ts`

```typescript
interface TaskRepeatCfg {
  id: string;
  projectId: string | null;
  title: string | null;
  tagIds: string[];

  // Recurrence Pattern
  repeatCycle: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  repeatEvery: number;  // Interval (every N days/weeks/etc.)
  startDate?: string;   // YYYY-MM-DD

  // Weekly: which days
  monday?: boolean;
  tuesday?: boolean;
  wednesday?: boolean;
  thursday?: boolean;
  friday?: boolean;
  saturday?: boolean;
  sunday?: boolean;

  // Control
  isPaused: boolean;
  repeatFromCompletionDate?: boolean;

  // Instance tracking
  lastTaskCreationDay?: string;
  deletedInstanceDates?: string[];  // Skipped occurrences

  // Task template
  defaultEstimate?: number;
  startTime?: string;
  remindAt?: TaskReminderOptionId;
  notes?: string;
  subTaskTemplates?: SubTaskTemplate[];
}
```

### What Works Well

| Feature | Implementation | Notes |
|---------|---------------|-------|
| Basic cycles | `repeatCycle` enum | DAILY, WEEKLY, MONTHLY, YEARLY |
| Intervals | `repeatEvery: number` | Every 2 days, every 3 weeks, etc. |
| Weekday selection | 7 boolean fields | For weekly recurrence |
| Skip occurrences | `deletedInstanceDates[]` | EXDATE equivalent |
| Completion-based | `repeatFromCompletionDate` | Unique advantage |
| Pause/resume | `isPaused` | Simple toggle |
| Subtask templates | `subTaskTemplates[]` | Powerful feature |
| DST safety | Noon-based calculations | Avoids edge cases |
| Sync safety | Deterministic IDs | `rpt_${cfgId}_${day}` |

### Architectural Strengths

1. **Separation of concerns** - `TaskRepeatCfg` is independent of `Task`, acting as a template
2. **Projection system** - Future occurrences shown in schedule without creating actual tasks
3. **Deterministic IDs** - Multi-device sync creates identical task IDs, preventing duplicates
4. **DST handling** - Uses noon (12:00) for all date calculations

---

## Gap Analysis: Missing Patterns

### Critical Gaps (High User Impact)

| Pattern | Example Use Case | RFC 5545 | Current SP |
|---------|------------------|----------|------------|
| Nth weekday of month | "Team meeting every 2nd Tuesday" | `BYDAY=2TU` | ❌ |
| Last weekday of month | "Report due last Friday" | `BYDAY=-1FR` | ❌ |
| Last day of month | "Pay rent on last day" | `BYMONTHDAY=-1` | ❌ |
| End after N times | "Repeat 10 times then stop" | `COUNT=10` | ❌ |
| End on date | "Until December 31, 2025" | `UNTIL=20251231` | ❌ |

### Medium Gaps

| Pattern | Example Use Case | RFC 5545 | Current SP |
|---------|------------------|----------|------------|
| Multiple days per month | "1st and 15th of month" | `BYMONTHDAY=1,15` | ❌ |
| Last weekday (business) | "Last business day" | `BYSETPOS=-1` | ❌ |
| Specific week of year | "Week 1 and week 26" | `BYWEEKNO=1,26` | ❌ |

### Low Priority Gaps

| Pattern | Example Use Case | RFC 5545 | Current SP |
|---------|------------------|----------|------------|
| Day of year | "100th day of year" | `BYYEARDAY=100` | ❌ |
| Hourly/minutely | "Every 30 minutes" | `FREQ=MINUTELY` | ❌ |
| Second precision | Sub-minute scheduling | `FREQ=SECONDLY` | ❌ |

### Exception Handling Gaps

| Feature | RFC 5545 | Current SP |
|---------|----------|------------|
| Skip occurrence | `EXDATE` | ✅ `deletedInstanceDates` |
| Add extra occurrence | `RDATE` | ❌ |
| Modify single instance | `RECURRENCE-ID` | ❌ |
| "This and future" | `RANGE=THISANDFUTURE` | ❌ |

---

## Comparison with Major Applications

### Feature Matrix

| Feature | Google Cal | Outlook | Todoist | Things 3 | TickTick | SP |
|---------|------------|---------|---------|----------|----------|-----|
| Daily | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Weekly | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Monthly | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Yearly | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Every N interval | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Weekday selection | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Nth weekday | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Last day of month | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| End after N | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| End on date | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| After completion | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Skip occurrence | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Modify instance | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Natural language | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| iCal export | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |

### Key Observations

1. **SP is competitive on basics** - Covers what most task apps have
2. **Calendar apps are more complete** - Google/Outlook have full RFC 5545
3. **"After completion" is differentiator** - Google/Outlook lack this
4. **Nth weekday is table stakes** - All competitors have it

---

## Root Cause: Custom Format Limitations

### Current Format Problems

```typescript
// Problem 1: Can't express "2nd Tuesday"
// No field for weekday ordinal position

// Problem 2: Can't express "last day"
// MONTHLY assumes same day number, no negative indexing

// Problem 3: No end conditions
// Repeats forever by default, no COUNT or UNTIL

// Problem 4: Weekday booleans don't scale
// Adding BYMONTHDAY would need 31 more booleans
```

### Why RRULE is Better

```
# Single string encodes complex patterns:

"FREQ=MONTHLY;BYDAY=2TU"           # 2nd Tuesday
"FREQ=MONTHLY;BYMONTHDAY=-1"       # Last day
"FREQ=WEEKLY;COUNT=10"             # 10 times
"FREQ=MONTHLY;BYDAY=-1FR;UNTIL=20251231"  # Last Friday until Dec 2025
```

---

## Impact Assessment

### User Requests (Inferred from Industry Patterns)

| Request | Frequency | Current Answer |
|---------|-----------|----------------|
| "Every 2nd Tuesday" | Very Common | "Not supported" |
| "Last day of month" | Common | "Use 28th/30th/31st" |
| "Repeat 10 times" | Common | "Delete manually after" |
| "Until project ends" | Common | "Pause manually" |

### Technical Debt

| Issue | Impact |
|-------|--------|
| Custom calculation logic | High maintenance burden |
| No library leverage | Reimplementing wheel |
| No iCal compatibility | Can't import/export |
| Hardcoded patterns | Each new pattern = code change |

---

## Conclusion

Super Productivity's recurring task system is **functional but limited**. The custom data model works for basic patterns but cannot express what users commonly need. The gap is not in architecture (which is solid) but in the **recurrence pattern expressiveness**.

Adopting RFC 5545 RRULE format would:
- Fill all critical gaps with one change
- Enable library usage (rrule.js)
- Future-proof for iCal integration
- Reduce custom code maintenance
