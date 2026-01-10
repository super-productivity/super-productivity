/* eslint-env es6, node */
/**
 * Finds unused translation keys by scanning the codebase.
 *
 * Usage: node tools/find-unused-translations.js
 *
 * Detects both patterns:
 * - T.KEY.PATH (preferred, type-safe)
 * - 'KEY.PATH' or "KEY.PATH" (string literals, legacy)
 */

const fs = require('fs');
const path = require('path');
const { globSync } = require('glob');

const TRANSLATION_SRC = path.join(__dirname, '../src/assets/i18n/en.json');
const SRC_DIR = path.join(__dirname, '../src');

/**
 * Recursively extract all flat keys from nested translation object
 * e.g., { A: { B: "val" } } -> ["A.B"]
 */
function extractKeys(obj, prefix = '') {
  let keys = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null) {
      keys = keys.concat(extractKeys(value, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

/**
 * Load all source file contents into a single string for fast searching
 */
function loadAllSourceContent() {
  const files = globSync('**/*.{ts,html}', {
    cwd: SRC_DIR,
    ignore: ['**/t.const.ts', '**/node_modules/**'],
    absolute: true,
  });

  console.log(`Scanning ${files.length} source files...`);

  return files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
}

/**
 * Check if a translation key is used in the codebase
 * Detects both T.KEY.PATH and 'KEY.PATH' / "KEY.PATH" patterns
 */
function isKeyUsed(key, content) {
  // Pattern 1: T.KEY.PATH (preferred)
  const tPattern = `T.${key}`;
  if (content.includes(tPattern)) {
    return true;
  }

  // Pattern 2: 'KEY.PATH' (string literal with single quotes)
  const singleQuotePattern = `'${key}'`;
  if (content.includes(singleQuotePattern)) {
    return true;
  }

  // Pattern 3: "KEY.PATH" (string literal with double quotes)
  const doubleQuotePattern = `"${key}"`;
  if (content.includes(doubleQuotePattern)) {
    return true;
  }

  return false;
}

// Main
const translations = JSON.parse(fs.readFileSync(TRANSLATION_SRC, 'utf8'));
const allKeys = extractKeys(translations);
const allContent = loadAllSourceContent();

console.log(`Checking ${allKeys.length} translation keys...\n`);

const unused = allKeys.filter((key) => !isKeyUsed(key, allContent));

if (unused.length === 0) {
  console.log('All translation keys are used!');
} else {
  console.log(`=== Unused translations (${unused.length}) ===\n`);
  unused.forEach((k) => console.log(k));
  console.log(`\nTotal: ${unused.length} unused keys out of ${allKeys.length}`);
}

process.exit(unused.length > 0 ? 1 : 0);
