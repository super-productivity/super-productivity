# Translation Guide

Super Productivity uses JSON files for translations, located in `src/assets/i18n/`.

## How to Contribute

1. Find your language file in `src/assets/i18n/` (e.g., `de.json` for German)
2. Edit the JSON file directly
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
