/**
 * Tests for require-hydration-guard ESLint rule
 */
const { RuleTester } = require('eslint');
const rule = require('./require-hydration-guard');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
});

ruleTester.run('require-hydration-guard', rule, {
  valid: [
    // Action-based effect - should NOT flag (actions$.pipe is primary source)
    {
      code: `
        createEffect(() =>
          this._actions$.pipe(
            ofType(someAction),
            withLatestFrom(this._store$.select(mySelector)),
            map(([action, data]) => anotherAction())
          )
        )
      `,
    },

    // Selector with skipWhileApplyingRemoteOps guard (preferred) - should NOT flag
    {
      code: `
        createEffect(() =>
          this._store$.select(mySelector).pipe(
            skipWhileApplyingRemoteOps(),
            tap(() => this.doSomething())
          )
        )
      `,
    },

    // Selector with skipDuringSync guard (deprecated alias) - should NOT flag
    {
      code: `
        createEffect(() =>
          this._store$.select(mySelector).pipe(
            skipDuringSync(),
            tap(() => this.doSomething())
          )
        )
      `,
    },

    // Selector with isApplyingRemoteOps guard - should NOT flag
    {
      code: `
        createEffect(() =>
          this._store$.select(mySelector).pipe(
            filter(() => !this.hydrationState.isApplyingRemoteOps()),
            tap(() => this.doSomething())
          )
        )
      `,
    },

    // Nested selector inside switchMap - should NOT flag (protected by outer stream)
    {
      code: `
        createEffect(() =>
          this._actions$.pipe(
            ofType(someAction),
            switchMap(() => this._store$.select(mySelector)),
            map(data => anotherAction())
          )
        )
      `,
    },

    // Selector in withLatestFrom (secondary source) - should NOT flag
    {
      code: `
        createEffect(() =>
          this._actions$.pipe(
            ofType(someAction),
            withLatestFrom(this._store$.select(selectorA), this._store$.select(selectorB)),
            map(([action, a, b]) => anotherAction())
          )
        )
      `,
    },

    // Selector in combineLatestWith (secondary source, inside operator chain) - should NOT flag
    {
      code: `
        createEffect(() =>
          this._actions$.pipe(
            ofType(someAction),
            combineLatestWith(this._store$.select(mySelector)),
            map(([action, data]) => anotherAction())
          )
        )
      `,
    },

    // Using store instead of _store$
    {
      code: `
        createEffect(() =>
          this.store.select(mySelector).pipe(
            skipDuringSync(),
            tap(() => this.doSomething())
          )
        )
      `,
    },

    // Using store$ property
    {
      code: `
        createEffect(() =>
          this.store$.select(mySelector).pipe(
            filter(() => !this.hydrationState.isApplyingRemoteOps()),
            tap(() => this.doSomething())
          )
        )
      `,
    },

    // Guard in second pipe call - should NOT flag
    {
      code: `
        createEffect(() =>
          this._store$.select(mySelector)
            .pipe(map(x => x))
            .pipe(skipDuringSync())
            .pipe(tap(() => this.doSomething()))
        )
      `,
    },

    // Not a createEffect call - should NOT flag
    {
      code: `
        someOtherFunction(() =>
          this._store$.select(mySelector).pipe(
            tap(() => this.doSomething())
          )
        )
      `,
    },

    // combineLatest INSIDE switchMap - should NOT flag (nested in operator callback)
    {
      code: `
        createEffect(() =>
          this._actions$.pipe(
            ofType(someAction),
            switchMap(() =>
              combineLatest([
                this._store$.select(selectorA),
                this._store$.select(selectorB)
              ])
            ),
            map(([a, b]) => anotherAction())
          )
        )
      `,
    },

    // combineLatest at ROOT with guard on the combineLatest result - should NOT flag
    // This is the key fix: guards applied to combineLatest protect all inner selectors
    {
      code: `
        createEffect(() =>
          combineLatest([
            this._store$.select(selectorA),
            this._store$.select(selectorB)
          ]).pipe(
            skipWhileApplyingRemoteOps(),
            map(([a, b]) => someAction({ a, b }))
          )
        )
      `,
    },

    // combineLatest at ROOT with isApplyingRemoteOps guard - should NOT flag
    {
      code: `
        createEffect(() =>
          combineLatest([
            this.store.select(selectFocusModeConfig),
            this.store.select(selectIsFocusModeEnabled),
          ]).pipe(
            filter(() => !this.hydrationState.isApplyingRemoteOps()),
            switchMap(([cfg, enabled]) => enabled ? of(action()) : EMPTY)
          )
        )
      `,
    },

    // Many selectors in combineLatest with guard - should NOT flag any
    {
      code: `
        createEffect(() =>
          combineLatest([
            this.store.select(selectA),
            this.store.select(selectB),
            this.store.select(selectC),
            this.store.select(selectD),
            this.store.select(selectE),
          ]).pipe(
            skipDuringSync(),
            tap(([a, b, c, d, e]) => this.doSomething())
          )
        )
      `,
    },
  ],

  invalid: [
    // Selector without guard - SHOULD flag
    {
      code: `
        createEffect(() =>
          this._store$.select(mySelector).pipe(
            tap(() => this.doSomething())
          )
        )
      `,
      errors: [{ messageId: 'missingHydrationGuard' }],
    },

    // _store$ variant without guard - SHOULD flag
    {
      code: `
        createEffect(() =>
          this._store$.select(selector).pipe(
            map(x => x)
          )
        )
      `,
      errors: [{ messageId: 'missingHydrationGuard' }],
    },

    // store (not _store$) without guard - SHOULD flag
    {
      code: `
        createEffect(() =>
          this.store.select(mySelector).pipe(
            filter(x => x !== null),
            tap(() => this.doSomething())
          )
        )
      `,
      errors: [{ messageId: 'missingHydrationGuard' }],
    },

    // Multiple pipe calls without guard - SHOULD flag
    {
      code: `
        createEffect(() =>
          this._store$.select(mySelector)
            .pipe(map(x => x))
            .pipe(tap(() => this.doSomething()))
        )
      `,
      errors: [{ messageId: 'missingHydrationGuard' }],
    },

    // Complex pipe chain without guard - SHOULD flag
    {
      code: `
        createEffect(() =>
          this._store$.select(selectFeatureState).pipe(
            distinctUntilChanged(),
            filter(state => state.isReady),
            map(state => someAction({ data: state.data }))
          )
        )
      `,
      errors: [{ messageId: 'missingHydrationGuard' }],
    },

    // combineLatest at ROOT level without guard - SHOULD flag (both selectors are primary)
    // Note: This is different from combineLatestWith inside a pipe chain
    {
      code: `
        createEffect(() =>
          combineLatest([
            this._store$.select(selectorA),
            this._store$.select(selectorB)
          ]).pipe(
            map(([a, b]) => someAction({ a, b }))
          )
        )
      `,
      errors: [
        { messageId: 'missingHydrationGuard' },
        { messageId: 'missingHydrationGuard' },
      ],
    },
  ],
});

console.log('All tests passed!');
