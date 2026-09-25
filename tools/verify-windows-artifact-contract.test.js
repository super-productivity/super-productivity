'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
const {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { gunzipSync } = require('node:zlib');
const { load } = require('js-yaml');

const ROOT = join(__dirname, '..');
// `.gitattributes` now pins YAML to LF, so Windows checkouts match Linux ones.
// Normalize anyway: the line-exact section lookup below must not silently depend
// on how a given checkout resolved EOLs (a CRLF working tree is what broke the
// v18.22.0 Windows release job).
const readRoot = (...pathParts) =>
  readFileSync(join(ROOT, ...pathParts), 'utf8').replace(/\r\n/g, '\n');

const BUILDER_YAML = readRoot('electron-builder.yaml');
const RELEASE_WORKFLOW = readRoot('.github', 'workflows', 'build.yml');

const sectionValue = (sectionName, key) => {
  const lines = BUILDER_YAML.split('\n');
  const sectionStart = lines.indexOf(`${sectionName}:`);
  assert.notEqual(sectionStart, -1, `${sectionName} section not found`);

  for (let index = sectionStart + 1; index < lines.length; index++) {
    const line = lines[index];
    if (/^\S/.test(line)) {
      break;
    }
    const match = line.match(new RegExp(`^  ${key}:\\s*(\\S+)\\s*$`));
    if (match) {
      return match[1];
    }
  }

  assert.fail(`${key} not found in ${sectionName}`);
};

test('Windows release builds only the two universal executables', () => {
  assert.equal(sectionValue('nsis', 'artifactName'), 'Super-Productivity-Setup.${ext}');
  assert.equal(sectionValue('portable', 'artifactName'), '${name}.${ext}');
});

test('the pre-sign gate inspects both architecture payloads inside each executable', () => {
  assert.match(RELEASE_WORKFLOW, /Get-Command 7z/);
  assert.match(RELEASE_WORKFLOW, /l -slt -tNsis/);
  assert.match(RELEASE_WORKFLOW, /\$PLUGINSDIR\/app-64\.7z/);
  assert.match(RELEASE_WORKFLOW, /\$PLUGINSDIR\/app-arm64\.7z/);
  assert.doesNotMatch(
    RELEASE_WORKFLOW,
    /\$exe\.Length -lt/,
    'a fixed size floor can reject valid universal builds as dependencies change',
  );
});

test('signed universal executables are published under compatibility aliases', () => {
  const signStep = RELEASE_WORKFLOW.indexOf(
    '- name: Sign Windows executables with SignPath',
  );
  const metadataStep = RELEASE_WORKFLOW.indexOf(
    '- name: Regenerate blockmaps and generate latest.yml for signed executables',
  );
  const aliasStep = RELEASE_WORKFLOW.indexOf(
    '- name: Create legacy Windows download aliases',
  );
  const signatureStep = RELEASE_WORKFLOW.indexOf('- name: Verify code signatures');
  const publishStep = RELEASE_WORKFLOW.indexOf(
    '- name: Publish signed Windows binaries to GitHub Release',
  );

  assert.notEqual(signStep, -1, 'SignPath step not found');
  assert.notEqual(metadataStep, -1, 'metadata generation step not found');
  assert.notEqual(aliasStep, -1, 'compatibility alias step not found');
  assert.notEqual(signatureStep, -1, 'signature verification step not found');
  assert.notEqual(publishStep, -1, 'Windows publish step not found');
  assert.ok(aliasStep > signStep, 'aliases must not be submitted to SignPath');
  assert.ok(aliasStep > metadataStep, 'aliases must not enter latest.yml or blockmaps');
  assert.ok(signatureStep > aliasStep, 'verify signatures after creating aliases');
  assert.ok(publishStep > signatureStep, 'publish only after signature verification');

  for (const alias of [
    'Super-Productivity-Setup-x64.exe',
    'Super-Productivity-Setup-arm64.exe',
    'superProductivity-x64.exe',
    'superProductivity-arm64.exe',
  ]) {
    assert.match(RELEASE_WORKFLOW, new RegExp(`Copy-Item.*${alias}`));
  }
});

// The release-metadata step runs after SignPath has been paid, so a broken
// reference in it is only discovered once the quota is spent. It resolved
// `app-builder-bin` until electron-builder 26.15 dropped that package, which
// failed the v19.0.0 Windows job with MODULE_NOT_FOUND. These tests run as part
// of `npm run lint`, before the build.
test('every package the release-metadata tool requires is actually installed', () => {
  // app-builder-bin was reachable until it silently left the lockfile. js-yaml
  // is the same shape -- undeclared in package.json, present only because a
  // transitive dependency hoists it -- so pin both rather than find out during
  // a release. `require` of the tool covers js-yaml; the deep path is explicit.
  assert.doesNotThrow(() => require('./finalize-windows-release-metadata.js'));
  const { BLOCK_MAP_MODULE } = require('./finalize-windows-release-metadata.js');
  assert.equal(typeof require(BLOCK_MAP_MODULE).buildBlockMap, 'function');
});

test('the release-metadata step delegates to the checked-in tool', () => {
  assert.match(
    RELEASE_WORKFLOW,
    /run: node tools\/finalize-windows-release-metadata\.js \.tmp\/app-builds/,
  );
  assert.doesNotMatch(
    RELEASE_WORKFLOW,
    /app-builder-bin/,
    'app-builder-bin is not installed; blockmaps come from app-builder-lib',
  );
});

test('the tool builds a blockmap with the installed electron-builder', async (t) => {
  const {
    BLOCK_MAP_MODULE,
    loadBuildBlockMap,
  } = require('./finalize-windows-release-metadata.js');

  const buildBlockMap = loadBuildBlockMap();
  const dir = mkdtempSync(join(tmpdir(), 'sp-blockmap-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // Content-defined chunking needs incompressible, non-repeating bytes to find
  // any boundaries at all; a zero-filled file yields a single block.
  const exe = join(dir, 'Super-Productivity-Setup.exe');
  writeFileSync(exe, randomBytes(512 * 1024));
  const blockMapFile = `${exe}.blockmap`;

  const info = await buildBlockMap(exe, 'gzip', blockMapFile);
  assert.equal(info.size, 512 * 1024, `${BLOCK_MAP_MODULE} returned no file size`);
  assert.ok(info.sha512, 'no sha512 returned for the signed file');

  const blockMap = JSON.parse(gunzipSync(readFileSync(blockMapFile)).toString('utf8'));
  assert.equal(blockMap.version, '2');
  assert.equal(blockMap.files.length, 1);
  assert.ok(blockMap.files[0].checksums.length > 0, 'blockmap holds no checksums');
});

test('the tool rewrites latest.yml over the signed files', async (t) => {
  const {
    finalizeWindowsReleaseMetadata,
  } = require('./finalize-windows-release-metadata.js');

  const buildDir = mkdtempSync(join(tmpdir(), 'sp-app-builds-'));
  t.after(() => rmSync(buildDir, { recursive: true, force: true }));

  const setup = 'Super-Productivity-Setup.exe';
  const portable = 'superProductivity.exe';
  const signedSetup = randomBytes(256 * 1024);
  writeFileSync(join(buildDir, setup), signedSetup);
  writeFileSync(join(buildDir, portable), randomBytes(128 * 1024));
  // What electron-builder leaves behind: hashes of the unsigned build. Only the
  // NSIS target sets isWriteUpdateInfo, so the portable is never listed here.
  writeFileSync(
    join(buildDir, 'latest.yml'),
    [
      'version: 19.0.0',
      'files:',
      `  - url: ${setup}`,
      '    sha512: stale',
      '    size: 1',
      '    blockMapSize: 1',
      `path: ${setup}`,
      'sha512: stale',
      "releaseDate: '2026-09-11T19:00:00.000Z'",
    ].join('\n'),
  );

  await finalizeWindowsReleaseMetadata(buildDir);

  const latest = load(readFileSync(join(buildDir, 'latest.yml'), 'utf8'));
  const [setupEntry] = latest.files;
  assert.equal(latest.files.length, 1);
  assert.equal(setupEntry.size, 256 * 1024);
  assert.equal(
    setupEntry.sha512,
    createHash('sha512').update(signedSetup).digest('base64'),
    'latest.yml must carry the hash of the signed file itself',
  );
  assert.equal(latest.sha512, setupEntry.sha512, 'top-level sha512 must track path');
  assert.equal(latest.version, '19.0.0', 'unrelated fields kept');
  assert.equal(latest.releaseDate, '2026-09-11T19:00:00.000Z', 'unrelated fields kept');

  // Only the NSIS setup gets a block map; the portable has no update path.
  assert.equal(
    setupEntry.blockMapSize,
    statSync(join(buildDir, `${setup}.blockmap`)).size,
  );
  assert.equal(existsSync(join(buildDir, `${portable}.blockmap`)), false);
});

// Reachable only when electron-builder wrote no latest.yml at all, which is
// the one path the old inline script also guarded.
test('the tool fails instead of writing metadata without executables', async (t) => {
  const {
    finalizeWindowsReleaseMetadata,
  } = require('./finalize-windows-release-metadata.js');

  const buildDir = mkdtempSync(join(tmpdir(), 'sp-app-builds-empty-'));
  t.after(() => rmSync(buildDir, { recursive: true, force: true }));

  await assert.rejects(
    () => finalizeWindowsReleaseMetadata(buildDir),
    /No setup executables found/,
  );
});
