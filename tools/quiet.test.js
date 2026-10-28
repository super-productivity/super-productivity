const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const quiet = path.join(__dirname, 'quiet.js');

// A throwaway package whose npm scripts stand in for test runners.
const makePackage = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiet-test-'));
  const write = (name, body) => fs.writeFileSync(path.join(dir, name), body);
  write(
    'pass.js',
    'for (let i = 0; i < 200; i++) console.log(`noise ${i}`);\n' +
      "console.log('  3 passed (1.2s)');\n",
  );
  write(
    'fail.js',
    'for (let i = 1; i <= 100; i++) console.log(`line ${i}`);\n' +
      "console.error('boom');\n" +
      "for (let i = 0; i < 80; i++) console.log('[WebServer] warn');\n" +
      'process.exit(3);\n',
  );
  write('args.js', "console.log('ARGS:' + process.argv.slice(2).join(' '));\n");
  write(
    'package.json',
    JSON.stringify({
      scripts: { pass: 'node pass.js', fail: 'node fail.js', args: 'node args.js' },
    }),
  );
  return dir;
};

const run = (dir, ...args) =>
  spawnSync(process.execPath, [quiet, ...args], { cwd: dir, encoding: 'utf8' });

const logPathOf = (dir, output) =>
  path.resolve(dir, output.match(/(?:log: |lines of )(\S+)/)[1]);

test('quiet prints one result line and the test counts for a passing script', () => {
  const dir = makePackage();
  const result = run(dir, 'pass');
  const log = logPathOf(dir, result.stdout);
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /✅ pass passed in \d+s/);
    assert.match(result.stdout, /3 passed \(1\.2s\)/);
    assert.doesNotMatch(result.stdout, /noise/);
    assert.match(fs.readFileSync(log, 'utf8'), /noise 199/);
  } finally {
    fs.rmSync(log, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('quiet keeps the exit code and prints the end of the log on failure', () => {
  const dir = makePackage();
  const result = run(dir, 'fail');
  const log = logPathOf(dir, result.stderr);
  try {
    assert.equal(result.status, 3);
    assert.match(result.stderr, /❌ fail failed \(exit 3\)/);
    assert.match(result.stderr, /line 100\nboom/);
    assert.doesNotMatch(result.stderr, /line 1\n/);
    assert.doesNotMatch(result.stderr, /\[WebServer\]/);
  } finally {
    fs.rmSync(log, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('quiet forwards args and drops a copied inner "--"', () => {
  const dir = makePackage();
  const result = run(dir, 'args', 'a.spec.ts', '--', '--retries=0');
  const log = logPathOf(dir, result.stdout);
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(fs.readFileSync(log, 'utf8'), /ARGS:a\.spec\.ts --retries=0/);
  } finally {
    fs.rmSync(log, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
