import { test, expect } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getDoneTaskElement,
  getSuperSyncConfig,
  getTaskElement,
  markTaskDone,
  renameTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { serveReleasedClientAssets } from '../../utils/released-client-assets';
import { waitForAppReady, waitForMenuSettled } from '../../utils/waits';

/**
 * A released (v19.1.0) device stores a won't-do marker it does not know as a
 * plain field and never clears it: reopening only clears `doneOn`. A current
 * device finishes a task as won't do, reopens it and completes it; the
 * released device follows each step. Its copy of the completed task still
 * carries the marker, and when it wins a later conflict, its whole-task
 * resolution row brings the marker back to every current device: the
 * completed task shows as won't do there. The marker must be inert on the
 * released device's copy, so the completion survives.
 */

const CROSS = 'done-toggle .done-check--cross';

const setBlockFlags = (): void => {
  const flags = globalThis as typeof globalThis & Record<string, boolean>;
  flags['__SP_E2E_BLOCK_AUTO_SYNC'] = true;
  flags['__SP_E2E_BLOCK_WS_DOWNLOAD'] = true;
  flags['__SP_E2E_BLOCK_IMMEDIATE_UPLOAD'] = true;
};

/** Only explicit syncs run, also after a reload, so the crossing happens in order. */
const blockBackgroundSync = async (client: SimulatedE2EClient): Promise<void> => {
  await client.page.addInitScript(setBlockFlags);
  await client.page.evaluate(setBlockFlags);
};

/**
 * Renames like the title editor does (see `renameTask`), on a released bundle,
 * which exposes no store to read back. A typed but uncommitted title is lost
 * on reload, so the title after one proves the rename became an op.
 */
const renameOnReleased = async (
  client: SimulatedE2EClient,
  from: string,
  to: string,
): Promise<void> => {
  await getTaskElement(client, from).first().locator('task-title').dispatchEvent('click');
  const textarea = client.page.locator('task-title textarea').first();
  await textarea.waitFor({ state: 'visible' });
  await textarea.evaluate((el: HTMLTextAreaElement, name: string) => {
    el.focus();
    el.dispatchEvent(new Event('focus', { bubbles: true }));
    el.value = name;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }, to);
  await expect(textarea).toBeHidden();
  await client.page.reload();
  await waitForAppReady(client.page, { ensureRoute: false });
  await expect(getTaskElement(client, to)).toHaveCount(1);
};

/**
 * Real download, then fail on a sync error or the whole-dataset dialog:
 * `syncAndWait()` would silently pick a side and hide a divergence.
 */
const sync = async (client: SimulatedE2EClient): Promise<void> => {
  const downloaded = client.page.waitForResponse(
    (r) => r.url().includes('/api/sync/ops') && r.request().method() === 'GET',
  );
  await client.sync.clickSyncBtn();
  expect((await downloaded).ok()).toBe(true);
  let outcome = 'pending';
  await expect
    .poll(
      async () => {
        outcome = (await client.sync.conflictDialog.isVisible())
          ? 'conflict-dialog'
          : (await client.sync.hasSyncError())
            ? 'error'
            : !(await client.sync.syncSpinner.isVisible()) &&
                (await client.sync.syncConfirmedIcon.isVisible())
              ? 'in-sync'
              : 'pending';
        return outcome;
      },
      { timeout: 30000 },
    )
    .not.toBe('pending');
  expect(outcome).toBe('in-sync');
};

const finishAsWontDo = async (
  client: SimulatedE2EClient,
  taskName: string,
): Promise<void> => {
  await getTaskElement(client, taskName).first().click({ button: 'right' });
  const menuItem = client.page.locator('.mat-mdc-menu-content button', {
    hasText: "Won't do",
  });
  await menuItem.waitFor({ state: 'visible' });
  await waitForMenuSettled(client.page);
  await menuItem.click();
  await expect(getDoneTaskElement(client, taskName).locator(CROSS)).toHaveCount(1);
};

const reopen = async (client: SimulatedE2EClient, taskName: string): Promise<void> => {
  const task = getDoneTaskElement(client, taskName).first();
  await task.hover();
  await task.locator('done-toggle').click();
  await expect(getDoneTaskElement(client, taskName)).toHaveCount(0);
};

/** Done, and shown as completed rather than won't do. */
const expectCompleted = async (
  client: SimulatedE2EClient,
  taskName: string,
): Promise<void> => {
  const task = getDoneTaskElement(client, taskName);
  await expect(task).toHaveCount(1);
  await expect(task.locator(CROSS)).toHaveCount(0);
};

// Supply the untouched released web assets (COMPAT_OLD_ASSETS, see
// e2e/README.md).
test.describe("@supersync released device beside a reopened won't-do task", () => {
  test.describe.configure({ mode: 'serial' });
  const oldAssets = process.env.COMPAT_OLD_ASSETS;
  test.skip(!oldAssets, 'Set COMPAT_OLD_ASSETS to the unmodified released assets');
  let assets: Awaited<ReturnType<typeof serveReleasedClientAssets>>;
  test.beforeAll(async () => {
    // A free port: other released suites may serve their bundle concurrently.
    assets = await serveReleasedClientAssets({ old: oldAssets!, new: oldAssets! }, 0);
  });
  test.afterAll(async () => assets?.close());

  test("a released device's resolution row keeps a re-completed task completed", async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(300000);
    const appUrl = baseURL || 'http://localhost:4242';
    const taskName = `WontDoReleased-${testRunId}`;
    const clients: SimulatedE2EClient[] = [];
    try {
      const config = getSuperSyncConfig(await createTestUser(testRunId));
      const current = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      clients.push(current);
      await current.sync.setupSuperSync(config);
      await current.workView.addTask(taskName);
      await sync(current);

      const released = await createSimulatedClient(
        browser,
        assets.url,
        'Released',
        testRunId,
        { serviceWorkers: 'block' },
      );
      clients.push(released);
      await released.sync.setupSuperSync(config);
      await sync(released);
      await expect(getTaskElement(released, taskName)).toHaveCount(1);
      for (const client of clients) await blockBackgroundSync(client);

      // Won't do, reopen, complete: the released device takes each step.
      await finishAsWontDo(current, taskName);
      await sync(current);
      await sync(released);
      await reopen(current, taskName);
      await sync(current);
      await sync(released);
      await markTaskDone(current, taskName);
      await expectCompleted(current, taskName);
      await sync(current);
      await sync(released);
      await expect(getDoneTaskElement(released, taskName)).toHaveCount(1);

      // Concurrent renames: the current one reaches the server first, the
      // released one is newer, so the released device resolves the conflict as
      // a local win and uploads its whole task.
      const currentTitle = `${taskName}-current`;
      const releasedTitle = `${taskName}-released`;
      await renameTask(current, taskName, currentTitle);
      await sync(current);
      await renameOnReleased(released, taskName, releasedTitle);
      await sync(released);
      await sync(current);
      await sync(released);

      await expectCompleted(current, releasedTitle);
      await current.page.reload();
      await current.workView.waitForTaskList();
      await expectCompleted(current, releasedTitle);

      // A device joining later reads the same task.
      const fresh = await createSimulatedClient(browser, appUrl, 'C', testRunId);
      clients.push(fresh);
      await fresh.sync.setupSuperSync(config);
      await sync(fresh);
      await expectCompleted(fresh, releasedTitle);
    } finally {
      for (const client of clients) await closeClient(client);
    }
  });
});
