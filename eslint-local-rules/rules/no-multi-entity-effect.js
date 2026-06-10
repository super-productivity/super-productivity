/**
 * ESLint rule: no-multi-entity-effect  (heuristic, warn)
 *
 * Flags ONE narrow syntactic shape: an effect whose dispatch arm returns a
 * *literal array* of >=2 action-creator calls directly as an arrow body or a
 * `return` argument, e.g. `map(() => [updateProject(), updateTask()])`. One
 * user intent should become exactly ONE operation; a multi-entity change must
 * live in a meta-reducer (src/app/root-store/meta/task-shared-meta-reducers/),
 * not an effect that emits N follow-up actions — an effect fan-out produces N
 * ops for one intent and re-runs on replay.
 *
 * Deliberately NOT detected (covered by the contributor doc + code review;
 * pinned as `valid` cases in the spec so the boundary is explicit and a future
 * change that starts catching them trips the spec):
 *   - varargs `of(a(), b())`            — not an ArrayExpression
 *   - `from([a(), b()])`                — array wrapped in a call
 *   - ternary / conditionally returned arrays
 *   - imperative `store.dispatch(a()); store.dispatch(b())`
 *
 * It is a `warn` heuristic, not a guarantee: a clean run does NOT prove an
 * effect is single-op. If a flagged multi-dispatch is intentionally not synced
 * state, disable the line with a justification comment.
 *
 * See docs/sync-and-op-log/contributor-sync-model.md (the atomicity rule).
 */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Effects should not dispatch a multi-action fan-out; multi-entity changes belong in a meta-reducer',
      category: 'Best Practices',
      recommended: false,
    },
    messages: {
      multiEntityEffect:
        'This effect returns a fan-out of {{count}} actions for one trigger. One user intent = one operation: move multi-entity changes into a meta-reducer (src/app/root-store/meta/task-shared-meta-reducers/). If this is intentionally not synced state, disable with a justification. See docs/sync-and-op-log/contributor-sync-model.md.',
    },
    schema: [],
  },

  create(context) {
    const reported = new Set();

    /**
     * An array of >=2 call expressions returned from an effect stream is the
     * fan-out smell (e.g. `map(() => [actionA(), actionB()])`).
     */
    const checkArray = (arrNode) => {
      if (!arrNode || arrNode.type !== 'ArrayExpression') return;
      const calls = arrNode.elements.filter((el) => el && el.type === 'CallExpression');
      if (calls.length >= 2 && !reported.has(arrNode)) {
        reported.add(arrNode);
        context.report({
          node: arrNode,
          messageId: 'multiEntityEffect',
          data: { count: String(calls.length) },
        });
      }
    };

    return {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'createEffect') {
          return;
        }
        const seen = new Set();
        const walk = (n) => {
          if (!n || typeof n.type !== 'string' || seen.has(n)) return;
          seen.add(n);
          if (
            n.type === 'ArrowFunctionExpression' &&
            n.body &&
            n.body.type === 'ArrayExpression'
          ) {
            checkArray(n.body);
          }
          if (
            n.type === 'ReturnStatement' &&
            n.argument &&
            n.argument.type === 'ArrayExpression'
          ) {
            checkArray(n.argument);
          }
          for (const key of Object.keys(n)) {
            if (key === 'parent') continue;
            const child = n[key];
            if (Array.isArray(child)) {
              child.forEach(walk);
            } else if (child && typeof child.type === 'string') {
              walk(child);
            }
          }
        };
        walk(node);
      },
    };
  },
};
