import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import {
  createView,
  expandViewSection,
  openViewEditor,
  readBoard,
  saveViewEditor,
  setViewSort,
  viewEditorSection,
} from '../../utils/view-helpers';

/**
 * #11388: a manual reorder in a view section (`updatePanelCfgTaskIds`,
 * declared on the panel id) and a concurrent view-editor save
 * (`updateBoard` with `panels`, declared on the board id) never conflict.
 * The save carries the section's `taskIds` as its device last saw them, so a
 * device that applied the reorder first and the save second lost the reorder,
 * while the other device kept it. Both devices must end with the reorder and
 * the edit, in either sync order.
 */

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

/** The first section of the open view. */
const mainSection = (page: Page): Locator => page.locator('boards board-panel').first();

/**
 * This test's tasks in the first section, in the order shown, by the name
 * they end with (`addTask` prefixes the client's name).
 */
const shownOrder = async (page: Page, testRunId: string): Promise<string[]> =>
  (await mainSection(page).locator('task task-title').allInnerTexts())
    .map((title) => title.trim())
    .filter((title) => title.includes(testRunId))
    .map((title) => title.slice(title.lastIndexOf('-') + 1));

/** Moves a task one row up in the first section, as the keyboard does. */
const moveUp = async (page: Page, title: string): Promise<void> => {
  await mainSection(page).locator('task').filter({ hasText: title }).first().focus();
  await page.keyboard.press('Control+Shift+ArrowUp');
};

/** Renames the first section in the view editor. */
const renameMainSection = async (page: Page, title: string): Promise<void> => {
  const dialog = await openViewEditor(page);
  const section = viewEditorSection(dialog, 0);
  await expandViewSection(section);
  await section.getByRole('textbox', { name: /^(Section|Column) title$/ }).fill(title);
  await saveViewEditor(dialog);
};

const readMainSection = async (
  page: Page,
  viewId: string,
): Promise<{ title?: string; taskIds?: string[] } | undefined> =>
  (await readBoard(page, viewId))?.panels[0] as
    | { title?: string; taskIds?: string[] }
    | undefined;

test.describe('@supersync view manual order vs view edit (#11388)', () => {
  for (const firstToSync of ['reordering', 'editing'] as const) {
    test(`a reorder and a concurrent section edit both survive (${firstToSync} client syncs first)`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      test.setTimeout(240000);
      const appUrl = baseURL || 'http://localhost:4242';
      const [t1, t2, t3] = ['T1', 'T2', 'T3'];
      const titled = (name: string): string => `${testRunId}-${name}`;
      const clients: SimulatedE2EClient[] = [];
      try {
        const config = getSuperSyncConfig(await createTestUser(testRunId));
        const a = await createSimulatedClient(browser, appUrl, 'A', testRunId);
        clients.push(a);
        await a.sync.setupSuperSync(config);

        await a.page.goto('/#/project/INBOX_PROJECT/tasks');
        await a.workView.waitForTaskList();
        for (const name of [t1, t2, t3]) await a.workView.addTask(titled(name));

        // A manual section with a stored order, and a second section so the
        // first one's title shows and can be edited.
        await createView(a.page, {
          title: `View-${testRunId}`,
          sections: [
            { title: 'Main', sort: 'Created' },
            { title: 'Other', rules: [{ rule: 'Priority', value: 'High' }] },
          ],
        });
        const viewId = a.page.url().match(/#\/boards\/([^/?]+)/)?.[1] ?? '';
        expect(viewId).not.toBe('');
        await expect.poll(() => shownOrder(a.page, testRunId)).toEqual([t1, t2, t3]);
        const editor = await openViewEditor(a.page);
        await setViewSort(a.page, viewEditorSection(editor, 0), 'Manual');
        await saveViewEditor(editor);
        await moveUp(a.page, titled(t2));
        await expect.poll(() => shownOrder(a.page, testRunId)).toEqual([t2, t1, t3]);
        await a.sync.syncAndWait();

        const b = await createSimulatedClient(browser, appUrl, 'B', testRunId);
        clients.push(b);
        await b.sync.setupSuperSync(config);
        await b.sync.syncAndWait();
        await b.page.goto(`/#/boards/${viewId}`);
        await expect.poll(() => shownOrder(b.page, testRunId)).toEqual([t2, t1, t3]);
        for (const client of clients) await blockBackgroundSync(client);

        // A reorders, B edits the same section; neither has synced.
        await moveUp(a.page, titled(t3));
        await expect.poll(() => shownOrder(a.page, testRunId)).toEqual([t2, t3, t1]);
        await renameMainSection(b.page, 'Main-B');
        await expect(mainSection(b.page)).toContainText('Main-B');

        const [first, second] = firstToSync === 'reordering' ? [a, b] : [b, a];
        await first.sync.syncAndWait();
        await second.sync.syncAndWait();
        await first.sync.syncAndWait();

        const expected = await readMainSection(a.page, viewId);
        expect(expected?.title).toBe('Main-B');
        for (const client of clients) {
          await client.page.goto(`/#/boards/${viewId}`);
          await expect(mainSection(client.page)).toContainText('Main-B');
          await expect
            .poll(() => shownOrder(client.page, testRunId))
            .toEqual([t2, t3, t1]);
          expect(await readMainSection(client.page, viewId)).toEqual(
            expect.objectContaining({ title: 'Main-B', taskIds: expected?.taskIds }),
          );
        }
      } finally {
        for (const client of clients) await closeClient(client);
      }
    });
  }
});
