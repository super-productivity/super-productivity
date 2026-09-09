/**
 * ESLint rule: no-user-content-in-logs
 *
 * Log history is exportable — `Log.exportLogHistory()` backs the config-page
 * download and the "Logs" button on the error overlay — and exported logs are
 * routinely attached to public bug reports. User content (task titles, notes,
 * calendar event titles, project names) must therefore never reach a Log
 * method. See src/app/core/log.ts and rule #9 in CLAUDE.md.
 *
 * `MAX_DATA_LENGTH` is not a safety net: the export caps each arg at 400
 * characters, but a task title is far shorter than that, so it exports
 * verbatim.
 *
 * What it reports: a whole variable handed over instead of named fields —
 * bare, as a property value, spread, or nested inside a logged literal.
 *
 *   Log.log('addEvToShow', calEv)        // bare identifier   -> reported
 *   Log.log({ taskForEvent, allEvs })    // shorthand         -> reported
 *   Log.log({ ev: calEv })               // longhand          -> reported
 *   Log.log({ ctx: { task } })           // nested            -> reported
 *   Log.log('x', { calEvId: calEv.id })  // named field       -> fine
 *
 * Longhand is reported as well as shorthand because `object-shorthand` is not
 * enforced here, so `: calEv` would otherwise be a shorter fix than naming the
 * field. `task!` and `task as X` are unwrapped for the same reason.
 *
 * Names that state their own shape are allowed: ids, counts, booleans, module
 * constants, and errors. Two asymmetries are deliberate:
 * - Safe words match the whole name or a capitalised suffix, never a lowercase
 *   tail — `/count$/i` would allow `account`, `/ms$/i` would allow `params`.
 * - A key only vouches for its value when it names a QUANTITY
 *   (`{ bannerCount: n }`). An entity label must not: `{ taskId: task }` is the
 *   likeliest typo of the fix this rule asks for, so it has to stay reported.
 *
 * The error allowlist (`e`, `err`, `statError`) keeps `Log.err(e)` usable; it
 * does not certify the value. `log.ts` narrows to name/message/stack only for a
 * real `instanceof Error`, and Angular's `HttpErrorResponse` is not one — it is
 * stringified whole, exporting `.url` and the response body. An HTTP catch
 * block still needs a hand-written scrub, as `calendar-integration.service.ts`
 * does for iCal URLs carrying a secret token.
 *
 * Known gaps (accepted — this is a tripwire against the common accident, not
 * proof of absence). It reasons about shape, never about what a value holds, so
 * a call result (`JSON.stringify(task)`, `ev.getFirstPropertyValue('summary')`),
 * an interpolation, a named member access (`task.title`), a variable assigned
 * user content earlier, or a logger reached through a member chain
 * (`api.log.err(...)` in bundled plugins) all pass. Two shapes were considered
 * and left out on evidence — neither occurs in src/app today, and guarding
 * them cost more than it bought: an entity dictionary riding the id suffix
 * (`tasksById`), and an `as HttpErrorResponse` assertion, which the paragraph
 * above explains is not narrowed by log.ts. A reviewer still has to think.
 *
 * Scoped to src/app (excluding specs) via eslint.config.js.
 */

// Methods on a `*Log` object that record to the exportable history. Anything
// else on the class (setLevel, setContext, getLogHistory) takes config values,
// not payloads.
const LOG_METHODS = new Set([
  'log',
  'warn',
  'err',
  'error',
  'info',
  'debug',
  'verbose',
  'critical',
  'normal',
  'x',
]);

const suffixRe = (words) =>
  new RegExp(`(?:${words.map((w) => w[0].toUpperCase() + w.slice(1)).join('|')})$`);

// A quantity is the only thing a KEY may vouch for — see the docstring.
const QUANTITY_WORDS = [
  'count',
  'length',
  'len',
  'size',
  'index',
  'idx',
  'ms',
  'nr',
  'num',
];
// Everything a VALUE's own name may vouch for.
const SAFE_WORDS = [
  ...QUANTITY_WORDS,
  'id',
  'ids',
  'type',
  'kind',
  'status',
  'version',
  'flag',
  'enabled',
];

const QUANTITY_WHOLE = new Set(QUANTITY_WORDS);
const QUANTITY_SUFFIX_RE = suffixRe(QUANTITY_WORDS);
const SAFE_WHOLE = new Set(SAFE_WORDS);
const SAFE_SUFFIX_RE = suffixRe(SAFE_WORDS);

