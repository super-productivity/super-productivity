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
const { execFileSync } = require('child_process');
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

// Get commit messages since the last tag.
// During `npm version`, the new tag does not exist yet, so
// `git describe --tags --abbrev=0 HEAD` gives us the previous release tag,
// which is exactly the start of the range we want.
let gitLog;
try {
  const lastTag = execFileSync('git', ['describe', '--tags', '--abbrev=0', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  gitLog = execFileSync(
    'git',
    ['log', `${lastTag}...HEAD`, '--no-merges', '--pretty=format:- %s'],
    { encoding: 'utf8' },
  );
} catch (err) {
  console.warn(`Could not generate changelog from git tags: ${err.message}`);
  console.warn('Falling back to last 20 commits');
  gitLog = execFileSync('git', ['log', '-20', '--no-merges', '--pretty=format:- %s'], {
    encoding: 'utf8',
  });
}
// Strip conventional-commit prefixes (e.g. "feat(tasks): " → "")
let latestChanges = gitLog.replace(/^- \w+(\([^)]*\))?!?:\s*/gm, '- ');
// Truncate to 500 chars at line boundaries for Play Store limit
const lines = latestChanges.split('\n');
let truncated = '';
for (const line of lines) {
  if ((truncated + line + '\n').length > 500) break;
  truncated += line + '\n';
}
latestChanges = truncated.trimEnd() || 'Bug fixes and improvements';

// Ensure the output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Write the latest changes to the versioned changelog file
fs.writeFileSync(outputFilePath, latestChanges, 'utf8');

console.log(`Wrote latest changes to ${outputFilePath}`);
