// @ts-check
const tseslint = require('typescript-eslint');
const rootConfig = require('../../../eslint.config.js');

module.exports = tseslint.config(...rootConfig, {
  languageOptions: {
    parserOptions: {
      project: './tsconfig.json',
    },
  },
});
