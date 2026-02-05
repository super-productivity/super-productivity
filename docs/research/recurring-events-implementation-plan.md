# Recurring Events Implementation Plan

## Overview

This plan outlines how to upgrade Super Productivity's recurring task system from a custom format to RFC 5545 RRULE while maintaining backward compatibility and preserving unique features like "after completion" scheduling.

---

## Proposed Data Model

### New TaskRepeatCfg Structure

```typescript
interface TaskRepeatCfgV2 {
  // Identity
  id: string;
  projectId: string | null;
  title: string | null;
  tagIds: string[];

  // === NEW: RFC 5545 RRULE ===
  rrule?: string;  // e.g., "FREQ=MONTHLY;BYDAY=2TU;COUNT=12"

  // === DEPRECATED: Keep for migration ===
  repeatCycle?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  repeatEvery?: number;
  monday?: boolean;
  tuesday?: boolean;
  wednesday?: boolean;
  thursday?: boolean;
  friday?: boolean;
  saturday?: boolean;
  sunday?: boolean;
  startDate?: string;

  // === SP-SPECIFIC EXTENSIONS ===
  repeatFromCompletionDate?: boolean;  // Not in RFC 5545
  isPaused: boolean;

  // === EXCEPTION HANDLING ===
  exdates?: string[];  // Renamed from deletedInstanceDates
  rdates?: string[];   // NEW: Additional occurrences

  // === END CONDITIONS (extracted from RRULE for UI) ===
  endType?: 'never' | 'count' | 'until';
  endCount?: number;
  endDate?: string;

  // === TASK TEMPLATE (unchanged) ===
  defaultEstimate?: number;
  startTime?: string;
  remindAt?: TaskReminderOptionId;
  notes?: string;
  subTaskTemplates?: SubTaskTemplate[];

  // === TRACKING (unchanged) ===
  lastTaskCreationDay?: string;
  lastTaskCreation?: number;  // Legacy
}
```

### Key Design Decisions

1. **RRULE as primary** - When `rrule` field exists, use it; otherwise fall back to legacy fields
2. **Preserve SP extensions** - `repeatFromCompletionDate` stays separate (not expressible in RRULE)
3. **Extract end conditions** - Store `endType`/`endCount`/`endDate` for UI convenience, sync to RRULE
4. **Rename for clarity** - `deletedInstanceDates` → `exdates` (matches RFC 5545)

---

## Phase 1: Foundation

**Goal:** Add RRULE support without breaking existing functionality

### 1.1 Add rrule.js Dependency

```bash
npm install rrule
```

**Bundle impact:** ~5KB gzipped

### 1.2 Create RRULE Utility Wrapper

Create `src/app/features/task-repeat-cfg/rrule-utils.ts`:

```typescript
import { RRule, RRuleSet, Frequency } from 'rrule';
import { dateStrToUtcDate } from '../../util/date-str-to-utc-date';

/**
 * DST-safe wrapper for rrule.js
 * Uses noon time to avoid daylight savings edge cases
 */
export function getNextOccurrenceFromRRule(
  rruleString: string,
  afterDate: Date,
  exdates: string[] = []
): Date | null {
  const rruleSet = new RRuleSet();

  // Parse RRULE
  const rule = RRule.fromString(rruleString);
  rruleSet.rrule(rule);

  // Add exceptions
  for (const exdate of exdates) {
    rruleSet.exdate(dateStrToUtcDate(exdate));
  }

  // Get next occurrence after the given date
  const next = rruleSet.after(afterDate, false);
  return next;
}

export function getAllOccurrencesInRange(
  rruleString: string,
  startDate: Date,
  endDate: Date,
  exdates: string[] = []
): Date[] {
  const rruleSet = new RRuleSet();
  const rule = RRule.fromString(rruleString);
  rruleSet.rrule(rule);

  for (const exdate of exdates) {
    rruleSet.exdate(dateStrToUtcDate(exdate));
  }

  return rruleSet.between(startDate, endDate, true);
}

export function rruleToHumanText(rruleString: string): string {
  try {
    const rule = RRule.fromString(rruleString);
    return rule.toText();
  } catch {
    return 'Custom schedule';
  }
}
```

### 1.3 Create Legacy ↔ RRULE Converters

Create `src/app/features/task-repeat-cfg/rrule-migration.ts`:

