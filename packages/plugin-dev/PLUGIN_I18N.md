# Plugin Internationalization (i18n) Guide

This guide explains how to add multi-language support to your Super Productivity plugins.

## Quick Start

```
my-plugin/
├── manifest.json          # Declare supported languages
├── plugin.js
└── i18n/                  # Translation files
    ├── en.json           # Required - English
    ├── de.json           # Optional - German
    └── fr.json           # Optional - French
```

**manifest.json**:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "i18n": {
    "languages": ["en", "de", "fr"]
  }
}
```

**i18n/en.json**:

```json
{
  "GREETING": "Hello from my plugin!",
  "TASK_COUNT": "You have {{count}} tasks",
  "BUTTONS": {
    "SAVE": "Save",
    "CANCEL": "Cancel"
  }
}
```

**plugin.js**:

```javascript
// Use translations in your plugin
const greeting = api.translate('GREETING');
const taskMsg = api.translate('TASK_COUNT', { count: 5 });
const saveBtn = api.translate('BUTTONS.SAVE');
```

## Plugin Structure

### 1. Manifest Configuration

Add the `i18n` section to your `manifest.json`:

```json
{
  "id": "my-awesome-plugin",
  "name": "My Awesome Plugin",
  "version": "1.0.0",
  "description": "A plugin with multi-language support",
  "i18n": {
    "languages": ["en", "de", "fr", "es"]
  }
}
```

**Fields**:

- `languages` (required): Array of language codes supported by your plugin
- Must include at least `"en"` (English)
- Use standard language codes: `en`, `de`, `fr`, `es`, `ja`, `zh`, etc.

### 2. Translation Files

Create an `i18n/` folder in your plugin with JSON files for each language:

```
my-plugin/
├── i18n/
│   ├── en.json    # English (required)
│   ├── de.json    # German
│   ├── fr.json    # French
│   └── es.json    # Spanish
```

**File naming**: Use language codes from the manifest (e.g., `en.json`, `de.json`)

### 3. Translation File Format

Use hierarchical JSON structure for organization:

```json
{
  "MESSAGES": {
    "WELCOME": "Welcome to the plugin!",
    "GOODBYE": "See you later!",
    "ERROR": "An error occurred: {{error}}"
  },
  "BUTTONS": {
    "SAVE": "Save",
    "CANCEL": "Cancel",
    "DELETE": "Delete"
  },
  "LABELS": {
    "TASK_NAME": "Task Name",
    "DUE_DATE": "Due Date"
  }
}
```

**Best practices**:

- Use UPPERCASE keys for consistency
- Group related translations together
- Keep hierarchy simple (2-3 levels max)
- Use descriptive key names

## API Methods

### translate(key, params?)

Translate a key with optional parameter interpolation.

**Parameters**:

- `key` (string): Translation key using dot notation
- `params` (object, optional): Values to interpolate into the translation

**Returns**: Translated string, or the key itself if translation not found

**Examples**:

```javascript
// Simple translation
const greeting = api.translate('MESSAGES.WELCOME');
// → "Welcome to the plugin!" (en)
// → "Willkommen zum Plugin!" (de)

// With parameters
const error = api.translate('MESSAGES.ERROR', {
  error: 'Network timeout',
});
// → "An error occurred: Network timeout"

// With multiple parameters
const summary = api.translate('SUMMARY', {
  count: 5,
  type: 'tasks',
});
// → "You have 5 tasks"

// Nested keys
const btnLabel = api.translate('BUTTONS.SAVE');
// → "Save"
```

**Fallback behavior**:

1. Try current app language (e.g., German)
2. Fall back to English if key not found
3. Return the key itself if not in English either

```javascript
// User's language is German (de)
// de.json has: { "BUTTONS": { "SAVE": "Speichern" } }
// en.json has: { "BUTTONS": { "SAVE": "Save", "CANCEL": "Cancel" } }

api.translate('BUTTONS.SAVE'); // → "Speichern" (from de.json)
api.translate('BUTTONS.CANCEL'); // → "Cancel" (from en.json - fallback)
api.translate('BUTTONS.DELETE'); // → "BUTTONS.DELETE" (not found)
```

### formatDate(date, format)

Format a date according to the current locale.

**Parameters**:

- `date` (Date | string | number): Date to format
  - Date object
  - ISO 8601 string (e.g., `"2026-01-16T14:30:00Z"`)
  - Timestamp (milliseconds since epoch)
- `format` (string): Predefined format
  - `"short"` - Short date (1/16/26)
  - `"medium"` - Medium date (Jan 16, 2026)
  - `"long"` - Long date (January 16, 2026)
  - `"time"` - Time only (2:30 PM)
  - `"datetime"` - Date and time (1/16/26, 2:30 PM)

**Returns**: Formatted date string

**Examples**:

```javascript
const now = new Date();

// Short format
api.formatDate(now, 'short');
// → "1/16/26" (en-US)
// → "16.1.26" (de)

