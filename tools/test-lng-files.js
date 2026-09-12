'use strict';

const { readdirSync, readFileSync } = require('node:fs');
const { join, relative } = require('node:path');

const BASE_PATH = join(__dirname, '..', 'src', 'assets', 'i18n');
const BASELINE_PATH = join(__dirname, 'test-lng-files.baseline.json');
const EXAMPLE_LIMIT = 3;
const LOG_VALUE_LIMIT = 120;
const INVISIBLE_LOG_CHARACTERS =
  /[\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/gu;

const collectLeafKeys = (value) => {
  const keys = [];

  const visit = (current, prefix) => {
    if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
      for (const [key, child] of Object.entries(current)) {
        visit(child, prefix ? `${prefix}.${key}` : key);
      }
      return;
    }

    if (prefix) keys.push(prefix);
  };

  visit(value, '');
  return keys.sort();
};

const compareKeyLists = (referenceKeys, referenceKeySet, translationKeys) => {
  const translationKeySet = new Set(translationKeys);

  return {
    missingKeys: referenceKeys.filter((key) => !translationKeySet.has(key)),
    unnecessaryKeys: translationKeys.filter((key) => !referenceKeySet.has(key)),
  };
};

const compareTranslationKeys = (reference, translation) => {
  const referenceKeys = collectLeafKeys(reference);
  const translationKeys = collectLeafKeys(translation);

  return compareKeyLists(referenceKeys, new Set(referenceKeys), translationKeys);
};

// Keep in sync with TranslateDefaultParser.templateMatcher in ngx-translate 17.
const PLACEHOLDER_PATTERN = /\{\{\s?([^{}\s]*)\s?\}\}/g;

const collectPlaceholders = (value) =>
  typeof value === 'string'
    ? [...value.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]).sort()
    : [];

// Brace syntax that cannot interpolate cleanly: a run of 3+ braces
// ("{{{name}}"), unbalanced "{{"/"}}" pairs ("{{name}"), or balanced pairs
// that ngx-translate's placeholder matcher does not consume ("{{  name  }}").
// A translation that drops a placeholder English declares silently loses the
// value the call site passes (#10006); it is an error unless listed in the
// baseline, which may only shrink. When English defines placeholders, a
// translation-only name is unsafe: callers
// supplying the English parameter names cannot resolve it, so ngx-translate
// leaves the placeholder visible in the rendered text.
const findBraceDefect = (value) => {
  if (typeof value !== 'string') return null;
  if (/\{{3,}|\}{3,}/.test(value)) return 'brace run';
  const opens = (value.match(/\{\{/g) ?? []).length;
  const closes = (value.match(/\}\}/g) ?? []).length;
  if (opens !== closes) return 'unbalanced braces';

  const unmatchedBraces = value.replace(PLACEHOLDER_PATTERN, '');
  return unmatchedBraces.includes('{{') || unmatchedBraces.includes('}}')
    ? 'invalid placeholder syntax'
    : null;
};

const getValueAtPath = (object, dottedKey) =>
  dottedKey.split('.').reduce((current, key) => current?.[key], object);