```typescript
import { RRule, Frequency, Weekday } from 'rrule';
import { TaskRepeatCfg } from './task-repeat-cfg.model';

const WEEKDAY_MAP = {
  monday: RRule.MO,
  tuesday: RRule.TU,
  wednesday: RRule.WE,
  thursday: RRule.TH,
  friday: RRule.FR,
  saturday: RRule.SA,
  sunday: RRule.SU,
};

const FREQ_MAP = {
  'DAILY': Frequency.DAILY,
  'WEEKLY': Frequency.WEEKLY,
  'MONTHLY': Frequency.MONTHLY,
  'YEARLY': Frequency.YEARLY,
};

export function legacyToRRule(cfg: TaskRepeatCfg): string {
  const options: Partial<RRule.Options> = {
    freq: FREQ_MAP[cfg.repeatCycle],
    interval: cfg.repeatEvery || 1,
  };

  // Add DTSTART if available
  if (cfg.startDate) {
    options.dtstart = new Date(cfg.startDate + 'T12:00:00');
  }

  // Add BYDAY for weekly
  if (cfg.repeatCycle === 'WEEKLY') {
    const byweekday: Weekday[] = [];
    for (const [key, rruleDay] of Object.entries(WEEKDAY_MAP)) {
      if (cfg[key as keyof TaskRepeatCfg]) {
        byweekday.push(rruleDay);
      }
    }
    if (byweekday.length > 0) {
      options.byweekday = byweekday;
    }
  }

  const rule = new RRule(options);
  return rule.toString().replace('RRULE:', '');
}

export function rruleToLegacy(rruleString: string): Partial<TaskRepeatCfg> {
  const rule = RRule.fromString(rruleString);
  const options = rule.origOptions;

  const result: Partial<TaskRepeatCfg> = {
    repeatCycle: Object.keys(FREQ_MAP).find(
      k => FREQ_MAP[k as keyof typeof FREQ_MAP] === options.freq
    ) as TaskRepeatCfg['repeatCycle'],
    repeatEvery: options.interval || 1,
  };

  // Extract weekdays
  if (options.byweekday) {
    const days = Array.isArray(options.byweekday)
      ? options.byweekday
      : [options.byweekday];
    for (const [key, rruleDay] of Object.entries(WEEKDAY_MAP)) {
      result[key as keyof TaskRepeatCfg] = days.some(
        d => d.weekday === rruleDay.weekday
      );
    }
  }

  return result;
}
```

### 1.4 Update getNextRepeatOccurrence

Modify `src/app/features/task-repeat-cfg/store/get-next-repeat-occurrence.util.ts`:

```typescript
import { getNextOccurrenceFromRRule } from '../rrule-utils';

export const getNextRepeatOccurrence = (
  taskRepeatCfg: TaskRepeatCfg,
  fromDate: Date = new Date(),
): Date | null => {
  // NEW: Use RRULE if available
  if (taskRepeatCfg.rrule) {
    return getNextOccurrenceFromRRule(
      taskRepeatCfg.rrule,
      fromDate,
      taskRepeatCfg.exdates || taskRepeatCfg.deletedInstanceDates || []
    );
  }

  // LEGACY: Fall back to existing calculation
  // ... existing code ...
};
```

### 1.5 Update Model Types

Add to `src/app/features/task-repeat-cfg/task-repeat-cfg.model.ts`:

```typescript
export interface TaskRepeatCfgCopy {
  // ... existing fields ...

  // NEW RRULE field
  rrule?: string;

  // NEW exception handling (RFC 5545 naming)
  exdates?: string[];
  rdates?: string[];

  // NEW end conditions
  endType?: 'never' | 'count' | 'until';
  endCount?: number;
  endDate?: string;
}
```

---

## Phase 2: New Patterns

**Goal:** Enable patterns not possible with legacy format

### 2.1 Update Quick Settings

Modify `src/app/features/task-repeat-cfg/dialog-edit-task-repeat-cfg/get-quick-setting-updates.ts`:

