// Run after npm run buildFrontend:dev and npm run electron:build.
const { _electron: electron, expect: playwrightExpect } = require('@playwright/test');
const { spawnSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const TRACKED_TASK = 'Track after Finish Day';
const DONE_TASK = 'Done before the first quit';
const FINISH_DAY_STEP = 'FINISH_DAY_BEFORE_CLOSE_EFFECT';
const MIN_TRACKED_MS = 3000;
const expect = playwrightExpect.configure({ timeout: 10000 });

const task = (page, title) => page.locator('task').filter({ hasText: title });
const readTask = (page, title) =>
  page.evaluate((taskTitle) => {
    let match;
    window.__e2eTestHelpers.store
      .subscribe(({ tasks }) => {
        match = Object.values(tasks.entities).find((task) => task?.title === taskTitle);
      })
      .unsubscribe();
    return match;
  }, title);

const addTask = async (page, title) => {
  const input = page.locator('add-task-bar.global .main-input').first();
  if (!(await input.isVisible())) {
    await page.keyboard.press('Shift+A');
  }
  await input.fill(title);
  await input.press('Enter');
  await expect(task(page, title)).toBeVisible();
};

const stopTestProcess = async (app) => {
  const child = app?.process();
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    if (process.platform === 'win32') {
      const stopped = spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        encoding: 'utf8',
      });
      if (stopped.error) throw stopped.error;
      // The process may have just exited on its own.
      if (stopped.status !== 0 && child.kill(0)) {
        throw new Error(stopped.stderr.trim());
      }
    } else {
      child.kill();
    }
    await exited;
  }
};

async function run() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-finish-day-quit-'));
  let app;
  try {
    const launch = async () => {
      app = await electron.launch({
        args: ['.', `--user-data-dir=${profile}`, '--disable-gpu', '--lang=en-US'],
        env: { ...process.env, NODE_ENV: 'PROD' },
      });
      const page = await app.firstWindow();
      page.setDefaultTimeout(15000);
      await page.waitForFunction(() => !!window.__e2eTestHelpers, undefined, {
        timeout: 30000,
      });
      return page;
    };
    const page = await launch();
    await page.evaluate(() => {
      localStorage.setItem('SUP_ONBOARDING_PRESET_DONE', 'true');
      localStorage.setItem('SUP_ONBOARDING_HINTS_DONE', 'true');
      localStorage.setItem('SUP_IS_SHOW_TOUR', 'true');
      localStorage.setItem('SUP_EXAMPLE_TASKS_CREATED', 'true');
    });
    await Promise.all([
      page.waitForEvent('console', {
        predicate: (message) => message.text().includes('[SP_ALL] All Data was loaded'),
        timeout: 30000,
      }),
      page.goto(pathToFileURL(path.resolve('.tmp/angular-dist/browser/index.html')).href),
    ]);
    await page.waitForFunction(() => !!window.__e2eTestHelpers);
    await page.evaluate(() => {
      const { store } = window.__e2eTestHelpers;
      for (const [sectionKey, sectionCfg] of [
        ['appFeatures', { isFinishDayEnabled: true }],
        ['misc', { isConfirmBeforeExitWithoutFinishDay: true, isMinimizeToTray: false }],
      ]) {
        store.dispatch({
          type: '[Global Config] Update Global Config Section',
          sectionKey,
          sectionCfg,
          isSkipSnack: true,
        });
      }
      window.closeRequests = [];
      window.ea.on('NOTIFY_ON_CLOSE', (ids) => window.closeRequests.push(ids));
    });

    await addTask(page, DONE_TASK);
    await addTask(page, TRACKED_TASK);
    await page.keyboard.press('Escape');
    const done = task(page, DONE_TASK);
    await done.hover();
    await done.locator('done-toggle').click();
    await expect.poll(async () => (await readTask(page, DONE_TASK))?.isDone).toBe(true);
    await page.evaluate(() => window.__e2eTestHelpers.flushPendingWrites());

    const browserWindow = await app.browserWindow(page);
    const prompt = page.locator('dialog-finish-day-before-close');
    await browserWindow.evaluate((window) => window.close());
    await expect(prompt).toBeVisible();
    await browserWindow.evaluate((window) => window.close());
    await expect
      .poll(() => page.evaluate(() => window.closeRequests))
      .toEqual([[FINISH_DAY_STEP], [FINISH_DAY_STEP]]);
    await prompt.locator('[e2e="finishDayBtn"]').click();
    await expect(page).toHaveURL(/daily-summary/);
    await page.evaluate(() => history.back());
    await expect(page).toHaveURL(/\/tasks$/);

    const tracked = await readTask(page, TRACKED_TASK);
    await page.evaluate((id) => {
      window.__e2eTestHelpers.store.dispatch({ type: '[Task] SetCurrentTask', id });
    }, tracked.id);
    await expect
      .poll(async () => (await readTask(page, TRACKED_TASK))?.timeSpent)
      .toBeGreaterThanOrEqual(MIN_TRACKED_MS);
    await browserWindow.evaluate((window) => window.close());
    await expect(prompt).toBeVisible();
    await Promise.all([
      page.waitForEvent('close', { timeout: 15000 }),
      prompt.getByRole('button', { name: 'Quit', exact: true }).click(),
    ]);
    // The app has closed its window. The test debugger can keep its process
    // alive on Windows, so stop that process before reopening the profile.
    await stopTestProcess(app);

    const reopened = await launch();
    await expect
      .poll(async () => (await readTask(reopened, TRACKED_TASK))?.timeSpent)
      .toBeGreaterThanOrEqual(MIN_TRACKED_MS);
    console.log('Time tracked after choosing Finish Day survived the next quit.');
  } finally {
    await stopTestProcess(app);
    await fs.rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 12,
      retryDelay: 500,
    });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
