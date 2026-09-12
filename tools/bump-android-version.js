const fs = require('fs');
const path = require('path');
const { generateReleaseNotes, getAndroidVersionInfo } = require('./release-notes');

// Read the version from package.json
const packageJson = require('../package.json');
const version = packageJson.version;
const { isPreRelease, versionCode, versionCodeWithUnderscores } =
  getAndroidVersionInfo(version);

// Define the path to build.gradle
const gradleFilePath = path.join(__dirname, '..', 'android', 'app', 'build.gradle');

// Read the build.gradle file
let gradleFileContent = fs.readFileSync(gradleFilePath, 'utf8');

gradleFileContent = gradleFileContent.replace(
  /versionCode (\d|_)+/g,
  `versionCode ${versionCodeWithUnderscores}`,
);
gradleFileContent = gradleFileContent.replace(
  /versionName "[^"]+"/g,
  `versionName "${version}"`,
);

// Write the updated content back to build.gradle
fs.writeFileSync(gradleFilePath, gradleFileContent, 'utf8');

console.log(`Updated build.gradle to version ${version}`);
generateReleaseNotes({ version, isPreRelease, versionCode });