// Timestamps, durations and log strings state their own shape as surely as a
// count does, and they are the largest benign cluster in this codebase (~24 of
// the 121 pre-existing hits, measured 2026-09). Kept separate from
// QUANTITY_WORDS so they vouch for a VALUE's own name only, never as a key:
// `{ time: task }` must stay reported for the same reason `{ taskId: task }`
// does. Whole-word and suffix are separate lists on purpose — a `Msg` suffix
// would allow `snackMsg`, which routinely interpolates a task title.
const SCALAR_WHOLE = new Set(['msg', 'seq', 'time', 'delay', 'duration']);
const SCALAR_SUFFIX_RE = /(?:Seq|Time|Date|Day|At|Delay|Duration|Zoom|Factor)$/;

const ERROR_WHOLE = new Set(['e', 'ex', 'err', 'error', 'exception', 'reason']);
const ERROR_SUFFIX_RE = /(?:Error|Errors|Err|Exception)$/;
// `errStr`, `errTxt`, `errorMsg`, `errorMessage` — the same allowance as the
// conventional bare names, which `log.ts` narrows for a real `Error`. As with
// ERROR_WHOLE this does not certify the value; see the HttpErrorResponse note
// in the docstring. Value names only: an `err*` KEY must not vouch, or
// `{ errorMsg: task }` reopens the entity-label hole isVouchingKey closes.
const ERROR_PREFIX_RE = /^(?:err|error)[A-Z0-9]/;

// A boolean says its own shape. `do`/`did`/`does` are absent — they would allow
// `doNotDisturbList`. `use` is kept: it reads ambiguously in the abstract, but
// the only logged `use*` in src/app (`useAlarmStyle`) is a boolean, and
// dropping it bought one false positive and nothing else.
const BOOLEAN_PREFIX_RE =
  /^(?:is|are|was|were|has|have|had|should|can|could|will|would|use|allow|enable|disable|skip|force|needs|need)[A-Z0-9]/;

// SCREAMING_SNAKE_CASE is a module constant, not a runtime payload.
const CONST_NAME_RE = /^[A-Z][A-Z0-9_]*$/;

// These parse as Identifiers, not Literals, so they reach the name check —
// `c ? task : undefined` must report `task` only.
const LITERAL_GLOBALS = new Set(['undefined', 'NaN', 'Infinity']);

// What a KEY may vouch for: a quantity or an error. Deliberately NOT an entity
// label — `{ taskId: task }` is the likeliest typo of the fix this rule asks
// for, so it has to stay reported.
const isVouchingKey = (name) => {
  if (typeof name !== 'string') return false;
  const lower = name.toLowerCase();
  return (
    QUANTITY_WHOLE.has(lower) ||
    QUANTITY_SUFFIX_RE.test(name) ||
    ERROR_WHOLE.has(lower) ||
    ERROR_SUFFIX_RE.test(name)
  );
};

const isSafeName = (name) => {
  if (typeof name !== 'string') return false;
  if (LITERAL_GLOBALS.has(name)) return true;
  const lower = name.toLowerCase();
  return (
    SAFE_WHOLE.has(lower) ||
    SAFE_SUFFIX_RE.test(name) ||
    SCALAR_WHOLE.has(lower) ||
    SCALAR_SUFFIX_RE.test(name) ||
    ERROR_WHOLE.has(lower) ||
    ERROR_SUFFIX_RE.test(name) ||
    ERROR_PREFIX_RE.test(name) ||
    BOOLEAN_PREFIX_RE.test(name) ||
    CONST_NAME_RE.test(name)
  );
};

