// @ts-check
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');
const prettierRecommended = require('eslint-plugin-prettier/recommended');
const preferArrow = require('eslint-plugin-prefer-arrow');
const localRules = require('eslint-plugin-local-rules');

// Layer boundary, pointed inward: `src/app/ui` and `src/app/core` are the
// shared building blocks that features compose, so the dependency arrow runs
// features -> core/ui and never back.
//
// This rides on `@typescript-eslint/no-restricted-imports`, NOT the base rule,
// and that is load-bearing: flat config replaces a rule entry wholesale —
// options included — so sharing one rule id with the durable-clock fence
// (#9096, below) would silently drop that fence's pattern on every file both
// blocks match. Separate rule ids keep the two fences independent. Do not
// merge them.
const FEATURE_LAYER_FENCE = {
  group: ['**/features/*', '**/features/**'],
  message:
    'Layer boundary: src/app/ui and src/app/core must not import from src/app/features (the arrow points features -> core/ui). Move the shared piece down into core/ui, or invert with an injected callback/token.',
};

// `no-restricted-imports` only inspects static import/export declarations, so a
// dynamic `import('../../features/x')` walks straight through it. The packages/
// fences close the same hole with an ImportExpression ban; core/ui has ~7
// legitimate dynamic imports, so this narrows the ban to feature paths.
const FEATURE_LAYER_DYNAMIC_IMPORT_FENCE = {
  selector: 'ImportExpression > Literal[value=/features\\//]',
  message:
    'Layer boundary: src/app/ui and src/app/core must not dynamically import from src/app/features either.',
};

