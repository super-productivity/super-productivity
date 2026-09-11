'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const {
  collectLeafKeys,
  compareTranslationKeys,
  inspectTranslationDirectory,
  printError,
  printReport,
} = require('./test-lng-files');

test('unknown-overwrite warnings preserve the safety-critical data labels', () => {
  const i18nDirectory = join(__dirname, '..', 'src', 'assets', 'i18n');
  const readLocale = (file) =>
    JSON.parse(readFileSync(join(i18nDirectory, file), 'utf8'));
  const collectPlaceholders = (value) =>
    [...value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/gu)].map((match) => match[1]).sort();
  const englishWarning =
    readLocale('en.json').F.SYNC.D_CONFLICT.OVERWRITE_WARNING_UNKNOWN;
  const expectedPlaceholders = collectPlaceholders(englishWarning);

  for (const file of readdirSync(i18nDirectory)
    .filter((file) => file.endsWith('.json') && file !== 'en.json')
    .sort()) {
    const translatedWarning =
      readLocale(file).F.SYNC.D_CONFLICT.OVERWRITE_WARNING_UNKNOWN;

    assert.deepEqual(collectPlaceholders(translatedWarning), expectedPlaceholders, file);
  }
});

test('collectLeafKeys returns sorted dot-delimited paths for nested leaves', () => {
  assert.deepEqual(
    collectLeafKeys({
      task: {
        title: 'Title',
        details: {
          notes: 'Notes',
          dueDate: 'Due date',
        },
      },
      common: {
        save: 'Save',
      },
    }),
    ['common.save', 'task.details.dueDate', 'task.details.notes', 'task.title'],
  );
});

test('compareTranslationKeys reports sorted nested missing and unnecessary keys', () => {
  const reference = {
    common: {
      cancel: 'Cancel',
      save: 'Save',
    },
    task: {
      title: 'Title',
    },
  };
  const translation = {
    common: {
      cancel: 'Abbrechen',
      delete: 'Löschen',
    },
    obsolete: {
      label: 'Veraltet',
    },
    task: {
      title: 'Titel',
    },
  };

  assert.deepEqual(compareTranslationKeys(reference, translation), {
    missingKeys: ['common.save'],
    unnecessaryKeys: ['common.delete', 'obsolete.label'],
  });
});

test('compareTranslationKeys treats object-versus-leaf differences as structural mismatches', () => {
  const reference = {
    settings: {
      theme: {
        label: 'Theme',
      },
    },
  };
  const translation = {
    settings: {
      theme: 'Theme',
    },
  };

  assert.deepEqual(compareTranslationKeys(reference, translation), {
    missingKeys: ['settings.theme.label'],
    unnecessaryKeys: ['settings.theme'],
  });
});

test('collectPlaceholders extracts sorted names and ignores non-strings', () => {
  const { collectPlaceholders } = require('./test-lng-files');

  assert.deepEqual(collectPlaceholders('submit {{b}} to {{ a.name }} now'), [
    'a.name',
    'b',
  ]);
  assert.deepEqual(collectPlaceholders('welcome {{ user-name }}'), ['user-name']);
  assert.deepEqual(collectPlaceholders('no placeholders'), []);
  assert.deepEqual(collectPlaceholders(42), []);
});

test('findBraceDefect flags brace runs and unbalanced pairs but not clean values', () => {
  const { findBraceDefect } = require('./test-lng-files');

  assert.equal(findBraceDefect('Weekly on {{weekdayStr}}'), null);
  assert.equal(findBraceDefect('no braces at all'), null);
  assert.equal(findBraceDefect(null), null);
  assert.equal(findBraceDefect('Wekelijks op {{{weekdayStr}}'), 'brace run');
  assert.equal(findBraceDefect('planned for {{date}'), 'unbalanced braces');
  assert.equal(findBraceDefect('welcome {{ user-name }}'), null);
  assert.equal(findBraceDefect('welcome {{  name  }}'), 'invalid placeholder syntax');
  assert.equal(findBraceDefect('single {braces} are fine'), null);
});

