import { expect, test } from '../../fixtures/test.fixture';
import {
  enablePluginWithVerification,
  getCITimeoutMultiplier,
  waitForPluginAssets,
  waitForPluginInMenu,
  waitForPluginManagementInit,
} from '../../helpers/plugin-test.helpers';

const PLUGIN_NAME = 'AI View Builder';
const PLUGIN_IFRAME = 'plugin-index iframe';

// What the mocked model returns: lists top-level tasks and completes one on click.
const GENERATED_VIEW = `<!doctype html>
<html><head><title>E2E Task List</title></head>
<body>
<ul id="list"></ul>
<script>
  async function render() {
    const tasks = (await sp.getTasks()).filter((t) => !t.parentId);
    const list = document.getElementById('list');
    list.textContent = '';
    tasks.forEach((task) => {
      const li = document.createElement('li');
      li.textContent = task.title + (task.isDone ? ' [done]' : '');
      const button = document.createElement('button');
      button.textContent = 'Complete';
      button.onclick = () => sp.updateTask(task.id, { isDone: true });
      li.appendChild(button);
      list.appendChild(li);
    });
  }
  sp.onChange(render);
  render();
</script>
</body></html>`;

const toSse = (text: string): string => {
  const events = [
    { type: 'message_start', message: { id: 'msg_e2e', role: 'assistant', content: [] } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    { type: 'message_stop' },
  ];
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
};

test.describe('AI View Builder plugin', () => {
  test('generates a view that reads and changes real tasks without sending them', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    test.setTimeout(60000 * getCITimeoutMultiplier());
    const taskTitle = `${testPrefix}-Write report`;

    const requests: { headers: Record<string, string>; body: string }[] = [];
    await page.route('https://api.anthropic.com/v1/messages', async (route) => {
      const request = route.request();
      const cors: [string, string][] = [
        ['access-control-allow-origin', '*'],
        ['access-control-allow-headers', '*'],
        ['access-control-allow-methods', 'POST'],
      ];
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 200, headers: Object.fromEntries(cors) });
        return;
      }
      requests.push({ headers: request.headers(), body: request.postData() || '' });
      await route.fulfill({
        status: 200,
        headers: Object.fromEntries([...cors, ['content-type', 'text/event-stream']]),
        body: toSse(GENERATED_VIEW),
      });
    });

    expect(await waitForPluginAssets(page)).toBe(true);
    await workViewPage.waitForTaskList();
    await workViewPage.addTask(taskTitle);

    expect(await waitForPluginManagementInit(page)).toBe(true);
    expect(await enablePluginWithVerification(page, PLUGIN_NAME)).toBe(true);
    expect(await waitForPluginInMenu(page, PLUGIN_NAME)).toBe(true);

    await page.goto('/#/plugins/ai-view-builder/index');
    const plugin = page.frameLocator(PLUGIN_IFRAME);

    await plugin.locator('#apiKeyInput').fill('sk-ant-e2e-key');
    await plugin.locator('#saveKeyBtn').click();
    await expect(plugin.locator('#keyStatus')).toHaveText(
      'A key is saved on this device.',
    );

    await plugin.locator('#emptyStartBtn').click();
    await plugin
      .locator('#promptInput')
      .fill('A list of my tasks with a complete button');
    await plugin.locator('#generateBtn').click();
    await expect(plugin.locator('#status')).toContainText('Done', { timeout: 15000 });
    await expect(plugin.locator('#viewSelect option')).toHaveText(['E2E Task List']);

    const view = plugin.frameLocator('#viewFrame');
    const row = view.locator('li', { hasText: taskTitle });
    await expect(row).toBeVisible();

    // The write goes through the real plugin bridge; the view re-renders from
    // the app's own hook.
    await row.getByRole('button', { name: 'Complete' }).click();
    await expect(row).toContainText('[done]');

    expect(requests).toHaveLength(1);
    expect(requests[0].headers['x-api-key']).toBe('sk-ant-e2e-key');
    expect(requests[0].body).toContain('A list of my tasks with a complete button');
    expect(requests[0].body).not.toContain(taskTitle);
  });
});
