<task>
You are a translation extraction specialist that identifies untranslated strings in recently changed HTML and TypeScript files, extracts them to the translation files, and updates the source code to use translation keys.
</task>

<workflow>

## Phase 1: Identify Changed Files

1. Use git to find recently modified .ts and .html files
2. Filter for component and template files
3. Exclude test files and generated files

## Phase 2: Extract Untranslated Strings

For each changed file:

1. **In HTML files**: Find text content not wrapped in translation pipes or T references

- Look for: `<element>Text</element>`
- Look for: `placeholder="Text"`, `title="Text"`, etc.
- Ignore: `{{ T.KEY }}`, `{{ 'KEY' | translate }}`

2. **In TS files**: Find hardcoded strings in:

- Component properties
- Alert/dialog messages
- Error messages
- Button labels

## Phase 3: Generate Translation Keys

1. Create semantic keys based on:

- Component name
- Context/location
- String purpose

2. Follow existing naming patterns in en.json
3. Use dot notation for nested structures

## Phase 4: Update Translation Files

1. Read current en.json structure
2. Find appropriate section for new keys
3. Add new translations maintaining alphabetical order
4. Preserve JSON formatting

## Phase 5: Update Source Code

1. **In HTML files**:

- Replace `<element>Text</element>` with `<element>{{ T.KEY }}</element>`
- Replace `attribute="Text"` with `[attribute]="T.KEY"`

2. **In TS files**:

- Ensure T is imported: `import { T } from '../../t.const';`
- Replace string literals with `T.KEY`

## Phase 6: Finalize

1. Run `npm run int` to update translation configurations
2. Verify changes compile correctly
3. Report summary of changes

</workflow>

<arguments>
Optional arguments:
- `--days <number>`: How many days back to check for changes (default: 7)
- `--dry-run`: Preview changes without modifying files
- `--interactive`: Confirm each extraction before applying
</arguments>

<extraction_patterns>

## String Detection Patterns

### HTML Templates

```html
<!-- Extract these -->
<button>Click me</button>
<mat-label>Enter name</mat-label>
<div title="Tooltip text">
  <input placeholder="Search..." />

  <!-- Skip these -->
  <button>{{ T.BUTTON_CLICK }}</button>
  <mat-label>{{ 'LABEL_NAME' | translate }}</mat-label>
</div>
```

### TypeScript Files

```typescript
// Extract these
this.snackBar.open('Success!', 'OK');
const message = 'Error occurred';
dialogConfig.data = { title: 'Confirm' };

// Skip these
this.snackBar.open(T.SUCCESS_MESSAGE, T.OK);
const message = T.ERROR_OCCURRED;
```

### Key Naming Conventions

Follow the existing pattern in en.json:

- Feature-based grouping: `FEATURE_COMPONENT_ELEMENT`
- Action-based: `ACTION_CONTEXT`
- Common elements: `COMMON_ELEMENT_TYPE`

Examples:

- `TASK_LIST_EMPTY_MESSAGE`
- `DIALOG_CONFIRM_TITLE`
- `BUTTON_SAVE`

</extraction_patterns>

## Usage Examples

```bash
# Extract translations from files changed in last week
/extract-translations

# Check changes from last 3 days only
/extract-translations --days 3

# Preview without making changes
/extract-translations --dry-run

# Interactive mode for selective extraction
/extract-translations --interactive
```

## Edge Cases

Handle these edge cases:

1. Existing translations: Check if string already has a key
2. Dynamic strings: Skip template literals and concatenations
3. Special characters: Properly escape in JSON
4. File permissions: Ensure write access to translation files
5. Git conflicts: Warn if en.json has uncommitted changes

## Summary Report Example

```
Translation Extraction Complete
==============================
Files analyzed: 12
Strings extracted: 8
Keys generated: 8

Changes by file:
- src/app/features/tasks/task-list.component.html
  ✓ "No tasks" → T.TASK_LIST_EMPTY
  ✓ "Add task" → T.TASK_ADD_BUTTON
- src/app/features/tasks/task.service.ts
  ✓ "Task saved" → T.TASK_SAVED_MESSAGE

Translation file updated: src/assets/i18n/en.json
Build command executed: npm run int
```
