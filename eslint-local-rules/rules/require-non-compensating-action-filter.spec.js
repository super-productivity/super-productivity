const { RuleTester } = require('eslint');
const rule = require('./require-non-compensating-action-filter');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
});

ruleTester.run('require-non-compensating-action-filter', rule, {
  valid: [
    {
      code: `
        createEffect(() => actions$.pipe(
          ofType(TaskSharedActions.updateTask),
          filterNonCompensatingAction(),
          map(() => followUp())
        ));
      `,
    },
    {
      code: `
        createEffect(() => actions$.pipe(
          ofType(TaskSharedActions.addTask, TaskSharedActions.moveToOtherProject),
          filterNonCompensatingAction(),
          map(() => followUp())
        ));
      `,
    },
    {
      code: `
        createEffect(() => actions$.pipe(
          ofType(TaskSharedActions.deleteTask),
          tap(() => updateExternalCalendar())
        ), { dispatch: false });
      `,
    },
    {
      code: `createEffect(() => actions$.pipe(ofType(otherAction), map(() => followUp())));`,
    },
  ],
  invalid: [
    {
      code: `
        createEffect(() => actions$.pipe(
          ofType(TaskSharedActions.updateTask),
          map(() => followUp())
        ));
      `,
      errors: [{ messageId: 'missingNonCompensatingFilter' }],
    },
    {
      code: `
        createEffect(() => actions$.pipe(
          ofType(TaskSharedActions.deleteTask, TaskSharedActions.moveToOtherProject),
          map(() => followUp())
        ));
      `,
      errors: [{ messageId: 'missingNonCompensatingFilter' }],
    },
  ],
});

console.log('require-non-compensating-action-filter: all RuleTester cases passed');
