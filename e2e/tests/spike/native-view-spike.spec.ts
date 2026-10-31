// SPIKE: throwaway, do not merge
import type { FrameLocator, Page } from '@playwright/test';
import path from 'node:path';
import { expect, test } from '../../fixtures/test.fixture';
import {
  enablePluginWithVerification,
  waitForPluginAssets,
  waitForPluginInMenu,
  waitForPluginManagementInit,
} from '../../helpers/plugin-test.helpers';

const OUT_DIR = path.resolve(process.cwd(), '.tmp/research/generative-views');
const TALL_VIEWPORT = { width: 1400, height: 1700 };

type OpRow = { action: string; opType: string; entityType: string; entityId?: string };

// Compact op format: a = action code, o = opType, e = entityType, d = entityId.
const readOps = async (page: Page): Promise<OpRow[]> => {
  await page.evaluate(() =>
    (
      window as unknown as {
        __e2eTestHelpers: { flushPendingWrites: () => Promise<void> };
      }
    ).__e2eTestHelpers.flushPendingWrites(),
  );
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('SUP_OPS');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const entries = await new Promise<{ op: Record<string, string> }[]>(
        (resolve, reject) => {
          const request = db.transaction('ops').objectStore('ops').getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        },
      );
      return entries.map(({ op }) => ({
        action: op.a ?? op.actionType,
        opType: op.o ?? op.opType,
        entityType: op.e ?? op.entityType,
        entityId: op.d ?? op.entityId,
      }));
    } finally {
      db.close();
    }
  });
};

const opsSince = async (page: Page, before: number): Promise<OpRow[]> =>
  (await readOps(page)).slice(before);

const summarize = (ops: OpRow[]): string =>
  ops.map((o) => `${o.opType}:${o.entityType}:${o.entityId ?? ''}`).join(' | ') ||
  '(none)';

const half = (n: number): number => n / 2;

const dragBetween = async (
  page: Page,
  from: ReturnType<Page['locator']>,
  to: ReturnType<Page['locator']>,
): Promise<void> => {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error('drag source or target not visible');
  const startX = a.x + half(a.width);
  const startY = a.y + half(a.height);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 20, startY, { steps: 4 });
  await page.mouse.move(b.x + half(b.width), b.y + 30, { steps: 12 });
  await page.mouse.up();
};

const panel = (page: Page, id: string): ReturnType<Page['locator']> =>
  page.locator(`board-panel[data-board-selection-scope="${id}"]`);