```typescript
export type TaskRepeatCfgQuickSetting =
  | 'DAILY'
  | 'WEEKDAYS'
  | 'WEEKLY_SAME_DAY'
  | 'BIWEEKLY_SAME_DAY'
  | 'MONTHLY_SAME_DATE'
  | 'MONTHLY_SAME_WEEKDAY'    // NEW: "3rd Wednesday"
  | 'MONTHLY_LAST_DAY'        // NEW: Last day of month
  | 'MONTHLY_LAST_WEEKDAY'    // NEW: Last Friday
  | 'YEARLY_SAME_DATE'
  | 'CUSTOM';

export function getQuickSettingRRule(
  setting: TaskRepeatCfgQuickSetting,
  referenceDate: Date
): string {
  const dayOfMonth = referenceDate.getDate();
  const weekday = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][referenceDate.getDay()];
  const weekOfMonth = Math.ceil(dayOfMonth / 7);

  switch (setting) {
    case 'DAILY':
      return 'FREQ=DAILY';
    case 'WEEKDAYS':
      return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    case 'WEEKLY_SAME_DAY':
      return `FREQ=WEEKLY;BYDAY=${weekday}`;
    case 'BIWEEKLY_SAME_DAY':
      return `FREQ=WEEKLY;INTERVAL=2;BYDAY=${weekday}`;
    case 'MONTHLY_SAME_DATE':
      return `FREQ=MONTHLY;BYMONTHDAY=${dayOfMonth}`;
    case 'MONTHLY_SAME_WEEKDAY':
      return `FREQ=MONTHLY;BYDAY=${weekOfMonth}${weekday}`;
    case 'MONTHLY_LAST_DAY':
      return 'FREQ=MONTHLY;BYMONTHDAY=-1';
    case 'MONTHLY_LAST_WEEKDAY':
      return `FREQ=MONTHLY;BYDAY=-1${weekday}`;
    case 'YEARLY_SAME_DATE':
      return `FREQ=YEARLY;BYMONTH=${referenceDate.getMonth() + 1};BYMONTHDAY=${dayOfMonth}`;
    default:
      return 'FREQ=DAILY';
  }
}
```

### 2.2 Add End Conditions to UI

Add to dialog form fields:

```typescript
// In task-repeat-cfg-form.const.ts
{
  key: 'endType',
  type: 'select',
  props: {
    label: 'Ends',
    options: [
      { value: 'never', label: 'Never' },
      { value: 'count', label: 'After...' },
      { value: 'until', label: 'On date...' },
    ],
  },
},
{
  key: 'endCount',
  type: 'input',
  props: {
    type: 'number',
    label: 'occurrences',
    min: 1,
  },
  expressions: {
    hide: 'model.endType !== "count"',
  },
},
{
  key: 'endDate',
  type: 'datepicker',
  props: {
    label: 'End date',
  },
  expressions: {
    hide: 'model.endType !== "until"',
  },
},
```

### 2.3 Add Nth Weekday Selector

For MONTHLY_SAME_WEEKDAY, add UI to select:
- Which weekday (Monday-Sunday)
- Which occurrence (1st, 2nd, 3rd, 4th, Last)

```typescript
{
  key: 'monthlyWeekdayOrdinal',
  type: 'select',
  props: {
    label: 'Which',
    options: [
      { value: '1', label: 'First' },
      { value: '2', label: 'Second' },
      { value: '3', label: 'Third' },
      { value: '4', label: 'Fourth' },
      { value: '-1', label: 'Last' },
    ],
  },
  expressions: {
    hide: 'model.quickSetting !== "MONTHLY_SAME_WEEKDAY"',
  },
},
{
  key: 'monthlyWeekday',
  type: 'select',
  props: {
    label: 'Day',
    options: [
      { value: 'MO', label: 'Monday' },
      { value: 'TU', label: 'Tuesday' },
      // ... etc
    ],
  },
  expressions: {
    hide: 'model.quickSetting !== "MONTHLY_SAME_WEEKDAY"',
  },
},
```

---

## Phase 3: Migration

**Goal:** Convert existing configs to RRULE format

### 3.1 Migration Function

```typescript
export function migrateTaskRepeatCfgToRRule(
  cfg: TaskRepeatCfg
): TaskRepeatCfg {
  // Skip if already has RRULE
  if (cfg.rrule) {
    return cfg;
  }

  // Convert legacy to RRULE
  const rrule = legacyToRRule(cfg);

  return {
    ...cfg,
    rrule,
    exdates: cfg.deletedInstanceDates || [],
  };
}
```

### 3.2 Migration Strategy

**Option A: Lazy migration (recommended)**
- Convert on save: when user edits a repeat config, save with RRULE
- Gradual: old configs work until edited
- Low risk: no batch migration needed

**Option B: Batch migration**
- Run migration on app startup
- Convert all configs at once
- Higher risk: needs thorough testing

### 3.3 Version Check in Service

```typescript
// In task-repeat-cfg.service.ts
updateTaskRepeatCfg(id: string, changes: Partial<TaskRepeatCfg>) {
  // Ensure RRULE is set if using new fields
  if (changes.endType || changes.endCount || changes.endDate) {
    changes = this.ensureRRuleFormat(changes);
  }
  // ... dispatch update
}
```

