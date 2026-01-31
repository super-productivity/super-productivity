# I18n Translation Management Script

This document describes the usage of the `tools/add-missing-i18n-variables.js` script, which helps manage internationalization (i18n) files for Super Productivity.

## Overview

The script manages translation files located in `src/assets/i18n/`. The base language is English (`en.json`), and other languages like `de.json` (German), `tr.json` (Turkish), etc., contain translations.

The script supports three modes:

- **Extract mode**: Creates work-in-progress (WIP) files with missing translations for a specific language.
- **Merge mode**: Merges translated WIP files back into the main language file.
- **Legacy mode**: Adds missing keys to all language files (default when no mode is specified).

## File Structure

- `en.json`: The reference English file with all keys.
- `{lang}.json`: Main translation files (e.g., `de.json`, `tr.json`).
- `{lang}-wip.json`: Temporary work-in-progress files containing only missing translations.

## Usage

### Extract Missing Translations

To extract missing translations for a specific language (e.g., Turkish):

```bash
node tools/add-missing-i18n-variables.js extract tr
```

This creates `tr-wip.json` with all keys that exist in `en.json` but are missing or empty in `tr.json`.

### Translate WIP File

Edit the generated `{lang}-wip.json` file and provide translations for the keys.

Example `tr-wip.json`:

```json
{
  "APP": {
    "SKIP_SYNC_WAIT": "Skip waiting for sync"
  },
  "F": {
    "CALDAV": {
      "ISSUE_CONTENT": {
        "DESCRIPTION": "Description"
      }
    }
  }
}
```

### Merge Translations

After translating the WIP file, merge it back into the main language file:

```bash
node tools/add-missing-i18n-variables.js merge tr
```

This:

- Merges translations from `tr-wip.json` into `tr.json`
- Maintains the same key order as `en.json`
- Validates that all keys are present
- Deletes the `tr-wip.json` file

### Legacy Mode (Update All Files)

To add missing keys to all language files at once (preserving existing translations):

```bash
node tools/add-missing-i18n-variables.js
```

This updates all `{lang}.json` files to include any new keys from `en.json`, placing them in the same order.

## Workflow Example

1. New features are added, updating `en.json` with new keys.
2. Run extract for your language: `node tools/add-missing-i18n-variables.js extract de`
3. Translate the keys in `de-wip.json`.
4. Run merge: `node tools/add-missing-i18n-variables.js merge de`
5. Submit a pull request with the updated `de.json`.

## Notes

- The script preserves the order of keys to match `en.json`.
- Empty strings in translation files trigger English fallback.
- WIP files are temporary and it would be deleted via the merge command.