test('inspectTranslationDirectory reports placeholder mismatches and broken braces per shared key', () => {
  const directory = mkdtempSync(join(tmpdir(), 'test-lng-files-'));

  try {
    const writeJson = (file, value) => {
      writeFileSync(join(directory, file), JSON.stringify(value));
    };

    writeJson('en.json', {
      msg: {
        extraDetail: 'Something failed',
        hyphenated: 'Hello {{user-name}}',
        planned: 'planned for {{date}}',
        renamed: 'Hello {{name}}',
        spacing: 'Hello {{name}}',
        weekly: 'Weekly on {{weekdayStr}}',
        plain: 'no params',
      },
    });
    writeJson('xx.json', {
      msg: {
        // Not flagged: English omitting a placeholder does not prove the call
        // site omits it too, so this stays a mismatch and not a defect.
        extraDetail: 'Fehlgeschlagen: {{detail}}',
        hyphenated: 'Hallo {{translated-name}}',
        planned: 'geplant', // drops {{date}}: mismatch, braces fine
        renamed: 'Hallo {{translatedName}}', // unresolved name: renders literally
        spacing: 'Hallo {{  name  }}',
        weekly: 'Wöchentlich am {{weekdayStr}', // unbalanced: malformed AND mismatch
        plain: 'keine Parameter',
      },
      extra: {
        // malformed but not a shared key; never rendered, must not count
        unused: '{{{orphan}}',
      },
    });

    const report = inspectTranslationDirectory(directory);
    assert.deepEqual(report.files[0].placeholderMismatches, [
      'msg.extraDetail',
      'msg.hyphenated',
      'msg.planned',
      'msg.renamed',
      'msg.spacing',
      'msg.weekly',
    ]);
    assert.deepEqual(report.files[0].unexpectedPlaceholderKeys, [
      'msg.hyphenated',
      'msg.renamed',
    ]);
    assert.deepEqual(report.files[0].malformedKeys, [
      'msg.spacing (invalid placeholder syntax)',
      'msg.weekly (unbalanced braces)',
    ]);
    assert.equal(report.totalPlaceholderMismatches, 6);
    assert.equal(report.totalUnexpectedPlaceholders, 2);
    assert.equal(report.totalMalformed, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('no shipped locale value has broken or unexpected placeholders', () => {
  // Broken braces and translation-only names render literally to users. A
  // missing expected name may reflect translated prose that omits the value,
  // so that broader set-level drift remains informational.
  const report = inspectTranslationDirectory(
    join(__dirname, '..', 'src', 'assets', 'i18n'),
  );
  const offenders = report.files
    .filter(
      (file) =>
        file.unexpectedPlaceholderKeys.length > 0 || file.malformedKeys.length > 0,
    )
    .map(
      (file) =>
        `${file.file}: unexpected=${file.unexpectedPlaceholderKeys.join(', ')}; ` +
        `malformed=${file.malformedKeys.join(', ')}`,
    );

  assert.deepEqual(offenders, []);
});

test('inspectTranslationDirectory compares every locale with deterministic order and totals', () => {
  const directory = mkdtempSync(join(tmpdir(), 'test-lng-files-'));

  try {
    const writeJson = (file, value) => {
      writeFileSync(join(directory, file), JSON.stringify(value));
    };

    writeJson('zh.json', {
      common: {
        cancel: '取消',
        save: '保存',
      },
      task: {
        title: '标题',
      },
    });
    writeJson('fr.json', {
      common: {
        cancel: 'Annuler',
      },
    });
    writeJson('en.json', {
      task: {
        title: 'Title',
      },
      common: {
        save: 'Save',
        cancel: 'Cancel',
      },
    });
    writeJson('de.json', {
      task: {
        title: 'Titel',
      },
      common: {
        cancel: 'Abbrechen',
        delete: 'Löschen',
      },
    });
    writeFileSync(join(directory, 'README.txt'), 'not a locale');

    assert.deepEqual(inspectTranslationDirectory(directory), {
      referenceKeyCount: 3,
      files: [
        {
          file: 'de.json',
          missingKeys: ['common.save'],
          unnecessaryKeys: ['common.delete'],
          placeholderMismatches: [],
          unexpectedPlaceholderKeys: [],
          malformedKeys: [],
        },
        {
          file: 'fr.json',
          missingKeys: ['common.save', 'task.title'],
          unnecessaryKeys: [],
          placeholderMismatches: [],
          unexpectedPlaceholderKeys: [],
          malformedKeys: [],
        },
        {
          file: 'zh.json',
          missingKeys: [],
          unnecessaryKeys: [],
          placeholderMismatches: [],
          unexpectedPlaceholderKeys: [],
          malformedKeys: [],
        },
      ],
      totalMissing: 3,
      totalUnnecessary: 1,
      totalPlaceholderMismatches: 0,
      totalUnexpectedPlaceholders: 0,
      totalMalformed: 0,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('inspectTranslationDirectory identifies the locale containing invalid JSON', () => {
  const directory = mkdtempSync(join(tmpdir(), 'test-lng-files-'));

  try {
    writeFileSync(join(directory, 'en.json'), '{"common":{"save":"Save"}}');
    writeFileSync(join(directory, 'de.json'), '{"common":{"save":');

    assert.throws(
      () => inspectTranslationDirectory(directory),
      /Unable to parse .*de\.json/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('inspectTranslationDirectory ignores .json directories and checks locale files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'test-lng-files-'));

  try {
    writeFileSync(
      join(directory, 'en.json'),
      '{"common":{"cancel":"Cancel","save":"Save"}}',
    );
    writeFileSync(join(directory, 'de.json'), '{"common":{"save":"Speichern"}}');
    mkdirSync(join(directory, 'ignored.json'));

    assert.deepEqual(inspectTranslationDirectory(directory), {
      referenceKeyCount: 2,
      files: [
        {
          file: 'de.json',
          missingKeys: ['common.cancel'],
          unnecessaryKeys: [],
          placeholderMismatches: [],
          unexpectedPlaceholderKeys: [],
          malformedKeys: [],
        },
      ],
      totalMissing: 1,
      totalUnnecessary: 0,
      totalPlaceholderMismatches: 0,
      totalUnexpectedPlaceholders: 0,
      totalMalformed: 0,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('printReport keeps adversarial values on inert output lines', (t) => {
  const output = [];
  t.mock.method(console, 'log', (...values) => {
    output.push(values.map(String).join(' '));
  });

  printReport({
    referenceKeyCount: 1,
    files: [
      {
        file: '::error file=secret::forged\nname\r\x1b[31m.json',
        missingKeys: ['error.message\n::warning::forged\r\x00\x1b[2J'],
        unnecessaryKeys: [],
        placeholderMismatches: [],
        unexpectedPlaceholderKeys: [],
        malformedKeys: [],
      },
    ],
    totalMissing: 1,
    totalUnnecessary: 0,
    totalPlaceholderMismatches: 0,
    totalUnexpectedPlaceholders: 0,
    totalMalformed: 0,
  });

  assert.equal(output.length, 3);
  for (const line of output) {
    assert.doesNotMatch(line, /[\u0000-\u001f\u007f-\u009f]/u);
  }
  assert.doesNotMatch(output.join('\n'), /(^|\n)::/u);
});

test('printReport bounds keys while retaining three examples and the remainder', (t) => {
  const output = [];
  t.mock.method(console, 'log', (...values) => {
    output.push(values.map(String).join(' '));
  });
  const veryLongKey = `first.${'x'.repeat(10_000)}`;

  printReport({
    referenceKeyCount: 5,
    files: [
      {
        file: 'de.json',
        missingKeys: [
          veryLongKey,
          'second.example',
          'third.example',
          'fourth.omitted',
          'fifth.omitted',
        ],
        unnecessaryKeys: [],
        placeholderMismatches: [],
        unexpectedPlaceholderKeys: [],
        malformedKeys: [],
      },
    ],
    totalMissing: 5,
    totalUnnecessary: 0,
    totalPlaceholderMismatches: 0,
    totalUnexpectedPlaceholders: 0,
    totalMalformed: 0,
  });

  const [fileLine] = output;
  assert.match(fileLine, /first\./u);
  assert.match(fileLine, /second\.example/u);
  assert.match(fileLine, /third\.example/u);
  assert.doesNotMatch(fileLine, /fourth\.omitted|fifth\.omitted/u);
  assert.match(fileLine, /… 2 more/u);
  assert.ok(fileLine.length < 1_000, `report line was ${fileLine.length} characters`);
  assert.ok(!fileLine.includes(veryLongKey));
});

test('printError preserves useful context in one bounded inert line', (t) => {
  const output = [];
  t.mock.method(console, 'error', (...values) => {
    output.push(values.map(String).join(' '));
  });
  const localeFile = 'de.json';
  const parseReason = 'Unexpected token } at position 17';
  const longDirectory = `/tmp/${'nested/'.repeat(2_000)}details`;
  const error = new Error(
    `${localeFile}: ${parseReason}\r\n::error::\x1b[31m\x00\u202e ${longDirectory}`,
  );

  printError(error);

  assert.equal(output.length, 1);
  const [line] = output;
  assert.ok(line.length < 1_000, `error line was ${line.length} characters`);
  assert.match(line, /de\.json/u);
  assert.match(line, /Unexpected token \} at position 17/u);
  assert.doesNotMatch(
    line,
    /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u,
  );
  assert.doesNotMatch(output.join('\n'), /(^|[\r\n])::/u);
});
