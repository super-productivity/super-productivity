# Unused Translations Deep Analysis

## Executive Summary

Out of 350 "unused" translation keys, the analysis reveals:

| Category                  | Count | Root Cause                        | Recommended Action     |
| ------------------------- | ----- | --------------------------------- | ---------------------- |
| **Orphan duplicates**     | ~54   | Keys at wrong JSON path           | Delete duplicates      |
| **Never implemented**     | ~43   | Features never built              | Delete                 |
| **Dynamic object access** | ~18   | Scanner limitation                | Keep (false positives) |
| **Planned/incomplete**    | ~50   | Prepared for future               | Review case-by-case    |
| **Hardcoded strings**     | ~5    | Code uses English instead of T.\* | Fix code               |
| **Needs investigation**   | ~180  | Various causes                    | Case-by-case review    |

---

## Category 1: Orphan Duplicates (Safe to Delete)

Keys that exist at the wrong JSON path - the correct keys exist elsewhere with actual translations.

### F.SAFETY_BACKUP.\* (32 keys)

**Problem:** Duplicates of `F.SYNC.SAFETY_BACKUP.*`
**Evidence:** `F.SAFETY_BACKUP.*` has empty strings, `F.SYNC.SAFETY_BACKUP.*` has actual translations and is used in code.

```
F.SAFETY_BACKUP.BACKUP_NOT_FOUND  →  Delete (F.SYNC.SAFETY_BACKUP.BACKUP_NOT_FOUND is used)
F.SAFETY_BACKUP.BTN_CLEAR_ALL    →  Delete (F.SYNC.SAFETY_BACKUP.BTN_CLEAR_ALL is used)
... (all 32 keys)
```

### GCF.PAST.\* (11 keys)

**Problem:** Duplicates of `GLOBAL_RELATIVE_TIME.PAST.*`
**Evidence:** `humanize-timestamp.ts` uses `T.GLOBAL_RELATIVE_TIME.PAST.*`, not `T.GCF.PAST.*`

```
GCF.PAST.AN_HOUR    →  Delete (GLOBAL_RELATIVE_TIME.PAST.AN_HOUR is used)
GCF.PAST.A_DAY      →  Delete (GLOBAL_RELATIVE_TIME.PAST.A_DAY is used)
... (all 11 keys)
```

---

## Category 2: Never Implemented Features (Safe to Delete)

### F.PROCRASTINATION.\* (32 keys)

**Problem:** Entire feature never implemented
**Evidence:** No files exist in `src/app/features/procrastination/`, no component uses these keys

```
F.PROCRASTINATION.BACK_TO_WORK
F.PROCRASTINATION.COMP.INTRO
F.PROCRASTINATION.COMP.L1-L4
F.PROCRASTINATION.CUR.*
F.PROCRASTINATION.REFRAME.*
F.PROCRASTINATION.SPLIT_UP.*
... (all 32 keys)
```

### GCF.TIMELINE.\* (10 keys)

**Problem:** Timeline settings form never implemented
**Evidence:** No `timeline-form.const.ts` exists, no code references these keys

```
GCF.TIMELINE.CAL_PROVIDERS
GCF.TIMELINE.L_IS_WORK_START_END_ENABLED
... (all 10 keys)
```

### WW.HELP_PROCRASTINATION (1 key)

**Problem:** Related to unimplemented procrastination feature

---

## Category 3: Dynamic Object Access (False Positives - Keep)

Scanner cannot detect when `T.F.SECTION` is assigned to a variable and children accessed dynamically.

### F.TAG_FOLDER.\* (9 keys)

**Evidence:** `folder-context-menu.component.ts:40`:

```typescript
const folderNs =
  this.treeKind === MenuTreeKind.PROJECT ? T.F.PROJECT_FOLDER : T.F.TAG_FOLDER;
// Then: folderNs.DIALOG.NAME_LABEL
```

**Action:** Keep all 9 keys

### F.PROJECT_FOLDER.\* (9 keys)

**Evidence:** Same pattern as TAG_FOLDER
**Action:** Keep all 9 keys

---

## Category 4: Hardcoded English Strings (Fix Code)

Translation keys exist but code uses hardcoded English instead.

### F.TASK*REPEAT.F.SCHEDULE_TYPE*\* (2 keys)

**Location:** `task-repeat-cfg-form.const.ts:126-133`
**Problem:**

```typescript
// Currently:
{ value: false, label: `Fixed schedule (every ${repeatEvery} ${cycleName} from start date)` }
// Should use:
{ value: false, label: T.F.TASK_REPEAT.F.SCHEDULE_TYPE_FIXED }
```

---

## Category 5: Planned/Incomplete Features (Review Case-by-Case)

### F.FOCUS_MODE.\* (11 unused keys)

Some focus mode keys are used, but these 11 appear to be for planned extensions:

- `F.FOCUS_MODE.GO_TO_PROCRASTINATION` - links to unimplemented feature
- `F.FOCUS_MODE.CONTINUE_SESSION` - may be planned UI element
- `F.FOCUS_MODE.CONGRATS` - may be planned celebration screen

### F.SYNC.\* (36 keys, excluding SAFETY_BACKUP)

Many sync-related keys for edge cases, error states, or dialogs that may be partially implemented.

### F.METRIC.\* (21 keys)

Evaluation form and reflection keys - some may be for planned features.

---

## Recommended Cleanup Script

```javascript
// Add to tools/cleanup-unused-translations.js

const SECTIONS_TO_REMOVE = [
  'ANDROID', // Already removed
  'THEMES', // Already removed
  'PROCRASTINATION', // Never implemented
];

const NESTED_PATHS_TO_REMOVE = [
  ['F', 'CALDAV', 'ISSUE_CONTENT'], // Already removed
  ['F', 'SAFETY_BACKUP'], // Duplicate of F.SYNC.SAFETY_BACKUP
  ['GCF', 'PAST'], // Duplicate of GLOBAL_RELATIVE_TIME.PAST
  ['GCF', 'TIMELINE'], // Never implemented
];
```

---

## Scanner Enhancement Recommendation

To reduce false positives from dynamic object access, enhance `find-unused-translations.js`:

```javascript
// Add detection for pattern: T.F.SECTION_NAME (without trailing dot)
// indicating the whole section object is referenced
function detectDynamicObjectAccess(content) {
  const pattern = /T\.([A-Z_]+(?:\.[A-Z_]+)*)[^.A-Z_]/g;
  // ... mark all children of matched sections as "potentially used"
}
```

---

## Summary of Immediate Safe Deletions

| Section                 | Keys   | Reason                                 |
| ----------------------- | ------ | -------------------------------------- |
| F.SAFETY_BACKUP.\*      | 32     | Duplicate of F.SYNC.SAFETY_BACKUP      |
| F.PROCRASTINATION.\*    | 32     | Feature never implemented              |
| GCF.PAST.\*             | 11     | Duplicate of GLOBAL_RELATIVE_TIME.PAST |
| GCF.TIMELINE.\*         | 10     | Feature never implemented              |
| WW.HELP_PROCRASTINATION | 1      | Related to unimplemented feature       |
| **TOTAL**               | **86** | Safe to delete immediately             |

After this cleanup: ~264 keys remaining for case-by-case review.
