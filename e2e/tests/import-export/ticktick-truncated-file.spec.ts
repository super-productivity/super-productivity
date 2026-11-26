import { expect, test } from '../../fixtures/test.fixture';
import { ImportPage } from '../../pages/import.page';

test.describe('TickTick malformed file import', () => {
  test.setTimeout(90000);
  test('TickTick rejects a truncated quoted field before offering an import', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await new ImportPage(page).navigateToImportPage();
    await page.locator('file-imex button', { hasText: 'Import from TickTick' }).click();
    const frame = page.frameLocator('plugin-index iframe');
    const csv =
      'List Name,Title,Content,Status\nWork,Valid task,Notes,0\nWork,"Truncated task\nWork,Another task,Notes,0';
    const input = frame.locator('input[type="file"]');
    await input.setInputFiles({
      name: 'truncated.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });
    await frame.getByRole('button', { name: 'Load preview' }).click();
    const importButton = frame.getByRole('button', { name: 'Import', exact: true });
    await expect
      .poll(
        async () =>
          (await frame.getByRole('alert').isVisible()) ||
          (await importButton.isVisible()),
      )
      .toBe(true);
    if (await importButton.isVisible()) {
      await importButton.click();
      await expect(frame.getByRole('heading', { name: 'Import finished' })).toBeVisible();
    }
    const taskCount = await page.evaluate(() => {
      const helpers = (
        window as unknown as {
          __e2eTestHelpers: {
            store: {
              subscribe: (next: (state: { tasks: { ids: string[] } }) => void) => {
                unsubscribe: () => void;
              };
            };
          };
        }
      ).__e2eTestHelpers;
      let count = -1;
      helpers.store
        .subscribe((state) => {
          count = state.tasks.ids.length;
        })
        .unsubscribe();
      return count;
    });
    expect(taskCount).toBe(0);
    await expect(frame.getByRole('alert')).toBeVisible();
    await expect(importButton).toHaveCount(0);
  });
});
