/**
 * ESLint rule: require-non-compensating-action-filter
 *
 * An undo compensation is a real local action, so LOCAL_ACTIONS deliberately
 * lets it through. Effects that emit another action in response to one of the
 * undoable task actions must filter it out, otherwise undo can create a
 * follow-up persistent operation that was never part of the user's intent.
 *
 * Effects declared with `{ dispatch: false }` are intentionally excluded:
 * their UI, plugin, and external-calendar side effects must observe the
 * compensation as the state change it is. They cannot emit a phantom NgRx op.
 *
 * This deliberately covers every TaskSharedActions action rather than a list
 * of currently undoable actions. The filter is a no-op until an action is
 * marked compensating, so this keeps future undo support protected without
 * duplicating CompensatingOperationsRegistry's handler list in the linter.
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Dispatching effects triggered by undoable task actions must filter compensating actions',
      category: 'Possible Errors',
      recommended: true,
    },
    messages: {
      missingNonCompensatingFilter:
        'This dispatching effect reacts to a persistent task action. Add filterNonCompensatingAction() after ofType() so an undo compensation cannot emit a phantom follow-up operation.',
    },
    schema: [],
  },

  create(context) {
    const isPersistentTaskAction = (node) => {
      return (
        node.type === 'MemberExpression' &&
        !node.computed &&
        node.object.type === 'Identifier' &&
        node.object.name === 'TaskSharedActions' &&
        node.property.type === 'Identifier' &&
        node.property.name !== 'type'
      );
    };

    const isDispatchFalse = (effectCall) => {
      const options = effectCall.arguments[1];
      if (!options || options.type !== 'ObjectExpression') return false;

      return options.properties.some(
        (property) =>
          property.type === 'Property' &&
          !property.computed &&
          property.key.type === 'Identifier' &&
          property.key.name === 'dispatch' &&
          property.value.type === 'Literal' &&
          property.value.value === false,
      );
    };

    const findPipeOperators = (node) => {
      const operators = [];
      const seen = new Set();
      const walk = (current) => {
        if (!current || typeof current.type !== 'string' || seen.has(current)) return;
        seen.add(current);

        if (
          current.type === 'CallExpression' &&
          current.callee.type === 'MemberExpression' &&
          !current.callee.computed &&
          current.callee.property.type === 'Identifier' &&
          current.callee.property.name === 'pipe'
        ) {
          operators.push(...current.arguments);
        }

        for (const key of Object.keys(current)) {
          if (key === 'parent') continue;
          const child = current[key];
          if (Array.isArray(child)) child.forEach(walk);
          else if (child && typeof child.type === 'string') walk(child);
        }
      };
      walk(node);
      return operators;
    };

    return {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'createEffect')
          return;
        if (isDispatchFalse(node)) return;

        const operators = findPipeOperators(node.arguments[0]);
        const listensToPersistentTaskAction = operators.some(
          (operator) =>
            operator.type === 'CallExpression' &&
            operator.callee.type === 'Identifier' &&
            operator.callee.name === 'ofType' &&
            operator.arguments.some(isPersistentTaskAction),
        );
        const hasFilter = operators.some(
          (operator) =>
            operator.type === 'CallExpression' &&
            operator.callee.type === 'Identifier' &&
            operator.callee.name === 'filterNonCompensatingAction',
        );

        if (listensToPersistentTaskAction && !hasFilter) {
          context.report({ node, messageId: 'missingNonCompensatingFilter' });
        }
      },
    };
  },
};
