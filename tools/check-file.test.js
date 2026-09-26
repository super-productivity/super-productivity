const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.join(__dirname, '..');
const checkFile = path.join(__dirname, 'check-file.js');
const tempFile = (name) => path.join(repoRoot, 'src/app/util', name);
const run = (file) =>
  spawnSync(process.execPath, [checkFile, file], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

test('checkFile accepts a covered TypeScript file', () => {
  const file = tempFile(`check-file-valid-${process.pid}.ts`);
  try {
    fs.writeFileSync(file, 'export const checkFileValue = 1;\n');
    const result = run(file);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /All checks passed/);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('checkFile rejects a globally ignored TypeScript file', () => {
  const result = run('packages/shared-schema/src/schema-version.ts');
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /ignored.*packages\/README\.md/is);
  assert.doesNotMatch(result.stdout, /All checks passed/);
});

test('checkFile rejects non-package files without suggesting package checks', () => {
  for (const file of ['src/app/t.const.ts', 'src/assets/themes/arc.css']) {
    const result = run(file);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /not linted by root ESLint \(ignored or unconfigured\)/);
    assert.doesNotMatch(result.stderr, /packages\/README\.md/);
    assert.doesNotMatch(result.stdout, /All checks passed/);
  }
});

test('checkFile propagates an actual lint failure', () => {
  const file = tempFile(`check-file-invalid-${process.pid}.ts`);
  try {
    fs.writeFileSync(file, 'const unusedValue = 1;\n');
    const result = run(file);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /no-unused-vars/);
    assert.doesNotMatch(result.stdout, /All checks passed/);
  } finally {
    fs.rmSync(file, { force: true });
  }
});