test.describe('Native view spike', () => {
  test('renders SP components from one spec; viewing writes no ops', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    test.setTimeout(120000);
    await page.setViewportSize(TALL_VIEWPORT);
    const title = (name: string): string => `${testPrefix}-${name}`;
    const review = title('Review PR');
    const write = title('Write report');

    await workViewPage.waitForTaskList();
    await workViewPage.addTask(`${write} 30m/2h`, false, write);
    await workViewPage.addTask(
      `${title('Call Alice')} 15m/30m`,
      false,
      title('Call Alice'),
    );
    await workViewPage.addTask(`${review} 20m/1h`, false, review);
    await workViewPage.addTask(
      `${title('Send invoice')} 20m/20m`,
      false,
      title('Send invoice'),
    );
    await workViewPage.addTask(`${title('Plan retro')} 1h @tomorrow`, false, null);
    await taskPage.markTaskAsDone(taskPage.getTaskByText(title('Send invoice')));

    // The stock boards page creates the in-progress tag once; the spike's board
    // needs it to exist (board.component.ts:84 hides all panels until it does).
    await page.goto('/#/boards');
    await page.getByRole('tab', { name: 'Kanban', exact: true }).click();
    await page.locator('.missing-tags-msg-wrapper button').click();
    await expect(page.locator('board-panel').first()).toBeVisible();
    const stockBefore = (await readOps(page)).length;
    await dragBetween(
      page,
      page.locator('board-panel planner-task', { hasText: review }),
      page.locator('board-panel', { hasText: 'In Progress' }).first(),
    );
    await expect(
      page.locator('board-panel', { hasText: 'In Progress' }).getByText(review),
    ).toBeVisible();
    const stockDrag = await opsSince(page, stockBefore);
    console.log(`STOCK board drag ops: ${summarize(stockDrag)}`);

    // 1. Open the route and let it idle; count ops before and after.
    const beforeMount = (await readOps(page)).length;
    await page.goto('/#/native-view-spike');
    await expect(page.locator('native-view-spike')).toBeVisible();

    // All four parts render.
    await expect(page.locator('[data-spike=board] board-panel')).toHaveCount(3);
    await expect(panel(page, 'spike:board:todo')).toContainText(write);
    await expect(panel(page, 'spike:board:doing')).toContainText(review);
    await expect(page.locator('[data-spike=agenda] planner-day')).toHaveCount(3);
    await expect(page.locator('[data-spike=agenda] planner-day').nth(1)).toContainText(
      title('Plan retro'),
    );
    await expect(page.locator('[data-spike=metric] .metric')).toHaveText(/2h\s*25m/);
    // The chart is canvas-only, so check that it painted something.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const canvas = document.querySelector<HTMLCanvasElement>(
            '[data-spike=time] canvas',
          );
          const ctx = canvas?.getContext('2d');
          if (!canvas || !ctx) return false;
          const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          return px.some((v, i) => i % 4 === 3 && v > 0);
        }),
      )
      .toBe(true);

    // Idle: tracking tick, hover, scroll. Nothing here may write.
    await page.waitForTimeout(3000);
    await page.mouse.move(300, 300);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(1000);
    const viewOps = await opsSince(page, beforeMount);
    console.log(`MOUNT + IDLE ops: ${summarize(viewOps)}`);
    expect(viewOps).toEqual([]);

    await page.screenshot({
      path: path.join(OUT_DIR, 'spike-native.png'),
      fullPage: true,
    });

    // 2. Drag To do -> Doing on the ephemeral board: the task's tag changes
    // (a real user intent) but no BOARD op for the orphan panel is written.
    const beforeDrag = (await readOps(page)).length;
    await dragBetween(
      page,
      panel(page, 'spike:board:todo').locator('planner-task', { hasText: write }),
      panel(page, 'spike:board:doing').locator('.cdk-drop-list'),
    );
    await expect(panel(page, 'spike:board:doing')).toContainText(write);
    const ephemeralDrag = await opsSince(page, beforeDrag);
    console.log(`SPIKE board drag (ephemeral) ops: ${summarize(ephemeralDrag)}`);
    expect(ephemeralDrag.filter((o) => o.entityType === 'BOARD')).toEqual([]);

    // 3. Baseline: the stock behaviour (?persistOrder=1) records a BOARD op for a
    // panel id that exists in no stored board.
    await page.goto('/#/native-view-spike?persistOrder=1');
    await page.reload();
    await expect(panel(page, 'spike:board:doing')).toContainText(write);
    const beforeStock = (await readOps(page)).length;
    await dragBetween(
      page,
      panel(page, 'spike:board:doing').locator('planner-task', { hasText: write }),
      panel(page, 'spike:board:todo').locator('.cdk-drop-list'),
    );
    await expect(panel(page, 'spike:board:todo')).toContainText(write);
    const persistedDrag = await opsSince(page, beforeStock);
    console.log(`SPIKE board drag (persistOrder) ops: ${summarize(persistedDrag)}`);
    expect(persistedDrag.some((o) => o.entityType === 'BOARD')).toBe(true);
  });
});

// The same tasks, drawn by the plugin's look-alike renderer.
const toolStream = (
  calls: { name: string; input: Record<string, unknown> }[],
): string => {
  const events: Record<string, unknown>[] = [
    { type: 'message_start', message: { id: 'msg_e2e', role: 'assistant', content: [] } },
  ];
  calls.forEach((call, index) => {
    const json = JSON.stringify(call.input);
    events.push({
      type: 'content_block_start',
      index,
      content_block: {
        type: 'tool_use',
        id: `tool_${index}`,
        name: call.name,
        input: {},
      },
    });
    for (let i = 0; i < json.length; i += 40) {
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: json.slice(i, i + 40) },
      });
    }
    events.push({ type: 'content_block_stop', index });
  });
  events.push({ type: 'message_delta', delta: { stop_reason: 'tool_use' } });
  events.push({ type: 'message_stop' });
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
};

