const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const defaultSourcePath = path.join(repoRoot, 'src/assets/i18n/en.json');
const defaultOutputPath = path.join(
  repoRoot,
  'ios/App/SupWidget/en.lproj/Localizable.strings',
);

const escapeStringsValue = (value) =>
  value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');

const renderStringsFile = (strings) => {
  if (!strings || typeof strings !== 'object' || Array.isArray(strings)) {
    throw new Error('WIDGET.IOS must contain at least one string-only translation entry');
  }

  const entries = Object.entries(strings).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  if (!entries.length || entries.some(([, value]) => typeof value !== 'string')) {
    throw new Error('WIDGET.IOS must contain at least one string-only translation entry');
  }

  const lines = entries.map(
    ([key, value]) => `"WIDGET.IOS.${key}" = "${escapeStringsValue(value)}";`,
  );

  return [
    '/* Generated from src/assets/i18n/en.json. Do not edit directly. */',
    ...lines,
    '',
  ].join('\n');
};

const generateIosWidgetLocalizations = ({
  sourcePath = defaultSourcePath,
  outputPath = defaultOutputPath,
} = {}) => {
  const translations = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const widgetStrings = translations.WIDGET?.IOS;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, renderStringsFile(widgetStrings), 'utf8');
};

if (require.main === module) {
  generateIosWidgetLocalizations();
}

module.exports = { generateIosWidgetLocalizations, renderStringsFile };
