const fs = require('fs');
const path = require('path');

const i18nDir = path.resolve(__dirname, '../src/assets/i18n');
const enPath = path.join(i18nDir, 'en.json');

function mergeInOrder(enObj, langObj) {
  if (typeof enObj !== 'object' || enObj === null) return langObj;
  const result = Array.isArray(enObj) ? [] : {};
  for (const key of Object.keys(enObj)) {
    if (
      typeof enObj[key] === 'object' &&
      enObj[key] !== null &&
      !Array.isArray(enObj[key])
    ) {
      result[key] = mergeInOrder(enObj[key], langObj && langObj[key] ? langObj[key] : {});
    } else {
      result[key] = langObj && key in langObj ? langObj[key] : enObj[key];
    }
  }
  return result;
}

// Extract keys that exist in en.json but not in langObj
function extractMissingKeys(enObj, langObj) {
  const missing = {};

  for (const key of Object.keys(enObj)) {
    if (typeof enObj[key] === 'object' && !Array.isArray(enObj[key])) {
      const nested = extractMissingKeys(enObj[key], langObj?.[key] || {});
      if (Object.keys(nested).length > 0) {
        missing[key] = nested;
      }
    } else if (!langObj || !(key in langObj)) {
      missing[key] = enObj[key];
    }
  }

  return missing;
}

// Merge WIP translations into main language file
// IMPORTANT: Must maintain same order as en.json
function mergeWipToMain(enObj, langObj, wipObj) {
  const result = {};

  // Iterate through en.json keys to maintain order
  for (const key of Object.keys(enObj)) {
    if (typeof enObj[key] === 'object' && !Array.isArray(enObj[key])) {
      result[key] = mergeWipToMain(enObj[key], langObj?.[key] || {}, wipObj?.[key] || {});
    } else {
      // Priority: WIP > existing lang > English
      if (wipObj && key in wipObj) {
        result[key] = wipObj[key];
      } else if (langObj && key in langObj) {
        result[key] = langObj[key];
      } else {
        result[key] = enObj[key];
      }
    }
  }

  return result;
}

// Verify all en.json keys exist in langObj after merge
function validateComplete(enObj, langObj, prefix = '') {
  const missing = [];

  for (const key of Object.keys(enObj)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (typeof enObj[key] === 'object' && !Array.isArray(enObj[key])) {
      missing.push(...validateComplete(enObj[key], langObj?.[key], path));
    } else if (!langObj || !(key in langObj)) {
      missing.push(path);
    }
  }

  return missing;
}

// Count total translation keys (leaf nodes only)
function countKeys(obj) {
  let count = 0;
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
      count += countKeys(obj[key]);
    } else {
      count++;
    }
  }
  return count;
}

// Parse CLI arguments
const args = process.argv.slice(2);
const mode = args[0]; // 'extract', 'merge', or undefined for legacy
const language = args[1]; // e.g., 'tr', 'de'

if (!fs.existsSync(enPath)) {
  console.error('en.json not found in src/assets/i18n/');
  process.exit(1);
}

if (!fs.existsSync(i18nDir)) {
  console.error('i18n directory not found at src/assets/i18n/');
  process.exit(1);
}

// Read the English reference file
const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));

