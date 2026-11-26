#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Runs the eval cases in eval/cases.json against the real API and reports
 * validity, expected matches and latency per model. Needs ANTHROPIC_API_KEY.
 * Every run makes real, billed requests.
 *
 *   ANTHROPIC_API_KEY=... npm run eval
 *   EVAL_MODELS=claude-sonnet-5-5 npm run eval
 */
const path = require('path');
const { execFileSync } = require('child_process');
const { buildSync } = require('esbuild');

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Set ANTHROPIC_API_KEY to run the eval. Each run makes billed requests.');
  process.exit(1);
}

const ROOT_DIR = path.join(__dirname, '..');
const outfile = path.join(ROOT_DIR, 'dist-test', 'eval.js');
buildSync({
  entryPoints: [path.join(ROOT_DIR, 'src', 'eval', 'run.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  logLevel: 'warning',
});
try {
  execFileSync(process.execPath, [outfile, path.join(ROOT_DIR, 'eval', 'cases.json')], {
    stdio: 'inherit',
  });
} catch {
  process.exit(1);
}