// Long format
api.formatDate(now, 'long');
// → "January 16, 2026" (en)
// → "16. Januar 2026" (de)

// Time only
api.formatDate(now, 'time');
// → "2:30 PM" (en)
// → "14:30" (de)

// ISO string input
api.formatDate('2026-01-16T14:30:00Z', 'datetime');
// → "1/16/26, 2:30 PM" (en)

// Timestamp input
api.formatDate(1737039000000, 'medium');
// → "Jan 16, 2026" (en)
```

### getCurrentLanguage()

Get the current app language code.

**Returns**: Language code (e.g., `"en"`, `"de"`, `"fr"`)

**Example**:

```javascript
const lang = api.getCurrentLanguage();
console.log(`Current language: ${lang}`);
// → "Current language: de"

// Conditional logic based on language
if (lang === 'ja' || lang === 'zh') {
  // Special handling for Asian languages
  console.log('Using CJK font');
}
```

## Language Change Hook

Listen for language changes to update your plugin UI:

```javascript
api.registerHook('languageChange', ({ newLanguage }) => {
  console.log(`Language changed to: ${newLanguage}`);

  // Plugin translations are automatically reloaded
  // Update your UI if needed
  updatePluginUI();
});
```

**Note**: Plugin translations are automatically reloaded when the language changes. You only need this hook if you have additional UI updates to perform.

## Supported Languages

Super Productivity supports these language codes:

| Code    | Language              |
| ------- | --------------------- |
| `en`    | English               |
| `de`    | German                |
| `es`    | Spanish               |
| `fr`    | French                |
| `it`    | Italian               |
| `pt`    | Portuguese            |
| `pt-br` | Portuguese (Brazil)   |
| `ru`    | Russian               |
| `zh`    | Chinese (Simplified)  |
| `zh-tw` | Chinese (Traditional) |
| `ja`    | Japanese              |
| `ko`    | Korean                |
| `ar`    | Arabic                |
| `fa`    | Persian               |
| `tr`    | Turkish               |
| `pl`    | Polish                |
| `nl`    | Dutch                 |
| `nb`    | Norwegian             |
| `sv`    | Swedish               |
| `fi`    | Finnish               |
| `cz`    | Czech                 |
| `sk`    | Slovak                |
| `hr`    | Croatian              |
| `uk`    | Ukrainian             |
| `id`    | Indonesian            |

## Complete Example

Here's a complete plugin with i18n support:

**Directory structure**:

```
task-counter-plugin/
├── manifest.json
├── plugin.js
└── i18n/
    ├── en.json
    └── de.json
```

**manifest.json**:

```json
{
  "id": "task-counter",
  "name": "Task Counter",
  "version": "1.0.0",
  "description": "Count and display task statistics",
  "i18n": {
    "languages": ["en", "de"]
  }
}
```

**i18n/en.json**:

```json
{
  "TITLE": "Task Statistics",
  "TOTAL_TASKS": "Total tasks: {{count}}",
  "COMPLETED_TODAY": "Completed today: {{count}}",
  "UPDATED": "Last updated: {{time}}",
  "BUTTONS": {
    "REFRESH": "Refresh",
    "CLOSE": "Close"
  }
}
```

**i18n/de.json**:

```json
{
  "TITLE": "Aufgabenstatistik",
  "TOTAL_TASKS": "Gesamt Aufgaben: {{count}}",
  "COMPLETED_TODAY": "Heute erledigt: {{count}}",
  "UPDATED": "Zuletzt aktualisiert: {{time}}",
  "BUTTONS": {
    "REFRESH": "Aktualisieren",
    "CLOSE": "Schließen"
  }
}
```

**plugin.js**:

```javascript
(async function () {
  // Display task statistics with translations
  async function showStatistics() {
    const tasks = await api.getTasks();
    const completedToday = tasks.filter((t) => t.isDone && isToday(t.doneOn));

    const title = api.translate('TITLE');
    const totalMsg = api.translate('TOTAL_TASKS', {
      count: tasks.length,
    });
    const completedMsg = api.translate('COMPLETED_TODAY', {
      count: completedToday.length,
    });
    const updatedMsg = api.translate('UPDATED', {
      time: api.formatDate(new Date(), 'time'),
    });
    const refreshBtn = api.translate('BUTTONS.REFRESH');

    api.showSnack({
      msg: `${title}\n${totalMsg}\n${completedMsg}\n${updatedMsg}`,
      type: 'SUCCESS',
    });
  }

  // Register menu entry
  api.registerMenuEntry({
    label: api.translate('TITLE'),
    icon: 'analytics',
    onClick: showStatistics,
  });

  // Update translations when language changes
  api.registerHook('languageChange', () => {
    console.log('Language changed, UI will update on next interaction');
  });

  function isToday(timestamp) {
    if (!timestamp) return false;
    const today = new Date();
    const date = new Date(timestamp);
    return date.toDateString() === today.toDateString();
  }
})();
```

## Best Practices

### 1. Always Include English

English is the fallback language. Always provide `en.json`:

```json
{
  "i18n": {
    "languages": ["en", "de", "fr"] // ✓ English first
  }
}
```

### 2. Keep Keys Consistent

Use the same keys across all language files:

**en.json**:

```json
{
  "SAVE": "Save",
  "CANCEL": "Cancel"
}
```

**de.json**:

```json
{
  "SAVE": "Speichern",
  "CANCEL": "Abbrechen"
}
```

### 3. Use Descriptive Keys

```javascript
// ✓ Good - descriptive
api.translate('BUTTONS.SAVE_TASK');