const KANBAN = toolStream([
  { name: 'put_query', input: { id: 'open', props: { scope: '@current' } } },
  {
    name: 'put_component',
    input: {
      id: 'board',
      props: {
        type: 'board',
        query: 'open',
        columns: [
          { id: 'todo', title: 'To do', notTags: ['Doing'], isDone: false },
          { id: 'doing', title: 'Doing', tags: ['Doing'], isDone: false },
          { id: 'done', title: 'Done', isDone: true },
        ],
      },
    },
  },
  { name: 'set_view', input: { title: 'Plugin Kanban' } },
  { name: 'say', input: { text: 'Made a board with To do, Doing and Done.' } },
]);

test.describe('Plugin look-alike (for comparison)', () => {
  test('screenshot of the plugin kanban for the same tasks', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    test.setTimeout(120000);
    await page.setViewportSize(TALL_VIEWPORT);
    const title = (name: string): string => `${testPrefix}-${name}`;
    const review = title('Review PR');

    await page.route('https://api.anthropic.com/v1/messages', async (route) => {
      const cors: [string, string][] = [
        ['access-control-allow-origin', '*'],
        ['access-control-allow-headers', '*'],
        ['access-control-allow-methods', 'POST'],
      ];
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 200, headers: Object.fromEntries(cors) });
        return;
      }
      await route.fulfill({
        status: 200,
        headers: Object.fromEntries([...cors, ['content-type', 'text/event-stream']]),
        body: KANBAN,
      });
    });

    expect(await waitForPluginAssets(page)).toBe(true);
    await workViewPage.waitForTaskList();
    await workViewPage.addTask(
      `${title('Write report')} 30m/2h`,
      false,
      title('Write report'),
    );
    await workViewPage.addTask(
      `${title('Call Alice')} 15m/30m`,
      false,
      title('Call Alice'),
    );
    await workViewPage.addTask(`${review} 20m/1h`, false, review);
    await workViewPage.addTask(
      `${title('Send invoice')} 20m/20m`,
      false,
      title('Send invoice'),
    );
    await workViewPage.addTask(`${title('Plan retro')} 1h @tomorrow`, false, null);
    await taskPage.markTaskAsDone(taskPage.getTaskByText(title('Send invoice')));

    expect(await waitForPluginManagementInit(page)).toBe(true);
    expect(await enablePluginWithVerification(page, 'AI View Builder')).toBe(true);
    expect(await waitForPluginInMenu(page, 'AI View Builder')).toBe(true);

    await page.goto('/#/plugins/ai-view-builder/index');
    const plugin: FrameLocator = page.frameLocator('plugin-index iframe');
    await plugin.locator('#apiKeyInput').fill('sk-ant-e2e-key');
    await plugin.locator('#saveKeyBtn').click();
    await plugin.locator('#suggestions button', { hasText: 'Kanban board' }).click();
    await expect(plugin.locator('#status')).toHaveText(
      'Made a board with To do, Doing and Done.',
    );

    // Drop one card into Doing, as in the native screenshot.
    await dragBetween(
      page,
      plugin.locator('.card', { hasText: review }),
      plugin.locator('.board-col', { hasText: 'Doing' }),
    );
    await expect(
      plugin.locator('.board-col', { hasText: 'Doing' }).locator('.card-title'),
    ).toHaveText([review]);

    // Let the plugin's own drag animation settle before the screenshot.
    await page.waitForTimeout(800);
    await page.screenshot({
      path: path.join(OUT_DIR, 'spike-plugin.png'),
      fullPage: true,
    });
  });
});
