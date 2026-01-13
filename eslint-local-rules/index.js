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
};
