import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getLocalOpLogSummary,
  getSuperSyncConfig,
  isFullStateOpType,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { serveReleasedClientAssets } from '../../utils/released-client-assets';
import { waitForMenuSettled } from '../../utils/waits';
import { createView, readBoard, toggleViewLayout } from '../../utils/view-helpers';

/**
 * Saved views store new optional fields (`dueState`, `priorityRule`,
 * `sortKey`, `isUntagged`, `boardCols`) on boards that released clients
 * (v19.1.0) edit in their own board form, which sends the whole board. Their
 * edits must keep every field they don't know, and neither client may need a
 * repair or the whole-dataset dialog for them.
 */

const EISENHOWER = 'EISENHOWER_MATRIX';

const setBlockFlags = (): void => {
  const flags = globalThis as typeof globalThis & Record<string, boolean>;
  flags['__SP_E2E_BLOCK_AUTO_SYNC'] = true;
  flags['__SP_E2E_BLOCK_WS_DOWNLOAD'] = true;
  flags['__SP_E2E_BLOCK_IMMEDIATE_UPLOAD'] = true;
};

/** Only explicit syncs run, so the edits cross in the order the test sets. */
const blockBackgroundSync = async (client: SimulatedE2EClient): Promise<void> => {
  await client.page.addInitScript(setBlockFlags);
  await client.page.evaluate(setBlockFlags);
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

/** Repair, sync and backup imports in the client's op log. */
const fullStateOpCount = async (page: Page): Promise<number> =>
  (await getLocalOpLogSummary(page)).filter((op) => isFullStateOpType(op.opType)).length;

/**
 * Opens the released client's board form for a board: its Boards page shows
 * one tab per board, and the tab's context menu has "Edit".
 */
const openReleasedBoardForm = async (
  released: SimulatedE2EClient,
  appUrl: string,
  tabTitle: string,
): Promise<Locator> => {
  const page = released.page;
  await page.goto(`${appUrl}/#/boards`);
  const tab = page.locator('.mat-mdc-tab').filter({ hasText: tabTitle });
  await expect(tab).toHaveCount(1);
  await tab.click({ button: 'right' });
  const edit = page.locator('.mat-mdc-menu-content button', { hasText: 'Edit' });
  await edit.waitFor({ state: 'visible' });
  await waitForMenuSettled(page);
  await edit.click();
  const dialog = page.locator('dialog-board-edit');
  await expect(dialog).toBeVisible();
  return dialog;
};

/** The board form's own title and column count (panels have titles too). */
const boardTitleInput = (dialog: Locator): Locator =>
  dialog.locator('formly-form input:not([type=number])').first();
const boardColsInput = (dialog: Locator): Locator =>
  dialog.locator('formly-form input[type=number]').first();

/** Renames a board in the released client's form and saves it. */
const renameOnReleased = async (
  released: SimulatedE2EClient,
  appUrl: string,
  tabTitle: string,
  title: string,
): Promise<void> => {
  const dialog = await openReleasedBoardForm(released, appUrl, tabTitle);
  await boardTitleInput(dialog).fill(title);
  await dialog.locator('mat-dialog-actions button', { hasText: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    released.page.locator('.mat-mdc-tab').filter({ hasText: title }),
  ).toHaveCount(1);
};

/** What the released client's form shows for a board (it has no test store). */
const readOnReleased = async (
  released: SimulatedE2EClient,
  appUrl: string,
  tabTitle: string,
): Promise<{ title: string; cols: number }> => {
  const dialog = await openReleasedBoardForm(released, appUrl, tabTitle);
  const shown = {
    title: await boardTitleInput(dialog).inputValue(),
    cols: Number(await boardColsInput(dialog).inputValue()),
  };
  await dialog.locator('mat-dialog-actions button', { hasText: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  return shown;
};

/** The view's rules as the current client created them. */
const expectRulesKept = async (page: Page, viewId: string): Promise<void> => {
  const view = await readBoard(page, viewId);
  const [due, untagged] = (view?.panels ?? []) as Record<string, unknown>[];
  expect(due).toEqual(
    expect.objectContaining({
      title: 'Due',
      dueState: 'today',
      // The "scheduled" a date rule implies, for released clients.
      scheduledState: 2,
      priorityRule: '3',
      sortKey: 'priority',
    }),
  );
  expect(untagged).toEqual(
    expect.objectContaining({ title: 'Loose', isUntagged: true, sortKey: 'priority' }),
  );
  // `sortBy` wins over `sortKey`: the released form must not have set one.
  for (const panel of [due, untagged]) expect(panel.sortBy ?? null).toBeNull();
  expect(view?.cols).toBe(1);
};

// Supply the untouched released web assets (COMPAT_OLD_ASSETS, see
// e2e/README.md).
test.describe('@supersync released views compatibility', () => {
  test.describe.configure({ mode: 'serial' });
  const oldAssets = process.env.COMPAT_OLD_ASSETS;
  test.skip(!oldAssets, 'Set COMPAT_OLD_ASSETS to the unmodified released assets');
  let assets: Awaited<ReturnType<typeof serveReleasedClientAssets>>;
  test.beforeAll(async () => {
    // A free port: other released suites may serve their bundle concurrently.
    assets = await serveReleasedClientAssets({ old: oldAssets!, new: oldAssets! }, 0);
  });
  test.afterAll(async () => assets?.close());

  test('a released board form keeps the rules and list mode of views', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(300000);
    const appUrl = baseURL || 'http://localhost:4242';
    const viewTitle = `View-${testRunId}`;
    const clients: SimulatedE2EClient[] = [];
    try {
      const config = getSuperSyncConfig(await createTestUser(testRunId));
      const current = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      clients.push(current);
      await current.sync.setupSuperSync(config);

      // A list with rules only this release knows, sorted by priority.
      await createView(current.page, {
        title: viewTitle,
        sections: [
          {
            title: 'Due',
            rules: [
              { rule: 'Planned Date', value: 'Today' },
              { rule: 'Priority', value: 'High' },
            ],
            sort: 'Priority',
          },
          { title: 'Loose', rules: [{ rule: 'Without tags' }], sort: 'Priority' },
        ],
      });
      const viewId = current.page.url().match(/#\/boards\/([^/?]+)/)?.[1] ?? '';
      expect(viewId).not.toBe('');
      await expectRulesKept(current.page, viewId);
      // The Eisenhower Matrix as a list remembers its 2 columns.
      await current.page.goto(`/#/boards/${EISENHOWER}`);
      await expect(current.page.locator('boards board-panel')).toHaveCount(4);
      await toggleViewLayout(current.page);
      expect(await readBoard(current.page, EISENHOWER)).toEqual(
        expect.objectContaining({ cols: 1, boardCols: 2 }),
      );
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
      for (const client of clients) await blockBackgroundSync(client);
      const fullStateOpsBefore = await Promise.all(
        clients.map((client) => fullStateOpCount(client.page)),
      );

      // The released form sends the whole board on save.
      const renamed = `${viewTitle}-released`;
      await renameOnReleased(released, assets.url, viewTitle, renamed);
      await renameOnReleased(
        released,
        assets.url,
        'Eisenhower Matrix',
        'Matrix-released',
      );
      await sync(released);
      await sync(current);

      expect((await readBoard(current.page, viewId))?.title).toBe(renamed);
      await expectRulesKept(current.page, viewId);
      expect(await readBoard(current.page, EISENHOWER)).toEqual(
        expect.objectContaining({ title: 'Matrix-released', cols: 1, boardCols: 2 }),
      );
      // Still a list, now with its released title.
      await current.page.goto(`/#/boards/${viewId}`);
      await expect(current.page.locator('boards board')).toHaveClass(/isListLayout/);
      await expect(current.page.locator('boards board-panel')).toHaveCount(2);

      // Both edit the view before syncing: the current client makes it a board,
      // the released one renames it again. Both end up with the same board.
      await toggleViewLayout(current.page);
      expect((await readBoard(current.page, viewId))?.cols).toBe(2);
      await renameOnReleased(released, assets.url, renamed, `${renamed}-again`);
      await sync(released);
      await sync(current);
      await sync(released);
      await sync(current);

      const converged = await readBoard(current.page, viewId);
      expect([renamed, `${renamed}-again`]).toContain(converged?.title);
      expect(await readOnReleased(released, assets.url, converged?.title ?? '')).toEqual({
        title: converged?.title,
        cols: converged?.cols,
      });
      const [due, untagged] = (converged?.panels ?? []) as Record<string, unknown>[];
      expect(due).toEqual(
        expect.objectContaining({
          dueState: 'today',
          priorityRule: '3',
          sortKey: 'priority',
        }),
      );
      expect(untagged).toEqual(
        expect.objectContaining({ isUntagged: true, sortKey: 'priority' }),
      );

      // No repair or import on either client, and no dialog left open.
      expect(
        await Promise.all(clients.map((client) => fullStateOpCount(client.page))),
      ).toEqual(fullStateOpsBefore);
      for (const client of clients) {
        await expect(client.page.locator('mat-dialog-container')).toHaveCount(0);
      }
    } finally {
      for (const client of clients) await closeClient(client);
    }
  });
});
