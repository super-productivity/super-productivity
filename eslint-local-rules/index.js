/**
 * Local ESLint rules for Super Productivity.
 *
 * These rules are loaded by eslint-plugin-local-rules.
 * Usage in .eslintrc.json:
 *   "plugins": ["local-rules"],
 *   "rules": {
 *     "local-rules/require-hydration-guard": "warn",
 *     "local-rules/require-entity-registry": "warn"
 *   }
 */
module.exports = {
  'require-hydration-guard': require('./rules/require-hydration-guard'),
  'require-entity-registry': require('./rules/require-entity-registry'),
  'no-actions-in-effects': require('./rules/no-actions-in-effects'),
  'no-multi-entity-effect': require('./rules/no-multi-entity-effect'),
  'no-adapter-in-tx': require('./rules/no-adapter-in-tx'),
  'require-text-locale': require('./rules/require-text-locale'),
};
