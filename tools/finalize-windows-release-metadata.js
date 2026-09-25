#!/usr/bin/env node
'use strict';

/**
 * Rebuilds the Windows update metadata after SignPath returned the signed
 * executables.
 *
 * Signing rewrites the files electron-builder packed, so the block maps and
 * latest.yml produced during the build describe bytes we no longer publish.
 * Both are regenerated here from the signed executables.
 *
 * The block map has to be byte-compatible with what electron-updater expects,
 * so it is built with electron-builder's own implementation instead of a
 * reimplementation of the format. electron-builder 26.15 replaced the Go
 * `app-builder` binary (package `app-builder-bin`, which the lockfile no longer
 * contains) with this in-tree JS module.
 */

const { createHash } = require('node:crypto');
const {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} = require('node:fs');
const { join } = require('node:path');
const yaml = require('js-yaml');

// Internal path of a transitive dependency, hence pinned in one place and
// asserted by tools/verify-windows-artifact-contract.test.js, which runs as
// part of `npm run lint` — long before this step spends any SignPath quota.
const BLOCK_MAP_MODULE = 'app-builder-lib/out/targets/blockmap/blockmap';
const SETUP_PREFIX = 'Super-Productivity-Setup';
const BLOCK_MAP_SUFFIX = '.blockmap';
const DEFAULT_BUILD_DIR = '.tmp/app-builds';

const loadBuildBlockMap = () => require(BLOCK_MAP_MODULE).buildBlockMap;

const listSetupExes = (buildDir) =>
  readdirSync(buildDir).filter(
    (file) => file.startsWith(SETUP_PREFIX) && file.endsWith('.exe'),
  );

const getFileInfo = (filePath) => {
  const fileBuffer = readFileSync(filePath);
  const info = {
    sha512: createHash('sha512').update(fileBuffer).digest('base64'),
    size: fileBuffer.length,
  };
  const blockMapPath = filePath + BLOCK_MAP_SUFFIX;
  if (existsSync(blockMapPath)) {
    info.blockMapSize = statSync(blockMapPath).size;
  }
  return info;
};

// Only NSIS setup files carry a block map; the portable build does not use one.
const regenerateBlockMaps = async (buildDir, setupExes) => {
  const buildBlockMap = loadBuildBlockMap();
  for (const filename of setupExes) {
    const filePath = join(buildDir, filename);
    console.log(`Regenerating blockmap for ${filename}...`);
    const { size } = await buildBlockMap(filePath, 'gzip', filePath + BLOCK_MAP_SUFFIX);
    console.log(`  ${filename}: ${size} bytes mapped`);
  }
};

const updateLatestYml = (buildDir, setupExes) => {
  const ymlPath = join(buildDir, 'latest.yml');

  if (existsSync(ymlPath)) {
    // Update the existing latest.yml (preserves all electron-builder fields)
    const ymlData = yaml.load(readFileSync(ymlPath, 'utf8'));
    if (!ymlData || !ymlData.files || ymlData.files.length === 0) {
      throw new Error('latest.yml has no file entries');
    }
    for (const fileEntry of ymlData.files) {
      const filePath = join(buildDir, fileEntry.url);
      if (!existsSync(filePath)) {
        throw new Error(`File referenced in latest.yml not found: ${fileEntry.url}`);
      }
      const info = getFileInfo(filePath);
      Object.assign(fileEntry, info);
      console.log(
        `  Updated ${fileEntry.url}: sha512=${info.sha512.substring(0, 20)}... size=${info.size}`,
      );
    }
    if (ymlData.path) {
      const primary = ymlData.files.find((f) => f.url === ymlData.path);
      if (primary) {
        ymlData.sha512 = primary.sha512;
      }
    }
    writeFileSync(ymlPath, yaml.dump(ymlData, { lineWidth: -1 }));
    console.log('latest.yml updated with signed file hashes');
    return;
  }

  // Fallback: generate from scratch if latest.yml was not created
  console.log('No existing latest.yml found, generating from scratch');
  if (setupExes.length === 0) {
    throw new Error(`No setup executables found in ${buildDir}`);
  }
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
  const files = setupExes.map((filename) => {
    const info = getFileInfo(join(buildDir, filename));
    console.log(
      `  ${filename}: sha512=${info.sha512.substring(0, 20)}... size=${info.size}`,
    );
    return { url: filename, ...info };
  });
  const primary = files.find((f) => f.url === `${SETUP_PREFIX}.exe`) || files[0];
  const latestYml = {
    version: pkg.version,
    files,
    path: primary.url,
    sha512: primary.sha512,
    releaseDate: new Date().toISOString(),
  };
  writeFileSync(ymlPath, yaml.dump(latestYml, { lineWidth: -1 }));
  console.log(`Generated latest.yml for ${files.length} signed executables`);
};

const finalizeWindowsReleaseMetadata = async (buildDir) => {
  const setupExes = listSetupExes(buildDir);
  await regenerateBlockMaps(buildDir, setupExes);
  updateLatestYml(buildDir, setupExes);
};

if (require.main === module) {
  finalizeWindowsReleaseMetadata(process.argv[2] || DEFAULT_BUILD_DIR).catch((err) => {
    // Not process.exit(): it drops buffered stderr, and this tool exists to
    // make a late-stage release failure diagnosable from the log alone.
    console.error(`ERROR: ${err.stack || err.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  BLOCK_MAP_MODULE,
  finalizeWindowsReleaseMetadata,
  loadBuildBlockMap,
};