// ========== EXTRACT MODE ==========
if (mode === 'extract') {
  if (!language) {
    console.error('Error: Language code required for extract mode');
    console.error('Usage: node tools/add-missing-i18n-variables.js extract <language>');
    console.error('Example: node tools/add-missing-i18n-variables.js extract tr');
    process.exit(1);
  }

  const langPath = path.join(i18nDir, `${language}.json`);
  const wipPath = path.join(i18nDir, `${language}-wip.json`);

  // Read existing language file or create empty object
  let langObj = {};
  if (fs.existsSync(langPath)) {
    const content = fs.readFileSync(langPath, 'utf8');
    if (content.trim()) {
      langObj = JSON.parse(content);
    }
  }

  // Extract missing keys
  const missing = extractMissingKeys(en, langObj);
  const missingCount = countKeys(missing);

  if (missingCount === 0) {
    console.log(`✓ No missing translations for ${language}`);
    console.log(`  All ${countKeys(en)} keys are present in ${language}.json`);
    process.exit(0);
  }

  // Write WIP file
  fs.writeFileSync(wipPath, JSON.stringify(missing, null, 2) + '\n', 'utf8');

  console.log(`✓ Found ${missingCount} missing translations`);
  console.log(`✓ Created ${language}-wip.json`);
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Translate the keys in ${language}-wip.json`);
  console.log(`  2. Run: node tools/add-missing-i18n-variables.js merge ${language}`);
  process.exit(0);
}

// ========== MERGE MODE ==========
if (mode === 'merge') {
  if (!language) {
    console.error('Error: Language code required for merge mode');
    console.error('Usage: node tools/add-missing-i18n-variables.js merge <language>');
    console.error('Example: node tools/add-missing-i18n-variables.js merge tr');
    process.exit(1);
  }

  const langPath = path.join(i18nDir, `${language}.json`);
  const wipPath = path.join(i18nDir, `${language}-wip.json`);

  if (!fs.existsSync(wipPath)) {
    console.error(`Error: ${language}-wip.json not found`);
    console.error(
      `Run extract first: node tools/add-missing-i18n-variables.js extract ${language}`,
    );
    process.exit(1);
  }

  // Read files
  let langObj = {};
  if (fs.existsSync(langPath)) {
    const content = fs.readFileSync(langPath, 'utf8');
    if (content.trim()) {
      langObj = JSON.parse(content);
    }
  }

  const wipObj = JSON.parse(fs.readFileSync(wipPath, 'utf8'));
  const wipCount = countKeys(wipObj);

  // Merge WIP into main file (maintaining en.json order)
  const merged = mergeWipToMain(en, langObj, wipObj);

  // Validate
  const missingKeys = validateComplete(en, merged);
  if (missingKeys.length > 0) {
    console.error('✗ Validation failed: Some keys are still missing:');
    missingKeys.slice(0, 10).forEach((key) => console.error(`  - ${key}`));
    if (missingKeys.length > 10) {
      console.error(`  ... and ${missingKeys.length - 10} more`);
    }
    process.exit(1);
  }

  // Write merged file
  fs.writeFileSync(langPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');

  // Delete WIP file
  fs.unlinkSync(wipPath);

  console.log(`✓ Merged ${wipCount} translations from ${language}-wip.json`);
  console.log(`✓ Updated ${language}.json (maintaining en.json order)`);
  console.log(`✓ Validation passed: All ${countKeys(en)} keys present`);
  console.log(`✓ Deleted ${language}-wip.json`);
  process.exit(0);
}

// ========== LEGACY MODE (default) ==========

// Get all i18n files except en.json and -wip.json files
const i18nFiles = fs
  .readdirSync(i18nDir)
  .filter(
    (file) => file.endsWith('.json') && file !== 'en.json' && !file.endsWith('-wip.json'),
  )
  .sort();

console.log(`Found ${i18nFiles.length} language files to update:`);
console.log(i18nFiles.map((file) => `  - ${file}`).join('\n'));
console.log('');

let updatedFiles = 0;
let errors = 0;

// Process each language file
for (const file of i18nFiles) {
  const langPath = path.join(i18nDir, file);
  const langCode = file.replace('.json', '');

  try {
    // Read existing language file or create empty object if it doesn't exist
    let langObj = {};
    if (fs.existsSync(langPath)) {
      const content = fs.readFileSync(langPath, 'utf8');
      if (content.trim()) {
        langObj = JSON.parse(content);
      }
    }

    // Merge with English structure, preserving existing translations
    const merged = mergeInOrder(en, langObj);

    // Write the updated file
    fs.writeFileSync(langPath, JSON.stringify(merged, null, 2), 'utf8');

    console.log(`✓ Updated ${file}`);
    updatedFiles++;
  } catch (error) {
    console.error(`✗ Error processing ${file}:`);
    console.error(`   Path: ${langPath}`);
    console.error(`   Error: ${error.message}`);
    if (error.stack) {
      console.error(`   Stack: ${error.stack.split('\n')[1]?.trim()}`);
    }
    errors++;
  }
}

console.log('');
console.log(`Summary:`);
console.log(`  - Updated files: ${updatedFiles}`);
console.log(`  - Errors: ${errors}`);
console.log(`  - Total files processed: ${i18nFiles.length}`);

if (errors === 0) {
  console.log('');
  console.log(
    'All language files updated successfully with missing keys in the same order as en.json.',
  );
  console.log('');
  console.log('💡 Tip: Use extract/merge workflow for incremental translations:');
  console.log('  node tools/add-missing-i18n-variables.js extract <lang>');
  console.log('  node tools/add-missing-i18n-variables.js merge <lang>');
} else {
  console.log('');
  console.log('Some files had errors. Please check the output above.');
  process.exit(1);
}
