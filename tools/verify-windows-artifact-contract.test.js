'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

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