// Only keys present in both files are compared: a missing key falls back to
// the English value (already reported as drift), and an unnecessary key is
// never rendered.
const comparePlaceholders = (reference, translation, sharedKeys, baseline) => {
  const placeholderMismatches = [];
  const droppedPlaceholderKeys = [];
  const newDroppedPlaceholderKeys = [];
  const unexpectedPlaceholderKeys = [];
  const malformedKeys = [];
  const droppedByKey = new Map();

  for (const key of sharedKeys) {
    const translationValue = getValueAtPath(translation, key);
    const defect = findBraceDefect(translationValue);
    if (defect) malformedKeys.push(`${key} (${defect})`);

    const referencePlaceholders = collectPlaceholders(getValueAtPath(reference, key));
    const translationPlaceholders = collectPlaceholders(translationValue);
    if (referencePlaceholders.join('\n') !== translationPlaceholders.join('\n')) {
      placeholderMismatches.push(key);
    }

    const dropped = referencePlaceholders.filter(
      (placeholder) => !translationPlaceholders.includes(placeholder),
    );
    if (dropped.length > 0) {
      droppedPlaceholderKeys.push(key);
      droppedByKey.set(key, dropped);
      const baselined = baseline[key] ?? [];
      if (dropped.some((placeholder) => !baselined.includes(placeholder))) {
        newDroppedPlaceholderKeys.push(key);
      }
    }

    // Deliberately only when en.json defines placeholders. Whether a
    // translation-only name resolves depends on the CALL SITE's translateParams,
    // which this checker cannot see: a caller may pass values English does not
    // interpolate (schedule-week.component.ts passes `count` to both the _ONE
    // and plural tooltips; NotifyService passes translateParams to the title).
    // Dropping this guard flagged 2 of 30 working translations as broken.
    if (
      referencePlaceholders.length > 0 &&
      translationPlaceholders.some(
        (placeholder) => !referencePlaceholders.includes(placeholder),
      )
    ) {
      unexpectedPlaceholderKeys.push(key);
    }
  }

  const staleBaselineKeys = Object.entries(baseline)
    .filter(([key, names]) => {
      const dropped = droppedByKey.get(key) ?? [];
      return names.some((placeholder) => !dropped.includes(placeholder));
    })
    .map(([key]) => key)
    .sort();

  return {
    placeholderMismatches,
    droppedPlaceholderKeys,
    newDroppedPlaceholderKeys,
    staleBaselineKeys,
    unexpectedPlaceholderKeys,
    malformedKeys,
  };
};

const readTranslationFile = (directory, file) => {
  const filePath = join(directory, file);
  const contents = readFileSync(filePath, 'utf8');

  try {
    return JSON.parse(contents);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse ${file}: ${message} (${filePath})`);
  }
};

const readBaselineFile = (filePath) => {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return {};
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse baseline: ${message} (${filePath})`);
  }
};

const inspectTranslationDirectory = (directory, baseline = {}) => {
  const reference = readTranslationFile(directory, 'en.json');
  const referenceKeys = collectLeafKeys(reference);
  const referenceKeySet = new Set(referenceKeys);
  const files = readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'en.json',
    )
    .map((entry) => entry.name)
    .sort()
    .map((file) => {
      const translation = readTranslationFile(directory, file);
      const translationKeys = collectLeafKeys(translation);
      const sharedKeys = translationKeys.filter((key) => referenceKeySet.has(key));

      return {
        file,
        ...compareKeyLists(referenceKeys, referenceKeySet, translationKeys),
        ...comparePlaceholders(reference, translation, sharedKeys, baseline[file] ?? {}),
      };
    });
  const fileNames = new Set(files.map((file) => file.file));
  const staleBaselineFiles = Object.keys(baseline)
    .filter((file) => !fileNames.has(file))
    .sort();

  return {
    referenceKeyCount: referenceKeys.length,
    files,
    staleBaselineFiles,
    totalMissing: files.reduce((total, file) => total + file.missingKeys.length, 0),
    totalUnnecessary: files.reduce(
      (total, file) => total + file.unnecessaryKeys.length,
      0,
    ),
    totalPlaceholderMismatches: files.reduce(
      (total, file) => total + file.placeholderMismatches.length,
      0,
    ),
    totalUnexpectedPlaceholders: files.reduce(
      (total, file) => total + file.unexpectedPlaceholderKeys.length,
      0,
    ),
    totalMalformed: files.reduce((total, file) => total + file.malformedKeys.length, 0),
    totalNewDroppedPlaceholders: files.reduce(
      (total, file) => total + file.newDroppedPlaceholderKeys.length,
      0,
    ),
    totalStaleBaseline:
      files.reduce((total, file) => total + file.staleBaselineKeys.length, 0) +
      staleBaselineFiles.reduce(
        (total, file) => total + Object.keys(baseline[file]).length,
        0,
      ),
  };
};

const hasBlockingDefects = (report) =>
  report.totalUnexpectedPlaceholders > 0 ||
  report.totalMalformed > 0 ||
  report.totalNewDroppedPlaceholders > 0 ||
  report.totalStaleBaseline > 0 ||
  report.staleBaselineFiles.length > 0;

const formatLogValue = (value) => {
  const characters = [...String(value)];
  const preview =
    characters.length > LOG_VALUE_LIMIT
      ? `${characters.slice(0, LOG_VALUE_LIMIT).join('')}…`
      : characters.join('');

  return JSON.stringify(preview).replace(INVISIBLE_LOG_CHARACTERS, (character) => {
    const codePoint = character.codePointAt(0).toString(16).padStart(4, '0');
    return `\\u${codePoint}`;
  });
};

