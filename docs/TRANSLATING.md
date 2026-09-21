# Translation Guide

Super Productivity uses JSON files for translations, located in `src/assets/i18n/`.

## How to Contribute

### Translate Existing Strings

Use the WIP file workflow to contribute translations for an existing language:

1. Run `node tools/add-missing-i18n-variables.js extract <lang>` from the repository root (for example, `extract nl` for Dutch).
2. Translate the strings in `src/assets/i18n/<lang>-wip.json`, preserving their nested keys and placeholders such as `{{name}}`.
3. Run `node tools/add-missing-i18n-variables.js merge <lang>`.
4. Review the changes and submit a pull request with the updated `<lang>.json`.

The extract command includes missing keys only; it does not include existing entries whose value is an empty string. To translate those entries or improve an existing translation, see [Translating Empty or Existing Values](i18n-script-usage.md#translating-empty-or-existing-values).

### Add or Change Source Strings

When adding or changing translation keys, **only edit `en.json` directly**. Other locale files are managed via the [i18n script workflow](i18n-script-usage.md).

1. Add or update translation keys in `src/assets/i18n/en.json`
2. Run the i18n script to propagate changes to other locales (see [i18n-script-usage.md](i18n-script-usage.md))
3. Submit a pull request

## Important Notes

### Fallback Language

**English (`en.json`) is the fallback language.** If a translation is missing or empty, the app automatically displays the English text.

### Suffixes for Inflected/Dative Forms (`_NTH`)

Some keys have duplicates with an `_NTH` suffix (e.g., `ORD_FIRST` vs `ORD_FIRST_NTH`).

- `ORD_FIRST` is used as a standalone option in the quick-setting menu (e.g., "first").
- `ORD_FIRST_NTH` is used inside full sentences (e.g., dative/inflected form in German or other inflected languages like "Monthly on the first Monday").
- In languages without inflection (like English), these values are identical.

### Empty Values Are Intentional

When you see empty strings (`""`), this is **intentional** - it triggers the English fallback. Do not copy the English text into empty fields unless you're providing an actual translation.

```json
{
  "SOME_KEY": ""
}
```

The above will display the English text for `SOME_KEY`.

### File Format

- Nested JSON structure
- Keys use SCREAMING_SNAKE_CASE
- Keep the structure intact - only change the string values

### Example

```json
{
  "G": {
    "CANCEL": "Abbrechen",
    "SAVE": "Speichern"
  }
}
```

## Tips

- Use `en.json` as reference for context
- Keep translations concise (UI space is limited)
- Test your translations locally if possible (`ng serve`)

## Translation Management Script

For managing missing translations and maintaining consistency, use the `tools/add-missing-i18n-variables.js` script. See [i18n-script-usage.md](i18n-script-usage.md) for detailed instructions.
