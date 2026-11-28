/**
 * ESLint rule: no-sibling-feature-ui
 *
 * A file in `src/app/features/<own>/` must not import a component or pipe
 * (`*.component`, `*.pipe`) from another feature folder. Shared UI lives in
 * `src/app/ui`, which stays allowed, as do services, models and the feature's
 * own components. #8299 couples tasks/ to project/tag/issue/planner UI this way.
 *
 * Why a rule and not `no-restricted-imports`: that rule only sees the import
 * string, so `../../tag/x.component` (sibling) and `../../../ui/x.component`
 * (shared) are indistinguishable without knowing the importer's depth. This
 * rule resolves the path first. It also checks `import()`, which
 * `no-restricted-imports` ignores.
 *
 * Scoped per feature folder in eslint.config.js; existing offenders are
 * grandfathered inline.
 */
const path = require('path');

const FEATURE_RE = /\/src\/app\/features\/([^/]+)\//;
const UI_FILE_RE = /\.(component|pipe)$/;

/** Feature folder of an absolute, `/`-separated path, or undefined. */
const featureOf = (p) => (FEATURE_RE.exec(p) || [])[1];

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'A feature must not import components or pipes from a sibling feature folder',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      siblingUi:
        'Feature boundary (#8299): features/{{own}} must not import a component or pipe from features/{{other}}. Move the shared piece into src/app/ui, or have features/{{other}} provide it.',
    },
    schema: [],
  },

  create(context) {
    // Normalise Windows separators so the regexes see one path format.
    const filename = context.filename.replace(/\\/g, '/');
    const own = featureOf(filename);
    if (!own) return {};
    // Repo root, for absolute `src/app/...` imports (tsconfig baseUrl).
    const root = filename.slice(0, filename.indexOf('/src/app/'));

    const check = (node, source) => {
      if (typeof source !== 'string' || !UI_FILE_RE.test(source)) return;
      let target;
      if (source.startsWith('.')) {
        target = path.posix.join(path.posix.dirname(filename), source);
      } else if (source.startsWith('src/')) {
        target = `${root}/${source}`;
      } else {
        return; // package import
      }
      const other = featureOf(target);
      if (other && other !== own) {
        context.report({ node, messageId: 'siblingUi', data: { own, other } });
      }
    };

    return {
      ImportDeclaration: (node) => check(node, node.source.value),
      ImportExpression: (node) =>
        node.source.type === 'Literal' && check(node, node.source.value),
    };
  },
};
