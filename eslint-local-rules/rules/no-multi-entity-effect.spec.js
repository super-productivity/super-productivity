/**
 * Tests for no-multi-entity-effect ESLint rule (heuristic, warn)
 */
const { RuleTester } = require('eslint');
const rule = require('./no-multi-entity-effect');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
});

ruleTester.run('no-multi-entity-effect', rule, {
  valid: [
    // Single dispatched action — fine.
    {
      code: `
        const e$ = createEffect(() =>
          actions$.pipe(
            ofType(trigger),
            map(() => doOneThing())
          )
        );
      `,
    },
    // BLESSED PATH: a multi-entity change routed through a meta-reducer.
    // The effect dispatches ONE action; the fan-out happens in the reducer.
    {
      code: `
        const deleteTag$ = createEffect(() =>
          actions$.pipe(
            ofType(deleteTag),
            map(({ id }) => deleteTagAndRemoveFromTasks({ id }))
          )
        );
      `,
    },
    // A single-element array is not a fan-out.
    {
      code: `
        const e$ = createEffect(() =>
          actions$.pipe(map(() => [onlyOne()]))
        );
      `,
    },
    // Not a createEffect call — ignored.
    {
      code: `const arr = [actionA(), actionB()];`,
    },

    // --- Documented heuristic blind spots (see the rule's JSDoc and
    // contributor-sync-model.md). These ARE multi-entity fan-outs but are
    // intentionally NOT detected — pinned here so the boundary is explicit
    // and any future change that starts catching them trips this spec.
    {
      // varargs `of(a(), b())` — not an ArrayExpression
      code: `
        const e$ = createEffect(() =>
          actions$.pipe(switchMap(() => of(updateProject(), updateTask())))
        );
      `,
    },
    {
      // `from([a(), b()])` — array wrapped in a CallExpression
      code: `
        const e$ = createEffect(() =>
          actions$.pipe(mergeMap(() => from([updateProject(), updateTask()])))
        );
      `,
    },
    {
      // ternary-returned arrays — the array is not the direct body/return arg
      code: `
        const e$ = createEffect(() =>
          actions$.pipe(map(() => (cond ? [a(), b()] : [c(), d()])))
        );
      `,
    },
    {
      // imperative store.dispatch fan-out — no returned array at all
      code: `
        const e$ = createEffect(
          () =>
            actions$.pipe(
              tap(() => {
                store.dispatch(a());
                store.dispatch(b());
              }),
            ),
          { dispatch: false },
        );
      `,
    },
  ],
  invalid: [
    // Classic fan-out: effect returns >=2 action-creator calls.
    {
      code: `
        const e$ = createEffect(() =>
          actions$.pipe(
            ofType(trigger),
            map(() => [updateProject(), updateTask()])
          )
        );
      `,
      errors: [{ messageId: 'multiEntityEffect' }],
    },
    // Fan-out via explicit return statement.
    {
      code: `
        const e$ = createEffect(() =>
          actions$.pipe(
            mergeMap(() => {
              return [removeFromTag(), updateTaskOrder(), reIndex()];
            })
          )
        );
      `,
      errors: [{ messageId: 'multiEntityEffect' }],
    },
  ],
});

// eslint-disable-next-line no-console
console.log('no-multi-entity-effect: all RuleTester cases passed');
