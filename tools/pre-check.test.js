const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const preCheck = require('../package.json').scripts.preCheck;
const steps = ['lint', 'test', 'int:test', 'e2e'];

test('preCheck runs every gate in order and stops at the first failure', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-pre-check-'));
  const log = path.join(directory, 'runs');

  try {
    fs.writeFileSync(
      path.join(directory, 'npm'),
      '#!/bin/sh\nprintf "%s\\n" "$2" >> "$PRE_CHECK_LOG"\n[ "$2" != "$PRE_CHECK_FAIL" ]\n',
      { mode: 0o755 },
    );
    fs.writeFileSync(
      path.join(directory, 'npm.cmd'),
      '@echo off\necho(%2>> "%PRE_CHECK_LOG%"\nif "%2"=="%PRE_CHECK_FAIL%" (exit /b 1) else (exit /b 0)\n',
    );

    for (const failedStep of ['', ...steps]) {
      fs.writeFileSync(log, '');
      const result = spawnSync(preCheck, {
        shell: true,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${directory}${path.delimiter}${process.env.PATH || ''}`,
          PRE_CHECK_LOG: log,
          PRE_CHECK_FAIL: failedStep,
        },
      });
      const expected = failedStep ? steps.slice(0, steps.indexOf(failedStep) + 1) : steps;

      assert.equal(result.status, failedStep ? 1 : 0, result.stderr);
      assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split(/\r?\n/), expected);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
