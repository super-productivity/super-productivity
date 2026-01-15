/**
 * ESLint rule: require-hydration-guard
 *
 * Ensures selector-based NgRx effects have proper hydration guards to prevent
 * duplicate operations during sync replay.
 *
 * ## Problem
 *
 * Selector-based effects (those starting with `this.store.select()`) fire whenever
 * the store changes, including during hydration and sync replay. This can cause:
 * - Ghost operations (creating new ops based on intermediate sync states)
 * - Unwanted side effects (banners, sounds during background sync)
 *
 * ## Solution
 *
 * Effects that USE SELECTORS AS THE PRIMARY SOURCE should include one of:
 * - `skipWhileApplyingRemoteOps()` operator (preferred)
 * - `skipDuringSync()` operator (deprecated alias)
 * - `filter(() => !this.hydrationState.isApplyingRemoteOps())`
 *
 * ## What This Rule Does NOT Flag
 *
 * - Action-based effects using `this._actions$.pipe(ofType(...))` - even if they use
 *   `withLatestFrom(this.store.select(...))` to get current state
 * - Selectors inside operator callbacks (e.g., inside `switchMap`)
 * - Selectors passed to `withLatestFrom`, `combineLatest`, etc. as secondary sources
 * - Effects with `{ dispatch: false }` option - they only perform side effects (audio, UI)
 *   and never dispatch actions that could create duplicate operations during sync
 *
 * ## Examples
 *
 * Flagged (selector is primary source):
 * ```typescript
 * myEffect$ = createEffect(() =>
 *   this.store.select(mySelector).pipe(
 *     tap(() => this.doSomething())
 *   )
 * );
 * ```
 *
 * NOT Flagged (action is primary source, selector is secondary):
 * ```typescript
 * myEffect$ = createEffect(() =>
 *   this.actions$.pipe(
 *     ofType(someAction),
 *     withLatestFrom(this.store.select(mySelector)),
 *     map(([action, data]) => ...)
 *   )
 * );
 * ```
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require hydration guards on selector-based effects to prevent duplicate operations during sync',
      category: 'Possible Errors',
      recommended: true,
    },
    messages: {
      missingHydrationGuard:
        'Selector-based effect is missing hydration guard. Add skipWhileApplyingRemoteOps() or filter with isApplyingRemoteOps() to prevent duplicate operations during sync replay.',
    },
    schema: [],
  },

  create(context) {
    /**
     * Check if node is a selector call (this.store.select, this._store.select, etc.)
     */
    const isSelectorCall = (node) => {
      if (node.type !== 'CallExpression') return false;
      if (node.callee.type !== 'MemberExpression') return false;

      const property = node.callee.property;
      if (property.type !== 'Identifier' || property.name !== 'select') return false;

      // Check if it's a store access (this.store, this._store, this._store$, store)
      const object = node.callee.object;
      if (object.type === 'MemberExpression') {
        const objProp = object.property;
        if (objProp.type === 'Identifier') {
          const name = objProp.name;
          if (
            name === 'store' ||
            name === '_store' ||
            name === '_store$' ||
            name === 'store$'
          ) {
            return true;
          }
        }
      }

      // Direct store.select
      if (object.type === 'Identifier') {
        const name = object.name;
        if (
          name === 'store' ||
          name === '_store' ||
          name === '_store$' ||
          name === 'store$'
        ) {
          return true;
        }
      }

      return false;
    };

    /**
     * Check if a selector is nested inside a callback function passed to an RxJS operator.
     * Nested selectors (e.g., inside switchMap) are already protected by guards on the outer chain.
     */
    const isNestedInOperatorCallback = (selectorNode, effectFnNode) => {
      let current = selectorNode.parent;

      while (current && current !== effectFnNode) {
        // If we hit a function expression that's an argument to an operator
        if (
          current.type === 'ArrowFunctionExpression' ||
          current.type === 'FunctionExpression'
        ) {
          const funcParent = current.parent;
          if (funcParent && funcParent.type === 'CallExpression') {
            const callee = funcParent.callee;
            if (callee.type === 'Identifier') {
              const opName = callee.name;
              // Common RxJS operators that take callbacks
              if (
                [
                  'switchMap',
                  'mergeMap',
                  'concatMap',
                  'exhaustMap',
                  'map',
                  'tap',
                  'filter',
                  'withLatestFrom',
                  'combineLatestWith',
                  'first',
                  'take',
                ].includes(opName)
              ) {
                return true;
              }
            }
          }
        }
        current = current.parent;
      }
      return false;
    };

    /**
     * Check if a selector is used as a secondary source (e.g., in withLatestFrom, combineLatestWith).
     * These selectors don't drive the observable - they're just providing supplemental data.
     *
     * IMPORTANT: This distinguishes between:
     * - `combineLatest([sel1, sel2]).pipe(...)` at root level → selectors ARE primary (not secondary)
     * - `actions$.pipe(combineLatestWith(sel))` → selector IS secondary
     * - `actions$.pipe(withLatestFrom(sel))` → selector IS secondary
     */
    const isSecondarySource = (selectorNode) => {
      let current = selectorNode.parent;
      let passedFunctionBoundary = false;

      while (current) {
        // Track if we've passed a function boundary (indicating we're inside an operator callback)
        if (
          current.type === 'ArrowFunctionExpression' ||
          current.type === 'FunctionExpression'
        ) {
          passedFunctionBoundary = true;
        }

        if (current.type === 'CallExpression') {
          const callee = current.callee;
          if (callee.type === 'Identifier') {
            const opName = callee.name;

            // withLatestFrom is ALWAYS secondary (only used inside pipe chains)
            if (opName === 'withLatestFrom') {
              if (current.arguments.some((arg) => containsNode(arg, selectorNode))) {
                return true;
              }
            }

            // combineLatestWith, zipWith are ALWAYS secondary (only used inside pipe chains)
            if (['combineLatestWith', 'zipWith'].includes(opName)) {
              if (current.arguments.some((arg) => containsNode(arg, selectorNode))) {
                return true;
              }
            }

            // combineLatest, forkJoin, zip at ROOT level (not inside a function) → NOT secondary
            // But if inside a function (like switchMap callback) → IS secondary
            if (['combineLatest', 'forkJoin', 'zip'].includes(opName)) {
              if (current.arguments.some((arg) => containsNode(arg, selectorNode))) {
                // Only secondary if we're inside an operator callback
                return passedFunctionBoundary;
              }
            }
          }
        }
        current = current.parent;
      }
      return false;
    };

    /**
     * Check if tree contains the target node
     */
    const containsNode = (tree, target) => {
      if (tree === target) return true;
      if (!tree || typeof tree !== 'object') return false;

      for (const key of Object.keys(tree)) {
        if (key === 'parent') continue; // Skip parent references
        const child = tree[key];
        if (Array.isArray(child)) {
          for (const item of child) {
            if (containsNode(item, target)) return true;
          }
        } else if (child && typeof child === 'object') {
          if (containsNode(child, target)) return true;
        }
      }
      return false;
    };

    /**
     * Find the full pipe chain starting from a selector and check for guards.
     *
     * IMPORTANT: When a selector is inside combineLatest([sel1, sel2]).pipe(...),
     * the guard is on the combineLatest result, not the individual selector.
     * We need to walk up through the array and combineLatest call to find the full chain.
     */
    const hasGuardInChain = (selectorNode) => {
      const sourceCode = context.getSourceCode();

      // Walk up from selector to find the full pipe chain
      let current = selectorNode;

      // First, walk up through any combineLatest/forkJoin/zip wrappers
      // This handles: combineLatest([sel1, sel2]).pipe(guard, ...)
      while (current.parent) {
        const parent = current.parent;

        // If we're inside an array that's an argument to combineLatest/forkJoin/zip,
        // move up to the call expression
        if (parent.type === 'ArrayExpression') {
          const arrayParent = parent.parent;
          if (arrayParent && arrayParent.type === 'CallExpression') {
            const callee = arrayParent.callee;
            if (
              callee.type === 'Identifier' &&
              ['combineLatest', 'forkJoin', 'zip'].includes(callee.name)
            ) {
              current = arrayParent;
              continue;
            }
          }
        }

        // Check if parent is a member access for .pipe
        if (
          parent.type === 'MemberExpression' &&
          parent.object === current &&
          parent.property.name === 'pipe'
        ) {
          // Move to the CallExpression of pipe()
          if (parent.parent && parent.parent.type === 'CallExpression') {
            current = parent.parent;
            continue;
          }
        }

        // If we're the callee of a CallExpression (like for pipe())
        if (parent.type === 'CallExpression' && parent.callee === current) {
          current = parent;
          continue;
        }

        break;
      }

      // Get the full text of the chain from selector to end of pipes
      const chainText = sourceCode.getText(current);

      // Check for hydration guards
      return (
        chainText.includes('skipWhileApplyingRemoteOps') ||
        chainText.includes('skipDuringSync') ||
        chainText.includes('isApplyingRemoteOps')
      );
    };

    /**
     * Find selector calls at the "root" level of the effect that are the primary source
     */
    const findPrimarySelectorCalls = (node, effectFnNode, results = []) => {
      if (!node) return results;

      if (isSelectorCall(node)) {
        // Only include if:
        // 1. Not nested in an operator callback
        // 2. Not a secondary source (like in withLatestFrom)
        if (!isNestedInOperatorCallback(node, effectFnNode) && !isSecondarySource(node)) {
          results.push(node);
        }
        // Don't traverse into the selector's arguments
        return results;
      }

      // Traverse child nodes based on node type
      if (node.type === 'CallExpression') {
        // Check callee first (for chained calls like .pipe())
        if (node.callee) {
          findPrimarySelectorCalls(node.callee, effectFnNode, results);
        }
        // Check arguments
        for (const arg of node.arguments || []) {
          findPrimarySelectorCalls(arg, effectFnNode, results);
        }
      }

      if (node.type === 'MemberExpression') {
        findPrimarySelectorCalls(node.object, effectFnNode, results);
      }

      if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
        findPrimarySelectorCalls(node.body, effectFnNode, results);
      }

      if (node.type === 'BlockStatement') {
        for (const stmt of node.body || []) {
          findPrimarySelectorCalls(stmt, effectFnNode, results);
        }
      }

      if (node.type === 'ReturnStatement') {
        findPrimarySelectorCalls(node.argument, effectFnNode, results);
      }

      // Handle ArrayExpression (e.g., combineLatest([sel1, sel2]))
      if (node.type === 'ArrayExpression') {
        for (const element of node.elements || []) {
          findPrimarySelectorCalls(element, effectFnNode, results);
        }
      }

      return results;
    };

    /**
     * Check if the createEffect options object has dispatch: false
     */
    const hasDispatchFalse = (node) => {
      // node is a CallExpression for createEffect()
      // Second argument is the options object: createEffect(() => ..., { dispatch: false })
      if (node.arguments.length < 2) return false;

      const options = node.arguments[1];
      if (!options || options.type !== 'ObjectExpression') return false;

      for (const prop of options.properties) {
        if (
          prop.type === 'Property' &&
          prop.key.type === 'Identifier' &&
          prop.key.name === 'dispatch' &&
          prop.value.type === 'Literal' &&
          prop.value.value === false
        ) {
          return true;
        }
      }

      return false;
    };

    /**
     * Check if a createEffect call contains unguarded selector usage
     */
    const checkCreateEffect = (node) => {
      // node is a CallExpression for createEffect()
      if (node.arguments.length === 0) return;

      // Skip effects with { dispatch: false } - they don't dispatch actions during sync
      if (hasDispatchFalse(node)) return;

      const effectFn = node.arguments[0];
      if (!effectFn) return;

      // Find primary selector calls (not nested, not secondary sources)
      const primarySelectorCalls = findPrimarySelectorCalls(effectFn, effectFn, []);

      for (const selectorCall of primarySelectorCalls) {
        // Check if the chain has a guard
        if (!hasGuardInChain(selectorCall)) {
          context.report({
            node: selectorCall,
            messageId: 'missingHydrationGuard',
          });
        }
      }
    };

    return {
      CallExpression(node) {
        // Check for createEffect() calls
        if (node.callee.type === 'Identifier' && node.callee.name === 'createEffect') {
          checkCreateEffect(node);
        }
      },
    };
  },
};
