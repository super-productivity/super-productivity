import type { FrameLocator } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { waitForPluginAssets } from '../../helpers/plugin-test.helpers';
import {
  openPlugin,
  serveTurns,
  taskOf,
  todayOf,
  type ToolCall,
  toolStream,
} from '../../helpers/ai-view-builder.helpers';

// An "Add task" button on each board column and agenda day: one Enter is one
// new task that carries what the lane stands for, so it shows up there.

const VIEW: ToolCall[] = [
  { name: 'put_query', input: { id: 'all', props: { scope: 'all' } } },
  // The first part put in becomes the root of the view.
  {
    name: 'put_component',
    input: { id: 'main', props: { type: 'stack', children: ['board', 'week'] } },
  },
  {
    name: 'put_component',
    input: {
      id: 'board',
      props: {
        type: 'board',
        query: 'all',
        columns: [
          { id: 'todo', title: 'To do', notTags: ['@doing'], isDone: false },
          { id: 'doing', title: 'Doing', tags: ['@doing'], isDone: false },
          { id: 'done', title: 'Done', isDone: true },
        ],
      },
    },
  },
  {
    name: 'put_component',
    input: { id: 'week', props: { type: 'agenda', query: 'all', days: 3 } },
  },
  { name: 'set_view', input: { title: 'Lanes' } },
  { name: 'say', input: { text: 'Made a board and an agenda.' } },
];

const nextDay = (day: string): string => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

const openView = async (
  page: Parameters<typeof openPlugin>[0],
): Promise<FrameLocator> => {
  const plugin = await openPlugin(page);
  await plugin.locator('#commandInput').fill('A board and an agenda');
  await plugin.locator('#commandInput').press('Enter');
  await expect(plugin.locator('.board-col')).toHaveCount(3);
  return plugin;
};

test.describe('AI View Builder add task', () => {
  test('adds to a board column with its tag, and not to the done column', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    test.setTimeout(120000);
    await serveTurns(page, [toolStream(VIEW)]);
    expect(await waitForPluginAssets(page)).toBe(true);
    await workViewPage.waitForTaskList();
    const plugin = await openView(page);

    const doing = plugin.locator('.board-col', { hasText: 'Doing' });
    await expect(
      plugin.locator('.board-col', { hasText: 'Done' }).locator('.add-btn'),
    ).toHaveCount(0);
    await doing.getByRole('button', { name: 'Add task' }).click();
    const input = doing.getByRole('textbox', { name: 'New task in Doing' });
    await expect(input).toBeFocused();

    // Enter adds and keeps the input open for the next one.
    const first = `${testPrefix}-Doing one`;
    const second = `${testPrefix}-Doing two`;
    await input.fill(first);
    await input.press('Enter');
    await expect(doing.locator('.card-title', { hasText: first })).toBeVisible();
    await expect(input).toBeFocused();
    await input.fill(second);
    await input.press('Enter');
    await expect(doing.locator('.card-title', { hasText: second })).toBeVisible();

    const added = await taskOf(page, first);
    expect(added?.tagIds).toEqual(['KANBAN_IN_PROGRESS']);

    // Escape closes the input; so does leaving it empty.
    await input.press('Escape');
    await expect(input).toHaveCount(0);
    await doing.getByRole('button', { name: 'Add task' }).click();
    await plugin
      .locator('.board-col', { hasText: 'To do' })
      .locator('.col-title')
      .click();
    await expect(input).toHaveCount(0);
    await expect(doing.getByRole('button', { name: 'Add task' })).toBeVisible();
  });

  test('adds to an agenda day with that day as its due date', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    test.setTimeout(120000);
    await serveTurns(page, [toolStream(VIEW)]);
    expect(await waitForPluginAssets(page)).toBe(true);
    await workViewPage.waitForTaskList();
    const plugin = await openView(page);

    const tomorrow = plugin.locator('.agenda-day', { hasText: 'Tomorrow' });
    await tomorrow.getByRole('button', { name: 'Add task' }).click();
    const title = `${testPrefix}-Tomorrow one`;
    await tomorrow.getByRole('textbox', { name: 'New task in Tomorrow' }).fill(title);
    await tomorrow.getByRole('textbox').press('Enter');
    await expect(tomorrow.locator('.card-title', { hasText: title })).toBeVisible();

    const added = await taskOf(page, title);
    expect(added?.dueDay).toBe(nextDay(await todayOf(page)));
  });
});