const formatExamples = (keys) => {
  if (keys.length === 0) return '';

  const examples = keys.slice(0, EXAMPLE_LIMIT).map(formatLogValue).join(', ');
  const remaining = keys.length - EXAMPLE_LIMIT;
  return ` (${examples}${remaining > 0 ? `, … ${remaining} more` : ''})`;
};

const printReport = (report) => {
  for (const file of report.files) {
    const missing = file.missingKeys.length;
    const unnecessary = file.unnecessaryKeys.length;
    const mismatched = file.placeholderMismatches.length;
    const dropped = file.newDroppedPlaceholderKeys.length;
    const stale = file.staleBaselineKeys.length;
    const unexpected = file.unexpectedPlaceholderKeys.length;
    const malformed = file.malformedKeys.length;

    if (
      missing === 0 &&
      unnecessary === 0 &&
      mismatched === 0 &&
      dropped === 0 &&
      stale === 0 &&
      unexpected === 0 &&
      malformed === 0
    ) {
      console.log(`${formatLogValue(file.file)}: OK`);
      continue;
    }

    console.log(
      `${formatLogValue(file.file)}: ${missing} missing${formatExamples(file.missingKeys)}; ` +
        `${unnecessary} not in en.json${formatExamples(file.unnecessaryKeys)}; ` +
        `${mismatched} placeholder mismatches${formatExamples(file.placeholderMismatches)}; ` +
        `${dropped} dropped placeholders not in baseline${formatExamples(file.newDroppedPlaceholderKeys)}; ` +
        `${stale} stale baseline entries${formatExamples(file.staleBaselineKeys)}; ` +
        `${unexpected} unexpected placeholders${formatExamples(file.unexpectedPlaceholderKeys)}; ` +
        `${malformed} broken braces${formatExamples(file.malformedKeys)}`,
    );
  }

  console.log(
    `Checked ${report.files.length} translation files against en.json ` +
      `(${report.referenceKeyCount} keys): ${report.totalMissing} missing, ` +
      `${report.totalUnnecessary} not in en.json, ` +
      `${report.totalPlaceholderMismatches} placeholder mismatches, ` +
      `${report.totalNewDroppedPlaceholders} dropped placeholders not in baseline, ` +
      `${report.totalStaleBaseline} stale baseline entries, ` +
      `${report.totalUnexpectedPlaceholders} unexpected placeholders, ` +
      `${report.totalMalformed} broken braces.`,
  );
  console.log(
    'Key differences and baselined placeholder mismatches are informational; ' +
      'missing translations use the English fallback.',
  );
  if (report.staleBaselineFiles.length > 0) {
    console.log(
      `Baseline lists files that do not exist${formatExamples(report.staleBaselineFiles)}.`,
    );
  }
  if (report.totalUnexpectedPlaceholders > 0 || report.totalMalformed > 0) {
    console.error(
      'Unexpected placeholder names in an English placeholder contract and ' +
        'broken braces render literally; fix them.',
    );
  }
  if (report.totalNewDroppedPlaceholders > 0) {
    console.error(
      'A translation drops a placeholder that en.json declares, so the value the ' +
        'call site passes is lost; add it back to the translation.',
    );
  }
  if (report.totalStaleBaseline > 0 || report.staleBaselineFiles.length > 0) {
    console.error(
      'The baseline lists entries that no longer drop a placeholder; remove them ' +
        `from ${relative(join(__dirname, '..'), BASELINE_PATH)} (the baseline may only shrink).`,
    );
  }
};

const printError = (error) => {
  console.error(formatLogValue(error instanceof Error ? error.message : error));
};

if (require.main === module) {
  try {
    const report = inspectTranslationDirectory(
      BASE_PATH,
      readBaselineFile(BASELINE_PATH),
    );
    printReport(report);
    if (hasBlockingDefects(report)) {
      process.exitCode = 1;
    }
  } catch (error) {
    printError(error);
    process.exitCode = 1;
  }
}

module.exports = {
  collectLeafKeys,
  collectPlaceholders,
  compareTranslationKeys,
  findBraceDefect,
  hasBlockingDefects,
  inspectTranslationDirectory,
  printError,
  printReport,
  readBaselineFile,
};