// ✗ Bad - vague
api.translate('BTN1');
```

### 4. Group Related Translations

```json
{
  "ERRORS": {
    "NETWORK": "Network error",
    "PERMISSION": "Permission denied",
    "VALIDATION": "Invalid input"
  },
  "SUCCESS": {
    "SAVED": "Saved successfully",
    "DELETED": "Deleted successfully"
  }
}
```

### 5. Handle Plurals Carefully

Use parameters for dynamic pluralization:

```json
{
  "TASK_COUNT_SINGULAR": "{{count}} task remaining",
  "TASK_COUNT_PLURAL": "{{count}} tasks remaining"
}
```

```javascript
const count = tasks.length;
const key = count === 1 ? 'TASK_COUNT_SINGULAR' : 'TASK_COUNT_PLURAL';
const msg = api.translate(key, { count });
```

### 6. Date Formatting

Always use `formatDate()` instead of manual formatting:

```javascript
// ✓ Good - locale-aware
const formatted = api.formatDate(task.dueDate, 'short');

// ✗ Bad - hard-coded format
const formatted = `${month}/${day}/${year}`;
```

## Troubleshooting

### Plugin Shows Keys Instead of Translations

**Cause**: Translation files not loaded or keys don't match

**Solution**:

1. Check `i18n/` folder exists in your plugin
2. Verify JSON files are valid
3. Ensure keys match exactly (case-sensitive)
4. Check browser console for errors

### Wrong Language Displayed

**Cause**: Language not supported by plugin

**Solution**:

- Add the language to manifest `i18n.languages`
- Create the corresponding JSON file
- Plugin falls back to English for unsupported languages

### Translations Not Updating

**Cause**: Plugin code caching translations

**Solution**:

- Call `api.translate()` each time you need the translation
- Don't cache translation results
- The API handles caching internally

### Parameters Not Interpolating

**Cause**: Wrong placeholder syntax or missing parameter

**Solution**:

```javascript
// ✓ Correct syntax
api.translate('MESSAGE', { name: 'John' }); // "Hello, John"

// ✗ Wrong - missing curly braces
('Hello, {{name}}'); // ✓ Correct
('Hello, $name'); // ✗ Wrong

// ✗ Wrong - parameter name doesn't match
api.translate('MESSAGE', { user: 'John' }); // Won't replace {{name}}
```

## Migration from Hard-coded Strings

If you have an existing plugin with hard-coded strings:

**Before**:

```javascript
api.showSnack({ msg: 'Task saved successfully' });
const label = 'Save Task';
```

**After**:

1. Create translation files:

**en.json**:

```json
{
  "MESSAGES": {
    "TASK_SAVED": "Task saved successfully"
  },
  "LABELS": {
    "SAVE_TASK": "Save Task"
  }
}
```

2. Update plugin code:

```javascript
api.showSnack({
  msg: api.translate('MESSAGES.TASK_SAVED'),
});
const label = api.translate('LABELS.SAVE_TASK');
```

3. Update manifest:

```json
{
  "i18n": {
    "languages": ["en"]
  }
}
```

## Testing i18n

### 1. Test All Languages

```javascript
// Switch languages in Super Productivity settings
// Verify your plugin displays correct translations
```

### 2. Test Fallbacks

```javascript
// Remove a key from non-English language
// Verify it falls back to English
```

### 3. Test Parameter Interpolation

```javascript
// Test with various parameter values
const msg = api.translate('COUNT', { count: 0 });
const msg = api.translate('COUNT', { count: 1 });
const msg = api.translate('COUNT', { count: 100 });
```

### 4. Test Date Formats

```javascript
// Test all format options
const formats = ['short', 'medium', 'long', 'time', 'datetime'];
formats.forEach((fmt) => {
  console.log(api.formatDate(new Date(), fmt));
});
```

## Performance Considerations

1. **Translation files are loaded once** at plugin activation
2. **Translations are cached** in memory
3. **No performance impact** on frequent `translate()` calls
4. **Language switching** reuses already-loaded translations

## See Also

- [Plugin Development Guide](README.md)
- [Plugin API Reference](../plugin-api/README.md)
- [Example Plugins](.)
