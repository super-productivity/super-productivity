const fs = require('fs');
const path = require('path');

// Read TypeScript definitions from node_modules
const defsPath = path.join(
  __dirname,
  '../node_modules/@material-symbols/font-400/index.d.ts',
);
const defsContent = fs.readFileSync(defsPath, 'utf8');

// Extract icon names from the TypeScript array type
// The file contains: type MaterialSymbols = ["icon1", "icon2", ...]
const iconNames = [];
const lines = defsContent.split('\n');

for (const line of lines) {
  const trimmed = line.trim();
  // Match lines like: "icon_name",
  const match = trimmed.match(/^"([^"]+)",?$/);
  if (match) {
    iconNames.push(match[1]);
  }
}

// Sort alphabetically
iconNames.sort();

// Write to TypeScript constant file
const output = `export const MATERIAL_ICONS: string[] = [\n${iconNames.map((name) => `  '${name}',`).join('\n')}\n];\n`;
const outputPath = path.join(__dirname, '../src/app/ui/material-icons.const.ts');
fs.writeFileSync(outputPath, output);

console.log(`✓ Generated ${iconNames.length} Material Symbols icon names`);

// Verify specific icons mentioned in issue #6079 are present
const missingIcons = [
  'robot_2',
  'manufacturing',
  'cognition',
  'cognition_2',
  'neurology',
];
const found = missingIcons.filter((icon) => iconNames.includes(icon));
const notFound = missingIcons.filter((icon) => !iconNames.includes(icon));

console.log(`\nVerification of issue #6079 icons:`);
found.forEach((icon) => console.log(`  ✓ ${icon} - FOUND`));
notFound.forEach((icon) => console.log(`  ✗ ${icon} - NOT FOUND`));
