/**
 * Tests for require-text-locale ESLint rule
 */
const { RuleTester } = require('eslint');
const rule = require('./require-text-locale');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

ruleTester.run('require-text-locale', rule, {
  valid: [
    // The blessed pattern: spelled-out names go through textLocale().
    {
      code: `
        const label = date.toLocaleDateString(this._dateTimeFormatService.textLocale(), {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        });
      `,
    },
    // Numeric-only parts MUST keep currentLocale() so ISO day-first survives.
    {
      code: `
        const dayAndMonth = date.toLocaleDateString(this._dateTimeFormatService.currentLocale(), {
          day: 'numeric',
          month: 'numeric',
        });
      `,
    },
    // The whole-date numeric case (ISO yyyy-MM-dd) — no spelled-out field at all.
    {
      code: `const raw = date.toLocaleDateString(this._dateTimeFormatService.currentLocale());`,
    },
    // toLocaleTimeString: a clock time, which must follow currentLocale so the
    // ISO 24h clock is preserved. Deliberately out of scope.
    {
      code: `
        const t = date.toLocaleTimeString(this._dateTimeFormatService.currentLocale(), {
          hour: 'numeric',
          minute: 'numeric',
        });
      `,
    },
    // A spelled-out dayPeriod in a clock time still keeps currentLocale: routing
    // it to textLocale() would flip the ISO 24h clock to 12h ("13:05" -> "1:05
    // in the afternoon"). dayPeriod only renders under a 12h clock at all.
    {
      code: `
        const t = date.toLocaleString(this._dateTimeFormatService.currentLocale(), {
          hour: 'numeric',
          minute: '2-digit',
          dayPeriod: 'short',
        });
      `,
    },
    {
      code: `
        const f = new Intl.DateTimeFormat(this._dateTimeFormatService.currentLocale(), {
          hour: 'numeric',
          minute: '2-digit',
          dayPeriod: 'short',
        });
      `,
    },
    // A mixed date+time format has no single correct locale — textLocale() would
    // fix the weekday but break the clock ("onsdag 13:05" -> "Wednesday 1:05
    // PM"). It must be split instead, so the rule stays out of it (blind spot).
    {
      code: `
        const s = date.toLocaleString(this._dateTimeFormatService.currentLocale(), {
          weekday: 'long',
          hour: 'numeric',
          minute: '2-digit',
        });
      `,
    },
    // dateStyle: 'short' is NUMERIC ("2026-07-15") — the inversion vs month:
    // 'short' ("Jul"). It must keep currentLocale() or ISO YYYY-MM-DD breaks.
    {
      code: `const s = date.toLocaleDateString(this._dateTimeFormatService.currentLocale(), { dateStyle: 'short' });`,
    },
    // timeStyle is a clock time, so dateStyle+timeStyle is the mixed case again
    // ("onsdag 15 juli 2026 kl. 13:05" -> "Wednesday, July 15, 2026 at 1:05 PM").
    {
      code: `
        const s = date.toLocaleString(this._dateTimeFormatService.currentLocale(), {
          dateStyle: 'full',
          timeStyle: 'short',
        });
      `,
    },
    {
      code: `const t = date.toLocaleString(this._dateTimeFormatService.currentLocale(), { timeStyle: 'short' });`,
    },
    // A locale threaded through a parameter: the rule cannot see the caller's
    // value, so the obligation sits with the caller (getWeekdaysMin, formatDayStr).
    {
      code: `
        export const formatDayStr = (dateStr, locale) =>
          new Date(dateStr).toLocaleDateString(locale, { weekday: 'short' });
      `,
    },
    // An explicit literal locale is a deliberate choice, not the sentinel trap.
    {
      code: `const s = date.toLocaleDateString('en-US', { weekday: 'long' });`,
    },
    // Reassigned variable — the rule refuses to guess at a value it can't pin.
    {
      code: `
        let locale = this._dateTimeFormatService.currentLocale();
        locale = pickSomethingElse();
        const s = date.toLocaleDateString(locale, { weekday: 'long' });
      `,
    },
    // Non-literal options object — not statically inspectable.
    {
      code: `const s = date.toLocaleDateString(this._dateTimeFormatService.currentLocale(), opts);`,
    },
    // No options at all renders a numeric date, so there is no name to localize.
    // (It still follows the browser locale, but that is not this rule's job.)
    {
      code: `const s = date.toLocaleDateString();`,
    },
    // Intl.DateTimeFormat with textLocale() — the blessed constructor form.
    {
      code: `const f = new Intl.DateTimeFormat(this._dateTimeFormatService.textLocale(), { weekday: 'short' });`,
    },
    // Clock times via Intl.DateTimeFormat MUST keep currentLocale() so the ISO
    // 24h format survives — no spelled-out field, so no report (schedule-week).
    {
      code: `
        const formatter = new Intl.DateTimeFormat(this._dateTimeFormatService.currentLocale(), {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });
      `,
    },
    // The isoTextLocale-guarded form: the ternary keeps Angular's CLDR path for
    // non-ISO, so the locale is an isoTextLocale value, never currentLocale().
    {
      code: `
        const isoTextLocale = this._dateTimeFormatService.isoTextLocale();
        const weekdayFormatter = isoTextLocale
          ? new Intl.DateTimeFormat(isoTextLocale, { weekday: 'short' })
          : null;
      `,
    },
  ],

  invalid: [
    // Direct currentLocale() + weekday — the quick-setting-label shape.
    {
      code: `
        const s = refDate.toLocaleDateString(this._dateTimeFormatService.currentLocale(), {
          weekday: 'long',
        });
      `,
      errors: [{ messageId: 'numericLocaleForName', data: { field: 'weekday' } }],
    },
    // currentLocale() via a const — the exact shape the original #8987 bug had
    // in plannedStartDateStr. A rule that missed this would have missed the bug.
    {
      code: `
        const locale = this._dateTimeFormatService.currentLocale();
        const formatted = date.toLocaleDateString(locale, {
          weekday: 'short',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
      `,
      errors: [{ messageId: 'numericLocaleForName' }],
    },
    // month: 'short' is spelled out — the add-task-bar date-chip shape.
    {
      code: `
        const dateStr = date.toLocaleDateString(this._dateTimeFormatService.currentLocale(), {
          month: 'short',
          day: 'numeric',
        });
      `,
      errors: [{ messageId: 'numericLocaleForName', data: { field: 'month' } }],
    },
    // Implicit browser locale — the planner-calendar-nav monthLabel shape.
    {
      code: `const s = date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });`,
      errors: [{ messageId: 'implicitLocaleForName', data: { field: 'month' } }],
    },
    // toLocaleString is the same trap.
    {
      code: `const s = date.toLocaleString(this._dateTimeFormatService.currentLocale(), { weekday: 'narrow' });`,
      errors: [{ messageId: 'numericLocaleForName' }],
    },
    // Intl.DateTimeFormat is the same trap in constructor form — the gap that
    // would otherwise let #8987 back in through a different syntax.
    {
      code: `const f = new Intl.DateTimeFormat(this._dateTimeFormatService.currentLocale(), { weekday: 'short' });`,
      errors: [{ messageId: 'numericLocaleForName', data: { field: 'weekday' } }],
    },
    // Constructor form with the implicit browser locale.
    {
      code: `const f = new Intl.DateTimeFormat(undefined, { month: 'long' });`,
      errors: [{ messageId: 'implicitLocaleForName', data: { field: 'month' } }],
    },
    // dateStyle: 'full' renders the canonical #8987 string under the sentinel —
    // "onsdag 15 juli 2026" — without naming weekday/month at all.
    {
      code: `const s = date.toLocaleDateString(this._dateTimeFormatService.currentLocale(), { dateStyle: 'full' });`,
      errors: [{ messageId: 'numericLocaleForName', data: { field: 'dateStyle' } }],
    },
    // 'medium' is spelled out too ("15 juli 2026"), unlike 'short'.
    {
      code: `const s = date.toLocaleDateString(this._dateTimeFormatService.currentLocale(), { dateStyle: 'medium' });`,
      errors: [{ messageId: 'numericLocaleForName', data: { field: 'dateStyle' } }],
    },
    {
      code: `const f = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' });`,
      errors: [{ messageId: 'implicitLocaleForName', data: { field: 'dateStyle' } }],
    },
  ],
});
