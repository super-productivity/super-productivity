// @ts-check
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');
const prettierRecommended = require('eslint-plugin-prettier/recommended');
const preferArrow = require('eslint-plugin-prefer-arrow');

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
      'packages/**/*',
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