module.exports = tseslint.config(
  // Warnings are inert (`ng lint` defaults to maxWarnings: -1, so CI never fails
  // on them) and only bury real signal, so every rule here is 'error' or 'off'.
  // A stale disable directive errors too: that is what ratchets the inline
  // grandfathering below — fixing a suppressed line forces its directive out.
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  // Global ignores
  {
    ignores: [
      'app-builds/**/*',
      'dist/**',
      'node_modules/**/*',
      'src/app/t.const.ts',
      'src/assets/bundled-plugins/**/*',
      'src/app/config/env.generated.ts',
      '.tmp/**/*',
      'packages/plugin-api/**/*',
      'packages/plugin-dev/**/*',
      'packages/shared-schema/**/*',
      'packages/super-sync-server/**/*',
      'packages/vite-plugin/**/*',
      'packages/*/dist/**/*',
    ],
  },
  // TypeScript files
  {
    files: ['**/*.ts'],
    extends: [
      ...tseslint.configs.recommended,
      ...angular.configs.tsRecommended,
      prettierRecommended,
    ],
    processor: angular.processInlineTemplates,
    plugins: {
      'prefer-arrow': preferArrow,
    },
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
      },
    },
    rules: {
      // Core ESLint rules are off repo-wide (the config never spreads
      // js.configs.recommended), so a duplicate key in an object literal reached master
      // twice on 2026-07-30 and took the whole Karma bundle down with TS1117. tsc catches
      // it only at build time; catch it at lint time instead.
      'no-dupe-keys': 'error',
      // Disabled rules
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@angular-eslint/component-selector': 'off',
      '@angular-eslint/no-input-rename': 'off',
      '@typescript-eslint/no-inferrable-types': 'off',
      'no-underscore-dangle': 'off',
      'arrow-body-style': 'off',
      '@typescript-eslint/member-ordering': 'off',
      'import/order': 'off',
      'arrow-parens': 'off',
      '@typescript-eslint/explicit-member-accessibility': 'off',

      // Enabled rules
      'prettier/prettier': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { args: 'none', caughtErrors: 'none' },
      ],
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
          allowDirectConstAssertionInArrowFunctions: true,
          allowConciseArrowFunctionExpressionsStartingWithVoid: true,
        },
      ],
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'default',
          format: ['camelCase', 'snake_case', 'UPPER_CASE', 'PascalCase'],
          leadingUnderscore: 'allowSingleOrDouble',
          trailingUnderscore: 'allow',
          filter: { regex: '(should)|@tags', match: false },
        },
        {
          selector: 'variable',
          format: ['camelCase', 'snake_case', 'UPPER_CASE', 'PascalCase'],
          leadingUnderscore: 'allowSingleOrDouble',
          trailingUnderscore: 'allow',
        },
        { selector: 'enum', format: ['PascalCase', 'UPPER_CASE'] },
        { selector: 'typeLike', format: ['PascalCase'] },
      ],
      'prefer-const': 'error',
      '@typescript-eslint/no-unused-expressions': 'error',
      '@typescript-eslint/no-empty-object-type': 'error',
      'max-len': [
        'error',
        {
          ignorePattern: '^import \\{.+;$',
          ignoreRegExpLiterals: true,
          ignoreStrings: true,
          ignoreUrls: true,
          code: 150,
        },
      ],
      'id-blacklist': 'error',
      // @typescript-eslint/member-delimiter-style removed in v8 - Prettier handles this
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': 'error',
      'comma-dangle': ['error', 'always-multiline'],
      'no-mixed-operators': 'error',
      'prefer-arrow/prefer-arrow-functions': 'error',
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: '', style: 'camelCase' },
      ],
      // @typescript-eslint/ban-types replaced by specific rules in v8
      '@typescript-eslint/no-unsafe-function-type': 'error',
      '@typescript-eslint/no-wrapper-object-types': 'error',
    },
  },
  {
    files: ['packages/sync-core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@sp/shared-schema',
              message:
                '@sp/sync-core must stay domain-agnostic; shared-schema is SP-specific.',
            },
          ],
          patterns: [
            {
              group: [
                '@angular/*',
                '@ngrx/*',
                '@sp/shared-schema/*',
                '../shared-schema/*',
                '../shared-schema/**',
                '../../shared-schema/*',
                '../../shared-schema/**',
                '**/shared-schema/*',
                '**/shared-schema/**',
                'src/app/*',
                'src/app/**',
                '**/src/app/*',
                '**/src/app/**',
              ],
              message:
                '@sp/sync-core must not import Angular, NgRx, app code, or SP-specific schema packages.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression',
          message:
            '@sp/sync-core must not use dynamic imports; they bypass package-boundary checks.',
        },
      ],
    },
  },
  {
    files: ['packages/sync-providers/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@sp/shared-schema',
              message: '@sp/sync-providers must not import SP-specific schema packages.',
            },
          ],
          patterns: [
            {
              group: [
                '@angular/*',
                '@ngrx/*',
                '@sp/shared-schema/*',
                '@sp/sync-core/*',
                '**/shared-schema/*',
                '**/shared-schema/**',
                '**/sync-core/*',
                '**/sync-core/**',
                'src/app/*',
                'src/app/**',
                '**/src/app/*',
                '**/src/app/**',
              ],
              message:
                '@sp/sync-providers must use only public @sp/sync-core exports and must not import Angular, NgRx, app code, or SP-specific schema packages.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression',
          message:
            '@sp/sync-providers must not use dynamic imports; they bypass package-boundary checks.',
        },
      ],
    },
  },
  // NgRx effects files - require hydration guards on selector-based effects
  {
    files: ['**/*.effects.ts'],
    plugins: {
      'local-rules': localRules,
    },
    rules: {
      'local-rules/require-hydration-guard': 'error',
      'local-rules/require-entity-registry': 'error',
      'local-rules/no-actions-in-effects': 'error',
      'local-rules/no-multi-entity-effect': 'error',
    },
  },
  // Spelled-out weekday/month names must be formatted with textLocale(), not
  // currentLocale() (the ISO option's `sv` sentinel) or the implicit browser
  // locale — see #8987, which recurred across three PRs. Specs are excluded:
  // computing an expected string against an explicit locale is a legitimate
  // test technique, and the invariant is about what the product renders.
  {
    files: ['src/app/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    plugins: {
      'local-rules': localRules,
    },
    rules: {
      'local-rules/require-text-locale': 'error',
    },
  },
  // Log history is exportable (`Log.exportLogHistory()` backs the config-page
  // download and the error overlay's "Logs" button) and exported logs are
  // routinely attached to public bug reports, so user content must never reach
  // a Log method (rule #9). This flags a whole value handed over instead of
  // named fields — bare, as a property value, spread, or nested in a logged
  // literal — which is what leaked in #7870 / #9112.
  //
  // 'error', so a NEW leak fails CI on the PR that introduces it. 'warn' would
  // be inert here for the same reason spelled out under `max-lines` below:
  // `ng lint` defaults to maxWarnings: -1 and never fails a build on warnings,
  // and CI runs bare `npm run lint`.
  //
  // Specs are excluded: a test asserting on a payload is legitimate, and the
  // invariant is about what a shipped build writes into the export.
  {
    files: ['src/app/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    plugins: {
      'local-rules': localRules,
    },
    rules: {
      'local-rules/no-user-content-in-logs': 'error',
    },
  },
  // Grandfathered baseline: the call sites that already existed when the rule
  // landed (80 hits across 40 files, measured 2026-09) carry an inline
  // `eslint-disable-next-line ... -- grandfathered log baseline` each, so the
  // rule stays an error for every NEW call, even inside those files.
  //
  // Not all of these are leaks. The rule judges shape, never content, so a
  // scalar the naming heuristics cannot classify (`v`, `x`, `date1`, `evName`,
  // `handlerMap`) is suppressed next to a real one. Treat a directive as "not
  // yet triaged", not as "known privacy debt".
  //
  // These directives may only ever disappear. A false positive in NEW code is
  // not a reason to copy one: fix the heuristics in the rule, or scope a
  // disable whose reason says why this value holds no user content.

  // Op-log persistence: inside an adapter.transaction() callback only the tx
  // handle may be used — adapter methods enqueue behind the transaction's own
  // FIFO queue slot on the SQLite backend and deadlock (see
  // SqliteOpLogAdapter._serialize()).
  {
    files: ['src/app/op-log/**/*.ts'],
    plugins: {
      'local-rules': localRules,
    },
    rules: {
      'local-rules/no-adapter-in-tx': 'error',
    },
  },
  // Op-log persistence: every method appending rows to STORE_NAMES.OPS must
  // report the committed seqs to TabSeqFrontierService (#9438). A missed
  // observeOwnWrite makes the tab's next own write look like a foreign seq
  // gap → sticky divergence → snapshot saves AND compaction silently disabled
  // for the whole session, on all platforms — a failure mode nothing crashes
  // on, so lint is the only place it can fail loudly. Specs are exempt: they
  // seed fake stores without a live frontier to report to.
  {
    files: ['src/app/op-log/**/*.ts'],
    ignores: ['src/app/op-log/**/*.spec.ts'],
    plugins: {
      'local-rules': localRules,
    },
    rules: {
      'local-rules/require-frontier-report-on-ops-append': 'error',
    },
  },
  // App code must route logging through Log/SyncLog/OpLog/... helpers.
  // Direct console.* calls bypass the exportable log history users attach
  // to bug reports. The Log implementation itself, tests, and benchmarks
  // (which intentionally dump timing numbers to stdout) are exempt.
  {
    files: ['src/app/**/*.ts'],
    ignores: ['src/app/**/*.spec.ts', 'src/app/**/*.benchmark.ts', 'src/app/core/log.ts'],
    rules: {
      'no-console': 'error',
    },
  },
  // Durable-clock pruning is store-owned (#9096): every clock persisted by
  // the client must be pruned with the full preserve set (current client +
  // latest full-state author), which OperationLogStoreService assembles in
  // pruneClockForStorage. Caller-site pruning is how the import author got
  // silently evicted (#9089/#9096), so importing limitVectorClockSize outside
  // the store (from the client wrapper or @sp/sync-core) is fenced off.
  // Exempt: the wrapper itself (re-exports the shared impl), the store
  // service (the choke point), and specs (simulate server-side pruning).
  {
    files: ['src/app/**/*.ts'],
    ignores: [
      'src/app/**/*.spec.ts',
      'src/app/core/util/vector-clock.ts',
      'src/app/op-log/persistence/operation-log-store.service.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/core/util/vector-clock', '@sp/sync-core'],
              importNamePattern: '^limitVectorClockSize$',
              message:
                'Durable-clock pruning is store-owned (#9096): use OperationLogStoreService.pruneClockForStorage instead of pruning at the call site.',
            },
          ],
        },
      ],
    },
  },
  // Layer boundary (inward): features compose core/ui/util, never the reverse.
  // The packages/ boundary rules above are the argument for this one — they
  // are lint-enforced and hold at zero violations, while the identical
  // layering inside src/app was convention-only and drifted to 36 files.
  // Specs are exempt: a spec legitimately imports feature fixtures.
  {
    files: ['src/app/ui/**/*.ts', 'src/app/core/**/*.ts', 'src/app/util/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: [FEATURE_LAYER_FENCE] },
      ],
      'no-restricted-syntax': ['error', FEATURE_LAYER_DYNAMIC_IMPORT_FENCE],
    },
  },
  // Grandfathered layer-boundary offenders: imports that already reached into
  // features/ when the fence landed carry an inline `eslint-disable-next-line
  // ... -- grandfathered layer-boundary debt`, so a NEW features/ import fails
  // even in those files. These directives may only ever disappear.
  //
  // Roughly a third of them are four misplaced pieces, not stray imports:
  // GlobalConfigService (features/config, 69 importers app-wide) and
  // androidInterface (features/android) are de facto core services, while
  // core/startup + core/electron/local-rest-api-handler are app-shell
  // composition roots that belong above features rather than below them.
  // The rest import 15 distinct feature areas and are genuine per-file work.
  // util/ offenders (`app-data-mock.ts` aside, which is test-fixture data) are
  // pure helpers typed against feature models (e.g. Task) — those types belong
  // in the helper or in a shared model, not the other way round.

  // Service size cap (AGENTS.md → Project rules): no service may exceed 1200
  // lines. 'error' so a new service crossing the cap fails CI on the PR that
  // introduces it — 'warn' would be inert, since `ng lint` defaults to
  // maxWarnings: -1 and never fails a build on warnings. Spec files end in
  // `.service.spec.ts`, so they are not matched by this glob and are exempt.
  {
    files: ['**/*.service.ts'],
    rules: {
      'max-lines': ['error', { max: 1200 }],
    },
  },
  // Grandfathered offenders: services already over the cap, each pinned as an
  // error at its size when pinned (measured 2026-09), so they can shrink but
  // never grow. When you shrink one, lower its cap to lock the cleanup in; a
  // cap may only ever go down. Delete an entry once its file is under 1200.
  ...Object.entries({
    'src/app/op-log/sync/conflict-resolution.service.ts': 4775,
    'src/app/op-log/sync-providers/file-based/file-based-sync-adapter.service.ts': 3292,
    'src/app/op-log/persistence/operation-log-store.service.ts': 3153,
    'src/app/op-log/sync/operation-log-sync.service.ts': 2704,
    'src/app/plugins/plugin-bridge.service.ts': 2351,
    'src/app/imex/sync/sync-wrapper.service.ts': 2084,
    'src/app/plugins/plugin.service.ts': 1857,
    'src/app/features/tasks/task.service.ts': 1531,
  }).map(([file, max]) => ({
    files: [file],
    rules: {
      'max-lines': /** @type {['error', { max: number }]} */ (['error', { max }]),
    },
  })),
  // HTML files
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended, prettierRecommended],
    rules: {
      '@angular-eslint/template/no-negated-async': 'off',
      'prettier/prettier': 'error',
    },
  },
);
