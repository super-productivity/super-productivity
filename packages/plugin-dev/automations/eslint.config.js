// @ts-check
const tseslint = require('typescript-eslint');
const solid = require('eslint-plugin-solid/configs/typescript');
const prettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [...tseslint.configs.recommended, solid, prettierRecommended],
    rules: {
      'prettier/prettier': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
