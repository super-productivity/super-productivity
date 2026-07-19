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
 * `month: 'long'|'short'|'narrow'`, `dateStyle: 'full'|'long'|'medium'`, `era`,
 * `dayPeriod`) and no clock time, when the locale argument is `currentLocale()`
 * — directly, or via a `const` initialised from it (the shape the original
 * #8987 bug had) — or is absent/`undefined`, which silently uses the browser
 * locale and ignores both the configured locale AND the UI language.
 *
 * Deliberately NOT detected (pinned as `valid` cases in the spec so the boundary
 * is explicit and a change that starts catching them trips the spec):
 *   - a locale threaded through a parameter — `formatDayStr(dateStr, locale)`,
 *     `getWeekdaysMin(locale)`: the rule cannot see what the caller passed, so
 *     the obligation sits with the caller
 *   - a reassigned locale variable, or one built by a helper/ternary
 *   - a non-literal options object (variable or spread)
 *   - `.toLocaleTimeString()`: a clock time, whose locale is pinned by the 24h
 *     rule below
 *   - ANY options object that also formats a clock time (`hour`, `timeStyle`),
 *     whatever else it renders — `{ hour, minute }`, `{ hour, minute, dayPeriod }`,
 *     `{ weekday, hour }`, `{ dateStyle, timeStyle }`. See
 *     `rendersSpelledOutName` for why the rule cannot advise on these.
 *
 * A clean run does NOT prove a file is free of #8987 — it proves the direct
 * call sites are.
 */

/** Options fields that render a spelled-out name whatever their value. */
const ALWAYS_SPELLED_OUT = new Set(['weekday', 'era', 'dayPeriod']);

/**
 * Fields that render a spelled-out name only for certain values — each with its
 * OWN value set, because the two invert and a shared set would be a bug:
 * `month: 'short'` is "Jul" (spelled out) but `dateStyle: 'short'` is
 * "2026-07-15" (numeric). Flagging `dateStyle: 'short'` would push the reader to
 * route ISO's YYYY-MM-DD through textLocale() and break it — the mirror of the
 * clock-time trap below. Values not listed are digits and must keep
 * `currentLocale()` so ISO day-first ordering survives.
 */
const SPELLED_OUT_BY_VALUE = new Map([
  ['month', new Set(['long', 'short', 'narrow'])],
  ['dateStyle', new Set(['full', 'long', 'medium'])],
]);

/** Options fields that format a clock time. */
const CLOCK_TIME_FIELDS = new Set(['hour', 'timeStyle']);

const NAME_FORMATTERS = new Set(['toLocaleDateString', 'toLocaleString']);

/** The key of a statically-readable options property, or `null`. */
const propKey = (prop) => {
  if (prop.type !== 'Property' || prop.computed) return null;
  return prop.key.name || prop.key.value;
};

/** True for an options object literal that also formats a clock time. */
const rendersClockTime = (optsNode) =>
  optsNode.properties.some((prop) => CLOCK_TIME_FIELDS.has(propKey(prop)));

/** True when the property renders a spelled-out name rather than digits. */
const isSpelledOutProp = (prop) => {
  const key = propKey(prop);
  if (key === null) return false;
  if (ALWAYS_SPELLED_OUT.has(key)) return true;
  const spelledOutValues = SPELLED_OUT_BY_VALUE.get(key);
  return (
    !!spelledOutValues &&
    prop.value.type === 'Literal' &&
    spelledOutValues.has(prop.value.value)
  );
};

/**
 * True for an options object literal that renders at least one spelled-out name
 * and no clock time.
 *
 * A clock time in the same options object pins the locale: it renders 24h under
 * the ISO `sv` sentinel but 12h under most UI languages, so swapping the whole
 * call to `textLocale()` would trade a Swedish name for a broken clock — "onsdag
 * 13:05" becomes "Wednesday 1:05 PM", the very ISO regression this rule family
 * exists to prevent. Such a format has no single correct locale; it has to be
 * split (names on `textLocale()`, clock on `currentLocale()` — see
 * `plannedStartDateStr`), which is more than a one-locale message can advise.
 * Staying silent costs a blind spot on `{ weekday, hour }`; firing would cost
 * confidently wrong advice at `error` severity.
 */
const rendersSpelledOutName = (optsNode) => {
  if (!optsNode || optsNode.type !== 'ObjectExpression') return false;
  if (rendersClockTime(optsNode)) return false;
  return optsNode.properties.some(isSpelledOutProp);
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
        'This formats a spelled-out {{field}} with currentLocale(). Under the ISO 8601 option currentLocale() is the `sv` sentinel, so the name renders in Swedish whatever the UI language (#8987). Use DateTimeFormatService.textLocale() — it equals currentLocale() for every non-ISO option. Numeric-only parts (month: "numeric", dateStyle: "short", day, year) should keep currentLocale().',
      implicitLocaleForName:
        'This formats a spelled-out {{field}} with no locale, so it follows the *browser* locale and ignores both the configured date locale and the UI language. Use DateTimeFormatService.textLocale().',
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode();

    /** Name the offending field so the message points at the actual culprit. */
    const spelledOutField = (optsNode) => {
      const prop = optsNode.properties.find(isSpelledOutProp);
      return prop ? propKey(prop) : 'name';
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
