const fs = require('fs');
const path = require('path');

// Read the version from package.json
const packageJson = require('../package.json');
const version = packageJson.version;

// Parse version to extract pre-release info
const versionParts = version.split('-');
const baseVersion = versionParts[0]; // e.g., "17.0.0"
const preRelease = versionParts[1]; // e.g., "RC.1" or undefined
const isPreRelease = !!preRelease;

String.prototype.insertAt = function (index, string) {
  return this.substr(0, index) + string + this.substr(index);
};

// Define the path to build.gradle
const gradleFilePath = path.join(__dirname, '..', 'android', 'app', 'build.gradle');

// Read the build.gradle file
let gradleFileContent = fs.readFileSync(gradleFilePath, 'utf8');

// Calculate versionCode
const baseVersionCode =
  baseVersion
    .split('.')
    .map((num) => num.padStart(2, '0'))
    .join('') * 10000;

let versionCodeDroid;
if (isPreRelease) {
  // Pre-release: extract number (RC.1 → 1, alpha.5 → 5)
  // Uses suffix 0001-8999 to be LOWER than stable (9000)
  const preReleaseNum = parseInt(preRelease.split('.')[1] || '1', 10);
  versionCodeDroid = baseVersionCode + preReleaseNum;
} else {
  // Stable release: use suffix 9000 to be HIGHER than any RC
  versionCodeDroid = baseVersionCode + 9000;
}

const versionCodeDroidWithUnderscores = versionCodeDroid
  .toString()
  .padStart(10, '0')
  .insertAt(6, '_')
  .insertAt(4, '_')
  .insertAt(2, '_');

gradleFileContent = gradleFileContent.replace(
  /versionCode (\d|_)+/g,
  `versionCode ${versionCodeDroidWithUnderscores}`,
);
gradleFileContent = gradleFileContent.replace(
  /versionName "[^"]+"/g,
  `versionName "${version}"`,
);

// Write the updated content back to build.gradle
fs.writeFileSync(gradleFilePath, gradleFileContent, 'utf8');

console.log(`Updated build.gradle to version ${version}`);

// Skip fastlane changelog for pre-release versions
if (isPreRelease) {
  console.log('Pre-release version – skipping fastlane changelog generation');
  process.exit(0);
}

// CREATE fastlane changelog file
// Define the paths
const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
const outputDir = path.join(
  __dirname,
  '..',
  'android',
  'fastlane',
  'metadata',
  'android',
  'en-US',
  'changelogs',
);
const outputFilePath = path.join(outputDir, `${versionCodeDroid}.txt`);

// Read the changelog.md file
const changelogContent = fs.readFileSync(changelogPath, 'utf8');

// Extract the latest changes
const lines = changelogContent.split('\n').slice(2); // Remove the first two lines;
let latestChanges = '';
let headerCount = 0;

for (const line of lines) {
  if (line.startsWith('# [') || line.startsWith('## [')) {
    headerCount++;
    if (headerCount === 1) break;
  }
  latestChanges += line + '\n';
}
// Remove all links from the extracted text
latestChanges = latestChanges
  .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
  .replace(/\s*\([a-f0-9]{7}\)\s*$/gm, '');

// Ensure the output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Write the latest changes to the versioned changelog file
fs.writeFileSync(outputFilePath, latestChanges, 'utf8');

console.log(`Wrote latest changes to ${outputFilePath}`);
