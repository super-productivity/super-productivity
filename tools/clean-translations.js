#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const i18nDir = path.join(__dirname, '..', 'src', 'assets', 'i18n');

// Get all valid keys from en.json
function getAllKeys(obj, prefix = '') {
  let keys = [];
  for (const key in obj) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      keys = keys.concat(getAllKeys(obj[key], fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

// CLDR plural categories. English only ever needs ONE and OTHER, so a locale
// that needs FEW or MANY has keys en.json cannot contain. Those are live
// translations, not leftovers, and deleting them makes the affected counts
// fall back to OTHER.
const CLDR_PLURAL_CATEGORIES = new Set(['ZERO', 'ONE', 'TWO', 'FEW', 'MANY', 'OTHER']);

// True for e.g. `F.SCHEDULE.MORE_EVENTS.FEW` when en.json has any key under
// `F.SCHEDULE.MORE_EVENTS`, i.e. the string itself is still in use and this is
// one of its plural forms.
function isLocaleOnlyPluralForm(fullKey, validKeys) {
  const lastDot = fullKey.lastIndexOf('.');
  if (lastDot === -1) return false;
  if (!CLDR_PLURAL_CATEGORIES.has(fullKey.slice(lastDot + 1))) return false;

  const parentPath = fullKey.slice(0, lastDot) + '.';
  return validKeys.some((k) => k.startsWith(parentPath));
}

// Remove keys from object that are not in validKeys
function cleanObject(obj, validKeys, prefix = '') {
  const cleaned = {};

  for (const key in obj) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      // Check if any valid key starts with this path
      const hasValidChild = validKeys.some((k) => k.startsWith(fullKey + '.'));
      if (hasValidChild) {
        const cleanedChild = cleanObject(obj[key], validKeys, fullKey);
        if (Object.keys(cleanedChild).length > 0) {
          cleaned[key] = cleanedChild;
        }
      }
    } else {
      // Check if this key exists in validKeys
      if (validKeys.includes(fullKey) || isLocaleOnlyPluralForm(fullKey, validKeys)) {
        cleaned[key] = obj[key];
      }
    }
  }

  return cleaned;
}

function main() {
  const enData = JSON.parse(fs.readFileSync(path.join(i18nDir, 'en.json'), 'utf8'));
  const validKeys = getAllKeys(enData);
  console.log(`Found ${validKeys.length} valid keys in en.json`);

  // Get all translation files
  const translationFiles = fs
    .readdirSync(i18nDir)
    .filter((file) => file.endsWith('.json') && file !== 'en.json');

  let totalRemoved = 0;

  // Process each translation file
  translationFiles.forEach((file) => {
    const filePath = path.join(i18nDir, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    const originalKeys = getAllKeys(data);
    const cleanedData = cleanObject(data, validKeys);
    const cleanedKeys = getAllKeys(cleanedData);

    const removedCount = originalKeys.length - cleanedKeys.length;
    totalRemoved += removedCount;

    if (removedCount > 0) {
      fs.writeFileSync(filePath, JSON.stringify(cleanedData, null, 2) + '\n', 'utf8');
      console.log(`${file}: Removed ${removedCount} orphaned keys`);
    } else {
      console.log(`${file}: No orphaned keys found`);
    }
  });

  console.log(`\nTotal orphaned keys removed: ${totalRemoved}`);
}

// Only rewrite files when run as a script; requiring this module must be safe.
if (require.main === module) {
  main();
}

module.exports = { cleanObject, getAllKeys, isLocaleOnlyPluralForm };