// Wrappers that carry the value through unchanged. Without unwrapping, a `!` is
// a one-keystroke way to silence this rule while still exporting the object.
const UNWRAP = { TSNonNullExpression: 1, TSAsExpression: 1 };
const unwrap = (node) => {
  let n = node;
  while (n && UNWRAP[n.type]) n = n.expression;
  return n;
};

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Log history is exportable — log named fields, never a whole value handed over bare, as a property value, or spread',
      category: 'Possible Errors',
      recommended: true,
    },
    messages: {
      bareValue:
        'Do not log `{{name}}` whole — log history is exportable and is often attached to public bug reports, so an unexamined value risks carrying user content (titles, notes, paths). Log the specific fields you need, as `{ someId: x.id, someCount: x.length }`. See rule #9 in CLAUDE.md.',
      spreadValue:
        'Do not spread `{{name}}` into a logged value — the exportable log would receive every own property, including any user content. List the fields you need explicitly. See rule #9 in CLAUDE.md.',
    },
    schema: [],
  },

  create(context) {
    // `Log.log(...)`, `TaskLog.warn(...)`, `SyncLog.err(...)` — any receiver
    // named `Log` or ending in `Log`, so a new context logger is covered as
    // soon as it is introduced.
    const isLogCall = (node) => {
      const callee = node.callee;
      if (!callee || callee.type !== 'MemberExpression' || callee.computed) return false;
      if (callee.property.type !== 'Identifier') return false;
      if (!LOG_METHODS.has(callee.property.name)) return false;
      return callee.object.type === 'Identifier' && /Log$/.test(callee.object.name);
    };

    const readableName = (node) => {
      if (!node) return 'this value';
      if (node.type === 'Identifier') return node.name;
      if (
        node.type === 'MemberExpression' &&
        !node.computed &&
        node.property.type === 'Identifier'
      ) {
        return node.property.name;
      }
      return 'this value';
    };

    const checkSpread = (node) => {
      const arg = unwrap(node.argument);
      if (!arg) return;
      if (arg.type === 'Identifier') {
        if (!isSafeName(arg.name)) {
          context.report({ node, messageId: 'spreadValue', data: { name: arg.name } });
        }
        return;
      }
      // Traversable — judge the contents rather than the wrapper.
      if (arg.type === 'ObjectExpression' || arg.type === 'ArrayExpression') {
        checkValue(arg);
        return;
      }
      // `{ ...this.task }` names nothing, unlike `task.title`.
      if (arg.type === 'MemberExpression' || arg.type === 'ThisExpression') {
        context.report({
          node,
          messageId: 'spreadValue',
          data: { name: readableName(arg) },
        });
        return;
      }
      // `...getSafeErrorLogMeta(e)` — a named helper is the author choosing
      // what to expose, exactly like a plain call argument.
    };

    const checkObject = (node) => {
      for (const prop of node.properties) {
        if (prop.type === 'SpreadElement') {
          checkSpread(prop);
          continue;
        }
        // A getter is skipped as a known gap, not because it is safe:
        // `JSON.stringify` invokes it. Not a shape anyone writes at a log call.
        if (prop.type !== 'Property' || prop.kind !== 'init' || prop.method) continue;
        // A computed key is a value expression, and is itself logged content.
        if (prop.computed) {
          checkValue(prop.key);
          checkValue(prop.value);
          continue;
        }
        const value = unwrap(prop.value);
        if (value && value.type === 'Identifier') {
          const keyName =
            prop.key.type === 'Identifier'
              ? prop.key.name
              : prop.key.type === 'Literal'
                ? String(prop.key.value)
                : null;
          const isSafe =
            isSafeName(value.name) || (!prop.shorthand && isVouchingKey(keyName));
          if (!isSafe) {
            context.report({
              node: prop,
              messageId: 'bareValue',
              data: { name: value.name },
            });
          }
          continue;
        }
        checkValue(prop.value);
      }
    };

    // Only a bare identifier is reported. A member access, call or literal is
    // the author having already chosen what to expose. Object and array
    // literals are traversed so nesting cannot smuggle a whole value past.
    function checkValue(node) {
      const v = unwrap(node);
      if (!v) return;
      switch (v.type) {
        case 'Identifier':
          if (!isSafeName(v.name)) {
            context.report({ node: v, messageId: 'bareValue', data: { name: v.name } });
          }
          return;
        case 'SpreadElement':
          checkSpread(v);
          return;
        case 'ObjectExpression':
          checkObject(v);
          return;
        case 'ArrayExpression':
          for (const el of v.elements) {
            if (el) checkValue(el);
          }
          return;
        case 'ConditionalExpression':
          checkValue(v.consequent);
          checkValue(v.alternate);
          return;
        case 'LogicalExpression':
          // `a && b` yields `b` when it yields anything worth logging; `a` is a
          // guard. `a ?? b` / `a || b` yield `a` whenever it is present.
          if (v.operator !== '&&') checkValue(v.left);
          checkValue(v.right);
          return;
        default:
          return;
      }
    }

    return {
      CallExpression(node) {
        if (!isLogCall(node)) return;
        for (const arg of node.arguments) {
          checkValue(arg);
        }
      },
    };
  },
};
