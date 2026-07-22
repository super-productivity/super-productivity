#!/usr/bin/env node

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium, expect } = require('@playwright/test');

const executablePath = process.argv[2];
if (!executablePath || !fs.existsSync(executablePath)) {
  throw new Error(
    `Packaged Electron executable not found: ${executablePath || '<none>'}`,
  );
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-electron-smoke-'));
const xdgDir = path.join(userDataDir, 'xdg');
fs.mkdirSync(xdgDir, { recursive: true });

const getFreePort = async () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a local debugging port'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });

const waitForCdp = async (endpoint, child, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Packaged Electron exited before opening CDP (${child.exitCode ?? child.signalCode})`,
      );
    }
    try {
      const response = await fetch(`${endpoint}/json/version`);
      if (response.ok) return;
      lastError = new Error(`CDP returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for packaged Electron CDP: ${lastError}`);
};

const waitForMainPage = async (browser, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => !candidate.url().startsWith('devtools://'));
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Packaged Electron did not create a renderer window');
};

const stopChild = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 8_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
};

const run = async () => {
  const debuggingPort = await getFreePort();
  const endpoint = `http://127.0.0.1:${debuggingPort}`;
  const child = spawn(
    executablePath,
    [
      `--remote-debugging-port=${debuggingPort}`,
      `--user-data-dir=${userDataDir}`,
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
    ],
    {
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: '1',
        XDG_CONFIG_HOME: xdgDir,
        XDG_CACHE_HOME: xdgDir,
        XDG_DATA_HOME: xdgDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);

  let browser;
  try {
    await waitForCdp(endpoint, child);
    browser = await chromium.connectOverCDP(endpoint);
    const pageErrors = [];
    const observedPages = new WeakSet();
    const observePageErrors = (candidate) => {
      if (observedPages.has(candidate)) return;
      observedPages.add(candidate);
      candidate.on('pageerror', (error) => pageErrors.push(error.message));
    };
    for (const context of browser.contexts()) {
      context.on('page', observePageErrors);
      context.pages().forEach(observePageErrors);
    }
    const page = await waitForMainPage(browser);

    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => {
      localStorage.setItem('SUP_ONBOARDING_PRESET_DONE', 'true');
      localStorage.setItem('SUP_ONBOARDING_HINTS_DONE', 'true');
      localStorage.setItem('SUP_IS_SHOW_TOUR', 'true');
      localStorage.setItem('SUP_EXAMPLE_TASKS_CREATED', 'true');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.route-wrapper').first().waitFor({ state: 'visible' });

    const taskTitle = `Packaged Electron smoke ${Date.now()}`;
    const addTaskInput = page.locator('add-task-bar.global .main-input').first();
    if (!(await addTaskInput.isVisible())) {
      await page.locator('.tour-addBtn').waitFor({ state: 'visible', timeout: 20_000 });
      await page.locator('.tour-addBtn').click();
    }
    await addTaskInput.waitFor({ state: 'visible', timeout: 10_000 });
    await addTaskInput.fill(taskTitle);
    const operationProcessed = page.waitForEvent('console', {
      predicate: (message) =>
        message.text().includes('OperationCaptureService: Processed action'),
      timeout: 20_000,
    });
    await addTaskInput.press('Enter');
    await expect(page.locator('task').filter({ hasText: taskTitle })).toBeVisible({
      timeout: 20_000,
    });

    // Reload proves the renderer can also persist and hydrate the core task.
    // This completion log fires after either the IndexedDB or Electron SQLite
    // backend has finished the operation write and released its lock.
    await operationProcessed;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('task').filter({ hasText: taskTitle })).toBeVisible({
      timeout: 20_000,
    });

    const overlayMessage = 'Packaged # path & fragment = decoded';
    const overlayPagePromise = page.context().waitForEvent('page', {
      timeout: 20_000,
    });
    await page.evaluate((msg) => {
      window.ea.showFullScreenBlocker({
        msg,
        takeABreakCfg: {
          motivationalImgs: [],
          timedFullScreenBlockerDuration: 60_000,
        },
      });
    }, overlayMessage);
    const overlayPage = await overlayPagePromise;
    await overlayPage.waitForLoadState('domcontentloaded');
    await expect(overlayPage.locator('#msg')).toHaveText(overlayMessage);
    expect(overlayPage.url()).toContain('%23%20packaged%20app');

    if (pageErrors.length) {
      throw new Error(`Renderer page errors:\n${pageErrors.join('\n')}`);
    }
    console.log('Packaged Electron task-create, reload, and overlay smoke passed.');
  } finally {
    await browser?.close().catch(() => undefined);
    await stopChild(child);
  }
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });
