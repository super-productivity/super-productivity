import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { waitForPluginAssets } from '../../helpers/plugin-test.helpers';
import {
  LIST_VIEW,
  openPlugin,
  serveTurns,
  taskOf,
  type ToolCall,
  toolStream,
  trackedTaskId,
} from '../../helpers/ai-view-builder.helpers';

// The plugin's task card behaves like a row in the task list: inline title
// edit, keyboard shortcuts, hover controls, a context menu, details.
test.describe('AI View Builder task card', () => {
  test('edits, acts and tracks like a row of the task list', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    test.setTimeout(120000);
    await serveTurns(page, [toolStream(LIST_VIEW)]);
    expect(await waitForPluginAssets(page)).toBe(true);
    await workViewPage.waitForTaskList();
    const report = `${testPrefix}-Write report`;
    const call = `${testPrefix}-Call Alice`;
    await workViewPage.addTask(`${report} 30m/2h`, false, report);
    await workViewPage.addTask(`${call} 15m/30m`, false, call);

    const plugin = await openPlugin(page);
    await plugin.locator('#commandInput').fill('A list of everything');
    await plugin.locator('#commandInput').press('Enter');
    const row = (title: string): Locator =>
      plugin.locator('.card', { hasText: title }).first();
    await expect(row(report)).toBeVisible();

    // Inline title edit: Escape cancels, Enter saves through updateTask. The
    // editor replaces the title text, so the row is found by id meanwhile.
    const renamed = `${testPrefix}-Write the report`;
    const reportId = (await taskOf(page, report))!.id;
    const reportRow = plugin.locator(`.card[data-tid="${reportId}"]`).first();
    await reportRow.locator('.card-title').click();
    await reportRow.locator('.card-input').fill('discarded');
    await page.keyboard.press('Escape');
    await expect(reportRow.locator('.card-title')).toHaveText(report);
    await reportRow.locator('.card-title').click();
    await reportRow.locator('.card-input').fill(renamed);
    await page.keyboard.press('Enter');
    await expect(row(renamed).locator('.card-title')).toHaveText(renamed);
    await expect.poll(async () => (await taskOf(page, renamed))?.title).toBe(renamed);
    expect(await taskOf(page, report)).toBeNull();

    // The done toggle and the D key do the same.
    await row(call).getByRole('button', { name: /done/i }).click();
    await expect(row(call)).toHaveClass(/is-done/);
    await row(call).focus();
    await page.keyboard.press('d');
    await expect(row(call)).not.toHaveClass(/is-done/);
    await expect.poll(async () => (await taskOf(page, call))?.isDone).toBe(false);

    // The context menu offers the safe actions; add sub-task opens an input.
    await row(call).locator('.card-title').click({ button: 'right' });
    const menu = plugin.locator('.card-menu');
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: /Add sub-task/ }).click();
    const sub = `${testPrefix}-Read diff`;
    await plugin.locator('.add-input').fill(sub);
    await plugin.locator('.add-input').press('Enter');
    await expect(row(call).locator('.sub-tasks .card-title')).toHaveText(sub);
    const created = await taskOf(page, sub);
    expect(created?.parentId).toBe((await taskOf(page, call))?.id);
    await plugin.locator('.add-input').press('Escape');

    // Details open in the host's panel, from the hover button and from the I key.
    await row(renamed).hover();
    await row(renamed).getByRole('button', { name: 'Open details' }).click();
    await expect(page.locator('task-detail-panel')).toContainText(renamed);
    await expect(row(renamed)).toHaveClass(/is-selected/);

    // Tracking starts from the hover controls and stops with Y. The renamed
    // row has no sub-tasks, so the pointer is on its own line.
    await row(renamed).hover();
    await row(renamed).getByRole('button', { name: 'Start tracking time' }).click();
    await expect(row(renamed)).toHaveClass(/is-tracking/);
    await expect.poll(() => trackedTaskId(page)).toBe((await taskOf(page, renamed))?.id);
    await row(renamed).focus();
    await page.keyboard.press('y');
    await expect(row(renamed)).not.toHaveClass(/is-tracking/);
    await expect.poll(() => trackedTaskId(page)).toBeNull();
  });

  // The rows next to the native ones, for a person to compare. The files are
  // research output, so the checks here only prove the states were reached.
  test('draws the same seeded rows as the task list', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 1400, height: 1000 });
    await serveTurns(page, [toolStream(LIST_VIEW)]);
    expect(await waitForPluginAssets(page)).toBe(true);
    await workViewPage.waitForTaskList();
    const t = (name: string): string => `${testPrefix}-${name}`;
    await seedRows(workViewPage, taskPage, t);

    const native = (name: string): Locator =>
      page.locator('task:not(.sub-tasks task)', { hasText: t(name) }).first();
    await native('Plan retro').hover();
    await native('Plan retro')
      .locator('task-hover-controls button.start-task-btn')
      .click();
    await page.mouse.move(5, 500);
    await page.waitForTimeout(1500);
    await shoot(page.locator('task-list').first(), 'card-native');
    await native('Call Alice').hover();
    await page.waitForTimeout(400);
    await shoot(native('Call Alice'), 'card-native-hover');
    await native('Write report').hover();
    await native('Write report').locator('task-hover-controls button').last().click();
    await page.mouse.move(5, 500);
    await page.waitForTimeout(600);
    await shoot(native('Write report'), 'card-native-selected');
    await native('Call Alice').click({ button: 'right', position: { x: 200, y: 15 } });
    await page.waitForTimeout(500);
    await shoot(page.locator('.mat-mdc-menu-panel').first(), 'card-native-menu');
    await page.keyboard.press('Escape');

    const plugin = await openPlugin(page);
    await plugin.locator('#commandInput').fill('A list of everything');
    await plugin.locator('#commandInput').press('Enter');
    const row = (name: string): Locator =>
      plugin.locator('.card', { hasText: t(name) }).first();
    await expect(row('Plan retro')).toHaveClass(/is-tracking/);
    await page.mouse.move(5, 500);
    await page.waitForTimeout(1200);
    await shoot(plugin.locator('.c-taskList'), 'card-plugin');
    await row('Call Alice').hover();
    await page.waitForTimeout(400);
    await shoot(row('Call Alice'), 'card-plugin-hover');
    await row('Write report').hover();
    await row('Write report').getByRole('button', { name: 'Open details' }).click();
    await expect(row('Write report')).toHaveClass(/is-selected/);
    await page.mouse.move(5, 500);
    await page.waitForTimeout(600);
    await shoot(row('Write report'), 'card-plugin-selected');
    await row('Call Alice').locator('.card-title').click({ button: 'right' });
    await expect(plugin.locator('.card-menu')).toBeVisible();
    await shoot(plugin.locator('.card-menu'), 'card-plugin-menu');
  });

  test('draws 500 tasks in one pass', async ({ page, workViewPage, testPrefix }) => {
    test.setTimeout(180000);
    await serveTurns(page, [toolStream(LIST_ALL)]);
    expect(await waitForPluginAssets(page)).toBe(true);
    await workViewPage.waitForTaskList();
    await workViewPage.addTask(`${testPrefix}-first`);

    const plugin = await openPlugin(page);
    await createMany(page, `${testPrefix}-bulk`, 500);
    await plugin.locator('#commandInput').fill('A list of everything');
    await plugin.locator('#commandInput').press('Enter');
    // A query shows at most 500 tasks.
    await expect(plugin.locator('.card')).toHaveCount(500, { timeout: 60000 });

    const timings = await measureRedraws(page);
    console.log(`RENDER-500 ${JSON.stringify(timings)}`);
    // A generous bound: it catches a redraw that went quadratic, not noise.
    expect(timings.buildMs).toBeLessThan(1500);
  });
});

