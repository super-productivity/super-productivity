#!/usr/bin/env node
/**
 * Runs an npm script with its output written to a log file and prints only the
 * result, so agent sessions don't spend context on build tables and passing tests.
 *
 *   npm run quiet -- <script> [args...]
 *   npm run quiet -- test:file src/app/util/is-today.util.spec.ts
 *   npm run quiet -- e2e:file e2e/tests/task-basic/task-crud.spec.ts --retries=0
 *
 * Pass: one line, the test counts where the runner prints them (to tell "passed"
 * from "nothing ran") and the log path. Fail: the log's last lines and its path.
 * The exit code is kept.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const TAIL_LINES = 60;
// Final count lines of Karma, Playwright and vitest.
const SUMMARY_PATTERN =
  /^\s*(TOTAL: \d+|\d+ (passed|failed|flaky|skipped|did not run|interrupted)\b|(Test Files|Tests)\s+\d+)/;
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;
// Dev-server output Playwright interleaves with test results; in the failure
// excerpt it pushes earlier failure blocks out of the tail. It stays in the log.
const WEB_SERVER_LINE = /^\[WebServer\]/;

const [script, ...rawArgs] = process.argv.slice(2);
if (!script) {
  console.error('Usage: npm run quiet -- <npm-script> [args...]');
  process.exit(1);
}
// Docs write `npm run e2e:file <path> -- --retries=0`; copied behind `quiet --`
// that inner `--` would reach Playwright literally and turn the flags into paths.
const args = rawArgs.filter((arg) => arg !== '--');

const repoRoot = path.join(__dirname, '..');
const logDir = path.join(repoRoot, '.tmp', 'logs');
// Unique name: an agent may run the same script twice in parallel, and sandboxed
// commands get their own pid namespace, so the pid alone repeats across runs.
const runId = `${Date.now()}-${process.pid}`;
const logFile = path.join(logDir, `${script.replace(/\W+/g, '-')}.${runId}.log`);

/** Runs `npm run <script> -- <args>` with stdout and stderr in the log file. */
const runScript = () => {
  fs.mkdirSync(logDir, { recursive: true });
  const fd = fs.openSync(logFile, 'w');
  const npmArgs = ['run', script, ...(args.length ? ['--', ...args] : [])];
  // npm_execpath is npm-cli.js when started via `npm run`; spawning it through
  // node avoids the Windows .cmd shim, which Node won't spawn without a shell.
  const npmCli = process.env.npm_execpath;
  const [cmd, cmdArgs] = /\.[cm]?js$/.test(npmCli ?? '')
    ? [process.execPath, [npmCli, ...npmArgs]]
    : ['npm', npmArgs];
  try {
    return spawnSync(cmd, cmdArgs, {
      cwd: process.cwd(),
      stdio: ['ignore', fd, fd],
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });
  } finally {
    fs.closeSync(fd);
  }
};

const readLogLines = () =>
  fs.readFileSync(logFile, 'utf8').replace(ANSI_PATTERN, '').split('\n');

const main = () => {
  const start = Date.now();
  const result = runScript();
  const seconds = Math.round((Date.now() - start) / 1000);
  if (result.error) {
    console.error(`❌ Could not start npm: ${result.error.message}`);
    return 1;
  }
  const lines = readLogLines();
  if (result.status === 0) {
    const summary = [...new Set(lines.filter((l) => SUMMARY_PATTERN.test(l)))];
    console.log(`✅ ${script} passed in ${seconds}s`);
    summary.forEach((line) => console.log(`   ${line.trim()}`));
    console.log(`   log: ${logFile}`);
    return 0;
  }
  const exit = result.status ?? result.signal;
  console.error(`❌ ${script} failed (exit ${exit}) after ${seconds}s`);
  console.error(`--- last ${TAIL_LINES} lines of ${logFile} ---`);
  const excerpt = lines.filter((l) => !WEB_SERVER_LINE.test(l)).slice(-TAIL_LINES);
  console.error(excerpt.join('\n').trimEnd());
  return result.status || 1;
};

process.exit(main());
