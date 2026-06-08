/**
 * Runs every `*.spec.js` in eslint-local-rules/rules via ESLint's RuleTester.
 *
 * RuleTester.run() executes synchronously and throws on the first failing
 * case ONLY when no test-framework globals (describe/it) are present — with
 * them, RuleTester defers cases to the framework and merely requiring the spec
 * asserts nothing. This runner therefore:
 *   (a) refuses to run if such globals are present, and
 *   (b) counts RuleTester.run() invocations per spec and fails any spec that
 *       required cleanly but never called run() (e.g. run() commented out, or
 *       wrapped in a never-invoked function) — so a spec can no longer be a
 *       silent pass that asserts nothing.
 *
 * Wired as `npm run test:lint-rules` (the unit suite — Karma over *.spec.ts —
 * does not run these .spec.js files). Run with bare `node`, never under
 * jest/mocha.
 */
const fs = require('fs');
const path = require('path');
const { RuleTester } = require('eslint');

// (a) A test-framework global means RuleTester would NOT throw synchronously,
// so requiring a spec would assert nothing. Fail loudly instead of lying.
if (typeof globalThis.describe === 'function' || typeof globalThis.it === 'function') {
  // eslint-disable-next-line no-console
  console.error(
    'lint-rule specs: REFUSING TO RUN — a test-framework global (describe/it) ' +
      'is present, so RuleTester defers instead of throwing and nothing would ' +
      'be asserted. Run with bare `node eslint-local-rules/run-specs.js`.',
  );
  process.exit(1);
}

// (b) Count run() calls so a spec that asserts nothing fails instead of passing.
let runCalls = 0;
const originalRun = RuleTester.prototype.run;
RuleTester.prototype.run = function countedRun(...args) {
  runCalls += 1;
  return originalRun.apply(this, args);
};

const rulesDir = path.join(__dirname, 'rules');
const specs = fs.readdirSync(rulesDir).filter((f) => f.endsWith('.spec.js'));

let failed = false;
for (const spec of specs) {
  const runsBefore = runCalls;
  try {
    require(path.join(rulesDir, spec));
    if (runCalls === runsBefore) {
      failed = true;
      // eslint-disable-next-line no-console
      console.error(
        `FAIL ${spec}\n  required cleanly but never called RuleTester.run() — asserted nothing`,
      );
    }
  } catch (err) {
    failed = true;
    // eslint-disable-next-line no-console
    console.error(`FAIL ${spec}\n${(err && err.stack) || err}`);
  }
}

// eslint-disable-next-line no-console
console.log(
  failed
    ? '\nlint-rule specs: FAILED'
    : `\nlint-rule specs: ${specs.length} file(s) passed (${runCalls} RuleTester.run call(s))`,
);
process.exit(failed ? 1 : 0);
