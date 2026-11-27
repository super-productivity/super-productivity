import { _electron, expect, test, ElectronApplication, Page } from '@playwright/test';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

interface Backup {
  data: {
    task: {
      ids: string[];
      entities: Record<
        string,
        { timeSpent: number; timeSpentOnDay: Record<string, number> }
      >;
    };
  };
}

const exportBackup = async (
  app: ElectronApplication,
  page: Page,
  directory: string,
): Promise<Backup> => {
  await page.evaluate(() => (location.hash = '/config'));
  await page
    .locator('mat-tab-header [role=tab]')
    .filter({ hasText: 'cloud_sync' })
    .click();
  const section = page.locator('collapsible').filter({ hasText: 'Import/Export' });
  const exportButton = section.getByRole('button', { name: 'Export Data', exact: true });
  if (!(await exportButton.isVisible())) {
    await section.locator('.collapsible-header').click();
  }
  const file = path.join(directory, `export-${Date.now()}.json`);
  await app.evaluate(({ session }, target) => {
    session.defaultSession.once('will-download', (_event, item) =>
      item.setSavePath(target),
    );
  }, file);
  await exportButton.click();
  await expect
    .poll(() =>
      readFile(file, 'utf8')
        .then(JSON.parse)
        .catch(() => null),
    )
    .not.toBeNull();
  return JSON.parse(await readFile(file, 'utf8')) as Backup;
};

