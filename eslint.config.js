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
// severity included — so sharing one rule id with the durable-clock fence
// (#9096, below) would silently demote that fence to `warn` on every file the
// grandfathering block lists. Separate rule ids keep the two severities
// independent. Do not merge them.
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
      'local-rules/require-entity-registry': 'warn',
      'local-rules/no-actions-in-effects': 'error',
      'local-rules/no-multi-entity-effect': 'warn',
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
  // Measured baseline: the call sites that already existed when the rule landed
  // (80 hits across these 40 files, measured 2026-09), downgraded to a
  // non-failing warning so the rule can be an error everywhere else.
  //
  // Not all of these are leaks. The rule judges shape, never content, so a
  // scalar the naming heuristics cannot classify (`v`, `x`, `date1`, `evName`,
  // `handlerMap`) sits here next to a real one. Treat an entry as "not yet
  // triaged", not as "known privacy debt" — the count is a tripwire baseline,
  // not a backlog estimate.
  //
  // This list may only ever SHRINK. A false positive in NEW code is not a
  // reason to add a file here: fix the heuristics in the rule, or scope a
  // `// eslint-disable-next-line local-rules/no-user-content-in-logs -- <why
  // this value holds no user content>` to that one line. Adding the file
  // silently exempts every future log call in it.
  //
  // Caveat, same as `max-lines`: a new violation inside an already-listed file
  // only warns. Removing a file from the list is what locks its cleanup in.
  {
    files: [
      'src/app/core/language/language.service.ts',
      'src/app/core/share/share.service.ts',
      'src/app/core/startup/startup.service.ts',
      'src/app/core/util/vector-clock.ts',
      'src/app/features/add-tasks-for-tomorrow/add-tasks-for-tomorrow.service.ts',
      'src/app/features/android/android-interface.ts',
      'src/app/features/android/store/android-focus-mode.effects.ts',
      'src/app/features/android/store/android-foreground-tracking.effects.ts',
      'src/app/features/android/store/android.effects.ts',
      'src/app/features/archive/archive.service.ts',
      'src/app/features/issue/handle-issue-provider-http-error.ts',
      'src/app/features/mobile/store/mobile-notification.effects.ts',
      'src/app/features/planner/planner.service.ts',
      'src/app/features/right-panel/right-panel-content.component.ts',
      'src/app/features/shepherd/shepherd-helper.ts',
      'src/app/features/tasks/store/task-due.effects.ts',
      'src/app/features/tasks/task.service.ts',
      'src/app/features/tasks/util/play-done-sound.ts',
      'src/app/features/ui-helper/ui-helper.service.ts',
      'src/app/imex/sync/oauth-callback-handler.service.ts',
      'src/app/imex/sync/sync-trigger.service.ts',
      'src/app/imex/sync/sync-wrapper.service.ts',
      'src/app/imex/sync/sync.effects.ts',
      'src/app/op-log/clean-slate/clean-slate.service.ts',
      'src/app/op-log/model/model-config.ts',
      'src/app/op-log/persistence/operation-log-hydrator.service.ts',
      'src/app/op-log/sync/remote-ops-processing.service.ts',
      'src/app/op-log/validation/repair-operation.service.ts',
      'src/app/op-log/validation/validate-state.service.ts',
      'src/app/pages/config-page/config-page.component.ts',
      'src/app/plugins/plugin-api.ts',
      'src/app/plugins/plugin-bridge.service.ts',
      'src/app/plugins/util/plugin-iframe.util.ts',
      'src/app/root-store/meta/task-shared-meta-reducers/tag-shared.reducer.ts',
      'src/app/ui/formly-button/formly-btn.component.ts',
      'src/app/util/action-logger.ts',
      'src/app/util/ipc-event.ts',
      'src/app/util/is-same-day.ts',
      'src/app/util/search-nav-debug.ts',
      'src/app/util/skip-during-sync-window.operator.ts',
    ],
    plugins: {
      'local-rules': localRules,
    },
    rules: {
      'local-rules/no-user-content-in-logs': 'warn',
    },
  },
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
  // Grandfathered layer-boundary offenders: files that already reach into
  // features/, downgraded to a (non-failing) warning so they don't red-CI
  // while the layering is untangled. They still warn, so the debt stays
  // visible in lint output.
  // This list may only ever SHRINK — a new entry means the boundary was
  // bypassed. Delete the block once it is empty.
  //
  // Known caveat: the key is the FILE, so a listed file can add further
  // features/ imports without failing CI. A per-import ratchet would need
  // ~75 inline eslint-disable comments; that trade was made consciously.
  //
  // Roughly a third of the list is four misplaced pieces, not stray imports:
  // GlobalConfigService (features/config, 69 importers app-wide) and
  // androidInterface (features/android) are de facto core services, while
  // core/startup + core/electron/local-rest-api-handler are app-shell
  // composition roots that belong above features rather than below them.
  // Relocating all four clears ~11 entries. The rest import 15 distinct
  // feature areas and are genuine per-file work — this list will not fall to
  // one refactor. It started at 38; moving work-context-color.ts into ui/
  // (a colour palette only ui/ consumed) cleared the first two.
  {
    files: [
      'src/app/core/app-url-open-router.ts',
      'src/app/core/browser-title/browser-title.service.ts',
      'src/app/core/clipboard-image/clipboard-image.service.ts',
      'src/app/core/clipboard-image/clipboard-paste-handler.service.ts',
      'src/app/core/confetti/confetti.service.ts',
      'src/app/core/data-init/data-init.service.ts',
      'src/app/core/date-time-format/custom-date-adapter.ts',
      'src/app/core/date-time-format/date-time-format.service.ts',
      'src/app/core/draft/local-draft.service.ts',
      'src/app/core/drop-paste-input/eml-drop.service.ts',
      'src/app/core/electron/local-rest-api-handler.service.ts',
      'src/app/core/example-tasks/example-tasks.service.ts',
      'src/app/core/global-tracking-interval/global-tracking-interval.service.ts',
      'src/app/core/notify/notify.service.ts',
      'src/app/core/persistence/archive-db-adapter.service.ts',
      'src/app/core/persistence/legacy-pf-db.service.ts',
      'src/app/core/platform/capacitor-reminder.service.ts',
      'src/app/core/snack/snack.service.ts',
      'src/app/core/startup-overlay/startup-overlay.service.ts',
      'src/app/core/startup/startup.service.ts',
      'src/app/core/theme/dialog-wallpaper/dialog-wallpaper.component.ts',
      'src/app/core/theme/global-theme.service.ts',
      'src/app/core/update-check/update-check.service.ts',
      'src/app/ui/chip-list-input/chip-list-input.component.ts',
      'src/app/ui/datetime-picker/datetime-picker.component.ts',
      'src/app/ui/dialog-fullscreen-markdown/dialog-fullscreen-markdown.component.ts',
      'src/app/ui/formly-config.module.ts',
      'src/app/ui/formly-tag-selection/formly-tag-selection.component.ts',
      'src/app/ui/inline-markdown/inline-markdown.component.ts',
      'src/app/ui/material-icons-loader.service.ts',
      'src/app/ui/task-title/task-title.component.ts',
      // util/ offenders. `app-data-mock.ts` is test-fixture data, the rest are
      // pure helpers typed against feature models (e.g. Task). Those types
      // belong in the helper or in a shared model, not the other way round —
      // none of these needs a feature at runtime. (round-duration/round-time
      // were cleared by moving RoundTimeOption to util/round-time-option.model.)
      'src/app/util/app-data-mock.ts',
      'src/app/util/get-app-version-str.ts',
      'src/app/util/get-time-left-for-task.ts',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'warn',
        { patterns: [FEATURE_LAYER_FENCE] },
      ],
      'no-restricted-syntax': ['warn', FEATURE_LAYER_DYNAMIC_IMPORT_FENCE],
    },
  },
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
  // Grandfathered offenders: services already over the cap, downgraded to a
  // (non-failing) warning so they don't red-CI while they are split down. They
  // still warn at their real size, so the debt stays visible in lint output.
  // This list may only ever SHRINK — a new entry means the cap was bypassed.
  // Delete the block once every file below is under 1200 lines.
  {
    files: [
      'src/app/op-log/sync/conflict-resolution.service.ts',
      'src/app/op-log/sync-providers/file-based/file-based-sync-adapter.service.ts',
      'src/app/op-log/persistence/operation-log-store.service.ts',
      'src/app/op-log/sync/operation-log-sync.service.ts',
      'src/app/plugins/plugin-bridge.service.ts',
      'src/app/plugins/plugin.service.ts',
      'src/app/imex/sync/sync-wrapper.service.ts',
      'src/app/features/tasks/task.service.ts',
    ],
    rules: {
      'max-lines': ['warn', { max: 1200 }],
    },
  },
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
