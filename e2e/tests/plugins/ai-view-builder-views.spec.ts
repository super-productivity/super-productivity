import path from 'node:path';
import { expect, test } from '../../fixtures/test.fixture';
import { waitForPluginAssets } from '../../helpers/plugin-test.helpers';
import {
  columnCards,
  dragTo,
  openPlugin,
  serveTurns,
  tagsOf,
  toolStream,
  ToolCall,
} from '../../helpers/ai-view-builder.helpers';

const OUT_DIR = path.resolve(process.cwd(), '.tmp/research/generative-views');
const TALL_VIEWPORT = { width: 1400, height: 1700 };

// The same seeded data and the same four parts as the native spike
// (e2e/tests/spike/native-view-spike.spec.ts), drawn by the plugin from
// ordinary steps. Scope is all open tasks, not only those due today.
const SIDE_BY_SIDE: ToolCall[] = [
  { name: 'put_query', input: { id: 'all', props: { scope: 'all' } } },
  { name: 'put_query', input: { id: 'open', props: { scope: 'all', isDone: false } } },
  {
    name: 'put_query',
    input: { id: 'today', props: { scope: 'all', due: 'today', isDone: false } },
  },
  {
    name: 'put_component',
    input: {
      id: 'main',
      props: { type: 'stack', children: ['remaining', 'time', 'board', 'agenda'] },
    },
  },
  {
    name: 'put_component',
    input: {
      id: 'remaining',
      props: {
        type: 'metric',
        query: 'today',
        measure: 'remaining',
        title: 'Remaining estimate today',
      },
    },
  },
  {
    name: 'put_component',
    input: {
      id: 'time',
      props: {
        type: 'timeBreakdown',
        query: 'all',
        by: 'project',
        range: 'last7Days',
        title: 'Time per project, last 7 days',
      },
    },
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
    input: {
      id: 'agenda',
      props: { type: 'agenda', query: 'open', days: 3, title: 'Next 3 days' },
    },
  },
  { name: 'set_view', input: { title: 'Side by side' } },
  { name: 'say', input: { text: 'Made the side-by-side view.' } },
];

test.describe('AI View Builder views', () => {
  test('draws the seeded tasks next to the native spike', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    test.setTimeout(120000);
    await page.setViewportSize(TALL_VIEWPORT);
    const title = (name: string): string => `${testPrefix}-${name}`;
    await serveTurns(page, [toolStream(SIDE_BY_SIDE)]);

    expect(await waitForPluginAssets(page)).toBe(true);
    await workViewPage.waitForTaskList();
    const write = title('Write report');
    await workViewPage.addTask(`${write} 30m/2h`, false, write);
    await workViewPage.addTask(
      `${title('Call Alice')} 15m/30m`,
      false,
      title('Call Alice'),
    );
    await workViewPage.addTask(`${title('Review PR')} 20m/1h`, false, title('Review PR'));
    await workViewPage.addTask(
      `${title('Send invoice')} 20m/20m`,
      false,
      title('Send invoice'),
    );
    await workViewPage.addTask(`${title('Plan retro')} 1h @tomorrow`, false, null);
    await taskPage.markTaskAsDone(taskPage.getTaskByText(title('Send invoice')));

    const plugin = await openPlugin(page);
    await plugin.locator('#commandInput').fill('Show everything at a glance');
    await plugin.locator('#commandInput').press('Enter');
    await expect(plugin.locator('#status')).toHaveText('Made the side-by-side view.');
    await expect(plugin.locator('.c-metric .metric-value')).toHaveText('2h 25m');

    // The alias is the app's own in-progress tag, so a drop shares the native
    // Boards page's tag, which the plugin creates because it does not exist yet.
    const review = title('Review PR');
    await dragTo(page, plugin, review, 'Doing');
    await expect(columnCards(plugin, 'Doing')).toHaveText([review]);
    expect((await tagsOf(page, review)).map((t) => t.id)).toEqual(['KANBAN_IN_PROGRESS']);
    await dragTo(page, plugin, review, 'To do');
    await expect(columnCards(plugin, 'Doing')).toHaveCount(0);
    expect(await tagsOf(page, review)).toEqual([]);
    await dragTo(page, plugin, review, 'Doing');
    await expect(columnCards(plugin, 'Doing')).toHaveText([review]);
    // Let the view's own entrance animation settle before the screenshot.
    await page.waitForTimeout(800);
    await page.screenshot({
      path: path.join(OUT_DIR, 'spike-plugin-plus.png'),
      fullPage: true,
    });
  });

  test('a ready-made view needs neither a key nor a model call', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    test.setTimeout(90000);
    const requestBodies = await serveTurns(page, []);
    expect(await waitForPluginAssets(page)).toBe(true);
    await workViewPage.waitForTaskList();
    const task = `${testPrefix}-Write report`;
    await workViewPage.addTask(task);

    const plugin = await openPlugin(page, false);
    await plugin.locator('#suggestions button', { hasText: 'Kanban board' }).click();
    await expect(plugin.locator('#viewSelect option:checked')).toHaveText('Kanban board');
    await expect(columnCards(plugin, 'To do')).toHaveText([task]);

    await dragTo(page, plugin, task, 'Doing');
    await expect(columnCards(plugin, 'Doing')).toHaveText([task]);
    expect((await tagsOf(page, task)).map((t) => t.id)).toEqual(['KANBAN_IN_PROGRESS']);

    // The recipe is an ordinary view: undo is local, and nothing went out.
    await plugin.locator('#undoBtn').click();
    await expect(plugin.locator('.board-col')).toHaveCount(0);
    expect(requestBodies).toEqual([]);
  });
});
