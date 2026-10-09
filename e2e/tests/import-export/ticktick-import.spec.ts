import { expect, test } from '../../fixtures/test.fixture';
import { ImportPage } from '../../pages/import.page';
import { waitForPluginAssets } from '../../helpers/plugin-test.helpers';

const HEADER =
  '"Folder Name","List Name","Title","Kind","Tags","Content","Is Check list",' +
  '"Start Date","Due Date","Reminder","Repeat","Priority","Status","Created Time",' +
  '"Completed Time","Order","Timezone","Is All Day","Is Floating","Column Name",' +
  '"Column Order","View Mode","taskId","parentId"';

const row = (cells: {
  list: string;
  title: string;
  content?: string;
  isChecklist?: boolean;
  status?: string;
  id: string;
  parent?: string;
}): string =>
  [
    '',
    cells.list,
    cells.title,
    cells.isChecklist ? 'CHECKLIST' : 'TEXT',
    'errand',
    cells.content ?? '',
    cells.isChecklist ? 'Y' : 'N',
    '',
    '',
    '',
    '',
    '0',
    cells.status ?? '0',
    '2026-09-01T10:00:00+0000',
    '',
    '0',
    'Europe/Berlin',
    'false',
    'false',
    '',
    '',
    'list',
    cells.id,
    cells.parent ?? '',
  ]
    .map((v) => `"${v.replace(/"/g, '""')}"`)
    .join(',');

test.describe('TickTick import plugin', () => {
  test('imports a TickTick CSV backup into a new project', async ({
    page,
    workViewPage,
    projectPage,
    taskPage,
    testPrefix,
  }) => {
    test.setTimeout(90000);
    await workViewPage.waitForTaskList();
    if (!(await waitForPluginAssets(page))) {
      throw new Error('Plugin assets not available — run `npm run plugins:build`');
    }

    const list = `${testPrefix}-Groceries`;
    const csv = [
      '"Date: 2026-10-01+0000"',
      '"Version: 7.1"',
      '"Status: \n0 Normal\n1 Completed\n2 Archived"',
      HEADER,
      row({
        list,
        title: 'Weekly shop',
        id: 'a',
        isChecklist: true,
        content: '▫Milk\n▪Bread',
      }),
      row({ list, title: 'Compare prices', id: 'b', parent: 'a' }),
      row({ list, title: 'Already bought', id: 'c', status: '2' }),
    ].join('\n');

    const importPage = new ImportPage(page);
    await importPage.navigateToImportPage();
    await page.locator('file-imex button', { hasText: 'Import from TickTick' }).click();

    const frame = page.frameLocator('plugin-index iframe');
    await frame.locator('input[type="file"]').setInputFiles({
      name: 'ticktick-backup.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8'),
    });
    await frame.getByRole('button', { name: 'Load preview' }).click();
    await expect(frame.getByText(`${list} — tasks: 1, sub-tasks: 3`)).toBeVisible();
    await frame.getByRole('button', { name: 'Import' }).click();
    await expect(frame.getByRole('heading', { name: 'Import finished' })).toBeVisible({
      timeout: 30000,
    });
    await expect(
      frame.getByText(`${list}: 1 of 1 tasks, 3 of 3 sub-tasks`),
    ).toBeVisible();

    await projectPage.navigateToProjectByName(list);
    const root = taskPage.getTaskByText('Weekly shop').first();
    await expect(root).toBeVisible();
    // `.last()`: the parent task element contains its sub-tasks' text too
    await expect(taskPage.getTaskByText('Milk').last()).toBeVisible();
    await expect(taskPage.getTaskByText('Compare prices').last()).toBeVisible();
    expect(await taskPage.isTaskDone(taskPage.getTaskByText('Bread').last())).toBe(true);
    expect(await taskPage.isTaskDone(taskPage.getTaskByText('Milk').last())).toBe(false);
    await expect(taskPage.getTaskByText('Already bought')).toHaveCount(0);
  });
});