---

## Phase 4: Polish

### 4.1 Natural Language Display

Show human-readable text in UI:

```typescript
// In component
get repeatDescription(): string {
  if (this.repeatCfg.rrule) {
    return rruleToHumanText(this.repeatCfg.rrule);
    // Returns: "every 2nd Tuesday" or "every month on the last day"
  }
  return this.getLegacyDescription();
}
```

### 4.2 Heatmap Improvements

Update heatmap to show projected future occurrences:

```typescript
// Get next 12 months of projected dates
const projectedDates = getAllOccurrencesInRange(
  cfg.rrule,
  new Date(),
  addMonths(new Date(), 12),
  cfg.exdates
);
```

### 4.3 iCal Export (Future)

```typescript
export function taskRepeatCfgToICalEvent(cfg: TaskRepeatCfg): string {
  return `BEGIN:VEVENT
SUMMARY:${cfg.title}
RRULE:${cfg.rrule}
${cfg.exdates?.map(d => `EXDATE:${d}`).join('\n') || ''}
END:VEVENT`;
}
```

---

## Testing Strategy

### Unit Tests

```typescript
describe('RRULE utilities', () => {
  it('should calculate 2nd Tuesday of month', () => {
    const rrule = 'FREQ=MONTHLY;BYDAY=2TU';
    const result = getNextOccurrenceFromRRule(rrule, new Date('2024-01-01'));
    expect(result).toEqual(new Date('2024-01-09T12:00:00')); // 2nd Tuesday of Jan 2024
  });

  it('should calculate last day of month', () => {
    const rrule = 'FREQ=MONTHLY;BYMONTHDAY=-1';
    const result = getNextOccurrenceFromRRule(rrule, new Date('2024-02-01'));
    expect(result).toEqual(new Date('2024-02-29T12:00:00')); // Leap year
  });

  it('should respect EXDATE', () => {
    const rrule = 'FREQ=WEEKLY;BYDAY=MO';
    const result = getNextOccurrenceFromRRule(
      rrule,
      new Date('2024-01-01'),
      ['2024-01-08']  // Skip first Monday
    );
    expect(result).toEqual(new Date('2024-01-15T12:00:00'));
  });
});
```

### DST Edge Cases

```typescript
describe('DST handling', () => {
  it('should handle spring forward', () => {
    // March 10, 2024 - DST starts in US
    const rrule = 'FREQ=DAILY';
    const march9 = new Date('2024-03-09T12:00:00');
    const result = getNextOccurrenceFromRRule(rrule, march9);
    // Should still be noon local time
  });

  it('should handle fall back', () => {
    // November 3, 2024 - DST ends in US
    const rrule = 'FREQ=DAILY';
    const nov2 = new Date('2024-11-02T12:00:00');
    const result = getNextOccurrenceFromRRule(rrule, nov2);
    // Should still be noon local time
  });
});
```

### Migration Tests

```typescript
describe('Legacy migration', () => {
  it('should convert WEEKLY with weekdays to RRULE', () => {
    const legacy: TaskRepeatCfg = {
      repeatCycle: 'WEEKLY',
      repeatEvery: 2,
      monday: true,
      friday: true,
    };
    const rrule = legacyToRRule(legacy);
    expect(rrule).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR');
  });
});
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| rrule.js timezone bugs | Wrap in DST-safe utility, test extensively |
| Breaking existing configs | Keep legacy fields, lazy migration |
| UI complexity | Hide advanced options behind "Custom" |
| Bundle size increase | rrule.js is only ~5KB gzipped |
| Sync issues | RRULE is a string - syncs like any other field |

---

## Timeline Estimate

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Phase 1: Foundation | 2-3 days | None |
| Phase 2: New Patterns | 3-5 days | Phase 1 |
| Phase 3: Migration | 1-2 days | Phase 1 |
| Phase 4: Polish | 2-3 days | Phase 2 |

**Total: 8-13 days** of focused development

---

## Success Criteria

1. ✅ All existing repeat configs continue to work
2. ✅ Users can create "2nd Tuesday of month" patterns
3. ✅ Users can create "last day of month" patterns
4. ✅ Users can set "repeat 10 times" end condition
5. ✅ "After completion" mode still works
6. ✅ No DST-related bugs
7. ✅ Sync works across devices
8. ✅ UI shows human-readable descriptions