test('resume before the next tracking tick preserves work recorded before sleep', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sp-electron-resume-'));
  const profile = path.join(directory, 'profile');
  let app: ElectronApplication | undefined;
  let latestPage: Page | undefined;
  // Renderer-side output never reaches the Playwright report; keep it so a
  // CI-only failure says what the app showed when the assertion failed.
  const rendererLog: string[] = [];
  const launch = async (): Promise<Page> => {
    app = await _electron.launch({
      executablePath: process.env.ELECTRON_PATH,
      args: [
        path.resolve(__dirname, '../..'),
        `--user-data-dir=${profile}`,
        '--no-sandbox',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--ozone-platform=x11',
      ],
      env: { ...process.env, NODE_ENV: 'PROD', LIBGL_ALWAYS_SOFTWARE: '1' },
    });
    const page = await app.firstWindow();
    latestPage = page;
    page.on('console', (message) =>
      rendererLog.push(`[${message.type()}] ${message.text()}`),
    );
    page.on('pageerror', (error) => rendererLog.push(`[pageerror] ${error.message}`));
    page.on('dialog', (dialog) => void dialog.accept());
    return page;
  };
  const quit = async (): Promise<void> => {
    const closingApp = app!;
    const electronProcess = closingApp.process();
    // Wait for the process itself, not Playwright's "close": that one fires only
    // after every stdio pipe inherited by a child process closes.
    const exited = new Promise<void>((resolve) => {
      if (electronProcess.exitCode !== null) {
        resolve();
        return;
      }
      electronProcess.once('exit', () => resolve());
    });
    await closingApp.evaluate(({ app: electronApp }) => {
      setTimeout(() => electronApp.quit(), 0);
    });
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 15_000))]);
    expect(
      electronProcess.exitCode,
      'the app did not finish quitting; killing it here would hide tracked time lost in the quit flush',
    ).not.toBeNull();
    // A child that outlived the app keeps the inherited pipes open, so drop our
    // ends before asking Playwright to release the app.
    electronProcess.stdout?.destroy();
    electronProcess.stderr?.destroy();
    const released = await Promise.race([
      closingApp.close().then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10_000)),
    ]);
    expect(released, 'Playwright did not release the app after it quit').toBe(true);
    app = undefined;
  };

  try {
    let page = await launch();
    // `firstWindow()` can hand back the window's initial empty document; wait for
    // the loaded page before touching it, or the evaluate races the navigation
    // and dies with "Execution context was destroyed".
    await page.waitForURL(/(index\.html|^https?:\/\/)/);
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => {
      for (const key of [
        'SUP_ONBOARDING_PRESET_DONE',
        'SUP_ONBOARDING_HINTS_DONE',
        'SUP_IS_SHOW_TOUR',
        'SUP_EXAMPLE_TASKS_CREATED',
      ]) {
        localStorage.setItem(key, 'true');
      }
    });
    // Installed before the reload, so every app timer runs on the controllable
    // clock. Time flows normally until the test pauses it.
    await page.clock.install();
    await page.reload();
    await page.locator('task-list').first().waitFor();
    await expect(page.locator('.loading-full-page-wrapper')).not.toBeVisible();
    const input = page.locator('add-task-bar.global .main-input');
    if (!(await input.isVisible())) await page.locator('.tour-addBtn').click();
    await input.fill('Synthetic resume regression');
    await page.locator('.e2e-add-task-submit').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('task')).toHaveCount(1);
    // Take the id from the row the test just created. `backup.data.task.ids[0]`
    // is not necessarily that task: on a clean install the app can add its own
    // sample tasks before the first reload, and the store order is not the list
    // order, which made the imported row unfindable on the slower CI runner.
    const idFromRow = await page.locator('task').first().getAttribute('data-task-id');
    expect(idFromRow, 'the created task row has no id').not.toBeNull();
    const id = idFromRow as string;
    const backup = await exportBackup(app!, page, directory);
    expect(
      backup.data.task.entities[id],
      'the exported backup is missing that task',
    ).toBeDefined();
    const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
    const previousWork = 2 * 60 * 60 * 1000;
    backup.data.task.entities[id].timeSpent = previousWork;
    backup.data.task.entities[id].timeSpentOnDay = { [today]: previousWork };
    const seed = path.join(directory, 'seed.json');
    await writeFile(seed, JSON.stringify(backup));
    const imported = page.waitForEvent('console', {
      predicate: (message) => message.text().includes('Load(import) all data'),
    });
    await page.locator('file-imex input[type=file]').setInputFiles(seed);
    await imported;
    await expect(page.locator('.loading-full-page-wrapper')).not.toBeVisible();
    await page.evaluate(() => (location.hash = '/tag/TODAY/tasks'));
    const task = page.locator(`[data-task-id="${id}"]`);
    await task.hover();
    await task.locator('.start-task-btn').click();
    await expect(task).toHaveClass(/isCurrent/);
    // Let ordinary second ticks establish active tracking before the sleep gap.
    await page.waitForTimeout(1500);

    // Renderer timers don't run during a real sleep. Pause them, so no ordinary
    // tick can credit the gap before the resume IPC arrives, then move the
    // renderer's wall clock past the sleep without firing any timer.
    const sleepMs = 10 * 60 * 1000;
    const pausedAt = (await page.evaluate(() => Date.now())) + 1000;
    await page.clock.pauseAt(pausedAt);
    await page.clock.setSystemTime(pausedAt + sleepMs);

    // Exercise the real main-process power listeners and renderer IPC, not a
    // mocked idle service. Only this app's clocks move; the host never suspends.
    await app!.evaluate(({ powerMonitor }, gapMs) => {
      powerMonitor.emit('suspend');
      const originalNow = Date.now;
      Date.now = () => originalNow() + gapMs;
      try {
        powerMonitor.emit('resume');
      } finally {
        Date.now = originalNow;
      }
    }, sleepMs);
    // Idle entry subtracts the idle time and stops tracking before it opens the
    // dialog, so an attached dialog means the race has played out. Its opening
    // animation needs timers, so resume the clock before interacting with it.
    const idleDialog = page.locator('dialog-idle');
    await idleDialog.waitFor({ state: 'attached' });
    await page.clock.resume();
    await idleDialog.getByRole('button', { name: /Don.t track/i }).click();
    const afterResume = await exportBackup(app!, page, directory);
    const after = afterResume.data.task.entities[id].timeSpent;
    expect(after).toBeGreaterThanOrEqual(previousWork);
    expect(after).toBeLessThan(previousWork + 15_000);

    await quit();
    page = await launch();
    await page.locator('task-list').first().waitFor();
    const restarted = await exportBackup(app!, page, directory);
    expect(restarted.data.task.entities[id].timeSpent).toBe(after);
    await quit();
  } finally {
    // The main process logs which before-close holds it waits for, and the
    // profile is about to be deleted. Keep the log for the artifact; it cannot
    // be gated on testInfo.status, which still reads "passed" while an error is
    // unwinding.
    const logCopy = test.info().outputPath('electron-main.log');
    await mkdir(path.dirname(logCopy), { recursive: true }).catch(() => {});
    await copyFile(path.join(profile, 'logs', 'main.log'), logCopy).catch(() => {});
    const pageAtEnd = latestPage;
    if (pageAtEnd) {
      const pageState = await Promise.race([
        pageAtEnd
          .evaluate(() => ({
            url: location.href,
            tasks: document.querySelectorAll('task').length,
            body: (document.body.innerText || '').slice(0, 2_000),
          }))
          .catch((error: unknown) => ({ error: String(error) })),
        new Promise((resolve) =>
          setTimeout(() => resolve({ error: 'timed out' }), 5_000),
        ),
      ]);
      rendererLog.push(
        '--- page state at the end ---',
        JSON.stringify(pageState, null, 2),
      );
    }
    await writeFile(
      path.join(path.dirname(logCopy), 'renderer.log'),
      rendererLog.join('\n'),
    ).catch(() => {});
    if (app) {
      const electronProcess = app.process();
      const closed = app.waitForEvent('close').catch(() => {});
      // A wedged main process never answers, so bound the exit request too.
      await Promise.race([
        app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ]);
      await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 5_000))]);
      if (electronProcess.exitCode === null) {
        electronProcess.kill('SIGKILL');
      }
    }
    // Electron's child processes can still write to the profile after the main
    // process exits; retry like e2e/electron/packaged-app-smoke.cjs does.
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
