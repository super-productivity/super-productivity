# Translation Guide

Super Productivity uses JSON files for translations, located in `src/assets/i18n/`.

## How to Contribute

> **Important:** When adding or changing translation keys, **only edit `en.json` directly**. Other locale files are managed via the i18n script workflow described in [i18n-script-usage.md](i18n-script-usage.md). Editing other locale files by hand may cause your changes to be overwritten.

1. Add or update translation keys in `src/assets/i18n/en.json`
2. Run the i18n script to propagate changes to other locales (see [i18n-script-usage.md](i18n-script-usage.md))
3. Submit a pull request

## Important Notes

### Fallback Language

**English (`en.json`) is the fallback language.** If a translation is missing or empty, the app automatically displays the English text.

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
