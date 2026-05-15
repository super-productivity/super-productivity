/**
 * ESLint rule: no-actions-in-effects
 *
 * Effects must not use the raw `@ngrx/effects` `Actions` stream. They must
 * inject `LOCAL_ACTIONS` (the default — remote/replayed ops filtered out) or,
 * only for the op-log/archive effects that handle `isRemote` themselves,
 * `ALL_ACTIONS`.
 *
 * This enforces Boundary 1 of the single sync invariant: replayed and remote
 * operations must never re-trigger effects (duplicate side effects + phantom
 * operations). See docs/sync-and-op-log/contributor-sync-model.md.
 *
 * Scoped to every `.effects.ts` file via eslint.config.js. The codebase is
 * already 100% compliant — this is a regression guard, not a migration.
 *
 * Flags:
 * - `import { Actions } from '@ngrx/effects'` (including aliased imports)
 * - `inject(Actions)` (including the aliased local binding)
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Effects must inject LOCAL_ACTIONS/ALL_ACTIONS, never the raw @ngrx/effects Actions stream',
      category: 'Possible Errors',
      recommended: true,
    },
    messages: {
      noActionsImport:
        "Do not import `Actions` from '@ngrx/effects' in an effect. Inject `LOCAL_ACTIONS` (default) — or `ALL_ACTIONS` only for op-log/archive effects. See docs/sync-and-op-log/contributor-sync-model.md.",
      noActionsInject:
        'Do not `inject(Actions)` in an effect. Use `inject(LOCAL_ACTIONS)` (default) — or `inject(ALL_ACTIONS)` only for op-log/archive effects. See docs/sync-and-op-log/contributor-sync-model.md.',
    },
    schema: [],
  },

  create(context) {
    // Local binding name(s) that `Actions` from '@ngrx/effects' was imported as.
    const actionsLocalNames = new Set();

    return {
      ImportDeclaration(node) {
        if (node.source.value !== '@ngrx/effects') return;
        for (const spec of node.specifiers) {
          if (
            spec.type === 'ImportSpecifier' &&
            spec.imported &&
            spec.imported.name === 'Actions'
          ) {
            actionsLocalNames.add(spec.local.name);
            context.report({ node: spec, messageId: 'noActionsImport' });
          }
        }
      },

      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'inject') {
          return;
        }
        const arg = node.arguments[0];
        if (!arg || arg.type !== 'Identifier') return;
        // Catch the literal name and any aliased binding of @ngrx/effects Actions.
        if (arg.name === 'Actions' || actionsLocalNames.has(arg.name)) {
          context.report({ node, messageId: 'noActionsInject' });
        }
      },
    };
  },
};
