/**
 * ESLint rule: require-text-locale
 *
 * Spelled-out weekday/month names must be formatted with
 * `DateTimeFormatService.textLocale()`, never `currentLocale()` and never the
 * implicit browser locale.
 *
 * Why: the ISO 8601 date option persists `dateTimeLocale = 'sv'` as a
 * backward-compatible sync marker (it yields YYYY-MM-DD + a 24h clock). ISO has
 * no spelled-out names of its own, so any name formatted with `currentLocale()`
 * comes out Swedish regardless of the UI language — "ons 15 juli 2026",
 * "Weekly on onsdag". That is #8987, which recurred across three PRs (#9013,
 * #9055, #9056) because `currentLocale()` is the obvious-looking default at
 * every new call site.
 *
 * `textLocale()` is `isoTextLocale() ?? currentLocale()`, so for every non-ISO
 * option it IS `currentLocale()`. For spelled-out names it is therefore never
 * worse and sometimes right — which is why this is an error, not a heuristic.
 *
 * Flagged: `.toLocaleDateString()` / `.toLocaleString()` / `new
 * Intl.DateTimeFormat()` whose options contain a spelled-out field (`weekday`,
 * `month: 'long'|'short'|'narrow'`, `era`, `dayPeriod`) when the locale argument
 * is `currentLocale()` — directly, or via a `const` initialised from it (the
 * shape the original #8987 bug had) — or is absent/`undefined`, which silently
 * uses the browser locale and ignores both the configured locale AND the UI
 * language.
 *
 * Deliberately NOT detected (pinned as `valid` cases in the spec so the boundary
 * is explicit and a change that starts catching them trips the spec):
 *   - a locale threaded through a parameter — `formatDayStr(dateStr, locale)`,
 *     `getWeekdaysMin(locale)`: the rule cannot see what the caller passed, so
 *     the obligation sits with the caller
 *   - a reassigned locale variable, or one built by a helper/ternary
 *   - a non-literal options object (variable or spread)
 *   - `.toLocaleTimeString()`: its options are hour/minute and `dayPeriod`
 *     (AM/PM) must follow `currentLocale()` so the ISO 24h clock is preserved
 *   - `new Intl.DateTimeFormat(currentLocale(), { hour, minute })`: clock times,
 *     same reason — only a spelled-out field trips the rule
 *
 * A clean run does NOT prove a file is free of #8987 — it proves the direct
 * call sites are.
 */

/** Options fields that render a spelled-out name rather than digits. */
const ALWAYS_SPELLED_OUT = new Set(['weekday', 'era', 'dayPeriod']);
const SPELLED_OUT_VALUES = new Set(['long', 'short', 'narrow']);

const NAME_FORMATTERS = new Set(['toLocaleDateString', 'toLocaleString']);

/**
 * True for an options object literal that renders at least one spelled-out name.
 * `month` only counts when spelled out — `month: 'numeric'` is digits, and those
 * must keep `currentLocale()` so ISO day-first ordering survives.
 */
const rendersSpelledOutName = (optsNode) => {
  if (!optsNode || optsNode.type !== 'ObjectExpression') return false;
  return optsNode.properties.some((prop) => {
    if (prop.type !== 'Property' || prop.computed) return false;
    const key = prop.key.name || prop.key.value;
    if (ALWAYS_SPELLED_OUT.has(key)) return true;
    if (key === 'month') {
      return prop.value.type === 'Literal' && SPELLED_OUT_VALUES.has(prop.value.value);
    }
    return false;
  });
};

/** True for `<anything>.currentLocale()`. */
const isCurrentLocaleCall = (node) =>
  node &&
  node.type === 'CallExpression' &&
  node.callee.type === 'MemberExpression' &&
  !node.callee.computed &&
  node.callee.property.name === 'currentLocale';

const findVariable = (scope, name) => {
  for (let s = scope; s; s = s.upper) {
    const found = s.variables.find((v) => v.name === name);
    if (found) return found;
  }
  return null;
};

/**
 * True when `node` is `currentLocale()` or an identifier that can only hold its
 * result. The single-write check keeps this to variables that are never
 * reassigned, so we never guess at a value the rule cannot actually see.
 */
const resolvesToCurrentLocale = (node, scope) => {
  if (isCurrentLocaleCall(node)) return true;
  if (!node || node.type !== 'Identifier' || !scope) return false;

  const variable = findVariable(scope, node.name);
  if (!variable || variable.defs.length !== 1) return false;

  const def = variable.defs[0];
  if (def.type !== 'Variable' || !def.node.init) return false;
  if (variable.references.filter((ref) => ref.isWrite()).length !== 1) return false;

  return isCurrentLocaleCall(def.node.init);
};

/** `undefined` / omitted / `null` all fall back to the browser's locale. */
const isImplicitLocale = (node) =>
  !node ||
  (node.type === 'Identifier' && node.name === 'undefined') ||
  (node.type === 'Literal' && node.value === null);

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Spelled-out weekday/month names must be formatted with textLocale(), not currentLocale() or the implicit browser locale',
      category: 'Possible Errors',
      recommended: false,
    },
    messages: {
      numericLocaleForName:
        'This formats a spelled-out {{field}} with currentLocale(). Under the ISO 8601 option currentLocale() is the `sv` sentinel, so the name renders in Swedish whatever the UI language (#8987). Use DateTimeFormatService.textLocale() — it equals currentLocale() for every non-ISO option. Numeric-only parts (month: "numeric", day, year) should keep currentLocale().',
      implicitLocaleForName:
        'This formats a spelled-out {{field}} with no locale, so it follows the *browser* locale and ignores both the configured date locale and the UI language. Use DateTimeFormatService.textLocale().',
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode();

    /** Name the offending field so the message points at the actual culprit. */
    const spelledOutField = (optsNode) => {
      const prop = optsNode.properties.find((p) => {
        if (p.type !== 'Property' || p.computed) return false;
        const key = p.key.name || p.key.value;
        return (
          ALWAYS_SPELLED_OUT.has(key) ||
          (key === 'month' &&
            p.value.type === 'Literal' &&
            SPELLED_OUT_VALUES.has(p.value.value))
        );
      });
      return prop ? prop.key.name || prop.key.value : 'name';
    };

    /** Both `d.toLocaleDateString(locale, opts)` and `new Intl.DateTimeFormat(locale, opts)`. */
    const check = (node) => {
      const [localeArg, optsArg] = node.arguments;
      if (!rendersSpelledOutName(optsArg)) return;

      const field = spelledOutField(optsArg);
      const scope = sourceCode.getScope ? sourceCode.getScope(node) : null;

      if (isImplicitLocale(localeArg)) {
        context.report({
          node: localeArg || node,
          messageId: 'implicitLocaleForName',
          data: { field },
        });
        return;
      }

      if (resolvesToCurrentLocale(localeArg, scope)) {
        context.report({
          node: localeArg,
          messageId: 'numericLocaleForName',
          data: { field },
        });
      }
    };

    return {
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          !node.callee.computed &&
          NAME_FORMATTERS.has(node.callee.property.name)
        ) {
          check(node);
        }
      },
      // `new Intl.DateTimeFormat(locale, opts)` is the same trap in constructor form.
      NewExpression(node) {
        const callee = node.callee;
        if (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'Intl' &&
          callee.property.name === 'DateTimeFormat'
        ) {
          check(node);
        }
      },
    };
  },
};