// A query shows 200 tasks unless it asks for more.
const LIST_ALL: ToolCall[] = [
  { name: 'put_query', input: { id: 'all', props: { scope: 'all', limit: 500 } } },
  ...LIST_VIEW.slice(1),
];

const OUT_DIR = path.resolve(process.cwd(), '.tmp/research/generative-views');

const shoot = async (target: Locator, name: string): Promise<void> => {
  await target.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
};

type Seeder = {
  addTask(text: string, a: boolean, title: string | null): Promise<void>;
  addSubTask(parent: Locator, title: string): Promise<void>;
};

const seedRows = async (
  workViewPage: Seeder,
  taskPage: {
    getTaskByText(t: string): Locator;
    markTaskAsDone(l: Locator): Promise<void>;
  },
  t: (name: string) => string,
): Promise<void> => {
  await workViewPage.addTask(
    `${t('Write report')} 30m/2h #deep`,
    false,
    t('Write report'),
  );
  await workViewPage.addTask(`${t('Call Alice')} 15m/30m`, false, t('Call Alice'));
  await workViewPage.addTask(`${t('Review PR')} 20m/1h`, false, t('Review PR'));
  await workViewPage.addTask(`${t('Send invoice')} 20m/20m`, false, t('Send invoice'));
  await workViewPage.addTask(`${t('Plan retro')} 30m/1h`, false, t('Plan retro'));
  await workViewPage.addSubTask(taskPage.getTaskByText(t('Review PR')), t('Read diff'));
  await workViewPage.addSubTask(taskPage.getTaskByText(t('Review PR')), t('Leave notes'));
  await taskPage.markTaskAsDone(taskPage.getTaskByText(t('Send invoice')));
};

const createMany = async (page: Page, prefix: string, count: number): Promise<void> => {
  await page.evaluate(
    async ({ prefix: p, count: n }) => {
      const frame = document.querySelector('plugin-index iframe') as HTMLIFrameElement;
      const api = (frame.contentWindow as unknown as { PluginAPI: any }).PluginAPI;
      const [project] = await api.getAllProjects();
      const operations = Array.from({ length: n }, (_, i) => ({
        type: 'create',
        tempId: `tmp-${i}`,
        data: { title: `${p}-${i}`, timeEstimate: 15 * 60000 },
      }));
      await api.batchUpdateForProject({ projectId: project.id, operations });
    },
    { prefix, count },
  );
};

// Toggling the part selection redraws every card (the signature changes), so
// the click handler's own time is the cost of building and swapping the rows.
const measureRedraws = async (
  page: Page,
): Promise<{ buildMs: number; layoutMs: number; runs: number }> => {
  const handle = await page.locator('plugin-index iframe').elementHandle();
  const frame = await handle!.contentFrame();
  return frame!.evaluate(() => {
    // The click draws the header button again, so look it up every time.
    const button = (): HTMLElement =>
      document.querySelector<HTMLElement>('[data-action="select"]')!;
    const builds: number[] = [];
    const layouts: number[] = [];
    for (let i = 0; i < 7; i++) {
      const t0 = performance.now();
      button().click();
      const t1 = performance.now();
      void document.body.offsetHeight;
      const t2 = performance.now();
      builds.push(t1 - t0);
      layouts.push(t2 - t1);
    }
    const median = (xs: number[]): number =>
      Math.round([...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]);
    return { buildMs: median(builds), layoutMs: median(layouts), runs: builds.length };
  });
};
