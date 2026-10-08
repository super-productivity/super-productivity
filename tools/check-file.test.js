const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.join(__dirname, '..');
const checkFile = path.join(__dirname, 'check-file.js');
const tempFile = (name) => path.join(repoRoot, 'src/app/util', name);
const run = (...files) =>
  spawnSync(process.execPath, [checkFile, ...files], {
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

test('checkFile checks several files in one run', () => {
  const valid = tempFile(`check-file-multi-valid-${process.pid}.ts`);
  const valid2 = tempFile(`check-file-multi-valid2-${process.pid}.ts`);
  const invalid = tempFile(`check-file-multi-invalid-${process.pid}.ts`);
  try {
    fs.writeFileSync(valid, 'export const checkFileMultiValue = 1;\n');
    fs.writeFileSync(valid2, 'export const checkFileMultiValue2 = 1;\n');
    fs.writeFileSync(invalid, 'const unusedMultiValue = 1;\n');

    const passing = run(valid, valid2);
    assert.equal(passing.status, 0, passing.stdout + passing.stderr);
    assert.match(passing.stdout, /All checks passed/);

    const failing = run(valid, invalid);
    assert.notEqual(failing.status, 0, failing.stdout + failing.stderr);
    assert.match(failing.stderr, /no-unused-vars/);
    assert.match(failing.stderr, new RegExp(path.basename(invalid)));
    assert.doesNotMatch(failing.stdout, /All checks passed/);
  } finally {
    fs.rmSync(valid, { force: true });
    fs.rmSync(valid2, { force: true });
    fs.rmSync(invalid, { force: true });
  }
});

test('checkFile names a file prettier cannot parse in a multi-file run', () => {
  const valid = tempFile(`check-file-syntax-valid-${process.pid}.ts`);
  const broken = tempFile(`check-file-syntax-broken-${process.pid}.ts`);
  try {
    fs.writeFileSync(valid, 'export const checkFileSyntaxValue = 1;\n');
    fs.writeFileSync(broken, 'const = ;\n');
    const result = run(valid, broken);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, new RegExp(path.basename(broken)));
  } finally {
    fs.rmSync(valid, { force: true });
    fs.rmSync(broken, { force: true });
  }
});
