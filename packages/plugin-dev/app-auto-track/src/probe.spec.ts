import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProbeScript, parseProbeResult } from './probe';

test('parseProbeResult: first line is the app, the rest the title', () => {
  assert.deepEqual(parseProbeResult({ stdout: 'Code\r\nmain.ts — repo\r\n' }), {
    kind: 'sample',
    sample: { app: 'Code', title: 'main.ts — repo' },
  });
  assert.deepEqual(parseProbeResult({ stdout: 'Finder\n' }), {
    kind: 'sample',
    sample: { app: 'Finder', title: '' },
  });
});

test('parseProbeResult: unsupported and error shapes', () => {
  assert.deepEqual(parseProbeResult({ unsupported: true }), { kind: 'unsupported' });
  assert.deepEqual(parseProbeResult({ error: 'ETIMEDOUT' }), {
    kind: 'error',
    code: 'ETIMEDOUT',
  });
  assert.deepEqual(parseProbeResult(undefined), { kind: 'error', code: 'NO_OUTPUT' });
});

test('buildProbeScript: embeds the PowerShell as UTF-16LE base64', () => {
  const b64 = /'-EncodedCommand', "([A-Za-z0-9+/=]+)"/.exec(buildProbeScript())?.[1];
  assert.ok(b64);
  const decoded = Buffer.from(b64, 'base64').toString('utf16le');
  assert.match(decoded, /GetForegroundWindow/);
  assert.match(decoded, /sp-app-auto-track-v1\.dll/);
});

test('buildProbeScript: is valid async code and reports unsupported off mac/windows', async () => {
  if (process.platform === 'darwin' || process.platform === 'win32') return;
  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
  const result = await new AsyncFunction('require', buildProbeScript())(require);
  assert.equal(parseProbeResult(result).kind, 'unsupported');
});
