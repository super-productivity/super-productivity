// Run after npm run electron:build and npm run buildFrontend:prod:es6.
// Uses an isolated profile; quit any app using port 3876 before running.
// Optionally pass a packaged Electron executable as the first argument.
const { _electron: electron, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const profile = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sp-mcp-real-'));
const xdgDir = path.join(profile, 'xdg');
fs.mkdirSync(xdgDir);
let app;
let key;
let id;
const endpoint = 'http://127.0.0.1:3876/mcp';
async function rpc(method, params, headers = {}) {
  // Node fetch replaces Host; use HTTP directly to exercise the rebinding check.
  return new Promise((resolve, reject) => {
    const request = http.request(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          ...headers,
        },
        timeout: 60000,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('error', reject);
        response.on('end', () => {
          try {
            resolve({ status: response.statusCode, body: JSON.parse(body) });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('MCP request timed out')));
    request.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
  });
}
async function call(name, args = {}) {
  const reply = await rpc('tools/call', { name, arguments: args });
  assert.equal(reply.status, 200);
  assert.ok(reply.body.result, 'Expected tool result');
  return reply.body.result;
}
async function waitUntilReady() {
  // expect.poll stops at the first thrown error, and right after a launch or
  // reload the listener or renderer may not answer yet. Returning the message
  // keeps polling and shows the last error if it times out.
  await expect
    .poll(
      async () => {
        try {
          return (await call('get_status')).structuredContent.isReady;
        } catch (error) {
          return error.message;
        }
      },
      { timeout: 60000 },
    )
    .toBe(true);
}
async function launch() {
  app = await electron.launch({
    ...(process.argv[2] ? { executablePath: process.argv[2] } : {}),
    args: [
      ...(process.argv[2] ? [] : ['.']),
      `--user-data-dir=${profile}`,
      '--no-sandbox',
      '--disable-gpu',
    ],
    env: {
      ...process.env,
      NODE_ENV: 'PROD',
      SP_FORCE_LOCAL_REST_API: '0',
      // The single-instance lock is acquired before --user-data-dir is applied.
      XDG_CONFIG_HOME: xdgDir,
      XDG_CACHE_HOME: xdgDir,
      XDG_DATA_HOME: xdgDir,
    },
    timeout: 60000,
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.ea?.getAssistantAccessState);
  await page.evaluate(() => {
    for (const key of [
      'SUP_ONBOARDING_PRESET_DONE',
      'SUP_ONBOARDING_HINTS_DONE',
      'SUP_IS_SHOW_TOUR',
      'SUP_EXAMPLE_TASKS_CREATED',
    ])
      localStorage.setItem(key, 'true');
  });
  return page;
}
(async () => {
  try {
    let page = await launch();
    assert.equal(
      (await page.evaluate(() => window.ea.getAssistantAccessState())).isEnabled,
      false,
    );
    assert.equal(
      (await page.evaluate(() => window.ea.setAssistantAccessEnabled(true))).isListening,
      true,
      'Temporary-profile listener did not bind',
    );
    key = (await page.evaluate(() => window.ea.rotateAssistantAccessCredential()))
      .credential;
    assert.equal(
      (
        await rpc('initialize', {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'smoke', version: '1' },
        })
      ).status,
      200,
    );
    assert.equal((await rpc('ping', {}, { Authorization: 'Bearer wrong' })).status, 401);
    assert.equal((await rpc('ping', {}, { Origin: 'https://example.com' })).status, 403);
    assert.equal((await rpc('ping', {}, { Host: 'example.com' })).status, 403);
    await page.evaluate(() =>
      window.ea.setAssistantAccessScopes(['tasks:read', 'tasks:capture']),
    );
    await waitUntilReady();
    const created = await call('create_task', {
      title: 'MCP smoke #literal',
      notes: 'smoke note',
    });
    assert.equal(created.structuredContent?.status, 'created');
    id = created.structuredContent.id;
    const task = (await call('get_task', { id })).structuredContent.task;
    assert.equal(task.title, 'MCP smoke #literal');
    assert.equal(task.projectId, 'INBOX_PROJECT');
    assert.deepEqual(task.tagIds, []);
    assert.equal(task.notes, undefined);
    assert.equal((await call('get_task', { id, includeNotes: true })).isError, true);
    await page.evaluate(() =>
      window.ea.setAssistantAccessScopes([
        'tasks:read',
        'tasks:read_notes',
        'tasks:capture',
      ]),
    );
    assert.equal(
      (await call('get_task', { id, includeNotes: true })).structuredContent.task.notes,
      'smoke note',
    );
    await page.evaluate(() => window.ea.setLocalRestApiEnabled(true));
    await app.close();
    app = undefined;
    page = await launch();
    await waitUntilReady();
    assert.equal((await fetch('http://127.0.0.1:3876/health')).status, 200);
    assert.equal(
      (await call('get_task', { id })).structuredContent.task.title,
      'MCP smoke #literal',
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].minimize(),
    );
    assert.equal((await call('get_task', { id })).isError, undefined);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
    assert.equal((await call('get_task', { id })).structuredContent.task.id, id);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
    assert.equal((await call('get_task', { id })).structuredContent.task.id, id);
    await page.reload();
    await waitUntilReady();
    assert.equal((await call('get_task', { id })).structuredContent.task.id, id);
    await page.evaluate(() => window.ea.rotateAssistantAccessCredential());
    assert.equal((await rpc('ping', {})).status, 401);
    console.log(
      'PASS: real Electron capture, scopes, auth, persisted dual-switch startup, minimize, hide/show, reload and rotation',
    );
  } finally {
    if (app) await app.close();
    // Late Electron profile writes can cause transient ENOTEMPTY after exit
    // (#10296); async removal retries and picks up newly created files.
    await fs.promises.rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
})().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
