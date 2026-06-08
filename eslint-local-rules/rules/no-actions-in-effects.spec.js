/**
 * Tests for no-actions-in-effects ESLint rule
 */
const { RuleTester } = require('eslint');
const rule = require('./no-actions-in-effects');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
});

ruleTester.run('no-actions-in-effects', rule, {
  valid: [
    // The blessed default: inject(LOCAL_ACTIONS)
    {
      code: `
        import { createEffect, ofType } from '@ngrx/effects';
        const actions$ = inject(LOCAL_ACTIONS);
      `,
    },
    // The special-case escape hatch: inject(ALL_ACTIONS)
    {
      code: `
        import { createEffect } from '@ngrx/effects';
        const actions$ = inject(ALL_ACTIONS);
      `,
    },
    // A local symbol coincidentally named Actions NOT from @ngrx/effects:
    // still flagged by the literal-name guard is acceptable; here we only
    // assert the common safe imports are clean.
    {
      code: `
        import { Store } from '@ngrx/store';
        const store = inject(Store);
      `,
    },
  ],
  invalid: [
    // Importing Actions from @ngrx/effects
    {
      code: `import { Actions, ofType } from '@ngrx/effects';`,
      errors: [{ messageId: 'noActionsImport' }],
    },
    // Importing + injecting Actions (two distinct violations)
    {
      code: `
        import { Actions } from '@ngrx/effects';
        const a$ = inject(Actions);
      `,
      errors: [{ messageId: 'noActionsImport' }, { messageId: 'noActionsInject' }],
    },
    // Aliased import + injecting the alias
    {
      code: `
        import { Actions as Acts } from '@ngrx/effects';
        const a$ = inject(Acts);
      `,
      errors: [{ messageId: 'noActionsImport' }, { messageId: 'noActionsInject' }],
    },
    // Bare inject(Actions) without a tracked import still flagged by name
    {
      code: `const a$ = inject(Actions);`,
      errors: [{ messageId: 'noActionsInject' }],
    },
  ],
});

// eslint-disable-next-line no-console
console.log('no-actions-in-effects: all RuleTester cases passed');
