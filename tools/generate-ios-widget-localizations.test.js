const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  generateIosWidgetLocalizations,
  renderStringsFile,
} = require('./generate-ios-widget-localizations');

test('renders deterministic escaped iOS widget strings', () => {
  assert.equal(
    renderStringsFile({
      TODAY: 'Today',
      DESCRIPTION: 'Shows "today"\'s tasks',
    }),
    `/* Generated from src/assets/i18n/en.json. Do not edit directly. */
"WIDGET.IOS.DESCRIPTION" = "Shows \\"today\\"'s tasks";
"WIDGET.IOS.TODAY" = "Today";
`,
  );
});

test('rejects a missing widget translation section with a clear error', () => {
  assert.throws(
    () => renderStringsFile(undefined),
    /WIDGET\.IOS must contain at least one string-only translation entry/,
  );
});

test('generates Localizable.strings from the WIDGET.IOS translation section', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-widget-i18n-'));
  const sourcePath = path.join(tempDir, 'en.json');
  const outputPath = path.join(tempDir, 'en.lproj', 'Localizable.strings');

  try {
    fs.writeFileSync(
      sourcePath,
      JSON.stringify({ WIDGET: { IOS: { EMPTY: 'No tasks for today' } } }),
    );

    generateIosWidgetLocalizations({ sourcePath, outputPath });

    assert.equal(
      fs.readFileSync(outputPath, 'utf8'),
      `/* Generated from src/assets/i18n/en.json. Do not edit directly. */
"WIDGET.IOS.EMPTY" = "No tasks for today";
`,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
